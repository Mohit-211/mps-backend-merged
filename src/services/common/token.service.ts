/* eslint-disable @typescript-eslint/no-explicit-any */
import jwt, { JwtPayload } from 'jsonwebtoken';
import { DateTime } from 'luxon';
import httpStatus from 'http-status';

import config from '../../configs/config';
import { UserToken, IUserToken, IUser } from '../../models';
import { mongoOperationsTypes, tokenTypes } from '../../configs/constantTypes';
import { ApiError, mongoFunctions } from '../../utils';

interface TokenPayload extends JwtPayload {
	sub: string | any;
	iat: number;
	exp: number;
	type: string;
	role_id: number;
	userType?: string;
}

export const generateToken = (
	userId: any,
	expires: DateTime,
	type: string,
	role_id: number,
	user_type: string,
	secret: string = config.constants.jwt.secret,
): string => {
	try {
		const payload: TokenPayload = {
			sub: userId.toString(),
			iat: DateTime.now().toUnixInteger(),
			exp: expires.toUnixInteger(),
			type,
			role_id,
			user_type,
		};
		return jwt.sign(payload, secret);
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
	fcm_token: string
): Promise<IUserToken> => {
	try {
		const tokenDoc = await mongoFunctions({
			schema: UserToken,
			createData: {
				user_id: userId,
				token_type: type,
				token,
				expired_at: new Date(expires),
				fcm_token: fcm_token,
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
		const payload = jwt.verify(
			token,
			config.constants.jwt.secret,
		) as TokenPayload;
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
		);

		const refreshTokenDoc = await saveToken(
			refreshToken,
			user._id,
			refreshTokenExpires.toUTC().toFormat('yyyy-MM-dd HH:mm:ss'),
			tokenTypes.REFRESH,
			user?.fcm_token,
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