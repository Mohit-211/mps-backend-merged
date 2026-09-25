import httpStatus from "http-status";
import { adminOperationsService } from "../../services";
import { catchAsync, pick, responseWrapper, validatePassword } from "../../utils";


export const getAllAgencies = catchAsync(async (req, res) => {
  const result = await adminOperationsService.getAllAgencies();
  return responseWrapper(res, result, "All Agencies fetched successfully.", httpStatus.OK);
});

export const getAgencyById = catchAsync(async (req, res) => {
  const params = pick(req.params, ['id']);
  const result = await adminOperationsService.getAgencyById(params);
  return responseWrapper(res, result);
});

export const updateAgencyStatus = catchAsync(async (req, res) => {
    const params = pick(req.body, ["id", "status"]) as { id: string; status: string };
  const result = await adminOperationsService.updateAgencyStatus(params);
  return responseWrapper(res, result, "Agency status updated successfully");
});


export const getAllBusinesses = catchAsync(async (req, res) => {
  const result = await adminOperationsService.getAllBusinesses();
  return responseWrapper(res, result, "All Businesses fetched successfully.", httpStatus.OK);
});

export const getBusinessesById = catchAsync(async (req, res) => {
  const params = pick(req.params, ['id']);
  const result = await adminOperationsService.getBusinessesById(params);
  return responseWrapper(res, result);
});

export const getAllClients = catchAsync(async (req, res) => {
  const result = await adminOperationsService.getAllClients();
  return responseWrapper(res, result);
});
