/* eslint-disable @typescript-eslint/no-explicit-any */
import { Document, Model } from 'mongoose';
import httpStatus from 'http-status';
import ApiError from './apiError';

type MongoOperationType =
	| 'find'
	| 'findOne'
	| 'updateOne'
	| 'updateMany'
	| 'deleteOne'
	| 'deleteMany'
	| 'create'
	| 'insertMany'
	| 'findOneAndUpdate'
	| 'findOneAndDelete';

interface MongoOperationOptions {
	schema: Model<Document>;
	condition?: Record<string, any>;
	updateData?: Record<string, any>;
	createData?: Record<string, any> | Record<string, any>[];
	operationType: string | MongoOperationType;
	selectedFields?: string;
}

const mongoFunctions = async ({
	schema,
	condition,
	updateData,
	createData,
	operationType,
	selectedFields
}: MongoOperationOptions): Promise<any> => {
	try {
		let result: any;
		if (!selectedFields) selectedFields = '';

		switch (operationType) {
			case 'find':
				result = await schema.find(condition).select(selectedFields).lean();
				if (!result) {
					throw new ApiError(httpStatus.NOT_FOUND, 'No documents found matching the condition');
				}
				break;

			case 'findOne':
				result = await schema.findOne(condition).select(selectedFields);
				break;

			case 'updateOne':
				if (!updateData) {
					throw new ApiError(httpStatus.BAD_REQUEST, 'Update data is required for update operation');
				}
				result = await schema.updateOne(condition, { $set: updateData });
				// if (result.modifiedCount === 0) {
				// 	throw new ApiError(httpStatus.NOT_FOUND, 'No document found to update');
				// }
				break;

			case 'updateMany':
				if (!updateData) {
					throw new ApiError(httpStatus.BAD_REQUEST, 'Update data is required for update operation');
				}
				result = await schema.updateMany(condition, { $set: updateData });
				// if (result.modifiedCount === 0) {
				// 	throw new ApiError(httpStatus.NOT_FOUND, 'No documents found to update');
				// }
				break;

			case 'deleteOne':
				result = await schema.deleteOne(condition);
				if (result.deletedCount === 0) {
					throw new ApiError(httpStatus.NOT_FOUND, 'No document found to delete');
				}
				break;

			case 'deleteMany':
				result = await schema.deleteMany(condition);
				if (result.deletedCount === 0) {
					throw new ApiError(httpStatus.NOT_FOUND, 'No documents found to delete');
				}
				break;

			case 'create':
				if (!createData) {
					throw new ApiError(httpStatus.BAD_REQUEST, 'Create data is required for create operation');
				}
				result = await schema.create(createData);
				if (!result) {
					throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to create document');
				}
				break;

			case 'insertMany':
				if (!Array.isArray(createData) || createData.length === 0) {
					throw new ApiError(httpStatus.BAD_REQUEST, 'Create data must be a non-empty array for insertMany operation');
				}
				result = await schema.insertMany(createData);
				if (!result || result.length === 0) {
					throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to insert documents');
				}
				break;

			case 'findOneAndUpdate':
				if (!updateData) {
					throw new ApiError(httpStatus.BAD_REQUEST, 'Update data is required for findOneAndUpdate operation');
				}
				result = await schema.findOneAndUpdate(condition, { $set: updateData }, { new: true });
				if (!result) {
					throw new ApiError(httpStatus.NOT_FOUND, 'No document found to update');
				}
				break;

			case 'findOneAndDelete':
				result = await schema.findOneAndDelete(condition);
				if (!result) {
					throw new ApiError(httpStatus.NOT_FOUND, 'No document found to delete');
				}
				break;

			default:
				throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid operation type');
		}

		return result;
	} catch (error: any) {
		throw new ApiError(
			error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
			error.message || 'An error occurred during the MongoDB operation'
		);
	}
};

export default mongoFunctions;