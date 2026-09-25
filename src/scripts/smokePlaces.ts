/*
 * Live smoke test for the Places client: ONE IDs-only Text Search call, page 1 only.
 *
 *   npm run smoke:places -- "<keyword>" <lat> <lng> [place_id] [--region=us|ca]
 *
 * Prints the result count, whether place_id was found and at what rank, and the API call count.
 * Uses the free "Text Search Essentials (IDs Only)" SKU. Makes a real Google call: run it only
 * when a (test, budget-capped) GOOGLE_PLACE_API_KEY is set. The key is never printed.
 */
import { PlacesApiError, PlacesConfigError, normalisePlaceId, placesClient } from '../clients/placesClient';

const usage = 'Usage: npm run smoke:places -- "<keyword>" <lat> <lng> [place_id] [--region=us|ca]';

const main = async (): Promise<number> => {
	const args = process.argv.slice(2);
	const regionArg = args.find((a) => a.startsWith('--region='));
	const positional = args.filter((a) => !a.startsWith('--'));
	const [keyword, latText, lngText, placeIdArg] = positional;
	const latitude = Number(latText);
	const longitude = Number(lngText);
	const regionCode = regionArg ? regionArg.split('=')[1] : 'us';

	if (!keyword || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
		process.stderr.write(`${usage}\n`);
		return 2;
	}
	const placeId = normalisePlaceId(placeIdArg);

	try {
		const result = await placesClient.searchTextIds({
			textQuery: keyword,
			regionCode,
			center: { latitude, longitude },
			maxPages: 1,
			stopWhenFound: placeId ? [placeId] : undefined,
		});
		const index = placeId
			? result.places.findIndex((p) => p.id === placeId || p.movedPlaceId === placeId)
			: -1;
		const lines = [
			`Keyword:        ${keyword}`,
			`Center:         ${latitude}, ${longitude} (region ${regionCode})`,
			`Results:        ${result.places.length} (page 1 only)`,
			placeId
				? `Target:         ${placeId} ${index >= 0 ? `found at rank ${index + 1}` : 'not found on page 1 (rank > 20)'}`
				: 'Target:         (none given)',
			`API calls:      ${result.apiCalls} (IDs-only SKU, retries included)`,
		];
		process.stdout.write(`${lines.join('\n')}\n`);
		return 0;
	} catch (err) {
		if (err instanceof PlacesConfigError) {
			process.stderr.write('GOOGLE_PLACE_API_KEY not set. Add a test key to .env first. No call was made.\n');
			return 1;
		}
		if (err instanceof PlacesApiError) {
			process.stderr.write(
				`Places API error: status=${err.status ?? err.code} ${err.apiStatus ?? ''} ${err.message}\nAPI calls: ${err.apiCalls}\n`,
			);
			return 1;
		}
		throw err;
	}
};

main()
	.then((code) => process.exit(code))
	.catch((err: Error) => {
		process.stderr.write(`Unexpected error: ${err.message}\n`);
		process.exit(1);
	});
