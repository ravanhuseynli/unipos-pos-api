const express = require('express');
const router = express.Router();
const {
    createOrder,
    getOrderInfo,
    getActiveOrders,
    getAllOrders,
    updateOrder,
    deleteOrder,
    payOrder,
    updateTable,
    updateWaiter,
    updateSaleType,
    reverseOrder,
    splitOrder,
    mergeOrders,
    searchOrders,
    updateCustomer,
    deleteOrderItem
} = require('../controllers/order.controller');

// All routes are PUBLIC - No authentication required

// Create order
router.post('/', createOrder);

// Get order info
router.post('/info', getOrderInfo);

// Get active orders
router.post('/active', getActiveOrders);

// Get all orders (with filters)
router.post('/all', getAllOrders);

// Update order
router.post('/update', updateOrder);

// Delete/Cancel order
router.post('/delete', deleteOrder);

// Pay/Close order
router.post('/pay', payOrder);

// Update table
router.post('/update-table', updateTable);

// Update waiter
router.post('/update-waiter', updateWaiter);

// Update sale type
router.post('/update-sale-type', updateSaleType);

// Reverse/Reopen order
router.post('/reverse', reverseOrder);

// Split order
router.post('/split', splitOrder);

// Merge orders
router.post('/merge', mergeOrders);

// Search orders
router.post('/search', searchOrders);

// Update customer
router.post('/update-customer', updateCustomer);

// Delete order item
router.post('/delete-item', deleteOrderItem);

module.exports = router;
