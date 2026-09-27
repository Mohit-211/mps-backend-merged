import express from 'express';
import { blogCategoryController } from '../../../controllers';
import { adminAuthMiddleware } from '../../../middlewares';

const router = express.Router();

// Phase 10 (AUDIT S27): writes need content.manage; reads stay public.
const content = adminAuthMiddleware.adminOnly('content.manage');
router.post('/', content, blogCategoryController.createBlogCategory);

router.get('/get', blogCategoryController.getAllBlogCategories);

router.get('/:categoryId', blogCategoryController.getBlogCategoryById);

router.put('/:categoryId', content, blogCategoryController.updateBlogCategory);

router.delete('/:categoryId', content, blogCategoryController.deleteBlogCategory);

export default router;
