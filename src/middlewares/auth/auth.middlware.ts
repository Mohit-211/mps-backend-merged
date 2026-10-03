import httpStatus from "http-status";

import { responseWrapper, ApiError, catchAsync } from "../../utils";
import { tokenTypes, userStatusTypes } from "../../configs/constantTypes";
import { User } from "../../models";
import { tokenService } from "../../services";
import mongoose from "mongoose";

export const verifyAuthJWTToken = catchAsync(async (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    if (!token) {
      return responseWrapper(
        res,
        "",
        "Unauthorized : please authenticate.",
        httpStatus.UNAUTHORIZED
      );
    }
    const tokenPayload = await tokenService.verifyToken(
      token,
      tokenTypes.ACCESS
    );

    const users = await User.aggregate([
      {
        $match: {
          status: userStatusTypes.ACCEPTED,
          _id: new mongoose.Types.ObjectId(`${tokenPayload.sub}`),
          // Phase 10 (AUDIT S24): aggregate bypasses the soft-delete filter, so exclude deleted users here.
          deleted_at: null,
        },
      },
      {
        $project: {
          email: 1,
          user_type: 1,
          role_id: 1,
          status: 1,
          is_active: 1,
          is_gbp_connected: 1,
          token_version: 1,
        },
      },
    ]);

    if (!users || !Array.isArray(users) || users.length === 0) {
      return responseWrapper(res, "", "Unauthorized : please authenticate.", httpStatus.UNAUTHORIZED);
    }
    const user = users[0];
    // Phase 10 (AUDIT S24): tokens issued before a password change or sign-out-everywhere are refused.
    if ((user.token_version ?? 0) !== (tokenPayload.tv ?? 0)) {
      return responseWrapper(res, "", "Your session has ended. Please log in again.", httpStatus.UNAUTHORIZED);
    }
    delete user.token_version;

    req.body.user = user;

    req.body.tokenPayload = tokenPayload;
    req.body.ip_address = req.ip;
    next();
  } catch (error) {
    next(
      new ApiError(
        error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
        error.message
      )
    );
  }
});
