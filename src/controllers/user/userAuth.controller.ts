import httpStatus from "http-status";
import { userAuthService } from "../../services";
import {
  catchAsync,
  pick,
  responseWrapper,
  validatePassword,
} from "../../utils";

export const sendOTP = catchAsync(async (req, res) => {
  const body = pick(req.body, ["email", "type"]);
  const result = await userAuthService.sendOTP(body);
  return responseWrapper(res, result, "OTP has been Sent To Your Email");
});

export const verifyOTP = catchAsync(async (req, res) => {
  const body = pick(req.body, ["email", "type", "otp"]);
  const status = await userAuthService.verifyOTP(body);
  return responseWrapper(
    res,
    status,
    "OTP has been verified. Please Create Your Profile."
  );
});

export const register = catchAsync(async (req, res) => {
  const body = pick(req.body, [
    "user_type",
    "role_id",
    "name",
    "email",
    "mobile",
    "password",
    "confirm_password",
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
  const message = await userAuthService.register(body);
  return responseWrapper(res, "", message, httpStatus.CREATED);
});

export const login = catchAsync(async (req, res) => {
  const body = pick(req.body, ["email", "password", "ip_address"]);
  const header = pick(req.headers, ["time_zone", "fcm_token"]);
  const response = await userAuthService.login(body, header);
  return responseWrapper(res, response, "Successfully Logged in.");
});

export const resetPassword = catchAsync(async (req, res) => {
  const { new_password, confirm_password } = req.body;

  if (!validatePassword(new_password)) {
    return responseWrapper(
      res,
      "",
      "Password should have a minimum length of 8 characters and must have at least 2 digits and No Blank Space",
      httpStatus.BAD_REQUEST
    );
  }

  if (new_password !== confirm_password) {
    return responseWrapper(
      res,
      "",
      "Password and Confirm Password must be equal",
      httpStatus.BAD_REQUEST
    );
  }

  const response = await userAuthService.resetPassword(req.body);
  return responseWrapper(res, response, "Password changed Successfully.");
});

export const forgotPassword = catchAsync(async (req, res) => {
  const body = pick(req.body, [
    "user",
    "otpDoc",
    "email",
    "password",
    "confirm_password",
    "token",
  ]);
  const response = await userAuthService.forgotPassword(body);
  return responseWrapper(res, response, "Password changed Successfully.");
});

export const logout = catchAsync(async (req, res) => {
  const body = pick(req.body, ["refresh_token", "tokenDoc"]);
  const header = pick(req.headers, ["time_zone"]);
  const response = await userAuthService.logout(body, header);
  return responseWrapper(res, response, "Successfully Logged out.");
});

export const deactivateAccount = catchAsync(async (req, res) => {
  const body = pick(req.body, ["user"]);
  const response = await userAuthService.deactivateAccount(body);
  return responseWrapper(res, response, "Account Successfully Deactivated.");
});

export const refreshAuth = catchAsync(async (req, res) => {
  const body = pick(req.body, ["refresh_token", "tokenDoc", "user"]);
  const response = await userAuthService.refreshAuth(body);
  return responseWrapper(res, response);
});

export const getAnalyticsAuthUrl = catchAsync(async (req, res) => {
  const body = pick(req.body, ["user"]);
  const response = await userAuthService.getAnalyticsAuthUrl(body);
  return responseWrapper(res, response);
});

export const analyticsConnectionRevoke = catchAsync(async (req, res) => {
  const body = pick(req.body, ["user"]);
  let response = await userAuthService.analyticsConnectionRevoke(body);
  return responseWrapper(
    res,
    response,
    "Google Analytics disconnected successfully"
  );
});

export const analyticsAuthCallback = catchAsync(async (req, res) => {
  const query = pick(req.query, ["code", "state"]);
  const response = await userAuthService.analyticsAuthCallback(query);
  return responseWrapper(
    res,
    response,
    "Connected with analytics successfully."
  );
});

export const getGBPAuthUrl = catchAsync(async (req, res) => {
  const body = pick(req.body, ["user"]);
  const response = await userAuthService.getGBPAuthUrl(body);
  return responseWrapper(res, response);
});

export const gBPConnectionRevoke = catchAsync(async (req, res) => {
  const body = pick(req.body, ["user"]);
  let response = await userAuthService.gBPConnectionRevoke(body);
  return responseWrapper(
    res,
    response,
    "Google Business Manager disconnected successfully"
  );
});

export const gBPAuthCallback = catchAsync(async (req, res) => {
  const query = pick(req.query, ["code", "state"]);
  const response = await userAuthService.gBPAuthCallback(query);
  return responseWrapper(res, response, "Connected with GBP successfully.");
});

export const addEmployee = catchAsync(async (req, res) => {
  const body = pick(req.body, [
    "name",
    "email",
    "mobile",
    "password",
    "user"
  ]);
  const message = await userAuthService.addEmployee(body);
  return responseWrapper(res, "", message, httpStatus.CREATED);
});

export const deleteEmployee = catchAsync(async (req, res) => {
  const body = pick(req.body, [
    "employee_id",
    "user"
  ]);
  const message = await userAuthService.deleteEmployee(body);
  return responseWrapper(res, "", message, httpStatus.OK);
});

export const getAllEmployeeByOwner = catchAsync(async (req, res) => {
  const body = pick(req.body, [
    "user"
  ]);
  const result = await userAuthService.getAllEmployeeByOwner(body);
  return responseWrapper(res, result, '', httpStatus.OK);
});

export const employeeDetails = catchAsync(async (req, res) => {
  const body = pick(req.body, [
    "user"
  ]);
  const params = pick(req.params, [
    "employee_id"
  ]);
  const result = await userAuthService.employeeDetails(body, params);
  return responseWrapper(res, result, '', httpStatus.OK);
});