import axios from 'axios'
import config from '../configs/config'



export const fetchLocationDetailsWithPlaceId = async (placeId: string) => {
    try {
      const response = await axios.get(`https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&key=${config.googleApis.placeApi.keySecret}`);
      return response.data.result;
    } catch (error) {
        return null;
    }
};

export function generateGrid(latitude: string, longitude: string, gridSize: number, spacing: number, unit: string = "meters") {
    const grid: any = [];
    const R = 6371; // Earth's radius in km

    // Convert input values to numbers
    let lat = parseFloat(latitude);
    let long = parseFloat(longitude);

    // Convert spacing to kilometers
    let spacingKm = unit === "miles" ? spacing * 1.60934 : spacing / 1000;

    // Convert spacing to latitude/longitude degrees
    const dLat = (spacingKm / R) * (180 / Math.PI);
    const dLng = (spacingKm / (R * Math.cos(lat * Math.PI / 180))) * (180 / Math.PI);

    // Ensure we generate exactly gridSize x gridSize points
    const halfGrid = Math.floor(gridSize / 2);

    for (let i = 0; i < gridSize; i++) {
        for (let j = 0; j < gridSize; j++) {
            grid.push({
                lat: lat + (i - halfGrid) * dLat,
                long: long + (j - halfGrid) * dLng
            });
        }
    }

    return grid;
}

export async function getUULE(lat: number, long: number): Promise<string | null> {
    try {
        const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${long}&key=${config.googleApis.placeApi.keySecret}`;

        const response = await axios.get(geocodeUrl);
        const results = response.data.results;

        if (results.length === 0) {
            console.error("❌ No location found for given lat-long");
            return null;
        }

        // Extracting the "Canonical Location Name"
        const locationName = results[0].formatted_address; // Example: "Connaught Place, Delhi, India"

        // Encode the location using Base64
        const encodedLocation = Buffer.from(locationName, 'utf8').toString('base64');

        // Construct the UULE parameter
        const uule = `w+CAIQICI${encodedLocation}`;

        return uule;
    } catch (error) {
        console.error("❌ Google Geocode API Error:", error.message);
        return null;
    }
}

export async function getKeywordAverageRank(keyword: string, locationUuleId: string) {
	try {
		let serpData = await getLocalRankWithSerp(keyword, locationUuleId);
		// Extract first page results
		if (serpData?.local_results) {
			return serpData.local_results
		}
        return [];
	} catch (error) {
		console.error("❌ Error fetching keyword rankings:", error);
		return [];
	}
}



export async function getLocalRankWithSerp(keyword: string, locationUuleId: string, url: string = '') {
	try {
        if(url){
            url = `${url}&api_key=${config.serpApis.keySecret}`
        }else{
            url = `https://serpapi.com/search.json?q=${encodeURIComponent(keyword)}&uule=${locationUuleId}&engine=google_local&hl=en&gl=us&google_domain=google.com&api_key=${config.serpApis.keySecret}`;
        }
		const response = await axios.get(url);
		return response.data || {};
	} catch (error) {
		console.error("❌ SerpAPI Error:", error);
		return {};
	}
}