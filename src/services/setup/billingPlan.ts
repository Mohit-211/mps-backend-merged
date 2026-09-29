import { BillingPlan } from '../../models';
import { standardPlan } from '../billing/plans';

// Fresh setup (Phase 13b): the standard billing plan, created without prices (idempotent).

export const setupStandardPlan = async (): Promise<{ created: boolean; plan_id: string; prices: number }> => {
	const existed = await BillingPlan.exists({ kind: 'standard' });
	const plan = await standardPlan();
	return { created: !existed, plan_id: String(plan._id), prices: plan.prices?.length ?? 0 };
};
