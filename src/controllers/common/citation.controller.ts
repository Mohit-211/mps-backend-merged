import httpStatus from 'http-status';
import { responseWrapper, catchAsync, pick } from '../../utils';
import { citationService } from '../../services';


export const getManualSubmissionPrices = catchAsync(async (req, res) => {
    const body = pick(req.body, ['user'])
    const result = await citationService.getManualSubmissionPrices(body);
    return responseWrapper(
        res,
        result,
    );
});

export const getAggregatorsDetails = catchAsync(async (req, res) => {
    const body = pick(req.body, ['user'])
    const result = await citationService.getAggregatorsDetails(body);
    return responseWrapper(
        res,
        result,
    );
});

export const getCitatioRemovePrices = catchAsync(async (req, res) => {
    const body = pick(req.body, ['user'])
    const result = await citationService.getCitatioRemovePrices(body);
    return responseWrapper(
        res,
        result,
    );
});

export const getCitatioList = catchAsync(async (req, res) => {
    const body = pick(req.body, ['user', 'locationDoc'])
    const result = await citationService.getCitatioList(body);
    return responseWrapper(
        res,
        result,
    );
});

export const addCitationCampaign = catchAsync(async (req, res) => {
    const body = pick(req.body, ['user', 'locationDoc', 'location_id', 'is_duplicate_remove', 'manual_citation_count', 'citations', 'is_all_aggregators_selected', 'aggregators'])
    const result = await citationService.addCitationCampaign(body);
    return responseWrapper(
        res,
        result,
    );
});


export const addCitationCampaignBusinesInfo = catchAsync(async (req, res) => {
    const body = pick(req.body, ['user', 'locationDoc', 'is_white_lable', 'location_id', 'citation_location_id', 'business_info', 'about_busines', 'opening_hours', 'additionalData', 'social_links', 'email_alerts', 'is_term_accepted', 'accepted_payment_methods', 'campaign_id'])
    const result = await citationService.addCitationCampaignBusinesInfo(body);
    return responseWrapper(
        res,
        result,
    );
});

export const getCampaignDetails = catchAsync(async (req, res) => {
    const params = pick(req.params, ['user', 'location_id', 'campaign_id'])
    const result = await citationService.getCampaignDetails(params);
    return responseWrapper(
        res,
        result,
    );
});

export const getAllCampaign = catchAsync(async (req, res) => {
    const params = pick(req.params, ['user', 'location_id'])
    const result = await citationService.getAllCampaign(params);
    return responseWrapper(
        res,
        result,
    );
});

export const getAllCitationByToken = catchAsync(async (req, res) => {
    const body = pick(req.body, ['user'])
    const result = await citationService.getAllCitationByToken(body);
    return responseWrapper(
        res,
        result,
    );
});

export const generateCitationTrackerReport = catchAsync(async (req, res) => {
    const body = pick(req.body, ['location_id', 'scheduling', 'business_type', 'primary_location', 'user', 'locationDoc'])
    const result = await citationService.generateCitationTrackerReport(body);
    return responseWrapper(
        res,
        result,
        'Citation Tracker Report Generated Successfully.',
        httpStatus.CREATED,
    );
});

export const getCitationTrackerReport = catchAsync(async (req, res) => {
    const body = pick(req.body, ['user', 'locationDoc', 'name', 'address', 'phone', 'location_id']);
    const result = await citationService.getCitationTrackerReport(body);
    return responseWrapper(
        res,
        result,
    );
});

export const citationBuilder = catchAsync(async (req, res) => {
    const body = pick(req.body, ['location_id', 'scheduling', 'keywords', 'competitors', 'user', 'locationDoc'])
    const result = await citationService.getCitationTrackerReport(body);
    return responseWrapper(
        res,
        result,
        'Rank Tracker Report Generated Successfully.',
        httpStatus.CREATED,
    );
});

//admin apis
export const getAllCitatioList = catchAsync(async (req, res) => {
    const result = await citationService.getAllCitatioList();
    return responseWrapper(
        res,
        result,
    );
});