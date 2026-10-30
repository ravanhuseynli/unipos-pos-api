const express = require('express');
const router = express.Router();
const {
    terminalLogin,
    getTerminalInfo,
    terminalLogout,
    getTerminalSession
} = require('../controllers/terminal.controller');
const {
    posAuth,
    requireTerminalSession,
    checkProfileParam,
    terminalLoginLimiter
} = require('../middleware/pos_auth.middleware');

router.param('profileId', checkProfileParam);

// Public — cavabda POS sessiya tokeni (`data.session_token`)
router.post('/login', terminalLoginLimiter, terminalLogin);

// Token həmişə tələb olunur
router.post('/logout', requireTerminalSession, terminalLogout);
router.get('/session', requireTerminalSession, getTerminalSession);

// POS sessiyası (POS_AUTH_MODE)
router.get('/me/:profileId', posAuth, getTerminalInfo);

module.exports = router;
