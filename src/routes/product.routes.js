const express = require('express');
const router = express.Router();
const { getAllProducts, getProductById, getProductsByCategory } = require('../controllers/product.controller');

const { posAuth, checkProfileParam } = require('../middleware/pos_auth.middleware');

// POS sessiyası (POS_AUTH_MODE: compat-da tokensiz də keçir)
router.use(posAuth);
router.param('profileId', checkProfileParam);

// Get all products by profile_id
router.get('/:profileId', getAllProducts);

// Get product by id and profile_id
router.get('/:profileId/:id', getProductById);

// Get products by category and profile_id
router.get('/:profileId/category/:categoryId', getProductsByCategory);

module.exports = router;
