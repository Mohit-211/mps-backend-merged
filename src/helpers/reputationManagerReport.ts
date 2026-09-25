import httpStatus from 'http-status';
import axios from 'axios';
import { getJson } from "serpapi";

import { ApiError } from '../utils';
import configs from '../configs/config';

export const fetchAllReviews = async (placeId: string) => {
    const params = {
        engine: 'google_maps_reviews',
        place_id: placeId,
        type: 'reviews',
        sort_by: 'newestFirst',
    } as {
        engine: string;
        place_id: string;
        type: string;
        sort_by: string;
        next_page_token?: string;
    };
    
    let allReviews = [];
    let placeInfo = {};
    let nextPageToken = null;

    try {
        do {
            if (nextPageToken) {
                params.next_page_token = nextPageToken;
            }

            const data = await getJson(params);
            
            if (data.place_info) {
                placeInfo = data.place_info;
            }

            if (data.reviews) {
                allReviews = allReviews.concat(data.reviews);
            }

            if (data.serpapi_pagination && data.serpapi_pagination.next_page_token) {
                nextPageToken = data.serpapi_pagination.next_page_token;
            } else {
                nextPageToken = null;
            }
        } while (nextPageToken);

        return {
            placeInfo,
            reviews: allReviews,
        };
    } catch (error) {
        throw new ApiError(
            error.response?.status || httpStatus.INTERNAL_SERVER_ERROR,
            error.message
        );
    }
};

export function formatDate(dateString: string): string {
    const date = new Date(dateString);

    const day = date.getDate();
    const month = date.toLocaleString('default', { month: 'short' });
    const year = date.getFullYear();

    const daySuffix = (day: number): string => {
        if (day > 3 && day < 21) return 'th';
        switch (day % 10) {
            case 1: return 'st';
            case 2: return 'nd';
            case 3: return 'rd';
            default: return 'th';
        }
    };

    return `${day}${daySuffix(day)} ${month} ${year}`;
};