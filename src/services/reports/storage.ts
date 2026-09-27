import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import config from '../../configs/config';

// Reports center (Phase 12): private file storage under REPORTS_STORAGE_DIR (never served statically).
//   pdf/<organization_id>/<report_id>.pdf
//   branding/<organization_id>/logo.<png|jpg>
// Paths are built from Mongo ids only (validated), never from user input. Writes are atomic
// (temporary file + rename), so a reader never sees half a file.

const ID = /^[a-f0-9]{24}$/;

const assertId = (id: string): string => {
	if (!ID.test(id)) throw new Error('storage: invalid id');
	return id;
};

export interface ReportStorage {
	root: string;
	pdfPath: (organizationId: string, reportId: string) => string;
	logoPath: (organizationId: string, ext: 'png' | 'jpg') => string;
	write: (file: string, data: Buffer) => Promise<void>;
	read: (file: string) => Promise<Buffer | null>;
	remove: (file: string) => Promise<void>;
}

export const createStorage = (root: string = config.reports.storageDir): ReportStorage => {
	const inside = (file: string): string => {
		const resolved = path.resolve(file);
		if (!resolved.startsWith(path.resolve(root) + path.sep)) throw new Error('storage: path outside the reports directory');
		return resolved;
	};
	return {
		root,
		pdfPath: (organizationId, reportId) => path.join(root, 'pdf', assertId(organizationId), `${assertId(reportId)}.pdf`),
		logoPath: (organizationId, ext) => path.join(root, 'branding', assertId(organizationId), `logo.${ext === 'png' ? 'png' : 'jpg'}`),
		write: async (file, data) => {
			const target = inside(file);
			await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o750 });
			const tmp = `${target}.${crypto.randomBytes(6).toString('hex')}.tmp`;
			await fs.writeFile(tmp, data, { mode: 0o640 });
			await fs.rename(tmp, target);
		},
		read: async (file) => {
			try {
				return await fs.readFile(inside(file));
			} catch (err) {
				if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
				throw err;
			}
		},
		remove: async (file) => {
			await fs.rm(inside(file), { force: true });
		},
	};
};

export const reportStorage = createStorage();
