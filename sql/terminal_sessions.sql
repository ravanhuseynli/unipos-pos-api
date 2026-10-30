CREATE TABLE IF NOT EXISTS `terminal_sessions` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    -- Tokenin özü saxlanmır, yalnız SHA-256 hash-i (baza sızsa da token əldə olunmur)
    `token_hash` CHAR(64) NOT NULL,
    `profile_id` INT NOT NULL,
    `terminal_group_id` INT NOT NULL,
    `terminal_id` VARCHAR(64) NOT NULL,
    -- sha256(token_hash:terminal_password) — terminal şifrəsi dəyişəndə uyğun gəlmir, sessiya bağlanır
    `password_fingerprint` CHAR(64) NOT NULL,
    `device_name` VARCHAR(191) NULL DEFAULT NULL,
    `created_ip` VARCHAR(64) NULL DEFAULT NULL,
    `last_ip` VARCHAR(64) NULL DEFAULT NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `last_used_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `revoked_at` DATETIME NULL DEFAULT NULL,
    `revoke_reason` VARCHAR(32) NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_terminal_sessions_token` (`token_hash`),
    KEY `idx_terminal_sessions_terminal` (`terminal_group_id`),
    KEY `idx_terminal_sessions_profile` (`profile_id`),
    KEY `idx_terminal_sessions_last_used` (`last_used_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
