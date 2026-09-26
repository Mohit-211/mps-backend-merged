import httpStatus from 'http-status';
import {
	GbpAccessNotApprovedError,
	GbpApiDisabledError,
	GbpApiError,
	GbpConfigError,
	GbpNotConnectedError,
	GbpReauthRequiredError,
} from '../../clients/gbpClient';
import { ApiError } from '../../utils';
import { TokenCryptoConfigError, TokenDecryptError } from '../../utils/tokenCrypto';

/**
 * Maps GBP client and token errors to API errors with messages a user (or Mohit) can act on.
 * "Reconnect" is a 400, not a 401: a 401 from our API means "your MyPageSEO session expired".
 */
export const toGbpApiError = (err: unknown, context?: { forbiddenMessage?: string }): unknown => {
	if (err instanceof ApiError) return err;
	if (err instanceof GbpNotConnectedError) return new ApiError(httpStatus.BAD_REQUEST, 'Please connect with Google Business Profile');
	if (err instanceof GbpReauthRequiredError) return new ApiError(httpStatus.BAD_REQUEST, err.message);
	if (err instanceof GbpAccessNotApprovedError || err instanceof GbpApiDisabledError) {
		return new ApiError(httpStatus.SERVICE_UNAVAILABLE, err.message);
	}
	if (err instanceof GbpConfigError || err instanceof TokenCryptoConfigError) {
		return new ApiError(httpStatus.SERVICE_UNAVAILABLE, `Google Business Profile is not configured on this server: ${err.message}`);
	}
	if (err instanceof TokenDecryptError) {
		return new ApiError(httpStatus.BAD_REQUEST, 'Stored Google authorisation is unreadable. Please reconnect Google Business Profile.');
	}
	if (err instanceof GbpApiError) {
		if ((err.status === 403 || err.status === 404) && context?.forbiddenMessage) {
			return new ApiError(httpStatus.BAD_REQUEST, context.forbiddenMessage);
		}
		return new ApiError(httpStatus.BAD_GATEWAY, `Google Business Profile request failed (${err.status ?? 'network'}).`);
	}
	return err;
};
