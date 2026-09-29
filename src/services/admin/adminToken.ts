import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import config from '../../configs/config';

// Admin tokens (Phase 10, AUDIT S19). One place signs and verifies every admin token:
// - key: ADMIN_JWT_SECRET (required in production, ≥ 32 characters, different from JWT_SECRET); in
//   development/test a key derived from JWT_SECRET with a fixed label, never the raw user key, so a user
//   token can never pass as an admin token (and the old hex-decoded key is gone);
// - HS256 only, audience 'mps-admin', issuer 'mypageseo';
// - purpose 'session' (12 h) only (13b: password resets use one-time links, services/auth/links.ts);
// - `tv` = Admin.token_version: incrementing it revokes every token issued before.

export const ADMIN_AUDIENCE = 'mps-admin';
const ISSUER = 'mypageseo';
export const ADMIN_SESSION_TTL = '12h';

export type AdminTokenPurpose = 'session';

export interface AdminTokenClaims {
	sub: string;
	role_id: number;
	tv: number;
	purpose: AdminTokenPurpose;
}

export const adminKey = (): Buffer =>
	config.constants.jwt.adminSecret
		? Buffer.from(config.constants.jwt.adminSecret, 'utf8')
		: crypto.createHmac('sha256', config.constants.jwt.secret).update('mps-admin-jwt-v1').digest();

export const signAdminToken = (claims: Omit<AdminTokenClaims, 'purpose'>, purpose: AdminTokenPurpose = 'session'): string =>
	jwt.sign({ role_id: claims.role_id, tv: claims.tv, purpose }, adminKey(), {
		algorithm: 'HS256',
		audience: ADMIN_AUDIENCE,
		issuer: ISSUER,
		subject: claims.sub,
		expiresIn: ADMIN_SESSION_TTL,
	});

/** Throws on a bad signature, algorithm, audience, issuer, expiry or purpose. */
export const verifyAdminToken = (token: string, purpose: AdminTokenPurpose): AdminTokenClaims => {
	const decoded = jwt.verify(token, adminKey(), { algorithms: ['HS256'], audience: ADMIN_AUDIENCE, issuer: ISSUER }) as jwt.JwtPayload;
	if (decoded.purpose !== purpose || typeof decoded.sub !== 'string' || typeof decoded.role_id !== 'number') {
		throw new Error('wrong token purpose');
	}
	return { sub: decoded.sub, role_id: decoded.role_id, tv: typeof decoded.tv === 'number' ? decoded.tv : -1, purpose };
};
