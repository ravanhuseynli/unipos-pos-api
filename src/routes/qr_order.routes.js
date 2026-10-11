const express = require('express');
const router = express.Router();
const { getTable, createOrder, getOrder } = require('../controllers/qr_order.controller');

router.get('/table/:token', getTable);
router.post('/', createOrder);
router.get('/:uuid', getOrder);

module.exports = router;
