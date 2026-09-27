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
	validateIds,
	validateImportQuery,
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

export default router;
