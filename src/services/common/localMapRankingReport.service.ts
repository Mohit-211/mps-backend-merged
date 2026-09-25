/* eslint-disable @typescript-eslint/no-explicit-any */
import httpStatus from 'http-status';

import { LocalMapRankingReport } from '../../models';
import { ApiError, mongoFunctions } from '../../utils';
import { mongoOperationsTypes } from '../../configs/constantTypes';
import { BodyDefinition } from '../../types/RouteDefinition';
import { localMapRankingSelect } from '../../constants';
import { getKeywordAverageMapRank } from '../../helpers';

export const getLocalMapRankingReport = async (body: BodyDefinition): Promise<any> => {
	try {
		const { locationDoc } = body;

        const localMapRankingReportDoc = await mongoFunctions({
            selectedFields: localMapRankingSelect,
            condition: {location_id: locationDoc._id, is_active: true},
            schema: LocalMapRankingReport,
			operationType: mongoOperationsTypes.FIND_ONE,
        });
        if(!localMapRankingReportDoc){
            throw new ApiError(
				httpStatus.BAD_REQUEST,
				'No report found for this location.',
			);
        };

        return {localMapRankingReportDoc, locationDoc};
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

export const generateLocalMapRankingReport = async (body: BodyDefinition): Promise<any> => {
	try {
		const { location_id, scheduling, keywords, map_criteria, user } = body;
		const { latitude, longitude } = map_criteria;

		const reportObj = {
			location_id,
			created_by: user._id,
			scheduling,
			keyword_list: keywords,
			map_criteria,
			total_keywords: keywords?.length,
		};

		const localMapSearchResults: any[] = [];
        // Need to uncomment when dynamic data needed
		for (const keyword of keywords || []) {
			const competitors = await getKeywordAverageMapRank(keyword, latitude, longitude);
            if(competitors && competitors.length >0){
                localMapSearchResults.push({
                    keyword,
                    latitude: latitude,
                    longitude: longitude,
                    competitors: competitors
                });
            }
		}
        if(localMapSearchResults){
            reportObj['keywords'] = localMapSearchResults;
        }
        await LocalMapRankingReport.deleteOne({ location_id: location_id, is_active: true });
		await mongoFunctions({
			schema: LocalMapRankingReport,
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


