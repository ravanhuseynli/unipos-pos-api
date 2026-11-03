const express = require('express');
const router = express.Router();
const { getHotelPortal } = require('../controllers/hotel.controller');

// Açıq (QR qonağı) — otel rejimli filialın qonaq xidmətləri portalı
router.get('/:username', getHotelPortal);

module.exports = router;
