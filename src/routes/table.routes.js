const express = require('express');
const router = express.Router();
const {
    getHallsByProfileId,
    getTablesByProfileId,
    getTablesByHallId,
    getHallsWithTables
} = require('../controllers/table.controller');

// Public routes - No authentication required

// Halls (Zallar)
router.get('/halls/:profileId', getHallsByProfileId);
router.get('/halls/:profileId/with-tables', getHallsWithTables);

// Tables (Masalar)
router.get('/:profileId', getTablesByProfileId);
router.get('/hall/:hallId', getTablesByHallId);

module.exports = router;
