/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-inferrable-types */
import { Response } from 'express';

interface ResponseWrapperInterface {
  success: boolean;
  status: number;
  message: string;
  data: any;
};

function responseWrapper(res: Response, data: any, message: string = 'Completed Successfully.', status: number = 200): Response<ResponseWrapperInterface> {
  res.locals.message = message;
  return res.status(status).json({
    success: status >= 200 && status < 300,
    status: status,
    message: message,
    data: data,
  });
};

export default responseWrapper;
