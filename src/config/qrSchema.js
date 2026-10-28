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
 *   - `profiles.is_qr_order_*` — superadmin də eyni sütunları əlavə edir; hansı
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
        await ensureColumns('qr_users', QR_USER_COLUMNS);
        await ensureTable('qr_phone_otps');
        console.log('✅ QR hesab sxemi hazırdır');
    } catch (error) {
        console.error('❌ QR hesab sxemi hazırlanmadı (qeydiyyat / giriş işləməyəcək):', error.message);
    }
}

module.exports = { ensureQrSchema, ensureColumns };
