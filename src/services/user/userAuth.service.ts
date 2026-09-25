/* eslint-disable @typescript-eslint/no-explicit-any */
import httpStatus from "http-status";
import validator from "validator";
import randomize from "randomatic";
import bcrypt from "bcryptjs";
import moment from "moment-timezone";
import mongoose from "mongoose";
import {
  mongoOperationsTypes,
  otpTypes,
  otpTypesArr,
  tokenTypes,
  userStatusTypes,
  userTypes,
} from "../../configs/constantTypes";
import { ApiError, generateRandomString, mongoFunctions } from "../../utils";
import {
  IUser,
  IUserAuth,
  IUserLoginTiming,
  IUserToken,
  OTP,
  Profile,
  User,
  UserAuth,
  UserLoginTiming,
  UserToken,
} from "../../models";
import {
  BodyDefinition,
  HeaderDefinition,
  ParamsDefinition,
  QueryDefinition,
} from "../../types/RouteDefinition";
import {
  sendEmailVerification,
  sendForgotPasswordOTP,
} from "../common/email.service";
import {
  generateAuthAccessTokens,
  generateAuthTokens,
} from "../common/token.service";
import { TokenDefination } from "../../types/interfaces";
import { oAuth2Client } from "../../configs/oAuth2Client";
import config from "../../configs/config";

export const sendOTP = async (body: BodyDefinition) => {
  try {
    const { email, type } = body;

    if (!validator.isEmail(email) || !otpTypesArr.includes(type)) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Invalid Email or Type.");
    }

    const userDoc = await User.findOne({ email: email });
    if (!userDoc) throw new ApiError(httpStatus.BAD_REQUEST, "User Not Found");

    await OTP.deleteMany({ email, type }).exec();
    const generatedOTP = randomize("0", 6);
    const otpObj = {
      email: email,
      code: generatedOTP,
      type: type,
      user_id: userDoc.id,
    };
    const otpDoc = await OTP.create(otpObj);
    if (!otpDoc) {
      throw new ApiError(
        httpStatus.INTERNAL_SERVER_ERROR,
        "Failed to generate new OTP."
      );
    }
    if (type === otpTypes.FORGOT_PASSWORD) {
      await sendForgotPasswordOTP(email, generatedOTP);
    } else if (type === otpTypes.EMAIL_VERIFICATION) {
      await sendEmailVerification(email, generatedOTP);
    }
    return "";
  } catch (error) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

export const verifyOTP = async (body: BodyDefinition) => {
  try {
    const { email, otp, type } = body;

    if (!email || !otp || !type) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Please Enter Required Fields : email, otp, type"
      );
    }
    if (!otpTypesArr.includes(type)) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Invalid otp type");
    }

    const otpDoc = await OTP.findOne({
      email: email,
      type: type,
      is_active: true,
      is_verified: false,
    });

    if (!otpDoc || Object.keys(otpDoc).length === 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Invalid Email or Type");
    }

    if (otp !== otpDoc.code) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Invalid OTP Entered");
    }

    if (otpDoc.otp_expiration_time < new Date()) {
      throw new ApiError(httpStatus.BAD_REQUEST, "OTP has been Expired");
    }

    otpDoc.is_verified = true;
    let token = "";

    if (type !== otpTypes.FORGOT_PASSWORD) {
      await User.updateOne(
        { email: email },
        { $set: { status: userStatusTypes.ACCEPTED } }
      );
    } else {
      token = generateRandomString(50);
      otpDoc.code = token;
    }
    await otpDoc.save();

    return token ? token : "";
  } catch (error) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

export const register = async (body: BodyDefinition) => {
  try {
    const {
      user_type,
      role_id,
      name,
      email,
      mobile,
      password,
      country_name,
      city_name,
      state_name,
      business_address,
      business_name,
      website_url,
      zip_code,
    } = body;

    const salt = bcrypt.genSaltSync(10);
    const userObj = {
      email,
      password: bcrypt.hashSync(password, salt),
      role_id,
      user_type,
    };
    const userDoc = await User.create(userObj);
    if (!userDoc) {
      throw new ApiError(
        httpStatus.INTERNAL_SERVER_ERROR,
        "Failed to create new user account"
      );
    }
    const profileObj = {
      user_id: userDoc._id,
      name,
      mobile: mobile ? mobile : null,
      business_address: business_address ? business_address : null,
      business_name,
      website_url: website_url ? website_url : null,
      zip_code: zip_code ? zip_code : null,
    };
    if (country_name) {
      profileObj["country"] = country_name;
    }
    if (state_name) {
      profileObj["state"] = state_name;
    }
    if (city_name) {
      profileObj["city"] = city_name;
    }

    const profileDoc = await Profile.create(profileObj);
    if (!profileDoc) {
      throw new ApiError(
        httpStatus.INTERNAL_SERVER_ERROR,
        "Failed to create new user profile"
      );
    }

    await sendOTP({ email, type: otpTypes.EMAIL_VERIFICATION });

    return "User Created Successfully. Please Verify Your Email to continue.";
  } catch (error) {
    throw new ApiError(
      error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

export const login = async (body: BodyDefinition, header: HeaderDefinition) => {
  try {
    const { email, password } = body;
    const { time_zone, fcm_token } = header;

    if (!validator.isEmail(email)) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Invalid Email.");
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let userDoc: any = await User.aggregate([
      { $match: { email } },
      {
        $lookup: {
          from: "profiles",
          localField: "_id",
          foreignField: "user_id",
          as: "user_profile",
        },
      },
      {
        $unwind: {
          path: "$user_profile",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          id: 1,
          email: 1,
          password: 1,
          status: 1,
          user_type: 1,
          role_id: 1,
          "user_profile._id": 1,
          "user_profile.user_id": 1,
          "user_profile.name": 1,
          "user_profile.business_name": 1,
          "user_profile.business_address": 1,
        },
      },
    ]);
    if (!userDoc || !Array.isArray(userDoc) || userDoc.length === 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, "User Not Found.");
    }

    userDoc = userDoc[0];
    if (userDoc.status === userStatusTypes.REVIEWING || userDoc.status === userStatusTypes.PENDING) {
      await OTP.deleteMany({ email, type: otpTypes.EMAIL_VERIFICATION }).exec();
      const generatedOTP = randomize("0", 6);
      const otpObj = {
        email: email,
        code: generatedOTP,
        type: otpTypes.EMAIL_VERIFICATION,
        user_id: userDoc.id,
      };
      const otpDoc = await OTP.create(otpObj);
      if (!otpDoc) {
        throw new ApiError(
          httpStatus.INTERNAL_SERVER_ERROR,
          "Failed to generate new OTP."
        );
      }
      await sendEmailVerification(email, generatedOTP);
      throw new ApiError(httpStatus.BAD_REQUEST, "User is not verified yet.Please verify your otp first");
    } else if (userDoc.status === userStatusTypes.REJECTED) {
      throw new ApiError(httpStatus.BAD_REQUEST, "User rejected.");
    }

    
    const passwordMatch = await bcrypt.compare(password, userDoc.password);
    if (!passwordMatch) {
      throw new ApiError(httpStatus.UNAUTHORIZED, "Incorrect Password.");
    }
    if (fcm_token) userDoc.fcm_token = fcm_token;

    const tokens = await generateAuthTokens(userDoc);

    if (tokens) {
      await saveLoginTiming(userDoc, tokens, body, time_zone);
    }
    delete tokens.refresh.id;
    return {
      id: userDoc.id,
      name: userDoc?.user_profile.name,
      email: userDoc.email,
      user_type: userDoc.user_type,
      tokens: tokens,
      role_id: userDoc.role_id,
    };
  } catch (error) {
    throw new ApiError(
      error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

export const refreshAuth = async (body: BodyDefinition) => {
  try {
    const { user } = body;
    const token = await generateAuthAccessTokens(user);
    return {
      tokens: {
        access: token,
      },
    };
  } catch (error) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

export const resetPassword = async (body: BodyDefinition) => {
  try {
    // eslint-disable-next-line prefer-const
    let { old_password, confirm_password, user } = body;
    const salt = bcrypt.genSaltSync(10);
    user = await User.findOne({ email: user.email });

    const validPass = await bcrypt.compare(old_password, user?.password);
    if (!validPass) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Incorrect Old Password.");
    }
    user.password = bcrypt.hashSync(confirm_password, salt);
    const isUserPasswordUpdate = await user.save();
    if (!isUserPasswordUpdate) {
      throw new ApiError(
        httpStatus.INTERNAL_SERVER_ERROR,
        "Failed to Change Password."
      );
    }

    return "";
  } catch (error) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

export const forgotPassword = async (body: BodyDefinition) => {
  try {
    const { password, confirm_password, user } = body;

    if (password !== confirm_password) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "New Password and Confirm Password Must Be Equal"
      );
    }
    const salt = bcrypt.genSaltSync(10);
    user.password = bcrypt.hashSync(confirm_password, salt);

    const isUserPasswordUpdate = await user.save();

    if (!isUserPasswordUpdate) {
      throw new ApiError(
        httpStatus.INTERNAL_SERVER_ERROR,
        "Failed to Forgot Password."
      );
    }
    await OTP.deleteMany({ user_id: user._id });
    await UserToken.deleteMany({ user_id: user._id });
    await UserLoginTiming.updateMany(
      { user_id: user._id },
      { $set: { token_id: null } }
    );
    return "";
  } catch (error) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

export const logout = async (
  body: BodyDefinition,
  header: HeaderDefinition
) => {
  try {
    const { tokenDoc } = body;
    const { time_zone } = header;
    if (!time_zone) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Please Enter Required Fields : time_zone inside headers"
      );
    }

    if (tokenDoc) {
      await saveLogoutTiming(tokenDoc, time_zone);
    }
    const isLoggedout = await tokenDoc.deleteOne();

    if (!isLoggedout) {
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, "Failed to Logout.");
    }

    return "";
  } catch (error) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

const saveLoginTiming = async (
  user: IUser,
  token: TokenDefination,
  body: BodyDefinition,
  time_zone: string
) => {
  try {
    const loginTimeUTC = moment.utc();
    const loginTimeLocal = moment.tz(loginTimeUTC, time_zone);

    const obj = {
      user_id: user._id,
      login_time_utc: loginTimeUTC,
      login_time_local: loginTimeLocal.format("YYYY-MM-DD hh:mm:ss"),
      ip_address: body.ip_address,
      token_id: token.refresh.id,
      time_zone: time_zone,
    };

    const timingDetails = await UserLoginTiming.create(obj);
    return timingDetails;
  } catch (error) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

const saveLogoutTiming = async (
  tokenDoc: IUserToken,
  time_zone: string
): Promise<IUserLoginTiming | string> => {
  try {
    const logoutTimeUTC = moment.utc();
    const logoutTimeLocal = moment.tz(logoutTimeUTC, time_zone);

    const updateObj = {
      logout_time_utc: logoutTimeUTC,
      logout_time_local: logoutTimeLocal.format("YYYY-MM-DD hh:mm:ss"),
      token_id: null,
    };

    const loginTimingDoc = await UserLoginTiming.findOneAndUpdate(
      { token_id: tokenDoc.id },
      { $set: updateObj },
      { new: true }
    );

    if (loginTimingDoc) {
      await loginTimingDoc.save();
      return loginTimingDoc;
    }

    return "";
  } catch (error: any) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

export const deactivateAccount = async (body: BodyDefinition) => {
  try {
    const { user } = body;
    await User.deleteOne({ _id: user._id });
    await Profile.deleteOne({ user_id: user._id });

    await UserToken.deleteMany({
      user_id: user._id,
    });
    await UserLoginTiming.deleteMany({
      user_id: user._id,
    });
    await OTP.deleteMany({
      user_id: user._id,
    });
    return "";
  } catch (error) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

// Analytics

export const getAnalyticsAuthUrl = async (body: BodyDefinition) => {
  try {
    const { user } = body;
    let oAuthInstance = oAuth2Client(tokenTypes.ANALYTICS);
    const authUrl = await oAuthInstance.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: ["https://www.googleapis.com/auth/webmasters.readonly"],
      state: JSON.stringify({
        user_id: user._id,
        user_type: user.user_type,
        role_id: user.role_id,
      }),
    });
    return authUrl;
  } catch (error) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

export const analyticsAuthCallback = async (query: QueryDefinition) => {
  try {
    let { code, state } = query;

    if (!code || !state) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Invalid Flow : failed to obtain code and state."
      );
    }
    state = await JSON.parse(state);
    if (!state.user_id) {
      throw new ApiError(httpStatus.BAD_REQUEST, "user_id missing from state");
    }
    let userDoc = await User.findOne({ _id: state.user_id, is_active: true });
    if (!userDoc) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Invalid user_id from state.");
    }

    let a = await storeToken(code, userDoc, tokenTypes.ANALYTICS);

    return a;
  } catch (error) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

export const analyticsConnectionRevoke = async (body: BodyDefinition) => {
  try {
    let { user } = body;

    const authTokenDoc: IUserAuth = await UserAuth.findOne({
      user_id: user._id,
      is_active: true,
      token_type: tokenTypes.ANALYTICS,
    });

    if (!authTokenDoc || !authTokenDoc.refresh_token) {
      throw new ApiError(httpStatus.BAD_REQUEST, "No Token Found!");
    }
    let isRevoked = await revokeToken(authTokenDoc.refresh_token);

    if (!isRevoked) {
      throw new ApiError(
        httpStatus.INTERNAL_SERVER_ERROR,
        "Failed to revoke google analutics access"
      );
    }

    await UserAuth.deleteOne({
      user_id: user._id,
      token_type: tokenTypes.ANALYTICS,
    });

    await User.findOneAndUpdate(
      { _id: user._id },
      { is_analytics_connected: false }
    );

    return "";
  } catch (error) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

// GBP
export const getGBPAuthUrl = async (body: BodyDefinition) => {
  try {
    const { user } = body;
    let oAuthInstance = oAuth2Client(tokenTypes.GBP);
    const authUrl = await oAuthInstance.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [
        "https://www.googleapis.com/auth/business.manage",
        "https://www.googleapis.com/auth/plus.business.manage",
      ],
      state: JSON.stringify({
        user_id: user._id,
        user_type: user.user_type,
        role_id: user.role_id,
      }),
    });
    return authUrl;
  } catch (error) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

export const gBPAuthCallback = async (query: QueryDefinition) => {
  try {
    let { code, state } = query;

    if (!code || !state) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Invalid Flow : failed to obtain code and state."
      );
    }
    state = await JSON.parse(state);
    if (!state.user_id) {
      throw new ApiError(httpStatus.BAD_REQUEST, "user_id missing from state");
    }
    let userDoc = await User.findOne({ _id: state.user_id, is_active: true });
    if (!userDoc) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Invalid user_id from state.");
    }

    let a = await storeToken(code, userDoc, tokenTypes.GBP);
    return a;

  } catch (error) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

export const gBPConnectionRevoke = async (body: BodyDefinition) => {
  try {
    let { user } = body;

    const authTokenDoc: IUserAuth = await UserAuth.findOne({
      user_id: user._id,
      is_active: true,
      token_type: tokenTypes.GBP,
    });

    if (!authTokenDoc || !authTokenDoc.refresh_token) {
      throw new ApiError(httpStatus.BAD_REQUEST, "No Token Found!");
    }
    let isRevoked = await revokeToken(authTokenDoc.refresh_token);

    if (!isRevoked) {
      throw new ApiError(
        httpStatus.INTERNAL_SERVER_ERROR,
        "Failed to revoke google analutics access"
      );
    }

    await UserAuth.deleteOne({
      user_id: user._id,
      token_type: tokenTypes.GBP,
    });

    await User.findOneAndUpdate({ _id: user._id }, { is_gbp_connected: false });

    return "";
  } catch (error) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

// Utility for store and revoke token
async function revokeToken(refreshToken: string) {
  try {
    // Revoke the refresh token
    const revokeUrl = `https://oauth2.googleapis.com/revoke?token=${refreshToken}`;
    await fetch(revokeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    return true;
  } catch (error) {
    console.error("Error revoking token:", error);
    return error;
  }
}

const storeToken = async (code: string, userDoc: IUser, tokenType: string) => {
  try {
    let oAuthInstance = oAuth2Client(tokenType);
    const { tokens } = await oAuthInstance.getToken(code);
    const { access_token, refresh_token, expiry_date } = tokens;
    if (!access_token || !refresh_token || !expiry_date) {
      throw new ApiError(
        httpStatus.INTERNAL_SERVER_ERROR,
        "Failed to fetch tokens."
      );
    }


    let authTokenDoc = await UserAuth.findOne({
      user_id: userDoc._id,
      token_type: tokenType,
      is_active: true,
    });
    const authTokenObj = {
      user_id: userDoc._id,
      token_type: tokenType,
      access_token: access_token,
      refresh_token: refresh_token,
      expires: expiry_date,
    };
    if (authTokenDoc) {
      await mongoFunctions({
        schema: UserAuth,
        updateData: authTokenObj,
        condition: { user_id: userDoc._id, is_active: true },
        operationType: mongoOperationsTypes.UPDATE_ONE,
      });
    } else {
      await mongoFunctions({
        schema: UserAuth,
        createData: authTokenObj,
        operationType: mongoOperationsTypes.CREATE,
      });
    }
    if (tokenType === tokenTypes.ANALYTICS) {
      userDoc.is_analytics_connected = true;
    } else if (tokenType === tokenTypes.GBP) {
      userDoc.is_gbp_connected = true;
    }
    await userDoc.save();
    return true;
  } catch (error) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

export const addEmployee = async (body: BodyDefinition) => {
  try {
    const {
      name,
      email,
      mobile,
      password,
      user
    } = body;

    const salt = bcrypt.genSaltSync(10);
    const userObj = {
      email,
      password: bcrypt.hashSync(password, salt),
      role_id: config.roles.user,
      user_type: userTypes.employee,
      owner_id: user._id,
      status: userStatusTypes.ACCEPTED,
    };
    const userDoc = await User.create(userObj);
    if (!userDoc) {
      throw new ApiError(
        httpStatus.INTERNAL_SERVER_ERROR,
        "Failed to create new user account"
      );
    }
    const profileObj = {
      user_id: userDoc._id,
      name,
      mobile: mobile ? mobile : null,
      business_address: user?.user_profile?.business_address ? user?.user_profile?.business_address : null,
      business_name: user?.user_profile?.business_name ? user?.user_profile?.business_name : null,
      website_url: user?.user_profile?.website_url ? user?.user_profile?.website_url : null,
      zip_code: user?.user_profile?.zip_code ? user?.user_profile?.zip_code : null,
    };


    const profileDoc = await Profile.create(profileObj);
    if (!profileDoc) {
      throw new ApiError(
        httpStatus.INTERNAL_SERVER_ERROR,
        "Failed to create new user profile"
      );
    }


    return "New Employee Created Successfully.";
  } catch (error) {
    throw new ApiError(
      error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

export const deleteEmployee = async (body: BodyDefinition) => {
  try {
    const {
      employee_id,
      user
    } = body;
    if (!employee_id) {
      throw new ApiError(httpStatus.NOT_FOUND, "Please provide employee_id");
    }
    const userDoc = await User.findOne({ _id: employee_id, owner_id: user._id, user_type: userTypes.employee });
    if (!userDoc) {
      throw new ApiError(httpStatus.NOT_FOUND, "Employee not found or you do not have permission to delete");
    }

    const profileDoc = await Profile.findOneAndDelete({ user_id: userDoc._id });
    if (!profileDoc) {
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, "Failed to delete employee profile");
    }

    await User.findByIdAndDelete(userDoc._id);

    return "Employee deleted successfully.";
  } catch (error: any) {
    throw new ApiError(
      error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

export const getAllEmployeeByOwner = async (body: BodyDefinition) => {
  try {
    const {
      user
    } = body;
    const employees = await User.aggregate([
      {
        $match: {
          status: userStatusTypes.ACCEPTED,
          user_type: userTypes.employee,
          owner_id: new mongoose.Types.ObjectId(`${user._id}`),
        },
      },
      {
        $lookup: {
          from: "profiles",
          localField: "_id",
          foreignField: "user_id",
          as: "user_profile",
        },
      },
      {
        $unwind: {
          path: "$user_profile",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          email: 1,
          user_type: 1,
          role_id: 1,
          status: 1,
          notification_status: 1,
          trial: 1,
          is_active: 1,
          socket_id: 1,
          is_analytics_connected: 1,
          is_gbp_connected: 1,
          "user_profile._id": 1,
          "user_profile.user_id": 1,
          "user_profile.name": 1,
          "user_profile.mobile": 1,
          "user_profile.is_active": 1,
        },
      },
    ]);
    if (!employees) {
      throw new ApiError(httpStatus.NOT_FOUND, "Failed to get all employee");
    }

    return employees;
  } catch (error: any) {
    throw new ApiError(
      error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

export const employeeDetails = async (body: BodyDefinition, params: ParamsDefinition) => {
  try {
    const {
      user
    } = body;
    const {
      employee_id,
    } = params;
    if (!employee_id) {
      throw new ApiError(httpStatus.NOT_FOUND, "Please provide employee_id");
    }

    const employees = await User.aggregate([
      {
        $match: {
          _id: new mongoose.Types.ObjectId(`${employee_id}`),
          status: userStatusTypes.ACCEPTED,
          user_type: userTypes.employee,
          owner_id: new mongoose.Types.ObjectId(`${user._id}`),
        },
      },
      {
        $lookup: {
          from: "profiles",
          localField: "_id",
          foreignField: "user_id",
          as: "user_profile",
        },
      },
      {
        $unwind: {
          path: "$user_profile",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "owner_id",
          foreignField: "_id",
          as: "owner_details",
        },
      },
      {
        $unwind: {
          path: "$owner_details",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $lookup: {
          from: "profiles",
          localField: "owner_details._id",
          foreignField: "user_id",
          as: "owner_details.profile",
        },
      },
      { $unwind: { path: "$owner_details.profile", preserveNullAndEmptyArrays: true } },

      {
        $project: {
          email: 1,
          user_type: 1,
          role_id: 1,
          status: 1,
          notification_status: 1,
          trial: 1,
          is_active: 1,
          socket_id: 1,
          is_analytics_connected: 1,
          is_gbp_connected: 1,
          "user_profile._id": 1,
          "user_profile.user_id": 1,
          "user_profile.name": 1,
          "user_profile.mobile": 1,
          "user_profile.is_active": 1,
          "owner_details._id": 1,
          "owner_details.email": 1,
          "owner_details.profile._id": 1,
          "owner_details.profile.name": 1,
          "owner_details.profile.mobile": 1,
        },
      },
    ]);

    if (!employees) {
      throw new ApiError(httpStatus.NOT_FOUND, "Employee not found");
    }
    return employees;
  } catch (error: any) {
    throw new ApiError(
      error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};