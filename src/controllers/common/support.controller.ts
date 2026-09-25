import httpStatus from 'http-status';
import { responseWrapper, catchAsync, pick } from '../../utils';
import { supportService } from '../../services';

export const createSupport = catchAsync(async (req, res) => {
	const body = pick(req.body, ['name', 'email', 'address', 'mobile', 'subject', 'message', 'user'])
	const result = await supportService.createSupport(body);
	return responseWrapper(
		res,
		result,
		'New Support Request Created Successfully.',
		httpStatus.CREATED,
	);
});

export const getAllSupport = catchAsync(async (req, res) => {
	const body = pick(req.body, ['user'])
	const roles = await supportService.getAllSupport(body, req.query);
	return responseWrapper(res, roles);
});

export const deleteSupport = catchAsync(async (req, res) => {
	const body = pick(req.body, ['user'])
	const params = pick(req.params, ['supportId']);
	await supportService.deleteSupport(body, params);
	return responseWrapper(res, '', 'Delete Successfull.');
});

export const getAllSupportTicketsByAdmin = catchAsync(async (req, res) => {
	const roles = await supportService.getAllSupportTicketsByAdmin();
	return responseWrapper(res, roles);
});

export const updateSupportTicketStatus = catchAsync(async (req, res) => {
	const result = await supportService.updateSupportTicketStatus(req.body);
	return responseWrapper(
		res,
		result,
		'New Support Request Created Successfully.',
		httpStatus.CREATED,
	);
});

export const getSupportTicketStatusCounts = catchAsync(async (req, res) => {
	const roles = await supportService.getSupportTicketStatusCounts();
	return responseWrapper(res, roles);
});
