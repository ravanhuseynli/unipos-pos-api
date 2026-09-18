const jwt = require('jsonwebtoken');

/**
 * QR Menu istifadəçiləri üçün JWT middleware
 * Token-i yoxlayır və req.qrUser-ə istifadəçi məlumatlarını əlavə edir
 */
const qrAuthMiddleware = (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                message: 'Giriş üçün token tələb olunur.'
            });
        }

        const token = authHeader.split(' ')[1];

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // QR user token-inin olduğunu yoxla
        if (decoded.type !== 'qr_user') {
            return res.status(403).json({
                success: false,
                message: 'Bu endpointe giriş icazəniz yoxdur.'
            });
        }

        req.qrUser = decoded;
        next();

    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Token müddəti bitib. Yenidən daxil olun.'
            });
        }

        return res.status(401).json({
            success: false,
            message: 'Token etibarsızdır.'
        });
    }
};

module.exports = qrAuthMiddleware;
