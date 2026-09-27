import { Types } from 'mongoose';

// Shared helpers for the citation services (Phase 16).

/** The platform admin making a change (from res.locals.admin). */
export interface AdminActor {
	id: string;
	name: string | null;
}

export const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const oid = (id: string | Types.ObjectId): Types.ObjectId => (typeof id === 'string' ? new Types.ObjectId(id) : id);

export const isObjectId = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{24}$/i.test(id);

/** "https://www.Yelp.com/biz/x" → "yelp.com"; null when not an http(s) URL. */
export const domainOf = (url: string): string | null => {
	try {
		const u = new URL(url.trim());
		if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
		return u.hostname.toLowerCase().replace(/^www\./, '') || null;
	} catch {
		return null;
	}
};

export interface Paging {
	page: number;
	limit: number;
}

export const paging = (q: { page?: number; limit?: number }, defaultLimit = 50): Paging => ({
	page: Math.max(1, q.page ?? 1),
	limit: Math.min(100, Math.max(1, q.limit ?? defaultLimit)),
});
