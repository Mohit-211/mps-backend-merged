/* eslint-disable @typescript-eslint/no-explicit-any */
import httpStatus from 'http-status';
import axios from 'axios'
import moment from 'moment-timezone';
import { DateTime } from 'luxon'

import { ApiError } from '../../utils';
import { BodyDefinition, FilesDefinition, ParamsDefinition } from '../../types/RouteDefinition';
import { GBPPost, UserAuth } from '../../models';
import { postPublishStatus, tokenTypes } from '../../configs/constantTypes';
import { refreshAccessToken } from '../../configs/gbpOauthClinet';
import { agenda } from '../../configs/mongoConnection';
import { BindResult, DiscoveryResult, UnbindResult, bindingService, discoveryService } from '../gbp';


// Phase 6: discovery across all accounts with no Places calls (C9, C22), and server-side binding.
export const getRegisteredGoogleBusinessProfile = async (body: BodyDefinition): Promise<DiscoveryResult> => {
	const { user } = body;
	return discoveryService.listAllLocations(user._id);
};

export const bindGoogleBusinessProfileWithUser = async (body: BodyDefinition): Promise<BindResult> => {
	const { user, gbpAccountId, gbpLocationId, location_id } = body;
	return bindingService.bindLocation(user._id, { location_id, gbpAccountId, gbpLocationId });
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

// C12: a real unbind (binding, scheduled jobs, and the tokens if it was the last binding).
export const unbindGoogleBusinessProfileWithUser = async (body: BodyDefinition): Promise<UnbindResult> => {
	const { user, location_id } = body;
	return bindingService.unbindLocation(user._id, location_id);
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