const { pool } = require('../config/database');
const { menuColumns, selectList } = require('../config/menuColumns');

/**
 * Şəkil fayllarının serverdəki kökü (admin backend `/uploads`-u static verir).
 */
const UPLOADS_BASE_URL = (process.env.UPLOADS_BASE_URL || 'https://api.unipos.tech').replace(/\/$/, '');

/**
 * Klientə göndəriləcək şəkil dəyərini seçir.
 *
 * Şəkillər base64-dən fayla köçürülür: `img_file` dolu olan sətirlərdə TAM URL
 * qaytarılır, əks halda köhnə `img` (base64) dəyəri.
 *
 * Tam URL qaytarmaq vacibdir — bu sahəni onlarla klient (POS, mobil, QR, admin)
 * birbaşa `<img src>`-ə qoyur. Nisbi yol göndərilsə, hər klient onu ÖZ domenində
 * axtarar və şəkil görünməz. Tam URL isə base64 kimi hər yerdə işləyir, ona görə
 * heç bir klientdə dəyişiklik tələb olunmur.
 */
function toImageValue(imgFile, legacyImg) {
    if (imgFile && String(imgFile).trim()) {
        const p = String(imgFile).trim();
        if (p.startsWith('http://') || p.startsWith('https://')) return p;
        return `${UPLOADS_BASE_URL}/${p.replace(/^\//, '')}`;
    }
    return legacyImg;
}

/** `prefix_az/_en/_ru` sütunları → { az, en, ru } (boş → null) */
function tr(row, prefix) {
    const out = {};
    for (const l of ['az', 'en', 'ru']) {
        const v = row[`${prefix}_${l}`];
        out[l] = v !== null && v !== undefined && String(v).trim() ? String(v) : null;
    }
    return out;
}

/**
 * Köhnə base64 şəklin (img_file boş) fayl kimi verildiyi nisbi yol. QR Next onu API domeninə bağlayır
 * və öz optimallaşdırıcısı ilə kiçildir. `v` — şəkil dəyişəndə URL də dəyişsin (keş).
 */
function legacyImagePath(kind, id, img) {
    if (typeof img !== 'string') return null;
    const m = img.slice(0, 40).match(/^data:(image\/[a-z0-9.+-]+);base64,/i);
    if (!m || !LEGACY_IMAGE_TYPES.has(m[1].toLowerCase())) return null;
    return `/api/pos/legacy-image/${kind}/${id}?v=${img.length}`;
}

const LEGACY_IMAGE_TABLES = { category: 'categories', 'general-category': 'general_categories' };
// SVG verilmir: API domenində açılan SVG skript işlədə bilər; optimallaşdırıcı da SVG qəbul etmir
const LEGACY_IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']);

/**
 * @desc    Köhnə base64 kateqoriya / üst kateqoriya şəklini fayl kimi verir (otel QR portalı)
 * @route   GET /api/pos/legacy-image/:kind/:id   (kind: category | general-category)
 *
 * Menyu cavabına 100+ KB-lıq base64 qoymaq əvəzinə portal bu URL-i işlədir. img_file varsa
 * həmin fayla yönləndirir. Açıqdır — menyu məlumatı onsuz da açıqdır.
 */
const getLegacyImage = async (req, res) => {
    try {
        const table = LEGACY_IMAGE_TABLES[req.params.kind];
        const id = Number(req.params.id);
        if (!table || !Number.isInteger(id) || id <= 0) return res.status(404).end();

        const [rows] = await pool.execute(`SELECT img, img_file FROM ${table} WHERE id = ? LIMIT 1`, [id]);
        const row = rows[0];
        if (!row) return res.status(404).end();
        if (row.img_file) return res.redirect(302, toImageValue(row.img_file, null));

        const m = typeof row.img === 'string' ? row.img.match(/^data:(image\/[a-z0-9.+-]+);base64,/i) : null;
        if (!m || !LEGACY_IMAGE_TYPES.has(m[1].toLowerCase())) return res.status(404).end();
        const buf = Buffer.from(row.img.slice(m[0].length), 'base64');
        if (!buf.length) return res.status(404).end();

        res.set({
            'Content-Type': m[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : m[1].toLowerCase(),
            'Cache-Control': 'public, max-age=86400',
            'X-Content-Type-Options': 'nosniff',
            // helmet CORP `same-origin` qoyur — QR (başqa domen) şəkli <img>-də göstərə bilsin
            'Cross-Origin-Resource-Policy': 'cross-origin'
        });
        return res.send(buf);
    } catch (error) {
        console.error('GetLegacyImage error:', error);
        return res.status(500).end();
    }
};

/** Hamısı boşdursa null — cavaba yazılmasın */
function trOrNull(row, prefix) {
    const t = tr(row, prefix);
    return t.az || t.en || t.ru ? t : null;
}

/** null / undefined / '' dəyərli açarlar atılır (0 qalır — sıra 0 ola bilər) */
function sparse(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v !== null && v !== undefined && v !== '') out[k] = v;
    }
    return out;
}

/**
 * @desc    Get printers by profile_id
 * @route   GET /api/pos/printers/:profileId
 */
const getPrinters = async (req, res) => {
    try {
        const { profileId } = req.params;
        const [printers] = await pool.execute(
            'SELECT * FROM printers WHERE profile_id = ?',
            [profileId]
        );
        res.json({ status: 'success', data: printers });
    } catch (error) {
        console.error('GetPrinters error:', error);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
};

/**
 * @desc    Get cash printers by profile_id
 * @route   GET /api/pos/cash-printers/:profileId
 */
const getCashPrinters = async (req, res) => {
    try {
        const { profileId } = req.params;
        if (!profileId) {
            return res.json({ status: 'error', message: 'profile_id parametri tələb olunur.' });
        }
        const [printers] = await pool.execute(
            'SELECT * FROM printers WHERE is_cashier = 1 AND profile_id = ?',
            [profileId]
        );
        res.json({ status: 'success', count: printers.length, data: printers });
    } catch (error) {
        console.error('GetCashPrinters error:', error);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
};

/**
 * @desc    Get categories by profile_id
 * @route   GET /api/pos/categories/:profileId
 */
const getCategories = async (req, res) => {
    try {
        const { profileId } = req.params;
        if (!profileId) {
            return res.json({ error: 'Missing parameters' });
        }

        let actualProfileId = profileId;
        if (isNaN(profileId)) {
            const [profiles] = await pool.execute('SELECT id FROM profiles WHERE username = ?', [profileId]);
            if (profiles.length === 0) {
                return res.status(404).json({ success: false, message: 'Profil tapılmadı.' });
            }
            actualProfileId = profiles[0].id;
        }

        const [categories] = await pool.execute(
            'SELECT * FROM categories WHERE profile_id = ?',
            [actualProfileId]
        );
        res.json({ categories });
    } catch (error) {
        console.error('GetCategories error:', error);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
};

/**
 * @desc    Get general categories by profile_id
 * @route   GET /api/pos/general-categories/:profileId
 */
const getGeneralCategories = async (req, res) => {
    try {
        const { profileId } = req.params;
        if (!profileId) {
            return res.json({ status: 'error', message: 'profile_id required' });
        }

        let actualProfileId = profileId;
        if (isNaN(profileId)) {
            const [profiles] = await pool.execute('SELECT id FROM profiles WHERE username = ?', [profileId]);
            if (profiles.length === 0) {
                return res.status(404).json({ success: false, message: 'Profil tapılmadı.' });
            }
            actualProfileId = profiles[0].id;
        }

        const [data] = await pool.execute(
            'SELECT * FROM general_categories WHERE profile_id = ?',
            [actualProfileId]
        );
        res.json({ status: 'success', data });
    } catch (error) {
        console.error('GetGeneralCategories error:', error);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
};

/**
 * @desc    Get menu list (nested structure)
 * @route   GET /api/pos/menu/:profileId
 */
const getMenuList = async (req, res) => {
    try {
        const { profileId } = req.params;
        if (!profileId) {
            return res.status(400).json({ error: 'profileId parameter is required' });
        }

        let actualProfileId = profileId;
        if (isNaN(profileId)) {
            const [profiles] = await pool.execute('SELECT id FROM profiles WHERE username = ?', [profileId]);
            if (profiles.length === 0) {
                return res.status(404).json({ success: false, message: 'Profil tapılmadı.' });
            }
            actualProfileId = profiles[0].id;
        }

        // Könüllü sütunlar (EN/RU ad, otel portalı sahələri) — yalnız bazada olanlar seçilir
        const cols = await menuColumns();

        const [data] = await pool.execute(`
            SELECT
                ac.id AS profile_id, 
                ac.logo,
                ac.restaurant_name,
                ac.username,
                ac.is_menu,
                ac.is_menu_block,
                ac.is_qr_landing,
                ac.is_hotel_mode,
                ac.next_payment_date,
                ac.background_img,
                ac.address,
                ac.about,
                ac.phone,
                ac.facebook,
                ac.instagram,
                ac.tiktok,
                ac.twitter,
                ac.google_map_link,
                ac.google_maps_url,
                ac.wifi_ssid,
                ac.wifi_password,
                ac.service_fee,
                (SELECT COALESCE(ROUND(AVG(rating), 1), 0) FROM reviews WHERE LOWER(business_name) = LOWER(ac.username)) AS average_rating,
                (SELECT COUNT(*) FROM reviews WHERE LOWER(business_name) = LOWER(ac.username)) AS review_count,
                ac.open_hours,
                ac.theme,
                ac.menu_style,
                c.id AS category_id,
                c.name AS category_name,
                c.img AS category_img,
                c.img_file AS category_img_file,
                c.discount AS category_discount,
                c.general_categorie_id AS category_general_id,
                c.ordering AS category_ordering${selectList(cols, 'categories', 'c', 'category_')},
                p.id AS product_id,
                p.name AS product_name,
                p.price AS product_price,
                p.cost_price,
                p.no_discount,
                p.no_service_fee,
                p.own_set_price,
                p.ingredient,
                p.discount AS discount,
                p.img AS product_img,
                p.img_file AS product_img_file,
                p.product_type,
                p.timer_intervals,
                p.are_orders_included,
                p.hourly_price,
                pr.local_name AS printer,
                p.ordering AS product_ordering${selectList(cols, 'products', 'p', 'product_')}
            FROM profiles ac
            LEFT JOIN categories c ON c.profile_id = ac.id
            -- Məhsul da bu restoranın olmalıdır: başqa profilin məhsulu bu profilin
            -- kateqoriyasına bağlana bilir (kopyalanmış data) — admin API kimi profile_id ilə süzülür
            LEFT JOIN products p ON p.category_id = c.id AND p.profile_id = ac.id
            LEFT JOIN printers pr ON pr.id = c.printer_id
            WHERE ac.id = ?
              AND (c.is_hidden_qr = 0 OR c.is_hidden_qr IS NULL)
              AND (p.is_hidden_qr = 0 OR p.is_hidden_qr IS NULL)
            ORDER BY c.id, p.id
        `, [actualProfileId]);

        const menuMap = {};
        // Otel portalı sahələri (sıra, ikon, nişan, hərəkət) yalnız otel rejimində göndərilir; qalan
        // könüllü sahələr yalnız DOLU olanda — menyu cavabı bütün restoranlar üçün şişməsin
        // (planşet tətbiqi də onu birbaşa yükləyir). QR Next olmayan sahəni boş sayır.
        const isHotel = data.length > 0 && Number(data[0].is_hotel_mode) === 1;

        for (const row of data) {
            const cId = row.category_id;
            const pId = row.product_id;

            if (cId && !menuMap[cId]) {
                menuMap[cId] = {
                    id: cId,
                    name: row.category_name,
                    img: toImageValue(row.category_img_file, row.category_img),
                    category_discount: row.category_discount,
                    // QR menyu (əlavə sahələr — köhnə klientlər nəzərə almır; yalnız dolu olanlar)
                    ...sparse({
                        general_category_id: isHotel ? row.category_general_id : null,
                        ordering: isHotel ? row.category_ordering : null,
                        name_en: row.category_name_en,
                        name_ru: row.category_name_ru,
                        qr_icon: isHotel ? row.category_qr_icon : null,
                        qr_subtitle: isHotel ? trOrNull(row, 'category_qr_subtitle') : null,
                        // Köhnə base64 şəkil (img_file yoxdur) — portal onu fayl kimi bu yoldan alır
                        qr_img: isHotel && !row.category_img_file ? legacyImagePath('category', cId, row.category_img) : null
                    }),
                    products: []
                };
            }

            if (pId && menuMap[cId]) {
                menuMap[cId].products.push({
                    id: pId,
                    name: row.product_name,
                    price: row.product_price,
                    cost_price: row.cost_price,
                    no_discount: row.no_discount,
                    no_service_fee: row.no_service_fee,
                    own_set_price: row.own_set_price,
                    discount: row.discount,
                    ingredient: row.ingredient,
                    img: toImageValue(row.product_img_file, row.product_img),
                    product_type: row.product_type,
                    timer_intervals: typeof row.timer_intervals === 'string' ? JSON.parse(row.timer_intervals) : row.timer_intervals,
                    are_orders_included: row.are_orders_included,
                    hourly_price: row.hourly_price,
                    printer: row.printer,
                    // Ad tərcüməsi — yalnız dolu olanda (bütün restoranlar; kateqoriyadakı kimi)
                    ...sparse({ name_en: row.product_name_en, name_ru: row.product_name_ru }),
                    // QR menyu — otel portalı sahələri (yalnız otel rejimində və yalnız dolu olanlar)
                    ...(isHotel ? sparse({
                        ordering: row.product_ordering,
                        qr_icon: row.product_qr_icon,
                        qr_badge: trOrNull(row, 'product_qr_badge'),
                        qr_action_type: row.product_qr_action_type,
                        qr_action_value: row.product_qr_action_value,
                        qr_info_only: Number(row.product_qr_info_only) === 1 ? 1 : null
                    }) : {})
                });
            }
        }

        const menu = Object.values(menuMap);

        // Üst kateqoriyalar — otel portalının plitələri, menyuda EN/RU ad. Şəkil YALNIZ fayl URL-i:
        // köhnə base64 `img` cavaba qoyulmur (menyu cavabı yenə 20 MB olmasın — bax MEMORY.md).
        let generalCategories = [];
        // Plitələr yalnız otel portalında lazımdır
        if (isHotel) try {
            const [gRows] = await pool.execute(
                `SELECT g.id, g.name, g.ordering,
                        CASE WHEN g.img LIKE 'data:image/%' AND g.img NOT LIKE 'data:image/svg%' THEN CHAR_LENGTH(g.img) ELSE 0 END AS legacy_img_len
                        ${selectList(cols, 'general_categories', 'g', '')}
                   FROM general_categories g WHERE g.profile_id = ? ORDER BY g.ordering, g.id`,
                [actualProfileId]
            );
            generalCategories = gRows.map((g) => ({
                id: g.id,
                name: g.name,
                name_en: g.name_en || null,
                name_ru: g.name_ru || null,
                ordering: g.ordering,
                // Fayl şəkli — tam URL; köhnə base64 — fayl kimi verən yol (cavaba base64 qoyulmur)
                img: g.img_file
                    ? toImageValue(g.img_file, null)
                    : g.legacy_img_len > 0 ? `/api/pos/legacy-image/general-category/${g.id}?v=${g.legacy_img_len}` : null,
                qr_icon: g.qr_icon || null,
                qr_subtitle: tr(g, 'qr_subtitle'),
                qr_layout: g.qr_layout || null
            }));
        } catch (error) {
            console.error('GetMenuList general_categories:', error.message);
        }

        let profile = {};
        if (data.length > 0) {
            profile = {
                id: data[0].profile_id,
                logo: data[0].logo,
                restaurant_name: data[0].restaurant_name,
                username: data[0].username,
                // Superadmin → "Menyu Aktivdir (QR menyu modulu)". 0 olanda QR menyu açılmamalıdır.
                is_menu: data[0].is_menu,
                is_menu_block: data[0].is_menu_block,
                // Superadmin → QR landing səhifəsi. 1 = `/<restoran>` landing göstərir, 0 = birbaşa menyu.
                is_qr_landing: data[0].is_qr_landing,
                // Superadmin → otel rejimi. 1 = `/<restoran>` otel qonaq portalı göstərir (GET /api/hotel/:username)
                is_hotel_mode: data[0].is_hotel_mode,
                next_payment_date: data[0].next_payment_date,
                background_img: data[0].background_img,
                address: data[0].address,
                about: data[0].about,
                phone: data[0].phone,
                facebook: data[0].facebook,
                instagram: data[0].instagram,
                tiktok: data[0].tiktok,
                twitter: data[0].twitter,
                google_map_link: data[0].google_map_link,
                google_maps_url: data[0].google_maps_url,
                wifi_ssid: data[0].wifi_ssid,
                wifi_password: data[0].wifi_password,
                service_fee: data[0].service_fee,
                average_rating: data[0].average_rating,
                review_count: data[0].review_count,
                open_hours: data[0].open_hours,

                /*
                  QR menyunun görünüşü — restoran sahibi admin paneldən seçir.
                  `theme` palitranı, `menu_style` isə sıralanmanı təyin edir.

                  Dəyərlər OLDUĞU KİMİ ötürülür, burada yoxlanılmır: QR tətbiqi
                  naməlum və ya boş dəyəri səssizcə defolta (`komur` / `yumsaq`)
                  endirir. Beləliklə 14-cü tema əlavə ediləndə bu API-yə toxunmaq
                  lazım gəlmir.

                  Etibarlı dəyərlər:
                    theme      — komur, terrakota, mese, gece, deniz, sarab,
                                 safran, nar, zeytun, kakao, fistiq, badimcan,
                                 mermer
                    menu_style — yumsaq, keskin, siyahi, klassik
                */
                theme: data[0].theme,
                menu_style: data[0].menu_style
            };
        }

        res.json({ profile, menu, general_categories: generalCategories });
    } catch (error) {
        console.error('GetMenuList error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

/**
 * @desc    Get payment methods by profile_id
 * @route   GET /api/pos/payment-methods/:profileId
 */
const getPaymentMethods = async (req, res) => {
    try {
        const { profileId } = req.params;
        const [paymentMethods] = await pool.execute(
            'SELECT * FROM payment_methods WHERE profile_id = ?',
            [profileId]
        );
        res.json({ paymentMehods: paymentMethods });
    } catch (error) {
        console.error('GetPaymentMethods error:', error);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
};

/**
 * @desc    Get sale types by profile_id
 * @route   GET /api/pos/sale-types/:profileId
 */
const getSaleTypes = async (req, res) => {
    try {
        const { profileId } = req.params;
        const [saleTypes] = await pool.execute(
            'SELECT * FROM sale_types WHERE profile_id = ?',
            [profileId]
        );
        res.json({ status: 'success', data: saleTypes });
    } catch (error) {
        console.error('GetSaleTypes error:', error);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
};

/**
 * @desc    Get tags by profile_id
 * @route   GET /api/pos/tags/:profileId
 */
const getTags = async (req, res) => {
    try {
        const { profileId } = req.params;
        if (!profileId) return res.json({ status: 'error' });
        const [data] = await pool.execute(
            'SELECT * FROM tags WHERE profile_id = ?',
            [profileId]
        );
        res.json({ status: 'success', data });
    } catch (error) {
        console.error('GetTags error:', error);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
};

/**
 * @desc    Get reasons by profile_id and type
 * @route   GET /api/pos/reasons/:profileId/:type
 */
const getReasons = async (req, res) => {
    try {
        const { profileId, type } = req.params;
        if (!profileId) return res.json({ status: 'error' });
        const [data] = await pool.execute(
            'SELECT * FROM tags WHERE profile_id = ? AND type = ?',
            [profileId, type]
        );
        res.json({ status: 'success', data });
    } catch (error) {
        console.error('GetReasons error:', error);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
};

/**
 * @desc    Get delete check reasons (type=4)
 * @route   GET /api/pos/delete-check-reasons/:profileId
 */
const getDeleteCheckReasons = async (req, res) => {
    try {
        const { profileId } = req.params;
        if (!profileId) return res.json({ status: 'error' });
        const [data] = await pool.execute(
            "SELECT * FROM tags WHERE profile_id = ? AND type = '4'",
            [profileId]
        );
        res.json({ status: 'success', data });
    } catch (error) {
        console.error('GetDeleteCheckReasons error:', error);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
};

/**
 * @desc    Get return check reasons (type=5)
 * @route   GET /api/pos/return-check-reasons/:profileId
 */
const getReturnCheckReasons = async (req, res) => {
    try {
        const { profileId } = req.params;
        if (!profileId) return res.json({ status: 'error' });
        const [data] = await pool.execute(
            "SELECT * FROM tags WHERE profile_id = ? AND type = '5'",
            [profileId]
        );
        res.json({ status: 'success', data });
    } catch (error) {
        console.error('GetReturnCheckReasons error:', error);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
};

/**
 * @desc    Get table groups with tables (nested)
 * @route   GET /api/pos/table-groups/:profileId
 */
const getTableGroups = async (req, res) => {
    try {
        const { profileId } = req.params;
        if (!profileId) return res.json({ status: 'error' });

        const [data] = await pool.execute(`
            SELECT tg.id as hall_id, tg.name as hall_name, t.id as table_id, t.name as table_name, t.deposit 
            FROM table_groups tg 
            LEFT JOIN tables t ON t.hall_id = tg.id 
            WHERE t.is_active = 1 AND tg.profile_id = ?
        `, [profileId]);

        const tablesMap = {};
        for (const row of data) {
            const hallId = row.hall_id;
            const tableId = row.table_id;

            if (!tablesMap[hallId]) {
                tablesMap[hallId] = {
                    id: hallId,
                    name: row.hall_name,
                    tables: {}
                };
            }

            if (tableId && !tablesMap[hallId].tables[tableId]) {
                tablesMap[hallId].tables[tableId] = {
                    id: tableId,
                    name: row.table_name,
                    deposit: row.deposit
                };
            }
        }

        const tables = Object.values(tablesMap).map(item => ({
            ...item,
            tables: Object.values(item.tables)
        }));

        res.json({ status: 'SUCCESS', data: tables });
    } catch (error) {
        console.error('GetTableGroups error:', error);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
};

/**
 * @desc    Get tables by profile_id
 * @route   GET /api/pos/tables/:profileId
 */
const getTables = async (req, res) => {
    try {
        const { profileId } = req.params;
        const [data] = await pool.execute(
            "SELECT * FROM tables WHERE profile_id = ? AND is_active = '1' ORDER BY ordering DESC",
            [profileId]
        );
        res.json({ data });
    } catch (error) {
        console.error('GetTables error:', error);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
};

/**
 * @desc    Get waiters list by profile_id
 * @route   GET /api/pos/waiters/:profileId
 */
const getWaitersList = async (req, res) => {
    try {
        const { profileId } = req.params;
        const [data] = await pool.execute(
            'SELECT * FROM waiters WHERE profile_id = ?',
            [profileId]
        );
        res.json({ waiters: data });
    } catch (error) {
        console.error('GetWaitersList error:', error);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
};

/**
 * @desc    Waiter auth by PIN
 * @route   POST /api/pos/waiters-auth
 */
const waitersAuth = async (req, res) => {
    try {
        const { pin, profileId } = req.body;

        if (!pin) {
            return res.json({ status: 'false', message: 'Pin is empty' });
        }

        const [waiter] = await pool.execute(
            'SELECT * FROM waiters WHERE pin = ? AND profile_id = ?',
            [pin, profileId]
        );

        if (waiter.length > 0) {
            res.json({ status: 'true', waiterInfo: waiter });
        } else {
            res.json({ status: 'false', message: 'Pin is false' });
        }
    } catch (error) {
        console.error('WaitersAuth error:', error);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
};

/**
 * @desc    Get profile (terminal login)
 * @route   POST /api/pos/profile
 */
const getProfile = async (req, res) => {
    try {
        const { restaurantName, terminalPassword, terminalId } = req.body;

        if (!restaurantName) {
            res.locals.loginFailed = true;
            return res.json({ status: 'false', messages: 'Restaurant Not Found' });
        }

        const [profiles] = await pool.execute(`
            SELECT p.*, p.id AS profile_id, p.restaurant_name AS restaurant_name, 
                   tg.terminal_id AS terminal_id, tg.terminal_password AS terminal_password, tg.is_master AS is_master
            FROM profiles p
            LEFT JOIN terminal_groups tg ON p.id = tg.profile_id
            WHERE p.username = ? AND tg.terminal_id = ?
        `, [restaurantName, terminalId]);

        const profile = profiles[0] || null;

        if (profile && terminalPassword == profile.terminal_password) {
            res.json({
                status: 'true',
                profileID: profile.profile_id,
                terminal: profile.terminal_id,
                filial: profile.restaurant_name,
                logoPrint: null, // Base64 conversion skipped for now
                data: profile
            });
        } else {
            res.locals.loginFailed = true; // terminalLoginLimiter bunu uğursuz cəhd sayır
            res.json({ status: 'false', messages: 'Uncorrect Password!' });
        }
    } catch (error) {
        console.error('GetProfile error:', error);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
};

/**
 * @desc    Get terminals list
 * @route   POST /api/pos/terminals
 */
const getTerminalsList = async (req, res) => {
    try {
        const { profileId } = req.body;
        if (!profileId) {
            return res.json({ status: 'error' });
        }
        const [terminalRows] = await pool.execute(
            'SELECT * FROM terminal_groups WHERE profile_id = ?',
            [profileId]
        );
        // Terminal şifrələri cavaba düşmür
        const terminalList = terminalRows.map(({ terminal_password, ...terminal }) => terminal);
        res.json({ status: 'success', data: terminalList });
    } catch (error) {
        console.error('GetTerminalsList error:', error);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
};

/**
 * @desc    Get without paid method (tags by type)
 * @route   POST /api/pos/without-paid-method
 */
const getWithoutPaidMethod = async (req, res) => {
    try {
        const { profileId, status: type } = req.body;

        if (!profileId) {
            return res.json({ status: 'false', message: 'Data is empty' });
        }

        const [data] = await pool.execute(
            'SELECT * FROM tags WHERE type = ? AND profile_id = ?',
            [type, profileId]
        );

        if (data.length > 0) {
            res.json({ status: 'true', response: data });
        } else {
            res.json({ status: 'false', message: 'false' });
        }
    } catch (error) {
        console.error('GetWithoutPaidMethod error:', error);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
};

/**
 * @desc    Get all active orders
 * @route   POST /api/pos/active-orders
 */
const getAllActiveOrders = async (req, res) => {
    try {
        const { profileId } = req.body;
        if (!profileId) {
            return res.json({ status: 'error' });
        }

        const [orders] = await pool.execute(`
            SELECT o.*, h.name as hall, t.name as table_name 
            FROM orders o 
            LEFT JOIN table_groups h ON o.hall_id = h.id
            LEFT JOIN tables t ON t.id = o.table_id
            WHERE o.status = 1 AND o.sale_type = 0 AND o.profile_id = ?
        `, [profileId]);

        res.json({ status: 'success', data: orders });
    } catch (error) {
        console.error('GetAllActiveOrders error:', error);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
};

/**
 * @desc    Get reviews by profile id
 * @route   GET /api/pos/reviews/:id
 */
const getReviews = async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) {
            return res.json({ status: 'error', message: 'ID parametri daxil edilməyib.' });
        }

        const [profileData] = await pool.execute(
            'SELECT username FROM profiles WHERE id = ?',
            [id]
        );

        if (profileData.length > 0) {
            const username = profileData[0].username;
            const [reviews] = await pool.execute(
                'SELECT * FROM reviews WHERE LOWER(business_name) = LOWER(?) ORDER BY created_at DESC',
                [username]
            );
            res.json({ status: 'success', data: reviews });
        } else {
            res.json({ status: 'error', message: 'Bu ID-yə uyğun restoran tapılmadı.' });
        }
    } catch (error) {
        console.error('GetReviews error:', error);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
};

/**
 * @desc    Create review
 * @route   POST /api/pos/reviews
 */
const createReview = async (req, res) => {
    try {
        const { business, rating, comment } = req.body;

        if (!business || !rating) {
            return res.status(400).json({
                status: 'error',
                message: 'Zəhmət olmasa bütün vacib xanaları doldurun.'
            });
        }

        await pool.execute(
            'INSERT INTO reviews (business_name, rating, comment) VALUES (?, ?, ?)',
            [business, rating, comment || '']
        );

        res.status(201).json({ status: 'success', message: 'Rəy uğurla əlavə edildi.' });
    } catch (error) {
        console.error('CreateReview error:', error);
        res.status(500).json({ status: 'error', message: 'Rəy əlavə edilərkən xəta baş verdi.' });
    }
};

/**
 * @desc    Get max checks by profile_id
 * @route   GET /api/pos/max-checks/:profileId
 */
const getMaxChecks = async (req, res) => {
    try {
        const { profileId } = req.params;
        const [data] = await pool.execute(
            'SELECT * FROM max_checks_list WHERE profile_id = ?',
            [profileId]
        );
        res.json({ status: 'success', data });
    } catch (error) {
        console.error('GetMaxChecks error:', error);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
};

/**
 * @desc    Update max_id for profile_id
 * @route   POST /api/pos/max-checks
 * @body    { profileId, maxId }
 */
const updateMaxChecks = async (req, res) => {
    try {
        const { profileId, maxId } = req.body;

        if (!profileId || maxId === undefined) {
            return res.json({ status: 'error', message: 'profileId and maxId are required.' });
        }

        // Check if record exists
        const [existing] = await pool.execute(
            'SELECT * FROM max_checks_list WHERE profile_id = ?',
            [profileId]
        );

        if (existing.length > 0) {
            await pool.execute(
                'UPDATE max_checks_list SET max_id = ? WHERE profile_id = ?',
                [maxId, profileId]
            );
        } else {
            await pool.execute(
                'INSERT INTO max_checks_list (profile_id, max_id) VALUES (?, ?)',
                [profileId, maxId]
            );
        }

        res.json({ status: 'success', message: 'max_id updated.', data: { profile_id: profileId, max_id: maxId } });
    } catch (error) {
        console.error('UpdateMaxChecks error:', error);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
};

module.exports = {
    getPrinters,
    getCashPrinters,
    getCategories,
    getGeneralCategories,
    getMenuList,
    getPaymentMethods,
    getSaleTypes,
    getTags,
    getReasons,
    getDeleteCheckReasons,
    getReturnCheckReasons,
    getTableGroups,
    getTables,
    getWaitersList,
    waitersAuth,
    getProfile,
    getTerminalsList,
    getWithoutPaidMethod,
    getAllActiveOrders,
    getReviews,
    createReview,
    getMaxChecks,
    updateMaxChecks,
    getLegacyImage,
    // Otel portalı (hotel.controller.js) eyni şəkil qaydası ilə tam URL qaytarır
    toImageValue
};
