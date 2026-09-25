import httpStatus from 'http-status';
import { responseWrapper, catchAsync, pick } from '../../utils';
import { faqService } from '../../services';

export const createFaq = catchAsync(async (req, res) => {
	const body = pick(req.body, ['question', 'answer'])
	const result = await faqService.createFaq(body);
	return responseWrapper(
		res,
		result,
		'New Faq Created Successfully.',
		httpStatus.CREATED,
	);
});

export const updateFaq = catchAsync(async (req, res) => {
	const params = pick(req.params, ['faqId']);
	const result = await faqService.updateFaq(req.body, params);
	return responseWrapper(
		res,
		result,
		'Faq Updated Successfully',
		httpStatus.OK,
	);
});

export const getAllFaq = catchAsync(async (req, res) => {
	const roles = await faqService.getAllFaq(req.query);
	return responseWrapper(res, roles);
});

export const deleteFaq = catchAsync(async (req, res) => {
	const params = pick(req.params, ['faqId']);
	await faqService.deleteFaq(params);
	return responseWrapper(res, '', 'Delete Successfull.');
});
