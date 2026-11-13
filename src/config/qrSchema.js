const fs = require('fs');
const path = require('path');
const { pool } = require('./database');
const customerAccounts = require('../services/customerAccount.service');

/**
 * QR sifarişinin və QR menyu hesablarının baza sxemi — server hər işə düşəndə
 * yoxlanılır, çatışmayan hissə özü yaradılır. Əl ilə SQL işlətmək lazım deyil.
 *
 *   - `qr_orders` cədvəli — `sql/qr_orders.sql`-dən (yeganə mənbə, CREATE TABLE IF NOT EXISTS)
 *   - cədvəl artıq varsa, sonradan əlavə olunan sütunları (QR_ORDER_COLUMNS)
 *   - `qr_phone_otps` — nömrə təsdiq kodları, `sql/qr_phone_otps.sql`-dən
 *   - `qr_users.phone_verified_at` — nömrə WhatsApp kodu ilə təsdiqlənibsə
 *   - `qr_users.token_version` — şifrə dəyişəndə artır, köhnə tokenlər keçmir (utils/qrUserToken.js)
 *   - `qr_users.account_id` (UNIQUE) — vahid müştəri hesabına (customer_accounts) bağlantı; sonra köhnə
 *     QR hesablarının bir dəfəlik köçürülməsi arxa planda başlayır (services/customerAccount.service.js)
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
    // Vahid müştəri hesabı (customer_accounts.id, admin backend-in cədvəli). NULL — hələ köçürülməyib.
    // UNIQUE indeks ayrıca (ensureIndex) — sütun əvvəlki cəhddə yaranıb indeks qalıbsa da tamamlansın
    { name: 'account_id', definition: 'INT NULL DEFAULT NULL' },
];

// `sql/qr_game_settings.sql`-ə sonradan əlavə olunanlar — admin backend də eyni sütunları əlavə edir
// (backend/index.js ensureQrGameSchema); hansı birinci işə düşsə, o yaradır
const QR_GAME_SETTINGS_COLUMNS = [
    // Daş dəsti: classic (burger, pizza…) | sushi | national | coffee — QR lib/game/packs.js
    { name: 'tile_pack', definition: "VARCHAR(16) NOT NULL DEFAULT 'classic'" },
    // Gündəlik tapşırığın bonusu (xal); 0 — tapşırıq yoxdur
    { name: 'daily_goal_bonus', definition: 'INT NOT NULL DEFAULT 20' },
    // Həftəlik reytinq (GET /qr-game/:u/leaderboard) — 0 olanda QR-da görünmür
    { name: 'leaderboard', definition: 'TINYINT(1) NOT NULL DEFAULT 1' },
];

// `sql/qr_game_rounds.sql`-ə sonradan əlavə olunanlar
const QR_GAME_ROUND_COLUMNS = [
    // Qonaq raundu gündəlik tapşırığı yerinə yetiribmi — bonus claim zamanı yazılır
    { name: 'goal_met', definition: 'TINYINT(1) NULL DEFAULT NULL' },
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

/** İndeks yoxdursa yaradılır (`definition` — `UNIQUE INDEX ad (sütun)` kimi ALTER TABLE ADD-in davamı) */
const ensureIndex = async (table, name, definition) => {
    const [[{ found }]] = await pool.query(
        `SELECT COUNT(*) AS found FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
        [table, name]
    );
    if (Number(found)) return;
    try {
        await pool.query(`ALTER TABLE \`${table}\` ADD ${definition}`);
        console.log(`🛠  ${table}.${name} indeksi əlavə olundu`);
    } catch (error) {
        if (!IGNORED_DUPLICATES.has(error.code)) throw error;
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
        // Məhsul adının tərcüməsi (kateqoriya kimi; boş → AZ `name`)
        { name: 'name_en', definition: 'VARCHAR(255) NULL DEFAULT NULL' },
        { name: 'name_ru', definition: 'VARCHAR(255) NULL DEFAULT NULL' },
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
        await ensureIndex('qr_users', 'uniq_qr_users_account', 'UNIQUE INDEX `uniq_qr_users_account` (`account_id`)');
        await ensureTable('qr_phone_otps');
        console.log('✅ QR hesab sxemi hazırdır');
    } catch (error) {
        console.error('❌ QR hesab sxemi hazırlanmadı (qeydiyyat / giriş işləməyəcək):', error.message);
    }

    // QR oyunu (services/qrGame.service.js) — qr_game_settings-i admin backend də eyni tərif ilə yaradır
    try {
        await ensureTable('qr_game_settings');
        await ensureColumns('qr_game_settings', QR_GAME_SETTINGS_COLUMNS);
        await ensureTable('qr_game_rounds');
        await ensureColumns('qr_game_rounds', QR_GAME_ROUND_COLUMNS);
        await ensureTable('qr_game_points');
        console.log('✅ QR oyun sxemi hazırdır');
    } catch (error) {
        console.error('❌ QR oyun sxemi hazırlanmadı (oyun işləməyəcək):', error.message);
    }

    // Vahid hesab (QR + loyallıq). customer_accounts admin backend-indir — yoxdursa QR menyu köhnə qaydada
    // (yalnız qr_users) işləyir. Köçürmə serveri gözlətmir: arxa planda gedir, xətası yalnız loglanır.
    try {
        const ready = await customerAccounts.init();
        if (ready.accounts) {
            console.log(`✅ Vahid müştəri hesabı aktivdir (müştəri bazası: ${ready.customers ? 'bəli' : 'XEYR'}, veb sessiyalar: ${ready.sessions ? 'bəli' : 'xeyr'})`);
            customerAccounts.runMigration().catch((error) => console.error('❌ QR hesab köçürməsi dayandı:', error.message));
        } else {
            console.error('❌ Vahid müştəri hesabı söndürülüb: customer_accounts və ya qr_users.account_id yoxdur — QR girişi köhnə qaydada');
        }
    } catch (error) {
        console.error('❌ Vahid müştəri hesabı yoxlanmadı (QR girişi köhnə qaydada):', error.message);
    }
}

module.exports = { ensureQrSchema, ensureColumns, ensureTable, ensureIndex };
