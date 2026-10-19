const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');

/**
 * QR menyu hesabının JWT-si.
 *
 * Token `tv` (qr_users.token_version) daşıyır. Şifrə dəyişəndə / bərpa olunanda
 * versiya artırılır → həmin hesabın BÜTÜN köhnə tokenləri (digər cihazlar) hər
 * sorğuda rədd olunur. Şifrəni dəyişən cihaz yeni versiyalı token alır və girişdə qalır.
 *
 * `tv`-siz köhnə tokenlər 0 sayılır — hesabın versiyası 0 olduqca (şifrə heç
 * dəyişməyib) işləməyə davam edir, deploy heç kimi çıxarmır.
 */

class QrSessionError extends Error {
    constructor(code, message) {
        super(message);
        this.status = 401;
        this.code = code;
    }
}

const signQrUserToken = (user) =>
    jwt.sign(
        { id: user.id, nomre: user.nomre, type: 'qr_user', tv: Number(user.token_version) || 0 },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
    );

/**
 * Tokeni və onun hələ etibarlı olduğunu (hesab var, versiya eynidir) yoxlayır.
 * @returns {{ decoded, user: { id, ad, soyad, nomre } }}
 * @throws QrSessionError (401) — token_invalid | token_expired | session_revoked
 */
const verifyQrUserToken = async (token) => {
    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            throw new QrSessionError('token_expired', 'Token müddəti bitib. Yenidən daxil olun.');
        }
        throw new QrSessionError('token_invalid', 'Token etibarsızdır.');
    }
    if (decoded?.type !== 'qr_user' || !decoded.id) {
        throw new QrSessionError('token_invalid', 'Token etibarsızdır.');
    }

    const [rows] = await pool.execute(
        'SELECT id, ad, soyad, nomre, token_version FROM qr_users WHERE id = ? LIMIT 1',
        [decoded.id]
    );
    const user = rows[0];
    if (!user || Number(user.token_version) !== (Number(decoded.tv) || 0)) {
        throw new QrSessionError('session_revoked', 'Sessiya bitib — şifrə dəyişdirilib. Yenidən daxil olun.');
    }
    return { decoded, user };
};

module.exports = { signQrUserToken, verifyQrUserToken, QrSessionError };
