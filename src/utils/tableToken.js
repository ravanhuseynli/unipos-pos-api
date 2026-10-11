const crypto = require('crypto');

/**
 * Masa QR-ının imzalı tokeni (`?r=<username>&m=<token>`).
 *
 * Tokeni superadmin panel yaradır (unipos-new-superadmin/server/utils/tableToken.js) —
 * format hər iki tərəfdə EYNİ olmalıdır:
 *   [versiya=1][profile_id u32][hall_id u32][table_id u32]  (13 bayt)
 *   + HMAC-SHA256(QR_TABLE_SECRET, yük)-ün ilk 10 baytı → base64url
 *
 * QR_TABLE_SECRET superadmin serverindəki ilə eyni olmalıdır. Açar dəyişsə,
 * çap olunmuş bütün masa QR-ları etibarsız olur.
 */
const VERSION = 1;
const PAYLOAD_LEN = 13;
const SIG_LEN = 10;

const getSecret = () => {
    const secret = process.env.QR_TABLE_SECRET || '';
    if (secret.length < 32) {
        const err = new Error('QR_TABLE_SECRET təyin edilməyib (ən azı 32 simvol)');
        err.code = 'QR_SECRET_MISSING';
        throw err;
    }
    return secret;
};

const hmac = (data, length) =>
    crypto.createHmac('sha256', getSecret()).update(data).digest().subarray(0, length);

/** Etibarlıdırsa `{ profileId, hallId, tableId }`, əks halda `null`. */
function verifyTableToken(token) {
    const raw = Buffer.from(String(token || ''), 'base64url');
    if (raw.length !== PAYLOAD_LEN + SIG_LEN || raw.readUInt8(0) !== VERSION) return null;

    const payload = raw.subarray(0, PAYLOAD_LEN);
    if (!crypto.timingSafeEqual(raw.subarray(PAYLOAD_LEN), hmac(payload, SIG_LEN))) return null;

    return {
        profileId: payload.readUInt32BE(1),
        hallId: payload.readUInt32BE(5),
        tableId: payload.readUInt32BE(9),
    };
}

/**
 * Qonağın öz sifarişinin statusunu izləməsi üçün açar. Sifariş yaradılanda
 * qonağa verilir; başqa sifarişin uuid-sini bilən onun statusunu görə bilmir.
 */
const guestTokenFor = (orderUuid) => hmac(`guest:${orderUuid}`, 16).toString('base64url');

function verifyGuestToken(orderUuid, token) {
    const expected = Buffer.from(guestTokenFor(orderUuid));
    const given = Buffer.from(String(token || ''));
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

module.exports = { verifyTableToken, guestTokenFor, verifyGuestToken };
