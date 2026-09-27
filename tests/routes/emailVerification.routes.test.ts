import crypto from 'crypto';
import express from 'express';
import request from 'supertest';
import logger from '../../src/configs/logger';
import { AuthCode, Client, Invitation, Membership, Organization, Profile, User, UserToken } from '../../src/models';
import { createAuthService } from '../../src/services/auth/auth.service';
import { cleanupUnverifiedAccounts, hashLinkToken, migrateExistingUsersVerified } from '../../src/services/auth/emailVerification';
import { hashToken as hashInvitationToken } from '../../src/services/team/invitation.service';
import { clearDb, createUser, ensureOrg, startTestDb } from '../helpers/mongoose';

// Phase 8.1: email verification by link, the login gate, resend, the unverified-cleanup job, invitations,
// the migration and the legacy /user/auth rules, on the real app (offline).

jest.mock('../../src/configs/mongoConnection', () => ({ agenda: {} }));
jest.mock('node-cron', () => ({ schedule: jest.fn() }));
const links: { to: string; link: string }[] = [];
jest.mock('../../src/services/common/email.service', () =>
	new Proxy(
		{},
		{
			get: (_t, name) =>
				name === 'sendVerificationLinkEmail'
					? jest.fn(async (to: string, link: string) => {
							links.push({ to, link });
							return true;
						})
					: jest.fn(async () => true),
		},
	),
);

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const app: express.Express = require('../../src/app').default;
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

const HOUR = 3_600_000;
const EMAIL = 'pat@signup.test';
const PASSWORD = 'secret123';
const signup = (email = EMAIL) =>
	request(app).post('/api/v1/auth/signup').send({ account_type: 'business', name: 'Pat', email, password: PASSWORD, organization_name: 'Pat Co', country: 'US', accept_terms: true });
const login = (email = EMAIL) => request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
const verify = (token: string) => request(app).post('/api/v1/auth/verify-email').send({ token });
const resend = (email = EMAIL) => request(app).post('/api/v1/auth/resend-verification').send({ email });
const lastToken = () => new URL(links[links.length - 1].link).searchParams.get('token') as string;
/** Moves a signup's deadline (and link) into the past, as if `hours` had gone by. */
const age = async (email: string, hours: number) => {
	const user = await User.findOne({ email }).lean();
	const past = new Date(Date.now() - hours * HOUR);
	await User.collection.updateOne({ _id: user?._id }, { $set: { verification_deadline: new Date(past.getTime() + 24 * HOUR), created_at: past } });
	await AuthCode.updateMany({ user_id: user?._id, consumed_at: null }, { $set: { expires_at: new Date(past.getTime() + 24 * HOUR) } });
	return user;
};

let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
}, 60000);
afterAll(async () => db.stop());
beforeEach(async () => {
	await clearDb();
	links.length = 0;
});

describe('signup → verify by link → login', () => {
	it('login is refused (403, no tokens) until the link is used; a second click is "already verified"', async () => {
		const res = await signup();
		expect(res.status).toBe(201);
		expect(res.body.data).toMatchObject({ email_verification: 'sent', verify_before: expect.any(String) });
		expect(links).toHaveLength(1);
		expect(links[0].link).toMatch(/^http:\/\/localhost:3000\/verify-email\?token=[A-Za-z0-9_-]{43}$/);
		const token = lastToken();
		const row = await AuthCode.findOne({ purpose: 'verify_email' }).lean();
		expect(row?.code_hash).toBe(hashLinkToken(token));
		expect(JSON.stringify(row)).not.toContain(token);

		const refused = await login();
		expect(refused.status).toBe(403);
		expect(refused.body.data).toEqual({ reason: 'email_not_verified', resend: '/api/v1/auth/resend-verification' });
		expect(JSON.stringify(refused.body)).not.toContain('"token"');
		expect(await UserToken.countDocuments({})).toBe(0);

		const ok = await verify(token);
		expect(ok.status).toBe(200);
		expect(ok.body.data).toMatchObject({ verified: true, already_verified: false, user: { email: EMAIL } });
		expect(ok.body.data.tokens.access.token).toEqual(expect.any(String));
		const user = await User.findOne({ email: EMAIL }).lean();
		expect(user).toMatchObject({ status: 'ACCEPTED', verification_deadline: null });
		expect(user?.email_verified_at).toBeInstanceOf(Date);

		const again = await verify(token);
		expect(again.status).toBe(200);
		expect(again.body.data).toEqual({ verified: true, already_verified: true });
		expect(again.body.message).toContain('already verified');

		expect((await login()).status).toBe(200);
	});

	it('an expired link, a wrong token and a malformed token are refused with a reason', async () => {
		await signup();
		const token = lastToken();
		expect((await verify(crypto.randomBytes(32).toString('base64url'))).body.data).toEqual({ reason: 'link_invalid' });
		expect((await verify('not a token!')).status).toBe(400);
		await AuthCode.updateMany({}, { $set: { expires_at: new Date(Date.now() - 1000) } });
		const expired = await verify(token);
		expect(expired.status).toBe(400);
		expect(expired.body.data).toEqual({ reason: 'link_expired' });
		expect((await User.findOne({ email: EMAIL }).lean())?.email_verified_at).toBeNull();
	});

	it('resend invalidates the old link, answers the same for anyone, and is rate-limited', async () => {
		await signup();
		const old = lastToken();
		const r = await resend();
		expect(r.status).toBe(200);
		expect(r.body.data).toEqual({ email_verification: 'sent_if_pending' });
		const fresh = lastToken();
		expect(fresh).not.toBe(old);
		expect((await verify(old)).body.data).toEqual({ reason: 'link_invalid' });
		expect((await verify(fresh)).body.data).toMatchObject({ verified: true, already_verified: false });

		// Unknown and already-verified emails get the same answer and no email.
		const sent = links.length;
		const unknown = await resend('ghost@signup.test');
		const verified = await resend();
		expect([unknown.body, verified.body].map((b) => [b.message, b.data])).toEqual([
			[r.body.message, r.body.data],
			[r.body.message, r.body.data],
		]);
		expect(links).toHaveLength(sent);

		// 3 per email per hour.
		for (let i = 0; i < 3; i++) await resend('limit@signup.test');
		const limited = await resend('limit@signup.test');
		expect(limited.status).toBe(429);
	});

	it('development sends nothing and logs the link with the email masked', async () => {
		const mailer = { sendVerification: jest.fn(async () => true), sendReset: jest.fn(async () => true) };
		const info = jest.spyOn(logger, 'info');
		await createAuthService({ mailer, env: 'development' }).signup(
			{ account_type: 'agency', name: 'Dev', email: 'dev.person@signup.test', password: PASSWORD, organization_name: 'Dev Co', country: 'CA' },
			{ ip: '127.0.0.1' },
		);
		expect(mailer.sendVerification).not.toHaveBeenCalled();
		const logged = info.mock.calls.map((c) => String(c[0])).join('\n');
		expect(logged).toMatch(/email verification for d\*\*\*@signup\.test: http:\/\/localhost:3000\/verify-email\?token=/);
		expect(logged).not.toContain('dev.person@');
		info.mockRestore();
	});
});

describe('unverified-cleanup', () => {
	it('deletes only unverified signups past 24 h (and their empty organization); never verified, invited or legacy users', async () => {
		await signup('old@signup.test');
		await signup('fresh@signup.test');
		await signup('verified@signup.test');
		await verify(lastToken());
		const old = await age('old@signup.test', 25);
		await age('verified@signup.test', 25);
		// A legacy account from before 8.1 (no deadline, not yet migrated) and an invited user.
		const legacy = await User.collection.insertOne({ email: 'legacy@signup.test', status: 'PENDING', created_at: new Date(Date.now() - 90 * 24 * HOUR), deleted_at: null });
		const { user: invited } = await createUser('invited@signup.test');
		// An unverified signup whose organization has another member: the user goes, the organization stays.
		await signup('shared@signup.test');
		const shared = await age('shared@signup.test', 30);
		const sharedOrg = await Organization.findOne({ owner_user_id: shared?._id }).lean();
		await Membership.create({ organization_id: sharedOrg?._id, user_id: invited._id, role: 'member' });
		const oldOrg = await Organization.findOne({ owner_user_id: old?._id }).lean();
		await Client.create({ company_name: 'C', organization_id: oldOrg?._id });

		const info = jest.spyOn(logger, 'info');
		const result = await cleanupUnverifiedAccounts();
		expect(result).toEqual({ users: 2, organizations: 1, organizations_kept: 1 });
		const logged = info.mock.calls.map((c) => String(c[0])).join('\n');
		expect(logged).toContain('unverified-cleanup deleted 2 account(s)');
		expect(logged).not.toMatch(/@signup\.test/);
		info.mockRestore();

		expect(await User.exists({ email: 'old@signup.test' })).toBeNull();
		expect(await Organization.exists({ _id: oldOrg?._id })).toBeNull();
		for (const Model of [Membership, Profile, AuthCode] as const) {
			expect(await (Model as typeof Membership).countDocuments({ user_id: old?._id })).toBe(0);
		}
		expect(await Client.countDocuments({ organization_id: oldOrg?._id })).toBe(0);
		expect(await User.exists({ email: 'shared@signup.test' })).toBeNull();
		expect(await Organization.exists({ _id: sharedOrg?._id })).not.toBeNull();
		for (const email of ['fresh@signup.test', 'verified@signup.test', 'invited@signup.test']) expect(await User.exists({ email })).not.toBeNull();
		expect(await User.collection.countDocuments({ _id: legacy.insertedId })).toBe(1);

		// Idempotent, and the email can sign up again.
		expect(await cleanupUnverifiedAccounts()).toEqual({ users: 0, organizations: 0, organizations_kept: 0 });
		expect((await signup('old@signup.test')).status).toBe(201);
	});

	it('a signup with the email of an expired unverified account frees it at once; a pending one is 409', async () => {
		await signup();
		expect((await signup()).status).toBe(409);
		await age(EMAIL, 25);
		const again = await signup();
		expect(again.status).toBe(201);
		expect(await User.countDocuments({ email: EMAIL })).toBe(1);
		expect(await Organization.countDocuments({})).toBe(1);
	});

	it('resend does not revive an account past its deadline', async () => {
		await signup();
		await age(EMAIL, 25);
		const sent = links.length;
		expect((await resend()).status).toBe(200);
		expect(links).toHaveLength(sent);
	});
});

describe('invitations and password reset verify the email', () => {
	it('an unverified signup that accepts an invitation is marked verified (and is never cleaned up)', async () => {
		const { user: owner } = await createUser('owner@signup.test');
		const org = await ensureOrg(owner._id);
		await signup();
		const token = crypto.randomBytes(32).toString('base64url');
		await Invitation.create({ organization_id: org._id, email: EMAIL, role: 'member', token_hash: hashInvitationToken(token), expires_at: new Date(Date.now() + HOUR), invited_by: owner._id });
		const accepted = await request(app).post('/api/v1/auth/invitations/accept').send({ token });
		expect(accepted.status).toBe(200);
		const user = await User.findOne({ email: EMAIL }).lean();
		expect(user?.email_verified_at).toBeInstanceOf(Date);
		expect(user?.verification_deadline).toBeNull();
		expect((await login()).status).toBe(200);
	});

	it('a new account created from an invitation is verified', async () => {
		const { user: owner } = await createUser('owner@signup.test');
		const org = await ensureOrg(owner._id);
		const token = crypto.randomBytes(32).toString('base64url');
		await Invitation.create({ organization_id: org._id, email: 'new@signup.test', role: 'member', token_hash: hashInvitationToken(token), expires_at: new Date(Date.now() + HOUR), invited_by: owner._id });
		const accepted = await request(app).post('/api/v1/auth/invitations/accept').send({ token, name: 'New', password: PASSWORD });
		expect(accepted.status).toBe(200);
		expect((await User.findOne({ email: 'new@signup.test' }).lean())?.email_verified_at).toBeInstanceOf(Date);
	});
});

describe('migrate:email-verified', () => {
	it('marks every existing user verified (PENDING → ACCEPTED), leaves 8.1 signups alone, and is idempotent', async () => {
		const created = new Date('2025-01-02T03:04:05Z');
		await User.collection.insertMany([
			{ email: 'a@legacy.test', status: 'PENDING', created_at: created, deleted_at: null },
			{ email: 'b@legacy.test', status: 'ACCEPTED', created_at: created, deleted_at: null },
			{ email: 'c@legacy.test', status: 'REVIEWING', deleted_at: null },
			{ email: 'd@legacy.test', status: 'ACCEPTED', email_verified_at: created, deleted_at: null },
		]);
		await signup();
		expect(await migrateExistingUsersVerified()).toEqual({ marked_verified: 3, status_accepted: 2 });
		const a = await User.collection.findOne({ email: 'a@legacy.test' });
		expect(a).toMatchObject({ status: 'ACCEPTED', email_verified_at: created });
		expect((await User.collection.findOne({ email: 'c@legacy.test' }))?.email_verified_at).toBeInstanceOf(Date);
		expect((await User.findOne({ email: EMAIL }).lean())?.email_verified_at).toBeNull();
		expect(await migrateExistingUsersVerified()).toEqual({ marked_verified: 0, status_accepted: 0 });
	});
});

describe('legacy /user/auth', () => {
	it('register is gone, OTP routes only reset passwords, and login refuses unverified accounts', async () => {
		expect((await request(app).post('/api/v1/user/auth/register').send({ email: 'x@legacy.test' })).status).toBe(404);
		await signup();
		const otp = await request(app).post('/api/v1/user/auth/otp').send({ email: EMAIL, type: 'EMAIL_VERIFICATION' });
		expect(otp.status).toBe(400);
		expect(otp.body.data).toEqual({ reason: 'verification_by_link' });
		const verifyOtp = await request(app).post('/api/v1/user/auth/verify-otp').send({ email: EMAIL, otp: '123456', type: 'EMAIL_VERIFICATION' });
		expect(verifyOtp.body.data).toEqual({ reason: 'verification_by_link' });
		const legacyLogin = await request(app).post('/api/v1/user/auth/login').set('time_zone', 'UTC').send({ email: EMAIL, password: PASSWORD });
		expect(legacyLogin.status).toBe(403);
		expect(legacyLogin.body.data).toMatchObject({ reason: 'email_not_verified' });
	});
});
