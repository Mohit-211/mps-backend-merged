import httpStatus from 'http-status';

import { responseWrapper, ApiError, catchAsync } from '../../utils';
import config from '../../configs/config';
import { Role } from '../../models';
import { userTypes } from '../../configs/constantTypes';

export const isSuperAdmin = catchAsync(async (req, res, next) => {
	try {
		const { user } = req.body;

		if (user.role_id === config.roles.superAdmin) {
			next();
		} else {
			return responseWrapper(
				res,
				'',
				'You are not authorized to do this action',
				httpStatus.UNAUTHORIZED,
			);
		}
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
});

export const isAdmin = catchAsync(async (req, res, next) => {
	try {
		const { user } = req.body;
		const roleDoc = await Role.findById(user.role_id);
		if (
			roleDoc &&
			(roleDoc.role_id === config.roles.superAdmin ||
				roleDoc.role_id === config.roles.admin)
		) {
			next();
		} else {
			return responseWrapper(
				res,
				'',
				'You are not authorized to access this api',
				httpStatus.UNAUTHORIZED,
			);
		}
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
});

export const isEditor = catchAsync(async (req, res, next) => {
	try {
		const { user } = req.body;
		const roleDoc = await Role.findById(user.role_id);
		if (
			roleDoc &&
			(roleDoc.role_id === config.roles.superAdmin ||
				roleDoc.role_id === config.roles.admin ||
				roleDoc.role_id === config.roles.editor)
		) {
			next();
		} else {
			return responseWrapper(
				res,
				'',
				'You are not authorized to access this api',
				httpStatus.UNAUTHORIZED,
			);
		}
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
});

export const isUser = catchAsync(async (req, res, next) => {
	try {
		const { user } = req.body;
		const roleDoc = await Role.findById(user.role_id);
		if (
			roleDoc &&
			(roleDoc.role_id === config.roles.superAdmin ||
				roleDoc.role_id === config.roles.admin ||
				roleDoc.role_id === config.roles.editor ||
				roleDoc.role_id === config.roles.user)
		) {
			next();
		} else {
			return responseWrapper(
				res,
				'',
				'You are not authorized to access this api',
				httpStatus.UNAUTHORIZED,
			);
		}
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
});

export const isAgency= catchAsync(async (req, res, next) => {
	try {
		const { user } = req.body;
		if (
			user && user.user_type === userTypes.agency
		) {
			next();
		} else {
			return responseWrapper(
				res,
				'',
				'Only Agencies can access this',
				httpStatus.UNAUTHORIZED,
			);
		}
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
});
