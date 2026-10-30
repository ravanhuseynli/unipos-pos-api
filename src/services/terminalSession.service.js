const crypto = require('crypto');
const { pool } = require('../config/database');

/**
 * POS terminal sessiyaları — `POST /api/terminal/login` uğurlu olanda verilən
 * opaque token (JWT deyil). POS onu hər sorğuda `Authorization: Bearer <token>`
 * kimi göndərir.
 *
 *   - Bazada tokenin özü yox, SHA-256 hash-i saxlanır.
 *   - Sürüşən müddət: son istifadədən POS_SESSION_IDLE_DAYS gün (defolt 90)
 *     keçməyibsə keçərlidir. İşləyən kassa heç vaxt çıxmır, refresh lazım deyil.
 *   - Sessiya bağlanır: terminal şifrəsi dəyişəndə, terminal silinəndə / başqa
 *     restorana keçəndə, uzun müddət istifadə olunmayanda, logout-da.
 *   - Profil deaktivdirsə (`is_working = 0`) sessiya BAĞLANMIR, sadəcə 403 —
 *     abunəlik bərpa olunanda kassa yenidən login etmədən işləyir.
 *   - Terminal başına sessiya limiti yoxdur.
 *
 * Yoxlama nəticəsi 60 san yaddaşda saxlanır — hər sorğuda baza sorğusu olmasın.
 * Ona görə şifrə dəyişikliyi / deaktivasiya ən gec 60 san sonra təsir edir.
 */

const TOKEN_PREFIX = 'pst_';
const IDLE_DAYS = Math.max(1, parseInt(process.env.POS_SESSION_IDLE_DAYS, 10) || 90);
const CACHE_TTL_MS = 60 * 1000;
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;
const CACHE_MAX = 5000;
// Bağlanmış / vaxtı keçmiş sessiyalar bu qədər gün sonra bazadan silinir
const CLEANUP_GRACE_DAYS = 30;

class PosSessionError extends Error {
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

const ERRORS = {
    invalid: () => new PosSessionError(401, 'invalid_token', 'Sessiya tokeni etibarsızdır. Terminala yenidən daxil olun.'),
    revoked: () => new PosSessionError(401, 'session_revoked', 'Sessiya bağlanıb. Terminala yenidən daxil olun.'),
    expired: () => new PosSessionError(401, 'session_expired', 'Sessiyanın müddəti bitib. Terminala yenidən daxil olun.'),
    inactive: () => new PosSessionError(403, 'account_inactive', 'Hesab aktiv deyil. Dəstək xidməti ilə əlaqə saxlayın.'),
};

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const hashToken = (token) => sha256(token);
const passwordFingerprint = (tokenHash, password) => sha256(`${tokenHash}:${password ?? ''}`);

const cache = new Map(); // token_hash → { session, checkedAt, lastUsedAt }

const cacheSet = (tokenHash, entry) => {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(tokenHash, entry);
};

const touch = (entry, ip) => {
    if (Date.now() - entry.lastUsedAt < TOUCH_INTERVAL_MS) return;
    entry.lastUsedAt = Date.now();
    pool.execute(
        'UPDATE pos_auth_sessions SET last_used_at = NOW(), last_ip = ? WHERE id = ?',
        [ip || null, entry.session.id]
    ).catch((err) => console.error('Terminal sessiyası yenilənmədi:', err.message));
};

async function revokeSession(sessionId, reason) {
    await pool.execute(
        'UPDATE pos_auth_sessions SET revoked_at = NOW(), revoke_reason = ? WHERE id = ? AND revoked_at IS NULL',
        [reason, sessionId]
    );
    for (const [hash, entry] of cache) {
        if (entry.session.id === sessionId) cache.delete(hash);
    }
}

async function createSession({ profileId, terminalGroupId, terminalId, terminalPassword, deviceName, ip }) {
    const token = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);

    await pool.execute(
        `INSERT INTO pos_auth_sessions
            (token_hash, profile_id, terminal_group_id, terminal_id, password_fingerprint, device_name, created_ip, last_ip)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            tokenHash,
            profileId,
            terminalGroupId,
            String(terminalId),
            passwordFingerprint(tokenHash, terminalPassword),
            deviceName ? String(deviceName).slice(0, 191) : null,
            ip || null,
            ip || null,
        ]
    );

    return { token, idleDays: IDLE_DAYS };
}

/** Tokeni yoxlayır, uğurludursa sessiyanı qaytarır, əks halda PosSessionError atır. */
async function verifySession(token, ip) {
    if (typeof token !== 'string' || !token.startsWith(TOKEN_PREFIX) || token.length > 128) {
        throw ERRORS.invalid();
    }
    const tokenHash = hashToken(token);

    const cached = cache.get(tokenHash);
    if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) {
        touch(cached, ip);
        return cached.session;
    }

    const [rows] = await pool.query(
        `SELECT s.id, s.profile_id, s.terminal_group_id, s.terminal_id, s.password_fingerprint,
                s.last_used_at, s.revoked_at,
                (s.last_used_at < NOW() - INTERVAL ? DAY) AS idle_expired,
                tg.profile_id AS tg_profile_id, tg.terminal_id AS tg_terminal_id,
                tg.terminal_password, tg.is_master,
                p.username, p.is_working
           FROM pos_auth_sessions s
           LEFT JOIN terminal_groups tg ON tg.id = s.terminal_group_id
           LEFT JOIN profiles p ON p.id = s.profile_id
          WHERE s.token_hash = ?
          LIMIT 1`,
        [IDLE_DAYS, tokenHash]
    );
    const row = rows[0];
    cache.delete(tokenHash);

    if (!row) throw ERRORS.invalid();
    if (row.revoked_at) throw ERRORS.revoked();

    if (Number(row.idle_expired) === 1) {
        await revokeSession(row.id, 'idle_expired');
        throw ERRORS.expired();
    }
    // Terminal silinib, başqa restorana / başqa ID-yə keçib və ya profil silinib
    if (
        row.tg_profile_id === null
        || Number(row.tg_profile_id) !== Number(row.profile_id)
        || String(row.tg_terminal_id) !== String(row.terminal_id)
        || row.username === null
    ) {
        await revokeSession(row.id, 'terminal_removed');
        throw ERRORS.revoked();
    }
    if (passwordFingerprint(tokenHash, row.terminal_password) !== row.password_fingerprint) {
        await revokeSession(row.id, 'password_changed');
        throw ERRORS.revoked();
    }
    if (!Number(row.is_working)) throw ERRORS.inactive();

    const session = {
        id: row.id,
        profileId: Number(row.profile_id),
        terminalGroupId: Number(row.terminal_group_id),
        terminalId: Number(row.terminal_id),
        isMaster: Number(row.is_master) === 1,
        username: row.username,
    };
    const entry = { session, checkedAt: Date.now(), lastUsedAt: new Date(row.last_used_at).getTime() };
    cacheSet(tokenHash, entry);
    touch(entry, ip);
    return session;
}

async function cleanupSessions() {
    const [result] = await pool.query(
        `DELETE FROM pos_auth_sessions
          WHERE (revoked_at IS NOT NULL AND revoked_at < NOW() - INTERVAL ? DAY)
             OR last_used_at < NOW() - INTERVAL ? DAY`,
        [CLEANUP_GRACE_DAYS, IDLE_DAYS + CLEANUP_GRACE_DAYS]
    );
    if (result.affectedRows) console.log(`🧹 ${result.affectedRows} köhnə terminal sessiyası silindi`);
}

function startSessionCleanup() {
    const run = () => cleanupSessions().catch((err) => console.error('Terminal sessiya təmizliyi:', err.message));
    run();
    setInterval(run, 24 * 60 * 60 * 1000).unref();
}

module.exports = {
    PosSessionError,
    createSession,
    verifySession,
    revokeSession,
    startSessionCleanup,
    IDLE_DAYS,
};
