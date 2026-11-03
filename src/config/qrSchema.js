const fs = require('fs');
const path = require('path');
const { pool } = require('./database');

/**
 * QR sifarişinin və QR menyu hesablarının baza sxemi — server hər işə düşəndə
 * yoxlanılır, çatışmayan hissə özü yaradılır. Əl ilə SQL işlətmək lazım deyil.
 *
 *   - `qr_orders` cədvəli — `sql/qr_orders.sql`-dən (yeganə mənbə, CREATE TABLE IF NOT EXISTS)
 *   - cədvəl artıq varsa, sonradan əlavə olunan sütunları (QR_ORDER_COLUMNS)
 *   - `qr_phone_otps` — nömrə təsdiq kodları, `sql/qr_phone_otps.sql`-dən
 *   - `qr_users.phone_verified_at` — nömrə WhatsApp kodu ilə təsdiqlənibsə
 *   - `qr_users.token_version` — şifrə dəyişəndə artır, köhnə tokenlər keçmir (utils/qrUserToken.js)
 *   - `profiles.is_qr_order_*`, `profiles.is_qr_landing`, `profiles.is_hotel_mode` — superadmin də eyni sütunları əlavə edir; hansı
 *     birinci işə düşsə, o yaradır
 *
 * Təkrar işə salmaq təhlükəsizdir. İki server nüsxəsi eyni anda ALTER etsə,
 * ikincisinin "sütun / indeks artıq var" xətası nəzərə alınmır.
 *
 * ATMIR: alınmasa (məs. DB istifadəçisinin CREATE/ALTER icazəsi yoxdursa) xəta
 * yazılır və server yenə də açılır — POS-un istifadə etdiyi qalan endpoint-lər
 * QR sxemindən asılı deyil.
 */

const SQL_DIR = path.join(__dirname, '..', '..', 'sql');

const PROFILE_COLUMNS = [
    { name: 'is_qr_order_manual', definition: 'INT NOT NULL DEFAULT 0' },
    { name: 'is_qr_order_direct', definition: 'INT NOT NULL DEFAULT 0' },
    // Defolt 1 — mövcud restoranlarda landing qalsın (superadmin ilə eyni tərif)
    { name: 'is_qr_landing', definition: 'INT NOT NULL DEFAULT 1' },
    // Otel rejimi — superadmin / admin backend də eyni sütunu yaradır (TINYINT(4), defolt 0).
    // GET /pos/menu bu sütunu SELECT edir: yoxdursa bütün menyular düşərdi, ona görə burada da təmin olunur.
    { name: 'is_hotel_mode', definition: 'TINYINT(4) NOT NULL DEFAULT 0' },
];

// `sql/qr_orders.sql`-ə sonradan əlavə olunan sütunlar — köhnə cədvəldə də olsun
const QR_ORDER_COLUMNS = [
    { name: 'customer_id', definition: 'INT NULL DEFAULT NULL', index: 'idx_qr_orders_customer_created (`customer_id`, `created_at`)' },
];

// NULL — köhnə hesablar (təsdiqsiz yaradılıb); yeni qeydiyyatda kodla təsdiq vaxtı
const QR_USER_COLUMNS = [
    { name: 'phone_verified_at', definition: 'DATETIME NULL DEFAULT NULL' },
    // Şifrə dəyişəndə +1 → bütün köhnə tokenlər (digər cihazlar) etibarsız olur
    { name: 'token_version', definition: 'INT NOT NULL DEFAULT 0' },
];

const IGNORED_DUPLICATES = new Set(['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME']);

const ensureColumns = async (table, columns) => {
    const [rows] = await pool.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME IN (?)`,
        [table, columns.map((c) => c.name)]
    );
    const existing = new Set(rows.map((r) => r.COLUMN_NAME));

    for (const column of columns) {
        if (existing.has(column.name)) continue;
        try {
            // eslint-disable-next-line no-await-in-loop
            await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column.name}\` ${column.definition}`);
            if (column.index) {
                // eslint-disable-next-line no-await-in-loop
                await pool.query(`ALTER TABLE \`${table}\` ADD INDEX ${column.index}`);
            }
            console.log(`🛠  ${table}.${column.name} sütunu əlavə olundu`);
        } catch (error) {
            if (!IGNORED_DUPLICATES.has(error.code)) throw error;
        }
    }
};

/** Cədvəl yoxdursa `sql/<table>.sql`-dən yaradılır (faylda bir ifadə). */
const ensureTable = async (table) => {
    const [[{ found }]] = await pool.query(
        `SELECT COUNT(*) AS found FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [table]
    );
    if (!Number(found)) {
        await pool.query(fs.readFileSync(path.join(SQL_DIR, `${table}.sql`), 'utf8'));
        console.log(`🛠  ${table} cədvəli yaradıldı`);
    }
};

// QR menyu sahələri — admin backend-in `ensureQrMenuFields` ilə EYNİ tərif (hansı birinci işə düşsə, o yaradır).
// GET /pos/menu onları yalnız mövcud olduqda seçir (config/menuColumns.js), ona görə alınmasa menyu düşmür.
const QR_MENU_COLUMNS = {
    general_categories: [
        { name: 'img_file', definition: 'VARCHAR(255) NULL DEFAULT NULL' },
        { name: 'name_en', definition: 'VARCHAR(255) NULL DEFAULT NULL' },
        { name: 'name_ru', definition: 'VARCHAR(255) NULL DEFAULT NULL' },
        { name: 'qr_icon', definition: 'VARCHAR(40) NULL DEFAULT NULL' },
        { name: 'qr_subtitle_az', definition: 'VARCHAR(160) NULL DEFAULT NULL' },
        { name: 'qr_subtitle_en', definition: 'VARCHAR(160) NULL DEFAULT NULL' },
        { name: 'qr_subtitle_ru', definition: 'VARCHAR(160) NULL DEFAULT NULL' },
        { name: 'qr_layout', definition: 'VARCHAR(20) NULL DEFAULT NULL' },
    ],
    categories: [
        { name: 'name_en', definition: 'VARCHAR(255) NULL DEFAULT NULL' },
        { name: 'name_ru', definition: 'VARCHAR(255) NULL DEFAULT NULL' },
        { name: 'qr_icon', definition: 'VARCHAR(40) NULL DEFAULT NULL' },
        { name: 'qr_subtitle_az', definition: 'VARCHAR(255) NULL DEFAULT NULL' },
        { name: 'qr_subtitle_en', definition: 'VARCHAR(255) NULL DEFAULT NULL' },
        { name: 'qr_subtitle_ru', definition: 'VARCHAR(255) NULL DEFAULT NULL' },
    ],
    products: [
        { name: 'qr_icon', definition: 'VARCHAR(40) NULL DEFAULT NULL' },
        { name: 'qr_badge_az', definition: 'VARCHAR(60) NULL DEFAULT NULL' },
        { name: 'qr_badge_en', definition: 'VARCHAR(60) NULL DEFAULT NULL' },
        { name: 'qr_badge_ru', definition: 'VARCHAR(60) NULL DEFAULT NULL' },
        { name: 'qr_action_type', definition: 'VARCHAR(20) NULL DEFAULT NULL' },
        { name: 'qr_action_value', definition: 'VARCHAR(500) NULL DEFAULT NULL' },
        { name: 'qr_info_only', definition: 'TINYINT(1) NOT NULL DEFAULT 0' },
    ],
};

async function ensureQrSchema() {
    try {
        await ensureColumns('profiles', PROFILE_COLUMNS);
        await ensureTable('qr_orders');
        await ensureColumns('qr_orders', QR_ORDER_COLUMNS);
        console.log('✅ QR sifariş sxemi hazırdır');
    } catch (error) {
        console.error('❌ QR sifariş sxemi hazırlanmadı (QR sifarişi işləməyəcək):', error.message);
    }

    try {
        for (const [table, columns] of Object.entries(QR_MENU_COLUMNS)) {
            // eslint-disable-next-line no-await-in-loop
            await ensureColumns(table, columns);
        }
        console.log('✅ QR menyu sahələri hazırdır');
    } catch (error) {
        console.error('❌ QR menyu sahələri hazırlanmadı (tərcümə / otel sahələri cavabda olmayacaq):', error.message);
    }

    try {
        await ensureColumns('qr_users', QR_USER_COLUMNS);
        await ensureTable('qr_phone_otps');
        console.log('✅ QR hesab sxemi hazırdır');
    } catch (error) {
        console.error('❌ QR hesab sxemi hazırlanmadı (qeydiyyat / giriş işləməyəcək):', error.message);
    }
}

module.exports = { ensureQrSchema, ensureColumns, ensureTable };
