import httpStatus from 'http-status';
import { responseWrapper, catchAsync, pick } from '../../utils';
import { contactUsService } from '../../services';

export const createContactUs = catchAsync(async (req, res) => {
	const result = await contactUsService.createContactUs(req.body);

	return responseWrapper(
		res,
		result,
		'Your inquiry has been submitted successfully.',
		httpStatus.CREATED,
	);
});

export const getAllContactUs = catchAsync(async (req, res) => {
  const query = pick(req.query, [
    'page',
    'limit',
    'search',
    'status',
  ]);

  const result = await contactUsService.getAllContactUs(query);

  return responseWrapper(
    res,
    result,
    'Contact requests fetched successfully.',
    httpStatus.OK,
  );
});

export const getContactUsById = catchAsync(async (req, res) => {
	const params = pick(req.params, ['contactId']);

	const result = await contactUsService.getContactUsById(
		params.contactId,
	);

	return responseWrapper(
		res,
		result,
		'Contact request fetched successfully.',
		httpStatus.OK,
	);
});

export const updateContactUsStatus = catchAsync(async (req, res) => {
	const params = pick(req.params, ['contactId']);
	const body = pick(req.body, ['status']);

	const result = await contactUsService.updateContactUsStatus(
		params.contactId,
		body,
	);

	return responseWrapper(
		res,
		result,
		'Contact request status updated successfully.',
		httpStatus.OK,
	);
});

export const deleteContactUs = catchAsync(async (req, res) => {
	const params = pick(req.params, ['contactId']);

	await contactUsService.deleteContactUs(params.contactId);

	return responseWrapper(
		res,
		null,
		'Contact request deleted successfully.',
		httpStatus.OK,
	);
});
