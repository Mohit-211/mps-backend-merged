import httpStatus from 'http-status';
import axios from 'axios';
import { getJson } from "serpapi";


import { ApiError } from '../utils';
import config from '../configs/config';
import { ILocation } from '../models';
import { getShortCountryCode } from './getSerpCountryCode';

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

export async function keywordPositionSearch(keyword: string, locationDoc: ILocation) {
    try {
        const params = {
            q: keyword,
            google_domain: "google.com",
            gl: getShortCountryCode(locationDoc.country),
            hl: "en",
            engine: "google",
            num: 20,
        };
    
        const data = await getJson("google", params);
        const response = {
            self: {} as any,
            items: [] as any[],
        };

        if (data.organic_results && data.organic_results.length > 0) {
            const domain = new URL(locationDoc.website_URL).hostname;
            const rankings: any = {};
            rankings[domain] = { rank: 51 }; // Default rank to 51 (indicating not found)

            // Loop through organic results to find any of the domains
            data.organic_results.forEach((result: any, index: number) => {
                const singleComparisonObj = {
                    business_name: result.source || '',
                    rank: result.position || 0,
                    verified: false,
                    citations: 0,
                    key_citations: 0,
                    links: 0,
                    linking_domains: 0,
                    website_authority: 0,
                    review: 0,
                    rating: 0,
                    photos: 0,
                    category: result.snippet_highlighted_words ? result.snippet_highlighted_words[0]  : '',
                };
                
                const resultLink = result['displayed_link'];
                
                // Check if the current result's displayed link matches the domain
                if (resultLink.includes(domain) && rankings[domain].rank === 51) {
                    response.self = singleComparisonObj;
                };
                
                if(response.items.length < 10 ){
                    response.items.push(singleComparisonObj);
                };
            });
        }

        return response;
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
            let mozData: any = {};
            // if (resultLink) {
            //     mozData = await fetchMozData(resultLink);
            //     Object.assign(singleComparisonObj, mozData);
            // }

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

const fetchMozData = async (url: string) => {
    try {
        const data = await getDomainOverviewFromSEOMOZ([url]);
        return {
            website_authority: data?.domain_authority || 0,
            linking_domains: data?.root_domains_to_subdomain || 0,
            links: data?.external_pages_to_root_domain || 0,
        };
    } catch (error) {
        console.error('Error fetching Moz data:', error);
        return { website_authority: 0, linking_domains: 0, links: 0 };
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

export const getDomainOverviewFromSEOMOZ = async (domains: string[]): Promise<any> => {
	try {
        
        let response = await axios.post('https://lsapi.seomoz.com/v2/url_metrics', {
          targets: domains,
        }, {
          headers: {
            'Content-Type': 'application/json',
            'x-moz-token': config.seoMOZApis.keySecret
          }
        });
        return response.data.results[0];

	} catch (error) {
        console.log("11111111111111111111111", error)
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

