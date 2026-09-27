import express from 'express';
import request from 'supertest';
import logger from '../../src/configs/logger';
import { ApiError, apiErrorHandler } from '../../src/utils';

// Phase 10 (AUDIT S28): no internals in error responses, one log line per error.

const app = express();
app.use(express.json({ limit: '10b' }));
app.get('/boom', () => {
	throw new Error('mongo connection string mongodb://secret@host failed');
});
app.get('/api-error', () => {
	throw new ApiError(409, 'Conflict here');
});
app.post('/echo', (req, res) => res.json(req.body));
app.use(apiErrorHandler);

describe('apiErrorHandler', () => {
	it('500s are generic and logged once; ApiErrors keep their status; body-parser errors keep 4xx', async () => {
		const spy = jest.spyOn(logger, 'error');
		const boom = await request(app).get('/boom');
		expect(boom.status).toBe(500);
		expect(boom.body.message).toBe('Something went wrong.');
		expect(JSON.stringify(boom.body)).not.toContain('mongodb://');
		expect(spy).toHaveBeenCalledTimes(1);
		expect((await request(app).get('/api-error')).body).toMatchObject({ status: 409, message: 'Conflict here' });
		expect((await request(app).post('/echo').send({ a: 'long enough' })).status).toBe(413);
		expect((await request(app).post('/echo').set('Content-Type', 'application/json').send('{bad')).status).toBe(400);
		spy.mockRestore();
	});
});
