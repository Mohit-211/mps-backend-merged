import { getJson } from "serpapi";
import { ILocation } from "../../models";

export async function getAllRankings(keywords: string[], domains: string[], locationDoc: ILocation) {
    const rankings = await Promise.all(
        keywords.map(async (keyword) => {
            const result = await keywordSearch(keyword, locationDoc);
            return getRanking(result, domains);
        })
    );

    const combinedRankings: any = {};
    rankings.forEach(ranking => {
        const keyword = Object.keys(ranking)[0];
        combinedRankings[keyword] = ranking[keyword];
    });

    return combinedRankings;
};

export async function keywordSearch(keyword: string, locationDoc: ILocation) {
    const params = {
        q: keyword,
        location: `${locationDoc.city}, ${locationDoc.state}, ${locationDoc.country}`,
        google_domain: "google.com",
        gl: "in",
        hl: "en",
        engine: "google",
        num: 50,
        start: 0,
    };

    const data = await getJson("google", params);
    return data;
};

export async function getRanking(data: any, domains: string[]) {
    const keyword = data.search_parameters.q;
    const rankings: any = {};

    domains.forEach(domain => {
        rankings[domain] = { rank: 51 };
    });

    if (data.organic_results && data.organic_results.length > 0) {
        data.organic_results.forEach((result: any, index: number) => {
            const resultLink = result["displayed_link"];
            domains.forEach(domain => {
                if (resultLink.includes(domain) && rankings[domain].rank === 51) {
                    rankings[domain] = { rank: index + 1 };
                }
            });
        });
    }

    return { [keyword]: rankings };
};