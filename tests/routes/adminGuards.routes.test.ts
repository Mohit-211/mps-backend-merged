import fs from 'fs';
import path from 'path';
import express from 'express';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import config from '../../src/configs/config';
import { AdminPermission, PERMISSION_ROLES } from '../../src/configs/adminPermissions';
import { Admin, Role } from '../../src/models';
import { signAdminToken } from '../../src/services/admin/adminToken';
import { parseEndpointsDoc } from '../helpers/endpoints';
import { clearDb, createUser, startTestDb } from '../helpers/mongoose';

// Phase 10 (AUDIT S1, S2, S3, S27): every endpoint whose ENDPOINTS.md auth column says
// `admin (\`<permission>\`)` is checked against the real app: no token → 401, a user token → 401,
// a role without the permission → 403 forbidden, a role with it → past the guard. The doc and the
// guards can't drift apart.

jest.mock('../../src/configs/mongoConnection', () => ({ agenda: {} }));
jest.mock('../../src/services/common/email.service', () => new Proxy({}, { get: () => jest.fn(async () => true) }));

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const app: express.Express = require('../../src/app').default;
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

const doc = parseEndpointsDoc(fs.readFileSync(path.resolve(__dirname, '../../docs/ENDPOINTS.md'), 'utf8'));
const guarded = doc.catalogue
	.map((e) => ({ ...e, permission: /admin \(`?([a-z.]+)`?\)/.exec(e.auth)?.[1] as AdminPermission | undefined }))
	.filter((e): e is typeof e & { permission: AdminPermission } => Boolean(e.permission));

const ROLE_OF = { superAdmin: config.roles.superAdmin, admin: config.roles.admin, editor: config.roles.editor } as const;
const DUMMY_ID = '0123456789abcdef01234567';
const concrete = (p: string) => p.replace(/:[A-Za-z_]+/g, DUMMY_ID);
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const send = (method: string, url: string, token?: string) => {
	const r = (request(app) as unknown as Record<string, (u: string) => request.Test>)[method.toLowerCase()](url);
	return token ? r.set(bearer(token)) : r;
};

let db: { stop: () => Promise<void> };
const tokens: Record<keyof typeof ROLE_OF, string> = { superAdmin: '', admin: '', editor: '' };
let userToken = '';
beforeAll(async () => {
	db = await startTestDb();
	await clearDb();
	await Role.create(Object.entries(ROLE_OF).map(([name, role_id]) => ({ name, role_id, abbreviation: name.slice(0, 2) })));
	for (const [key, roleId] of Object.entries(ROLE_OF)) {
		const a = await Admin.create({ name: key, email: `${key}@test.dev`, role_id: roleId, password: bcrypt.hashSync('x-Password-1', 4) });
		tokens[key as keyof typeof ROLE_OF] = signAdminToken({ sub: String(a._id), role_id: roleId, tv: 0 });
	}
	userToken = (await createUser('user@test.dev')).token;
}, 60000);
afterAll(async () => db.stop());

describe('admin guards from ENDPOINTS.md', () => {
	it('covers every admin-only group (sanity)', () => {
		expect(guarded.length).toBeGreaterThanOrEqual(45);
		expect(new Set(guarded.map((g) => g.permission))).toEqual(new Set(['admins.manage', 'platform.read', 'platform.write', 'content.manage', 'system.read', 'citations.view', 'citations.manage', 'billing.read', 'billing.manage']));
	});

	it.each(guarded.map((g) => [`${g.method} ${g.path}`, g] as const))('%s', async (_name, g) => {
		const url = concrete(g.path);
		expect((await send(g.method, url)).status).toBe(401);
		expect((await send(g.method, url, userToken)).status).toBe(401);
		for (const role of Object.keys(ROLE_OF) as (keyof typeof ROLE_OF)[]) {
			const res = await send(g.method, url, tokens[role]);
			if (PERMISSION_ROLES[g.permission].includes(role)) {
				expect([401, 403]).not.toContain(res.status);
			} else {
				expect(res.status).toBe(403);
				expect(res.body.data).toMatchObject({ reason: 'forbidden', permission: g.permission });
			}
		}
	});
});

describe('public by design', () => {
	it.each([
		['GET', '/api/v1/countries'],
		['GET', '/api/v1/business-categories'],
		['GET', '/api/v1/faqs'],
		['GET', '/api/v1/blog/get'],
		['GET', '/api/v1/subscription/plans/country/US'],
		['GET', '/api/healthcheck'],
	])('%s %s needs no token', async (method, url) => {
		expect([401, 403]).not.toContain((await send(method, url)).status);
	});
});

