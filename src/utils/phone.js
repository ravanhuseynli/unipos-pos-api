/**
 * QR menyu hesabının nömrəsi — beynəlxalq (E.164) formatda: `+` və 7–15 rəqəm.
 *
 * Əvvəl yalnız `+994XXXXXXXXX` qəbul olunurdu; QR menyuda ölkə seçimi əlavə
 * olunandan sonra başqa ölkələrin nömrələri də gəlir. Azərbaycan nömrəsi üçün
 * köhnə sərt qayda (dəqiq 9 rəqəm) qalır — bazadakı nömrələr eyni formadadır.
 */

const AZ_PHONE = /^\+994\d{9}$/;
const E164_PHONE = /^\+[1-9]\d{6,14}$/;

const PHONE_FORMAT_MESSAGE = 'Telefon nömrəsi düzgün formatda deyil.';

const isValidPhone = (nomre) => {
    if (typeof nomre !== 'string') return false;
    if (nomre.startsWith('+994')) return AZ_PHONE.test(nomre);
    return E164_PHONE.test(nomre);
};

module.exports = { isValidPhone, PHONE_FORMAT_MESSAGE };
