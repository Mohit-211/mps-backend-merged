/* eslint-disable @typescript-eslint/no-explicit-any */
import httpStatus from "http-status";

import { responseWrapper, ApiError, catchAsync } from "../../utils";
import { tokenTypes, userStatusTypes } from "../../configs/constantTypes";
import { City, Country, State, User } from "../../models";
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
          is_active: 1,
          is_gbp_connected: 1,
          token_version: 1,
          "user_profile._id": 1,
          "user_profile.user_id": 1,
          "user_profile.name": 1,
          "user_profile.business_name": 1,
          "user_profile.business_address": 1,
          "user_profile.country": 1,
          "user_profile.state": 1,
          "user_profile.city": 1,
          "user_profile.zip_code": 1,
          "user_profile.website_url": 1,
          "user_profile.mobile": 1,
          "user_profile.is_active": 1,
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

export const verifyRefreshAuthJWTToken = catchAsync(async (req, res, next) => {
  try {
    const { refresh_token } = req.body;
    const tokenDoc = await tokenService.verifyToken(
      refresh_token,
      tokenTypes.REFRESH
    );

    const user = await User.findOne({ _id: tokenDoc.user_id, is_active: true });
    if (!user) {
      return responseWrapper(res, "", "User Not Found", httpStatus.NOT_FOUND);
    }

    req.body.user = user;
    req.body.tokenDoc = tokenDoc;
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

export const validateUpdateProfilerBody = catchAsync(async (req, res, next) => {
  try {
    const { country_id, city_id, state_id } = req.body;

    if (country_id) {
      const countryDoc = await Country.findOne({
        _id: country_id,
        is_active: true,
      });
      if (!countryDoc)
        return responseWrapper(
          res,
          "",
          "Invalid Country Id.",
          httpStatus.BAD_REQUEST
        );
      req.body.country_name = countryDoc.name;
    }

    if (state_id) {
      const stateDoc = await State.findOne({
        _id: state_id,
        is_active: true,
      });
      if (!stateDoc)
        return responseWrapper(
          res,
          "",
          "Invalid State Id.",
          httpStatus.BAD_REQUEST
        );
      req.body.state_name = stateDoc.name;
    }
    if (city_id) {
      const cityDoc = await City.findOne({
        _id: city_id,
        is_active: true,
      });
      if (!cityDoc)
        return responseWrapper(
          res,
          "",
          "Invalid City Id.",
          httpStatus.BAD_REQUEST
        );
      req.body.city_name = cityDoc.name;
    }

    next();
  } catch (error) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
});
