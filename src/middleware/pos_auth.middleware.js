const rateLimit = require('express-rate-limit');
const { verifySession, PosSessionError } = require('../services/terminalSession.service');

/**
 * POS sessiya yoxlaması (bax: services/terminalSession.service.js).
 *
 * POS_AUTH_MODE:
 *   compat (defolt) — token gəlməyibsə sorğu köhnə qayda ilə keçir (köhnə POS-lar
 *                     işləsin), sayı 15 dəqiqədən bir loga yazılır. Token gəlibsə
 *                     tam yoxlanır: etibarsızdırsa 401, başqa restoranın
 *                     profileId-si yazılıbsa 403.
 *   strict          — token məcburidir.
 *
 * Uğurlu yoxlamadan sonra `req.terminal = { profileId, terminalId, isMaster, ... }`.
 * Tokensiz (compat) sorğuda `req.terminal = null`.
 */

const MODE = String(process.env.POS_AUTH_MODE || 'compat').trim().toLowerCase() === 'strict' ? 'strict' : 'compat';

const sendError = (res, status, code, message) =>
    res.status(status).json({ success: false, status: 'error', code, message });

const readBearer = (req) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return null;
    return header.slice(7).trim() || null;
};

/** profileId rəqəmdirsə id ilə, deyilsə username ilə müqayisə olunur (bəzi endpoint-lər hər ikisini qəbul edir) */
const matchesProfile = (value, session) => {
    const v = String(value).trim();
    if (v === '') return true;
    if (/^\d+$/.test(v)) return Number(v) === session.profileId;
    return v.toLowerCase() === String(session.username).toLowerCase();
};

const PROFILE_MISMATCH = 'Bu sessiya ilə başqa restoranın məlumatlarına giriş yoxdur.';

// compat rejimində tokensiz sorğuların sayı — strict-ə keçmək vaxtını bilmək üçün
const tokenless = new Map();
setInterval(() => {
    if (!tokenless.size) return;
    const summary = [...tokenless.entries()].map(([k, n]) => `${k}=${n}`).join(', ');
    console.warn(`⚠️  POS tokensiz sorğular (son 15 dəq): ${summary}`);
    tokenless.clear();
}, 15 * 60 * 1000).unref();

const recordTokenless = (req) => {
    const key = `${req.method} ${req.baseUrl}${req.path.split('/').slice(0, 2).join('/')}`;
    tokenless.set(key, (tokenless.get(key) || 0) + 1);
};

const authenticate = (required) => async (req, res, next) => {
    const token = readBearer(req);
    if (!token) {
        if (!required) {
            recordTokenless(req);
            req.terminal = null;
            return next();
        }
        return sendError(res, 401, 'token_missing', 'Sessiya tokeni tələb olunur. Terminala yenidən daxil olun.');
    }

    try {
        const session = await verifySession(token, req.ip);

        const bodyValues = [req.body?.profileId, req.body?.profile_id, req.query?.profileId, req.query?.profile_id];
        if (bodyValues.some((v) => v !== undefined && v !== null && !matchesProfile(v, session))) {
            return sendError(res, 403, 'profile_mismatch', PROFILE_MISMATCH);
        }

        req.terminal = session;
        return next();
    } catch (error) {
        if (error instanceof PosSessionError) return sendError(res, error.status, error.code, error.message);
        console.error('POS auth xətası:', error);
        return sendError(res, 500, 'server_error', 'Server xətası baş verdi.');
    }
};

/** POS endpoint-ləri — POS_AUTH_MODE-a tabedir */
const posAuth = authenticate(MODE === 'strict');

/** Rejimdən asılı olmayaraq token tələb edir (logout, sessiya yoxlaması) */
const requireTerminalSession = authenticate(true);

/** `router.param('profileId', checkProfileParam)` — URL-dəki profileId sessiyanın restoranı olmalıdır */
const checkProfileParam = (req, res, next, value) => {
    if (req.terminal && !matchesProfile(value, req.terminal)) {
        return sendError(res, 403, 'profile_mismatch', PROFILE_MISMATCH);
    }
    return next();
};

/**
 * Terminal şifrəsinin brute-force-una qarşı: IP + restoran başına 15 dəqiqədə 20
 * UĞURSUZ cəhd. Uğurlu login sayılmır. `res.locals.loginFailed = true` — 200 ilə
 * uğursuzluq qaytaran köhnə endpoint-lər (POST /pos/profile) üçün.
 *
 * Açarda restoran adı da var: nginx arxasında (TRUST_PROXY təyin olunmayıbsa) bütün
 * sorğular eyni IP-dən görünür — bir restoranın səhv cəhdləri digərlərini bloklamasın.
 */
const terminalLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => `${req.ip}|${String(req.body?.username || req.body?.restaurantName || '').toLowerCase()}`,
    requestWasSuccessful: (req, res) => res.statusCode < 400 && !res.locals.loginFailed,
    message: {
        success: false,
        status: 'error',
        code: 'too_many_attempts',
        message: 'Çox sayda uğursuz giriş cəhdi. 15 dəqiqə sonra yenidən yoxlayın.'
    }
});

module.exports = {
    POS_AUTH_MODE: MODE,
    posAuth,
    requireTerminalSession,
    checkProfileParam,
    terminalLoginLimiter,
};
