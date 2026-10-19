const fs = require('fs');
const path = require('path');
const { pool } = require('./database');

/**
 * QR sifarişinin baza sxemi — server hər işə düşəndə yoxlanılır, çatışmayan
 * hissə özü yaradılır. Əl ilə SQL işlətmək lazım deyil.
 *
 *   - `qr_orders` cədvəli — `sql/qr_orders.sql`-dən (yeganə mənbə, CREATE TABLE IF NOT EXISTS)
 *   - cədvəl artıq varsa, sonradan əlavə olunan sütunları (QR_ORDER_COLUMNS)
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

const QR_ORDERS_SQL = path.join(__dirname, '..', '..', 'sql', 'qr_orders.sql');

const PROFILE_COLUMNS = [
    { name: 'is_qr_order_manual', definition: 'INT NOT NULL DEFAULT 0' },
    { name: 'is_qr_order_direct', definition: 'INT NOT NULL DEFAULT 0' },
];

// `sql/qr_orders.sql`-ə sonradan əlavə olunan sütunlar — köhnə cədvəldə də olsun
const QR_ORDER_COLUMNS = [
    { name: 'customer_id', definition: 'INT NULL DEFAULT NULL', index: 'idx_qr_orders_customer_created (`customer_id`, `created_at`)' },
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

const ensureQrOrdersTable = async () => {
    const [[{ found }]] = await pool.query(
        `SELECT COUNT(*) AS found FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'qr_orders'`
    );
    if (!Number(found)) {
        await pool.query(fs.readFileSync(QR_ORDERS_SQL, 'utf8'));
        console.log('🛠  qr_orders cədvəli yaradıldı');
    }
    await ensureColumns('qr_orders', QR_ORDER_COLUMNS);
};

async function ensureQrSchema() {
    try {
        await ensureColumns('profiles', PROFILE_COLUMNS);
        await ensureQrOrdersTable();
        console.log('✅ QR sifariş sxemi hazırdır');
    } catch (error) {
        console.error('❌ QR sifariş sxemi hazırlanmadı (QR sifarişi işləməyəcək):', error.message);
    }
}

module.exports = { ensureQrSchema };
