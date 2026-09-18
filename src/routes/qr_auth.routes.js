const express = require('express');
const router = express.Router();
const { register, login, getMe, updateProfile, sendReview } = require('../controllers/qr_auth.controller');
const qrAuthMiddleware = require('../middleware/qr_auth.middleware');

// Public routes
router.post('/register', register);
router.post('/login', login);

// Protected routes
router.get('/me', qrAuthMiddleware, getMe);
router.put('/update', qrAuthMiddleware, updateProfile);
router.post('/review', qrAuthMiddleware, sendReview);

module.exports = router;
