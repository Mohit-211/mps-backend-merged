import httpStatus from 'http-status';
import { Timezone } from '../../models';
import { ApiError } from '../../utils';
import { QueryDefinition } from '../../types/RouteDefinition';

export const getAllTimezone = async (query: QueryDefinition) => {
	try {
		const { limit, offset } = query;
		const timezoneDocs = await Timezone.getAll(limit, offset);
		if (!timezoneDocs) {
			throw new ApiError(
				httpStatus.INTERNAL_SERVER_ERROR,
				'Failed to get timezones',
			);
		}
		return timezoneDocs;
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};