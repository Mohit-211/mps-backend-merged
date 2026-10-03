import express from 'express';
import request from 'supertest';
import { Types } from 'mongoose';
import { queryTypesArr } from '../../src/configs/constantTypes';
import logger from '../../src/configs/logger';
import { Client, Invitation, Membership, Organization, RateLimit, User } from '../../src/models';
import { resolveOrgContext } from '../../src/services/org/context';
import { createInvitationService, hashToken } from '../../src/services/team/invitation.service';
import { apiErrorHandler, getQueryParams } from '../../src/utils';
import { addMember, clearDb, createUser, ensureOrg, startTestDb } from '../helpers/mongoose';
import { activateBilling } from '../helpers/billing';

jest.mock('../../src/configs/mongoConnection', () => ({ agenda: {} }));

const sent: { to: string; link: string }[] = [];
jest.mock('../../src/services/common/email.service', () => ({
	...jest.requireActual('../../src/services/common/email.service'),
	sendInvitationEmail: jest.fn(async (to: string, link: string) => sent.push({ to, link }) > 0),
}));

/* oxlint-disable typescript/no-var-requires */
const organizationRoute = require('../../src/routes/v1/common/organization.route').default;
const authRoute = require('../../src/routes/v1/common/auth.route').default;
/* oxlint-enable typescript/no-var-requires */

const app = express();
app.use(express.json());
app.use(getQueryParams(queryTypesArr));
app.use('/api/v1/organization', organizationRoute);
app.use('/api/v1/auth', authRoute);
app.use(apiErrorHandler);

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const tokenOf = (link: string) => new URL(link).searchParams.get('token') as string;

let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
	await Promise.all([Invitation.syncIndexes(), Organization.syncIndexes(), RateLimit.syncIndexes()]);
}, 60000);
afterAll(async () => db.stop());
beforeEach(async () => {
	await clearDb();
	sent.length = 0;
});

const agencyOwner = async () => {
	const { user, token } = await createUser('owner@test.dev');
	const org = await ensureOrg(user._id, 'agency');
	return { user, token, org };
};

describe('invitations', () => {
	it('owner invites a member; the token is stored hashed; inspect; accept with a new account logs in; single use', async () => {
		const { token, org } = await agencyOwner();
		const res = await request(app).post('/api/v1/organization/invitations').set(auth(token)).send({ email: 'New@Team.test', role: 'member' });
		expect(res.status).toBe(201);
		expect(res.body.data).toMatchObject({ email: 'new@team.test', role: 'member', status: 'pending', email_sent: true });
		const link = sent[0].link;
		expect(link).toMatch(/\/invite\?token=/);
		const stored = await Invitation.findOne({}).lean();
		expect(stored?.token_hash).toBe(hashToken(tokenOf(link)));
		expect(JSON.stringify(stored)).not.toContain(tokenOf(link));

		const inspect = await request(app).post('/api/v1/auth/invitations/inspect').send({ token: tokenOf(link) });
		expect(inspect.body.data).toMatchObject({ organization: { name: org.name, type: 'agency' }, email: 'new@team.test', role: 'member', account_exists: false });

		expect((await request(app).post('/api/v1/auth/invitations/accept').send({ token: tokenOf(link) })).body.data).toEqual({ reason: 'account_details_required' });
		const accepted = await request(app).post('/api/v1/auth/invitations/accept').send({ token: tokenOf(link), name: 'New Person', password: 'secret123' });
		expect(accepted.status).toBe(200);
		expect(accepted.body.data).toMatchObject({ accepted: true, login_required: false, organizations: [{ organization_id: String(org._id), role: 'member' }], current_organization_id: String(org._id) });
		expect(accepted.body.data.tokens.access.token).toEqual(expect.any(String));
		const newUser = await User.findOne({ email: 'new@team.test' }).lean();
		expect(newUser).toMatchObject({ status: 'ACCEPTED', user_type: 'EMPLOYEE' });

		const again = await request(app).post('/api/v1/auth/invitations/accept').send({ token: tokenOf(link), name: 'X', password: 'secret123' });
		expect([again.status, again.body.data]).toEqual([410, { reason: 'accepted' }]);
		const members = await request(app).get('/api/v1/organization/members').set(auth(token));
		expect(members.body.data.map((m: { email: string; role: string }) => [m.email, m.role])).toEqual([
			['owner@test.dev', 'owner'],
			['new@team.test', 'member'],
		]);
		expect(members.body.data[1].invited_by).toEqual(expect.any(String));
	});

	it('an existing account accepts without being logged in; parallel accepts give one membership', async () => {
		const { token, org } = await agencyOwner();
		await createUser('existing@team.test');
		await request(app).post('/api/v1/organization/invitations').set(auth(token)).send({ email: 'existing@team.test', role: 'member' });
		const t = tokenOf(sent[0].link);
		const results = await Promise.all([1, 2, 3].map(() => request(app).post('/api/v1/auth/invitations/accept').send({ token: t })));
		expect(results.map((r) => r.status).sort()).toEqual([200, 410, 410]);
		const ok = results.find((r) => r.status === 200);
		expect(ok?.body.data).toEqual({ accepted: true, organization_id: String(org._id), login_required: true });
		expect(await Membership.countDocuments({ organization_id: org._id, role: 'member' })).toBe(1);
	});

	it('client_user invitations need an agency and its clients; accepted with the client assignment', async () => {
		const { token, org } = await agencyOwner();
		const client = await Client.create({ company_name: 'C', organization_id: org._id });
		expect((await request(app).post('/api/v1/organization/invitations').set(auth(token)).send({ email: 'c@x.test', role: 'client_user' })).status).toBe(400);
		expect((await request(app).post('/api/v1/organization/invitations').set(auth(token)).send({ email: 'c@x.test', role: 'client_user', client_ids: [String(new Types.ObjectId())] })).status).toBe(400);
		const ok = await request(app).post('/api/v1/organization/invitations').set(auth(token)).send({ email: 'c@x.test', role: 'client_user', client_ids: [String(client._id)] });
		expect(ok.body.data).toMatchObject({ role: 'client_user', client_ids: [String(client._id)] });
		await request(app).post('/api/v1/auth/invitations/accept').send({ token: tokenOf(sent[0].link), name: 'C', password: 'secret123' });
		const cu = await User.findOne({ email: 'c@x.test' }).lean();
		expect(await Membership.findOne({ user_id: cu?._id }).lean()).toMatchObject({ role: 'client_user', client_ids: [client._id] });

		const { user: b, token: businessToken } = await createUser('biz@test.dev');
		await ensureOrg(b._id, 'business');
		const refused = await request(app).post('/api/v1/organization/invitations').set(auth(businessToken)).send({ email: 'c2@x.test', role: 'client_user', client_ids: [String(client._id)] });
		expect([refused.status, refused.body.data]).toEqual([403, { reason: 'agency_only' }]);
	});

	it('re-inviting replaces the token; revoke; expiry; already a member; owner only; list with statuses', async () => {
		const { user, token, org } = await agencyOwner();
		await request(app).post('/api/v1/organization/invitations').set(auth(token)).send({ email: 'x@team.test', role: 'member' });
		await request(app).post('/api/v1/organization/invitations').set(auth(token)).send({ email: 'x@team.test', role: 'member' });
		expect(await Invitation.countDocuments({ status: 'pending' })).toBe(1);
		expect((await request(app).post('/api/v1/auth/invitations/inspect').send({ token: tokenOf(sent[0].link) })).status).toBe(404);
		const current = tokenOf(sent[1].link);
		const inv = await Invitation.findOne({ email: 'x@team.test' }).lean();
		expect((await request(app).delete(`/api/v1/organization/invitations/${inv?._id}`).set(auth(token))).body.data).toMatchObject({ revoked: true });
		expect((await request(app).post('/api/v1/auth/invitations/inspect').send({ token: current })).body.data).toEqual({ reason: 'revoked' });

		await request(app).post('/api/v1/organization/invitations').set(auth(token)).send({ email: 'late@team.test', role: 'member' });
		await Invitation.updateOne({ email: 'late@team.test' }, { $set: { expires_at: new Date(Date.now() - 1000) } });
		const expired = await request(app).post('/api/v1/auth/invitations/accept').send({ token: tokenOf(sent[2].link), name: 'L', password: 'secret123' });
		expect([expired.status, expired.body.data]).toEqual([410, { reason: 'expired' }]);

		const { user: m, token: memberToken } = await createUser('member@team.test');
		await addMember(org._id, m._id, 'member');
		const dup = await request(app).post('/api/v1/organization/invitations').set(auth(token)).send({ email: 'member@team.test', role: 'member' });
		expect([dup.status, dup.body.data]).toEqual([409, { reason: 'already_member' }]);
		expect((await request(app).post('/api/v1/organization/invitations').set(auth(memberToken)).send({ email: 'y@team.test', role: 'member' })).status).toBe(403);
		expect((await request(app).get('/api/v1/organization/invitations').set(auth(memberToken))).status).toBe(403);

		const list = (await request(app).get('/api/v1/organization/invitations').set(auth(token))).body.data;
		expect(list.map((i: { email: string; status: string }) => [i.email, i.status])).toEqual([
			['late@team.test', 'expired'],
			['x@team.test', 'revoked'],
		]);
		expect((await request(app).get('/api/v1/organization/invitations?status=expired').set(auth(token))).body.data).toHaveLength(1);
		expect(String(user._id)).toBe(list[0].invited_by);
	});
});

describe('members', () => {
	it('change role, remove (default organization moves), the owner is protected', async () => {
		const { user, token, org } = await agencyOwner();
		const client = await Client.create({ company_name: 'C', organization_id: org._id });
		const { user: m } = await createUser('m@team.test');
		await addMember(org._id, m._id, 'member');
		const other = await ensureOrg(m._id, 'business');
		await User.updateOne({ _id: m._id }, { $set: { default_organization_id: org._id } });

		const changed = await request(app).patch(`/api/v1/organization/members/${m._id}`).set(auth(token)).send({ role: 'client_user', client_ids: [String(client._id)] });
		expect(changed.body.data).toEqual({ user_id: String(m._id), role: 'client_user', client_ids: [String(client._id)] });
		expect((await request(app).patch(`/api/v1/organization/members/${m._id}`).set(auth(token)).send({ role: 'client_user' })).status).toBe(400);
		const owner = await request(app).patch(`/api/v1/organization/members/${user._id}`).set(auth(token)).send({ role: 'member' });
		expect([owner.status, owner.body.data]).toEqual([403, { reason: 'owner_protected' }]);
		expect((await request(app).delete(`/api/v1/organization/members/${user._id}`).set(auth(token))).status).toBe(403);

		expect((await request(app).delete(`/api/v1/organization/members/${m._id}`).set(auth(token))).body.data).toEqual({ removed: true, user_id: String(m._id) });
		expect(await Membership.findOne({ organization_id: org._id, user_id: m._id }).lean()).toMatchObject({ status: 'removed' });
		expect(String((await User.findById(m._id).lean())?.default_organization_id)).toBe(String(other._id));
		expect((await request(app).delete(`/api/v1/organization/members/${m._id}`).set(auth(token))).status).toBe(404);
	});
});

describe('invitation email and logs', () => {
	it('the link goes to the email service (EMAIL_TRANSPORT decides send or log); the invitation service never logs it', async () => {
		const { user } = await agencyOwner();
		const ctx = await resolveOrgContext(String(user._id));
		const info = jest.spyOn(logger, 'info');
		const mailer = { sendInvitation: jest.fn(async () => true) };
		const res = await createInvitationService({ mailer }).invite(ctx, { email: 'joe@example.com', role: 'member' });
		expect(res.email_sent).toBe(true);
		const link = (mailer.sendInvitation.mock.calls[0] as unknown as [string, string])[1];
		const logged = info.mock.calls.map((c) => String(c[0])).join('\n');
		expect(logged).not.toContain(tokenOf(link));
		expect(logged).not.toContain('joe@example.com');
		// An SMTP failure: email_sent is false.
		const logOnly = await createInvitationService({ mailer: { sendInvitation: async () => false } }).invite(ctx, { email: 'ann@example.com', role: 'member' });
		expect(logOnly.email_sent).toBe(false);
		info.mockRestore();
	});

	it('users are pooled per paid location: 403 user_limit_reached; re-sending an invitation is fine; members over the limit keep access (Phase 13a)', async () => {
		const { user } = await agencyOwner();
		const ctx = await resolveOrgContext(String(user._id));
		const service = createInvitationService({ mailer: { sendInvitation: async () => true } });
		// Trial: 3 users (owner + 2 invitations).
		await service.invite(ctx, { email: 'u1@example.com', role: 'member' });
		await service.invite(ctx, { email: 'u2@example.com', role: 'member' });
		await expect(service.invite(ctx, { email: 'u3@example.com', role: 'member' })).rejects.toMatchObject({ statusCode: 403, data: { reason: 'user_limit_reached', used: 3, limit: 3 } });
		await expect(service.invite(ctx, { email: 'u2@example.com', role: 'member' })).resolves.toMatchObject({ email: 'u2@example.com' });
		// Two paid locations → 6 users.
		await activateBilling(ctx.organization._id as Types.ObjectId, { quantity: 2 });
		await expect(service.invite(ctx, { email: 'u3@example.com', role: 'member' })).resolves.toBeDefined();
		// Back to 1 paid location: nobody loses access, but no new invitations.
		await activateBilling(ctx.organization._id as Types.ObjectId, { quantity: 1 });
		await expect(service.invite(ctx, { email: 'u4@example.com', role: 'member' })).rejects.toMatchObject({ data: { reason: 'user_limit_reached', used: 4, limit: 3 } });
		expect(await Invitation.countDocuments({ organization_id: ctx.organization._id, status: 'pending' })).toBe(3);
	});

	it('invitations are rate-limited per organization (20 an hour)', async () => {
		const { user } = await agencyOwner();
		const ctx = await resolveOrgContext(String(user._id));
		// Phase 13a: enough paid locations that the user pool (3 per location) isn't the limit here.
		await activateBilling(ctx.organization._id as Types.ObjectId, { quantity: 10 });
		const service = createInvitationService({ mailer: { sendInvitation: async () => true } });
		for (let i = 0; i < 20; i += 1) await service.invite(ctx, { email: `p${i}@example.com`, role: 'member' });
		await expect(service.invite(ctx, { email: 'p20@example.com', role: 'member' })).rejects.toMatchObject({ statusCode: 429 });
	});
});
