import { getJson } from "serpapi";


export async function getKeywordAverageMapRank(keyword: string, latitude: number, longitude: number) {
	try {
		let serpData = await getLocalMapRankWithSerp(keyword, latitude, longitude);
        return serpData;
	} catch (error) {
		console.error("❌ Error fetching keyword rankings:", error);
		return [];
	}
}



export async function getLocalMapRankWithSerp(keyword: string, latitude: number, longitude: number) {
    try {
        const params = {
            type: "search",
            google_domain: "google.com",
            hl: "en",
            engine: "google_maps",
            q: keyword,
            ll: `@${latitude},${longitude},14z`,
        };
        const data = await getJson(params);
        if (!data) {
            return [];
        }

		if(data && data.local_results && Array.isArray(data.local_results)){
			return data.local_results.map(local => {
				return {
					position: local.position ?? null,
					title: local.title ?? "Unknown",
					place_id: local.place_id ?? "",
					reviews_link: local.reviews_link ?? "",
					photos_link: local.photos_link ?? "",
					gps_coordinates: local.gps_coordinates ?? { latitude: 0, longitude: 0 },
					rating: local.rating ?? 0,
					reviews: local.reviews ?? 0,
					type: local.type ?? "Unknown",
					types: local.types ?? [],
					address: local.address ?? "No address available",
					phone: local.phone ?? "No phone available",
					website: local.website ?? "No website available",
					thumbnail: local.thumbnail ?? "",
					operating_hours: local.operating_hours ?? {},
				};
			});
		}else if(data && data.place_results){
			return [{
				position: data.place_results.position,
				title: data.place_results.title,
				place_id: data.place_results.place_id,
				reviews_link: data.place_results.reviews_link,
				photos_link: data.place_results.photos_link,
				gps_coordinates: data.place_results.gps_coordinates,
				rating: data.place_results.rating,
				reviews: data.place_results.reviews,
				type: data.place_results.type,
				types: data.place_results.types,
				address: data.place_results.address,
				phone: data.place_results.phone,
				website: data.place_results.website,
				thumbnail: data.place_results.thumbnail,
				operating_hours: data.place_results.operating_hours,
			}]
		}

    } catch (error) {
        console.error("❌ SerpAPI Error:", error);
        return [];
    }
}