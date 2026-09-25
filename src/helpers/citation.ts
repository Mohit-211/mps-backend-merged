import httpStatus from 'http-status';
import { getJson } from "serpapi";

import { ICompetitor, ILocation } from '../models';
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
        console.log("11111111111111111", error)
        throw new ApiError(error?.statusCode || httpStatus.INTERNAL_SERVER_ERROR, error?.message || "Unknown error");

    }
};
