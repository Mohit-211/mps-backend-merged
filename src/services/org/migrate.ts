import { Types } from 'mongoose';
import { userTypes } from '../../configs/constantTypes';
import { Client, GbpReport, IGbpReport, ILocation, IMembership, IProfile, IUser, Location, Membership, Organization, Profile, User, UserGBP } from '../../models';
import { updateSummaryFromReport, updateSummaryFromRuns } from '../locations/summary';
import { normaliseOrgCountry } from './context';

// `npm run migrate:organizations` (Phase 8). Idempotent. Gives every existing account an organization:
//   AGENCY user            → agency organization, owner membership, default organization
//   BUSINESS / no type     → business organization (the same)
//   EMPLOYEE (owner_id)    → member of the owner's organization
//   CLIENT                 → skipped (reported)
// Then every location and client without an organization gets its creator's organization (an
// employee's → its owner's), locations get source / gbp_connected and their list summary. A second
// location with the same place_id in one organization is left unassigned (unchanged) and reported.

export interface MigrationRow {
	user_id: string;
	user_type: string | null;
	organization: { id: string; name: string; type: string; created: boolean } | null;
	role: 'owner' | 'member' | null;
	note?: string;
}

export interface MigrationReport {
	users: MigrationRow[];
	organizations_created: number;
	memberships_created: number;
	locations_assigned: number;
	locations_without_owner: string[];
	clients_assigned: number;
	summaries_updated: number;
	duplicates: { organization_id: string; place_id: string; location_ids: string[] }[];
}

type Id = Types.ObjectId | string;

const DUPLICATE_KEY = 11000;

const ownerOrgOf = async (userId: Id): Promise<Types.ObjectId | null> => {
	const m = await Membership.findOne({ user_id: userId, role: 'owner', status: 'active' }).sort({ created_at: 1 }).lean<IMembership>();
	return m ? (m.organization_id as Types.ObjectId) : null;
};

export const migrateOrganizations = async (): Promise<MigrationReport> => {
	const report: MigrationReport = {
		users: [],
		organizations_created: 0,
		memberships_created: 0,
		locations_assigned: 0,
		locations_without_owner: [],
		clients_assigned: 0,
		summaries_updated: 0,
		duplicates: [],
	};
	const users = await User.find({}).select({ user_type: 1, owner_id: 1, email: 1 }).sort({ created_at: 1 }).lean<IUser[]>();
	const profiles = new Map(
		(await Profile.find({ user_id: { $in: users.map((u) => u._id) } }).select({ user_id: 1, name: 1, business_name: 1, country: 1 }).lean<IProfile[]>()).map((p) => [
			String(p.user_id),
			p,
		]),
	);

	// 1. Owners (agency / business / untyped accounts).
	for (const user of users.filter((u) => u.user_type !== userTypes.employee && u.user_type !== userTypes.client)) {
		let orgId = await ownerOrgOf(user._id);
		let created = false;
		if (!orgId) {
			const profile = profiles.get(String(user._id));
			const org = await Organization.create({
				name: profile?.business_name || profile?.name || user.email.split('@')[0],
				type: user.user_type === userTypes.agency ? 'agency' : 'business',
				country: normaliseOrgCountry(profile?.country),
				owner_user_id: user._id,
			});
			await Membership.create({ organization_id: org._id, user_id: user._id, role: 'owner', created_by: user._id });
			orgId = org._id as Types.ObjectId;
			created = true;
			report.organizations_created += 1;
			report.memberships_created += 1;
		}
		await User.updateOne({ _id: user._id, $or: [{ default_organization_id: null }, { default_organization_id: { $exists: false } }] }, { $set: { default_organization_id: orgId } });
		const org = await Organization.findById(orgId).lean();
		report.users.push({ user_id: String(user._id), user_type: user.user_type ?? null, organization: { id: String(orgId), name: org?.name ?? '', type: org?.type ?? '', created }, role: 'owner' });
	}

	// 2. Employees → members of the owner's organization.
	for (const user of users.filter((u) => u.user_type === userTypes.employee)) {
		const orgId = user.owner_id ? await ownerOrgOf(user.owner_id as unknown as Id) : null;
		if (!orgId) {
			report.users.push({ user_id: String(user._id), user_type: user.user_type ?? null, organization: null, role: null, note: 'employee without an owner organization: skipped' });
			continue;
		}
		const result = await Membership.updateOne(
			{ organization_id: orgId, user_id: user._id },
			{ $setOnInsert: { role: 'member', status: 'active', client_ids: [], created_by: user.owner_id ?? null } },
			{ upsert: true },
		);
		if (result.upsertedCount) report.memberships_created += 1;
		await User.updateOne({ _id: user._id, $or: [{ default_organization_id: null }, { default_organization_id: { $exists: false } }] }, { $set: { default_organization_id: orgId } });
		const org = await Organization.findById(orgId).lean();
		report.users.push({ user_id: String(user._id), user_type: user.user_type ?? null, organization: { id: String(orgId), name: org?.name ?? '', type: org?.type ?? '', created: false }, role: 'member' });
	}
	for (const user of users.filter((u) => u.user_type === userTypes.client)) {
		report.users.push({ user_id: String(user._id), user_type: user.user_type ?? null, organization: null, role: null, note: 'CLIENT account: skipped' });
	}

	// 3. Locations and clients: the creator's organization (an employee's owner's).
	const orgForCreator = async (createdBy: unknown): Promise<Types.ObjectId | null> => {
		if (!createdBy) return null;
		const own = await ownerOrgOf(createdBy as Id);
		if (own) return own;
		const member = await Membership.findOne({ user_id: createdBy, status: 'active' }).sort({ created_at: 1 }).lean<IMembership>();
		return member ? (member.organization_id as Types.ObjectId) : null;
	};
	const locations = await Location.find({ $or: [{ organization_id: null }, { organization_id: { $exists: false } }] }).lean<ILocation[]>();
	for (const location of locations) {
		const orgId = await orgForCreator(location.created_by);
		if (!orgId) {
			report.locations_without_owner.push(String(location._id));
			continue;
		}
		const bound = Boolean(await UserGBP.exists({ location_id: location._id, is_active: true }));
		try {
			await Location.updateOne(
				{ _id: location._id },
				{ $set: { organization_id: orgId, gbp_connected: bound, ...(location.source ? {} : { source: bound ? 'gbp' : 'legacy' }) } },
			);
			report.locations_assigned += 1;
		} catch (err) {
			if ((err as { code?: number }).code !== DUPLICATE_KEY) throw err;
			// Same place already in this organization (unique index): left unassigned and reported.
			const kept = await Location.findOne({ organization_id: orgId, place_id: location.place_id, is_active: true }).select({ _id: 1 }).lean();
			const entry = report.duplicates.find((d) => d.organization_id === String(orgId) && d.place_id === location.place_id);
			if (entry) entry.location_ids.push(String(location._id));
			else report.duplicates.push({ organization_id: String(orgId), place_id: location.place_id, location_ids: [String(kept?._id), String(location._id)] });
		}
	}
	const clients = await Client.find({ $or: [{ organization_id: null }, { organization_id: { $exists: false } }] }).select({ created_by: 1 }).lean();
	for (const client of clients) {
		const orgId = await orgForCreator(client.created_by);
		if (!orgId) continue;
		await Client.updateOne({ _id: client._id }, { $set: { organization_id: orgId } });
		report.clients_assigned += 1;
	}

	// 4. List summaries for every active location (latest run and report).
	const active = await Location.find({ is_active: true, organization_id: { $ne: null } }).select({ _id: 1 }).lean();
	for (const { _id } of active) {
		await updateSummaryFromRuns(_id as Types.ObjectId);
		const gbpReport = await GbpReport.findOne({ location_id: _id }).lean<IGbpReport>();
		if (gbpReport) await updateSummaryFromReport(_id as Types.ObjectId, gbpReport);
		report.summaries_updated += 1;
	}

	// 5. Duplicate place_ids within an organization (the unique index needs none).
	const dups = await Location.aggregate<{ _id: { organization_id: Types.ObjectId; place_id: string }; ids: Types.ObjectId[] }>([
		{ $match: { is_active: true, deleted_at: null, organization_id: { $type: 'objectId' }, place_id: { $type: 'string' } } },
		{ $group: { _id: { organization_id: '$organization_id', place_id: '$place_id' }, ids: { $push: '$_id' }, n: { $sum: 1 } } },
		{ $match: { n: { $gt: 1 } } },
	]);
	for (const d of dups) {
		if (!report.duplicates.some((x) => x.organization_id === String(d._id.organization_id) && x.place_id === d._id.place_id)) {
			report.duplicates.push({ organization_id: String(d._id.organization_id), place_id: d._id.place_id, location_ids: d.ids.map(String) });
		}
	}
	return report;
};
