/* eslint-disable @typescript-eslint/no-explicit-any */
import httpStatus from 'http-status';

import { ApiError, mongoFunctions } from '../../utils';
import { BodyDefinition } from '../../types/RouteDefinition';
import { fetchNapComparison, fetchNAPDatFromGoogle, fetchNearby, getDomainOverviewFromSEOMOZ, keywordPositionSearch } from '../../helpers';
import { GBPAuditReport } from '../../models';
import { mongoOperationsTypes } from '../../configs/constantTypes';

export const generateGBPAuditReport = async (body: BodyDefinition): Promise<any> => {
	try {
		const { location_id, scheduling, keywords, user, locationDoc } = body;

        let gbpAuditReportObj = {
            location_id,
            scheduling,
            keyword_list: keywords,
            created_by: user._id,
        };
        //Deleting the old report
        await GBPAuditReport.deleteOne({ location_id: locationDoc._id, is_active: true });

		await mongoFunctions({
			schema: GBPAuditReport,
			createData: gbpAuditReportObj,
			operationType: mongoOperationsTypes.CREATE,
		});
        return '';
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

export const getGBPAuditReport = async (body: BodyDefinition): Promise<any> => {
	try {
		const { locationDoc } = body;

        if(!locationDoc.place_id){
            throw new ApiError(
                httpStatus.BAD_REQUEST,
                'Please Register Your Business at Google Business Profile Console',
              );
        }
        const napData = await fetchNAPDatFromGoogle(locationDoc.place_id);

        const gbpAuditReportDoc = await mongoFunctions({
			schema: GBPAuditReport,
			condition: {is_active: true, location_id: locationDoc._id},
			operationType: mongoOperationsTypes.FIND_ONE,
        });
        if(!gbpAuditReportDoc){
            throw new ApiError(
                httpStatus.BAD_REQUEST,
                'No Reports Found with this location_id',
              );
        };
        const { keyword_list } = gbpAuditReportDoc;

        let response: any = {};
        for(const keyword of keyword_list){
            const googlePositionData = await fetchNearby(keyword, locationDoc, napData);
            response[keyword] = googlePositionData;
        };
        const napComparisonData = await fetchNapComparison(locationDoc, napData);

        gbpAuditReportDoc.place_details = napData;
        gbpAuditReportDoc.keywords = response;
        gbpAuditReportDoc.nap_comparison = napComparisonData;

        await gbpAuditReportDoc.save();
        return gbpAuditReportDoc;

	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};