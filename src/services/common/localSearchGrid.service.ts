/* eslint-disable @typescript-eslint/no-explicit-any */
import httpStatus from 'http-status';

import { LocalSearchGridReport } from '../../models';
import { ApiError, mongoFunctions } from '../../utils';
import { mongoOperationsTypes } from '../../configs/constantTypes';
import { BodyDefinition } from '../../types/RouteDefinition';
import { localSearchGridSelect } from '../../constants';
import { generateGrid, getKeywordAverageRank, getLocalRankWithSerp, getUULE } from '../../helpers';

export const getLocalSearchGridReport = async (body: BodyDefinition): Promise<any> => {
	try {
		const { locationDoc } = body;

        const localSearchGridReportDoc = await mongoFunctions({
            selectedFields: localSearchGridSelect,
            condition: {location_id: locationDoc._id, is_active: true},
            schema: LocalSearchGridReport,
			operationType: mongoOperationsTypes.FIND_ONE,
        });
        if(!localSearchGridReportDoc){
            throw new ApiError(
				httpStatus.BAD_REQUEST,
				'No report found for this location.',
			);
        };

        return {localSearchGridReportDoc, locationDoc};
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

export const generateLocalSearchGridReport = async (body: BodyDefinition): Promise<any> => {
	try {
		const { location_id, scheduling, keywords, map_criteria, user, locationDoc } = body;
		const { latitude, longitude, grid_size, spacing, unit, max_points } = map_criteria;

		const reportObj = {
			location_id,
			created_by: user._id,
			scheduling,
			keyword_list: keywords,
			map_criteria,
			total_keywords: keywords?.length,
		};

		const locationUuleId = await getUULE(latitude, longitude);
		if (!locationUuleId){
            throw new ApiError(
				httpStatus.BAD_REQUEST,
				'Failed to get location locationUuleId.',
			);
        }

		const localGridSearchResults: any[] = [];

		for (const keyword of keywords || []) {
			const competitors = await getKeywordAverageRank(keyword, locationUuleId);
            if(competitors && competitors.length >0){
                localGridSearchResults.push({
                    keyword,
                    latitude: latitude,
                    longitude: longitude,
                    competitors: competitors
                });
            }
		}
        if(localGridSearchResults){
            reportObj['keywords'] = localGridSearchResults;
        }
        await LocalSearchGridReport.deleteOne({ location_id: locationDoc._id, is_active: true });
		await mongoFunctions({
			schema: LocalSearchGridReport,
			createData: reportObj,
			operationType: mongoOperationsTypes.CREATE,
		});

		return '';
	} catch (error) {
		throw new ApiError(
			error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
			error.message
		);
	}
};


