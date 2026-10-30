const express = require('express');
const router = express.Router();
const {
    getHallsByProfileId,
    getTablesByProfileId,
    getTablesByHallId,
    getHallsWithTables
} = require('../controllers/table.controller');

const { posAuth, checkProfileParam } = require('../middleware/pos_auth.middleware');

// POS sessiyası (POS_AUTH_MODE: compat-da tokensiz də keçir)
router.use(posAuth);
router.param('profileId', checkProfileParam);

// Halls (Zallar)
router.get('/halls/:profileId', getHallsByProfileId);
router.get('/halls/:profileId/with-tables', getHallsWithTables);

// Tables (Masalar)
router.get('/:profileId', getTablesByProfileId);
router.get('/hall/:hallId', getTablesByHallId);

module.exports = router;
