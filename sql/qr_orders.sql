-- QR-dan masa sifarişləri (src/services/qrOrder.service.js).
--
-- ⚠️ BU MİQRASİYA API DEPLOY-DAN ƏVVƏL İŞLƏDİLMƏLİDİR — `POST /api/qr-orders`
--    bu cədvələ yazır.
--
-- Additive: başqa cədvəllərə toxunmur. POS, mobil tətbiq və admin panel bu
-- cədvəli oxumur. `profiles.is_qr_order_manual` / `is_qr_order_direct`
-- sütunlarını superadmin panel özü əlavə edir.
--
-- status: pending → delivered → accepted | rejected | failed
--         pending (15 dəq kassaya çatmadı) → expired
--
-- İstifadə:
--   mysql -u root -p beta_unipos < sql/qr_orders.sql

CREATE TABLE IF NOT EXISTS `qr_orders` (
  `id`           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `uuid`         CHAR(36)      NOT NULL,
  `profile_id`   INT           NOT NULL,
  `hall_id`      INT           NOT NULL DEFAULT 0,
  `table_id`     INT           NOT NULL,
  `mode`         VARCHAR(10)   NOT NULL COMMENT 'manual | direct',
  `status`       VARCHAR(12)   NOT NULL DEFAULT 'pending',
  `payload`      JSON          NOT NULL COMMENT 'kassaya göndərilən qr:order:new',
  `total`        DECIMAL(10,2) NOT NULL DEFAULT 0,
  `check_id`     BIGINT        NULL DEFAULT NULL COMMENT 'kassada açılan çekin nömrəsi',
  `reason`       VARCHAR(255)  NULL DEFAULT NULL,
  `guest_ip`     VARCHAR(45)   NULL DEFAULT NULL,
  `created_at`   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `delivered_at` DATETIME      NULL DEFAULT NULL,
  `resolved_at`  DATETIME      NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_qr_orders_uuid` (`uuid`),
  KEY `idx_qr_orders_profile_status` (`profile_id`, `status`),
  KEY `idx_qr_orders_table_created` (`table_id`, `created_at`),
  KEY `idx_qr_orders_status_created` (`status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
