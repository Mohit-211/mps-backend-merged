import httpStatus from 'http-status';
import { City, Country, State } from '../../models';
import { ApiError, isValidMongoObjectId, mongoFunctions } from '../../utils';
import { ParamsDefinition, QueryDefinition } from '../../types/RouteDefinition';
import { citySelect, stateSelect } from '../../constants';
import { mongoOperationsTypes } from '../../configs/constantTypes';

export const getAllCountry = async (query: QueryDefinition) => {
	try {
		const { limit, offset } = query;
		let result = [];
		result = await Country.getAll(limit, offset);

		if (!result) {
			throw new ApiError(
				httpStatus.BAD_REQUEST,
				'Failed to fetch all countries.',
			);
		}

		return result;
	} catch (error) {
		throw new ApiError(
			error.statusCode ?? httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

export const getAllStateByCountryId = async (params: ParamsDefinition) => {
	try {
		const { countryId } = params;
		if (!isValidMongoObjectId(countryId)) {
			throw new ApiError(
				httpStatus.BAD_REQUEST,
				'Invalid countryId provided: Need a valid mongo Object Id',
			);
		};
		let result = {};
		result = await mongoFunctions({
			schema: State,
			operationType: mongoOperationsTypes.FIND,
			condition: {
				country_id: countryId,
				is_active: true,
			},
			selectedFields: stateSelect,
		});

		if (!result) {
			throw new ApiError(
				httpStatus.BAD_REQUEST,
				'Failed to fetch country by ID.',
			);
		}
		return result;
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

export const getAllCityByStateId = async (params: ParamsDefinition) => {
	try {
		const { stateId } = params;
		if (!isValidMongoObjectId(stateId)) {
			throw new ApiError(
				httpStatus.BAD_REQUEST,
				'Invalid countryId provided: Need a valid mongo Object Id',
			);
		}
		let result = {};
		
		result = await mongoFunctions({
			schema: City,
			operationType: mongoOperationsTypes.FIND,
			condition: {
				state_id: stateId,
				is_active: true,
			},
			selectedFields: citySelect,
		});

		if (!result) {
			throw new ApiError(
				httpStatus.BAD_REQUEST,
				'Failed to fetch country by ID.',
			);
		}
		return result;
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};