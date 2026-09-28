import mongoose from 'mongoose';
import '../../models';
import '../../clients/placesRateLimiter';

// Every registered model's indexes, built from the schemas (Phase 13b: all collections are the rebuilt
// product's; nothing is out of scope any more). Indexes the schemas no longer define are dropped.

export const syncAllIndexes = async (): Promise<{ model: string; dropped: string[] }[]> => {
	const out: { model: string; dropped: string[] }[] = [];
	for (const name of mongoose.modelNames().sort()) {
		const dropped = await mongoose.model(name).syncIndexes();
		out.push({ model: name, dropped: (dropped as unknown as string[]) ?? [] });
	}
	return out;
};
