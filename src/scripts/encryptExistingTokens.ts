/*
 * Encrypts plaintext GBP OAuth tokens already stored in user_auths (AUDIT S12). Idempotent: values
 * that are already encrypted are skipped, so it is safe to run twice.
 *
 *   npm run gbp:encrypt-tokens
 *
 * Needs TOKEN_ENCRYPTION_KEY and the MONGODB_* settings of the target database. Back up user_auths
 * first. Tokens are never printed. Without it, each plaintext row is re-encrypted on its next use.
 */
import mongoose from 'mongoose';
import config from '../configs/config';
import { encryptPlaintextGbpTokens } from '../services/gbp/tokenStore';

const main = async (): Promise<void> => {
	if (!config.security.tokenEncryptionKey) throw new Error('TOKEN_ENCRYPTION_KEY not set');
	await mongoose.connect(config.databases.mongodb.url, {
		user: config.databases.mongodb.user,
		pass: config.databases.mongodb.password,
		authSource: config.databases.mongodb.authSource,
		serverSelectionTimeoutMS: 10000,
	});
	try {
		const db = mongoose.connection.db?.databaseName;
		const result = await encryptPlaintextGbpTokens();
		process.stdout.write(
			`Database ${db}: ${result.scanned} GBP token rows, ${result.encrypted} encrypted now, ${result.alreadyEncrypted} already encrypted.\n`,
		);
	} finally {
		await mongoose.disconnect();
	}
};

main()
	.then(() => process.exit(0))
	.catch((err: Error) => {
		process.stderr.write(`gbp:encrypt-tokens failed: ${err.message}\n`);
		process.exit(1);
	});
