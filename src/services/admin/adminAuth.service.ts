/** @format */

import bcrypt from "bcryptjs";
import httpStatus from "http-status";
import jwt from "jsonwebtoken";
import { BodyDefinition, ParamsDefinition } from "../../types/RouteDefinition";
import { Admin, Role } from "../../models";
import { ApiError } from "../../utils";
import { sendAdminCredential, sendForgotPasswordOTP } from "../common/email.service";
import config from "../../configs/config";
import { otpTypes } from "../../configs/constantTypes";


export const createAdminUser = async (body: {
	email: string;
	name: string;
	role_id: number;
}) => {
	try {
		const { email, name, role_id } = body;

		// ✅ Check if email already exists
		const existingAdmin = await Admin.findOne({ email });
		if (existingAdmin) {
			throw new ApiError(httpStatus.BAD_REQUEST, "Email already exists");
		}

		// ✅ Fetch role name using role_id
		const roleDoc = await Role.findOne({ role_id: role_id, is_active: true });
		if (!roleDoc) {
			throw new ApiError(httpStatus.BAD_REQUEST, "Invalid role_id");
		}

		const roleName = roleDoc.name; // assuming 'name' field exists in Role model

		// ✅ Generate random password
		const plainPassword = Math.random().toString(36).substring(2, 12);
		const hashedPassword = bcrypt.hashSync(
			plainPassword,
			bcrypt.genSaltSync(10)
		);

		// ✅ Create new admin
		const adminDoc = await Admin.create({
			name,
			email,
			role_id,
			password: hashedPassword,
		});

		if (!adminDoc) {
			throw new ApiError(
				httpStatus.INTERNAL_SERVER_ERROR,
				"Unable to create admin"
			);
		}

		// ✅ Send credentials email
		const mailSent = await sendAdminCredential(email, plainPassword, roleName);
		if (!mailSent) {
			throw new ApiError(
				httpStatus.INTERNAL_SERVER_ERROR,
				"Unable to send credentials email"
			);
		}

		return adminDoc;
	} catch (error: any) {
		throw new ApiError(
			error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
			error.message
		);
	}
};

export const loginAdminUser = async (body: {
	email: string;
	password: string;
}) => {
	try {
		const { email, password } = body;

		// ✅ Check if user exists
		const admin = await Admin.findOne({ email });
		if (!admin) {
			throw new ApiError(httpStatus.BAD_REQUEST, "Error: User not found.");
		}

		// ✅ Compare password
		const validPassword = await bcrypt.compare(password, admin.password);
		if (!validPassword) {
			throw new ApiError(
				httpStatus.BAD_REQUEST,
				"Error: Invalid email or password. Please try again."
			);
		}

		// ✅ Generate JWT token
		const token = jwt.sign(
			{
				id: admin._id,
				role_id: admin.role_id,
				department_id: admin.department_id || null,
				is_blacklisted: false,
			},
		  Buffer.from(config.constants.jwt.secret, "hex"),
			{ algorithm: "HS256", expiresIn: "5d" }
		);

		// ✅ Build response
		const response = {
			id: admin._id,
			name: admin.name,
			email: admin.email,
			role_id: admin.role_id,
			token,
		};

		return response;
	} catch (error: any) {
		throw new ApiError(
			error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
			error.message
		);
	}
};

export const sendOTP = async (body) => {
  try {
    const { email } = body;
    const admin = await Admin.findOne({ email });

    if (!admin) throw new ApiError(httpStatus.NOT_FOUND, "Admin not found");

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Optional: hash before storing (recommended)
    const hashedOTP = await bcrypt.hash(otp, 10);

    admin.otp = hashedOTP;
    admin.is_otp_valid = true;
    await admin.save();

    await sendForgotPasswordOTP(email, otp);

    return { message: "OTP sent successfully" };
  } catch (error) {
    throw new ApiError(
      error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

export const verifyOTP = async (body) => {
  try {
    const { email, otp, otp_type } = body;

    if (!email || !otp)
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Please provide both email and OTP"
      );

    const admin = await Admin.findOne({ email });
    if (!admin) throw new ApiError(httpStatus.NOT_FOUND, "Invalid email");

    if (!admin.is_otp_valid || !admin.otp)
      throw new ApiError(httpStatus.BAD_REQUEST, "OTP has expired or is invalid");

    // Compare OTP hash
    const isMatch = await bcrypt.compare(otp, admin.otp);
    if (!isMatch)
      throw new ApiError(httpStatus.BAD_REQUEST, "Invalid OTP entered");

    let token = "";

    // Issue token if FORGOT PASSWORD
    if (otp_type === otpTypes.FORGOT_PASSWORD) {
      token = jwt.sign(
        {
          id: admin._id,
          role_id: admin.role_id,
          is_backlisted: false,
        },
        config.constants.jwt.secret,
        { algorithm: "HS256", expiresIn: "1d" }
      );

      admin.remember_token = token;
    }

    // Invalidate OTP after successful use
    admin.otp = null;
    admin.is_otp_valid = false;
    await admin.save();

    return token
      ? { token, message: "OTP verified successfully" }
      : { message: "OTP verified successfully" };
  } catch (error) {
    throw new ApiError(
      error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

export const forgotAdminPassword = async (reqBody) => {
  try {
    const { email, password, confirm_password, token } = reqBody;

    if (!email || !password || !confirm_password || !token) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Please provide: email, password, confirm_password, token"
      );
    }

    if (password !== confirm_password) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Password and confirm password must match"
      );
    }

    // Verify JWT
    let decoded;
    try {
      decoded = jwt.verify(token, config.constants.jwt.secret);
    } catch (e) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Invalid or expired token");
    }

    const admin = await Admin.findOne({
      _id: decoded.id,
      email,
      remember_token: token,
      is_active: true,
    });

    if (!admin) {
      throw new ApiError(httpStatus.NOT_FOUND, "Invalid email or token");
    }

    const salt = bcrypt.genSaltSync(10);
    const hashedPassword = bcrypt.hashSync(password, salt);

    admin.password = hashedPassword;
    admin.remember_token = null;
    await admin.save();

    return { message: "Password changed successfully" };
  } catch (error) {
    throw new ApiError(
      error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

export const resetAdminPassword = async (reqBody) => {
  try {
    const { admin_id, old_password, new_password, confirm_password } = reqBody;

    if (!admin_id || !old_password || !new_password || !confirm_password) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Please enter all required fields: [ admin_id, old_password, new_password, confirm_password ]"
      );
    }

    // ✅ Validate new and confirm passwords match
    if (new_password !== confirm_password) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "New password and confirm password do not match."
      );
    }

    const admin = await Admin.findById(admin_id);
    if (!admin) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Admin not found.");
    }

    const validPass = await bcrypt.compare(old_password, admin.password);
    if (!validPass) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Incorrect old password.");
    }

    const hashedPassword = await bcrypt.hash(new_password, 10);
    admin.password = hashedPassword;
    await admin.save();

    return "Password changed successfully.";
  } catch (error) {
    throw new ApiError(
      error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};


export const getProfile = async (body: BodyDefinition) => {
  try {
    const { user } = body;
    if (!user)
      throw new ApiError(httpStatus.BAD_REQUEST, "Failed to Get Profile.");
    return user;
  } catch (error) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

export const getAllAdmins = async () => {
  try {
    const admins = await Admin.find().select("-password");
    return admins;
  } catch (error) {
    throw new ApiError(
      error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

export const findAdminById = async (id) => {
  try {
    const admin = await Admin.findById(id).select("-password");
    if (!admin)
      throw new ApiError(httpStatus.NOT_FOUND, "Admin not found");
    return admin;
  } catch (error) {
    throw new ApiError(
      error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

export const updateAdmin = async (body) => {
  try {
    const { id, name, email, password, role_id } = body;

    const admin = await Admin.findById(id);
    if (!admin)
      throw new ApiError(httpStatus.NOT_FOUND, "Admin not found");

    // ✅ Check if email is changing and unique
    if (email && email !== admin.email) {
      const exists = await Admin.findOne({ email });
      if (exists)
        throw new ApiError(httpStatus.BAD_REQUEST, "Email already taken");
      admin.email = email;
    }

    // ✅ Update only provided fields
    if (name) admin.name = name;
    if (role_id) admin.role_id = role_id;

  

    await admin.save();
    return admin;
  } catch (error) {
    throw new ApiError(
      error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

export const deleteAdmin = async (body) => {
  try {
    const { id } = body;
    const admin = await Admin.findById(id);
    if (!admin)
      throw new ApiError(httpStatus.NOT_FOUND, "Admin not found");

    await admin.deleteOne();
    return { message: "Admin deleted successfully" };
  } catch (error) {
    throw new ApiError(
      error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};
