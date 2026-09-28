/* eslint-disable @typescript-eslint/no-explicit-any */
import httpStatus from "http-status";
import bcrypt from "bcryptjs";
import moment from "moment-timezone";
import { tokenTypes } from "../../configs/constantTypes";
import { ApiError } from "../../utils";
import { IUserLoginTiming, IUserToken, Profile, User, UserLoginTiming, UserToken } from "../../models";
import { BodyDefinition, HeaderDefinition, QueryDefinition } from "../../types/RouteDefinition";
import { generateAuthAccessTokens, revokeUserSessions } from "../common/token.service";
import { gbpOAuthService } from "../gbp/oauth.service";
import { Membership } from "../../models";
import { bindingService } from "../gbp/binding.service";
import { tokenStore } from "../gbp/tokenStore";


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
