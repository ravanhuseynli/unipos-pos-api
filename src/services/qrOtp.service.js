const crypto = require('crypto');
const { pool } = require('../config/database');
const { sendOtpMessage } = require('./whatsapp.service');

/**
 * QR menyu: telefon nömrəsinin təsdiqi — 6 rəqəmli kod WhatsApp ilə.
 *
 *   POST /qr-auth/otp/send        → sendOtp()   → `qr_phone_otps` (sent) → WhatsApp
 *   POST /qr-auth/register        → verifyOtp() + markOtpUsed() → hesab, eyni tranzaksiyada
 *   POST /qr-auth/password/reset  → verifyOtp() + markOtpUsed() → yeni şifrə
 *
 * `purpose` (register | reset) HMAC-a da daxildir: qeydiyyat kodu şifrə bərpasında keçmir.
 *
 * Təhlükəsizlik:
 *   - kod `crypto.randomInt` ilə yaradılır, bazada yalnız HMAC-SHA256 saxlanılır
 *     (açar QR_OTP_SECRET; HMAC-a request_id və nömrə də daxildir — kod başqa
 *     sorğu / nömrə ilə işləmir)
 *   - 5 dəqiqə etibarlıdır, bir dəfə işlənir, yeni kod köhnəsini etibarsız edir
 *   - bir koda ən çox 5 cəhd, sonra kod bloklanır → 10⁶ variantdan saatda ən çox
 *     5 kod × 5 cəhd = 25 təxmin
 *   - göndəriş limitləri: nömrəyə 60 s-dən bir və saatda 5 (yalnız gedən kodlar);
 *     IP-yə saatda 20; ümumi saatda QR_OTP_GLOBAL_HOURLY_LIMIT (WhatsApp nömrəsini
 *     ban-dan qoruyur) — son ikisi uğursuz cəhdləri də sayır
 *   - müqayisə `timingSafeEqual` ilə
 */

const CODE_LENGTH = 6;
const TTL_SECONDS = 5 * 60;
const RESEND_SECONDS = 60;
const MAX_ATTEMPTS = 5;
const PHONE_HOURLY_LIMIT = 5;
const IP_HOURLY_LIMIT = 20;
const GLOBAL_HOURLY_LIMIT = Number(process.env.QR_OTP_GLOBAL_HOURLY_LIMIT) || 300;

const STATUS = {
    SENDING: 'sending',
    SENT: 'sent',
    FAILED: 'failed',
    USED: 'used',
    REPLACED: 'replaced', // eyni nömrəyə yeni kod göndərilib
    BLOCKED: 'blocked',   // cəhdlər bitib
};

const PURPOSES = new Set(['register', 'reset']);

const REQUEST_ID_RE = /^[0-9a-f]{32}$/;
const CODE_RE = new RegExp(`^\\d{${CODE_LENGTH}}$`);

class OtpError extends Error {
    constructor(status, code, message, extra = {}) {
        super(message);
        this.status = status;
        this.code = code;
        this.extra = extra;
    }
}

/** QR_OTP_REQUIRED=0 — keçid dövrü / bot işləmədikdə qeydiyyat kodsuz da qəbul olunur. */
const isOtpRequired = () => process.env.QR_OTP_REQUIRED !== '0';

/** QR_OTP_SECRET yoxdursa JWT_SECRET-dən ayrıca açar törədilir (eyni açar iki işdə işlənmir). */
const otpKey = () => {
    if (process.env.QR_OTP_SECRET) return process.env.QR_OTP_SECRET;
    if (!process.env.JWT_SECRET) throw new Error('QR_OTP_SECRET / JWT_SECRET təyin olunmayıb');
    return crypto.createHmac('sha256', process.env.JWT_SECRET).update('qr-phone-otp').digest();
};

const hashCode = (requestId, nomre, purpose, code) =>
    crypto.createHmac('sha256', otpKey()).update(`${requestId}:${nomre}:${purpose}:${code}`).digest('hex');

const generateCode = () => String(crypto.randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');

/**
 * İki mesaj: izah + YALNIZ kod. Kodun öz mesajı olanda bildirişdə görünür və uzun
 * basıb "Kopyala" yalnız kodu götürür (adi WhatsApp hesabında "Kopyala" düyməsi
 * mümkün deyil — o, yalnız rəsmi Business API şablonlarındadır).
 * `message` — hamısı bir yerdə, köhnə bot üçün (o `messages`-i tanımır).
 */
const otpMessages = (code, purpose) => {
    const intro =
        (purpose === 'reset' ? 'UniPOS QR menyu şifrə bərpası kodunuz' : 'UniPOS QR menyu təsdiq kodunuz') +
        ` növbəti mesajdadır.\nKod ${TTL_SECONDS / 60} dəqiqə etibarlıdır. Onu heç kimlə paylaşmayın.` +
        (purpose === 'reset' ? '\nŞifrə bərpasını siz istəməmisinizsə, bu mesajı nəzərə almayın.' : '');
    return {
        messages: [intro, code],
        message: `*${code}* — ${intro.replace(' növbəti mesajdadır.', '.')}`,
    };
};

/**
 * Son bir saatda limitə çatılıbsa, ən köhnə sətir pəncərədən çıxana qədər qalan saniyə.
 * `skipFailed` — bot alınmayan (`failed`) cəhdlər sayılmır: kod getməyibsə, qonağın
 * nömrə limiti xərclənməməlidir (bot işləməyəndə bütün nömrələr bağlanırdı).
 */
const hourlyWindow = async (column, value, limit, { skipFailed = false } = {}) => {
    const where = (column ? `${column} = ? AND ` : '') + (skipFailed ? 'status <> ? AND ' : '');
    const params = [...(column ? [value] : []), ...(skipFailed ? [STATUS.FAILED] : [])];
    const [[row]] = await pool.query(
        `SELECT COUNT(*) AS cnt,
                TIMESTAMPDIFF(SECOND, NOW(), MIN(created_at) + INTERVAL 1 HOUR) AS reset_in
           FROM qr_phone_otps
          WHERE ${where}created_at > NOW() - INTERVAL 1 HOUR`,
        params
    );
    return Number(row.cnt) >= limit ? Math.max(1, Number(row.reset_in) || 1) : 0;
};

const checkLimits = async ({ nomre, ip }) => {
    // Bot alınmadıqda (`failed`) gözləmə tətbiq olunmur — qonaq dərhal yenidən cəhd edə bilsin
    const [[last]] = await pool.query(
        `SELECT TIMESTAMPDIFF(SECOND, created_at, NOW()) AS age
           FROM qr_phone_otps
          WHERE nomre = ? AND status <> ?
          ORDER BY created_at DESC LIMIT 1`,
        [nomre, STATUS.FAILED]
    );
    if (last && Number(last.age) < RESEND_SECONDS) {
        const retryAfter = RESEND_SECONDS - Number(last.age);
        throw new OtpError(429, 'otp_too_soon', `Yeni kodu ${retryAfter} saniyə sonra istəyə bilərsiniz.`, { retry_after: retryAfter });
    }

    const phoneWait = await hourlyWindow('nomre', nomre, PHONE_HOURLY_LIMIT, { skipFailed: true });
    if (phoneWait) {
        throw new OtpError(429, 'otp_limit', 'Bu nömrəyə çox kod göndərildi. Bir az sonra yenidən cəhd edin.', { retry_after: phoneWait });
    }
    if (ip) {
        const ipWait = await hourlyWindow('ip', ip, IP_HOURLY_LIMIT);
        if (ipWait) {
            throw new OtpError(429, 'otp_limit', 'Çox kod istənildi. Bir az sonra yenidən cəhd edin.', { retry_after: ipWait });
        }
    }
    const globalWait = await hourlyWindow(null, null, GLOBAL_HOURLY_LIMIT);
    if (globalWait) {
        console.error(`❌ QR OTP: ümumi saatlıq limit (${GLOBAL_HOURLY_LIMIT}) doldu`);
        throw new OtpError(429, 'otp_limit', 'Hazırda kod göndərmək mümkün deyil. Bir az sonra yenidən cəhd edin.', { retry_after: globalWait });
    }
};

/**
 * Kod yaradır, WhatsApp ilə göndərir. Nömrənin formatını və (qeydiyyat üçün)
 * artıq qeydiyyatda olmadığını çağıran yoxlayır.
 * @returns {{ request_id, expires_in, resend_in, code_length }}
 */
const sendOtp = async ({ nomre, purpose, ip }) => {
    await checkLimits({ nomre, ip });

    const requestId = crypto.randomBytes(16).toString('hex');
    const code = generateCode();
    const [result] = await pool.execute(
        `INSERT INTO qr_phone_otps (request_id, nomre, purpose, code_hash, status, ip, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW() + INTERVAL ${TTL_SECONDS} SECOND)`,
        [requestId, nomre, purpose, hashCode(requestId, nomre, purpose, code), STATUS.SENDING, ip]
    );
    const id = result.insertId;

    try {
        await sendOtpMessage(nomre, otpMessages(code, purpose));
    } catch (error) {
        await pool.execute('UPDATE qr_phone_otps SET status = ? WHERE id = ?', [STATUS.FAILED, id]);
        if (error.code === 'not_on_whatsapp') {
            throw new OtpError(422, 'not_on_whatsapp', 'Bu nömrə WhatsApp-da qeydiyyatda deyil. Nömrəni yoxlayın.');
        }
        console.error('❌ QR OTP göndərilmədi:', error.message);
        throw new OtpError(503, 'otp_unavailable', 'Təsdiq kodu göndərilə bilmədi. Bir az sonra yenidən cəhd edin.');
    }

    await pool.execute(
        'UPDATE qr_phone_otps SET status = ? WHERE nomre = ? AND purpose = ? AND status = ? AND id <> ?',
        [STATUS.REPLACED, nomre, purpose, STATUS.SENT, id]
    );
    await pool.execute('UPDATE qr_phone_otps SET status = ? WHERE id = ?', [STATUS.SENT, id]);

    return { request_id: requestId, expires_in: TTL_SECONDS, resend_in: RESEND_SECONDS, code_length: CODE_LENGTH };
};

/**
 * Kodu yoxlayır — çağıranın tranzaksiyası daxilində (`conn`), sətir kilidlənir.
 * Səhv kodda cəhd sayı artırılır və OtpError atılır: çağıran həmin halda
 * COMMIT etməlidir (ROLLBACK cəhdi silərdi və limit işləməzdi).
 * @returns {{ id }} — markOtpUsed() üçün
 */
const verifyOtp = async (conn, { requestId, nomre, code, purpose }) => {
    const invalid = () => new OtpError(400, 'otp_invalid', 'Təsdiq kodu etibarsızdır. Yeni kod istəyin.');

    if (typeof code !== 'string' || !CODE_RE.test(code)) {
        throw new OtpError(400, 'otp_format', `Kod ${CODE_LENGTH} rəqəmdən ibarət olmalıdır.`);
    }
    if (typeof requestId !== 'string' || !REQUEST_ID_RE.test(requestId)) throw invalid();

    const [rows] = await conn.execute(
        `SELECT id, nomre, purpose, code_hash, status, attempts, expires_at > NOW() AS alive
           FROM qr_phone_otps WHERE request_id = ? FOR UPDATE`,
        [requestId]
    );
    const otp = rows[0];
    if (!otp || otp.nomre !== nomre || otp.purpose !== purpose) throw invalid();
    if (otp.status === STATUS.REPLACED) {
        throw new OtpError(400, 'otp_replaced', 'Yeni kod göndərilib — son gələn kodu daxil edin.');
    }
    if (otp.status === STATUS.BLOCKED || otp.attempts >= MAX_ATTEMPTS) {
        throw new OtpError(400, 'otp_blocked', 'Çox səhv cəhd edildi. Yeni kod istəyin.');
    }
    if (otp.status !== STATUS.SENT) throw invalid();
    if (!Number(otp.alive)) throw new OtpError(400, 'otp_expired', 'Kodun vaxtı bitib. Yeni kod istəyin.');

    const expected = Buffer.from(otp.code_hash, 'hex');
    const actual = Buffer.from(hashCode(requestId, nomre, purpose, code), 'hex');
    if (!crypto.timingSafeEqual(expected, actual)) {
        const attempts = otp.attempts + 1;
        const left = MAX_ATTEMPTS - attempts;
        await conn.execute('UPDATE qr_phone_otps SET attempts = ?, status = ? WHERE id = ?', [
            attempts,
            left > 0 ? STATUS.SENT : STATUS.BLOCKED,
            otp.id,
        ]);
        if (left <= 0) throw new OtpError(400, 'otp_blocked', 'Çox səhv cəhd edildi. Yeni kod istəyin.');
        throw new OtpError(400, 'otp_wrong', `Kod yanlışdır. ${left} cəhd qaldı.`, { attempts_left: left });
    }

    return { id: otp.id };
};

const markOtpUsed = (conn, id) =>
    conn.execute('UPDATE qr_phone_otps SET status = ?, used_at = NOW() WHERE id = ?', [STATUS.USED, id]);

module.exports = { sendOtp, verifyOtp, markOtpUsed, isOtpRequired, OtpError, PURPOSES };
