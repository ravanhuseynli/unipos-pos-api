const express = require('express');
const router = express.Router();
const { getTable, getRestaurant, createOrder, getOrder } = require('../controllers/qr_order.controller');

router.get('/table/:token', getTable);
router.get('/restaurant/:username', getRestaurant);
router.post('/', createOrder);
router.get('/:uuid', getOrder);

module.exports = router;
