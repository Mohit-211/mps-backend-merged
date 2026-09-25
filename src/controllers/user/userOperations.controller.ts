import httpStatus from "http-status";
import { IUser } from "../../models";
import { userOperationService } from "../../services";
import { catchAsync, pick, responseWrapper } from "../../utils";

export const getProfile = catchAsync(async (req, res) => {
  const body = pick(req.body, ["user"]);
  const response = await userOperationService.getProfile(body);
  return responseWrapper(res, response);
});

export const notificationToogle = catchAsync(async (req, res) => {
  const body = pick(req.body, ["user", "type"]);
  const result: IUser = await userOperationService.notificationToogle(body);
  const message =
    result.notification_status === true
      ? "Notification turned On!"
      : "Notification turned Off!";
  return responseWrapper(res, "", message);
});

export const updateProfile = catchAsync(async (req, res) => {
  const body = pick(req.body, [
    "user",
    "name",
    "email",
    "mobile",
    "country_id",
    "city_id",
    "state_id",
    "country_name",
    "city_name",
    "state_name",
    "business_address",
    "business_name",
    "website_url",
    "zip_code",
  ]);
  const response = await userOperationService.updateProfile(body);
  return responseWrapper(res, response, "Profile updated successfully");
});

export const createClient = catchAsync(async (req, res) => {
  const body = pick(req.body, [
    "company_name",
    "company_URL",
    "unique_id",
    "user",
  ]);
  const response = await userOperationService.createClient(body);
  return responseWrapper(
    res,
    response,
    "New Client Created Successfully.",
    httpStatus.CREATED
  );
});

export const getAllClient = catchAsync(async (req, res) => {
  const body = pick(req.body, ["user"]);
  const response = await userOperationService.getAllClient(body);
  return responseWrapper(res, response);
});

export const updateClient = catchAsync(async (req, res) => {
  const body = pick(req.body, [
    "company_name",
    "company_URL",
    "unique_id",
    "user",
    "client_id",
  ]);
  const response = await userOperationService.updateClient(body);
  return responseWrapper(res, response);
});

export const deleteClient = catchAsync(async (req, res) => {
  const body = pick(req.body, ["user"]);
  const params = pick(req.params, ["client_id"]);
  const response = await userOperationService.deleteClient(body, params);
  return responseWrapper(res, response);
});

export const getClientDetails = catchAsync(async (req, res) => {
  const body = pick(req.body, ["user"]);
  const params = pick(req.params, ["client_id"]);
  const response = await userOperationService.getClientDetails(body, params);
  return responseWrapper(res, response);
});
