const express = require('express');
const router = express.Router();
const { getAllProducts, getProductById, getProductsByCategory } = require('../controllers/product.controller');

// All routes are PUBLIC - No authentication required

// Get all products by profile_id
router.get('/:profileId', getAllProducts);

// Get product by id and profile_id
router.get('/:profileId/:id', getProductById);

// Get products by category and profile_id
router.get('/:profileId/category/:categoryId', getProductsByCategory);

module.exports = router;
