import express from 'express';
import { blogCategoryController } from '../../../controllers';

const router = express.Router();

router.post('/', blogCategoryController.createBlogCategory);

router.get('/get', blogCategoryController.getAllBlogCategories);

router.get('/:categoryId', blogCategoryController.getBlogCategoryById);

router.put('/:categoryId', blogCategoryController.updateBlogCategory);

router.delete('/:categoryId', blogCategoryController.deleteBlogCategory);

export default router;
