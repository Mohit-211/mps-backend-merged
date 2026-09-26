// Mongoose query logging prints every query and document (emails, token hashes, encrypted tokens),
// so it is opt-in (MONGOOSE_DEBUG=true) and allowed only in development.

export interface MongooseDebugSetting {
	enabled: boolean;
	/** Set when MONGOOSE_DEBUG=true is ignored outside development. */
	warning: string | null;
}

export const resolveMongooseDebug = (env: string, requested: boolean): MongooseDebugSetting => {
	if (!requested) return { enabled: false, warning: null };
	if (env === 'development') return { enabled: true, warning: null };
	return { enabled: false, warning: `MONGOOSE_DEBUG=true ignored: query logging is allowed only when NODE_ENV=development (NODE_ENV=${env})` };
};
