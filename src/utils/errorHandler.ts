/* eslint-disable @typescript-eslint/no-invalid-void-type */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response, NextFunction } from 'express';
import httpStatus from 'http-status';
import ApiError from './apiError';
import responseWrapper from './responseWrapper';

const apiErrorHandler = (err: Error, req: Request, res: Response, next: NextFunction): Response<any, Record<string, any>> | void => {
  next(err);
  if (err instanceof ApiError) {
    return responseWrapper(res, '', err.message, err.statusCode);
  } else {
    return responseWrapper(res, '', `An internal server error occurred: ${err}`, httpStatus.INTERNAL_SERVER_ERROR);
  }
};

export default apiErrorHandler;

