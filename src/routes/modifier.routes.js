const express = require('express');
const router = express.Router();
const {
    getModifiersByProfileId,
    getModifiersByProductId,
    getModifierGroupById
} = require('../controllers/modifier.controller');

// All routes are PUBLIC - No authentication required

// Get all modifiers by profile_id
router.get('/:profileId', getModifiersByProfileId);

// Get modifiers by product_id and profile_id
router.get('/:profileId/product/:productId', getModifiersByProductId);

// Get single modifier group with items by profile_id
router.get('/:profileId/group/:groupId', getModifierGroupById);

module.exports = router;
