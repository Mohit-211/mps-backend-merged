/*
 * GBP preflight (read-only on Google): lists the connected user's Business Profile accounts and
 * locations, names and IDs only, and says clearly why it cannot when something is missing.
 *
 *   npm run gbp:preflight -- <userId>
 *
 * Calls: 1 per page of accounts + 1 per page of locations per account (+ 1 token refresh if the
 * stored access token is about to expire), at most 5 per second. The only local write is persisting
 * a refreshed access token. Tokens are never printed. Development + mps_rebuild only.
 */
import mongoose, { Types } from 'mongoose';
import config from '../configs/config';
import { tokenTypes } from '../configs/constantTypes';
import { GbpAccessNotApprovedError, GbpApiDisabledError, GbpNotConnectedError, createGbpClient } from '../clients/gbpClient';
import { User, UserGBP } from '../models';
import { explainGbpError } from '../services/gbp/errors';
import { tokenStore } from '../services/gbp/tokenStore';

const out = (line = ''): void => void process.stdout.write(`${line}\n`);

const main = async (): Promise<number> => {
	const userId = process.argv[2];
	if (!userId || !Types.ObjectId.isValid(userId)) {
		process.stderr.write('Usage: npm run gbp:preflight -- <userId>\n');
		return 2;
	}
	if (config.essentials.env !== 'development') {
		process.stderr.write(`gbp:preflight refused: NODE_ENV is "${config.essentials.env}", not "development"\n`);
		return 2;
	}
	await mongoose.connect(config.databases.mongodb.url, {
		user: config.databases.mongodb.user,
		pass: config.databases.mongodb.password,
		authSource: config.databases.mongodb.authSource,
		serverSelectionTimeoutMS: 10000,
	});
	const client = createGbpClient();
	try {
		if (mongoose.connection.db?.databaseName !== 'mps_rebuild') {
			process.stderr.write(`gbp:preflight refused: database is "${mongoose.connection.db?.databaseName}", not "mps_rebuild"\n`);
			return 2;
		}
		const user = await User.findById(userId);
		if (!user) {
			out('User not found.');
			return 1;
		}
		out(`User:       ${user.email} (is_gbp_connected=${String(user.is_gbp_connected)})`);
		const connections = await tokenStore.listConnections(user._id, tokenTypes.GBP);
		if (connections.length === 0) {
			out(`\nResult:     ${explainGbpError(new GbpNotConnectedError())}`);
			return 1;
		}
		const bindings = await UserGBP.find({ user_id: user._id, is_active: true }).lean();
		const boundTo = new Map(bindings.map((b) => [b.gbpLocationId, String(b.location_id)]));

		// One block per connected Google account; a failing account does not stop the others.
		let total = 0;
		let failures = 0;
		let quotaZero = false;
		for (const connection of connections) {
			const conn = { userId: user._id, googleSub: connection.googleSub };
			out(`\n=== Connected as ${connection.googleEmail ?? '(unknown account)'}  status=${connection.status}  expires ${connection.expiryDate?.toISOString() ?? 'unknown'}`);
			try {
				const accounts = await client.listAccounts(conn);
				out(`Accounts:   ${accounts.length}`);
				for (const account of accounts) {
					out(`\n${account.name}  ${account.accountName ?? '(no name)'}  type=${account.type ?? '-'} role=${account.role ?? '-'}`);
					try {
						const locations = await client.listLocations(conn, account.name);
						total += locations.length;
						if (locations.length === 0) out('   (no locations)');
						for (const l of locations) {
							const bound = boundTo.get(l.name);
							out(`   ${l.name}  ${l.title ?? '(no title)'}  place_id=${l.placeId ?? '-'}${bound ? `  bound to location ${bound}` : ''}`);
						}
					} catch (err) {
						if (err instanceof GbpAccessNotApprovedError || err instanceof GbpApiDisabledError) throw err;
						failures += 1;
						out(`   ${explainGbpError(err)}`);
					}
				}
			} catch (err) {
				failures += 1;
				quotaZero ||= err instanceof GbpAccessNotApprovedError;
				out(`   ${explainGbpError(err)}`);
			}
		}
		out(`\nResult:     ${failures === 0 ? 'OK' : 'PARTIAL'}: ${connections.length} Google account(s), ${total} locations${failures ? `, ${failures} failure(s)` : ''}`);
		if (quotaZero) return 3;
		return failures === 0 ? 0 : 1;
	} catch (err) {
		out(`\nResult:     ${explainGbpError(err)}`);
		return err instanceof GbpAccessNotApprovedError ? 3 : 1;
	} finally {
		const stats = client.getStats();
		out(`API calls:  ${stats.calls} ${JSON.stringify(stats.byEndpoint)}`);
		await mongoose.disconnect();
	}
};

main()
	.then((code) => process.exit(code))
	.catch((err: Error) => {
		process.stderr.write(`gbp:preflight failed: ${err.message}\n`);
		process.exit(1);
	});
