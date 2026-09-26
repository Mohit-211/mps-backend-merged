/* eslint-disable @typescript-eslint/no-explicit-any */
import httpStatus from 'http-status';
import mongoose from 'mongoose';
import fs from 'fs/promises'
import path from 'path'

import { Client, GBPPost, IWhitelabelProfile, Location, Profile, User, UserGBP, WhitelabelProfile } from '../../models';
import { ApiError, isValidMongoObjectId, mongoFunctions } from '../../utils';
import { mongoOperationsTypes, userTypes } from '../../configs/constantTypes';
import { BodyDefinition, ParamsDefinition, QueryDefinition } from '../../types/RouteDefinition';
import { locationSelect } from '../../constants';
import { placesClient } from '../../clients/placesClient';

export const createLocation = async (body: BodyDefinition): Promise<any> => {
	try {
		const {
			name,
			address,
			country,
			state,
			city,
			zip_code,
			mobile,
			website_URL,
			business_category,
			client_id,
			place_id,
			user,
		} = body;
		const locationObj = {
			name,
			address,
			country,
			state,
			city,
			zip_code,
			mobile,
			website_URL,
			business_category,
			created_by: user._id,
		};
		if (client_id) {
			locationObj['client_id'] = client_id;
		};

		if (place_id) {
			// Places API (New) Place Details, `location` field only (was a legacy all-fields call, AUDIT C23).
			try {
				const { details } = await placesClient.getPlaceDetails(place_id, ['location']);
				if (details.location) {
					locationObj['lat'] = details.location.latitude;
					locationObj['lng'] = details.location.longitude;
				}
			} catch {
				// Coordinates stay empty; the first rank run resolves them (Phase 5).
			}
			locationObj['place_id'] = place_id;
		}

		const locationDoc = await mongoFunctions({
			schema: Location,
			createData: locationObj,
			operationType: mongoOperationsTypes.CREATE,
		});
		if (!locationDoc) {
			throw new ApiError(
				httpStatus.INTERNAL_SERVER_ERROR,
				'Failed to create new Location',
			);
		}
		const userProfileDoc = await Profile.findOne({
			user_id: user._id,
			is_active: true,
		});
		if (userProfileDoc) {
			await mongoFunctions({
				schema: Profile,
				condition: { user_id: user._id, is_active: true },
				updateData: {
					no_of_locations: userProfileDoc?.no_of_locations + 1 || 1,
				},
				operationType: mongoOperationsTypes.UPDATE_ONE,
			});
		}
		if (client_id) {
			const clientDoc = await Client.findOne({
				_id: client_id,
				created_by: user._id,
				is_active: true,
			});
			if (clientDoc) {
				clientDoc.no_of_locations = (clientDoc.no_of_locations || 0) + 1;
				await clientDoc.save();
			}
		};
		return '';
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};


export const getLocationByUser = async (
	body: BodyDefinition,
	query: QueryDefinition,
): Promise<any> => {
	try {
		const { user } = body;
		const { clientId } = query;
		// let condition: any = {};

		// if (user.user_type === userTypes.employee) {
		// 	condition = { created_by: { $in: [user._id, user.owner_id] }, is_active: true };
		// } else {
		// 	condition = { created_by: user._id, is_active: true };
		// }

		let condition: any = { created_by: user._id, is_active: true };


		if (user.user_type === userTypes.agency && clientId) {
			if (!isValidMongoObjectId(clientId)) {
				throw new ApiError(
					httpStatus.BAD_REQUEST,
					'Invalid cilient id provided',
				);
			}
			const clientDoc = await Client.findOne({
				created_by: user._id,
				_id: clientId,
				is_active: true,
			});
			if (!clientDoc) {
				throw new ApiError(
					httpStatus.BAD_REQUEST,
					'No client found with this clinet id',
				);
			}
			condition['client_id'] = clientId;
		};

		const locationDocs = await mongoFunctions({
			schema: Location,
			condition: condition,
			operationType: mongoOperationsTypes.FIND,
			selectedFields: locationSelect,
		});

		if (!locationDocs) {
			throw new ApiError(
				httpStatus.INTERNAL_SERVER_ERROR,
				'Failed to fetch locations',
			);
		}
		for (let locationDoc of locationDocs) {
			const userGBPDoc = await UserGBP.findOne({ location_id: locationDoc._id, is_active: true }).select({ gbpAccountId: 1, gbpLocationId: 1, title: 1 })
			const userDoc = {
				_id: user._id,
				email: user.email,
				is_analytics_connected: user.is_analytics_connected,
				is_gbp_connected: user.is_gbp_connected
			}
			locationDoc.gbp_account = userGBPDoc || null
			locationDoc.user_details = userDoc || null
		}
		return locationDocs;
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

export const getLocationDetails = async (
	body: BodyDefinition,
	params: ParamsDefinition,
): Promise<any> => {
	try {
		const { locationId } = params;

		if (!locationId || !isValidMongoObjectId(locationId)) {
			throw new ApiError(
				httpStatus.BAD_REQUEST,
				'Invalid location id provided',
			);
		}

		const locationDocs = await Location.aggregate([
			{
				$match: { _id: new mongoose.Types.ObjectId(`${locationId}`) }
			},
			{
				$lookup: {
					from: 'whitelabel_profiles',
					localField: '_id',
					foreignField: 'location_id',
					as: 'location_whitelabel'
				}
			},
			{
				$unwind: {
					path: '$location_whitelabel',
					preserveNullAndEmptyArrays: true,
				}
			}
		])
		if (!locationDocs) {
			throw new ApiError(
				httpStatus.INTERNAL_SERVER_ERROR,
				'Failed to fetch locations',
			);
		}
		return locationDocs;
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

export const updateLocation = async (
	body: Partial<BodyDefinition>
): Promise<any> => {
	try {
		const {
			name,
			address,
			country,
			state,
			city,
			zip_code,
			mobile,
			website_URL,
			business_category,
			client_id,
			user,
			location_id
		} = body;
		if (!location_id || !isValidMongoObjectId(location_id)) {
			throw new ApiError(
				httpStatus.NOT_FOUND,
				"Please provide a valid location_id"
			);
		}
		const locationDoc = await Location.findOne({ _id: location_id, is_active: true, created_by: user._id })
		if (!locationDoc) {
			throw new ApiError(httpStatus.NOT_FOUND, 'Location not found');
		}

		const updateObj: any = {
			updated_at: new Date(),
		};

		if (name !== undefined) updateObj.name = name;
		if (address !== undefined) updateObj.address = address;
		if (country !== undefined) updateObj.country = country;
		if (state !== undefined) updateObj.state = state;
		if (city !== undefined) updateObj.city = city;
		if (zip_code !== undefined) updateObj.zip_code = zip_code;
		if (mobile !== undefined) updateObj.mobile = mobile;
		if (website_URL !== undefined) updateObj.website_URL = website_URL;
		if (business_category !== undefined) updateObj.business_category = business_category;
		if (client_id !== undefined) {
			const currentClientId = locationDoc?.client_id?.toString();
			const newClientId = client_id.toString();

			if (currentClientId !== newClientId) {
				const newClientDoc = await Client.findOne({
					_id: client_id,
					created_by: user._id,
					is_active: true,
				});

				if (!newClientDoc) {
					throw new ApiError(httpStatus.NOT_FOUND, "Client Not Found");
				}

				newClientDoc.no_of_locations = (newClientDoc.no_of_locations || 0) + 1;
				await newClientDoc.save();

				if (currentClientId) {
					const oldClientDoc = await Client.findOne({
						_id: currentClientId,
						created_by: user._id,
						is_active: true,
					});

					if (oldClientDoc && (oldClientDoc.no_of_locations || 0) > 0) {
						oldClientDoc.no_of_locations -= 1;
						await oldClientDoc.save();
					}
				}
				updateObj.client_id = client_id;
			}
		}

		await mongoFunctions({
			schema: Location,
			condition: { _id: location_id, created_by: user._id, is_active: true },
			updateData: updateObj,
			operationType: mongoOperationsTypes.UPDATE_ONE,
		});

		if (!locationDoc) {
			throw new ApiError(httpStatus.NOT_FOUND, 'Update failed');
		}

		return locationDoc;
	} catch (error) {
		throw new ApiError(
			error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
			error.message
		);
	}
};

export const deleteLocation = async (
	body: Partial<BodyDefinition>,
	params: ParamsDefinition
): Promise<any> => {
	try {
		const { user } = body;
		const { locationId } = params;

		if (!locationId || !isValidMongoObjectId(locationId)) {
			throw new ApiError(
				httpStatus.NOT_FOUND,
				"Please provide a valid locationId"
			);
		}

		const locationDoc = await mongoFunctions({
			schema: Location,
			condition: { _id: locationId, created_by: user._id, is_active: true },
			operationType: mongoOperationsTypes.FIND_ONE,
		});

		if (!locationDoc) {
			throw new ApiError(httpStatus.NOT_FOUND, 'Location not found');
		}

		// White Label Profile
		const whiteLabelProfileDocs: IWhitelabelProfile[] = await WhitelabelProfile.find({ location_id: locationId, is_active: true })
		if (whiteLabelProfileDocs) {
			for (let whiteLabelProfile of whiteLabelProfileDocs) {
				const fileName = whiteLabelProfile?.file_name;
				await WhitelabelProfile.deleteOne({ _id: whiteLabelProfile._id })
				try {
					if (fileName) {
						const filePath = path.join(__dirname, '../../../public/uploads/images', fileName);
						// await fs.access(filePath);
						await fs.unlink(filePath);
					}
				} catch (fileErr) {
					console.error(`Error deleting file: ${fileName}`, fileErr.message);
				}

			}
		}

		// Legacy report collections (rank_tracker_reports, local_search_grid_reports, gbp_audit_reports,
		// local_map_ranking_reports) are no longer written; see docs/MIGRATION.md. Rank runs are history
		// and are kept (CLAUDE.md §9.2).

		// GBP Posts
		const gbpPostDocs = await GBPPost.find({ location_id: locationId, is_active: true })
		if (gbpPostDocs) {
			for (let gbpPost of gbpPostDocs) {
				await GBPPost.deleteOne({ _id: gbpPost._id })
			}
		}

		// User GBP Location Bind Details
		const userGbpBindDocs = await UserGBP.find({ location_id: locationId, is_active: true })
		if (userGbpBindDocs) {
			for (let userGbpBind of userGbpBindDocs) {
				await UserGBP.deleteOne({ _id: userGbpBind._id })
			}
		}
		await Location.deleteOne({ _id: locationId })

		const userProfileDoc = await Profile.findOne({
			user_id: user._id,
			is_active: true,
		});
		if (userProfileDoc) {
			await mongoFunctions({
				schema: Profile,
				condition: { user_id: user._id, is_active: true },
				updateData: {
					no_of_locations:
						userProfileDoc?.no_of_locations - 1 > 0
							? userProfileDoc?.no_of_locations - 1
							: 0,
				},
				operationType: mongoOperationsTypes.UPDATE_ONE,
			});
		}
		return '';
	} catch (error) {
		throw new ApiError(
			error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
			error.message
		);
	}
};
