import httpStatus from 'http-status';
import { responseWrapper, catchAsync, pick } from '../../utils';
import { blogCategoryService } from '../../services';

export const createBlogCategory = catchAsync(async (req, res) => {
	const result = await blogCategoryService.createBlogCategory(
		req.body,
	);

	return responseWrapper(
		res,
		result,
		'Blog category created successfully.',
		httpStatus.CREATED,
	);
});

export const getAllBlogCategories = catchAsync(async (req, res) => {
	const query = pick(req.query, [
		'page',
		'limit',
		'search',
	]);

	const result =
		await blogCategoryService.getAllBlogCategories(query);

	return responseWrapper(
		res,
		result,
		'Blog categories fetched successfully.',
		httpStatus.OK,
	);
});

export const getBlogCategoryById = catchAsync(async (req, res) => {
	const params = pick(req.params, ['categoryId']);

	const result =
		await blogCategoryService.getBlogCategoryById(
			params.categoryId,
		);

	return responseWrapper(
		res,
		result,
		'Blog category fetched successfully.',
		httpStatus.OK,
	);
});

export const updateBlogCategory = catchAsync(async (req, res) => {
	const params = pick(req.params, ['categoryId']);

	const result =
		await blogCategoryService.updateBlogCategory(
			params.categoryId,
			req.body,
		);

	return responseWrapper(
		res,
		result,
		'Blog category updated successfully.',
		httpStatus.OK,
	);
});

export const deleteBlogCategory = catchAsync(async (req, res) => {
	const params = pick(req.params, ['categoryId']);

	await blogCategoryService.deleteBlogCategory(
		params.categoryId,
	);

	return responseWrapper(
		res,
		null,
		'Blog category deleted successfully.',
		httpStatus.OK,
	);
});