import httpStatus from 'http-status';
import logger from '../configs/logger';
import { getJson } from "serpapi";

import { ApiError } from '../utils';


export async function searchCitationWithSerpAPI(query: any) {
    try{
        const params = {
            q: query,
            hl: "en",  
            gl: "us", 
        };

        const data = await getJson("google", params);
        return data;
    }catch(error){
        logger.error(`citation helper failed: ${(error as Error)?.message}`);
        throw new ApiError(error?.statusCode || httpStatus.INTERNAL_SERVER_ERROR, error?.message || "Unknown error");

    }
};
