const express = require('express');
const router = express.Router();
const { getWaitersByProfileId, getWaiterById } = require('../controllers/waiter.controller');

const { posAuth, checkProfileParam } = require('../middleware/pos_auth.middleware');

// POS sessiyası (POS_AUTH_MODE: compat-da tokensiz də keçir)
router.use(posAuth);
router.param('profileId', checkProfileParam);

// Get all waiters by profile_id
router.get('/:profileId', getWaitersByProfileId);

// Get single waiter by id
router.get('/single/:id', getWaiterById);

module.exports = router;
