import httpStatus from 'http-status';
import axios from 'axios';


import { ApiError } from '../utils';
import config from '../configs/config';
import { ILocation } from '../models';

export const fetchNAPDatFromGoogle = async (placeId: string) => {
    const googlePlacesApiUrl = `https://maps.googleapis.com/maps/api/place/details/json`;

    const params = {
        fields: 'user_ratings_total,vicinity,name,formatted_phone_number,rating,photos,formatted_address,reviews,opening_hours,website,type,geometry/location',
        key: config.googleApis.placeApi.keySecret,
        place_id: placeId
    };

    try {
        const response = await axios.get(googlePlacesApiUrl, { params });
        const result = response.data.result;
        return result;
    } catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
    }
};

export async function fetchNearby(keyword: string, locationDoc: ILocation, napData: any) {
    try {
        const googlePlacesApiUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json`;

        const params = {
            key: config.googleApis.placeApi.keySecret,
            keyword: keyword,
            radius: 2000,
            location: `${napData.geometry.location.lat},${napData.geometry.location.lng}`,
        };
        const responseData = await axios.get(googlePlacesApiUrl, { params });
        const results = responseData.data.results.slice(0, 10);
        const domain = new URL(locationDoc.website_URL).hostname;

        const response = {
            name: keyword,
            self: {} as any,
            items: [] as any[],
        };

        const rankings: any = { [domain]: { rank: 51 } };

        // Fetch details in parallel
        const placeDetailsPromises = results.map((place: any) => fetchNAPDatFromGoogle(place.place_id));
        const placesDetails = await Promise.all(placeDetailsPromises);

        for (const [index, placeDetails] of placesDetails.entries()) {
            const place = results[index];
            const isLikelyVerified = !!(placeDetails.website || placeDetails.formatted_phone_number);
            const singleComparisonObj = {
                business_name: place.name || '',
                rank: index + 1,
                address: place.vicinity,
                verified: isLikelyVerified,
                citations: 0,
                key_citations: 0,
                links: 0,
                linking_domains: 0,
                website_authority: 0,
                review: place.user_ratings_total,
                rating: place.rating,
                photos: 0,
                categories: place.types,
            };

            const resultLink = placeDetails.website || null;

            if (resultLink && resultLink.includes(domain) && rankings[domain].rank === 51) {
                response.self = singleComparisonObj;
                rankings[domain].rank = index + 1;
            }

            if (response.items.length < 10 && !response.items.includes(singleComparisonObj)) {
                response.items.push(singleComparisonObj);
            }
        }

        return response;
    } catch (error: any) {
        throw new ApiError(
            error.response?.status || httpStatus.INTERNAL_SERVER_ERROR,
            error.message || 'An error occurred while fetching nearby places'
        );
    }
};

export async function fetchNapComparison(locationDoc: ILocation, napData: any) {
    try {
        let response = {
            user_supplied: {},
            google_listing: {},
        };
        response.user_supplied['name'] = locationDoc.name || '';
        response.google_listing['name'] = napData.name || '';

        response.user_supplied['address'] = locationDoc.address || '';
        response.google_listing['address'] = napData.formatted_address || '';

        response.user_supplied['phone_no'] = locationDoc.mobile || '';
        response.google_listing['phone_no'] = napData.formatted_phone_number || '';

        return response;
    } catch (error: any) {
        throw new ApiError(
            error.response?.status || httpStatus.INTERNAL_SERVER_ERROR,
            error.message || 'An error occurred while fetching nearby places'
        );
    }
};
