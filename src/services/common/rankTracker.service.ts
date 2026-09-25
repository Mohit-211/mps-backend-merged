/* eslint-disable @typescript-eslint/no-explicit-any */
import httpStatus from 'http-status';
import axios from 'axios';
import { URL } from 'url';

import { RankTrackerReport, Location, UserAuth, ILocation, ICompetitor, IKeyword } from '../../models';
import { ApiError, isValidMongoObjectId, mongoFunctions } from '../../utils';
import { mongoOperationsTypes, tokenTypes, userTypes } from '../../configs/constantTypes';
import { BodyDefinition, QueryDefinition } from '../../types/RouteDefinition';
import { rankTrackerSelect } from '../../constants';
import { getAverageGooglePositionData, getKeywordMovmentData, getKeywordSearchVolume, getRankingTableData, overallAvgPosition } from '../../helpers';

export const generateRankTrackerReport = async (body: BodyDefinition): Promise<any> => {
    try {
        const { location_id, scheduling, keywords, competitors, user, locationDoc } = body;
        let positionalMovement = {
            gained: 0, lost: 0, change: 0
        };

        let keywordMovement = {
            up: 0, down: 0, change: 0, no_change: 0
        };

        const reportObj: any = {
            location_id,
            created_by: user._id,
            scheduling,
            keyword_list: keywords,
            competitors,
            keyword_and_positional_movement: {
                keyword_movement: keywordMovement,
                positional_movement: positionalMovement
            }
        };

        let oldRankTrackerReportDoc = await RankTrackerReport
            .findOne({ location_id: locationDoc._id, is_active: true })
            .sort({ updated_at: -1 });

        let avgRanking: any = {
            desktopOrganic: {
                total: 0,
                count: 0,
            },
            mobileOrganic: {
                total: 0,
                count: 0,
            },
            localFinder: {
                total: 0,
                count: 0,
            }
        }

        if (keywords && competitors) {


            const allKeywordData = await getRankingTableData(locationDoc, keywords, competitors);

            const rankingTableData = allKeywordData['desktopOrganic'] || undefined;
            const mobileOrganic = allKeywordData['mobileOrganic'] || undefined
            const localPack = allKeywordData['localPack'] || undefined
            const localFinder = allKeywordData['localFinder'] || undefined
            let keywordsOutputArr: any = [];
            const placeName = locationDoc.name;
            const placeTargets = allKeywordData?.placeTargets || undefined;
            reportObj.placeTargets = placeTargets;

            let volumes = await getKeywordSearchVolume((keywords || []), locationDoc)
            for (const keyword of keywords) {



                let volumeElm = volumes ? volumes.find(elm => elm.keyword == keyword) : { search_volume: 0 }
                let obj = {
                    name: keyword,
                    volume: volumeElm?.search_volume || 0,
                    organic_desktop: {},
                    organic_mobile: {},
                    local_pack: {},
                    local_finder: {},
                };

                if (rankingTableData && placeName && rankingTableData[keyword][placeName]) {
                    let ownRank = rankingTableData[keyword][placeName]['rank'];
                    let organic_desktop: any = {};
                    organic_desktop['rank'] = ownRank;
                    avgRanking['desktopOrganic']['total'] = avgRanking['desktopOrganic']['total'] + (ownRank || 51)
                    avgRanking['desktopOrganic']['count'] = avgRanking['desktopOrganic']['count'] + 1

                    organic_desktop['change'] = 0;
                    organic_desktop['competitors'] = [];
                    competitors.map(elm => {
                        const competitorplaceName = elm.name;
                        let currCompetitorsRank = rankingTableData[keyword][competitorplaceName]['rank'];
                        let competitorObj = {
                            name: elm.name,
                            website: elm.website,
                            place_id: elm?.place_id,
                            rank: currCompetitorsRank,
                            change: 0,
                            lat: elm?.lat,
                            lng: elm?.lng,
                        };
                        organic_desktop['competitors'].push(competitorObj);
                    });
                    obj['organic_desktop'] = organic_desktop
                };

                if (mobileOrganic && placeName && localFinder[keyword][placeName]) {
                    let ownRank = mobileOrganic[keyword][placeName]['rank'] || 51;
                    let organic_mobile: any = {};
                    organic_mobile['rank'] = ownRank;
                    avgRanking['mobileOrganic']['total'] = avgRanking['mobileOrganic']['total'] + (ownRank || 51)
                    avgRanking['mobileOrganic']['count'] = avgRanking['mobileOrganic']['count'] + 1

                    organic_mobile['change'] = 0;
                    organic_mobile['competitors'] = [];
                    competitors.map(elm => {
                        const competitorplaceName = elm.name;
                        let currCompetitorsRank = mobileOrganic[keyword][competitorplaceName]['rank'] || 0;
                        let competitorObj = {
                            name: elm.name,
                            website: elm.website,
                            place_id: elm.place_id,
                            rank: currCompetitorsRank,
                            change: 0,
                            lat: elm?.lat,
                            lng: elm?.lng,
                        };
                        organic_mobile['competitors'].push(competitorObj);
                    });
                    obj['organic_mobile'] = organic_mobile
                };


                if (localPack && placeName && localFinder[keyword][placeName]) {
                    let ownRank = localPack[keyword][placeName]['rank'];
                    let local_pack: any = {};
                    local_pack['rank'] = ownRank;

                    local_pack['change'] = 0;
                    local_pack['competitors'] = [];
                    competitors.map(elm => {
                        if (elm.place_id) {
                            const competitorplaceName = elm.name;
                            let currCompetitorsRank = localPack[keyword][competitorplaceName]['rank'] || 0;
                            let competitorObj = {
                                name: elm.name,
                                website: elm.website,
                                place_id: elm.place_id,
                                rank: currCompetitorsRank,
                                change: 0,
                                lat: elm?.lat,
                                lng: elm?.lng,
                            };
                            local_pack['competitors'].push(competitorObj);
                        }
                    });
                    obj['local_pack'] = local_pack
                };

                if (localFinder && placeName && localFinder[keyword][placeName]) {
                    let ownRank = localFinder[keyword][placeName]['rank'];
                    let local_finder: any = {};
                    local_finder['rank'] = ownRank;

                    avgRanking['localFinder']['total'] = avgRanking['localFinder']['total'] + (ownRank || 51)
                    avgRanking['localFinder']['count'] = avgRanking['localFinder']['count'] + 1

                    local_finder['change'] = 0;
                    local_finder['competitors'] = [];
                    competitors.map(elm => {
                        if (elm.place_id) {
                            const competitorplaceName = elm.name;
                            let currCompetitorsRank = localFinder[keyword][competitorplaceName]['rank'] || 0;
                            let competitorObj = {
                                name: elm.name,
                                website: elm.website,
                                place_id: elm.place_id,
                                rank: currCompetitorsRank,
                                change: 0,
                                lat: elm?.lat,
                                lng: elm?.lng,
                            };
                            local_finder['competitors'].push(competitorObj);
                        }
                    });
                    obj['local_finder'] = local_finder
                };
                keywordsOutputArr.push(obj);
            }
            reportObj.keywords = keywordsOutputArr;
            reportObj.total_keywords = keywords.length;
        };
        if (avgRanking) {
            reportObj.avgRanking = avgRanking
            reportObj.average_google_position = {
                currentPos: roundTo1Decimal(overallAvgPosition(avgRanking)),
                changePos: 0,
            };
        }
        let rankTrackerReportDoc = await mongoFunctions({
            schema: RankTrackerReport,
            createData: reportObj,
            operationType: mongoOperationsTypes.CREATE,
        });

        if (oldRankTrackerReportDoc && rankTrackerReportDoc) {
            rankTrackerReportDoc.keyword_and_positional_movement = calculatePositionalMovement(rankTrackerReportDoc, oldRankTrackerReportDoc)
            if (oldRankTrackerReportDoc?.average_google_position?.currentPos && rankTrackerReportDoc?.average_google_position?.currentPos) {
                let chnagePos = (oldRankTrackerReportDoc?.average_google_position?.currentPos - rankTrackerReportDoc?.average_google_position?.currentPos) || 0
                rankTrackerReportDoc.average_google_position = {
                    currentPos: rankTrackerReportDoc?.average_google_position?.currentPos,
                    changePos: chnagePos
                }
            }
            await rankTrackerReportDoc.save();
        }

        return { rankTrackerReportDoc, avgRanking }

    } catch (error) {
        console.log("5555555555555555555 : ", error)
        throw new ApiError(
            error.statusCode
                ? error.statusCode
                : httpStatus.INTERNAL_SERVER_ERROR,
            error.message,
        );
    }
};

function roundTo1Decimal(value: number) {
    return Math.round(value * 10) / 10;
}

export const getRankTrackerReport = async (body: BodyDefinition): Promise<any> => {
    try {
        const { locationDoc } = body;

        let rankTrackerReportDoc = await RankTrackerReport
            .findOne({ location_id: locationDoc._id, is_active: true })
            .select(rankTrackerSelect)
            .sort({ updated_at: -1 });
        if (!rankTrackerReportDoc) {
            throw new ApiError(
                httpStatus.BAD_REQUEST,
                'No report found for this location.',
            );
        };

        return { rankTrackerReportDoc, locationDoc };
    } catch (error) {
        throw new ApiError(
            error.statusCode
                ? error.statusCode
                : httpStatus.INTERNAL_SERVER_ERROR,
            error.message,
        );
    }
};

function calculatePositionalMovement(newReport: any, oldReport: any) {
    const result = {
        keyword_movement: {
            up: 0,
            down: 0,
            no_change: 0,
            change: 0,
            new_ranking: 0,
            total: 0,
        },
        positional_movement: {
            gained: 0,
            lost: 0,
            change: 0
        }
    };

    if (!newReport || !oldReport) return result;

    const newKeywords = newReport.keywords || [];
    const oldKeywordsMap = new Map(
        (oldReport.keywords || []).map(k => [k.name, k])
    );

    const MAX_RANK = 50;

    for (const keyword of newKeywords) {
        result.keyword_movement.total++;

        const newRank = keyword?.local_finder?.rank;
        const oldKeyword: any = oldKeywordsMap.get(keyword.name);
        const oldRank = oldKeyword?.local_finder?.rank;

        const newValid =
            Number.isInteger(newRank) && newRank > 0 && newRank <= MAX_RANK;
        const oldValid =
            Number.isInteger(oldRank) && oldRank > 0 && oldRank <= MAX_RANK;

        // Not ranking → Ranking
        if (!oldValid && newValid) {
            result.keyword_movement.new_ranking++;
            result.positional_movement.gained += (MAX_RANK - newRank + 1);
            continue;
        }

        // Ranking → Not ranking
        if (oldValid && !newValid) {
            result.keyword_movement.down++;
            result.positional_movement.lost += (MAX_RANK - oldRank + 1);
            continue;
        }

        // Both not ranking
        if (!oldValid && !newValid) {
            result.keyword_movement.no_change++;
            continue;
        }

        // Normal comparison
        if (newRank < oldRank) {
            result.keyword_movement.up++;
            result.positional_movement.gained += (oldRank - newRank);
        } else if (newRank > oldRank) {
            result.keyword_movement.down++;
            result.positional_movement.lost += (newRank - oldRank);
        } else {
            result.keyword_movement.no_change++;
        }
    }

    // Net changes
    result.keyword_movement.change =
        result.keyword_movement.up - result.keyword_movement.down;

    result.positional_movement.change =
        result.positional_movement.gained - result.positional_movement.lost;

    return result;
}