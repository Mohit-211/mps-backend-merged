/* eslint-disable @typescript-eslint/no-explicit-any */
import httpStatus from 'http-status';
import axios from 'axios'


import { ApiError } from '../../utils';
import { citationDirectoriesArr, citationTypes } from '../../configs/constantTypes';
import { BodyDefinition, ParamsDefinition } from '../../types/RouteDefinition';
import { searchCitationWithSerpAPI } from '../../helpers/citation';
import config from '../../configs/config';
import { Aggregator, Campaign, Citation, CitationDirectory, CitationDuplicateRemoveCredit, Client, IManualCiationCreditInfo, Location, LocationCitation, ManualCiationCreditInfo } from '../../models';

export const getManualSubmissionPrices = async (body: BodyDefinition): Promise<any> => {
    try {
        const results = await ManualCiationCreditInfo.find({
            is_active: true
        }, { created_at: 0, updated_at: 0, __v: 0 })
        if (!results) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'Failed to get details.');
        }
        return results;
    } catch (error) {
        throw new ApiError(
            error.statusCode
                ? error.statusCode
                : httpStatus.INTERNAL_SERVER_ERROR,
            error.message,
        );
    }
};

export const getAggregatorsDetails = async (body: BodyDefinition): Promise<any> => {
    try {
        const results = await Aggregator.find({
            is_active: true
        }, { created_at: 0, updated_at: 0, __v: 0 })
        if (!results) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'Failed to get list.');
        }
        return results;
    } catch (error) {
        throw new ApiError(
            error.statusCode
                ? error.statusCode
                : httpStatus.INTERNAL_SERVER_ERROR,
            error.message,
        );
    }
};

export const getCitatioRemovePrices = async (body: BodyDefinition): Promise<any> => {
    try {
        const results = await CitationDuplicateRemoveCredit.find({
            is_active: true
        }, { created_at: 0, updated_at: 0, __v: 0 })
        if (!results) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'Failed to get list.');
        }
        return results;
    } catch (error) {
        throw new ApiError(
            error.statusCode
                ? error.statusCode
                : httpStatus.INTERNAL_SERVER_ERROR,
            error.message,
        );
    }
};

export const getCitatioList = async (body: BodyDefinition): Promise<any> => {
    try {
        const { locationDoc } = body;
        const result: any = {
            new: [],
            existing: [],
            locationDoc
        }

        const directoriesDoc = await CitationDirectory.find({
            is_active: true
        }, {
            __v: 0, deleted_by: 0, deleted_at: 0, created_by: 0, updated_by: 0,
        })
        if (!directoriesDoc) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'Failed to get directories list.');
        }

        directoriesDoc.map(directory => {
            result['new'].push({
                directory_id: directory._id,
                site_name: directory.domain,
                business_name: locationDoc.address,
                zip_code: locationDoc.zip_code,
                phone_number: locationDoc.mobile,
                site_type: directory.category,
                authority: directory.authority,
                verification_required: directory.verification_required,
                status: 'SAVED',
                citation_type: 'ADD',
                is_harmfull: false,
                is_existing: false,
                mode: 'MANUAL',
                need_add: true,
                need_update: false
            })
        })
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

export const addCitationCampaign = async (body: BodyDefinition): Promise<any> => {
    try {
        const {
            locationDoc,
            user,
            aggregators = [],
            is_duplicate_remove,
            manual_citation_count,
            citations = { new: [], existing: [] },
            is_all_aggregators_selected
        } = body;

        let totalPrice = 0;
        let totalCredit = 0;
        let nap_addition_count = 0;
        let nap_updated_count = 0;

        const newCitations = Array.isArray(citations.new) ? citations.new : [];
        const existingCitations = Array.isArray(citations.existing) ? citations.existing : [];

        nap_addition_count = newCitations.length;
        nap_updated_count = existingCitations.length;

        const aggregators_count = is_all_aggregators_selected
            ? aggregators.length > 0 ? aggregators.length : 0
            : aggregators.length;

        if (manual_citation_count > 0) {
            const manualCitationDoc = await ManualCiationCreditInfo.findOne({
                is_active: true,
                no_of_citations: manual_citation_count
            }, { created_at: 0, updated_at: 0, __v: 0 });

            if (!manualCitationDoc) {
                throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid manual citation add count');
            }
            totalPrice += manualCitationDoc.price || 0;
            totalCredit += manualCitationDoc.credit || 0;
        }

        if (is_all_aggregators_selected) {
            const aggregatorsDoc = await Aggregator.findOne({ name: 'All' });
            if (aggregatorsDoc) {
                totalPrice += aggregatorsDoc.price || 0;
                totalCredit += aggregatorsDoc.credit || 0;
            }
        } else {
            for (const elm of aggregators) {
                const aggregatorsDoc = await Aggregator.findOne({ _id: elm._id });
                if (aggregatorsDoc) {
                    totalPrice += aggregatorsDoc.price || 0;
                    totalCredit += aggregatorsDoc.credit || 0;
                }
            }
        }

        if (is_duplicate_remove) {
            const citationDuplicateRemovalPriceDoc = await CitationDuplicateRemoveCredit.findOne({
                is_active: true
            }, { created_at: 0, updated_at: 0, __v: 0 });

            if (citationDuplicateRemovalPriceDoc) {
                totalPrice += citationDuplicateRemovalPriceDoc.price || 0;
                totalCredit += citationDuplicateRemovalPriceDoc.price || 0;
            }
        }

        const campaignObj = {
            location_id: locationDoc._id,
            user_id: user._id,
            is_duplicate_remove,
            manual_citation_count,
            aggregators,
            nap_addition_count,
            nap_updated_count,
            aggregators_count
        };

        const campaignDoc = await Campaign.create(campaignObj);
        if (!campaignDoc) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'Failed to create new campaign');
        }

        const locationCitationObj = {
            ...campaignObj,
            campaign_id: campaignDoc._id
        };

        const locationCitationDoc = await LocationCitation.create(locationCitationObj);
        if (!locationCitationDoc) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'Failed to create new citation');
        }


        if (newCitations.length > 0 || existingCitations.length > 0) {
            const allCitations: any = [];

            for (const elm of newCitations) {
                allCitations.push({
                    location_id: locationDoc._id,
                    campaign_id: campaignDoc._id,
                    site_name: elm.site_name,
                    authority: elm.authority,
                    site_type: elm.site_type,
                    verification_required: elm.verification_required,
                    user_id: user._id,
                    directory_id: elm.directory_id,
                    citation_type: citationTypes.add,
                    is_existing: false
                });
            }

            for (const elm of existingCitations) {
                allCitations.push({
                    location_id: locationDoc._id,
                    campaign_id: campaignDoc._id,
                    user_id: user._id,
                    site_name: elm.site_name,
                    site_type: elm.site_type,
                    authority: elm.authority,
                    business_name: elm.business_name,
                    zip_code: elm.zip_code,
                    phone_number: elm.phone_number,
                    verification_required: elm.verification_required,
                    directory_id: elm.directory_id,
                    citation_type: citationTypes.update,
                    is_existing: true
                });
            }

            if (allCitations.length > 0) {
                await Citation.insertMany(allCitations);
            }
        }

        locationCitationDoc.price = totalPrice;
        locationCitationDoc.credit = totalCredit;
        await locationCitationDoc.save()
        return {
            citation_location_id: locationCitationDoc._id,
            campaign_id: campaignDoc._id,
            price: totalPrice,
            credit: totalCredit,
            user_id: user._id,
            orderStatus: locationCitationDoc.orderStatus,
            paymentStatus: locationCitationDoc.paymentStatus,
            campaignStatus: locationCitationDoc.campaignStatus,
            location: locationDoc,
        };

    } catch (error: any) {
        throw new ApiError(
            error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
            error.message || 'Something went wrong'
        );
    }
};

export const addCitationCampaignBusinesInfo = async (body: BodyDefinition): Promise<any> => {
    try {
        const {
            locationDoc,
            is_white_lable = false,
            business_info,
            about_busines = {},
            opening_hours = [],
            additionalData = {},
            social_links = [],
            email_alerts = { enabled: false, email: '' },
            is_term_accepted = true,
            accepted_payment_methods = [],
            campaign_id
        } = body;

        const campaignDoc = await Campaign.findOne({
            is_active: true,
            _id: campaign_id,
            location_id: locationDoc._id,
        })
        if (!campaignDoc) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'Campaign not found');
        }

        campaignDoc.is_white_lable = is_white_lable
        campaignDoc.business_info = business_info
        campaignDoc.about_busines = about_busines
        campaignDoc.opening_hours = opening_hours
        campaignDoc.additionalData = additionalData
        campaignDoc.social_links = social_links
        campaignDoc.email_alerts = email_alerts
        campaignDoc.is_term_accepted = is_term_accepted
        campaignDoc.accepted_payment_methods = accepted_payment_methods
        await campaignDoc.save()

        return campaignDoc;
    } catch (error) {
        throw new ApiError(
            error.statusCode
                ? error.statusCode
                : httpStatus.INTERNAL_SERVER_ERROR,
            error.message,
        );
    }
};

export const getCampaignDetails = async (params: ParamsDefinition): Promise<any> => {
    try {
        const { campaign_id, location_id } = params

        const campaignDoc = await Campaign.findOne({
            is_active: true,
            _id: campaign_id,
            location_id: location_id,
        })
        if (!campaignDoc) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'Campaign not found');
        }

        return campaignDoc;
    } catch (error) {
        throw new ApiError(
            error.statusCode
                ? error.statusCode
                : httpStatus.INTERNAL_SERVER_ERROR,
            error.message,
        );
    }
};

export const getAllCampaign = async (params: ParamsDefinition): Promise<any> => {
    try {
        const { location_id } = params

        const locationCampaignDoc = await LocationCitation.find({
            is_active: true,
            location_id: location_id,
        }).populate('campaign_id')
        if (!locationCampaignDoc) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'Failed to find all campaings');
        }
        const result = locationCampaignDoc.map(doc => {
            const obj: any = doc.toObject();
            obj.campaign = obj?.campaign_id;
            delete obj.campaign_id;
            return obj;
        });
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

export const getAllCitationByToken = async (body: BodyDefinition): Promise<any> => {
    try {
        const { user } = body
        let userIds = []
        const clients = await Client.find({ created_by: user._id })
        if (clients) {
            userIds = clients.map(elm => elm._id)
        }
        userIds.push(user._id)
        const locations = await Location.find({ created_by: { $in: userIds } })
        let locationIds = []
        if (clients) {
            locationIds = locations.map(elm => elm._id)
        }

        const locationCampaignDoc = await LocationCitation.find({
            is_active: true,
            location_id: { $in: locationIds },
        }).sort({ created_at: -1 }).populate('campaign_id')
        if (!locationCampaignDoc) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'Failed to find all campaings');
        }
        const result = locationCampaignDoc.map(doc => {
            const obj: any = doc.toObject();
            obj.campaign = obj?.campaign_id;
            delete obj.campaign_id;
            return obj;
        });
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

export const generateCitationTrackerReport = async (body: BodyDefinition): Promise<any> => {
    try {
        const { locationDoc, business_type, primary_location } = body;
        let query = `${locationDoc.name} ${locationDoc.address} ${locationDoc.phone}`;
        // const query = `Certified Mobile Mechanics - WrenchPatrol 7118 Randolph Ave, Burnaby, BC V5J 4W6, Canada (604) 757-1297`;
        if (locationDoc.place_id) {
            let locationDetails = await fetchDetails(locationDoc.place_id);
            query = `${locationDetails.name} ${locationDetails.formatted_address} ${locationDetails.formatted_phone_number}`;
        }
        const serpData = await searchCitationWithSerpAPI(query);
        const organicResults = serpData.organic_results || [];


        const results = citationDirectoriesArr.map((dir) => {
            const match = organicResults.find(result => result.link && result.link.includes(dir));
            return {
                source: dir,
                found: !!match,
                url: match?.link || null,
                snippet: match?.snippet || null
            };
        });

        return results;
    } catch (error) {
        throw new ApiError(
            error.statusCode
                ? error.statusCode
                : httpStatus.INTERNAL_SERVER_ERROR,
            error.message,
        );
    }
};

export const getCitationTrackerReport = async (body: BodyDefinition): Promise<any> => {
    try {
        const { locationDoc, name, address, phone } = body;
        const query = `${name} ${address} ${phone}`;
        return body

        // const serpData = await searchCitationWithSerpAPI(query);
        // return serpData
        // const organicResults = serpData.organic_results || [];

        // const results = citationDirectoriesArr.map((dir) => {
        //   const match = organicResults.find(result => result.link && result.link.includes(dir));
        //   return {
        //     source: dir,
        //     found: !!match,
        //     url: match?.link || null,
        //     snippet: match?.snippet || null
        //   };
        // });

        // return results;
    } catch (error) {
        throw new ApiError(
            error.statusCode
                ? error.statusCode
                : httpStatus.INTERNAL_SERVER_ERROR,
            error.message,
        );
    }
};

export const citationBuilder = async (body: BodyDefinition): Promise<any> => {
    try {
        const { locationDoc, name, address, phone } = body;
        const query = `${name} ${address} ${phone}`;
        return body

        // const serpData = await searchCitationWithSerpAPI(query);
        // return serpData
        // const organicResults = serpData.organic_results || [];

        // const results = citationDirectoriesArr.map((dir) => {
        //   const match = organicResults.find(result => result.link && result.link.includes(dir));
        //   return {
        //     source: dir,
        //     found: !!match,
        //     url: match?.link || null,
        //     snippet: match?.snippet || null
        //   };
        // });

        // return results;
    } catch (error) {
        throw new ApiError(
            error.statusCode
                ? error.statusCode
                : httpStatus.INTERNAL_SERVER_ERROR,
            error.message,
        );
    }
};

const fetchDetails = async (placeId: string) => {
    try {
        const response = await axios.get(`https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&key=${config.googleApis.placeApi.keySecret}`);
        return response.data.result;
    } catch (error) {
        return null;
    }
};

export const getAllCitatioList = async (): Promise<any> => {
  try {
    const citations = await LocationCitation.find(
      { is_active: true },
      {
        __v: 0,
        deleted_by: 0,
        deleted_at: 0,
        updated_by: 0,
      }
    )
      .populate('campaign_id')
      // .populate("location_id", "address zip_code mobile")
      // .populate("user_id", "name email")
      // .populate("directory_id", "domain category authority verification_required")
      .sort({ created_at: -1 });

    if (!citations || citations.length === 0) {
      throw new ApiError(httpStatus.NOT_FOUND, 'No citations found.');
    }

    const campaignMap = new Map<string, any[]>();

    for (const citation of citations) {
      let campaignId: string | undefined;

      // Handle both populated & non-populated cases
      const campaign: any = (citation as any).campaign_id;

      if (campaign && typeof campaign === 'object' && campaign._id) {
        campaignId = campaign._id.toString();
      } else if (campaign && typeof campaign === 'string') {
        campaignId = campaign;
      } else if (campaign && campaign.toString) {
        // When it's a Mongoose ObjectId
        campaignId = campaign.toString();
      }

      if (campaignId) {
        if (!campaignMap.has(campaignId)) {
          campaignMap.set(campaignId, []);
        }
        campaignMap.get(campaignId)!.push(citation);
      }
    }

    const result = Array.from(campaignMap.entries()).map(([campaignId, citationList]) => {
      const campaignObj = (citationList[0] as any).campaign_id;
      const campaign =
        campaignObj && typeof campaignObj === 'object' && campaignObj.toObject
          ? campaignObj.toObject()
          : {};

      return {
        campaign_id: campaignId,
        campaign,
        citations: citationList.map((c) => {
          const cObj = c.toObject();
          delete cObj.campaign_id;
          return cObj;
        }),
      };
    });

    return result;
  } catch (error: any) {
    throw new ApiError(
      error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
      error.message || 'An unexpected error occurred while fetching citations.'
    );
  }
};




/*

        let organicResults = [
            {
                "position": 1,
                "title": "WrenchPatrol: Mobile Mechanic Burnaby | Auto Repair and ...",
                "link": "https://www.wrenchpatrol.com/",
                "redirect_link": "https://www.google.com/url?sa=t&source=web&rct=j&opi=89978449&url=https://www.wrenchpatrol.com/&ved=2ahUKEwj_gL-K9M-MAxU9l4kEHeRwC5oQFnoECDYQAQ",
                "displayed_link": "https://www.wrenchpatrol.com",
                "favicon": "https://serpapi.com/searches/67f9011e23a23424756fde9f/images/13dad28e8fd8a36c4d9a4f92f45dfa56227c2de2c1779e59ea9c44c9531287c8.png",
                "snippet": "Our Professional mechanics serve Vancouver, Calgary, Edmonton and surrounding areas. CONTACT US. Telephone: (888) 779-8651. Local call: (604) 757-1297. E-mail ...",
                "snippet_highlighted_words": [
                    "604) 757-1297"
                ],
                "missing": [
                    "7118",
                    "Randolph",
                    "Ave,",
                    "V5J",
                    "4W6,"
                ],
                "source": "WrenchPatrol"
            },
            {
                "position": 2,
                "title": "Wrench Patrol - Auto Repair",
                "link": "https://www.yelp.ca/biz/wrench-patrol-burnaby",
                "redirect_link": "https://www.google.com/url?sa=t&source=web&rct=j&opi=89978449&url=https://www.yelp.ca/biz/wrench-patrol-burnaby&ved=2ahUKEwj_gL-K9M-MAxU9l4kEHeRwC5oQFnoECDcQAQ",
                "displayed_link": "https://www.yelp.ca › ... › Automotive › Auto Repair",
                "favicon": "https://serpapi.com/searches/67f9011e23a23424756fde9f/images/13dad28e8fd8a36c4d9a4f92f45dfa56130449ab03b469458a689dfa424d50b3.png",
                "snippet": "More info about Wrench Patrol. Map. 7118 Randolph Avenue. Burnaby, BC V5J 4W6. Directions. (604) 757-1297. Call Now · Visit Website. http://www.wrenchpatrol.com.",
                "snippet_highlighted_words": [
                    "Wrench Patrol",
                    "7118 Randolph Avenue",
                    "Burnaby",
                    "BC V5J 4W6",
                    "604",
                    "757-1297",
                    "wrenchpatrol"
                ],
                "rich_snippet": {
                    "top": {
                        "detected_extensions": {
                            "rating": 4.2,
                            "reviews": 26
                        },
                        "extensions": [
                            "4.2(26)"
                        ]
                    }
                },
                "source": "Yelp"
            },
            {
                "position": 3,
                "title": "Mobile Mechanics Vancouver | Expert Auto Repair",
                "link": "https://www.wrenchpatrol.com/mechanic-vancouver/",
                "redirect_link": "https://www.google.com/url?sa=t&source=web&rct=j&opi=89978449&url=https://www.wrenchpatrol.com/mechanic-vancouver/&ved=2ahUKEwj_gL-K9M-MAxU9l4kEHeRwC5oQFnoECDkQAQ",
                "displayed_link": "https://www.wrenchpatrol.com › mechanic-vancouver",
                "favicon": "https://serpapi.com/searches/67f9011e23a23424756fde9f/images/13dad28e8fd8a36c4d9a4f92f45dfa56f0fb62bfd94ee83e83b0c49742f7fcb5.png",
                "snippet": "WrenchPatrol's certified auto mechanics come to you! Call us for ... Local call: (604) 757-1297. E-mail: info@wrenchpatrol.com. Hours. Mon-Fri: 7:00 ...",
                "snippet_highlighted_words": [
                    "WrenchPatrol's certified auto mechanics come to you"
                ],
                "missing": [
                    "7118",
                    "Randolph",
                    "Ave,",
                    "Burnaby,",
                    "V5J",
                    "4W6,"
                ],
                "source": "WrenchPatrol"
            },
            {
                "position": 4,
                "title": "WrenchPatrol, 7118 Randolph Ave, Burnaby, BC V5J 4W6, ...",
                "link": "https://www.mapquest.com/ca/british-columbia/wrenchpatrol-456128057",
                "redirect_link": "https://www.google.com/url?sa=t&source=web&rct=j&opi=89978449&url=https://www.mapquest.com/ca/british-columbia/wrenchpatrol-456128057&ved=2ahUKEwj_gL-K9M-MAxU9l4kEHeRwC5oQFnoECD4QAQ",
                "displayed_link": "https://www.mapquest.com › ... › Burnaby",
                "favicon": "https://serpapi.com/searches/67f9011e23a23424756fde9f/images/13dad28e8fd8a36c4d9a4f92f45dfa56e6104b461e77f516005c8ddcd287f25f.png",
                "snippet": "Sat 8:00 AM - 5:30 PM. +1 (604) 757-1297 · http://www.automechanicvancouver.ca. At our auto repair shop we come to you! We cater to the professional and ...",
                "snippet_highlighted_words": [
                    "1 (604) 757-1297"
                ],
                "missing": [
                    "Certified"
                ],
                "must_include": {
                    "word": "Certified",
                    "link": "https://www.google.com/search?sca_esv=c006ba693e70e67f&hl=en&gl=ca&q=%22Certified%22+Mobile+Mechanics+-+WrenchPatrol+7118+Randolph+Ave,+Burnaby,+BC+V5J+4W6,+Canada+(604)+757-1297&sa=X&ved=2ahUKEwj_gL-K9M-MAxU9l4kEHeRwC5oQ5t4CegQIRhAB"
                },
                "source": "MapQuest"
            },
            {
                "position": 5,
                "title": "WrenchPatrol - 7118 Randolph Ave, Burnaby, BC",
                "link": "https://www.yellowpages.ca/bus/British-Columbia/Burnaby/WrenchPatrol/100495858.html",
                "redirect_link": "https://www.google.com/url?sa=t&source=web&rct=j&opi=89978449&url=https://www.yellowpages.ca/bus/British-Columbia/Burnaby/WrenchPatrol/100495858.html&ved=2ahUKEwj_gL-K9M-MAxU9l4kEHeRwC5oQFnoECDgQAQ",
                "displayed_link": "https://www.yellowpages.ca › ... › Burnaby",
                "favicon": "https://serpapi.com/searches/67f9011e23a23424756fde9f/images/13dad28e8fd8a36c4d9a4f92f45dfa56b57b0ab5c4df73bd1c7c317822aeaf50.png",
                "snippet": "Primary 604-757-1297; Tollfree 1-888-779-8651. Message. Directions · Website. Add your photos. auto repair shop, Burnaby, BC V5J 4W6 - WrenchPatrol. Details.",
                "snippet_highlighted_words": [
                    "604-757-1297"
                ],
                "rich_snippet": {
                    "top": {
                        "detected_extensions": {
                            "rating": 5,
                            "reviews": 2
                        },
                        "extensions": [
                            "5.0(2)"
                        ]
                    }
                },
                "missing": [
                    "Certified"
                ],
                "must_include": {
                    "word": "Certified",
                    "link": "https://www.google.com/search?sca_esv=c006ba693e70e67f&hl=en&gl=ca&q=%22Certified%22+Mobile+Mechanics+-+WrenchPatrol+7118+Randolph+Ave,+Burnaby,+BC+V5J+4W6,+Canada+(604)+757-1297&sa=X&ved=2ahUKEwj_gL-K9M-MAxU9l4kEHeRwC5oQ5t4CegQIRRAB"
                },
                "source": "YellowPages.ca"
            },
            {
                "position": 6,
                "title": "WrenchPatrol",
                "link": "https://ca.linkedin.com/company/wrenchpatrol",
                "redirect_link": "https://www.google.com/url?sa=t&source=web&rct=j&opi=89978449&url=https://ca.linkedin.com/company/wrenchpatrol&ved=2ahUKEwj_gL-K9M-MAxU9l4kEHeRwC5oQFnoECEQQAQ",
                "displayed_link": "60+ followers",
                "favicon": "https://serpapi.com/searches/67f9011e23a23424756fde9f/images/13dad28e8fd8a36c4d9a4f92f45dfa56b5f11598f0f1e020849ea7aac0d0ddaa.png",
                "snippet": "our friendly mobile mechanics perform car repairs and maintenance services on-the-go and at your convenience. WrenchPatrol's unique mobile mechanic fleet, which ...",
                "snippet_highlighted_words": [
                    "perform car repairs and maintenance services"
                ],
                "missing": [
                    "Canada",
                    "(604)",
                    "757-1297"
                ],
                "source": "LinkedIn · WrenchPatrol"
            },
            {
                "position": 7,
                "title": "TOP 10 BEST Mobile Mechanic in Burnaby, BC",
                "link": "https://www.yelp.ca/search?find_desc=Mobile+Mechanic&find_loc=Burnaby%2C+BC",
                "redirect_link": "https://www.google.com/url?sa=t&source=web&rct=j&opi=89978449&url=https://www.yelp.ca/search%3Ffind_desc%3DMobile%2BMechanic%26find_loc%3DBurnaby%252C%2BBC&ved=2ahUKEwj_gL-K9M-MAxU9l4kEHeRwC5oQFnoECHEQAQ",
                "displayed_link": "https://www.yelp.ca › Automotive",
                "favicon": "https://serpapi.com/searches/67f9011e23a23424756fde9f/images/13dad28e8fd8a36c4d9a4f92f45dfa5619bf9e8353d3f42e0ccca12eb82b5774.png",
                "snippet": "Auto Repair · Oil Change Stations · Towing. 2.3 km•. Closes in 60 min. 7118 Randolph Avenue, Burnaby, BC V5J 4W6. (604) 757-1297. Earlier this week I wanted to ...",
                "snippet_highlighted_words": [
                    "7118 Randolph Avenue, Burnaby, BC V5J 4W6"
                ],
                "source": "Yelp"
            },
            {
                "position": 8,
                "title": "WrenchPatrol Services Inc. | BBB Business Profile",
                "link": "https://www.bbb.org/ca/bc/burnaby/profile/auto-maintenance/wrenchpatrol-services-inc-0037-1274015",
                "redirect_link": "https://www.google.com/url?sa=t&source=web&rct=j&opi=89978449&url=https://www.bbb.org/ca/bc/burnaby/profile/auto-maintenance/wrenchpatrol-services-inc-0037-1274015&ved=2ahUKEwj_gL-K9M-MAxU9l4kEHeRwC5oQFnoECGsQAQ",
                "displayed_link": "https://www.bbb.org › ... › Burnaby › Auto Maintenance",
                "favicon": "https://serpapi.com/searches/67f9011e23a23424756fde9f/images/13dad28e8fd8a36c4d9a4f92f45dfa56634b55e3484b65b636158f75d82bda6a.png",
                "snippet": "This company offers Mobile Auto Mechanic service and repair for fleets and consumers in Greater Vancouver and the Lower Mainland.",
                "snippet_highlighted_words": [
                    "offers Mobile Auto Mechanic service"
                ],
                "missing": [
                    "4W6,"
                ],
                "must_include": {
                    "word": "4W6,",
                    "link": "https://www.google.com/search?sca_esv=c006ba693e70e67f&hl=en&gl=ca&q=Certified+Mobile+Mechanics+-+WrenchPatrol+7118+Randolph+Ave,+Burnaby,+BC+V5J+%224W6,%22+Canada+(604)+757-1297&sa=X&ved=2ahUKEwj_gL-K9M-MAxU9l4kEHeRwC5oQ5t4CegQIbxAB"
                },
                "source": "Better Business Bureau"
            },
            {
                "position": 9,
                "title": "WrenchPatrol Certified Mobile Mechanics WE COME TO YOU",
                "link": "https://www.youtube.com/watch?v=ALKlzLxkeEY",
                "redirect_link": "https://www.google.com/url?sa=t&source=web&rct=j&opi=89978449&url=https://www.youtube.com/watch%3Fv%3DALKlzLxkeEY&ved=2ahUKEwj_gL-K9M-MAxU9l4kEHeRwC5oQFnoECGwQAQ",
                "displayed_link": "https://www.youtube.com › watch",
                "favicon": "https://serpapi.com/searches/67f9011e23a23424756fde9f/images/13dad28e8fd8a36c4d9a4f92f45dfa56e357b1b6442006db1d2369a23967f213.png",
                "snippet": "To know more contact us: Wrenchpatrol Burnaby Mechanics 7118 Randolph Ave, Burnaby, BC V5J 4W6, Canada +1 604-757-1297 https://www.wrenchpatr... https://goo ...",
                "snippet_highlighted_words": [
                    "7118 Randolph Ave, Burnaby, BC V5J 4W6, Canada"
                ],
                "source": "YouTube"
            },
            {
                "position": 10,
                "title": "Mobile Auto Repair near Burnaby, BC",
                "link": "https://www.bbb.org/ca/bc/burnaby/category/mobile-auto-repair",
                "redirect_link": "https://www.google.com/url?sa=t&source=web&rct=j&opi=89978449&url=https://www.bbb.org/ca/bc/burnaby/category/mobile-auto-repair&ved=2ahUKEwj_gL-K9M-MAxU9l4kEHeRwC5oQFnoECHAQAQ",
                "displayed_link": "https://www.bbb.org › bc › burnaby › category › mobile...",
                "favicon": "https://serpapi.com/searches/67f9011e23a23424756fde9f/images/13dad28e8fd8a36c4d9a4f92f45dfa5656072bdcfbee50ec33c1c2c2e13c0f28.png",
                "snippet": "Live Auto Group of Canada, Inc. · (604) 294-1190. 3855 Douglas Rd, Burnaby, BC ; WrenchPatrol Services Inc. · (604) 757-1297. 7118 Randolph Ave, Burnaby, BC ; Loi ...",
                "snippet_highlighted_words": [
                    "604) 757-1297"
                ],
                "missing": [
                    "4W6,"
                ],
                "must_include": {
                    "word": "4W6,",
                    "link": "https://www.google.com/search?sca_esv=c006ba693e70e67f&hl=en&gl=ca&q=Certified+Mobile+Mechanics+-+WrenchPatrol+7118+Randolph+Ave,+Burnaby,+BC+V5J+%224W6,%22+Canada+(604)+757-1297&sa=X&ved=2ahUKEwj_gL-K9M-MAxU9l4kEHeRwC5oQ5t4CegQIchAB"
                },
                "source": "Better Business Bureau"
            }
        ];

*/