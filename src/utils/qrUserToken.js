const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const customerAccounts = require('../services/customerAccount.service');

/**
 * QR menyu hesabının JWT-si.
 *
 * Token `tv` (qr_users.token_version) daşıyır. Şifrə dəyişəndə / bərpa olunanda
 * versiya artırılır → həmin hesabın BÜTÜN köhnə tokenləri (digər cihazlar) hər
 * sorğuda rədd olunur. Şifrəni dəyişən cihaz yeni versiyalı token alır və girişdə qalır.
 *
 * `tv`-siz köhnə tokenlər 0 sayılır — hesabın versiyası 0 olduqca (şifrə heç
 * dəyişməyib) işləməyə davam edir, deploy heç kimi çıxarmır.
 *
 * Vahid hesab (services/customerAccount.service.js): şifrə mobil tətbiqdə / client.unipos.tech-də
 * dəyişə bilər — orada qr_users-ə toxunulmur. Ona görə güzgünün `sifre`-si hesabın `password_hash`-i
 * ilə müqayisə olunur: fərqlidirsə (şifrə başqa yerdə dəyişib) və ya hesab silinibsə, versiya burada
 * artırılır və token rədd olunur — QR sessiyaları da bitir.
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

    const linked = customerAccounts.isReady();
    const [rows] = await pool.execute(
        linked
            ? `SELECT q.id, q.ad, q.soyad, q.nomre, q.token_version, q.sifre, q.account_id,
                      a.id AS acc_id, a.password_hash AS acc_hash
                 FROM qr_users q LEFT JOIN customer_accounts a ON a.id = q.account_id
                WHERE q.id = ? LIMIT 1`
            : 'SELECT id, ad, soyad, nomre, token_version FROM qr_users WHERE id = ? LIMIT 1',
        [decoded.id]
    );
    const row = rows[0];
    const revoked = () => new QrSessionError('session_revoked', 'Sessiya bitib — şifrə dəyişdirilib. Yenidən daxil olun.');
    if (!row || Number(row.token_version) !== (Number(decoded.tv) || 0)) throw revoked();

    if (linked && row.account_id != null && (row.acc_id == null || row.acc_hash !== row.sifre)) {
        // Şifrə başqa yerdə dəyişib / hesab silinib — bütün köhnə QR tokenləri bitir (şərtli UPDATE: bir dəfə artır)
        await pool.execute(
            'UPDATE qr_users SET token_version = token_version + 1, sifre = COALESCE(?, sifre) WHERE id = ? AND token_version = ? AND sifre = ?',
            [row.acc_hash ?? null, row.id, row.token_version, row.sifre]
        );
        throw revoked();
    }
    const user = { id: row.id, ad: row.ad, soyad: row.soyad, nomre: row.nomre, token_version: row.token_version };
    return { decoded, user };
};

module.exports = { signQrUserToken, verifyQrUserToken, QrSessionError };
