const express = require('express');
const router = express.Router();
const { getWaitersByProfileId, getWaiterById } = require('../controllers/waiter.controller');

// Public routes - No authentication required

// Get all waiters by profile_id
router.get('/:profileId', getWaitersByProfileId);

// Get single waiter by id
router.get('/single/:id', getWaiterById);

module.exports = router;
