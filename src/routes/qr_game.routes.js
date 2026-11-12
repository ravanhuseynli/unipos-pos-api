const express = require('express');
const rateLimit = require('express-rate-limit');
const c = require('../controllers/qr_game.controller');
const qrAuthMiddleware = require('../middleware/qr_auth.middleware');

const router = express.Router();

// Raund başlatma / bitirmə — IP üzrə əlavə limit (servis də saatlıq raund sayını yoxlayır)
const playLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, code: 'rate_limited', message: 'Çox sorğu. Bir az gözləyin.' },
});

router.get('/:username', c.info);
router.post('/:username/rounds', playLimiter, c.optionalAuth, c.start);
router.post('/rounds/:id/finish', playLimiter, c.optionalAuth, c.finish);
router.post('/:username/claim', qrAuthMiddleware, c.claim);
router.get('/:username/me', qrAuthMiddleware, c.me);
router.post('/:username/redeem', qrAuthMiddleware, c.redeem);

module.exports = router;
