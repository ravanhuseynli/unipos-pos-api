const fs = require('fs');
const path = require('path');
const { pool } = require('./database');

/**
 * QR sifarişinin baza sxemi — server hər işə düşəndə yoxlanılır, çatışmayan
 * hissə özü yaradılır. Əl ilə SQL işlətmək lazım deyil.
 *
 *   - `qr_orders` cədvəli — `sql/qr_orders.sql`-dən (yeganə mənbə, CREATE TABLE IF NOT EXISTS)
 *   - `profiles.is_qr_order_manual` / `is_qr_order_direct` — superadmin də eyni
 *     sütunları əlavə edir; hansı birinci işə düşsə, o yaradır
 *
 * Təkrar işə salmaq təhlükəsizdir. İki server nüsxəsi eyni anda ALTER etsə,
 * ikincisinin "sütun artıq var" xətası nəzərə alınmır.
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

const ensureProfileColumns = async () => {
    const [rows] = await pool.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'profiles' AND COLUMN_NAME IN (?)`,
        [PROFILE_COLUMNS.map((c) => c.name)]
    );
    const existing = new Set(rows.map((r) => r.COLUMN_NAME));

    for (const column of PROFILE_COLUMNS) {
        if (existing.has(column.name)) continue;
        try {
            // eslint-disable-next-line no-await-in-loop
            await pool.query(`ALTER TABLE \`profiles\` ADD COLUMN \`${column.name}\` ${column.definition}`);
            console.log(`🛠  profiles.${column.name} sütunu əlavə olundu`);
        } catch (error) {
            if (error.code !== 'ER_DUP_FIELDNAME') throw error;
        }
    }
};

const ensureQrOrdersTable = async () => {
    const [[{ found }]] = await pool.query(
        `SELECT COUNT(*) AS found FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'qr_orders'`
    );
    if (Number(found)) return;
    await pool.query(fs.readFileSync(QR_ORDERS_SQL, 'utf8'));
    console.log('🛠  qr_orders cədvəli yaradıldı');
};

async function ensureQrSchema() {
    try {
        await ensureProfileColumns();
        await ensureQrOrdersTable();
        console.log('✅ QR sifariş sxemi hazırdır');
    } catch (error) {
        console.error('❌ QR sifariş sxemi hazırlanmadı (QR sifarişi işləməyəcək):', error.message);
    }
}

module.exports = { ensureQrSchema };
