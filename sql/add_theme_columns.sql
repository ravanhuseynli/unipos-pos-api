-- QR menyu görünüşü: tema (palitra) və stil (sıralanma).
--
-- ⚠️ BU MİQRASİYA API DEPLOY-DAN ƏVVƏL İŞLƏDİLMƏLİDİR.
--    `getMenuList` sorğusu `ac.theme` və `ac.menu_style` sütunlarını SELECT edir.
--    Sütunlar yoxdursa sorğu SQL xətası verir və BÜTÜN restoranların menyusu
--    açılmır. Əvvəlcə bu fayl, sonra kod.
--
-- Additive və nullable: POS, mobil tətbiq və admin panel təsirlənmir —
-- onlar bu sütunları oxumur. Boş qalan restoranlar defolt görünüşdə qalır.
--
-- Etibarlı dəyərlər (QR tətbiqi naməlum dəyəri səssizcə defolta endirir):
--   theme      — komur | terrakota | mese | gece | deniz | sarab | safran
--                nar | zeytun | kakao | fistiq | badimcan | mermer
--   menu_style — yumsaq | keskin | siyahi | klassik
--
-- İstifadə:
--   mysql -u root -p beta_unipos < sql/add_theme_columns.sql

ALTER TABLE `profiles`
  ADD COLUMN `theme` VARCHAR(32) NULL DEFAULT NULL COMMENT 'QR menyu palitrası';

ALTER TABLE `profiles`
  ADD COLUMN `menu_style` VARCHAR(32) NULL DEFAULT NULL COMMENT 'QR menyu sıralanması';
