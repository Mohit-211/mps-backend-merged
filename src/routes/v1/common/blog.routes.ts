import express from 'express';
import { blogController } from '../../../controllers';

const router = express.Router();

router.post('/', blogController.createBlog);

router.get('/get', blogController.getAllBlogs);

router.get('/slug/:slug', blogController.getBlogBySlug);

router.get('/:blogId', blogController.getBlogById);

router.put('/:blogId', blogController.updateBlog);

router.delete('/:blogId', blogController.deleteBlog);

export default router;
