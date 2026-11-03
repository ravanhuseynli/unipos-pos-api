-- ============================================================================
-- QR menyu sürəti — menyu cədvəllərinə indekslər (phpMyAdmin › SQL, baza seçilmiş halda)
--
-- NİYƏ: GET /pos/menu/:username bütün restoranlarda ~3 san cavab verirdi (2026-11-03
-- ölçüldü; /hotel və /modifiers isə 0.25 san). Menyu sorğusu kateqoriyaları `profile_id`,
-- məhsulları `category_id` ilə birləşdirir, amma bu sütunlarda indeks yoxdur — hər sorğu
-- bütün restoranların məhsul cədvəlini (base64 şəkillərlə birlikdə) başdan-başa oxuyur.
--
-- Yalnız indeks əlavə edir (məlumat dəyişmir), təkrar işə salmaq olar (IF NOT EXISTS).
-- InnoDB indeksi onlayn qurur — POS / admin / QR işləməyə davam edir. Böyük `products`
-- cədvəlində bir neçə saniyə–dəqiqə çəkə bilər; sakit saatda işə salın.
--
-- phpMyAdmin qeydi: `information_schema`-ya sorğu olan skript işlətməyin — phpMyAdmin
-- cari bazanı ora keçirir və sonrakı CREATE INDEX «#1044 Access denied … information_schema»
-- verir (2026-11-04 production-da baş verdi). Ona görə yoxlama SHOW INDEX ilədir.
--
-- Geri qaytarmaq: DROP INDEX <ad> ON <cədvəl>;
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_categories_profile ON categories (profile_id);
CREATE INDEX IF NOT EXISTS idx_products_category_profile ON products (category_id, profile_id);
CREATE INDEX IF NOT EXISTS idx_products_profile ON products (profile_id);
CREATE INDEX IF NOT EXISTS idx_general_categories_profile ON general_categories (profile_id);

-- Yoxlama
SHOW INDEX FROM products;
