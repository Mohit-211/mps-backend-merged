/* eslint-disable prefer-const */
import httpStatus from "http-status";
import { ApiError, mongoFunctions } from "../../utils";
import { mongoOperationsTypes } from "../../configs/constantTypes";
import { BodyDefinition } from "../../types/RouteDefinition";
import { Membership, Profile } from "../../models";
import { loadEntitlement } from "../billing/entitlement.service";

export const getProfile = async (
  body: BodyDefinition,
) => {
  try {
    const { user } = body;

    if (!user) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Failed to Get Profile.',
      );
    }

    // Phase 13a: from the default organization's billing entitlement (the legacy user plan fields are retired).
    const membership = await Membership.findOne({ user_id: user._id, status: "active" }).sort({ created_at: 1, _id: 1 }).lean();
    const entitlement = membership ? await loadEntitlement(String(membership.organization_id)).then((l) => l.entitlement).catch(() => null) : null;
    return {
      ...user,

      has_active_subscription: Boolean(entitlement && entitlement.subscribed && !entitlement.read_only),
    };
  } catch (error) {
    throw new ApiError(
      error.statusCode
        ? error.statusCode
        : httpStatus.INTERNAL_SERVER_ERROR,
      error.message,
    );
  }
};

export const updateProfile = async (body: BodyDefinition) => {
  try {
    const {
      user,
      name,
      mobile,
      country_name,
      city_name,
      state_name,
      business_address,
      business_name,
      website_url,
      zip_code,
    } = body;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let updateUserProfileData: Record<string, any> = {};

    if (name && name !== user.user_profile.name) {
      updateUserProfileData.name = name;
    }
    if (mobile && mobile !== user.user_profile.mobile) {
      updateUserProfileData.mobile = mobile;
    }
    if (country_name && country_name !== user.user_profile.country) {
      updateUserProfileData.country = country_name;
    }
    if (city_name && city_name !== user.user_profile.city) {
      updateUserProfileData.city = city_name;
    }
    if (state_name && state_name !== user.user_profile.state) {
      updateUserProfileData.state = state_name;
    }
    if (
      business_address &&
      business_address !== user.user_profile.business_address
    ) {
      updateUserProfileData.business_address = business_address;
    }
    if (business_name && business_name !== user.user_profile.business_name) {
      updateUserProfileData.business_name = business_name;
    }
    if (website_url && website_url !== user.user_profile.website_url) {
      updateUserProfileData.website_url = website_url;
    }
    if (zip_code && zip_code !== user.user_profile.zip_code) {
      updateUserProfileData.zip_code = zip_code;
    }
    if (Object.keys(updateUserProfileData).length === 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, "No changes detected");
    }

    await mongoFunctions({
      schema: Profile,
      condition: { _id: user.user_profile._id },
      updateData: updateUserProfileData,
      operationType: mongoOperationsTypes.UPDATE_ONE,
    });

    return "";
  } catch (error) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message || "An error occurred while updating the profile."
    );
  }
};
