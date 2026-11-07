const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');

/**
 * Vahid müştəri hesabı — QR menyu + loyallıq (mobil tətbiq, client.unipos.tech).
 *
 * Bir telefon nömrəsi = bir hesab. Hesabın sahibi admin backend-in `customer_accounts` cədvəlidir
 * (api.unipos.tech, eyni baza; cədvəli o yaradır — `backend/index.js`, `services/loyalty/accounts.js`).
 * QR menyunun qeydiyyatı / girişi / şifrə bərpası / şifrə dəyişməsi artıq həmin cədvəllə işləyir,
 * ona görə eyni nömrə + şifrə QR menyuda, mobil tətbiqdə və client.unipos.tech-də keçir.
 *
 * `qr_users` GÜZGÜ kimi qalır: köhnə `qr_orders.customer_id` və QR JWT-si onun id-sini daşıyır.
 *   qr_users.account_id → customer_accounts.id (UNIQUE: bir hesaba bir güzgü)
 *   ad / soyad / nomre / sifre hər yazıda hesabla eyniləşdirilir.
 *
 * Restoranın müştəri bazası: qeydiyyat / giriş `restaurant` (URL-dəki istifadəçi adı) ilə gəlirsə həmin
 * filialda `customers` sətri təmin olunur — admin-in `accountFlow.joinVenue` məntiqi ilə (ensureCustomerAt).
 * Kart (loyallıq) olub-olmaması admin backend-in işidir; sətir modul açıq olmasa da yaradılır.
 *
 * Telefon formatı: `customer_accounts.phone_normalized` və `customers.phone_normalized` yalnız rəqəmlərdir
 * ("994501234567"), `qr_users.nomre` isə E.164-dür ("+994501234567"). normalizePhone admin-in
 * `utils/phone.js`-i ilə EYNİDİR — fərqli olsa eyni nömrə iki hesab sayılardı.
 */

const SOURCE = 'qr_menu';
const BCRYPT_RE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const USERNAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
// Admin: register.GENDER_TO_DB (hesabda m | f, customers-də mətn)
const GENDER_TO_DB = { m: 'Kişi', f: 'Qadın' };
const LOCK_TIMEOUT_SECONDS = 5;

/** Sxem vəziyyəti — init() doldurur. `accounts` false-dursa controller köhnə (qr_users) axınla işləyir */
const state = {
    accounts: false, // customer_accounts + qr_users.account_id var
    customers: false, // customers cədvəlinin lazımi sütunları var (müştəri bazası)
    sessions: false, // customer_web_sessions var (loyallıq veb sessiyaları)
    events: false, // ent_events var (audit)
    entMode: false, // profiles.is_entertainment_mode var
};

const isReady = () => state.accounts;

// ── Köməkçilər ───────────────────────────────────────────────────────────────

/** Admin `backend/utils/phone.js` → normalizePhone ilə hərfi-hərfinə eyni. @returns {string|null} */
function normalizePhone(raw) {
    if (raw === undefined || raw === null) return null;
    let digits = String(raw).replace(/\D+/g, '');
    if (!digits) return null;
    // Beynəlxalq prefiks «00994…» → «994…»
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.length === 10 && digits.startsWith('0')) digits = `994${digits.slice(1)}`;
    else if (digits.length === 9) digits = `994${digits}`;
    if (digits.length < 7 || digits.length > 20) return null;
    return digits;
}

const isBcryptHash = (v) => typeof v === 'string' && BCRYPT_RE.test(v);

/** Heç bir şifrəyə uyğun gəlməyən, amma formaca düzgün bcrypt heşi (şifrə yalnız bərpa ilə qoyulur) */
const unusableHash = () => bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 10);

const rows = async (db, sql, params = []) => (await db.query(sql, params))[0];
const one = async (db, sql, params = []) => (await rows(db, sql, params))[0] || null;

const isDup = (err) => err && err.code === 'ER_DUP_ENTRY';
const isNoTable = (err) => err && (err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_BAD_FIELD_ERROR');

// ── Üzv nömrəsi (admin services/loyalty/card.js ilə eyni alqoritm) ─────────────

/** Luhn yoxlama rəqəmi: `payload` (yoxlama rəqəmi olmadan) üçün sona əlavə ediləcək rəqəm */
function luhnCheckDigit(payload) {
    let sum = 0;
    for (let i = payload.length - 1, dbl = true; i >= 0; i--, dbl = !dbl) {
        let d = payload.charCodeAt(i) - 48;
        if (dbl) {
            d *= 2;
            if (d > 9) d -= 9;
        }
        sum += d;
    }
    return String((10 - (sum % 10)) % 10);
}

/** 12 rəqəm: ilk rəqəm 1–9, sonra 10 təsadüfi rəqəm, sonda Luhn (admin card.newCardNumber) */
function newCardNumber() {
    let payload = String(crypto.randomInt(1, 10));
    for (let i = 1; i < 11; i++) payload += String(crypto.randomInt(0, 10));
    return payload + luhnCheckDigit(payload);
}

// ── Sxem ─────────────────────────────────────────────────────────────────────

const columnsOf = async (table) => {
    const list = await rows(
        pool,
        'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
        [table]
    );
    return new Set(list.map((r) => r.COLUMN_NAME));
};

const hasAll = (set, names) => names.every((n) => set.has(n));

/**
 * Hansı hissələrin işləyə biləcəyini yoxlayır (server açılanda, qrSchema-dan sonra).
 * customer_accounts admin backend-indir — yoxdursa QR menyu köhnə qaydada (yalnız qr_users) işləyir.
 */
async function init() {
    const [acc, qr, cust, sess, ev, prof] = await Promise.all(
        ['customer_accounts', 'qr_users', 'customers', 'customer_web_sessions', 'ent_events', 'profiles'].map(columnsOf)
    );
    state.accounts =
        hasAll(acc, ['id', 'phone_normalized', 'first_name', 'last_name', 'password_hash', 'sms_consent', 'phone_verified_at']) &&
        qr.has('account_id');
    state.customers = hasAll(cust, [
        'profile_id', 'name', 'phone', 'phone_normalized', 'sms_consent', 'sms_consent_at', 'sms_consent_source',
        'card_token', 'card_number', 'web_password_hash', 'web_password_set_at', 'phone_verified_at', 'guardian_name',
    ]);
    state.sessions = hasAll(sess, ['phone_normalized', 'customer_ids', 'revoked_at']);
    state.events = ev.size > 0;
    state.entMode = prof.has('is_entertainment_mode');
    return { ...state };
}

// ── Hesab (customer_accounts) ────────────────────────────────────────────────

async function accountByPhone(db, norm, { forUpdate = false } = {}) {
    if (!norm) return null;
    return one(db, `SELECT * FROM customer_accounts WHERE phone_normalized = ? LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`, [norm]);
}

async function accountById(db, id) {
    if (!id) return null;
    return one(db, 'SELECT * FROM customer_accounts WHERE id = ? LIMIT 1', [id]);
}

/**
 * Yeni hesab (admin accounts.create ilə eyni sütunlar). Nömrə UNIQUE-dir — dublikatda ER_DUP_ENTRY atılır.
 * @param verifiedAt 'now' — indi təsdiqlənib (OTP); Date/mətn — köçürülən vaxt; null — təsdiqsiz
 * @returns {Promise<object>} yaradılan sətir
 */
async function createAccount(db, { phone, firstName, lastName, passwordHash, verifiedAt = null, smsConsent = false }) {
    const verifiedSql = verifiedAt === 'now' ? 'UTC_TIMESTAMP()' : '?';
    const params = [phone, String(firstName || '').trim().slice(0, 60), String(lastName || '').trim().slice(0, 60), passwordHash, smsConsent ? 1 : 0];
    if (verifiedAt !== 'now') params.push(verifiedAt || null);
    const [res] = await db.query(
        `INSERT INTO customer_accounts (phone_normalized, first_name, last_name, birth_date, gender, email, password_hash,
                                        sms_consent, phone_verified_at, created_at, updated_at)
         VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?, ${verifiedSql}, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
        params
    );
    return accountById(db, res.insertId);
}

// ── Güzgü (qr_users) ─────────────────────────────────────────────────────────

const QR_COLS = 'id, ad, soyad, nomre, sifre, phone_verified_at, token_version, account_id';

const qrUserById = (db, id) => one(db, `SELECT ${QR_COLS} FROM qr_users WHERE id = ? LIMIT 1`, [id]);
const qrUserByNomre = (db, nomre) => one(db, `SELECT ${QR_COLS} FROM qr_users WHERE nomre = ? LIMIT 1`, [nomre]);
const mirrorOf = (db, accountId) => one(db, `SELECT ${QR_COLS} FROM qr_users WHERE account_id = ? LIMIT 1`, [accountId]);

/** Hələ hesaba bağlanmamış (köçürülməmiş) köhnə QR hesabı — nömrə ilə */
async function unlinkedQrUser(db, nomre) {
    const u = await qrUserByNomre(db, nomre);
    return u && u.account_id == null ? u : null;
}

/**
 * Hesabın güzgüsü — yoxdursa yaradılır, varsa hesabla eyniləşdirilir (ad, soyad, nomre, sifre).
 *
 * Şifrə başqa yerdə (mobil tətbiq, client.unipos.tech) dəyişibsə güzgünün `sifre`-si köhnədir: eyniləşdirəndə
 * `token_version` artırılır — həmin hesabın köhnə QR tokenləri (digər cihazlar) bitir, bu giriş yeni token alır.
 *
 * @param {string} nomre E.164 — sorğudakı nömrə (yeni güzgü bununla yaradılır)
 * @returns {Promise<object>} güzgü sətri (QR_COLS)
 */
async function ensureMirror(db, account, nomre) {
    // Paralel ilk girişlər (eyni hesab, bir neçə sorğu) — UNIQUE (account_id, nomre) toqquşmasında yenidən oxunur
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const m = await findOrCreateMirror(db, account, nomre);
            return syncMirror(db, m, account);
        } catch (err) {
            if (!isDup(err) || attempt === 2) throw err;
        }
    }
    return null;
}

async function findOrCreateMirror(db, account, nomre) {
    const m = await mirrorOf(db, account.id);
    if (m) return m;
    const byPhone = await qrUserByNomre(db, nomre);
    if (byPhone && byPhone.account_id == null) {
        // Köçürülməmiş köhnə QR hesabı — eyni nömrə, eyni şəxs: bağlanır (çağıran əvvəlcə migrateQrUser edir)
        const [res] = await db.query('UPDATE qr_users SET account_id = ? WHERE id = ? AND account_id IS NULL', [account.id, byPhone.id]);
        if (res.affectedRows === 1) return { ...byPhone, account_id: account.id };
        throw Object.assign(new Error('qr_users sətri eyni anda bağlandı'), { code: 'ER_DUP_ENTRY' });
    }
    if (byPhone) {
        const owner = await accountById(db, byPhone.account_id);
        // Hesabı silinib — köhnə sifarişlər yeni hesaba keçməsin, sətir anonimləşir, nömrə boşalır.
        // Başqa canlı hesabındır (onun nömrəsi tətbiqdə dəyişib) — güzgü onun yeni nömrəsinə keçir.
        if (!owner) await anonymizeOrphanMirror(db, byPhone);
        else await freeMirrorNomre(db, byPhone, owner);
    }
    const [res] = await db.query(
        'INSERT INTO qr_users (ad, soyad, nomre, sifre, phone_verified_at, account_id) VALUES (?, ?, ?, ?, ?, ?)',
        [
            String(account.first_name || '').slice(0, 100),
            String(account.last_name || '').slice(0, 100),
            nomre,
            account.password_hash,
            account.phone_verified_at || null,
            account.id,
        ]
    );
    return qrUserById(db, res.insertId);
}

/** Güzgünü hesabla eyniləşdirir (yalnız fərqlənən sahələr) */
async function syncMirror(db, m, account) {
    const set = [];
    const params = [];
    const first = String(account.first_name || '').trim();
    const last = String(account.last_name || '').trim();
    if (first && first !== m.ad) { set.push('ad = ?'); params.push(first.slice(0, 100)); }
    if (last && last !== m.soyad) { set.push('soyad = ?'); params.push(last.slice(0, 100)); }
    const passwordChanged = account.password_hash !== m.sifre;
    if (passwordChanged) {
        set.push('sifre = ?', 'token_version = token_version + 1');
        params.push(account.password_hash);
    }
    if (!m.phone_verified_at && account.phone_verified_at) { set.push('phone_verified_at = ?'); params.push(account.phone_verified_at); }
    if (set.length) await db.query(`UPDATE qr_users SET ${set.join(', ')} WHERE id = ?`, [...params, m.id]);

    // Nömrə tətbiqdə dəyişibsə (customerAccount.changePhone) — ayrıca: UNIQUE toqquşması qalanını pozmasın.
    // Müqayisə normallaşdırılmış formada: normalizePhone 9 rəqəmli xarici nömrəyə «994» artırır, E.164 güzgü
    // nömrəsi isə olduğu kimi qalmalıdır
    const want = `+${account.phone_normalized}`;
    if (normalizePhone(m.nomre) !== account.phone_normalized && want.length <= 20) {
        try {
            await db.query('UPDATE qr_users SET nomre = ? WHERE id = ?', [want, m.id]);
        } catch (err) {
            if (!isDup(err)) throw err;
            console.warn(`⚠️  qr_users #${m.id}: nömrə ${want}-ə dəyişdirilmədi — başqa QR hesabında var`);
        }
    }
    return qrUserById(db, m.id);
}

/** Canlı hesabın köhnə nömrəli güzgüsü yeni nömrəsinə keçirilir — köhnə nömrə yeni qeydiyyat üçün boşalır */
async function freeMirrorNomre(db, mirror, owner) {
    const want = `+${owner.phone_normalized}`;
    // Nömrə hələ də həmin hesabındır (paralel ilk giriş) — çağıran yenidən oxuyur
    if (normalizePhone(mirror.nomre) === owner.phone_normalized) {
        throw Object.assign(new Error('qr_users nömrəsi canlı hesabındır'), { code: 'ER_DUP_ENTRY' });
    }
    await db.query('UPDATE qr_users SET nomre = ? WHERE id = ?', [want, mirror.id]);
}

/**
 * Hesabı silinmiş güzgü (account_id var, hesab yoxdur — tətbiqdə «Hesabı sil»). Nömrə eyni sahibin yeni qeydiyyatı
 * üçün boşaldılır: şəxsi məlumat silinir, köhnə tokenlər bitir. qr_orders.customer_id bu sətrə qalır (anonim).
 */
async function anonymizeOrphanMirror(db, mirror) {
    await db.query(
        `UPDATE qr_users SET ad = '', soyad = '', nomre = ?, sifre = ?, token_version = token_version + 1, account_id = NULL
          WHERE id = ?`,
        [`deleted-${mirror.id}`.slice(0, 20), '!', mirror.id]
    );
}

// ── Restoran və müştəri bazası (customers) ───────────────────────────────────

const PROFILE_COLS = () => `id${state.entMode ? ', is_entertainment_mode' : ''}`;

/**
 * URL-dəki restoran (`/[restaurant]`) → profil. `profiles.username` ilə (menyu ilə eyni müqayisə).
 * Tapılmasa və ya eyni adlı bir neçə profil varsa null — hesab yenə yaradılır, sadəcə müştəri bazasına düşmür.
 */
async function profileByUsername(username) {
    if (typeof username !== 'string' || !USERNAME_RE.test(username)) return null;
    const list = await rows(pool, `SELECT ${PROFILE_COLS()} FROM profiles WHERE username = ? LIMIT 2`, [username]);
    return list.length === 1 ? list[0] : null;
}

const profileById = (id) => one(pool, `SELECT ${PROFILE_COLS()} FROM profiles WHERE id = ? LIMIT 1`, [id]);

const FIND_COLS = 'id, phone, phone_normalized, web_password_hash';
// Admin families.js → PHONE_DIGITS_SQL
const PHONE_DIGITS_SQL =
    "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), '.', '')";

/**
 * Admin families.findByPhone ilə eyni: əvvəl phone_normalized, sonra (kassada köhnə formatda yazılmış) xam
 * nömrənin son 9 rəqəmi — tapılan köhnə sətirlərin phone_normalized-i yerində doldurulur.
 */
async function findCustomerByPhone(db, profileId, norm) {
    const row = await one(
        db,
        `SELECT ${FIND_COLS} FROM customers WHERE profile_id = ? AND phone_normalized = ? ORDER BY id ASC LIMIT 1`,
        [profileId, norm]
    );
    if (row) return row;
    const legacy = await rows(
        db,
        `SELECT ${FIND_COLS} FROM customers
          WHERE profile_id = ? AND phone_normalized IS NULL AND phone IS NOT NULL AND phone <> ''
            AND ${PHONE_DIGITS_SQL} LIKE ?
          ORDER BY id ASC LIMIT 20`,
        [profileId, `%${norm.slice(-9)}`]
    );
    let found = null;
    for (const c of legacy) {
        const n = normalizePhone(c.phone);
        if (n) await db.query('UPDATE customers SET phone_normalized = ? WHERE id = ?', [n, c.id]);
        if (n === norm && !found) found = { ...c, phone_normalized: n };
    }
    return found;
}

/** Admin entertainment/context.logEvent ilə eyni sətir (audit; cədvəl yoxdursa yazılmır) */
async function logEvent(db, { profileId, customerId, type, actorName, payload }) {
    if (!state.events) return;
    await db.query(
        `INSERT INTO ent_events (profile_id, visit_uuid, customer_id, order_uuid, type, actor_type, actor_id, actor_name, payload, occurred_at, created_at, updated_at)
         VALUES (?, NULL, ?, NULL, ?, 'customer', NULL, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
        [profileId, customerId, String(type).slice(0, 30), actorName ? String(actorName).slice(0, 120) : null, JSON.stringify(payload)]
    );
}

/**
 * Hesabın sahibi bu restoranın müştəri bazasında olsun — admin `accountFlow.joinVenue` ilə eyni məna:
 *
 *   • Həmin nömrə filialda artıq varsa (kassada yazılıb, əvvəl qoşulub) İKİNCİ SƏTİR YARANMIR. Mövcud sətrə
 *     yalnız şifrəsi yoxdursa hesabın şifrəsi qoyulur (sonrakı girişlər bu kartı da tapsın), heç nə üzərinə yazılmır.
 *     Bunu yalnız nömrəsi təsdiqlənmiş hesab edir — təsdiqsiz köhnə QR hesabı (nömrəni hər kəs yaza bilərdi)
 *     başqasının kassa kartına şifrə qoya bilməsin.
 *   • Yoxdursa admin families.createFamily + joinVenue-nun yazdığı sətir: ad soyad, telefon, e-poçt, doğum tarixi,
 *     cins, SMS razılığı (mənbə 'qr_menu'), kart nişanı + üzv nömrəsi (admin bunları ilk baxışda özü də yaradır —
 *     card.ensureCardIdentity), veb şifrəsi = hesabın şifrəsi; ent_events-ə family_created (+ consent_changed).
 *     Əyləncə filialında şəxsin adı həm də guardian_name-dədir (admin kimi).
 *
 * Kartın (loyallıq) görünüb-görünməməsi admin backend-in qərarıdır — sətir modul bağlı olsa da yaradılır.
 * Eyni filial + nömrə üçün paralel çağırışlar GET_LOCK ilə ardıcıl olur (dublikat sətir yaranmasın).
 *
 * @returns {Promise<{ id: number, created: boolean }|null>} null — müştəri bazası sxemi yoxdur
 */
async function ensureCustomerAt(profile, account) {
    if (!state.customers || !profile || !account) return null;
    const norm = account.phone_normalized;
    const profileId = Number(profile.id);
    const verified = Boolean(account.phone_verified_at);
    const conn = await pool.getConnection();
    const lockName = `qr_customer:${profileId}:${norm}`;
    let locked = false;
    try {
        const [[lock]] = await conn.query('SELECT GET_LOCK(?, ?) AS ok', [lockName, LOCK_TIMEOUT_SECONDS]);
        locked = Number(lock.ok) === 1;

        const existing = await findCustomerByPhone(conn, profileId, norm);
        if (existing) {
            if (verified && !existing.web_password_hash) {
                await conn.query(
                    `UPDATE customers SET web_password_hash = ?, web_password_set_at = UTC_TIMESTAMP(),
                            phone_verified_at = COALESCE(phone_verified_at, UTC_TIMESTAMP())
                      WHERE id = ? AND web_password_hash IS NULL`,
                    [account.password_hash, existing.id]
                );
            }
            return { id: Number(existing.id), created: false };
        }

        const first = String(account.first_name || '').trim();
        const last = String(account.last_name || '').trim();
        const fullName = (`${first} ${last}`.trim() || `+${norm}`).slice(0, 120);
        const isEnt = Number(profile.is_entertainment_mode) === 1;
        const consent = Number(account.sms_consent) === 1;
        const gender = GENDER_TO_DB[account.gender] || '';

        let id = null;
        for (let attempt = 0; attempt < 6 && !id; attempt++) {
            await conn.beginTransaction();
            try {
                const [res] = await conn.query(
                    `INSERT INTO customers
                        (profile_id, name, code, phone, phone_normalized, email, gender, birth_date, address, description,
                         group_id, cashback, balance, total_spent, total_discount, total_receipts, discount,
                         guardian_name, sms_consent, sms_consent_at, sms_consent_source, visit_count, lifetime_spend,
                         card_token, card_number, web_password_hash, web_password_set_at, phone_verified_at,
                         created_at, updated_at)
                     VALUES (?, ?, '', ?, ?, ?, ?, ?, '', '',
                             NULL, 0, 0, 0, 0, 0, 0,
                             ?, ?, ${consent ? 'UTC_TIMESTAMP()' : 'NULL'}, ?, 0, 0,
                             ?, ?, ?, UTC_TIMESTAMP(), ${verified ? 'UTC_TIMESTAMP()' : 'NULL'},
                             UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
                    [
                        profileId, fullName, `+${norm}`, norm, String(account.email || '').slice(0, 255), gender,
                        account.birth_date || null,
                        isEnt ? fullName : null, consent ? 1 : 0, consent ? SOURCE : null,
                        crypto.randomBytes(16).toString('hex'), newCardNumber(), account.password_hash,
                    ]
                );
                await logEvent(conn, { profileId, customerId: res.insertId, type: 'family_created', actorName: fullName, payload: { name: fullName, children: 0, source: SOURCE } });
                if (consent) {
                    await logEvent(conn, { profileId, customerId: res.insertId, type: 'consent_changed', actorName: fullName, payload: { sms_consent: true, source: SOURCE } });
                }
                await conn.commit();
                id = Number(res.insertId);
            } catch (err) {
                await conn.rollback().catch(() => {});
                // card_token / card_number UNIQUE toqquşması — yeni dəyərlərlə yenidən
                if (!isDup(err)) throw err;
            }
        }
        if (!id) throw new Error('customers sətri yaradılmadı (kart nömrəsi toqquşması)');
        return { id, created: true };
    } finally {
        if (locked) await conn.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {});
        conn.release();
    }
}

/**
 * Qeydiyyat / girişdə: `restaurant` verilibsə həmin filialın müştəri bazasına. Xəta girişi pozmur — yalnız log.
 */
async function joinRestaurant(username, account) {
    if (!username || !state.customers) return null;
    try {
        const profile = await profileByUsername(username);
        if (!profile) return null;
        return await ensureCustomerAt(profile, account);
    } catch (err) {
        console.error(`❌ QR → müştəri bazası (${username}):`, err.message);
        return null;
    }
}

// ── Şifrə (bərpa / dəyişmə) ──────────────────────────────────────────────────

/**
 * Yeni şifrə hər yerə: hesab, bu nömrənin şifrəli kartları (customers.web_password_hash — admin
 * customerAccount.changePassword ilə eyni seçim), güzgü (+ token_version: köhnə QR tokenləri bitir).
 * Loyallıq veb sessiyaları (tətbiq, client.unipos.tech) admin register.resetPassword kimi bağlanır.
 * @param verified true — WhatsApp kodu ilə (bərpa): nömrə təsdiqlənmiş sayılır
 */
async function setPasswordEverywhere(db, { account, mirrorId, hash, verified = false }) {
    await db.query(
        `UPDATE customer_accounts SET password_hash = ?, updated_at = UTC_TIMESTAMP()
            ${verified ? ', phone_verified_at = COALESCE(phone_verified_at, UTC_TIMESTAMP())' : ''}
          WHERE id = ?`,
        [hash, account.id]
    );
    const norm = account.phone_normalized;
    let customerIds = [];
    if (state.customers) {
        await db.query(
            `UPDATE customers SET web_password_hash = ?, web_password_set_at = UTC_TIMESTAMP()
                ${verified ? ', phone_verified_at = UTC_TIMESTAMP()' : ''}
              WHERE phone_normalized = ? AND web_password_hash IS NOT NULL`,
            [hash, norm]
        );
        customerIds = (await rows(db, 'SELECT id FROM customers WHERE phone_normalized = ? ORDER BY id ASC LIMIT 50', [norm])).map((r) => Number(r.id));
    }
    if (state.sessions) {
        // Admin register.resetPassword: hər kart üçün revokeForCustomer + nömrənin bütün sessiyaları (silinmir, ləğv olunur)
        for (const id of customerIds) {
            await db.query(
                'UPDATE customer_web_sessions SET revoked_at = UTC_TIMESTAMP() WHERE revoked_at IS NULL AND customer_ids LIKE ?',
                [`%,${id},%`]
            );
        }
        await db.query('UPDATE customer_web_sessions SET revoked_at = UTC_TIMESTAMP() WHERE phone_normalized = ? AND revoked_at IS NULL', [norm]);
    }
    await db.query(
        `UPDATE qr_users SET sifre = ?, token_version = token_version + 1
            ${verified ? ', phone_verified_at = COALESCE(phone_verified_at, NOW())' : ''}
          WHERE id = ?`,
        [hash, mirrorId]
    );
}

// ── Köçürmə (köhnə qr_users → hesab) ─────────────────────────────────────────

/** QR qonağının olduğu restoranlar: QR sifarişləri (customer_id) və rəyləri (user_phone) */
async function historyProfileIds(qrUser) {
    const ids = new Set();
    const add = (list) => list.forEach((r) => r.profile_id && ids.add(Number(r.profile_id)));
    try {
        add(await rows(pool, 'SELECT DISTINCT profile_id FROM qr_orders WHERE customer_id = ?', [qrUser.id]));
    } catch (err) {
        if (!isNoTable(err)) throw err;
    }
    try {
        add(await rows(pool, 'SELECT DISTINCT profile_id FROM reviews WHERE user_phone = ? AND profile_id IS NOT NULL', [qrUser.nomre]));
    } catch (err) {
        if (!isNoTable(err)) throw err;
    }
    return [...ids];
}

/**
 * Bir köhnə QR hesabını vahid hesaba köçürür (idempotent; startup köçürməsi və hələ köçürülməmiş qonağın
 * girişi / bərpası bunu çağırır):
 *   1. nömrənin hesabı varsa götürülür, yoxdursa yaradılır — ad, soyad, bcrypt heşi olduğu kimi, phone_verified_at
 *      köçürülür, sms_consent = 0 (köhnə qonaq razılıq mətnini görməyib);
 *   2. sifarişlərinin / rəylərinin restoranlarında müştəri sətri təmin olunur (ensureCustomerAt);
 *   3. ən sonda qr_users.account_id yazılır — 1–2 yarımçıq qalsa, növbəti işə salmada təkrarlanır (hər ikisi idempotentdir).
 *
 * @returns {Promise<{ status: 'created'|'linked'|'invalid_phone'|'conflict', account?: object, hashDiffers?: boolean,
 *                     plainHash?: boolean, customers?: { created: number, existing: number, failed: number } }>}
 */
async function migrateQrUser(qrUser) {
    const norm = normalizePhone(qrUser.nomre);
    if (!norm) return { status: 'invalid_phone' };
    let account = await accountByPhone(pool, norm);
    let status = 'linked';
    const plainHash = !isBcryptHash(qrUser.sifre);
    if (!account) {
        try {
            account = await createAccount(pool, {
                phone: norm,
                firstName: qrUser.ad,
                lastName: qrUser.soyad,
                // bcrypt deyilsə (köhnə / pozuq dəyər) QR girişi onsuz da işləmirdi — admin düz mətn müqayisəsinə düşməsin
                passwordHash: plainHash ? unusableHash() : qrUser.sifre,
                verifiedAt: qrUser.phone_verified_at || null,
                smsConsent: false,
            });
            status = 'created';
        } catch (err) {
            if (!isDup(err)) throw err;
            account = await accountByPhone(pool, norm);
            if (!account) throw err;
        }
    }

    const customers = { created: 0, existing: 0, failed: 0 };
    if (state.customers) {
        for (const pid of await historyProfileIds(qrUser)) {
            try {
                const profile = await profileById(pid);
                if (!profile) continue;
                const r = await ensureCustomerAt(profile, account);
                if (r) customers[r.created ? 'created' : 'existing'] += 1;
            } catch (err) {
                customers.failed += 1;
                console.error(`❌ Köçürmə: qr_users #${qrUser.id} → profil ${pid}:`, err.message);
            }
        }
    }

    try {
        await pool.query('UPDATE qr_users SET account_id = ? WHERE id = ? AND account_id IS NULL', [account.id, qrUser.id]);
    } catch (err) {
        // Hesabın artıq güzgüsü var (başqa qr_users sətri) — iki QR hesabı bir hesaba bağlana bilməz
        if (!isDup(err)) throw err;
        return { status: 'conflict', account, customers };
    }
    return { status, account, hashDiffers: status === 'linked' && account.password_hash !== qrUser.sifre, plainHash, customers };
}

/**
 * Server açılanda bir dəfəlik (idempotent) köçürmə: hesaba bağlanmamış bütün qr_users sətirləri.
 * Serveri gözlətmir (çağıran await etmir), alınmasa log yazılır. Bir neçə server nüsxəsi eyni anda
 * işə düşsə GET_LOCK yalnız birinə icazə verir.
 */
async function runMigration() {
    if (!state.accounts) return null;
    const conn = await pool.getConnection();
    const lockName = 'qr_account_migration';
    try {
        const [[lock]] = await conn.query('SELECT GET_LOCK(?, 0) AS ok', [lockName]);
        if (Number(lock.ok) !== 1) {
            console.log('ℹ️  QR hesab köçürməsi başqa nüsxədə gedir — burada atlanır');
            return null;
        }
        const t0 = Date.now();
        const counts = { scanned: 0, created: 0, linked: 0, invalid_phone: 0, conflict: 0, failed: 0, hash_differs: 0, plain_hash: 0, customers_created: 0, customers_existing: 0, customers_failed: 0 };
        let lastId = 0;
        for (;;) {
            const batch = await rows(
                pool,
                // `deleted-<id>` — hesabı silinmiş, anonimləşdirilmiş güzgü (anonymizeOrphanMirror), köçürülmür
                `SELECT ${QR_COLS} FROM qr_users
                  WHERE account_id IS NULL AND id > ? AND nomre NOT LIKE 'deleted-%'
                  ORDER BY id ASC LIMIT 200`,
                [lastId]
            );
            if (!batch.length) break;
            for (const u of batch) {
                lastId = Number(u.id);
                counts.scanned += 1;
                try {
                    const r = await migrateQrUser(u);
                    counts[r.status] += 1;
                    if (r.hashDiffers) counts.hash_differs += 1;
                    if (r.plainHash && r.status === 'created') counts.plain_hash += 1;
                    if (r.customers) {
                        counts.customers_created += r.customers.created;
                        counts.customers_existing += r.customers.existing;
                        counts.customers_failed += r.customers.failed;
                    }
                } catch (err) {
                    counts.failed += 1;
                    console.error(`❌ QR hesab köçürməsi: qr_users #${u.id}:`, err.message);
                }
            }
        }
        console.log(`✅ QR hesab köçürməsi (${Date.now() - t0} ms):`, JSON.stringify(counts));
        return counts;
    } finally {
        await conn.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {});
        conn.release();
    }
}

module.exports = {
    SOURCE,
    state,
    init,
    isReady,
    normalizePhone,
    isBcryptHash,
    accountByPhone,
    accountById,
    createAccount,
    qrUserById,
    qrUserByNomre,
    unlinkedQrUser,
    mirrorOf,
    ensureMirror,
    anonymizeOrphanMirror,
    freeMirrorNomre,
    profileByUsername,
    ensureCustomerAt,
    joinRestaurant,
    setPasswordEverywhere,
    migrateQrUser,
    runMigration,
};
