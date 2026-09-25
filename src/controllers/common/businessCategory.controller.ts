import httpStatus from 'http-status';
import { responseWrapper, catchAsync, pick } from '../../utils';
import { businessCategoryService } from '../../services';

export const createBusinessCategory = catchAsync(async (req, res) => {
	const body = pick(req.body, ['name', 'slug', 'user'])
	const result = await businessCategoryService.createBusinessCategory(body);
	return responseWrapper(
		res,
		result,
		'New Business Category Created Successfully.',
		httpStatus.CREATED,
	);
});

export const getAllBusinessCategory = catchAsync(async (req, res) => {
	const result = await businessCategoryService.getAllBusinessCategory(req.query);
	return responseWrapper(
		res,
		result,
	);
});

export const updateBusinessCategory = catchAsync(async (req, res) => {
    const body = pick(req.body, ['name', 'slug', 'user']);
    const param = pick(req.params, ['businessCategoryId'])
	const result = await businessCategoryService.updateBusinessCategory(body, param);
	return responseWrapper(
		res,
		result,
	);
});