import { DashboardQuery, getDashboard } from '../../services/dashboard/dashboard.service';
import { OrgContext } from '../../services/org/context';
import { catchAsync, responseWrapper } from '../../utils';

// Dashboard (Phase 11). loadOrgContext ran; the shape follows the organization type.
export const get = catchAsync(async (req, res) =>
	responseWrapper(res, await getDashboard(res.locals.org as OrgContext, res.locals.dashboardQuery as DashboardQuery)),
);
