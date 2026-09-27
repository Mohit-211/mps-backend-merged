import fs from 'fs';
import path from 'path';
import express from 'express';
import request from 'supertest';

// Phase 10 (AUDIT S5, S7, S8, S9, S10, S16): the app's transport-level protections, on the real app.

jest.mock('../../src/configs/mongoConnection', () => ({ agenda: {} }));
jest.mock('node-cron', () => ({ schedule: jest.fn() }));

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const app: express.Express = require('../../src/app').default;
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

const uploadsDir = path.resolve(__dirname, '../../public/uploads/images');
const countUploads = () => (fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir).length : 0);

describe('transport', () => {
	it('trusts one proxy hop (S5)', () => {
		expect(app.get('trust proxy')).toBe(1);
	});

	it('sends helmet headers with a strict CSP and no wildcard CORS (S8, S9)', async () => {
		const res = await request(app).get('/api/healthcheck').set('Origin', 'https://evil.example');
		expect(res.headers['x-content-type-options']).toBe('nosniff');
		expect(res.headers['strict-transport-security']).toBeDefined();
		expect(res.headers['content-security-policy']).toContain("script-src 'self'");
		expect(res.headers['content-security-policy']).not.toMatch(/polyfill|unsafe-eval/);
		expect(res.headers['access-control-allow-origin']).toBeUndefined();
		expect(res.status).toBe(200);
	});

	it('refuses bodies over 1 MB (S10)', async () => {
		const res = await request(app).post('/api/v1/auth/login').send({ email: 'a@b.c', password: 'x'.repeat(1_100_000) });
		expect(res.status).toBe(413);
	});
});

describe('uploads (S7)', () => {
	it('a non-upload route parses multipart text fields but refuses files; nothing is written', async () => {
		const before = countUploads();
		const withFile = await request(app).post('/api/v1/auth/login').field('email', 'a@b.c').attach('images', Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'x.jpg');
		expect(withFile.status).toBe(400);
		expect(withFile.body.message).toContain('does not accept files');
		const fields = await request(app).post('/api/v1/auth/login').field('email', 'not-an-email').field('password', 'x');
		expect(fields.status).toBe(400);
		expect(fields.body.message).not.toContain('files');
		expect(countUploads()).toBe(before);
	});

	it('an upload route refuses an unauthenticated upload before writing the file', async () => {
		const before = countUploads();
		const res = await request(app).post('/api/v1/white-label-profiles').attach('images', Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'logo.png');
		expect(res.status).toBe(401);
		expect(countUploads()).toBe(before);
	});
});

describe('file routes (S16)', () => {
	it.each(['/images/..%2F..%2Fpackage.json', '/images/%2e%2e%2f%2e%2e%2fpackage.json', '/videos/..%2F..%2F.env.example', '/images/..%5C..%5Cpackage.json'])(
		'%s does not escape the uploads folder',
		async (url) => {
			const res = await request(app).get(url);
			expect(res.status).toBe(404);
			expect(res.text ?? '').not.toContain('"name": "mypageseo"');
		},
	);
});
