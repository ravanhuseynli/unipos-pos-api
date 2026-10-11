const express = require('express');
const router = express.Router();

// Import route files
const authRoutes = require('./auth.routes');
const terminalRoutes = require('./terminal.routes');
const productRoutes = require('./product.routes');
const waiterRoutes = require('./waiter.routes');
const tableRoutes = require('./table.routes');
const posRoutes = require('./pos.routes');
const orderRoutes = require('./order.routes');
const modifierRoutes = require('./modifier.routes');
const qrAuthRoutes = require('./qr_auth.routes');
const qrOrderRoutes = require('./qr_order.routes');

// Mount routes
router.use('/auth', authRoutes);
router.use('/terminal', terminalRoutes);
router.use('/products', productRoutes);
router.use('/waiters', waiterRoutes);
router.use('/tables', tableRoutes);
router.use('/pos', posRoutes);
router.use('/orders', orderRoutes);
router.use('/modifiers', modifierRoutes);
router.use('/qr-auth', qrAuthRoutes);
router.use('/qr-orders', qrOrderRoutes);

// Health check
router.get('/health', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'UniPOS API işləyir!',
        timestamp: new Date().toISOString()
    });
});

module.exports = router;
