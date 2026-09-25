import httpStatus from 'http-status';
import { Role, IRole } from '../../models';
import { ApiError, mongoFunctions } from '../../utils';
import {
	BodyDefinition,
	ParamsDefinition,
	QueryDefinition,
} from '../../types/RouteDefinition';
import { mongoOperationsTypes } from '../../configs/constantTypes';

export const createRole = async (body: BodyDefinition) => {
	try {
		const roleObj = {
			name: body?.name,
			abbreviation: body?.abbreviation,
			role_id: body?.role_id,
		};

		const roleDoc = await mongoFunctions({
			schema: Role,
			createData: roleObj,
			operationType: mongoOperationsTypes.CREATE
		});;
		if (!roleDoc) {
			throw new ApiError(
				httpStatus.INTERNAL_SERVER_ERROR,
				'Failed to create new Role',
			);
		}
		return '';
	} catch (error) {
		throw new ApiError(
			error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

export const updateRole = async (body: BodyDefinition, params: ParamsDefinition) => {
	try {
		const { roleId } = params;
		await Role.updateById(roleId, body);
		return '';
	} catch (error) {
		throw new ApiError(
			error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

export const findRoleById = async (params: ParamsDefinition): Promise<IRole | null> => {
	try {
		const { roleId } = params;
		const roleDoc: IRole | null = await Role.getById(roleId);
		return roleDoc;
	} catch (error) {
		throw new ApiError(
			error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

export const getAllRoles = async (query: QueryDefinition): Promise<IRole[]> => {
	try {
		const { limit, offset } = query;
		const roleDocs: IRole[] = await Role.getAll(limit, offset)
		if (!roleDocs.length) {
			throw new ApiError(
				httpStatus.INTERNAL_SERVER_ERROR,
				'Failed to retrieve roles.',
			);
		}
		return roleDocs;
	} catch (error) {
		throw new ApiError(
			error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

export const deleteRole = async (params: ParamsDefinition): Promise<void> => {
	try {
		const { roleId } = params;
		await Role.deleteById(roleId);
	} catch (error) {
		throw new ApiError(
			error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};
