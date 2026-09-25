import { responseWrapper, pick, catchAsync } from '../../utils';
import {countryService} from '../../services';


export const getAllCountry = catchAsync(async (req, res) => {
  const result = await countryService.getAllCountry(req.query);
  return responseWrapper(res, result);
});

export const getAllStateByCountryId = catchAsync(async (req, res) => {
  const params = pick(req.params, ['countryId']);
  const result = await countryService.getAllStateByCountryId(params);
  return responseWrapper(res, result);
});

export const getAllCityByStateId = catchAsync(async (req, res) => {
  const params = pick(req.params, ['stateId']);
  const result = await countryService.getAllCityByStateId(params);
  return responseWrapper(res, result);
});
