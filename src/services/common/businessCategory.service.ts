/* eslint-disable @typescript-eslint/no-explicit-any */
import httpStatus from 'http-status';
import { BusinessCategory } from '../../models';
import { ApiError, mongoFunctions } from '../../utils';
import { mongoOperationsTypes } from '../../configs/constantTypes';
import { BodyDefinition, ParamsDefinition, QueryDefinition } from '../../types/RouteDefinition';
import { businessCategorySelect } from '../../constants';


export const createBusinessCategory = async (body: BodyDefinition): Promise<any> => {
	try {
		const {
			name,
            slug,
			user,
		} = body;
		const businessCategoryObj = {
			name,
            slug,
		};

		const businessCategoryDoc = await mongoFunctions({
			schema: BusinessCategory,
			createData: businessCategoryObj,
			operationType: mongoOperationsTypes.CREATE,
		});
		if (!businessCategoryDoc) {
			throw new ApiError(
				httpStatus.INTERNAL_SERVER_ERROR,
				'Failed to create new BusinessCategory',
			);
		}
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

export const getAllBusinessCategory = async (query: QueryDefinition): Promise<any> => {
	try {
		const { limit, offset, name } = query;
		let condition = {is_active: true};
		if(name){
			condition['name'] = { $regex: name, $options: 'i' };
		};
		const businessCategoryDocs = await BusinessCategory.find(condition)
		.select(businessCategorySelect)
		.limit(limit)
		.skip(offset)
		.sort({ name: 1 });
		if (!businessCategoryDocs) {
			throw new ApiError(
				httpStatus.INTERNAL_SERVER_ERROR,
				'Failed to fetch businessCategorys',
			);
		}
		return businessCategoryDocs;
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

export const updateBusinessCategory = async (body: BodyDefinition, param: ParamsDefinition): Promise<any> => {
	try {
        const { businessCategoryId } = param;
		const {
			name,
            slug,
		} = body;
		const businessCategoryObj = {
			name,
            slug,
		};

		const businessCategoryDoc = await BusinessCategory.updateById(businessCategoryId, businessCategoryObj);
		if (!businessCategoryDoc) {
			throw new ApiError(
				httpStatus.INTERNAL_SERVER_ERROR,
				'Failed to create new BusinessCategory',
			);
		}
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