/* eslint-disable @typescript-eslint/no-explicit-any */
import httpStatus from "http-status";
import validator from "validator";

import {
  responseWrapper,
  ApiError,
  catchAsync,
  validatePassword,
  isValidMongoObjectId,
  mongoFunctions,
} from "../../utils";
import {
  mongoOperationsTypes,
  otpTypes,
  tokenTypes,
  userStatusTypes,
  userTypesArr,
} from "../../configs/constantTypes";
import config from "../../configs/config";
import { City, Client, Country, OTP, Role, State, User } from "../../models";
import { tokenService } from "../../services";
import mongoose from "mongoose";

export const insertUserRoleId = catchAsync(async (req, res, next) => {
  req.body.role_id = config.roles.user;
  next();
});


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
          referral_code: 1,
          status: 1,
          notification_status: 1,
          trial: 1,
          is_active: 1,
          user_name: 1,
          available_credit: 1,
          socket_id: 1,
          owner_id: 1,
          is_gbp_connected: 1,
          square_customer_id: 1,
          is_analytics_connected: 1,
          subscription_status: 1,
          current_plan_id: 1,
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
      return responseWrapper(res, "", "User Not Found", httpStatus.NOT_FOUND);
    }
    const user = users[0];

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

export const validateRegisterUserBody = catchAsync(async (req, res, next) => {
  try {
    const {
      user_type,
      role_id,
      name,
      email,
      mobile,
      password,
      confirm_password,
      country_id,
      city_id,
      state_id,
      business_address,
      business_name,
      zip_code,
    } = req.body;
    // return res.send(req.body);
    if (
      !user_type ||
      !name ||
      !email ||
      !password ||
      !confirm_password ||
      !business_name
    ) {
      return responseWrapper(
        res,
        "",
        "Please Enter Required Fields: [user_type, name, email, password, confirm_password, business_name]",
        httpStatus.BAD_REQUEST
      );
    }

    const roleDoc = await Role.findOne({ role_id: role_id, is_active: true });
    if (!roleDoc)
      return responseWrapper(
        res,
        "",
        "Invalid Role Id.",
        httpStatus.BAD_REQUEST
      );

    // if (!['AGENCY', 'BUSINESS'].includes(user_type)) {
    //   return responseWrapper(
    //     res,
    //     "",
    //     `Invalid user_type required fields : ${['AGENCY', 'BUSINESS']}`,
    //     httpStatus.BAD_REQUEST
    //   );
    // }

    if (role_id !== config.roles.user) {
      return responseWrapper(
        res,
        "",
        "Invalid role_id",
        httpStatus.BAD_REQUEST
      );
    }
    if (isValidMongoObjectId(country_id)) {
      const countryDoc = await Country.findOne({
        _id: country_id,
        is_active: true,
      });
      req.body.country_name = countryDoc.name;
    }

    if (isValidMongoObjectId(state_id)) {
      const stateDoc = await State.findOne({ _id: state_id, is_active: true });
      req.body.state_name = stateDoc.name;
    }

    if (isValidMongoObjectId(city_id)) {
      const cityDoc = await City.findOne({ _id: city_id, is_active: true });
      req.body.city_name = cityDoc.name;
    }

    if (!validator.isEmail(email) || name.length === 0) {
      return responseWrapper(res, "", "Invalid Email", httpStatus.BAD_REQUEST);
    }

    if (await User.isEmailTaken(email)) {
      return responseWrapper(
        res,
        "",
        "Email already taken",
        httpStatus.BAD_REQUEST
      );
    }

    if (!validatePassword(password)) {
      return responseWrapper(
        res,
        "",
        "Password should have a minimum length of 8 characters and must have at least 2 digits and No Blank Space",
        httpStatus.BAD_REQUEST
      );
    }

    if (password !== confirm_password) {
      return responseWrapper(
        res,
        "",
        "Password and Confirm Password must be equal.",
        httpStatus.BAD_REQUEST
      );
    }
    req.headers.ip_address = req.clientIp;
    next();
  } catch (error) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
});

export const validateSignInReqBody = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;
  const { time_zone } = req.headers;
  if (!time_zone) {
    return responseWrapper(
      res,
      "",
      "Please Enter Required Fields : time_zone inside headers",
      httpStatus.BAD_REQUEST
    );
  }
  if (!email || !password) {
    return responseWrapper(
      res,
      "",
      "Please Enter Required Fields : [email, password]",
      httpStatus.BAD_REQUEST
    );
  }
  if (!validator.isEmail(email)) {
    return responseWrapper(
      res,
      "",
      "Invalid email format",
      httpStatus.BAD_REQUEST
    );
  }
  req.body.ip_address = req.ip;
  next();
});

export const validateForgetPassordToken = catchAsync(async (req, res, next) => {
  try {
    const { email, password, confirm_password, token } = req.body;

    if (!email || !password || !confirm_password || !token) {
      return responseWrapper(
        res,
        "",
        "Please Enter Required Fields : [ email || new_password || confirm_password || token ]",
        httpStatus.BAD_REQUEST
      );
    }

    const userDoc = await User.findOne({ email: email, is_active: true });
    if (!userDoc) {
      return responseWrapper(
        res,
        "",
        "User With This Email Id Not Found.",
        httpStatus.BAD_REQUEST
      );
    }

    const otpDoc = await OTP.findOne({
      email: email,
      code: token,
      is_verified: true,
      type: otpTypes.FORGOT_PASSWORD,
    });
    if (!otpDoc) {
      return responseWrapper(
        res,
        "",
        "Forget Password Token is not Valid.",
        httpStatus.BAD_REQUEST
      );
    }
    req.body.user = userDoc;
    req.body.otpDoc = otpDoc;
    next();
  } catch (error) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message
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

export const validateCreateClientBody = catchAsync(async (req, res, next) => {
  try {
    const { company_name, company_URL, unique_id } = req.body;

    if (!company_name || !company_URL || !unique_id) {
      return responseWrapper(
        res,
        "",
        "Please Enter Required Fields : name, company_name, company_URL and unique_id in body",
        httpStatus.BAD_REQUEST
      );
    }
    const isCompanyUrlExists = await mongoFunctions({
      schema: Client,
      operationType: mongoOperationsTypes.FIND_ONE,
      condition: { company_URL },
    });
    if (isCompanyUrlExists) {
      return responseWrapper(
        res,
        "",
        "company_URL is already registered",
        httpStatus.BAD_REQUEST
      );
    }

    const isUniqueIdExists = await mongoFunctions({
      schema: Client,
      operationType: mongoOperationsTypes.FIND_ONE,
      condition: { unique_id },
    });
    if (isUniqueIdExists) {
      return responseWrapper(
        res,
        "",
        "unique_id is already registered",
        httpStatus.BAD_REQUEST
      );
    }
    const pattern = /^[A-Za-z]+-[A-Za-z]+-\d+$/;
    if (!pattern.test(unique_id)) {
      return responseWrapper(
        res,
        "",
        "Invalid unique id format ex: letters-letters-digits like John-doe-123",
        httpStatus.BAD_REQUEST
      );
    }
    next();
  } catch (error) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
});

export const validateAddEmployeeBody = catchAsync(async (req, res, next) => {
  try {
    const {
      name,
      email,
      mobile,
      password,
      user,
    } = req.body;

    if (
      !name ||
      !email ||
      !password ||
      !mobile
    ) {
      return responseWrapper(
        res,
        "",
        "Please Enter Required Fields: [name, email, password, mobile]",
        httpStatus.BAD_REQUEST
      );
    }
    if (!['AGENCY', 'BUSINESS'].includes(user.user_type)) {
      return responseWrapper(
        res,
        "",
        `You are not allow to access this route`,
        httpStatus.BAD_REQUEST
      );
    }

    if (!validator.isEmail(email) || name.length === 0) {
      return responseWrapper(res, "", "Invalid Email", httpStatus.BAD_REQUEST);
    }

    if (await User.isEmailTaken(email)) {
      return responseWrapper(
        res,
        "",
        "Email already taken",
        httpStatus.BAD_REQUEST
      );
    }

    if (!validatePassword(password)) {
      return responseWrapper(
        res,
        "",
        "Password should have a minimum length of 8 characters and must have at least 2 digits and No Blank Space",
        httpStatus.BAD_REQUEST
      );
    }

    req.headers.ip_address = req.clientIp;
    next();
  } catch (error) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
});