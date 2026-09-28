import express from 'express';
import * as admin from '../../../controllers/citations/admin.controller';
import { adminOnly } from '../../../middlewares/auth/adminAuth.middleware';
import {
	validateBusinessCategorySearch,
	validateCategoryCreate,
	validateCategoryUpdate,
	validateDirectoryCreate,
	validateDirectoryList,
	validateDirectoryUpdate,
	validateAddEntries,
	validateBulkUpdate,
	validateEntryNote,
	validateEntryUpdate,
	validateHistoryQuery,
	validateIds,
	validateImportQuery,
	validateQueue,
	validateQueueDays,
	validateSuggestQuery,
} from '../../../middlewares/citations/citations.validation';

// Citation admin (Phase 16), mounted at /api/v1/admin/citations. Platform admins only:
// citations.view to read, citations.manage to change (src/configs/adminPermissions.ts).
const router = express.Router();
const view = adminOnly('citations.view');
const manage = adminOnly('citations.manage');
const csvBody = express.text({ type: ['text/csv', 'text/plain', 'application/csv'], limit: '1mb' });

// Directories (the export route comes before /:directoryId).
router.get('/directories/export', view, admin.exportDirectories);
router.post('/directories/import', [...manage, csvBody, validateImportQuery], admin.importDirectories);
router.get('/directories', [...view, validateDirectoryList], admin.listDirectories);
router.post('/directories', [...manage, validateDirectoryCreate], admin.createDirectory);
router.get('/directories/:directoryId', [...view, validateIds('directoryId')], admin.getDirectory);
router.patch('/directories/:directoryId', [...manage, validateIds('directoryId'), validateDirectoryUpdate], admin.updateDirectory);
router.delete('/directories/:directoryId', [...manage, validateIds('directoryId')], admin.deactivateDirectory);

// Directory categories and the GBP business categories they map to.
router.get('/categories', view, admin.listCategories);
router.post('/categories', [...manage, validateCategoryCreate], admin.createCategory);
router.patch('/categories/:categoryId', [...manage, validateIds('categoryId'), validateCategoryUpdate], admin.updateCategory);
router.delete('/categories/:categoryId', [...manage, validateIds('categoryId')], admin.deleteCategory);
router.get('/business-categories', [...view, validateBusinessCategorySearch], admin.searchBusinessCategories);

// A location's citation list and its entries.
router.get('/locations/:locationId', [...view, validateIds('locationId')], admin.locationList);
router.post('/locations/:locationId/suggest', [...manage, validateIds('locationId'), validateSuggestQuery], admin.suggest);
router.post('/locations/:locationId/entries', [...manage, validateIds('locationId'), validateAddEntries], admin.addEntries);
router.post('/entries/bulk', [...manage, validateBulkUpdate], admin.bulkUpdate);
router.patch('/entries/:entryId', [...manage, validateIds('entryId'), validateEntryUpdate], admin.updateEntry);
router.delete('/entries/:entryId', [...manage, validateIds('entryId'), validateEntryNote], admin.removeEntry);
router.post('/entries/:entryId/restore', [...manage, validateIds('entryId'), validateEntryNote], admin.restoreEntry);
router.get('/entries/:entryId/history', [...view, validateIds('entryId'), validateHistoryQuery], admin.entryHistory);

// The work queue.
router.get('/queue/unchecked', [...view, validateQueue], admin.queueUnchecked);
router.get('/queue/stale', [...view, validateQueueDays], admin.queueStale);
router.get('/queue/recent', [...view, validateQueueDays], admin.queueRecent);

export default router;
