-- QR oyunu: raundlar. Server seed verir, raund bitəndə gedişləri yenidən oynayıb xalı ÖZÜ hesablayır
-- (src/game/match3.mjs) — klientin göndərdiyi xala inanılmır.
--
-- Qonaq raundu (customer_id NULL): bitəndə xalı `pending_points`-də gözləyir; qonaq 24 saat ərzində
-- qeydiyyatdan keçib/daxil olub `claim` edə bilər. claim tokeninin özü saxlanmır — yalnız SHA-256.
-- status: open | done | claimed | rejected | expired
CREATE TABLE IF NOT EXISTS qr_game_rounds (
    id              CHAR(32)     NOT NULL PRIMARY KEY,
    profile_id      INT          NOT NULL,
    customer_id     INT          NULL,
    seed            CHAR(32)     NOT NULL,
    engine_version  SMALLINT     NOT NULL,
    moves_allowed   SMALLINT     NOT NULL,
    claim_hash      CHAR(64)     NULL,
    status          VARCHAR(10)  NOT NULL DEFAULT 'open',
    score           INT          NULL,
    pending_points  INT          NULL,
    points          INT          NULL,
    moves_used      SMALLINT     NULL,
    reject_reason   VARCHAR(40)  NULL,
    ip              VARCHAR(45)  NULL,
    started_at      DATETIME     NOT NULL,
    finished_at     DATETIME     NULL,
    claimed_at      DATETIME     NULL,
    KEY idx_qr_game_rounds_customer (profile_id, customer_id, finished_at),
    KEY idx_qr_game_rounds_ip (ip, started_at),
    KEY idx_qr_game_rounds_started (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
