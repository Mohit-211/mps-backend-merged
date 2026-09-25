import { Request, Response, NextFunction } from 'express';
import allowedOrigins from './accessDomains';

const credentials = (req: Request, res: Response, next: NextFunction) => {
  const origin: string | undefined = req.headers.origin as string | undefined;

  // Set headers for preflight requests (OPTIONS)
  res.setHeader('Access-Control-Allow-Methods', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');

  // Check if the origin is allowed
  if (origin && allowedOrigins.includes(origin)) {
    // Only set the Access-Control-Allow-Origin header if the origin is allowed
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  next();
};

export default credentials;
