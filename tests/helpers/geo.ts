// Great-circle distance used to check the flat-earth offsets in src/ranking/points.ts.
export const haversineKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }): number => {
	const R = 6371;
	const toRad = (d: number): number => (d * Math.PI) / 180;
	const dLat = toRad(b.lat - a.lat);
	const dLng = toRad(b.lng - a.lng);
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
	return 2 * R * Math.asin(Math.sqrt(h));
};
