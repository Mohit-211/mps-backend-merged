/*
 * Finds a business's place ID: ONE IDs-only Text Search (page 1), then ONE Place Details call for the
 * top result with fields id, displayName, formattedAddress, location. Real Google calls: run it only
 * with a test key.
 *
 *   npm run find:place -- "<query>" <lat> <lng> [--region=us|ca]
 *
 * <lat> <lng> bias the search (e.g. the city center). The key is never printed.
 */
import { PlacesApiError, PlacesConfigError, placesClient } from '../clients/placesClient';

const main = async (): Promise<number> => {
	const args = process.argv.slice(2);
	const region = (args.find((a) => a.startsWith('--region=')) ?? '--region=us').split('=')[1];
	const [query, latText, lngText] = args.filter((a) => !a.startsWith('--'));
	const lat = Number(latText);
	const lng = Number(lngText);
	if (!query || !Number.isFinite(lat) || !Number.isFinite(lng)) {
		process.stderr.write('Usage: npm run find:place -- "<query>" <lat> <lng> [--region=us|ca]\n');
		return 2;
	}

	const calls = { ids_only: 0, details: 0 };
	try {
		const search = await placesClient.searchTextIds({
			textQuery: query,
			regionCode: region,
			center: { latitude: lat, longitude: lng },
			maxPages: 1,
		});
		calls.ids_only += search.apiCalls;
		const top = search.places[0];
		if (!top) {
			process.stdout.write(`No results for "${query}". API calls: ids_only=${calls.ids_only} details=0\n`);
			return 1;
		}
		const details = await placesClient.getPlaceDetails(top.id, ['id', 'displayName', 'formattedAddress', 'location']);
		calls.details += details.apiCalls;
		const d = details.details;
		process.stdout.write(
			[
				`Query:    ${query} (region ${region})`,
				`Results:  ${search.places.length} on page 1; top result below`,
				`Place ID: ${d.id ?? top.id}`,
				`Name:     ${d.displayName ?? '(none)'}`,
				`Address:  ${d.formattedAddress ?? '(none)'}`,
				`Location: ${d.location ? `${d.location.latitude}, ${d.location.longitude}` : '(none)'}`,
				`Other top IDs: ${search.places.slice(1, 5).map((p) => p.id).join(', ') || '(none)'}`,
				`API calls: ids_only=${calls.ids_only} details=${calls.details}`,
			].join('\n') + '\n',
		);
		return 0;
	} catch (err) {
		if (err instanceof PlacesConfigError) {
			process.stderr.write('GOOGLE_PLACE_API_KEY not set. No call was made.\n');
			return 1;
		}
		if (err instanceof PlacesApiError) {
			process.stderr.write(`Places API error: status=${err.status ?? err.code} ${err.apiStatus ?? ''} ${err.message}\n`);
			process.stderr.write(`API calls: ids_only=${calls.ids_only + (calls.details ? 0 : err.apiCalls)} details=${calls.details}\n`);
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
