import httpStatus from 'http-status';
import { AdminActor } from '../../services/citations/common';
import { categoryService } from '../../services/citations/category.service';
import { directoryCsvService } from '../../services/citations/csv';
import { directoryService } from '../../services/citations/directory.service';
import { catchAsync, responseWrapper } from '../../utils';

// Citation admin (Phase 16): platform admins only (validateAdminJWTToken + citations.view / citations.manage
// ran). Validated input is on res.locals.citationInput.

interface Locals { locals: Record<string, unknown> }
export const actorOf = (res: Locals): AdminActor => {
	const admin = res.locals.admin as { id: string; name?: string | null };
	return { id: admin.id, name: admin.name ?? null };
};
const input = <T>(res: Locals): T => res.locals.citationInput as T;

// ---- directories ----

export const listDirectories = catchAsync(async (req, res) => responseWrapper(res, await directoryService.list(input(res)), 'Directories.'));
export const getDirectory = catchAsync(async (req, res) => responseWrapper(res, await directoryService.get(req.params.directoryId), 'Directory.'));
export const createDirectory = catchAsync(async (req, res) =>
	responseWrapper(res, await directoryService.create(input(res), actorOf(res)), 'Directory created.', httpStatus.CREATED),
);
export const updateDirectory = catchAsync(async (req, res) =>
	responseWrapper(res, await directoryService.update(req.params.directoryId, input(res), actorOf(res)), 'Directory updated.'),
);
export const deactivateDirectory = catchAsync(async (req, res) =>
	responseWrapper(res, await directoryService.deactivate(req.params.directoryId, actorOf(res)), 'Directory deactivated.'),
);

export const exportDirectories = catchAsync(async (req, res) => {
	const csv = Buffer.from(await directoryCsvService.exportCsv(), 'utf8');
	const day = new Date().toISOString().slice(0, 10);
	res.setHeader('Content-Type', 'text/csv; charset=utf-8');
	res.setHeader('Content-Disposition', `attachment; filename="citation-directories-${day}.csv"`);
	res.setHeader('Cache-Control', 'private, no-store');
	res.status(httpStatus.OK).end(csv);
});

export const importDirectories = catchAsync(async (req, res) => {
	if (typeof req.body !== 'string' || !req.body.trim()) {
		return responseWrapper(res, { reason: 'empty_csv' }, 'Send the CSV as the request body with Content-Type: text/csv.', httpStatus.BAD_REQUEST);
	}
	const { dry_run } = input<{ dry_run: boolean }>(res);
	const result = await directoryCsvService.importCsv(req.body, { dryRun: dry_run }, actorOf(res));
	const status = result.errors.length ? httpStatus.UNPROCESSABLE_ENTITY : httpStatus.OK;
	const message = result.errors.length ? 'The CSV has errors; nothing was imported.' : result.applied ? 'Directories imported.' : dry_run ? 'Dry run: nothing was imported.' : 'Nothing to change.';
	return responseWrapper(res, result, message, status);
});

// ---- directory categories and business categories ----

export const listCategories = catchAsync(async (req, res) => responseWrapper(res, await categoryService.list(), 'Directory categories.'));
export const createCategory = catchAsync(async (req, res) =>
	responseWrapper(res, await categoryService.create(input(res), actorOf(res)), 'Directory category created.', httpStatus.CREATED),
);
export const updateCategory = catchAsync(async (req, res) =>
	responseWrapper(res, await categoryService.update(req.params.categoryId, input(res), actorOf(res)), 'Directory category updated.'),
);
export const deleteCategory = catchAsync(async (req, res) => responseWrapper(res, await categoryService.remove(req.params.categoryId), 'Directory category deleted.'));
export const searchBusinessCategories = catchAsync(async (req, res) =>
	responseWrapper(res, await categoryService.searchBusinessCategories(input<{ q?: string }>(res).q ?? ''), 'Business categories.'),
);
