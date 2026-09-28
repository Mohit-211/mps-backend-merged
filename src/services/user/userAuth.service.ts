/* eslint-disable @typescript-eslint/no-explicit-any */
import httpStatus from "http-status";
import validator from "validator";
import crypto from "crypto";
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
import { ApiError, mongoFunctions } from "../../utils";
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
  sendForgotPasswordOTP,
} from "../common/email.service";
import {
  generateAuthAccessTokens,
  generateAuthTokens,
  revokeUserSessions,
} from "../common/token.service";
import { LIMITS, hit } from "../auth/rateLimit";
import { emailNotVerifiedError } from "../auth/emailVerification";
import { apiErrorWithData } from "../../utils";
import { TokenDefination } from "../../types/interfaces";
import config from "../../configs/config";
import { gbpOAuthService } from "../gbp/oauth.service";
import { addMemberToOwnedOrganizations } from "../org/context";
import { Membership } from "../../models";
import { bindingService } from "../gbp/binding.service";
import { tokenStore } from "../gbp/tokenStore";

/** Phase 8.1: the legacy OTP routes only reset passwords; email verification is by link. */
const emailVerificationByLinkError = () =>
  apiErrorWithData(httpStatus.BAD_REQUEST, "Email verification is by link. Use POST /api/v1/auth/resend-verification.", {
    reason: "verification_by_link",
  });

export const sendOTP = async (body: BodyDefinition) => {
  try {
    const { email, type } = body;

    if (typeof email !== "string" || !validator.isEmail(email) || !otpTypesArr.includes(type)) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Invalid Email or Type.");
    }
    // Phase 8.1: email verification is by link (POST /api/v1/auth/resend-verification); codes only reset passwords.
    if (type !== otpTypes.FORGOT_PASSWORD) throw emailVerificationByLinkError();
    // Phase 10 (AUDIT S22): legacy OTP requests are rate-limited per email.
    await hit(LIMITS.legacyOtpPerEmail, [email]);

    const userDoc = await User.findOne({ email: email });
    if (!userDoc) throw new ApiError(httpStatus.BAD_REQUEST, "User Not Found");

    await OTP.deleteMany({ email, type }).exec();
    const generatedOTP = String(crypto.randomInt(100000, 1000000));
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
    await sendForgotPasswordOTP(email, generatedOTP);
    return "";
  } catch (error) {
    if (error instanceof ApiError) throw error; // keeps reason data (Phase 8.1)
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

export const verifyOTP = async (body: BodyDefinition) => {
  try {
    const { email, otp, type } = body;

    if (typeof email !== "string" || typeof otp !== "string" || typeof type !== "string" || !email || !otp || !type) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Please Enter Required Fields : email, otp, type"
      );
    }
    if (!otpTypesArr.includes(type)) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Invalid otp type");
    }
    if (type !== otpTypes.FORGOT_PASSWORD) throw emailVerificationByLinkError();

    const otpDoc = await OTP.findOne({
      email: email,
      type: type,
      is_active: true,
      is_verified: false,
    });

    if (!otpDoc || Object.keys(otpDoc).length === 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Invalid Email or Type");
    }

    if (otpDoc.otp_expiration_time < new Date()) {
      throw new ApiError(httpStatus.BAD_REQUEST, "OTP has been Expired");
    }
    // Phase 10 (AUDIT S22): 5 attempts per code, then it is void.
    if ((otpDoc.attempts ?? 0) >= 5) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Too many attempts. Request a new code.");
    }
    if (otp !== otpDoc.code) {
      otpDoc.attempts = (otpDoc.attempts ?? 0) + 1;
      await otpDoc.save();
      throw new ApiError(httpStatus.BAD_REQUEST, "Invalid OTP Entered");
    }

    otpDoc.is_verified = true;
    // Phase 10 (AUDIT S22): a random single-use reset token, stored hashed, valid 30 minutes.
    const token = crypto.randomBytes(32).toString("base64url");
    otpDoc.code = crypto.createHash("sha256").update(token).digest("hex");
    otpDoc.otp_expiration_time = new Date(Date.now() + 30 * 60 * 1000);
    await otpDoc.save();

    return token;
  } catch (error) {
    if (error instanceof ApiError) throw error; // keeps reason data (Phase 8.1)
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

export const login = async (body: BodyDefinition, header: HeaderDefinition) => {
  try {
    const { email, password } = body;
    const { time_zone } = header;

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
          email_verified_at: 1,
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
    if (userDoc.status === userStatusTypes.REJECTED) {
      throw new ApiError(httpStatus.BAD_REQUEST, "User rejected.");
    }

    
    const passwordMatch = await bcrypt.compare(password, userDoc.password);
    if (!passwordMatch) {
      throw new ApiError(httpStatus.UNAUTHORIZED, "Incorrect Password.");
    }
    // Phase 8.1: no tokens until the email is verified (by link; no code is sent from here).
    if (!userDoc.email_verified_at) throw emailNotVerifiedError();

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
    if (error instanceof ApiError) throw error; // keeps reason data (Phase 8.1)
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
    // Phase 10 (AUDIT S24): a password change ends every session (the client signs in again).
    await revokeUserSessions(user._id);

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
    await revokeUserSessions(user._id);
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
    // Phase 10 (AUDIT S23): disconnect every Google connection (revoke at Google, unbind, cancel the
    // bindings' jobs, delete the tokens) and end the memberships before the account goes.
    for (const conn of await tokenStore.listConnections(user._id, tokenTypes.GBP)) {
      await bindingService.disconnect(user._id, conn.googleSub).catch(() => undefined);
    }
    await Membership.updateMany({ user_id: user._id }, { $set: { status: "removed" } });
    await revokeUserSessions(user._id);
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

// GBP (Phase 6): one-time random state + business.manage only; see services/gbp/oauth.service.ts.
export const getGBPAuthUrl = async (body: BodyDefinition) => {
  const { user } = body;
  return gbpOAuthService.createAuthUrl(user._id);
};

export const getGBPPopupConfig = async (body: BodyDefinition) => {
  const { user } = body;
  return gbpOAuthService.createPopupConfig(user._id);
};

export const gBPPopupCode = async (body: BodyDefinition) => {
  const { user, code, state } = body;
  return gbpOAuthService.handlePopupCode(user._id, {
    code: typeof code === "string" ? code : undefined,
    state: typeof state === "string" ? state : undefined,
  });
};

export const gBPAuthCallback = async (query: QueryDefinition) =>
  gbpOAuthService.handleCallback({
    code: typeof query.code === "string" ? query.code : undefined,
    state: typeof query.state === "string" ? query.state : undefined,
    error: typeof query.error === "string" ? query.error : undefined,
  });

// Disconnect one connected Google account (body.google_sub; optional with a single connection):
// revoke it at Google (best effort), unbind only its profiles, cancel their jobs, delete its tokens.
export const gBPConnectionRevoke = async (body: BodyDefinition) => {
  const { user, google_sub } = body;
  return bindingService.disconnect(user._id, typeof google_sub === "string" ? google_sub : undefined);
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
      // Phase 8.1: created by the owner, so no verification step (and never cleaned up).
      email_verified_at: new Date(),
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

    // Phase 8: the employee is a member of the owner's organizations.
    await addMemberToOwnedOrganizations(user._id, userDoc._id);

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
    // Phase 8: remove the employee's memberships.
    await Membership.updateMany({ user_id: userDoc._id }, { $set: { status: "removed" } });

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
          is_active: 1,
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
          is_active: 1,
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