const crypto = require('crypto');
const { pool } = require('../config/database');
const { verifyTableToken, guestTokenFor } = require('../utils/tableToken');
const { verifyQrUserToken, QrSessionError } = require('../utils/qrUserToken');

/**
 * QR-dan masa sifarişi (bax: unipos-new-superadmin/docs/QR_ORDER_SOCKET_PLAN.md).
 *
 * Qonaq → POST /api/qr-orders → `qr_orders` (pending) → socket `/pos` →
 * restoranın master kassası → `qr:order:status` → qonağın `order:{uuid}` otağı.
 *
 * Sifariş YALNIZ masa QR-ı ilə verilir (imzalı token) — adi menyudan
 * (`qr.unipos.tech/<restoran>`) sifariş yoxdur. Rejim restoranın icazəsindən:
 *   manual — POS bildirişlərinə düşür, ofisiant təsdiqləyib masaya əlavə edir
 *   direct — birbaşa həmin masaya düşür
 * QR menyu hesabı ilə daxil olmuş qonağın məlumatı (`customer`) istəyə bağlıdır.
 *
 * Otaqlar (heç vaxt `emit` hamıya getmir):
 *   restaurant:{profileId}         — restoranın bütün kassaları
 *   restaurant:{profileId}:master  — sifarişi qəbul edən kassa
 *   order:{orderUuid}              — sifarişi verən qonaq
 */

const STATUS = {
    PENDING: 'pending',     // yaradılıb, kassa hələ ack verməyib
    DELIVERED: 'delivered', // kassa aldı (ack), təsdiq / yazılma gözlənilir
    ACCEPTED: 'accepted',   // kassanın bazasına yazıldı
    REJECTED: 'rejected',   // ofisiant rədd etdi
    FAILED: 'failed',       // kassa yaza bilmədi
    EXPIRED: 'expired',     // kassa vaxtında qoşulmadı
};
const FINAL_STATUSES = new Set([STATUS.ACCEPTED, STATUS.REJECTED, STATUS.FAILED, STATUS.EXPIRED]);

const PENDING_TTL_MINUTES = 15;
const ACK_TIMEOUT_MS = 10000;
const ORDER_LIMIT = { count: 5, minutes: 10 }; // bir masadan 10 dəqiqədə ən çox 5 sifariş

const MAX_LINES = 50;
const MAX_QUANTITY = 99;
const MAX_MODIFIER_COUNT = 20;
const MAX_TEXT = 200;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const restaurantRoom = (profileId) => `restaurant:${profileId}`;
const masterRoom = (profileId) => `restaurant:${profileId}:master`;
const orderRoom = (orderUuid) => `order:${orderUuid}`;

let posNsp = null;
let guestNsp = null;
const attachNamespaces = ({ pos, guest }) => {
    posNsp = pos;
    guestNsp = guest;
};

class QrOrderError extends Error {
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

const money = (value) => Math.round(Number(value || 0) * 100) / 100;
const cleanText = (value) => {
    const text = String(value ?? '').trim().slice(0, MAX_TEXT);
    return text || null;
};
const parsePayload = (value) => (typeof value === 'string' ? JSON.parse(value) : value);

/* ==================================================
   RESTORAN / MASA
================================================== */

/**
 * `is_qr_order_*` sütunlarını superadmin panel əlavə edir. Hələ əlavə olunmayıbsa
 * `SELECT *` xəta vermir, sadəcə sahə olmur — sifariş bağlı sayılır.
 *
 * İkisi də 1-dirsə `manual` üstündür — POS da belə seçir (kassirin nəzarəti qalsın).
 */
const qrOrderMode = (profile) => {
    if (Number(profile?.is_qr_order_manual) === 1) return 'manual';
    if (Number(profile?.is_qr_order_direct) === 1) return 'direct';
    return null;
};

const getProfile = async (profileId) => {
    const [rows] = await pool.execute('SELECT * FROM profiles WHERE id = ? LIMIT 1', [profileId]);
    return rows[0] || null;
};

/**
 * QR menyu hesabı (`Authorization: Bearer <qr_user token>`, bax: qr_auth.controller).
 * Token yoxdursa / etibarsızdırsa `null` — masa sifarişi üçün hesab məcburi deyil.
 */
const resolveCustomer = async (authHeader) => {
    const match = /^Bearer\s+(.+)$/i.exec(String(authHeader || ''));
    if (!match) return null;
    let user;
    try {
        // Şifrə dəyişəndən sonra köhnə token (digər cihaz) burada da keçmir
        ({ user } = await verifyQrUserToken(match[1]));
    } catch (error) {
        if (error instanceof QrSessionError) return null;
        throw error;
    }
    return { id: Number(user.id), name: user.ad, surname: user.soyad, phone: user.nomre };
};

/** QR tokenindən masanı tapır. Masa başqa zala köçürülübsə, cari zal götürülür. */
const resolveTable = async (token, username) => {
    let ids;
    try {
        ids = verifyTableToken(token);
    } catch (err) {
        if (err.code === 'QR_SECRET_MISSING') throw new QrOrderError(503, 'qr_not_configured', 'QR sifarişi hələ qurulmayıb.');
        throw err;
    }
    if (!ids) throw new QrOrderError(400, 'invalid_table', 'QR kod etibarsızdır.');

    const profile = await getProfile(ids.profileId);
    if (!profile) throw new QrOrderError(404, 'invalid_table', 'QR kod etibarsızdır.');
    if (username && String(profile.username || '').toLowerCase() !== String(username).toLowerCase()) {
        throw new QrOrderError(404, 'invalid_table', 'QR kod bu restorana aid deyil.');
    }

    const [tables] = await pool.execute(
        'SELECT id, name, hall_id FROM tables WHERE id = ? AND profile_id = ? AND is_active = 1 LIMIT 1',
        [ids.tableId, profile.id]
    );
    const table = tables[0];
    if (!table) throw new QrOrderError(404, 'table_not_found', 'Masa tapılmadı və ya aktiv deyil.');

    let hall = { id: 0, name: null };
    if (Number(table.hall_id)) {
        const [halls] = await pool.execute(
            'SELECT id, name FROM table_groups WHERE id = ? AND profile_id = ? LIMIT 1',
            [table.hall_id, profile.id]
        );
        if (halls[0]) hall = { id: Number(halls[0].id), name: halls[0].name };
    }

    return { profile, table: { id: Number(table.id), name: table.name }, hall };
};

const isRestaurantOnline = async (profileId) => {
    if (!posNsp) return false;
    const sockets = await posNsp.in(masterRoom(profileId)).fetchSockets();
    return sockets.length > 0;
};

/** QR menyu masa səhifəsi üçün: masa, zal, rejim, restoran onlayndırmı */
const describeTable = async ({ token, username }) => {
    const { profile, table, hall } = await resolveTable(token, username);
    return {
        restaurant: { id: profile.id, username: profile.username, name: profile.restaurant_name },
        table,
        hall,
        mode: qrOrderMode(profile),
        online: await isRestaurantOnline(profile.id),
    };
};

/* ==================================================
   SƏBƏT → SİFARİŞ (qiymətlər serverdə hesablanır)
================================================== */

const normalizeLines = (items) => {
    if (!Array.isArray(items) || items.length === 0) {
        throw new QrOrderError(400, 'empty_cart', 'Səbət boşdur.');
    }
    if (items.length > MAX_LINES) {
        throw new QrOrderError(400, 'too_many_items', `Bir sifarişdə ən çox ${MAX_LINES} sətir ola bilər.`);
    }
    return items.map((raw) => {
        const productId = Number.parseInt(raw?.productId ?? raw?.product_id, 10);
        const quantity = Number.parseInt(raw?.quantity ?? 1, 10);
        if (!Number.isInteger(productId) || productId <= 0) {
            throw new QrOrderError(400, 'invalid_item', 'Məhsul düzgün deyil.');
        }
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
            throw new QrOrderError(400, 'invalid_quantity', `Say 1 ilə ${MAX_QUANTITY} arasında olmalıdır.`);
        }
        const modifiers = Array.isArray(raw?.modifiers) ? raw.modifiers : [];
        const modifierCounts = new Map();
        modifiers.forEach((m) => {
            const id = Number.parseInt(m?.id, 10);
            const count = Number.parseInt(m?.count ?? 1, 10);
            if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(count) || count < 1 || count > MAX_MODIFIER_COUNT) {
                throw new QrOrderError(400, 'invalid_modifier', 'Əlavə seçim düzgün deyil.');
            }
            modifierCounts.set(id, (modifierCounts.get(id) || 0) + count);
        });
        return { productId, quantity, comment: cleanText(raw?.comment), modifierCounts };
    });
};

const buildOrderItems = async (profileId, lines) => {
    const productIds = [...new Set(lines.map((l) => l.productId))];
    const [products] = await pool.query(
        `SELECT p.id, p.name, p.price, p.product_type, p.is_hidden_qr, c.is_hidden_qr AS category_hidden_qr
           FROM products p
           LEFT JOIN categories c ON c.id = p.category_id
          WHERE p.profile_id = ? AND p.id IN (?)`,
        [profileId, productIds]
    );
    const productById = new Map(products.map((p) => [Number(p.id), p]));

    const [groups] = await pool.query(
        'SELECT id, product_id, name, selection_type, is_required, max_selections FROM product_modifiergroups WHERE profile_id = ? AND product_id IN (?)',
        [profileId, productIds]
    );
    let modifierItems = [];
    if (groups.length) {
        [modifierItems] = await pool.query(
            'SELECT id, modifier_group_id, name, price FROM product_modifieritems WHERE modifier_group_id IN (?)',
            [groups.map((g) => g.id)]
        );
    }

    return lines.map((line) => {
        const product = productById.get(line.productId);
        if (!product || Number(product.is_hidden_qr) === 1 || Number(product.category_hidden_qr) === 1) {
            throw new QrOrderError(400, 'product_unavailable', 'Səbətdəki məhsullardan biri artıq menyuda yoxdur.');
        }
        if (product.product_type === 'timer') {
            throw new QrOrderError(400, 'product_unavailable', `"${product.name}" QR-dan sifariş edilə bilməz.`);
        }

        const productGroups = groups.filter((g) => Number(g.product_id) === line.productId);
        const modifiers = [];
        productGroups.forEach((group) => {
            const options = modifierItems.filter((i) => Number(i.modifier_group_id) === Number(group.id));
            const chosen = options.filter((o) => line.modifierCounts.has(Number(o.id)));
            if (Number(group.is_required) === 1 && chosen.length === 0) {
                throw new QrOrderError(400, 'modifier_required', `"${product.name}" üçün "${group.name}" seçilməlidir.`);
            }
            // POS-un ModifierModal qaydası: tək seçimdə yalnız bir variant (sayı
            // artırıla bilər); çoxlu seçimdə max_selections ÜMUMİ sayı məhdudlaşdırır.
            if (group.selection_type === 'single' && chosen.length > 1) {
                throw new QrOrderError(400, 'modifier_limit', `"${group.name}" üçün yalnız bir variant seçmək olar.`);
            }
            const limit = group.selection_type === 'single' ? 0 : Number(group.max_selections) || 0;
            const chosenCount = chosen.reduce((sum, o) => sum + line.modifierCounts.get(Number(o.id)), 0);
            if (limit > 0 && chosenCount > limit) {
                throw new QrOrderError(400, 'modifier_limit', `"${group.name}" üçün ən çox ${limit} seçim etmək olar.`);
            }
            chosen.forEach((o) => {
                modifiers.push({
                    id: Number(o.id),
                    name: o.name,
                    price: money(o.price),
                    count: line.modifierCounts.get(Number(o.id)),
                });
            });
        });
        if (modifiers.length !== line.modifierCounts.size) {
            throw new QrOrderError(400, 'invalid_modifier', `"${product.name}" üçün seçilən əlavə tapılmadı.`);
        }

        const unitPrice = money(product.price);
        const modifiersTotal = modifiers.reduce((sum, m) => sum + m.price * m.count, 0);
        return {
            product_id: Number(product.id),
            name: product.name,
            quantity: line.quantity,
            price: unitPrice,
            comment: line.comment,
            portion_name: null,
            modifiers,
            line_total: money(line.quantity * (unitPrice + modifiersTotal)),
        };
    });
};

/* ==================================================
   SİFARİŞ
================================================== */

const toPublicOrder = (row) => ({
    orderUuid: row.uuid,
    status: row.status,
    reason: row.reason || null,
    checkId: row.check_id ? Number(row.check_id) : null,
    total: money(row.total),
    createdAt: row.created_at,
});

const findOrder = async (orderUuid) => {
    const [rows] = await pool.execute('SELECT * FROM qr_orders WHERE uuid = ? LIMIT 1', [orderUuid]);
    return rows[0] || null;
};

/**
 * Qonağın sifarişini yoxlayır, qiymətləri bazadan hesablayır, `qr_orders`-ə yazır
 * və kassaya göndərir. Kassanın cavabını gözləmir — status socket ilə gəlir.
 */
const createOrder = async ({ body, ip, authHeader }) => {
    if (!body?.token) {
        throw new QrOrderError(400, 'table_required', 'Sifariş vermək üçün masadakı QR kodu skan edin.');
    }
    const { profile, table, hall } = await resolveTable(body.token, body.r);
    const mode = qrOrderMode(profile);
    if (!mode) throw new QrOrderError(403, 'qr_order_disabled', 'Bu restoranda QR-dan sifariş aktiv deyil.');
    const customer = await resolveCustomer(authHeader);

    if (Number(profile.is_menu_block) === 1) throw new QrOrderError(403, 'menu_blocked', 'Menyu hazırda bağlıdır.');

    // Təkrar göndəriş (iki dəfə basılma, şəbəkə kəsilməsi) eyni uuid ilə gəlir
    const requestedUuid = typeof body?.orderUuid === 'string' && UUID_RE.test(body.orderUuid)
        ? body.orderUuid.toLowerCase()
        : null;
    if (requestedUuid) {
        const existing = await findOrder(requestedUuid);
        if (existing) {
            if (Number(existing.profile_id) !== Number(profile.id) || Number(existing.table_id) !== table.id) {
                throw new QrOrderError(409, 'duplicate_order', 'Sifariş artıq mövcuddur.');
            }
            return { order: toPublicOrder(existing), guestToken: guestTokenFor(existing.uuid), created: false };
        }
    }

    if (!(await isRestaurantOnline(profile.id))) {
        throw new QrOrderError(409, 'restaurant_offline', 'Restoran hazırda onlayn sifariş qəbul etmir. Ofisianta müraciət edin.');
    }

    const [[recent]] = await pool.execute(
        `SELECT COUNT(*) AS n FROM qr_orders
          WHERE profile_id = ? AND table_id = ?
            AND created_at >= NOW() - INTERVAL ${ORDER_LIMIT.minutes} MINUTE`,
        [profile.id, table.id]
    );
    if (Number(recent.n) >= ORDER_LIMIT.count) {
        throw new QrOrderError(429, 'too_many_orders', 'Bu masadan çox sifariş göndərildi. Bir az sonra yenidən cəhd edin.');
    }

    const items = await buildOrderItems(profile.id, normalizeLines(body?.items));
    const total = money(items.reduce((sum, i) => sum + i.line_total, 0));
    const guestCount = Number.parseInt(body?.guestCount, 10);
    const orderUuid = requestedUuid || crypto.randomUUID();

    const payload = {
        v: 1,
        orderUuid,
        orderType: 'table',
        mode,
        profileId: Number(profile.id),
        hallId: hall.id,
        hallName: hall.name,
        tableId: table.id,
        tableName: table.name,
        customer,
        guestCount: Number.isInteger(guestCount) && guestCount > 0 && guestCount < 100 ? guestCount : null,
        note: cleanText(body?.note),
        createdAt: new Date().toISOString(),
        items,
        total,
    };

    await pool.execute(
        `INSERT INTO qr_orders (uuid, profile_id, hall_id, table_id, customer_id, mode, status, payload, total, guest_ip)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [orderUuid, profile.id, hall.id, table.id, customer ? customer.id : null, mode,
            STATUS.PENDING, JSON.stringify(payload), total, ip || null]
    );

    const row = await findOrder(orderUuid);
    deliverOrder(row).catch((err) => console.error('QR order deliver error:', err));
    return { order: toPublicOrder(row), guestToken: guestTokenFor(orderUuid), created: true };
};

const notifyGuest = (row) => {
    if (guestNsp) guestNsp.to(orderRoom(row.uuid)).emit('qr:order:status', toPublicOrder(row));
};

/**
 * Sifarişi restoranın master kassasına göndərir. Otaqda bir neçə kassa olsa da
 * YALNIZ birinə gedir — eyni sifarişi iki kassa yazmasın. Ack gəlməsə sifariş
 * `pending` qalır və kassa yenidən qoşulanda təkrar göndərilir (eyni uuid).
 */
const deliverOrder = async (row) => {
    if (!posNsp || !row || row.status !== STATUS.PENDING) return false;
    const [target] = await posNsp.in(masterRoom(row.profile_id)).fetchSockets();
    if (!target) return false;

    const socket = posNsp.sockets.get(target.id);
    if (!socket) return false;

    let response;
    try {
        response = await socket.timeout(ACK_TIMEOUT_MS).emitWithAck('qr:order:new', parsePayload(row.payload));
    } catch {
        return false; // ack gəlmədi — pending qalır
    }
    if (!response || response.ok !== true) return false;

    const [result] = await pool.execute(
        'UPDATE qr_orders SET status = ?, delivered_at = NOW() WHERE uuid = ? AND status = ?',
        [STATUS.DELIVERED, row.uuid, STATUS.PENDING]
    );
    if (result.affectedRows) notifyGuest(await findOrder(row.uuid));
    return true;
};

/** Kassa qoşulanda: vaxtı keçməmiş, hələ çatdırılmamış sifarişləri göndərir */
const flushPending = async (profileId) => {
    const [rows] = await pool.execute(
        `SELECT * FROM qr_orders
          WHERE profile_id = ? AND status = ? AND created_at >= NOW() - INTERVAL ${PENDING_TTL_MINUTES} MINUTE
          ORDER BY id ASC`,
        [profileId, STATUS.PENDING]
    );
    for (const row of rows) {
        // eslint-disable-next-line no-await-in-loop
        if (!(await deliverOrder(row))) break; // kassa cavab vermirsə, qalanları sonrakı qoşulmaya
    }
};

/** Kassadan gələn `qr:order:status` */
const applyPosStatus = async (profileId, data) => {
    const orderUuid = String(data?.orderUuid || '').toLowerCase();
    const status = data?.status;
    if (![STATUS.ACCEPTED, STATUS.REJECTED, STATUS.FAILED].includes(status)) {
        return { ok: false, error: 'invalid_status' };
    }

    const row = await findOrder(orderUuid);
    // Başqa restoranın sifarişi bu kassa üçün "yoxdur"
    if (!row || Number(row.profile_id) !== Number(profileId)) return { ok: false, error: 'order_not_found' };
    if (FINAL_STATUSES.has(row.status)) {
        return row.status === status ? { ok: true } : { ok: false, error: 'already_final', status: row.status };
    }

    const checkId = Number.parseInt(data?.checkId, 10);
    await pool.execute(
        `UPDATE qr_orders SET status = ?, reason = ?, check_id = ?, resolved_at = NOW(),
                delivered_at = COALESCE(delivered_at, NOW())
          WHERE uuid = ?`,
        [status, cleanText(data?.reason), Number.isInteger(checkId) ? checkId : null, row.uuid]
    );
    notifyGuest(await findOrder(row.uuid));
    return { ok: true };
};

/** Vaxtında kassaya çatmayan sifarişlər — qonağa bildirilir */
const expirePending = async () => {
    const [rows] = await pool.execute(
        `SELECT uuid FROM qr_orders
          WHERE status = ? AND created_at < NOW() - INTERVAL ${PENDING_TTL_MINUTES} MINUTE`,
        [STATUS.PENDING]
    );
    for (const { uuid } of rows) {
        // eslint-disable-next-line no-await-in-loop
        const [result] = await pool.execute(
            'UPDATE qr_orders SET status = ?, reason = ?, resolved_at = NOW() WHERE uuid = ? AND status = ?',
            [STATUS.EXPIRED, 'Restoran sifarişi vaxtında qəbul etmədi', uuid, STATUS.PENDING]
        );
        // eslint-disable-next-line no-await-in-loop
        if (result.affectedRows) notifyGuest(await findOrder(uuid));
    }
};

const getOrderForGuest = async (orderUuid) => {
    const row = await findOrder(String(orderUuid || '').toLowerCase());
    return row ? toPublicOrder(row) : null;
};

module.exports = {
    STATUS,
    QrOrderError,
    attachNamespaces,
    restaurantRoom,
    masterRoom,
    orderRoom,
    describeTable,
    createOrder,
    flushPending,
    applyPosStatus,
    expirePending,
    getOrderForGuest,
};
