import { userOperationService } from "../../services";
import { catchAsync, pick, responseWrapper } from "../../utils";

export const getProfile = catchAsync(async (req, res) => {
  const body = pick(req.body, ["user"]);
  const response = await userOperationService.getProfile(body);
  return responseWrapper(res, response);
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
