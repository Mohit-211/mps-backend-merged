class ApiError extends Error {
  public statusCode: number;
  public isOperational: boolean;
  /** Optional response body (e.g. { reason, used, limit }); the error handler returns it as `data`. */
  public data?: unknown;

  constructor(statusCode: number, message: string, isOperational = true, stack?: string) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;

    if (stack) {
      this.stack = stack;
    } else {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/** An ApiError whose response carries a data body (Phase 8: reasons for 403/409 answers). */
export const apiErrorWithData = (statusCode: number, message: string, data: unknown): ApiError => {
  const error = new ApiError(statusCode, message);
  error.data = data;
  return error;
};

export default ApiError;
