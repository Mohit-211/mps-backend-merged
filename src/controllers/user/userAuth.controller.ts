import httpStatus from "http-status";
import { userAuthService } from "../../services";
import {
  catchAsync,
  pick,
  responseWrapper,
  validatePassword,
} from "../../utils";

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

export const getGBPAuthUrl = catchAsync(async (req, res) => {
  const body = pick(req.body, ["user"]);
  const response = await userAuthService.getGBPAuthUrl(body);
  return responseWrapper(res, response);
});

export const gBPConnectionRevoke = catchAsync(async (req, res) => {
  const body = pick(req.body, ["user", "google_sub"]);
  let response = await userAuthService.gBPConnectionRevoke(body);
  return responseWrapper(
    res,
    response,
    "Google Business Manager disconnected successfully"
  );
});

export const getGBPPopupConfig = catchAsync(async (req, res) => {
  const body = pick(req.body, ["user"]);
  const response = await userAuthService.getGBPPopupConfig(body);
  return responseWrapper(res, response);
});

export const gBPPopupCode = catchAsync(async (req, res) => {
  const body = pick(req.body, ["user", "code", "state"]);
  const response = await userAuthService.gBPPopupCode(body);
  return responseWrapper(res, response, "Connected with GBP successfully.");
});

export const gBPAuthCallback = catchAsync(async (req, res) => {
  const query = pick(req.query, ["code", "state", "error"]);
  const response = await userAuthService.gBPAuthCallback(query);
  return responseWrapper(res, response, "Connected with GBP successfully.");
});
