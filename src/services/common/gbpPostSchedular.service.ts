/* eslint-disable @typescript-eslint/no-explicit-any */
import httpStatus from 'http-status';
import { google } from 'googleapis';
import axios from 'axios'
import moment from 'moment-timezone';
import { DateTime } from 'luxon'

import { ApiError, mongoFunctions } from '../../utils';
import { BodyDefinition, FilesDefinition, ParamsDefinition } from '../../types/RouteDefinition';
import { GBPPost, UserAuth, UserGBP } from '../../models';
import { mongoOperationsTypes, postPublishStatus, tokenTypes } from '../../configs/constantTypes';
import { oAuth2ClientGBP, refreshAccessToken } from '../../configs/gbpOauthClinet';
import { agenda } from '../../configs/mongoConnection';
import { fetchNAPDatFromGoogle } from '../../helpers';


export const getRegisteredGoogleBusinessProfile = async (body: BodyDefinition): Promise<any> => {
	try {
		const { user } = body;

		const authTokenDoc = await UserAuth.findOne({
			user_id: user._id,
			is_active: true,
			token_type: tokenTypes.GBP,
		});

		if (!authTokenDoc) {
			throw new ApiError(httpStatus.BAD_REQUEST, 'Please connect with Google Business Profile');
		}

		let accessToken = authTokenDoc.access_token;
		if (new Date() > new Date(authTokenDoc.expiry_date)) {
			accessToken = await refreshAccessToken(authTokenDoc.refresh_token);
		}

		oAuth2ClientGBP.setCredentials({
			access_token: accessToken,
			refresh_token: authTokenDoc.refresh_token,
		});

		const accountMgmt = google.mybusinessaccountmanagement({
			version: 'v1',
			auth: oAuth2ClientGBP,
		});

		const accountRes = await accountMgmt.accounts.list();
		const accounts = accountRes.data.accounts;

		if (!accounts || accounts.length === 0) {
			throw new ApiError(httpStatus.BAD_REQUEST, 'No Google Business accounts found for this user.');
		}

		const accountId = accounts[0].name;
		console.log("Using accountId:", accountId);

		const businessInfo = google.mybusinessbusinessinformation({
			version: 'v1',
			auth: oAuth2ClientGBP,
		});

		const locationsRes = await businessInfo.accounts.locations.list({
			parent: accountId,
			// readMask: 'storeCode,regularHours,name,languageCode,title,phoneNumbers,storefrontAddress,websiteUri,regularHours,specialHours,labels,latlng,openInfo,metadata,profile,categories,serviceArea,relationshipData,moreHours,adWordsLocationExtensions'
			readMask: 'name,languageCode,title,phoneNumbers,profile,storefrontAddress,websiteUri,regularHours,latlng,openInfo,metadata,phoneNumbers,categories'
		});
		
		const locations = locationsRes.data.locations || [];
		// return locations
		
		const response: any[] = [];
		for (let location of locations) {
			const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
			const locationObj: any = {
				gbpAccountId: `${accountId}`,
				gbpLocationId: `${location?.name}`,
				title: location?.title,
				websiteUri: location?.websiteUri || 'NA',
				languageCode: location?.languageCode,
				metadata: location?.metadata,
				profile: location?.profile,
				mobile: location?.phoneNumbers?.primaryPhone || null,
				business_category: location?.categories?.primaryCategory?.displayName || null,
				country: location?.storefrontAddress && location?.storefrontAddress?.regionCode ? regionNames.of(location?.storefrontAddress?.regionCode) : null,
				state: location?.storefrontAddress?.administrativeArea || null,
				city: location?.storefrontAddress?.locality || null,
				zip_code: location?.storefrontAddress?.postalCode || null,
			}
			if(location.metadata.placeId){
				let placeDetails = await fetchNAPDatFromGoogle(location.metadata.placeId)
				if(placeDetails){
					locationObj.address = placeDetails.formatted_address || null
				}
			}

			response.push(locationObj)
		}
		return response;

	} catch (error: any) {
		// console.error("Error fetching Google Business Profile:", JSON.stringify(error, null, 2));
		const googleError = error.errors?.[0]?.message || error.message;
		throw new ApiError(
			error.code || httpStatus.INTERNAL_SERVER_ERROR,
			googleError || 'Failed to fetch Google Business locations',
		);
	}
};

export const bindGoogleBusinessProfileWithUser = async (body: BodyDefinition): Promise<any> => {
	try {
		const { user, gbpAccountId, gbpLocationId, title, websiteUri, languageCode, metadata, profile, location_id } = body;
		let userGBPObj = {
			user_id: user._id,
			gbpAccountId,
			gbpLocationId,
			title,
			websiteUri,
			languageCode,
			metadata,
			profile,
			location_id
		}
		await UserGBP.deleteMany({
			user_id: user?._id,
			location_id
		})
		await mongoFunctions({
			schema: UserGBP,
			createData: userGBPObj,
			operationType: mongoOperationsTypes.CREATE,
		});
		return ''
	} catch (error: any) {
		// console.error("Error fetching Google Business Profile:", JSON.stringify(error, null, 2));
		const googleError = error.errors?.[0]?.message || error.message;
		throw new ApiError(
			error.code || httpStatus.INTERNAL_SERVER_ERROR,
			googleError || 'Failed to fetch Google Business locations',
		);
	}
};

export const addPostToGBP = async (body: BodyDefinition): Promise<any> => {
	try {
		const { user, gbpPostData, gbpPostObj } = body;

		if (!user || !gbpPostData || !gbpPostObj) {
			throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid input data. Please provide all required fields.');
		}

		// Save the scheduled post in DB
		const savedPost = await GBPPost.create(gbpPostObj);

		if (!gbpPostObj.is_scheduled) {

			const result: { status : boolean, data: any} = await publishPostToGBP({
				user,
				gbpPostData,
				gbpPostObj: { ...gbpPostObj, gbpPostID: savedPost._id },
			});
			if(result.status){
				await GBPPost.updateOne(
					{ _id: gbpPostObj.gbpPostID },
					{ 
						$set: { 
							gbpPostId: result?.data?.name, 
							searchUrl: result?.data?.searchUrl, 
							is_posted: true, 
							is_scheduled: false, 
							status: postPublishStatus.live 
						} 
					}
				)
			}else{
				await GBPPost.updateOne(
					{ _id: gbpPostObj.gbpPostID },
					{ 
						$set: 
						{ 
							is_posted: false, 
							is_scheduled: false, 
							status: postPublishStatus.rejected 
						} 
					}
				)
			}
			return result.status
				? 'Post published successfully to Google Business Profile.'
				: 'Post saved but failed to publish to Google Business Profile.';
		} else {
			// Schedule job using Agenda
			const { timeZone, date, time } = gbpPostObj.schedule
			const utcDateTime = DateTime.fromFormat(`${date} ${time}`, "yyyy-MM-dd HH:mm", { zone: timeZone }).toUTC();
			if (utcDateTime.isValid) {
				const utcDate = utcDateTime.toISO();

				await agenda.schedule(utcDate, 'post-to-gbp', {
					user,
					gbpPostData,
					gbpPostObj: { ...gbpPostObj, gbpPostID: savedPost._id },
				});
				return 'Post scheduled successfully.';
			} else {
				throw new ApiError(httpStatus.BAD_REQUEST, 'Missing scheduling info (timeZone, date, or time).');
			}
		}
	} catch (err: any) {
		if (axios.isAxiosError(err) && err.response) {
			console.error('Google API Error:', JSON.stringify(err.response.data, null, 2));
			throw new ApiError(
				err.response.status || httpStatus.INTERNAL_SERVER_ERROR,
				err.response.data?.error?.message || 'Google API request failed'
			);
		} else {
			const errorMessage = err.errors?.[0]?.message || err.message || 'Unknown server error';
			console.error('Internal Error:', errorMessage);
			throw new ApiError(
				err.code || httpStatus.INTERNAL_SERVER_ERROR,
				errorMessage
			);
		}
	}
};

export const publishPostToGBP = async (body: BodyDefinition): Promise<{ status: boolean, data: any }> => {
	try {
		let { user, gbpPostData, gbpPostObj, savedPost } = body;

		const authTokenDoc = await UserAuth.findOne({
			user_id: user._id,
			is_active: true,
			token_type: tokenTypes.GBP,
		});

		if (!authTokenDoc) {
			throw new ApiError(httpStatus.BAD_REQUEST, 'Please connect with Google Business Profile');
		}

		let accessToken = authTokenDoc.access_token;
		if (new Date() > new Date(authTokenDoc.expiry_date)) {
			accessToken = await refreshAccessToken(authTokenDoc.refresh_token);
		}

		const addPostUrl = `https://mybusiness.googleapis.com/v4/${gbpPostObj.gbpAccountId}/${gbpPostObj.gbpLocationId}/localPosts`;

		const response = await axios.post(addPostUrl, gbpPostData, {
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json',
			},
		});
		if (response.status === 200 || response.status === 201) {
			return {status: true, data: response.data};
		}

		return {status: false, data: null};

	} catch (err: any) {
		if (axios.isAxiosError(err) && err.response) {
			// console.error('Google API Error:', JSON.stringify(err.response.data, null, 2));
			return {status: false, data: null};
		} else {
			const googleError = err.errors?.[0]?.message || err.message;
			// console.error(googleError);
			return {status: false, data: null};
		}
	}
};

// 1=all, 2=live, 3=scheduled, 4=expired, 5=rejected
export const getAllPostByLocationId = async (body: BodyDefinition): Promise<any> => {
	try {
		const { locationDoc, type } = body;

		const baseMatch = {
			location_id: locationDoc._id,
			is_active: true
		};

		const aggregation = await GBPPost.aggregate([
			{ $match: baseMatch },
			{
				$facet: {
					all: [{ $count: 'count' }],
					live: [
						{ $match: { status: postPublishStatus.live, is_posted: true } },
						{ $count: 'count' }
					],
					scheduled: [
						{ $match: { status: postPublishStatus.scheduled, is_scheduled: true } },
						{ $count: 'count' }
					],
					expired: [
						{ $match: { status: postPublishStatus.expired } },
						{ $count: 'count' }
					],
					rejected: [
						{ $match: { status: postPublishStatus.rejected } },
						{ $count: 'count' }
					]
				}
			}
		]);

		const result = {
			all: aggregation[0].all[0]?.count || 0,
			live: aggregation[0].live[0]?.count || 0,
			scheduled: aggregation[0].scheduled[0]?.count || 0,
			expired: aggregation[0].expired[0]?.count || 0,
			rejected: aggregation[0].rejected[0]?.count || 0,
			posts: []
		};

		// Modify filter based on type
		let status = 'all';
		const filter: any = { ...baseMatch };

		switch (Number(type)) {
			case 2:
				filter.status = postPublishStatus.live;
				filter.is_posted = true;
				status = postPublishStatus.live;
				break;
			case 3:
				filter.status = postPublishStatus.scheduled;
				filter.is_scheduled = true;
				status = postPublishStatus.scheduled;
				break;
			case 4:
				filter.status = postPublishStatus.expired;
				status = postPublishStatus.expired;
				break;
			case 5:
				filter.status = postPublishStatus.rejected;
				status = postPublishStatus.rejected;
				break;
		}

		const postDocs = await GBPPost.find(filter);
		result.posts = postDocs;
		result[status.toLowerCase()] = postDocs.length;

		return result;
	} catch (error: any) {
		throw new ApiError(
			error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};



export const deletePost = async (body: BodyDefinition): Promise<any> => {
	try {
		const { user, post_id } = body;

		if (!post_id) {
			throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid input data. Please provide post_id.');
		}
		const postDoc = await GBPPost.findOne({ _id: post_id, is_active: true });
		if (!postDoc) {
			throw new ApiError(httpStatus.BAD_REQUEST, 'Post not found');
		}

		if (postDoc.gbpPostId) {
			let isDeleted = await deleteGBPPost(user._id, postDoc.gbpPostId)
			if (isDeleted) {
				postDoc.is_active = false;
				await postDoc.save()
			} else {
				throw new ApiError(httpStatus.BAD_REQUEST, 'Failed to delete');
			}
		}

	} catch (error: any) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

export const deleteGBPPost = async (userId: string, gbpPostId: string): Promise<boolean> => {
	try {
		const authTokenDoc = await UserAuth.findOne({
			user_id: userId,
			is_active: true,
			token_type: tokenTypes.GBP,
		});

		if (!authTokenDoc) {
			throw new ApiError(httpStatus.BAD_REQUEST, 'Please connect with Google Business Profile');
		}

		let accessToken = authTokenDoc.access_token;
		if (new Date() > new Date(authTokenDoc.expiry_date)) {
			accessToken = await refreshAccessToken(authTokenDoc.refresh_token);
		}

		const deleteUrl = `https://mybusiness.googleapis.com/v4/${gbpPostId}`;

		await axios.delete(deleteUrl, {
			headers: {
				Authorization: `Bearer ${accessToken}`,
			},
		});

		return true;

	} catch (err: any) {
		if (axios.isAxiosError(err) && err.response) {
			console.error('Google API Delete Error:', JSON.stringify(err.response.data, null, 2));
			return false;
		} else {
			console.error('Unknown error while deleting GBP post:', err.message);
			return false;
		}
	}
};

export const unbindGoogleBusinessProfileWithUser = async (body: BodyDefinition): Promise<any> => {
	try {
		const { user, gbpAccountId, gbpLocationId, title, websiteUri, languageCode, metadata, profile, location_id } = body;
		let userGBPObj = {
			user_id: user._id,
			gbpAccountId,
			gbpLocationId,
			title,
			websiteUri,
			languageCode,
			metadata,
			profile,
			location_id
		}
		await UserGBP.deleteMany({
			user_id: user?._id,
			location_id
		})
		await mongoFunctions({
			schema: UserGBP,
			createData: userGBPObj,
			operationType: mongoOperationsTypes.CREATE,
		});
		return ''
	} catch (error: any) {
		// console.error("Error fetching Google Business Profile:", JSON.stringify(error, null, 2));
		const googleError = error.errors?.[0]?.message || error.message;
		throw new ApiError(
			error.code || httpStatus.INTERNAL_SERVER_ERROR,
			googleError || 'Failed to fetch Google Business locations',
		);
	}
};

/*
{
  "languageCode": "en",
  "summary": "We’ve launched our new service line for enterprise clients!",
  "callToAction": {
	"actionType": "LEARN_MORE",
	"url": "https://blockcod.com/services"
  },
  "media": [
	{
	  "mediaFormat": "PHOTO",
	  "sourceUrl": "https://yourdomain.com/images/launch.jpg"
	}
  ],
  "topicType": "STANDARD"
}

{
  "languageCode": "en",
  "summary": "Join our free webinar on app security best practices.",
  "event": {
	"title": "Web App Security Webinar",
	"schedule": {
	  "startDate": {
		"year": 2025,
		"month": 5,
		"day": 18
	  },
	  "endDate": {
		"year": 2025,
		"month": 5,
		"day": 18
	  }
	}
  },
  "callToAction": {
	"actionType": "SIGN_UP",
	"url": "https://blockcod.com/webinar-signup"
  },
  "media": [
	{
	  "mediaFormat": "PHOTO",
	  "sourceUrl": "https://yourdomain.com/images/webinar.jpg"
	}
  ],
  "topicType": "EVENT"
}
{
  "languageCode": "en",
  "summary": "Get 25% off all services until the end of the month!",
  "offer": {
	"couponCode": "SUMMER25",
	"redeemOnlineUrl": "https://blockcod.com/redeem",
	"termsConditions": "Offer valid for first-time users only.",
	"title": "Summer Sale",
	"startDate": {
	  "year": 2025,
	  "month": 5,
	  "day": 12
	},
	"endDate": {
	  "year": 2025,
	  "month": 5,
	  "day": 31
	}
  },
  "callToAction": {
	"actionType": "ORDER"
  },
  "media": [
	{
	  "mediaFormat": "PHOTO",
	  "sourceUrl": "https://yourdomain.com/images/offer.jpg"
	}
  ],
  "topicType": "OFFER"
}
*/