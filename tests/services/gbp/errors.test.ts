import {
	GbpAccessNotApprovedError,
	GbpApiDisabledError,
	GbpApiError,
	GbpConfigError,
	GbpNotConnectedError,
	GbpReauthRequiredError,
} from '../../../src/clients/gbpClient';
import { HttpRequestError, httpErrorFromResponse } from '../../../src/clients/http';
import { explainGbpError, toGbpApiError } from '../../../src/services/gbp/errors';
import { TokenCryptoConfigError } from '../../../src/utils/tokenCrypto';
import { loadGbpFixture } from '../../helpers/fakeTransport';

const quota0 = new GbpAccessNotApprovedError(httpErrorFromResponse(429, loadGbpFixture('error_quota0')), 1);
const disabled = new GbpApiDisabledError(httpErrorFromResponse(403, loadGbpFixture('error_service_disabled')), 1);

describe('explainGbpError (preflight)', () => {
	it('says exactly "GBP API access not approved (quota 0)" for a quota-0 429', () => {
		expect(explainGbpError(quota0)).toMatch(/^GBP API access not approved \(quota 0\)\./);
	});
	it('names the disabled API', () => {
		expect(explainGbpError(disabled)).toContain('API not enabled: ');
		expect(explainGbpError(disabled)).toContain('My Business Account Management API');
	});
	it('covers not connected, reconnect and configuration', () => {
		expect(explainGbpError(new GbpNotConnectedError())).toMatch(/^Not connected/);
		expect(explainGbpError(new GbpReauthRequiredError(1))).toMatch(/^Reconnect needed/);
		expect(explainGbpError(new TokenCryptoConfigError('TOKEN_ENCRYPTION_KEY not set'))).toBe(
			'Server not configured: TOKEN_ENCRYPTION_KEY not set',
		);
		expect(explainGbpError(new GbpConfigError('missing client id'))).toMatch(/^Server not configured/);
	});
});

describe('toGbpApiError', () => {
	it('maps to user-facing statuses (reconnect is 400, not 401)', () => {
		expect(toGbpApiError(new GbpNotConnectedError())).toMatchObject({ statusCode: 400, message: 'Please connect with Google Business Profile' });
		expect(toGbpApiError(new GbpReauthRequiredError(1))).toMatchObject({ statusCode: 400 });
		expect(toGbpApiError(quota0)).toMatchObject({ statusCode: 503 });
		expect(toGbpApiError(new TokenCryptoConfigError('TOKEN_ENCRYPTION_KEY not set'))).toMatchObject({ statusCode: 503 });
		expect(toGbpApiError(new GbpApiError('x', { status: 500 }, 2))).toMatchObject({ statusCode: 502 });
		expect(toGbpApiError(new GbpApiError('x', { status: 404 }, 1), { forbiddenMessage: 'no access' })).toMatchObject({
			statusCode: 400,
			message: 'no access',
		});
	});
	it('passes unknown errors through', () => {
		const err = new HttpRequestError({ code: 'NETWORK_ERROR', message: 'x' });
		expect(toGbpApiError(err)).toBe(err);
	});
});
