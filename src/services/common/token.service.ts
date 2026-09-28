/* eslint-disable @typescript-eslint/no-explicit-any */
import jwt, { JwtPayload } from 'jsonwebtoken';
import { DateTime } from 'luxon';
import httpStatus from 'http-status';

import config from '../../configs/config';
import { User, UserToken, IUserToken, IUser } from '../../models';
import { mongoOperationsTypes, tokenTypes } from '../../configs/constantTypes';
import { ApiError, mongoFunctions } from '../../utils';

interface TokenPayload extends JwtPayload {
	sub: string | any;
	iat: number;
	exp: number;
	type: string;
	role_id: number;
	userType?: string;
	tv?: number;
}

export const generateToken = (
	userId: any,
	expires: DateTime,
	type: string,
	role_id: number,
	user_type: string,
	secret: string = config.constants.jwt.secret,
	tokenVersion = 0,
): string => {
	try {
		const payload: TokenPayload = {
			sub: userId.toString(),
			iat: DateTime.now().toUnixInteger(),
			exp: expires.toUnixInteger(),
			type,
			role_id,
			user_type,
			// Phase 10: User.token_version at issue time (revocation).
			tv: tokenVersion,
		};
		return jwt.sign(payload, secret, { algorithm: 'HS256' });
	} catch (error: any) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

export const saveToken = async (
	token: string,
	userId: any,
	expires: string,
	type: string,
): Promise<IUserToken> => {
	try {
		const tokenDoc = await mongoFunctions({
			schema: UserToken,
			createData: {
				user_id: userId,
				token_type: type,
				token,
				expired_at: new Date(expires),
			},
			operationType: mongoOperationsTypes.CREATE,
		});
		return tokenDoc;
	} catch (error: any) {
		throw new ApiError(
			error?.statusCode
				? error?.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error?.message,
		);
	}
};

export const verifyToken = async (
	token: string,
	type: string,
): Promise<any | null> => {
	try {
		let payload: TokenPayload;
		try {
			// Phase 10: HS256 only; a bad signature or an expired token is a 401 (it used to become a 500).
			payload = jwt.verify(token, config.constants.jwt.secret, { algorithms: ['HS256'] }) as TokenPayload;
		} catch {
			throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid or expired token. Please log in again.');
		}
		if (!payload) {
			throw new ApiError(
				httpStatus.UNAUTHORIZED,
				`Invalid token. Please log in again.`,
			);
		}
		if (payload.type !== type) {
			throw new ApiError(
				httpStatus.UNAUTHORIZED,
				`Invalid token type. Please priovide a valid ${type.toLowerCase()} token`,
			);
		}
		if (payload.exp < Math.floor(Date.now() / 1000)) {
			throw new ApiError(
				httpStatus.UNAUTHORIZED,
				'Your session has expired. Please log in again to continue.',
			);
		}

		if (type === tokenTypes.REFRESH) {
			const tokenDoc = await UserToken.findOne({
				token: token,
				token_type: type,
				user_id: payload.sub,
			});
			if (!tokenDoc) {
				throw new ApiError(
					httpStatus.UNAUTHORIZED,
					'Token not found. Please log in again.',
				);
			};
			return tokenDoc;
		}

		return payload;
	} catch (error: any) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

export const generateAuthTokens = async (
	user: IUser,
): Promise<{ access: any; refresh: any }> => {
	try {

		return {
			access: await generateAuthAccessTokens(user),
			refresh: await generateAuthRefreshTokens(user),
		};
	} catch (error: any) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

export const generateAuthAccessTokens = async (user: IUser): Promise<any> => {
	try {
		if (!user) {
			throw new ApiError(
				httpStatus.INTERNAL_SERVER_ERROR,
				'Invalid User',
			);
		}

		const accessTokenExpires = DateTime.now().plus({
			days: config.constants.jwt.accessExpirationDays,
		});

		const accessToken = generateToken(
			user._id,
			accessTokenExpires,
			tokenTypes.ACCESS,
			user.role_id,
			user.user_type,
			config.constants.jwt.secret,
			user.token_version ?? 0,
		);

		return {
			token: accessToken,
			expires: accessTokenExpires.toJSDate(),
		};
	} catch (error: any) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

export const generateAuthRefreshTokens = async (user: IUser): Promise<any> => {
	try {
		if (!user) {
			throw new ApiError(
				httpStatus.INTERNAL_SERVER_ERROR,
				'Invalid User',
			);
		}

		const refreshTokenExpires = DateTime.now().plus({
			days: config.constants.jwt.refreshExpirationDays,
		});

		const refreshToken = generateToken(
			user._id,
			refreshTokenExpires,
			tokenTypes.REFRESH,
			user.role_id,
			user.user_type,
			config.constants.jwt.secret,
			user.token_version ?? 0,
		);

		const refreshTokenDoc = await saveToken(
			refreshToken,
			user._id,
			refreshTokenExpires.toUTC().toFormat('yyyy-MM-dd HH:mm:ss'),
			tokenTypes.REFRESH,
		);

		if (!refreshTokenDoc) {
			throw new ApiError(
				httpStatus.INTERNAL_SERVER_ERROR,
				'Failed to process. Please try again.',
			);
		}

		return {
			id: refreshTokenDoc.id,
			token: refreshToken,
			expires: refreshTokenExpires.toJSDate(),
		};
	} catch (error: any) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};
/**
 * Phase 10 (AUDIT S24): ends every session of a user: bumps token_version (access tokens stop working
 * at once) and deletes the stored refresh tokens. Used on password change/reset and account deletion.
 */
export const revokeUserSessions = async (userId: any): Promise<void> => {
	await User.updateOne({ _id: userId }, { $inc: { token_version: 1 } });
	await UserToken.deleteMany({ user_id: userId });
};
