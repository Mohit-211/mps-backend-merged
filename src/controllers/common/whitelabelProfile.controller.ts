import httpStatus from 'http-status';
import { responseWrapper, catchAsync, pick } from '../../utils';
import { gbpAuditService, rankTrackerService, reputationManagerService, whitelabelProfileService } from '../../services';

export const createNewProfile = catchAsync(async (req, res) => {
    const body = pick(req.body, ['user', 'name', 'header', 'footer', 'color']);
    const result = await whitelabelProfileService.createNewProfile(body, req.files);
    return responseWrapper(
        res,
        result,
        'New White Label Profile Created!',
        httpStatus.CREATED
    );
});

export const updateWhiteLabelProfile = catchAsync(async (req, res) => {
    const body = pick(req.body, ['user', 'name', 'header', 'footer', 'color', 'location_id', 'locationDoc', 'white_label_profile_id', 'rank_tracker', 'citation_tracker', 'gbp_audit', 'reputation_manager', 'google_analytics', 'external_reports_lists']);
    const result = await whitelabelProfileService.updateWhiteLabelProfile(body, req.files);
    return responseWrapper(
        res,
        result,
        'White Label Profile Updated!'
    );
});

export const getWhiteLabelProfile = catchAsync(async (req, res) => {
    const body = pick(req.body, ['user']);
    const result = await whitelabelProfileService.getWhiteLabelProfile(body);
    return responseWrapper(
        res,
        result
    );
});

export const getWhiteLabelProfileDetail = catchAsync(async (req, res) => {
    const body = pick(req.body, ['user']);
    const params = pick(req.params, ['whiteLevelProfileId']);
    const result = await whitelabelProfileService.getWhiteLabelProfileDetail(body, params);
    return responseWrapper(
        res,
        result
    );
});

export const deleteWhiteLevelProfile = catchAsync(async (req, res) => {
    const body = pick(req.body, ['user']);
    const params = pick(req.params, ['whiteLevelProfileId']);
    const result = await whitelabelProfileService.deleteWhiteLevelProfile(body, params);
    return responseWrapper(
        res,
        result
    );
});

export const getRankTrackerReportForWLP = catchAsync(async (req, res) => {
    const body = pick(req.body, ['locationDoc']);
    const result = await rankTrackerService.getRankTrackerReport(body);
    return responseWrapper(
        res,
        result,
    );
});


export const getGBPAuditReportForWLP = catchAsync(async (req, res) => {
    const body = pick(req.body, ['locationDoc']);
    const result = await gbpAuditService.getGBPAuditReport(body);
    return responseWrapper(
        res,
        result,
    );
});

export const getReputationManagerReportForWLP = catchAsync(async (req, res) => {
    const body = pick(req.body, ['locationDoc']);
    const result = await reputationManagerService.getMonitorReviewReport(body);
    return responseWrapper(
        res,
        result,
    );
});