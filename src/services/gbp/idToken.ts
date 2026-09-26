import { OAuth2Client } from 'google-auth-library';
import config from '../../configs/config';

// Verifies the OpenID Connect id_token Google returns with the GBP tokens (Phase 7a): RS256 signature
// against Google's published certificates, issuer, audience (our client ID) and expiry, then
// email_verified. The result identifies the connected Google account ("Connected as x@gmail.com").

export const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

export interface GoogleIdentity {
	sub: string;
	email: string;
}

export class IdTokenError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'IdTokenError';
	}
}

/** key id → PEM certificate or public key. */
export type Certs = Record<string, string>;

export interface IdTokenVerifierOptions {
	clientId?: string;
	/** Defaults to Google's published certificates (fetched and cached by google-auth-library). */
	getCerts?: () => Promise<Certs>;
}

export type IdTokenVerifier = (idToken: string | null | undefined) => Promise<GoogleIdentity>;

export const createIdTokenVerifier = (options: IdTokenVerifierOptions = {}): IdTokenVerifier => {
	const client = new OAuth2Client();
	const getCerts = options.getCerts ?? (async () => (await client.getFederatedSignonCertsAsync()).certs as Certs);

	return async (idToken) => {
		const clientId = options.clientId ?? config.gbp.clientId;
		if (!clientId) throw new IdTokenError('GOOGLE_GBP_CLIENT_ID not set');
		if (!idToken) throw new IdTokenError('Google did not return an id_token (the openid scope is required)');
		let payload;
		try {
			const ticket = await client.verifySignedJwtWithCertsAsync(idToken, await getCerts(), clientId, GOOGLE_ISSUERS);
			payload = ticket.getPayload();
		} catch (err) {
			// The library's messages can include the token; keep only a generic reason.
			const reason = err instanceof Error ? err.message : '';
			const kind = /expired|too late/i.test(reason)
				? 'expired'
				: /audience/i.test(reason)
					? 'wrong audience'
					: /issuer/i.test(reason)
						? 'wrong issuer'
						: 'invalid signature or format';
			throw new IdTokenError(`Google id_token rejected (${kind})`);
		}
		if (!payload?.sub || !payload.email) throw new IdTokenError('Google id_token has no subject or email');
		if (payload.email_verified !== true) throw new IdTokenError('Google account email is not verified');
		return { sub: payload.sub, email: payload.email.toLowerCase() };
	};
};

export const verifyGoogleIdToken: IdTokenVerifier = createIdTokenVerifier();
