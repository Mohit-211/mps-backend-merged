/** @format */

import crypto from "crypto";
import bcrypt from "bcryptjs";
import httpStatus from "http-status";
import { BodyDefinition } from "../../types/RouteDefinition";
import { Admin, IAdmin, Role } from "../../models";
import { ApiError, apiErrorWithData } from "../../utils";
import { sendAdminCredential, sendForgotPasswordOTP } from "../common/email.service";
import config from "../../configs/config";
import { otpTypes } from "../../configs/constantTypes";
import { LIMITS, hit } from "../auth/rateLimit";
import { hashAdminToken, signAdminToken, verifyAdminToken } from "./adminToken";

// Platform admin accounts (Phase 10 hardening, AUDIT S1, S6, S14, S19, S22):
// - tokens come from adminToken.ts only (ADMIN_JWT_SECRET; session 12 h, password reset 15 min);
// - passwords and OTPs from crypto; OTPs hashed, 10 minutes, 5 attempts; reset tokens stored hashed, single use;
// - sign-in and OTP requests are rate-limited (Mongo counters, per email and IP);
// - token_version is incremented on password change, role change and deactivation (revokes tokens);
// - request values are coerced to strings before they reach a filter (no operator injection);
// - responses never carry password, OTP or reset-token fields.

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const SAFE_FIELDS = "-password -otp -remember_token -otp_expires_at -otp_attempts -token_version";

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const email = (v: unknown): string => str(v).toLowerCase();

const invalidCredentials = () => new ApiError(httpStatus.BAD_REQUEST, "Invalid email or password.");

const sessionFor = (admin: Pick<IAdmin, "_id" | "role_id" | "token_version">) =>
	signAdminToken({ sub: String(admin._id), role_id: admin.role_id as number, tv: admin.token_version ?? 0 });

const safeView = (admin: IAdmin) => {
	const raw = typeof (admin as unknown as { toObject?: () => Record<string, unknown> }).toObject === "function"
		? (admin as unknown as { toObject: () => Record<string, unknown> }).toObject()
		: { ...(admin as unknown as Record<string, unknown>) };
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { password, otp, remember_token, otp_expires_at, otp_attempts, token_version, ...safe } = raw;
	return safe;
};

export const createAdminUser = async (body: { email?: unknown; name?: unknown; role_id?: unknown }) => {
	const addr = email(body.email);
	const name = str(body.name);
	const roleId = Number(body.role_id);
	if (!addr || !name || !Number.isInteger(roleId)) throw new ApiError(httpStatus.BAD_REQUEST, "Please provide: email, name, role_id");
	if (await Admin.findOne({ email: addr })) throw new ApiError(httpStatus.BAD_REQUEST, "Email already exists");
	const roleDoc = await Role.findOne({ role_id: roleId, is_active: true });
	if (!roleDoc) throw new ApiError(httpStatus.BAD_REQUEST, "Invalid role_id");

	// A temporary password from crypto (was Math.random), sent once by email; the admin changes it.
	const plainPassword = crypto.randomBytes(12).toString("base64url");
	const adminDoc = await Admin.create({ name, email: addr, role_id: roleId, password: bcrypt.hashSync(plainPassword, 10) });
	const mailSent = await sendAdminCredential(addr, plainPassword, roleDoc.name);
	if (!mailSent) throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, "Unable to send credentials email");
	return safeView(adminDoc);
};

export const loginAdminUser = async (body: { email?: unknown; password?: unknown; ip_address?: string }) => {
	const addr = email(body.email);
	const password = str(body.password);
	if (!addr || !password) throw invalidCredentials();
	await hit(LIMITS.adminLoginPerEmailIp, [addr, body.ip_address ?? "unknown"]);
	const admin = await Admin.findOne({ email: addr, is_active: true });
	if (!admin?.password || !(await bcrypt.compare(password, admin.password))) throw invalidCredentials();
	if (!(await Role.exists({ role_id: admin.role_id, is_active: true }))) throw invalidCredentials();
	return { id: admin._id, name: admin.name, email: admin.email, role_id: admin.role_id, token: sessionFor(admin) };
};

/** Always answers the same, so the endpoint doesn't reveal which emails are admins. */
export const sendOTP = async (body: { email?: unknown; ip_address?: string }) => {
	const addr = email(body.email);
	if (!addr) throw new ApiError(httpStatus.BAD_REQUEST, "Please provide: email");
	await hit(LIMITS.adminOtpPerEmail, [addr]);
	await hit(LIMITS.adminOtpPerIp, [body.ip_address ?? "unknown"]);
	const admin = await Admin.findOne({ email: addr, is_active: true });
	if (admin) {
		const otp = String(crypto.randomInt(100000, 1000000));
		admin.otp = await bcrypt.hash(otp, 10);
		admin.is_otp_valid = true;
		admin.otp_expires_at = new Date(Date.now() + OTP_TTL_MS);
		admin.otp_attempts = 0;
		await admin.save();
		await sendForgotPasswordOTP(addr, otp);
	}
	return { message: "If this email belongs to an administrator, a code has been sent." };
};

export const verifyOTP = async (body: { email?: unknown; otp?: unknown; otp_type?: unknown; ip_address?: string }) => {
	const addr = email(body.email);
	const otp = str(body.otp);
	if (!addr || !otp) throw new ApiError(httpStatus.BAD_REQUEST, "Please provide both email and OTP");
	await hit(LIMITS.adminOtpPerIp, [body.ip_address ?? "unknown"]);
	const invalid = () => apiErrorWithData(httpStatus.BAD_REQUEST, "The code is invalid or has expired.", { reason: "invalid_code" });
	const admin = await Admin.findOne({ email: addr, is_active: true });
	if (!admin || !admin.is_otp_valid || !admin.otp || !admin.otp_expires_at || admin.otp_expires_at.getTime() < Date.now()) throw invalid();
	if ((admin.otp_attempts ?? 0) >= OTP_MAX_ATTEMPTS) throw invalid();
	if (!(await bcrypt.compare(otp, admin.otp))) {
		admin.otp_attempts = (admin.otp_attempts ?? 0) + 1;
		await admin.save();
		throw invalid();
	}
	let token = "";
	if (str(body.otp_type) === otpTypes.FORGOT_PASSWORD) {
		token = signAdminToken({ sub: String(admin._id), role_id: admin.role_id as number, tv: admin.token_version ?? 0 }, "password_reset");
		admin.remember_token = hashAdminToken(token);
	}
	admin.otp = null as unknown as string;
	admin.is_otp_valid = false;
	admin.otp_expires_at = null;
	admin.otp_attempts = 0;
	await admin.save();
	return token ? { token, message: "OTP verified successfully" } : { message: "OTP verified successfully" };
};

/** Sets a new password with the single-use reset token from verifyOTP; revokes every earlier token. */
export const forgotAdminPassword = async (reqBody: { email?: unknown; password?: unknown; confirm_password?: unknown; token?: unknown }) => {
	const addr = email(reqBody.email);
	const password = str(reqBody.password);
	const token = str(reqBody.token);
	if (!addr || !password || !reqBody.confirm_password || !token) {
		throw new ApiError(httpStatus.BAD_REQUEST, "Please provide: email, password, confirm_password, token");
	}
	if (password !== str(reqBody.confirm_password)) throw new ApiError(httpStatus.BAD_REQUEST, "Password and confirm password must match");
	let claims;
	try {
		claims = verifyAdminToken(token, "password_reset");
	} catch {
		throw new ApiError(httpStatus.BAD_REQUEST, "Invalid or expired token");
	}
	const admin = await Admin.findOne({ _id: claims.sub, email: addr, remember_token: hashAdminToken(token), is_active: true });
	if (!admin) throw new ApiError(httpStatus.BAD_REQUEST, "Invalid or expired token");
	admin.password = bcrypt.hashSync(password, 10);
	admin.remember_token = null as unknown as string;
	admin.token_version = (admin.token_version ?? 0) + 1;
	await admin.save();
	return { message: "Password changed successfully" };
};

/** Change the signed-in admin's own password (the id comes from the token, never from the body). */
export const resetAdminPassword = async (adminId: string, reqBody: { old_password?: unknown; new_password?: unknown; confirm_password?: unknown }) => {
	const oldPassword = str(reqBody.old_password);
	const newPassword = str(reqBody.new_password);
	if (!oldPassword || !newPassword || !reqBody.confirm_password) {
		throw new ApiError(httpStatus.BAD_REQUEST, "Please enter all required fields: [ old_password, new_password, confirm_password ]");
	}
	if (newPassword !== str(reqBody.confirm_password)) throw new ApiError(httpStatus.BAD_REQUEST, "New password and confirm password do not match.");
	const admin = await Admin.findById(adminId);
	if (!admin?.password || !(await bcrypt.compare(oldPassword, admin.password))) throw new ApiError(httpStatus.BAD_REQUEST, "Incorrect old password.");
	admin.password = await bcrypt.hash(newPassword, 10);
	admin.token_version = (admin.token_version ?? 0) + 1;
	await admin.save();
	// Every other session is revoked; this one continues with a fresh token.
	return { message: "Password changed successfully.", token: sessionFor(admin) };
};

export const getProfile = async (body: BodyDefinition) => {
	const { user } = body;
	if (!user) throw new ApiError(httpStatus.BAD_REQUEST, "Failed to Get Profile.");
	return user;
};

export const getAllAdmins = async () => Admin.find().select(SAFE_FIELDS);

export const findAdminById = async (id: string) => {
	const admin = await Admin.findById(id).select(SAFE_FIELDS);
	if (!admin) throw new ApiError(httpStatus.NOT_FOUND, "Admin not found");
	return admin;
};

/** Super admin only (route guard). An admin can't change their own role; a role change revokes the admin's tokens. */
export const updateAdmin = async (actorId: string, body: { id?: unknown; name?: unknown; email?: unknown; role_id?: unknown }) => {
	const id = str(body.id);
	const admin = id ? await Admin.findById(id) : null;
	if (!admin) throw new ApiError(httpStatus.NOT_FOUND, "Admin not found");
	const newEmail = email(body.email);
	if (newEmail && newEmail !== admin.email) {
		if (await Admin.findOne({ email: newEmail })) throw new ApiError(httpStatus.BAD_REQUEST, "Email already taken");
		admin.email = newEmail;
		admin.token_version = (admin.token_version ?? 0) + 1;
	}
	const name = str(body.name);
	if (name) admin.name = name;
	if (body.role_id !== undefined && body.role_id !== null && body.role_id !== "") {
		const roleId = Number(body.role_id);
		if (String(admin._id) === actorId) throw apiErrorWithData(httpStatus.FORBIDDEN, "You can't change your own role.", { reason: "own_role" });
		if (!Number.isInteger(roleId) || !(await Role.exists({ role_id: roleId, is_active: true }))) throw new ApiError(httpStatus.BAD_REQUEST, "Invalid role_id");
		if (roleId !== admin.role_id) {
			admin.role_id = roleId;
			admin.token_version = (admin.token_version ?? 0) + 1;
		}
	}
	await admin.save();
	return safeView(admin);
};

export const deleteAdmin = async (actorId: string, body: { id?: unknown }) => {
	const id = str(body.id);
	if (id === actorId) throw apiErrorWithData(httpStatus.FORBIDDEN, "You can't delete your own account.", { reason: "own_account" });
	const admin = id ? await Admin.findById(id) : null;
	if (!admin) throw new ApiError(httpStatus.NOT_FOUND, "Admin not found");
	if (admin.role_id === config.roles.superAdmin && (await Admin.countDocuments({ role_id: config.roles.superAdmin, is_active: true })) <= 1) {
		throw apiErrorWithData(httpStatus.FORBIDDEN, "The last super admin can't be deleted.", { reason: "last_super_admin" });
	}
	await admin.deleteOne();
	return { message: "Admin deleted successfully" };
};
