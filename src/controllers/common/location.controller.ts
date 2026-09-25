import httpStatus from 'http-status';
import { responseWrapper, catchAsync, pick } from '../../utils';
import { locationService } from '../../services';
import axios from 'axios';
import config from '../../configs/config';

export const createLocation = catchAsync(async (req, res) => {
	const body = pick(req.body, ['name', 'address', 'country', 'state', 'city', 'zip_code', 'mobile', 'website_URL', 'business_category', 'client_id', 'user', 'place_id'])
	const result = await locationService.createLocation(body);
	return responseWrapper(
		res,
		result,
		'New Location Created Successfully.',
		httpStatus.CREATED,
	);
});

export const updateLocation = catchAsync(async (req, res) => {
	const body = pick(req.body, ['name', 'address', 'country', 'state', 'city', 'zip_code', 'mobile', 'website_URL', 'business_category', 'client_id', 'user', 'location_id'])
	const result = await locationService.updateLocation(body);
	return responseWrapper(
		res,
		result,
		'Location Updated Successfully.',
		httpStatus.OK,
	);
});

export const deleteLocation = catchAsync(async (req, res) => {
	const body = pick(req.body, ['user']);
	const params = pick(req.params, ['locationId']);
	const result = await locationService.deleteLocation(body, params);
	return responseWrapper(
		res,
		result,
		'Location Delated Successfully.'
	);
});

export const getLocationByUser = catchAsync(async (req, res) => {
	const body = pick(req.body, ['user']);
	const query = pick(req.query, ['clientId']);
	const result = await locationService.getLocationByUser(body, query);
	return responseWrapper(
		res,
		result,
	);
});

export const getLocationDetails = catchAsync(async (req, res) => {
	const body = pick(req.body, ['user']);
	const params = pick(req.params, ['locationId']);
	const result = await locationService.getLocationDetails(body, params);
	return responseWrapper(
		res,
		result,
	);
});
export const getGoogleLocations = catchAsync(async (req, res) => {
	const params = pick(req.params, ['name']);
	if(!params){
		return responseWrapper(
			res,
			'',
			'Please provide business name',
			httpStatus.BAD_REQUEST
		);
	}
	const result = await fetchList(params.name);
	if(!result){
		return responseWrapper(
			res,
			'',
			'Failed to fetch google location.',
			httpStatus.BAD_REQUEST
		);
	}

	return responseWrapper(
		res,
		result,
	);
});

const fetchList = async (name: string) => {
	try {
	  const response = await axios.get(`https://maps.googleapis.com/maps/api/place/textsearch/json?query=${name}&key=${config.googleApis.placeApi.keySecret}`);
	  return response.data.results;
	} catch (error) {
		return null;
	}
};


  export const getGoogleLocationDetails = catchAsync(async (req, res) => {
	const params = pick(req.params, ['placeId']);
	if(!params){
		return responseWrapper(
			res,
			'',
			'Please provide Place Id',
			httpStatus.BAD_REQUEST
		);
	}
	const result = await fetchDetails(params.placeId);
	if(!result){
		return responseWrapper(
			res,
			'',
			'Failed to fetch google location Details.',
			httpStatus.BAD_REQUEST
		);
	}

	return responseWrapper(
		res,
		result,
	);
});

const fetchDetails = async (placeId: string) => {
	try {
	  const response = await axios.get(`https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&key=${config.googleApis.placeApi.keySecret}`);
	  return response.data.result;
	} catch (error) {
		return null;
	}
};