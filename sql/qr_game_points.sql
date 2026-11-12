-- QR oyunu: xal jurnalı. Balans = SUM(delta) (customer_id üzrə — customers sətri onsuz da filiala bağlıdır,
-- ona görə xal hər restoranın özünündür). Xal pul DEYİL: loyalty_ledger-ə (AZN) heç vaxt yazılmır.
--   earn   — raund (+), uuid `earn:<round_id>`
--   redeem — mükafata dəyişmə (−), uuid `redeem:<customer_rewards.id>`
--   adjust — panel düzəlişi (±)
-- `uuid` UNIQUE — eyni raund iki dəfə xal yazmır.
CREATE TABLE IF NOT EXISTS qr_game_points (
    id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    profile_id   INT          NOT NULL,
    customer_id  INT          NOT NULL,
    uuid         VARCHAR(64)  NOT NULL,
    kind         VARCHAR(10)  NOT NULL,
    delta        INT          NOT NULL,
    round_id     CHAR(32)     NULL,
    reward_id    INT          NULL,
    note         VARCHAR(160) NULL,
    created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_qr_game_points_uuid (uuid),
    KEY idx_qr_game_points_customer (customer_id, created_at),
    KEY idx_qr_game_points_profile (profile_id, kind, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
