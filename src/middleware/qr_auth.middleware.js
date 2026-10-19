const { verifyQrUserToken, QrSessionError } = require('../utils/qrUserToken');

/**
 * QR Menu istifadəçiləri üçün JWT middleware
 * Token-i yoxlayır və req.qrUser-ə istifadəçi məlumatlarını əlavə edir.
 * Şifrə dəyişəndən sonra köhnə tokenlər (digər cihazlar) burada rədd olunur —
 * bax: utils/qrUserToken.js. Cavabda `code` — klient sessiyanı bağlamaq üçün.
 */
const qrAuthMiddleware = async (req, res, next) => {
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            success: false,
            code: 'token_missing',
            message: 'Giriş üçün token tələb olunur.'
        });
    }

    try {
        const { decoded } = await verifyQrUserToken(authHeader.split(' ')[1]);
        req.qrUser = decoded;
        next();
    } catch (error) {
        if (error instanceof QrSessionError) {
            return res.status(error.status).json({ success: false, code: error.code, message: error.message });
        }
        console.error('QR auth middleware xətası:', error);
        return res.status(500).json({ success: false, message: 'Server xətası baş verdi.' });
    }
};

module.exports = qrAuthMiddleware;
