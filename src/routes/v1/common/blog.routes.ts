import express from 'express';
import { blogController } from '../../../controllers';
import { adminAuthMiddleware } from '../../../middlewares';

const router = express.Router();

// Phase 10 (AUDIT S27): writes need content.manage; reads stay public.
const content = adminAuthMiddleware.adminOnly('content.manage');
router.post('/', content, blogController.createBlog);

router.get('/get', blogController.getAllBlogs);

router.get('/slug/:slug', blogController.getBlogBySlug);

router.get('/:blogId', blogController.getBlogById);

router.put('/:blogId', content, blogController.updateBlog);

router.delete('/:blogId', content, blogController.deleteBlog);

export default router;
