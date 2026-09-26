/*
 * Finds a business's place ID. Real Google calls: run it only with a test key. The key is never printed.
 *
 *   npm run find:place -- "<query>" <lat> <lng> [--region=us|ca]
 *       ONE IDs-only Text Search (page 1), then ONE Place Details call for the top result
 *       (fields id, displayName, formattedAddress, location).
 *   npm run find:place -- "<query>" <lat> <lng> --names [--region=us|ca]
 *       ONE Text Search with names (Pro SKU, page 1): lists up to 20 names + place IDs, no Details.
 *   npm run find:place -- --id=<place_id>
 *       ONE Place Details call (same 4 fields) for a place picked from the --names list.
 *
 * <lat> <lng> bias the search (e.g. the city center).
 */
import { PlacesApiError, PlacesConfigError, placesClient } from '../clients/placesClient';
import { PlaceDetailsField } from '../clients/types/places';

const DETAIL_FIELDS: PlaceDetailsField[] = ['id', 'displayName', 'formattedAddress', 'location'];

const calls = { ids_only: 0, pro: 0, details: 0 };
const callLine = (): string => `API calls: ids_only=${calls.ids_only} pro=${calls.pro} details=${calls.details}`;

const printDetails = async (placeId: string): Promise<void> => {
	const details = await placesClient.getPlaceDetails(placeId, DETAIL_FIELDS);
	calls.details += details.apiCalls;
	const d = details.details;
	process.stdout.write(
		[
			`Place ID: ${d.id ?? placeId}`,
			`Name:     ${d.displayName ?? '(none)'}`,
			`Address:  ${d.formattedAddress ?? '(none)'}`,
			`Location: ${d.location ? `${d.location.latitude}, ${d.location.longitude}` : '(none)'}`,
		].join('\n') + '\n',
	);
};

const main = async (): Promise<number> => {
	const args = process.argv.slice(2);
	const region = (args.find((a) => a.startsWith('--region=')) ?? '--region=us').split('=')[1];
	const idArg = args.find((a) => a.startsWith('--id='));
	const namesMode = args.includes('--names');
	const [query, latText, lngText] = args.filter((a) => !a.startsWith('--'));
	const lat = Number(latText);
	const lng = Number(lngText);

	if (idArg) {
		await printDetails(idArg.slice('--id='.length));
		process.stdout.write(`${callLine()}\n`);
		return 0;
	}
	if (!query || !Number.isFinite(lat) || !Number.isFinite(lng)) {
		process.stderr.write(
			'Usage: npm run find:place -- "<query>" <lat> <lng> [--names] [--region=us|ca]  |  npm run find:place -- --id=<place_id>\n',
		);
		return 2;
	}
	const params = { textQuery: query, regionCode: region, center: { latitude: lat, longitude: lng } };

	if (namesMode) {
		const result = await placesClient.searchTextWithNames(params);
		calls.pro += result.apiCalls;
		process.stdout.write(`Query: ${query} (region ${region}), ${result.places.length} results on page 1\n`);
		result.places.forEach((p, i) => process.stdout.write(`${String(i + 1).padStart(2)}. ${p.name ?? '(no name)'}  ${p.id}\n`));
		process.stdout.write(`${callLine()}\n`);
		return 0;
	}

	const search = await placesClient.searchTextIds({ ...params, maxPages: 1 });
	calls.ids_only += search.apiCalls;
	const top = search.places[0];
	if (!top) {
		process.stdout.write(`No results for "${query}". ${callLine()}\n`);
		return 1;
	}
	process.stdout.write(`Query:    ${query} (region ${region})\nResults:  ${search.places.length} on page 1; top result below\n`);
	await printDetails(top.id);
	process.stdout.write(`Other top IDs: ${search.places.slice(1, 5).map((p) => p.id).join(', ') || '(none)'}\n${callLine()}\n`);
	return 0;
};

main()
	.then((code) => process.exit(code))
	.catch((err: Error) => {
		if (err instanceof PlacesConfigError) process.stderr.write('GOOGLE_PLACE_API_KEY not set. No call was made.\n');
		else if (err instanceof PlacesApiError) {
			process.stderr.write(`Places API error: status=${err.status ?? err.code} ${err.message} (calls in the failed request: ${err.apiCalls})\n`);
		} else process.stderr.write(`Unexpected error: ${err.message}\n`);
		process.stderr.write(`${callLine()} (before the failure)\n`);
		process.exit(1);
	});
