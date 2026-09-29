import { Types } from 'mongoose';
import { BillingPlan, IBillingPlan, IOrganization } from '../../models';

// Plans (Phase 13a): the standard plan (created on first use, without prices until an admin sets them)
// and an organization's plan (its custom plan when assigned, else the standard one).

type Id = Types.ObjectId | string;

export const STANDARD_PLAN_NAME = 'Standard';

export const standardPlan = async (): Promise<IBillingPlan> => {
	const found = await BillingPlan.findOne({ kind: 'standard', is_active: true }).sort({ created_at: 1 }).lean<IBillingPlan>();
	if (found) return found;
	// Upsert keyed on kind so two processes can't create two standard plans.
	await BillingPlan.updateOne({ kind: 'standard' }, { $setOnInsert: { name: STANDARD_PLAN_NAME, kind: 'standard', is_active: true } }, { upsert: true });
	return (await BillingPlan.findOne({ kind: 'standard' }).lean<IBillingPlan>()) as IBillingPlan;
};

export const planForOrganization = async (org: Pick<IOrganization, 'plan_id'> & { _id: Id }): Promise<IBillingPlan> => {
	if (org.plan_id) {
		const plan = await BillingPlan.findOne({ _id: org.plan_id, is_active: true }).lean<IBillingPlan>();
		if (plan) return plan;
	}
	return standardPlan();
};

/** Trial end for a new organization (the standard plan's trial length). */