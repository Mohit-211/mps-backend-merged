import httpStatus from 'http-status';
import { responseWrapper, catchAsync, pick } from '../../utils';
import { blogService } from '../../services';

export const createBlog = catchAsync(async (req, res) => {
	const result = await blogService.createBlog(req.body,req.files);

	return responseWrapper(
		res,
		result,
		'Blog created successfully.',
		httpStatus.CREATED,
	);
});

export const getAllBlogs = catchAsync(async (req, res) => {
	const query = pick(req.query, [
		'page',
		'limit',
		'search',
		'category_id',
	]);

	const result = await blogService.getAllBlogs(query);

	return responseWrapper(
		res,
		result,
		'Blogs fetched successfully.',
		httpStatus.OK,
	);
});

export const getBlogById = catchAsync(async (req, res) => {
	const params = pick(req.params, ['blogId']);

	const result = await blogService.getBlogById(
		params.blogId,
	);

	return responseWrapper(
		res,
		result,
		'Blog fetched successfully.',
		httpStatus.OK,
	);
});

export const getBlogBySlug = catchAsync(async (req, res) => {
	const params = pick(req.params, ['slug']);

	const result = await blogService.getBlogBySlug(
		params.slug,
	);

	return responseWrapper(
		res,
		result,
		'Blog fetched successfully.',
		httpStatus.OK,
	);
});

export const updateBlog = catchAsync(async (req, res) => {
	const params = pick(req.params, ['blogId']);

	const result = await blogService.updateBlog(
		params.blogId,
		req.body,
		req.files,
	);

	return responseWrapper(
		res,
		result,
		'Blog updated successfully.',
		httpStatus.OK,
	);
});

export const deleteBlog = catchAsync(async (req, res) => {
	const params = pick(req.params, ['blogId']);

	await blogService.deleteBlog(params.blogId);

	return responseWrapper(
		res,
		null,
		'Blog deleted successfully.',
		httpStatus.OK,
	);
});