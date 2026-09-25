/** @format */

import httpStatus from "http-status";
import { adminAuthService } from "../../services";
import { catchAsync, pick, responseWrapper, validatePassword } from "../../utils";


export const createAdminUser = catchAsync(async (req, res) => {
  await adminAuthService.createAdminUser(req.body);
  return responseWrapper(res, "", "Admin Created Successfully.", httpStatus.CREATED);
});


export const loginAdminUser = catchAsync(async (req, res) => {
  const response = await adminAuthService.loginAdminUser(req.body);
  return responseWrapper(res, response, "Successfully Logged in.", httpStatus.OK);
});


export const sendOTP = catchAsync(async (req, res) => {
  const result = await adminAuthService.sendOTP(req.body);
  return responseWrapper(res, result, "OTP has been sent to your email.", httpStatus.OK);
});


export const verifyOTP = catchAsync(async (req, res) => {
  const result = await adminAuthService.verifyOTP(req.body);
  return responseWrapper(res, result, "OTP has been verified.", httpStatus.OK);
});


export const forgotAdminPassword = catchAsync(async (req, res) => {
  const response = await adminAuthService.forgotAdminPassword(req.body);
  return responseWrapper(res, response, "Password changed successfully.", httpStatus.OK);
});


export const resetAdminPassword = catchAsync(async (req, res) => {
  const response = await adminAuthService.resetAdminPassword(req.body);
  return responseWrapper(res, response, "Password changed successfully.", httpStatus.OK);
});


export const getProfile = catchAsync(async (req, res) => {
  const body = pick(req.body, ["user"]);
  const response = await adminAuthService.getProfile(body);
  return responseWrapper(res, response, "Successfully fetched profile.", httpStatus.OK);
});


export const getAllAdmins = catchAsync(async (req, res) => {
  const result = await adminAuthService.getAllAdmins();
  return responseWrapper(res, result, "All admins fetched successfully.", httpStatus.OK);
});


export const findAdminById = catchAsync(async (req, res) => {
 
  const adminDoc = await adminAuthService.findAdminById(req.params.id);
  return responseWrapper(res, adminDoc, "Admin details fetched successfully.", httpStatus.OK);
});


export const updateAdmin = catchAsync(async (req, res) => {
  const response = await adminAuthService.updateAdmin(req.body);
  return responseWrapper(res, response, "Admin updated successfully.", httpStatus.OK);
});


export const deleteAdmin = catchAsync(async (req, res) => {
  await adminAuthService.deleteAdmin(req.body);
  return responseWrapper(res, "", "Admin deleted successfully.", httpStatus.OK);
});
