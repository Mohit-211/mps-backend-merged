import { Request, Response, NextFunction } from 'express';
import httpStatus from 'http-status';

import config from '../configs/config';
import pick from './pick';
import { queryTypes } from '../configs/constantTypes';
import responseWrapper from './responseWrapper';

const convertAndValidate = (
	parameter: string,
	param: unknown,
	type: string,
	positiveOnly = false,
) => {
	if (type === 'number') {
		const value = Number(param);
		if (isNaN(value)) {
			throw new Error(
				`Invalid value for ${parameter}: ${param}. Expected a valid number.`,
			);
		} else if (positiveOnly && value <= 0) {
			throw new Error(
				`Invalid value for ${parameter}: ${param}. Expected a positive number.`,
			);
		}
		return value;
	}
	return param;
};

const getQueryParams = (allowedParams: string[]) => {
	return (req: Request, res: Response, next: NextFunction) => {
		const query = pick(req.query, allowedParams);

		try {
			query[queryTypes.limit] = convertAndValidate(
				'limit',
				query[queryTypes.limit] || config.constants.defaultLimit,
				'number',
				true,
			);
			query[queryTypes.page] = convertAndValidate(
				queryTypes.page,
				query[queryTypes.page] || config.constants.defaultPageNo,
				'number',
				true,
			);
			query[queryTypes.sortBy] = query[queryTypes.sortBy] && ['asc', 'desc'].includes(query[queryTypes.sortBy]) ? query[queryTypes.sortBy] : config.constants.defaultDataOrder;
		} catch (error) {
			return responseWrapper(
				res,
				'',
				`Query parameter validation failed: ${error.message}`,
				httpStatus.BAD_REQUEST,
			);
		}

		const offset = (query[queryTypes.page] - 1) * query[queryTypes.limit];
		query[queryTypes.offset] = offset;

		req.query = {...req.query, ...query};
		next();
	};
};

export default getQueryParams;
