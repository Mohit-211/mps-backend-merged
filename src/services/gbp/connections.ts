import { Types } from 'mongoose';
import httpStatus from 'http-status';
import { ConnectionRef, GbpNotConnectedError } from '../../clients/gbpClient';
import { tokenTypes } from '../../configs/constantTypes';
import { ApiError } from '../../utils';
import { AmbiguousConnectionError, TokenStore, tokenStore } from './tokenStore';

// Resolving which connected Google account (connection) to act as (Phase 7a: several per user).

type UserId = Types.ObjectId | string;

/**
 * The connection for an explicit google_sub, or the user's only connection when none is given.
 * 400 when the sub is not connected, or when several are connected and none was chosen.
 */
export const resolveConnection = async (
	userId: UserId,
	googleSub?: string | null,
	tokens: Pick<TokenStore, 'listConnections'> = tokenStore,
): Promise<ConnectionRef> => {
	const connections = await tokens.listConnections(userId, tokenTypes.GBP);
	if (connections.length === 0) throw new GbpNotConnectedError();
	if (googleSub !== undefined && googleSub !== null && googleSub !== '') {
		if (!connections.some((c) => c.googleSub === googleSub)) {
			throw new ApiError(httpStatus.BAD_REQUEST, 'That Google account is not connected.');
		}
		return { userId, googleSub };
	}
	if (connections.length > 1) {
		throw new ApiError(httpStatus.BAD_REQUEST, 'Several Google accounts are connected: google_sub is required.');
	}
	return { userId, googleSub: connections[0].googleSub };
};

/** The connection a binding was made with (pre-7a bindings: the user's only connection). */
export const connectionForBinding = (binding: { user_id: unknown; google_sub?: string | null }): ConnectionRef => ({
	userId: String(binding.user_id),
	googleSub: binding.google_sub ?? undefined,
});

export { AmbiguousConnectionError };
