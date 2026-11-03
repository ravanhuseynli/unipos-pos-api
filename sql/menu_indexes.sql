-- ============================================================================
-- QR menyu sürəti — menyu cədvəllərinə indekslər (phpMyAdmin › SQL və ya Import)
--
-- NİYƏ: GET /pos/menu/:username bütün restoranlarda ~3 san cavab verirdi (2026-11-03
-- ölçüldü; /hotel və /modifiers isə 0.25 san). Menyu sorğusu kateqoriyaları `profile_id`,
-- məhsulları `category_id` ilə birləşdirir, amma bu sütunlarda indeks yoxdur — hər sorğu
-- bütün restoranların məhsul cədvəlini (base64 şəkillərlə birlikdə) başdan-başa oxuyur.
--
-- TƏHLÜKƏSİZDİR:
--   • yalnız indeks əlavə edir — heç bir sütun və ya məlumat dəyişmir;
--   • eyni sütunda indeks artıq varsa (hansı adla olur-olsun) yenisi yaradılmır;
--   • ALGORITHM=INPLACE, LOCK=NONE — indeks qurularkən cədvəl oxunur və yazılır,
--     POS / admin / QR işləməyə davam edir;
--   • təkrar işə salmaq olar.
-- Böyük `products` cədvəlində qurulma bir neçə saniyə–dəqiqə çəkə bilər; sakit saatda işə salın.
-- Geri qaytarmaq: DROP INDEX <ad> ON <cədvəl>;  (adlar aşağıdadır)
-- ============================================================================

-- 1. categories(profile_id) — restoranın kateqoriyaları
SET @has := (SELECT COUNT(*) FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories'
                AND COLUMN_NAME = 'profile_id' AND SEQ_IN_INDEX = 1);
SET @sql := IF(@has = 0,
  'CREATE INDEX idx_categories_profile ON categories (profile_id) ALGORITHM=INPLACE LOCK=NONE',
  'SELECT ''categories.profile_id — indeks artıq var'' AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. products(category_id, profile_id) — kateqoriyanın məhsulları (menyu sorğusunun JOIN-i)
SET @has := (SELECT COUNT(*) FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products'
                AND COLUMN_NAME = 'category_id' AND SEQ_IN_INDEX = 1);
SET @sql := IF(@has = 0,
  'CREATE INDEX idx_products_category_profile ON products (category_id, profile_id) ALGORITHM=INPLACE LOCK=NONE',
  'SELECT ''products.category_id — indeks artıq var'' AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. products(profile_id) — restoranın bütün məhsulları (admin, POS, modifikatorlar)
SET @has := (SELECT COUNT(*) FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products'
                AND COLUMN_NAME = 'profile_id' AND SEQ_IN_INDEX = 1);
SET @sql := IF(@has = 0,
  'CREATE INDEX idx_products_profile ON products (profile_id) ALGORITHM=INPLACE LOCK=NONE',
  'SELECT ''products.profile_id — indeks artıq var'' AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4. general_categories(profile_id) — otel portalının plitələri
SET @has := (SELECT COUNT(*) FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'general_categories'
                AND COLUMN_NAME = 'profile_id' AND SEQ_IN_INDEX = 1);
SET @sql := IF(@has = 0,
  'CREATE INDEX idx_general_categories_profile ON general_categories (profile_id) ALGORITHM=INPLACE LOCK=NONE',
  'SELECT ''general_categories.profile_id — indeks artıq var'' AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Yoxlama: menyu cədvəllərinin indeksləri
SELECT TABLE_NAME AS cedvel, INDEX_NAME AS indeks, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS sutunlar
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('categories', 'products', 'general_categories')
 GROUP BY TABLE_NAME, INDEX_NAME
 ORDER BY TABLE_NAME, INDEX_NAME;
