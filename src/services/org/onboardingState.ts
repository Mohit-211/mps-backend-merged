import { Types } from 'mongoose';
import { tokenTypes } from '../../configs/constantTypes';
import { Client, GbpReport, ILocation, IOrganization, Location, Organization, RankRun } from '../../models';
import { TokenStore, tokenStore } from '../gbp/tokenStore';
import { withDefaults } from '../ranking/trackingSettings';
import { OrgContext } from './context';
import { locationScope } from './access';

// Organization onboarding (Phase 8, roadmap PDF §5). Steps are derived from the data plus explicit
// skips, so the flow can be resumed anywhere:
//   Business: organization_info → google → first_location → location_setup → dashboard
//   Agency:   agency_info → google → first_client → first_location → location_setup → reporting_brand → dashboard
// google can be skipped (a location can be added from a Places search); reporting_brand is
// not_available until white-label is built (out of scope).

export type StepStatus = 'done' | 'pending' | 'skipped' | 'not_available';
export type OrgStepId = 'organization_info' | 'agency_info' | 'google' | 'first_client' | 'first_location' | 'location_setup' | 'reporting_brand';

export interface OrgOnboarding {
	id: string;
	type: IOrganization['type'];
	steps: { id: OrgStepId; status: StepStatus }[];
	next_step: OrgStepId | null;
	completed: boolean;
	completed_at: Date | null;
}

export interface EmptyStates {
	no_locations: boolean;
	google_not_connected: boolean;
	no_ranking_data: boolean;
	no_keywords: boolean;
	no_competitors: boolean;
	no_reports: boolean;
}

export interface OrgStateDeps {
	tokens?: Pick<TokenStore, 'listConnections'>;
	now?: Date;
}

/** A location counts as set up when its onboarding completed (or, for pre-Phase 8 locations without onboarding, when it has keywords). */
export const isSetUp = (location: Pick<ILocation, 'onboarding' | 'tracking'>): boolean =>
	location.onboarding ? location.onboarding.step === 'completed' : withDefaults(location.tracking).keywords.length > 0;

export const orgOnboardingState = async (ctx: OrgContext, deps: OrgStateDeps = {}): Promise<{ organization: OrgOnboarding; empty_states: EmptyStates }> => {
	const tokens = deps.tokens ?? tokenStore;
	const org = (await Organization.findById(ctx.organization._id).lean<IOrganization>()) as IOrganization;
	const scope = locationScope(ctx);
	const locations = await Location.find(scope).select({ onboarding: 1, tracking: 1, gbp_connected: 1 }).lean<ILocation[]>();
	const ids = locations.map((l) => l._id as Types.ObjectId);
	const [connections, clients, runs, reports] = await Promise.all([
		tokens.listConnections(ctx.userId, tokenTypes.GBP),
		org.type === 'agency' ? Client.countDocuments({ organization_id: org._id, is_active: true }) : Promise.resolve(0),
		RankRun.countDocuments({ location_id: { $in: ids }, status: { $in: ['done', 'partial'] } }),
		GbpReport.countDocuments({ location_id: { $in: ids } }),
	]);
	const googleConnected = connections.some((c) => c.status === 'active') || locations.some((l) => l.gbp_connected);
	const skipped = new Set(org.onboarding?.skipped ?? []);
	const done = (ok: boolean, skippable?: 'google'): StepStatus => (ok ? 'done' : skippable && skipped.has(skippable) ? 'skipped' : 'pending');

	const steps: OrgOnboarding['steps'] = [
		{ id: org.type === 'agency' ? 'agency_info' : 'organization_info', status: done(Boolean(org.name && org.country)) },
		{ id: 'google', status: done(googleConnected, 'google') },
		...(org.type === 'agency' ? [{ id: 'first_client' as const, status: done(clients > 0) }] : []),
		{ id: 'first_location', status: done(locations.length > 0) },
		{ id: 'location_setup', status: done(locations.some(isSetUp)) },
		...(org.type === 'agency' ? [{ id: 'reporting_brand' as const, status: 'not_available' as StepStatus }] : []),
	];
	const completed = steps.every((s) => s.status !== 'pending');
	let completedAt = org.onboarding?.completed_at ?? null;
	if (completed && !completedAt) {
		completedAt = deps.now ?? new Date();
		await Organization.updateOne({ _id: org._id, 'onboarding.completed_at': null }, { $set: { 'onboarding.completed_at': completedAt } });
	}
	return {
		organization: {
			id: String(org._id),
			type: org.type,
			steps,
			next_step: steps.find((s) => s.status === 'pending')?.id ?? null,
			completed,
			completed_at: completedAt,
		},
		empty_states: {
			no_locations: locations.length === 0,
			google_not_connected: !googleConnected,
			no_ranking_data: runs === 0,
			no_keywords: !locations.some((l) => withDefaults(l.tracking).keywords.length > 0),
			no_competitors: !locations.some((l) => withDefaults(l.tracking).competitors.length > 0),
			no_reports: reports === 0,
		},
	};
};

/** Marks a skippable step as skipped (idempotent). */
export const skipStep = (organizationId: Types.ObjectId | string, step: 'google' | 'reporting_brand') =>
	Organization.updateOne({ _id: organizationId }, { $addToSet: { 'onboarding.skipped': step } });
