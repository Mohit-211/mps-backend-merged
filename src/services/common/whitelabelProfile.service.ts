/* eslint-disable @typescript-eslint/no-explicit-any */
import httpStatus from 'http-status';

import { ApiError, isValidMongoObjectId, mongoFunctions } from '../../utils';
import { BodyDefinition,FilesDefinition, ParamsDefinition } from '../../types/RouteDefinition';
import { WhitelabelProfile } from '../../models';
import { mongoOperationsTypes } from '../../configs/constantTypes';
import { whitelabelProfileSelect } from '../../constants';


export const createNewProfile = async (body: BodyDefinition, files:FilesDefinition): Promise<any> => {
	try {
		const { user, name, header, footer, color } = body;

        let whiteLabelProfileObj: any = {
            created_by: user._id,
            name, 
            header, 
            footer,
            color,
        }

        if (files && Object.keys(files).length !== 0 && files.images && files.images.length !== 0) {

            for (let i = 0; i < files.images.length; i++) {
                let currImage = files.images[i];
                whiteLabelProfileObj.file_type = 'Image';
                whiteLabelProfileObj.file_name = currImage.filename;
                whiteLabelProfileObj.file_uri = '/images';
                whiteLabelProfileObj.file_size = currImage.size;
            }
        }else{
            throw new ApiError(httpStatus.BAD_REQUEST,'Please Provide a logo');
        }
        await mongoFunctions({
            schema: WhitelabelProfile,
            createData: whiteLabelProfileObj,
            operationType: mongoOperationsTypes.CREATE

        })

        return ''
          
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};


export const updateWhiteLabelProfile = async (body: BodyDefinition, files:FilesDefinition): Promise<any> => {
	try {
		const { user, name, header, footer, color, locationDoc, white_label_profile_id, external_reports_lists } = body;
        
        const whiteLabelProfileDoc = await WhitelabelProfile.findOne({_id: white_label_profile_id, created_by: user._id, is_active: true});
        if(!whiteLabelProfileDoc){
            throw new ApiError(httpStatus.BAD_REQUEST,'Invalid white_label_profile_id');
        }
        if(locationDoc){
            whiteLabelProfileDoc.location_id = locationDoc._id;
        }

        if(name && name !== 'undefined' && whiteLabelProfileDoc.name !== name){
            whiteLabelProfileDoc.name = name
        }
        if(header && header !== 'undefined' && whiteLabelProfileDoc.header !== header){
            whiteLabelProfileDoc.header = header
        }
        if(footer && footer !== 'undefined' && whiteLabelProfileDoc.footer !== footer){
            whiteLabelProfileDoc.footer = footer
        }
        if(color && color !== 'undefined' && whiteLabelProfileDoc.color !== color){
            whiteLabelProfileDoc.color = color
        }
        if(external_reports_lists && typeof external_reports_lists === 'object'){
            whiteLabelProfileDoc.external_reports_lists = external_reports_lists
        }

        if (files && Object.keys(files).length !== 0 && files.images && files.images.length !== 0) {

            for (let i = 0; i < files.images.length; i++) {
                let currImage = files.images[i];
                whiteLabelProfileDoc.file_type = 'Image';
                whiteLabelProfileDoc.file_name = currImage.filename;
                whiteLabelProfileDoc.file_uri = '/images';
                whiteLabelProfileDoc.file_size = currImage.size;
            }
        }
        await whiteLabelProfileDoc.save()

        return ''
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

export const getWhiteLabelProfile = async (body: BodyDefinition): Promise<any> => {
    try {
        const { user } = body;
        const whiteLevelProfileDocs = await mongoFunctions({
            schema: WhitelabelProfile,
            condition: {created_by: user._id, is_active: true},
            operationType: mongoOperationsTypes.FIND,
            selectedFields: whitelabelProfileSelect,
        });
        if (!whiteLevelProfileDocs) {
            throw new ApiError(
                httpStatus.INTERNAL_SERVER_ERROR,
                'Failed to fetch white level profiles',
            );
        }
        return whiteLevelProfileDocs;
    } catch (error) {
        throw new ApiError(
            error.statusCode
                ? error.statusCode
                : httpStatus.INTERNAL_SERVER_ERROR,
            error.message,
        );
    }
};

export const getWhiteLabelProfileDetail = async (body: BodyDefinition, params: ParamsDefinition): Promise<any> => {
    try {
        const { whiteLevelProfileId } = params;
        if(!isValidMongoObjectId(whiteLevelProfileId)){
            throw new ApiError(httpStatus.BAD_REQUEST,'Invalid White Level Profile Id provided');
        }

        const whiteLevelProfileDocs = await mongoFunctions({
            schema: WhitelabelProfile,
            condition: {_id: whiteLevelProfileId, is_active: true},
            operationType: mongoOperationsTypes.FIND,
            selectedFields: whitelabelProfileSelect,
        });
        if (!whiteLevelProfileDocs) {
            throw new ApiError(
                httpStatus.INTERNAL_SERVER_ERROR,
                'Failed to fetch white level profile detail',
            );
        }

        return whiteLevelProfileDocs;
    } catch (error) {
        throw new ApiError(
            error.statusCode
                ? error.statusCode
                : httpStatus.INTERNAL_SERVER_ERROR,
            error.message,
        );
    }
};

export const deleteWhiteLevelProfile = async (body: BodyDefinition, params: ParamsDefinition): Promise<any> => {
    try {
        const { whiteLevelProfileId } = params;
        const { user } = body;

        if(!isValidMongoObjectId(whiteLevelProfileId)){
            throw new ApiError(httpStatus.BAD_REQUEST,'Invalid White Level Profile Id provided');
        }

        await mongoFunctions({
            schema: WhitelabelProfile,
            condition: {_id: whiteLevelProfileId, is_active: true, created_by: user._id},
            operationType: mongoOperationsTypes.DELETE_ONE,
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