import { userAuthService } from "../../services";
import { catchAsync, pick, responseWrapper } from "../../utils";

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
