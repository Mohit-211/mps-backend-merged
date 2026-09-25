/* eslint-disable prefer-const */
import httpStatus from "http-status";
import { ApiError, isValidMongoObjectId, mongoFunctions } from "../../utils";
import { BodyDefinition, ParamsDefinition } from "../../types/RouteDefinition";
import {
  mongoOperationsTypes,
  notificationTypesArr,
} from "../../configs/constantTypes";
import { Client, Location, Profile, User } from "../../models";
import { clientSelect } from "../../constants";



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

    return {
      ...user,

      has_active_subscription:
        user.subscription_status === 'ACTIVE' &&
        !!user.current_plan_id,
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

export const notificationToogle = async (body: BodyDefinition) => {
  try {
    let { user, type } = body;

    if (!notificationTypesArr.includes(type)) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Invalid type.");
    }
    user = await User.findOne({ _id: user._id });
    user.notification_status = !user.notification_status;
    await user.save();
    return user;
  } catch (error) {
    throw new ApiError(
      error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
      error.message || "An error occurred while toggling the notification."
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

export const createClient = async (body: BodyDefinition) => {
  try {
    const { company_name, company_URL, unique_id, user } = body;

    let clinetDoc = await mongoFunctions({
      schema: Client,
      createData: {
        company_name,
        company_URL,
        unique_id,
        created_by: user._id,
      },
      operationType: mongoOperationsTypes.CREATE,
    });
    if (!clinetDoc) {
      throw new ApiError(
        httpStatus.INTERNAL_SERVER_ERROR,
        "Failed to create new client."
      );
    }
    const userProfileDoc = await Profile.findOne({
      user_id: user._id,
      is_active: true,
    });
    if (userProfileDoc) {
      await mongoFunctions({
        schema: Profile,
        condition: { user_id: user._id, is_active: true },
        updateData: {
          no_of_clients: userProfileDoc?.no_of_clients + 1 || 1,
        },
        operationType: mongoOperationsTypes.UPDATE_ONE,
      });
    }
    return "";
  } catch (error) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

export const getAllClient = async (body: BodyDefinition) => {
  try {
    const { user } = body;

    let clinetDocs = await mongoFunctions({
      schema: Client,
      condition: {
        is_active: true,
        created_by: user._id,
      },
      operationType: mongoOperationsTypes.FIND,
      selectedFields: clientSelect,
    });
    if (!clinetDocs) {
      throw new ApiError(
        httpStatus.INTERNAL_SERVER_ERROR,
        "Failed to get clients list"
      );
    }
    return clinetDocs;
  } catch (error) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

export const updateClient = async (body: Partial<BodyDefinition>) => {
  try {
    const { user, client_id, unique_id, company_name, company_URL } = body;
    if (!client_id || !isValidMongoObjectId(client_id)) {
      throw new ApiError(
        httpStatus.NOT_FOUND,
        "Please provide a valid client id"
      );
    }
    const updateData = {
      updated_at: new Date(),
    };
    const clientDoc = await Client.findOne({
      _id: client_id,
      created_by: user._id,
      is_active: true,
    });
    if (!clientDoc) {
      throw new ApiError(httpStatus.NOT_FOUND, "Client not found");
    }
    if (company_name) updateData["company_name"] = company_name;

    if (company_URL && company_URL !== clientDoc.company_URL) {
      const isCompanyUrlExists = await mongoFunctions({
        schema: Client,
        operationType: mongoOperationsTypes.FIND_ONE,
        condition: { company_URL },
      });
      if (isCompanyUrlExists) {
        throw new ApiError(
          httpStatus.NOT_FOUND,
          "company_URL is already registered"
        );
      }
      if (company_URL) updateData["company_URL"] = company_URL;
    }

    if (unique_id && unique_id !== clientDoc.unique_id) {
      const isUniqueIdExists = await mongoFunctions({
        schema: Client,
        operationType: mongoOperationsTypes.FIND_ONE,
        condition: { unique_id },
      });
      if (isUniqueIdExists) {
        throw new ApiError(
          httpStatus.NOT_FOUND,
          "unique_id is already registered"
        );
      }
      const pattern = /^[A-Za-z]+-[A-Za-z]+-\d+$/;
      if (!pattern.test(unique_id)) {
        throw new ApiError(
          httpStatus.NOT_FOUND,
          "Invalid unique id format ex: letters-letters-digits like John-doe-123"
        );
      }
      if (unique_id) updateData["unique_id"] = unique_id;
    }

    const updatedClient = await mongoFunctions({
      schema: Client,
      condition: { _id: client_id, created_by: user._id, is_active: true },
      updateData,
      operationType: mongoOperationsTypes.UPDATE_ONE,
    });

    if (!updatedClient) {
      throw new ApiError(httpStatus.NOT_FOUND, "Failed to update failed.");
    }

    return updatedClient;
  } catch (error) {
    throw new ApiError(
      error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

export const deleteClient = async (
  body: BodyDefinition,
  params: ParamsDefinition
) => {
  try {
    const { client_id } = params;
    const { user } = body;

    if (!client_id || !isValidMongoObjectId(client_id)) {
      throw new ApiError(
        httpStatus.NOT_FOUND,
        "Please provide a valid client_id"
      );
    }
    const deletedClient = await mongoFunctions({
      schema: Client,
      condition: { _id: client_id, created_by: user._id, is_active: true },
      operationType: mongoOperationsTypes.DELETE_ONE,
    });

    if (!deletedClient) {
      throw new ApiError(
        httpStatus.NOT_FOUND,
        "Client not found or delete failed."
      );
    }
    const userProfileDoc = await Profile.findOne({
      user_id: user._id,
      is_active: true,
    });
    if (userProfileDoc) {
      await mongoFunctions({
        schema: Profile,
        condition: { user_id: user._id, is_active: true },
        updateData: {
          no_of_clients:
            userProfileDoc?.no_of_clients - 1 > 0
              ? userProfileDoc?.no_of_clients - 1
              : 0,
        },
        operationType: mongoOperationsTypes.UPDATE_ONE,
      });
    }
    await mongoFunctions({
      schema: Location,
      condition: { client_id: client_id, is_active: true },
      updateData: { client_id: null },
      operationType: mongoOperationsTypes.UPDATE_MANY,
    });

    return "";
  } catch (error) {
    throw new ApiError(
      error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

export const getClientDetails = async (
  body: BodyDefinition,
  params: ParamsDefinition
) => {
  try {
    const { user } = body;
    const { client_id } = params;
    if (!client_id || !isValidMongoObjectId(client_id)) {
      throw new ApiError(
        httpStatus.NOT_FOUND,
        "Please provide a valid client id"
      );
    }

    let clinetDoc = await mongoFunctions({
      schema: Client,
      condition: {
        is_active: true,
        created_by: user._id,
        _id: client_id,
      },
      operationType: mongoOperationsTypes.FIND_ONE,
      selectedFields: clientSelect,
    });
    if (!clinetDoc) {
      throw new ApiError(
        httpStatus.INTERNAL_SERVER_ERROR,
        "No client details found with this client_id"
      );
    }
    return clinetDoc;
  } catch (error) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};