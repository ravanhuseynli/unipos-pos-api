const express = require('express');
const router = express.Router();
const { terminalLogin, getTerminalInfo } = require('../controllers/terminal.controller');

// Public routes - No authentication required
router.post('/login', terminalLogin);
router.get('/me/:profileId', getTerminalInfo);

module.exports = router;

