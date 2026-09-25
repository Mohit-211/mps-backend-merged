import httpStatus from 'http-status';
import { Language } from '../../models';
import { ApiError } from '../../utils';
import { QueryDefinition } from '../../types/RouteDefinition';

export const getAllLanguage = async (query: QueryDefinition) => {
	try {
		const { limit, offset } = query;
		const languageDocs = await Language.getAll(limit, offset);
		if (!languageDocs) {
			throw new ApiError(
				httpStatus.INTERNAL_SERVER_ERROR,
				'Failed to get languages',
			);
		}
		return languageDocs;
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};