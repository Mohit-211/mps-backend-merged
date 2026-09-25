/**
 * eslint-disable @typescript-eslint/no-explicit-any
 *
 * @format
 */

import httpStatus from "http-status";
import validator from "validator";
import jwt from "jsonwebtoken";
import config from "../../configs/config";

import {
	responseWrapper,
	ApiError,
	catchAsync,
	validatePassword,
	isValidMongoObjectId,
	mongoFunctions,
} from "../../utils";
import { Admin, Role } from "../../models";

export const validateSignInReqBody = catchAsync(async (req, res, next) => {
	const { email, password } = req.body;
	//   const { time_zone } = req.headers;
	//   if (!time_zone) {
	//     return responseWrapper(
	//       res,
	//       "",
	//       "Please Enter Required Fields : time_zone inside headers",
	//       httpStatus.BAD_REQUEST
	//     );
	//   }
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

export const validateAdminJWTToken = catchAsync(async (req, res, next) => {
	try {
		// ✅ Get token from headers
		const authHeader = req.headers["authorization"];
		const token = authHeader?.split(" ")[1];

		if (!token) {
			return responseWrapper(
				res,
				"",
				"Access denied: No token provided",
				httpStatus.UNAUTHORIZED
			);
		}

		// ✅ Verify token
		const decoded = jwt.verify(
			token,
			Buffer.from(config.constants.jwt.secret, "hex"),
			{
				algorithms: ["HS256"],
			}
		) as {
			id: string;
			role_id: number;
			department_id?: string;
			is_backlisted?: boolean;
		};

		// ✅ Handle blacklisted token
		if (decoded?.is_backlisted) {
			return responseWrapper(res, "", "Invalid Token", httpStatus.UNAUTHORIZED);
		}

		// ✅ Fetch admin from DB
		const admin = await Admin.findById(decoded.id);
		if (!admin) {
			return responseWrapper(res, "", "Admin not found", httpStatus.NOT_FOUND);
		}

		// ✅ Fetch role name from Role table using role_id
		const roleDoc = await Role.findOne({ role_id: decoded.role_id });
		if (!roleDoc) {
			throw new ApiError(httpStatus.BAD_REQUEST, "Invalid role assigned");
		}

		// ✅ Attach user and token info to request
		req.body.user = {
			_id: admin._id,
			name: admin.name,
			email: admin.email,
			role_id: decoded.role_id,
			role_name: roleDoc.name,
			department_id: decoded.department_id || null,
		};

		req.body.tokenPayload = decoded; // use decoded as token payload
		req.body.ip_address = req.ip;

		next();
	} catch (error: any) {
		next(
			new ApiError(
				error.statusCode || httpStatus.UNAUTHORIZED,
				error.message || "Invalid or expired token"
			)
		);
	}
});

