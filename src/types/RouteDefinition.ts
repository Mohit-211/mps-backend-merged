/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response, NextFunction } from 'express';

export interface RouteDefinition {
  path: string;
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  handler: (req: Request, res: Response, next: NextFunction) => void;
}

export interface QueryDefinition {
  sortBy?: string;
  limit?: number;
  page?: number;
  offset?: number;
  code?: string;
  state?: any;
  clientId?: string;
  keywords?: string[];
  [key: string]: unknown; 
}

export interface ParamsDefinition {
  id?: string;
  countryId?: string;
  stateId?: string;
  roleId?: string;
  faqId?: string;
  [key: string]: any; 
}

export interface BodyDefinition {
	name?: string;
  abbreviation?: string;
  [key: string]: any; 
}
export interface HeaderDefinition {
  authorization?: string;
  contentType?: string;
  [key: string]: any;
}

export interface FilesDefinition {
  [key: string]: any;
  files?: Express.Multer.File[];
}