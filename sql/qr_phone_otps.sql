-- QR menyu: telefon nömrəsinin təsdiq kodları (WhatsApp ilə göndərilir).
--
-- Server işə düşəndə bu fayl AVTOMATİK işlədilir (src/config/qrSchema.js) —
-- cədvəl yoxdursa yaradılır. Faylda YALNIZ BİR SQL ifadəsi olmalıdır.
--
-- Kodun özü SAXLANILMIR — yalnız HMAC-SHA256 (bax: src/services/qrOtp.service.js).
-- `request_id` qonağa verilir; kod yalnız həmin sorğu + həmin nömrə ilə keçərlidir.
-- Sətirlər silinmir: limitlər (nömrə / IP / ümumi) son bir saatın sətirlərindən sayılır.
CREATE TABLE IF NOT EXISTS qr_phone_otps (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    request_id  CHAR(32)         NOT NULL,
    nomre       VARCHAR(20)      NOT NULL,
    purpose     VARCHAR(20)      NOT NULL DEFAULT 'register',
    code_hash   CHAR(64)         NOT NULL,
    status      VARCHAR(12)      NOT NULL DEFAULT 'sending', -- sending | sent | failed | used | replaced | blocked
    attempts    TINYINT UNSIGNED NOT NULL DEFAULT 0,
    ip          VARCHAR(45)      NULL,
    expires_at  DATETIME         NOT NULL,
    used_at     DATETIME         NULL,
    created_at  DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_qr_phone_otps_request (request_id),
    KEY idx_qr_phone_otps_nomre_created (nomre, created_at),
    KEY idx_qr_phone_otps_ip_created (ip, created_at),
    KEY idx_qr_phone_otps_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
