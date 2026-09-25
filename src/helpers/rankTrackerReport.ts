import { google } from 'googleapis';
import httpStatus from 'http-status';
import { getJson } from "serpapi";

import { MonthData, MonthlyData } from '../types/interfaces';
import { ICompetitor, ILocation } from '../models';
import { ApiError } from '../utils';
import { oAuth2Client } from '../configs/oAuth2Client';
import { tokenTypes } from '../configs/constantTypes';
import axios from 'axios'
import config from '../configs/config';
import serpCountries from '../configs/google-countries';
import googleDomain from '../configs/google-domains';
export interface PlaceTarget {
    key: string;
    name: string;
    domain?: string;
    place_id?: string;
    lat?: number;
    lng?: number;
    phone?: string;
    data_cid?: string;
}

export async function getAverageGooglePositionData(accessToken: string, locationDoc: ILocation) {
    try {
        const monthlyDeviceData = await getLastFiveMonthPosition('device', locationDoc.website_URL, accessToken);
        const monthlyDateData = await getLastFiveMonthPosition('date', locationDoc.website_URL, accessToken);
        const changePos = calculateChangeInPosition(monthlyDateData);
        const currentPos = monthlyDateData[monthlyDateData.length - 1].avg;

        let response = transformData(monthlyDeviceData, monthlyDateData, changePos, currentPos);
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

export const calculateChangeInPosition = (monthlyData: MonthlyData[]): number => {
    const latestMonth = parseFloat(monthlyData[monthlyData.length - 1].avg);
    const previousMonth = parseFloat(monthlyData[monthlyData.length - 2].avg);
    const change = previousMonth - latestMonth;
    return change;
};

// export function getDatesArr(num: number): MonthData[] {
//     const today = new Date();
//     const months: MonthData[] = [];
//     for (let i = 0; i < num; i++) {
//         const endDate = new Date(today.getFullYear(), today.getMonth() - i + 1, 0);
//         const startDate = new Date(today.getFullYear(), today.getMonth() - i, 1);
//         months.push({
//             label: startDate.toLocaleString('default', { month: 'short', year: 'numeric' }),
//             startDate: startDate.toISOString().split('T')[0],
//             endDate: endDate.toISOString().split('T')[0],
//         });
//     }
//     return months.reverse();
// };

export function getDatesArr(num: number): MonthData[] {
    const today = new Date();
    const months: MonthData[] = [];

    for (let i = 1; i <= num; i++) { // Start from 1 to go back correctly
        const startDate = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const endDate = new Date(today.getFullYear(), today.getMonth() - i + 1, 0);

        months.push({
            label: startDate.toLocaleString('default', { month: 'short', year: 'numeric' }),
            startDate: startDate.toISOString().split('T')[0],
            endDate: endDate.toISOString().split('T')[0],
        });
    }

    return months;
};



export async function getLastFiveMonthPosition(dimensions: string, url: string, accessToken: string) {

    try {

      const analyticsClient = oAuth2Client(tokenTypes.ANALYTICS);
analyticsClient.setCredentials({ access_token: accessToken });

const webmasters = google.webmasters({
    version: 'v3',
    auth: analyticsClient,
});
        const months = getDatesArr(5);
        let monthlyData: any = [];

        if (dimensions === 'device') {
            monthlyData = await Promise.all(months.map(async month => {
                const response = await webmasters.searchanalytics.query({
                    siteUrl: url,
                    requestBody: {
                        startDate: month.startDate,
                        endDate: month.endDate,
                        dimensions: [dimensions],  // date,device,page,query,country
                    },
                });

                const rows = response.data.rows || [];
                const deviceData = {
                    desktop: 0,
                    mobile: 0,
                    tablet: 0,
                    countDesktop: 0,
                    countMobile: 0,
                    countTablet: 0
                };

                rows.forEach(row => {
                    const deviceType = row.keys[0]; // Device type is the first key in the row
                    const avgPosition = row.position;
                    if (deviceType === 'DESKTOP') {
                        deviceData.desktop += avgPosition * row.impressions;
                        deviceData.countDesktop += row.impressions;
                    } else if (deviceType === 'MOBILE') {
                        deviceData.mobile += avgPosition * row.impressions;
                        deviceData.countMobile += row.impressions;
                    } else if (deviceType === 'TABLET') {
                        deviceData.tablet += avgPosition * row.impressions;
                        deviceData.countTablet += row.impressions;
                    }
                });

                const avgDesktop = deviceData.countDesktop ? (deviceData.desktop / deviceData.countDesktop).toFixed(1) : '0';
                const avgMobile = deviceData.countMobile ? (deviceData.mobile / deviceData.countMobile).toFixed(1) : '0';
                const avgTablet = deviceData.countTablet ? (deviceData.tablet / deviceData.countTablet).toFixed(1) : '0';

                return {
                    label: month.label,
                    avgDesktop: avgDesktop,
                    avgMobile: avgMobile,
                    avgTablet: avgTablet,
                };
            }));

        } else if (dimensions === 'date') {
            monthlyData = await Promise.all(months.map(async month => {
                const response = await webmasters.searchanalytics.query({
                    siteUrl: url,
                    requestBody: {
                        startDate: month.startDate,
                        endDate: month.endDate,
                        dimensions: [dimensions],  // date,device,page,query,country
                    },
                });
                const rows = response.data.rows || [];
                const totalPosition = rows.reduce((acc, row) => acc + row.position * row.impressions, 0);
                const totalImpressions = rows.reduce((acc, row) => acc + row.impressions, 0);
                const averagePosition = totalImpressions ? (totalPosition / totalImpressions).toFixed(1) : '0';

                return {
                    label: month.label,
                    avg: averagePosition,
                    totalImpressions,
                };
            }));

        } else if (dimensions === 'query') {
            monthlyData = []
        };
        return monthlyData;
    } catch (error) {
        throw new ApiError(
            error.statusCode
                ? error.statusCode
                : httpStatus.INTERNAL_SERVER_ERROR,
            error.message,
        );
    }
};

export function transformData(
    monthlyDeviceData: any,
    monthlyDateData: any,
    changePos: any,
    currentPos: any
): any {
    const dateDataLookup = monthlyDateData.reduce((acc, item) => {
        acc[item.label] = item;
        return acc;
    }, {});

    const transformed: any = {};
    monthlyDeviceData.forEach(item => {
        const dateItem = dateDataLookup[item.label];
        if (dateItem) {
            transformed[item.label] = {
                label: item.label,
                avgDesktop: item.avgDesktop,
                avgMobile: item.avgMobile,
                avgTablet: item.avgTablet,
                avg: dateItem.avg,
                totalImpressions: dateItem.totalImpressions
            };
        }
    });
    transformed.changePos = changePos.toFixed(1);
    transformed.currentPos = currentPos;

    return transformed;
};

export async function getKeywordMovmentData(accessToken: string, locationDoc: ILocation) {

    try {

        oAuth2Client.setCredentials({ access_token: accessToken });

        const webmasters = google.webmasters({
            version: 'v3',
            auth: oAuth2Client,
        });
        let months = getDatesArr(2);

        const monthlyData = await Promise.all(months.map(async month => {
            const response = await webmasters.searchanalytics.query({
                siteUrl: locationDoc.website_URL,
                requestBody: {
                    startDate: month.startDate,
                    endDate: month.endDate,
                    dimensions: ['query']
                }
            });

            return response.data.rows;
        }));

        const result = calculateMovement(monthlyData[0], monthlyData[1]);
        return result

    } catch (error) {
        throw new ApiError(
            error.statusCode
                ? error.statusCode
                : httpStatus.INTERNAL_SERVER_ERROR,
            error.message,
        );
    }
};

export function calculateMovement(prevMonthArr: any[], currMonthArr: any[]) {
    let positionalMovement = {
        gained: 0, lost: 0, change: 0
    };

    let keywordMovement = {
        up: 0, down: 0, change: 0, no_change: 0
    };

    let map1 = {};

    currMonthArr.forEach(elm => {
        map1[elm.keys[0]] = elm;
    });

    prevMonthArr.forEach(elm => {
        let currKeyWord = elm.keys[0];
        const position1 = map1[currKeyWord] ? map1[currKeyWord].position : undefined;
        const position2 = elm.position;

        if (position1 && position2) {
            map1[currKeyWord]['visited'] = true;
            if (position1 > position2) {
                keywordMovement.up++;
                let differance = position1 - position2;
                positionalMovement.gained = positionalMovement.gained + Math.floor(differance);

            } else if (position1 < position2) {
                keywordMovement.down++;
                let differance = position2 - position1;
                positionalMovement.lost = positionalMovement.lost + Math.floor(differance);
            } else {
                keywordMovement.no_change++;
            }

        };
    });

    positionalMovement['change'] = positionalMovement.gained - positionalMovement.lost;
    keywordMovement['change'] = keywordMovement.up - keywordMovement.down;

    const finalData = {
        "positional_movement": positionalMovement,
        "keyword_movement": keywordMovement,
        "total_keywords": prevMonthArr.length,
    };

    return finalData;
};

export async function getRankingTableData(locationDoc: ILocation, keywords: string[], competitors: ICompetitor[]) {

    try {
        const placeTargets: PlaceTarget[] = [];
        placeTargets.push({
            key: "self",
            name: locationDoc.name,
            domain: locationDoc.website_URL
                ? new URL(
                    locationDoc.website_URL.startsWith("http")
                        ? locationDoc.website_URL
                        : `https://${locationDoc.website_URL}`
                ).hostname.replace(/^www\./, "")
                : undefined,
            place_id: locationDoc.place_id || undefined,
            lat: locationDoc.lat || undefined,
            lng: locationDoc.lng || undefined,
            phone: locationDoc?.mobile || undefined,
            data_cid: (await getSerpPlaceCidMaping(locationDoc?.place_id))?.data_cid
        });

        const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
        await delay(300);
        for (let i = 0; i < competitors.length; i++) {
            const comp = competitors[i];

            const target: PlaceTarget = {
                key: `competitor_${i + 1}`,
                name: comp.name,
                domain: comp.website
                    ? new URL(
                        comp.website.startsWith("http")
                            ? comp.website
                            : `https://${comp.website}`
                    ).hostname.replace(/^www\./, "")
                    : undefined,
                place_id: comp.place_id || undefined,
                lat: comp.lat || undefined,
                lng: comp.lng || undefined,
                phone: comp.phone || undefined,
                data_cid: (await getSerpPlaceCidMaping(comp.place_id))?.data_cid
            };

            placeTargets.push(target);
            await delay(300);
        }

        let localPack = null;
        let localFinder = null;
        let desktopOrganic = null;
        let mobileOrganic = null;
        desktopOrganic = await getAllRankings(keywords, locationDoc, placeTargets, 'desktop')
        mobileOrganic = await getAllRankings(keywords, locationDoc, placeTargets, 'mobile')
        localPack = await getAllRankings(keywords, locationDoc, placeTargets, 'local-pack')
        localFinder = await getAllRankings(keywords, locationDoc, placeTargets, 'local-finder')

        return {
            desktopOrganic: desktopOrganic,
            mobileOrganic: mobileOrganic,
            localPack: localPack,
            localFinder: localFinder,
            placeTargets: placeTargets,
        };
    } catch (error) {
        throw new ApiError(
            error.statusCode
                ? error.statusCode
                : httpStatus.INTERNAL_SERVER_ERROR,
            error.message,
        );
    }
};


export async function getAllRankings(keywords: string[], locationDoc: ILocation, placeTargets: any[], type: string) {
    let rankings: any[] = []
    const combinedRankings: any = {};
    if (type === 'mobile') {
        rankings = await asyncPool(4, keywords, async (keyword: string) => {
            await sleep(400);
            const result = await getMobileOrganicRank(keyword, locationDoc);
            return getSerpRanking(result, placeTargets);
        });
    }
    if (type === 'local-pack') {
        rankings = await asyncPool(4, keywords, async (keyword: string) => {
            await sleep(400);
            const result = await getLocalPackResults(keyword, locationDoc);
            return getSerpRanking(result, placeTargets);
        });
    }
    if (type === 'local-finder') {
        rankings = await asyncPool(4, keywords, async (keyword: string) => {
            await sleep(400);
            const result = await getLocalFinderResults(keyword, locationDoc);
            return getSerpRanking(result, placeTargets);
        });
    }
    if (type === 'desktop') {
        rankings = await asyncPool(4, keywords, async (keyword: string) => {
            await sleep(400);
            const result = await getDesktopOrganicRank(keyword, locationDoc);
            return getSerpRanking(result, placeTargets);
        });
    }
    rankings.forEach(ranking => {
        const keyword = Object.keys(ranking)[0];
        combinedRankings[keyword] = ranking[keyword];
    });
    return combinedRankings;
};

export async function getSerpRanking(serp_result: any, placeTargets: PlaceTarget[]) {
    const { search_parameters, data } = serp_result;
    const keyword = search_parameters?.q;
    const rankings: any = {};

    // Initialize rankings
    placeTargets.forEach((target: any) => {
        rankings[target.name] = { rank: 51 };
    });

    if (!data || data.length === 0) {
        return { [keyword]: rankings };
    }

    data.forEach((result: any, index: number) => {
        placeTargets.forEach(target => {
            if (
                rankings[target.name].rank === 51 &&
                isMatchingBusiness(result, target)
            ) {
                rankings[target.name] = { rank: index + 1 };
            }
        });
    });

    return { [keyword]: rankings };
};

export async function getDesktopOrganicRank(keyword: string, locationDoc: ILocation) {
    try {
        let gl = 'us'
        if (locationDoc?.country) {
            const countyObj = serpCountries.find(elm => elm.country_name.toLowerCase() === locationDoc?.country.toLowerCase())
            gl = countyObj ? countyObj.country_code : gl
        }

        const params = {
            q: keyword,
            location: `${locationDoc.city}, ${locationDoc.state}, ${locationDoc.country}`,
            google_domain: "google.com",
            gl: gl,
            hl: "en",
            engine: "google",
            num: 50,
            start: 0,
        };

        const data = await getJson("google", params);
        return { data: data.organic_results || [], search_parameters: data.search_parameters }
    } catch (error) {
        console.error("Error fetching getDesktopOrganicRank:", error?.response?.data || error);
        return null;

    }
};

async function getMobileOrganicRank(keyword: string, locationDoc: ILocation) {
    try {
        let gl = 'us'
        if (locationDoc?.country) {
            const countyObj = serpCountries.find(elm => elm.country_name.toLowerCase() === locationDoc?.country.toLowerCase())
            gl = countyObj ? countyObj.country_code : gl
        }
        const location = `${locationDoc.city}, ${locationDoc.state}, ${locationDoc.country}`
        const url = `https://serpapi.com/search.json?q=${encodeURIComponent(keyword)}&location=${encodeURIComponent(location)}&engine=google&gl=${gl}&device=mobile&api_key=${config.serpApis.keySecret}`;
        const result = await axios.get(url).then(r => r.data);
        return { data: result.organic_results || [], search_parameters: result.search_parameters }
    } catch (error) {
        console.error("Error fetching getMobileOrganicRank:", error?.response?.data || error);
        return null;
    }

}

async function getLocalPackResults(keyword: string, locationDoc: ILocation) {
    try {
        let gl = 'us'
        if (locationDoc?.country) {
            const countyObj = serpCountries.find(elm => elm.country_name.toLowerCase() === locationDoc?.country.toLowerCase())
            gl = countyObj ? countyObj.country_code : gl
        }
        const location = `${locationDoc.city}, ${locationDoc.state}, ${locationDoc.country}`
        const url = `https://serpapi.com/search.json?q=${encodeURIComponent(keyword)}&location=${encodeURIComponent(location)}&engine=google&gl=${gl}&tbm=lcl&api_key=${config.serpApis.keySecret}`;
        const result = await axios.get(url).then(r => r.data);
        return { data: result.local_results || [], search_parameters: result.search_parameters }
    } catch (error) {
        console.error("Error fetching getLocalPackResults", error?.response?.data || error);
        return null;
    }

}

async function getLocalFinderResults(keyword: string, locationDoc: ILocation) {
    try {
        let gl = 'us';
        let google_domain = 'google.com';

        if (locationDoc?.country) {
            const countyObj = serpCountries.find(
                elm => elm.country_name.toLowerCase() === locationDoc.country.toLowerCase()
            );
            gl = countyObj ? countyObj.country_code : gl;

            const googleDomainObj = googleDomain.find(
                elm => elm.country_name.toLowerCase() === locationDoc.country.toLowerCase()
            );
            google_domain = googleDomainObj ? googleDomainObj.domain : google_domain
        }

        const location = `${locationDoc.city}, ${locationDoc.state}, ${locationDoc.country}`;

        const baseUrl = `https://serpapi.com/search.json`;
        const paramsBase = {
            q: keyword,
            location,
            engine: 'google_local',
            gl,
            google_domain: `${google_domain}`,
            api_key: config.serpApis.keySecret
        };

        const allResults: any[] = [];
        let searchParams: any = null;

        const starts = [0, 20, 40];

        for (let i = 0; i < starts.length; i++) {
            const start = starts[i];
            let params: any = { ...paramsBase }
            if (start !== 0) {
                params = { ...paramsBase, start }
            }

            const response = await axios.get(baseUrl, {
                params: params
            });
            console.log("SERP URL:=------------------------------------------------------", response.request.res.responseUrl);
            const result = response.data;

            if (!searchParams) {
                searchParams = result.search_parameters;
            }

            if (result.local_results && result.local_results.length) {
                allResults.push(...result.local_results);
            }

            if (i < starts.length - 1) {
                await delay(30_00);
            }
        }

        return {
            data: allResults,
            search_parameters: searchParams
        };

    } catch (error: any) {
        console.error(
            "Error fetching getLocalFinderResults:",
            error?.response?.data || error
        );
        return null;
    }
}

function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getSerpPlaceCidMaping(place_id: string = '') {
    try {

        const url = `https://serpapi.com/search.json?engine=google_maps&type=place&place_id=${place_id}&api_key=${config.serpApis.keySecret}`;
        const result = await axios.get(url).then(r => r.data);
        return result?.place_results || undefined
    } catch (error) {
        console.error("Error fetching getLocalFinderResults:", error?.response?.data || error);
        return null;
    }
}

export async function getKeywordSearchVolume(keyword: string[], locationDoc: ILocation) {
    try {
        const post_array = [
            {
                "location_code": 2840,
                "keywords": keyword,
                "search_partners": true
            }
        ];

        const response = await axios.post(
            'https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live',
            post_array,
            {
                auth: {
                    username: 'dipankar.bhoumik@blockcod.com',
                    password: '423805ba38d1f124'
                },
                headers: {
                    'content-type': 'application/json'
                }
            }
        );

        // Extract result
        const task = response.data?.tasks?.[0];
        // const result = task?.result?.[0] || null;
        return task?.result || null;
    } catch (error) {
        console.error("Error fetching keyword volume:", error?.response?.data || error);
        return null;
    }
}

function normalizeText(text = "") {
    return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function extractDomain(url: string) {
    if (!url) return null;
    try {
        return new URL(url).hostname.replace(/^www\./, "");
    } catch {
        return null;
    }
}

function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;

    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function isMatchingBusiness(place: any, target: any) {

    const placeDomain = extractDomain(place.links?.website) || extractDomain(place?.link);
    if (placeDomain && target?.domain && placeDomain === target?.domain) {
        console.log("-------------------:Match Domain:----------------------------", placeDomain, target.domain)
        return true;
    }
    if (place?.phone && target?.phone) {
        if (normalizePhone(place?.phone) === normalizePhone(target?.phone)) {
            console.log("-------------------:Match Phone:----------------------------", place?.phone, target?.phone)
            return true;
        }
    }

    if (target?.data_cid && place?.place_id === target?.data_cid) {
        console.log("-------------------:Match Place Id:----------------------------", place?.place_id, target?.data_cid)
        return true;
    }

    if (
        place?.gps_coordinates &&
        target?.lat &&
        target?.lng &&
        isSimilarName(place?.title, target?.name)
    ) {
        const distanceMeters = getDistanceMeters(
            place?.gps_coordinates?.latitude,
            place?.gps_coordinates?.longitude,
            target?.lat,
            target?.lng
        );
        if (distanceMeters <= 300) {
            console.log("-------------------:Matched by name + proximity:----------------------------", distanceMeters);
            return true;
        }
    }
    return false;
}

function isSimilarName(a: string, b: string): boolean {
    if (!a || !b) return false;

    const clean = (s: string) =>
        s.toLowerCase()
            .replace(/[^a-z0-9 ]/g, "")
            .replace(/\b(pvt|ltd|llp|inc|co)\b/g, "")
            .trim();

    return clean(a).includes(clean(b)) || clean(b).includes(clean(a));
}

function getDistanceMeters(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number
): number {
    return getDistanceKm(lat1, lng1, lat2, lng2) * 1000;
}

export function normalizePhone(phone?: string | null): string {
    if (!phone) return "";

    // 1️⃣ Convert to string & trim
    let normalized = phone.toString().trim();

    // 2️⃣ Remove everything except digits
    normalized = normalized.replace(/\D/g, "");

    // 3️⃣ Handle India (+91, 091, 91)
    if (normalized.length > 10 && normalized.endsWith(normalized.slice(-10))) {
        return normalized.slice(-10);
    }

    // 4️⃣ Handle US / International
    if (normalized.length >= 10) {
        return normalized;
    }

    return "";
}

export async function asyncPool<T, R>(
    poolLimit: number,
    array: T[],
    iteratorFn: (item: T) => Promise<R>
): Promise<R[]> {
    const ret: Promise<R>[] = [];
    const executing: Promise<void>[] = [];

    for (const item of array) {
        const p: Promise<R> = Promise.resolve().then(() => iteratorFn(item));
        ret.push(p);

        if (poolLimit <= array.length) {
            const e: Promise<void> = p.then(() => {
                executing.splice(executing.indexOf(e), 1);
            });

            executing.push(e);

            if (executing.length >= poolLimit) {
                await Promise.race(executing);
            }
        }
    }
    return Promise.all(ret);
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function overallAvgPosition(channels: any) {
    const values = [
        Number(
            (channels.desktopOrganic.total / channels.desktopOrganic.count)
                .toFixed(1)
        ) ?? 51,
        Number(
            (channels.mobileOrganic.total / channels.mobileOrganic.count)
                .toFixed(1)
        ) ?? 51,
        Number(
            (channels.localFinder.total / channels.localFinder.count)
                .toFixed(1)
        ) ?? 51,
    ];

    return values.reduce((a, b) => a + b, 0) / values.length;
}