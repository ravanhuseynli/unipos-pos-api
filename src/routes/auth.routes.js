const express = require('express');
const router = express.Router();
const { login, getMe } = require('../controllers/auth.controller');
const authMiddleware = require('../middleware/auth.middleware');

// Public routes
router.post('/login', login);

// Protected routes
router.get('/me', authMiddleware, getMe);

module.exports = router;
