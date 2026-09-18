-- QR Menu İstifadəçiləri Cədvəli
-- Bu cədvəl QR menu tətbiqindən qeydiyyatdan keçən müştəriləri saxlayır

CREATE TABLE IF NOT EXISTS qr_users (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    ad          VARCHAR(100)  NOT NULL,
    soyad       VARCHAR(100)  NOT NULL,
    nomre       VARCHAR(20)   NOT NULL UNIQUE,   -- +994XXXXXXXXX formatında
    sifre       VARCHAR(255)  NOT NULL,           -- bcrypt hash
    created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- İndeks: nomrə ilə axtarış sürətləndirir
CREATE INDEX IF NOT EXISTS idx_qr_users_nomre ON qr_users(nomre);
