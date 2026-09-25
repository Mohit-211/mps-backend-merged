import httpStatus from 'http-status';
import { responseWrapper, catchAsync, pick } from '../../utils';
import { roleService } from '../../services';

export const createRole = catchAsync(async (req, res) => {
	const body = pick(req.body, ['name', 'abbreviation', 'role_id'])
	const result = await roleService.createRole(body);
	return responseWrapper(
		res,
		result,
		'New Role Created Successfully.',
		httpStatus.CREATED,
	);
});

export const updateRole = catchAsync(async (req, res) => {
	const params = pick(req.params, ['roleId']);
	const result = await roleService.updateRole(req.body, params);
	return responseWrapper(
		res,
		result,
		'Role Updated Successfully',
		httpStatus.OK,
	);
});

export const getAllRoles = catchAsync(async (req, res) => {
	const roles = await roleService.getAllRoles(req.query);
	return responseWrapper(res, roles);
});

export const findRoleById = catchAsync(async (req, res) => {
	const params = pick(req.params, ['roleId']);
	const result = await roleService.findRoleById(params);
	return responseWrapper(res, result);
});

export const deleteRole = catchAsync(async (req, res) => {
	const params = pick(req.params, ['roleId']);
	await roleService.deleteRole(params);
	return responseWrapper(res, '', 'Delete Successfull.');
});