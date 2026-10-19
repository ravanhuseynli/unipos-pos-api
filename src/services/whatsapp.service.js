/**
 * WhatsApp bot (../Whatsapp Bot, whatsapp-web.js) ilə mesaj göndərmə.
 *
 * `POST /send-otp` — botun növbəsiz endpoint-i: toplu göndərişlərin arxasında
 * gözləmir və mətni loga yazmır. Açar `X-API-Key` başlığı ilə göndərilir
 * (bot panelinin "Hesab" bölməsindən götürülür).
 *
 * Uğursuzluqda `WhatsAppError` atır, `code`:
 *   not_configured   — WHATSAPP_BOT_URL yazılmayıb
 *   not_on_whatsapp  — nömrə WhatsApp-da qeydiyyatda deyil
 *   unavailable      — bot işləmir / hazır deyil / cavab vermədi
 */

const SEND_TIMEOUT_MS = 25000;

class WhatsAppError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

/** `{ messages, message }` — bax: qrOtp.service otpMessages(). */
const sendOtpMessage = async (nomre, { messages, message }) => {
    const baseUrl = (process.env.WHATSAPP_BOT_URL || '').replace(/\/+$/, '');
    if (!baseUrl) throw new WhatsAppError('not_configured', 'WHATSAPP_BOT_URL təyin olunmayıb');

    let res;
    try {
        res = await fetch(`${baseUrl}/send-otp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(process.env.WHATSAPP_BOT_API_KEY ? { 'X-API-Key': process.env.WHATSAPP_BOT_API_KEY } : {}),
            },
            body: JSON.stringify({ receiver: nomre.replace(/\D/g, ''), messages, message }),
            signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
    } catch (error) {
        throw new WhatsAppError('unavailable', `Bota qoşulmaq alınmadı: ${error.message}`);
    }

    let json = {};
    try {
        json = await res.json();
    } catch {
        // cavab JSON deyil
    }
    if (res.ok && json.status === 'sent') return;
    if (json.code === 'not_on_whatsapp') throw new WhatsAppError('not_on_whatsapp', json.message);
    throw new WhatsAppError('unavailable', `Bot ${res.status}: ${json.code || json.message || 'naməlum xəta'}`);
};

module.exports = { sendOtpMessage, WhatsAppError };
