-- QR oyunu: restoranın parametrləri (admin panel › QR menyu › Oyun yazır, bu API oxuyur).
--
-- Server işə düşəndə bu fayl AVTOMATİK işlədilir (src/config/qrSchema.js) — cədvəl yoxdursa yaradılır.
-- Admin backend də EYNİ tərifi işlədir (hansı birinci işə düşsə, o yaradır). Faylda YALNIZ BİR SQL ifadəsi.
--
-- Oyun yalnız `enabled = 1` VƏ loyallıq modulu açıq olanda görünür — mükafatı POS loyallıq axını ilə tətbiq edir.
-- `rewards` — JSON massiv: [{ id, title_az, title_en, title_ru, cost, type: 'free_product'|'percent',
--                             product_id, value, valid_days }]
-- `tile_pack` — daş dəsti (classic | sushi | national | coffee). `daily_goal_bonus` — gündəlik tapşırığın
-- bonusu (0 — tapşırıq yoxdur). `leaderboard` — həftəlik reytinq görünsünmü.
-- Köhnə cədvəldə sütunları qrSchema.js əlavə edir.
-- Xal: raundun xalı / score_per_point (aşağı yuvarlaq), round_point_cap-dan çox deyil; gündə yalnız ilk
-- `daily_rounds` raund xal qazandırır (Bakı günü). Ayda `monthly_reward_cap`-dan çox mükafat verilmir.
CREATE TABLE IF NOT EXISTS qr_game_settings (
    profile_id          INT          NOT NULL PRIMARY KEY,
    enabled             TINYINT(1)   NOT NULL DEFAULT 0,
    moves               SMALLINT     NOT NULL DEFAULT 20,
    daily_rounds        SMALLINT     NOT NULL DEFAULT 3,
    score_per_point     INT          NOT NULL DEFAULT 100,
    round_point_cap     INT          NOT NULL DEFAULT 60,
    monthly_reward_cap  INT          NOT NULL DEFAULT 100,
    rewards             TEXT         NULL,
    tile_pack           VARCHAR(16)  NOT NULL DEFAULT 'classic',
    daily_goal_bonus    INT          NOT NULL DEFAULT 20,
    leaderboard         TINYINT(1)   NOT NULL DEFAULT 1,
    created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
