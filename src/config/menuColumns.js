const { pool } = require('./database');

/**
 * QR menyu üçün SONRADAN əlavə olunan (könüllü) sütunlar — üst kateqoriya / kateqoriya üçün EN/RU ad,
 * otel portalı sahələri (ikon, alt başlıq, görünüş, nişan, hərəkət, «yalnız məlumat»).
 *
 * Sütunları admin backend yaradır (`ensureQrMenuFields`), bu API da başlanğıcda yaradır (qrSchema.js).
 * Hansının bazada HƏQİQƏTƏN olduğu burada yadda saxlanılır və `GET /pos/menu` yalnız onları SELECT edir:
 * sütun yoxdursa (ALTER alınmayıb, deploy ardıcıllığı) bütün restoranların menyusu düşməsin — sadəcə
 * həmin sahə cavabda olmur. Hər 5 dəqiqədən bir yenilənir (admin sonradan yaradarsa da tutulsun).
 */

const OPTIONAL = {
    general_categories: [
        'img_file', 'name_en', 'name_ru', 'qr_icon',
        'qr_subtitle_az', 'qr_subtitle_en', 'qr_subtitle_ru', 'qr_layout',
    ],
    categories: [
        'name_en', 'name_ru', 'qr_icon', 'qr_subtitle_az', 'qr_subtitle_en', 'qr_subtitle_ru',
    ],
    products: [
        'qr_icon', 'qr_badge_az', 'qr_badge_en', 'qr_badge_ru',
        'qr_action_type', 'qr_action_value', 'qr_info_only',
    ],
};

const REFRESH_MS = 5 * 60 * 1000;
let present = null;
let loadedAt = 0;
let loading = null;

async function load() {
    const tables = Object.keys(OPTIONAL);
    const [rows] = await pool.query(
        `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)`,
        [tables]
    );
    const next = new Set(rows.map((r) => `${r.TABLE_NAME}.${r.COLUMN_NAME}`));
    present = next;
    loadedAt = Date.now();
    return next;
}

/** Mövcud sütunlar (`cədvəl.sütun`) — xəta olsa boş çoxluq: heç bir könüllü sahə seçilmir */
async function menuColumns() {
    if (present && Date.now() - loadedAt < REFRESH_MS) return present;
    if (!loading) {
        loading = load()
            .catch((error) => {
                console.error('menuColumns:', error.message);
                return present || new Set();
            })
            .finally(() => {
                loading = null;
            });
    }
    return loading;
}

/**
 * `alias.sütun AS prefix_sütun` siyahısı — yalnız mövcud olanlar.
 * @returns {string} ", c.name_en AS category_name_en, …" və ya ""
 */
function selectList(cols, table, alias, prefix) {
    return OPTIONAL[table]
        .filter((c) => cols.has(`${table}.${c}`))
        .map((c) => `, ${alias}.${c} AS ${prefix}${c}`)
        .join('');
}

module.exports = { OPTIONAL, menuColumns, selectList };
