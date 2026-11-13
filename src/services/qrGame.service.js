const crypto = require('crypto');
const { pool } = require('../config/database');
const customerAccounts = require('./customerAccount.service');

/**
 * QR oyunu — raund, xal, mükafat.
 *
 * Təhlükəsizlik modeli:
 *   • Seed-i server verir (crypto), raund bazada `open` yaranır.
 *   • Klient yalnız GEDİŞLƏRİ göndərir. Server `match3.mjs` ilə raundu baştan oynayır və xalı özü hesablayır.
 *     Etibarsız gediş / artıq gediş / çox sürətli bitiş → `rejected`.
 *   • Raund bir dəfə bitir (`open` → `done` şərti UPDATE ilə — paralel iki finish-dən biri keçir).
 *   • Seed-i bilən bot ən yaxşı oyunu tapa bilər — ona görə xal həm raund üzrə (`round_point_cap`), həm gün
 *     üzrə (yalnız ilk `daily_rounds` raund) məhduddur. Ən pis halda belə qonaq gündə N × cap xal alır.
 *   • Xal pul deyil, yalnız restoranın təyin etdiyi mükafata dəyişir; ayda `monthly_reward_cap` mükafat.
 *   • Hesablama müştəri sətri `FOR UPDATE` kilidi altında — eyni anda iki sorğu limiti keçə bilməz.
 *   • Gündəlik tapşırıq ("bu gün 18 donut topla"): tapşırığı server seçir (restoran + Bakı günü), yerinə
 *     yetirildiyini replay-in `collected`-i göstərir. Bonus gündə bir dəfə — uuid `goal:<müştəri>:<gün>` UNIQUE.
 *
 * Xal hər restoranın özünündür: jurnal `customers.id` üzrədir, customers sətri isə filiala bağlıdır.
 */

const enginePromise = import('../game/match3.mjs');

const ROUND_TTL_MIN = 30; // açıq raund bu qədər sonra bitirilə bilməz
const CLAIM_TTL_HOURS = 24; // qonaq raundunun xalı bu müddətdə götürülməlidir
const MIN_MS_PER_MOVE = 450; // animasiya ~1 san — bundan sürətli bitiş insan oyunu deyil
const IP_ROUNDS_PER_HOUR = 60;
const BAKU_OFFSET_MS = 4 * 3600 * 1000; // Azərbaycan — UTC+4, yay vaxtı yoxdur

const REWARD_TYPES = new Set(['free_product', 'percent']);
// Daş dəstləri — şəkillər QR-dadır (lib/game/packs.js); mühərrikə təsiri yoxdur, yalnız görünüş
const TILE_PACKS = new Set(['classic', 'sushi', 'national', 'coffee']);

class GameError extends Error {
    constructor(status, code, message) {
        super(message || code);
        this.status = status;
        this.code = code;
    }
}

const rows = async (db, sql, params = []) => (await db.query(sql, params))[0];
const one = async (db, sql, params = []) => (await rows(db, sql, params))[0] || null;
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const sqlUtc = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
const clampInt = (v, lo, hi, def) => {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
};

/** Bakı günü 'YYYY-MM-DD' */
const bakuDay = (now = new Date()) => new Date(now.getTime() + BAKU_OFFSET_MS).toISOString().slice(0, 10);

/** Bakı gününün / ayının başlanğıcı (UTC) */
function bakuDayStart(now = new Date()) {
    const local = new Date(now.getTime() + BAKU_OFFSET_MS);
    return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - BAKU_OFFSET_MS);
}
function bakuMonthStart(now = new Date()) {
    const local = new Date(now.getTime() + BAKU_OFFSET_MS);
    return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - BAKU_OFFSET_MS);
}

// ── Profil və parametrlər ────────────────────────────────────────────────────

/** Admin loyalty/module.js loyaltyModuleOn ilə eyni qayda */
function loyaltyModuleOn(profile) {
    const raw = profile.is_loyalty_module;
    if (raw !== null && raw !== undefined && raw !== '') return Number(raw) === 1;
    return ['cashback', 'visits', 'both'].includes(profile.loyalty_mode) || Number(profile.is_entertainment_mode) === 1;
}

function normalizeRewards(raw) {
    let list = [];
    try {
        list = typeof raw === 'string' ? JSON.parse(raw) : Array.isArray(raw) ? raw : [];
    } catch {
        list = [];
    }
    if (!Array.isArray(list)) return [];
    return list
        .map((r) => ({
            id: String(r.id || '').slice(0, 24),
            title_az: String(r.title_az || '').trim().slice(0, 80),
            title_en: String(r.title_en || '').trim().slice(0, 80),
            title_ru: String(r.title_ru || '').trim().slice(0, 80),
            cost: clampInt(r.cost, 1, 1000000, 0),
            type: r.type,
            product_id: r.type === 'free_product' ? clampInt(r.product_id, 1, 2147483647, null) : null,
            value: r.type === 'percent' ? clampInt(r.value, 1, 100, null) : null,
            valid_days: clampInt(r.valid_days, 1, 365, 30),
        }))
        .filter((r) => r.id && r.title_az && r.cost > 0 && REWARD_TYPES.has(r.type) && (r.product_id || r.value))
        .sort((a, b) => a.cost - b.cost);
}

/**
 * Restoran + oyun parametrləri. Oyun bağlıdırsa / menyu bloklanıbsa / loyallıq modulu yoxdursa → enabled: false.
 * @returns {Promise<{ profile, settings }|null>} null — restoran tapılmadı
 */
async function loadGame(username) {
    const key = String(username || '').trim();
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(key)) return null;
    const list = await rows(pool, 'SELECT * FROM profiles WHERE username = ? LIMIT 2', [key]);
    if (list.length !== 1) return null;
    const profile = list[0];
    let s = null;
    try {
        s = await one(pool, 'SELECT * FROM qr_game_settings WHERE profile_id = ? LIMIT 1', [profile.id]);
    } catch (err) {
        if (err.code !== 'ER_NO_SUCH_TABLE') throw err;
    }
    const blocked = Number(profile.is_menu_block) === 1 || (profile.is_menu !== undefined && Number(profile.is_menu) === 0);
    const rewards = normalizeRewards(s?.rewards);
    const settings = {
        enabled: Boolean(s && Number(s.enabled) === 1 && !blocked && loyaltyModuleOn(profile) && customerAccounts.state.customers),
        moves: clampInt(s?.moves, 10, 40, 20),
        dailyRounds: clampInt(s?.daily_rounds, 1, 20, 3),
        scorePerPoint: clampInt(s?.score_per_point, 10, 100000, 100),
        roundPointCap: clampInt(s?.round_point_cap, 1, 100000, 60),
        monthlyRewardCap: clampInt(s?.monthly_reward_cap, 0, 100000, 100),
        tilePack: TILE_PACKS.has(s?.tile_pack) ? s.tile_pack : 'classic',
        dailyGoalBonus: clampInt(s?.daily_goal_bonus, 0, 1000, 20),
        rewards,
    };
    return { profile, settings };
}

/**
 * Günün tapşırığı: restoran + Bakı günü → növ və say (hamı üçün eyni, gün ərzində dəyişmir).
 * Say 20 gedişdə 15/18/21 — təsadüfi oyunda bir növdən median ~17, p75 ~21 (simulyasiya); gediş sayına mütənasib.
 * @returns {{ kind, target, bonus, day } | null} bonus 0-dırsa tapşırıq yoxdur
 */
function dailyGoal(profileId, settings, now = new Date()) {
    if (!settings.dailyGoalBonus) return null;
    const day = bakuDay(now);
    const h = crypto.createHash('sha256').update(`goal:${profileId}:${day}`).digest();
    const kind = h[0] % 6;
    const base = [15, 18, 21][h[1] % 3];
    return { kind, target: Math.max(5, Math.round((base * settings.moves) / 20)), bonus: settings.dailyGoalBonus, day };
}

const publicGoal = (g) => (g ? { kind: g.kind, target: g.target, bonus: g.bonus } : null);

/** Bonusu yazır (gündə bir dəfə — uuid UNIQUE). @returns {Promise<boolean>} indi yazıldımı */
async function creditGoal(conn, { profileId, customerId, roundId, goal, day }) {
    const [ins] = await conn.query(
        `INSERT IGNORE INTO qr_game_points (profile_id, customer_id, uuid, kind, delta, round_id, created_at)
         VALUES (?, ?, ?, 'goal', ?, ?, UTC_TIMESTAMP())`,
        [profileId, customerId, `goal:${customerId}:${day}`, goal.bonus, roundId]
    );
    return ins.affectedRows > 0;
}

async function goalDoneToday(db, customerId) {
    const r = await one(db, 'SELECT id FROM qr_game_points WHERE uuid = ? LIMIT 1', [`goal:${customerId}:${bakuDay()}`]);
    return Boolean(r);
}

async function requireGame(username) {
    const game = await loadGame(username);
    if (!game) throw new GameError(404, 'not_found', 'Restoran tapılmadı');
    if (!game.settings.enabled) throw new GameError(404, 'game_off', 'Oyun bu restoranda aktiv deyil');
    return game;
}

const publicRewards = (rewards) =>
    rewards.map((r) => ({
        id: r.id,
        title: { az: r.title_az, en: r.title_en || r.title_az, ru: r.title_ru || r.title_az },
        cost: r.cost,
        type: r.type,
        value: r.value,
        product_id: r.product_id,
    }));

async function publicInfo(username) {
    const game = await loadGame(username);
    if (!game || !game.settings.enabled) return { enabled: false };
    const s = game.settings;
    return {
        enabled: true,
        moves: s.moves,
        daily_rounds: s.dailyRounds,
        score_per_point: s.scorePerPoint,
        round_point_cap: s.roundPointCap,
        tile_pack: s.tilePack,
        daily_goal: publicGoal(dailyGoal(game.profile.id, s)),
        rewards: publicRewards(s.rewards),
    };
}

// ── Müştəri ──────────────────────────────────────────────────────────────────

/** Token sahibi → bu filialdakı customers sətri (yoxdursa yaradılır — qeydiyyat axını ilə eyni) */
async function customerFor(qrUser, profile) {
    if (!qrUser?.id || !customerAccounts.isReady()) throw new GameError(503, 'loyalty_unavailable', 'Hesab sistemi hazır deyil');
    const mirror = await customerAccounts.qrUserById(pool, qrUser.id);
    if (!mirror?.account_id) throw new GameError(409, 'account_not_linked', 'Hesab hələ hazırlanır, bir az sonra yenidən yoxlayın');
    const account = await customerAccounts.accountById(pool, mirror.account_id);
    if (!account) throw new GameError(401, 'session_revoked', 'Hesab tapılmadı');
    const customer = await customerAccounts.ensureCustomerAt(profile, account);
    if (!customer?.id) throw new GameError(503, 'loyalty_unavailable', 'Müştəri bazası hazır deyil');
    return customer.id;
}

async function balanceOf(db, customerId) {
    const r = await one(db, 'SELECT COALESCE(SUM(delta), 0) AS b FROM qr_game_points WHERE customer_id = ?', [customerId]);
    return Number(r.b) || 0;
}

async function earnedRoundsToday(db, customerId) {
    const r = await one(
        db,
        "SELECT COUNT(*) AS n FROM qr_game_points WHERE customer_id = ? AND kind = 'earn' AND created_at >= ?",
        [customerId, sqlUtc(bakuDayStart())]
    );
    return Number(r.n) || 0;
}

/**
 * Raundun xalını müştəriyə yazır (kilid altında): gündəlik limit dolubsa 0.
 * @returns {Promise<number>} yazılan xal
 */
async function creditRound(conn, { profileId, customerId, roundId, points, settings }) {
    await conn.query('SELECT id FROM customers WHERE id = ? FOR UPDATE', [customerId]);
    const used = await earnedRoundsToday(conn, customerId);
    const credited = used < settings.dailyRounds ? points : 0;
    if (credited > 0) {
        await conn.query(
            `INSERT IGNORE INTO qr_game_points (profile_id, customer_id, uuid, kind, delta, round_id, created_at)
             VALUES (?, ?, ?, 'earn', ?, ?, UTC_TIMESTAMP())`,
            [profileId, customerId, `earn:${roundId}`, credited, roundId]
        );
    }
    return credited;
}

// ── Raund ────────────────────────────────────────────────────────────────────

async function startRound(username, qrUser, ip) {
    const { profile, settings } = await requireGame(username);
    const { ENGINE_VERSION } = await enginePromise;

    const recent = await one(
        pool,
        'SELECT COUNT(*) AS n FROM qr_game_rounds WHERE ip = ? AND started_at >= UTC_TIMESTAMP() - INTERVAL 1 HOUR',
        [ip || '']
    );
    if (Number(recent.n) >= IP_ROUNDS_PER_HOUR) throw new GameError(429, 'too_many_rounds', 'Bir az dincəlin, sonra davam edin');

    let customerId = null;
    let earningLeft = null;
    if (qrUser) {
        customerId = await customerFor(qrUser, profile);
        earningLeft = Math.max(0, settings.dailyRounds - (await earnedRoundsToday(pool, customerId)));
    }

    const id = crypto.randomBytes(16).toString('hex');
    const seed = crypto.randomBytes(16).toString('hex');
    const claimToken = customerId ? null : crypto.randomBytes(24).toString('base64url');
    await pool.query(
        `INSERT INTO qr_game_rounds (id, profile_id, customer_id, seed, engine_version, moves_allowed, claim_hash, status, ip, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, UTC_TIMESTAMP())`,
        [id, profile.id, customerId, seed, ENGINE_VERSION, settings.moves, claimToken ? sha256(claimToken) : null, ip || null]
    );
    return {
        id,
        seed,
        engine: ENGINE_VERSION,
        moves: settings.moves,
        claim_token: claimToken,
        earning_left: earningLeft,
    };
}

const pointsFor = (score, settings) => Math.min(settings.roundPointCap, Math.floor(score / settings.scorePerPoint));

async function finishRound(roundId, body, qrUser) {
    if (!/^[0-9a-f]{32}$/.test(String(roundId))) throw new GameError(404, 'round_not_found');
    const round = await one(
        pool,
        'SELECT *, TIMESTAMPDIFF(SECOND, started_at, UTC_TIMESTAMP()) AS age_s FROM qr_game_rounds WHERE id = ? LIMIT 1',
        [roundId]
    );
    if (!round) throw new GameError(404, 'round_not_found');
    if (round.status !== 'open') throw new GameError(409, 'round_closed');

    // Raundun sahibi: girişli raundu yalnız həmin müştəri, qonaq raundunu yalnız tokeni olan bitirir
    if (round.customer_id) {
        if (!qrUser) throw new GameError(401, 'token_missing');
    } else if (!round.claim_hash || sha256(body?.claim_token || '') !== round.claim_hash) {
        throw new GameError(403, 'round_forbidden');
    }

    const { ENGINE_VERSION, replay } = await enginePromise;
    const moves = body?.moves;
    // DATETIME-lar UTC yazılır; fərqi baza hesablayır (Node-un saat qurşağından asılı olmasın)
    const elapsed = (Number(round.age_s) || 0) * 1000;

    let reject = null;
    let result = null;
    if (Number(round.engine_version) !== ENGINE_VERSION) reject = 'engine_outdated';
    else if (elapsed > ROUND_TTL_MIN * 60 * 1000) reject = 'expired';
    else if (!Array.isArray(moves) || moves.length === 0 || moves.length > round.moves_allowed) reject = 'bad_moves';
    else if (elapsed + 1000 < moves.length * MIN_MS_PER_MOVE) reject = 'too_fast'; // +1 san — saniyəyə yuvarlaqlama
    else {
        result = replay(round.seed, { moves: round.moves_allowed }, moves);
        if (!result.ok) reject = result.error;
    }

    if (reject) {
        await pool.query(
            "UPDATE qr_game_rounds SET status = 'rejected', reject_reason = ?, finished_at = UTC_TIMESTAMP() WHERE id = ? AND status = 'open'",
            [reject, roundId]
        );
        throw new GameError(422, 'round_rejected', reject);
    }

    const game = await loadGame(await usernameOf(round.profile_id));
    if (!game) throw new GameError(404, 'not_found');
    const { settings } = game;
    const earned = settings.enabled ? pointsFor(result.score, settings) : 0;
    const goal = settings.enabled ? dailyGoal(round.profile_id, settings) : null;
    const got = goal ? result.collected[goal.kind] || 0 : 0;
    const met = Boolean(goal && got >= goal.target);
    const goalOut = (awarded) => (goal ? { ...publicGoal(goal), got, met, awarded } : null);

    if (!round.customer_id) {
        const [upd] = await pool.query(
            `UPDATE qr_game_rounds SET status = 'done', score = ?, pending_points = ?, moves_used = ?, goal_met = ?,
                    finished_at = UTC_TIMESTAMP()
              WHERE id = ? AND status = 'open'`,
            [result.score, earned, result.moves, met ? 1 : 0, roundId]
        );
        if (!upd.affectedRows) throw new GameError(409, 'round_closed');
        // Qonağın bonusu da xalı kimi girişdən sonra (claim) yazılır
        return { score: result.score, points: 0, pending_points: earned, claimable: earned > 0 || met, goal: goalOut(false) };
    }

    // Girişli raund: token sahibi raundun müştərisi olmalıdır
    const customerId = await customerFor(qrUser, game.profile);
    if (Number(customerId) !== Number(round.customer_id)) throw new GameError(403, 'round_forbidden');

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [upd] = await conn.query(
            `UPDATE qr_game_rounds SET status = 'done', score = ?, moves_used = ?, finished_at = UTC_TIMESTAMP()
              WHERE id = ? AND status = 'open'`,
            [result.score, result.moves, roundId]
        );
        if (!upd.affectedRows) throw new GameError(409, 'round_closed');
        const credited = settings.enabled
            ? await creditRound(conn, { profileId: round.profile_id, customerId, roundId, points: earned, settings })
            : 0;
        await conn.query('UPDATE qr_game_rounds SET points = ?, goal_met = ? WHERE id = ?', [credited, met ? 1 : 0, roundId]);
        const awarded = met ? await creditGoal(conn, { profileId: round.profile_id, customerId, roundId, goal, day: goal.day }) : false;
        const balance = await balanceOf(conn, customerId);
        const left = Math.max(0, settings.dailyRounds - (await earnedRoundsToday(conn, customerId)));
        await conn.commit();
        return {
            score: result.score,
            points: credited,
            balance,
            earning_left: left,
            limit_reached: earned > 0 && credited === 0,
            goal: goalOut(awarded),
        };
    } catch (err) {
        await conn.rollback().catch(() => {});
        throw err;
    } finally {
        conn.release();
    }
}

async function usernameOf(profileId) {
    const r = await one(pool, 'SELECT username FROM profiles WHERE id = ? LIMIT 1', [profileId]);
    return r?.username || '';
}

/** Qonaq raundlarının xalı — qeydiyyat / girişdən sonra. Gündəlik limit burada da işləyir. */
async function claimRounds(username, items, qrUser) {
    const { profile, settings } = await requireGame(username);
    const customerId = await customerFor(qrUser, profile);
    const list = (Array.isArray(items) ? items : []).slice(0, 10);
    let total = 0;
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        for (const it of list) {
            if (!/^[0-9a-f]{32}$/.test(String(it?.id)) || typeof it?.claim_token !== 'string') continue;
            const round = await one(
                conn,
                `SELECT *, DATE_FORMAT(finished_at + INTERVAL 4 HOUR, '%Y-%m-%d') AS baku_day
                   FROM qr_game_rounds WHERE id = ? AND profile_id = ? AND status = 'done' AND customer_id IS NULL
                    AND finished_at >= UTC_TIMESTAMP() - INTERVAL ${CLAIM_TTL_HOURS} HOUR FOR UPDATE`,
                [it.id, profile.id]
            );
            if (!round || sha256(it.claim_token) !== round.claim_hash) continue;
            const credited = await creditRound(conn, {
                profileId: profile.id,
                customerId,
                roundId: round.id,
                points: Number(round.pending_points) || 0,
                settings,
            });
            await conn.query(
                "UPDATE qr_game_rounds SET status = 'claimed', customer_id = ?, points = ?, claimed_at = UTC_TIMESTAMP() WHERE id = ?",
                [customerId, credited, round.id]
            );
            total += credited;
            // Tapşırığı raundun bitdiyi günün bonusu kimi (həmin gün artıq alınıbsa — yox)
            if (Number(round.goal_met) === 1 && settings.dailyGoalBonus) {
                const goal = { bonus: settings.dailyGoalBonus };
                if (await creditGoal(conn, { profileId: profile.id, customerId, roundId: round.id, goal, day: round.baku_day })) {
                    total += goal.bonus;
                }
            }
        }
        const balance = await balanceOf(conn, customerId);
        await conn.commit();
        return { points: total, balance };
    } catch (err) {
        await conn.rollback().catch(() => {});
        throw err;
    } finally {
        conn.release();
    }
}

// ── Balans və mükafatlar ─────────────────────────────────────────────────────

function titleTr(tiers, titleAz) {
    const tier = tiers.find((x) => x.title_az === titleAz);
    return tier ? { az: tier.title_az, en: tier.title_en || tier.title_az, ru: tier.title_ru || tier.title_az } : null;
}

async function myState(username, qrUser) {
    const { profile, settings } = await requireGame(username);
    const customerId = await customerFor(qrUser, profile);
    const [balance, used, best, rewards, goalDone] = await Promise.all([
        balanceOf(pool, customerId),
        earnedRoundsToday(pool, customerId),
        one(pool, "SELECT MAX(score) AS s FROM qr_game_rounds WHERE customer_id = ? AND profile_id = ? AND status IN ('done', 'claimed')", [customerId, profile.id]),
        rows(
            pool,
            `SELECT id, title, reward_type, reward_value, reward_product_id,
                    DATE_FORMAT(valid_until, '%Y-%m-%dT%H:%i:%sZ') AS valid_until_iso
               FROM customer_rewards
              WHERE customer_id = ? AND profile_id = ? AND source = 'game' AND status = 'available'
                AND (valid_until IS NULL OR valid_until > UTC_TIMESTAMP())
              ORDER BY created_at DESC LIMIT 20`,
            [customerId, profile.id]
        ),
        goalDoneToday(pool, customerId),
    ]);
    return {
        balance,
        earning_left: Math.max(0, settings.dailyRounds - used),
        goal_done: goalDone,
        best: Number(best?.s) || 0,
        rewards: rewards.map((r) => ({
            id: Number(r.id),
            title: r.title,
            // customer_rewards.title AZ-dır — hədiyyə hələ parametrlərdədirsə tərcüməsi də gedir (QR dilinə görə)
            title_tr: titleTr(settings.rewards, r.title),
            type: r.reward_type,
            value: Number(r.reward_value) || null,
            product_id: r.reward_product_id ? Number(r.reward_product_id) : null,
            valid_until: r.valid_until_iso || null,
        })),
    };
}

async function redeem(username, rewardKey, qrUser) {
    const { profile, settings } = await requireGame(username);
    const tier = settings.rewards.find((r) => r.id === String(rewardKey || ''));
    if (!tier) throw new GameError(404, 'reward_not_found', 'Mükafat tapılmadı');
    const customerId = await customerFor(qrUser, profile);

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        await conn.query('SELECT id FROM customers WHERE id = ? FOR UPDATE', [customerId]);
        const balance = await balanceOf(conn, customerId);
        if (balance < tier.cost) throw new GameError(409, 'not_enough_points', 'Xal çatmır');

        const month = await one(
            conn,
            `SELECT COUNT(*) AS n FROM customer_rewards
              WHERE profile_id = ? AND source = 'game' AND status <> 'cancelled' AND created_at >= ?`,
            [profile.id, sqlUtc(bakuMonthStart())]
        );
        if (Number(month.n) >= settings.monthlyRewardCap) {
            throw new GameError(409, 'monthly_cap', 'Bu ayın mükafatları bitib');
        }

        const validUntil = new Date(Date.now() + tier.valid_days * 24 * 3600 * 1000);
        const issueKey = `game:${crypto.randomBytes(12).toString('hex')}`;
        const [ins] = await conn.query(
            `INSERT INTO customer_rewards
                (profile_id, customer_id, source, reward_type, reward_value, reward_product_id, title, note, status, issue_key,
                 valid_from, valid_until, actor_type, actor_name, created_at, updated_at)
             VALUES (?, ?, 'game', ?, ?, ?, ?, ?, 'available', ?, UTC_TIMESTAMP(), ?, 'customer', 'QR oyun', UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
            [
                profile.id,
                customerId,
                tier.type,
                tier.type === 'percent' ? tier.value : 0,
                tier.type === 'free_product' ? tier.product_id : null,
                tier.title_az,
                `${tier.cost} xal`,
                issueKey,
                sqlUtc(validUntil),
            ]
        );
        const rewardId = Number(ins.insertId);
        await conn.query(
            `INSERT INTO qr_game_points (profile_id, customer_id, uuid, kind, delta, reward_id, note, created_at)
             VALUES (?, ?, ?, 'redeem', ?, ?, ?, UTC_TIMESTAMP())`,
            [profile.id, customerId, `redeem:${rewardId}`, -tier.cost, rewardId, tier.title_az]
        );
        await conn.commit();
        return { reward_id: rewardId, balance: balance - tier.cost, valid_until: validUntil.toISOString() };
    } catch (err) {
        await conn.rollback().catch(() => {});
        throw err;
    } finally {
        conn.release();
    }
}

module.exports = {
    GameError,
    publicInfo,
    startRound,
    finishRound,
    claimRounds,
    myState,
    redeem,
    // test üçün
    _internal: { pointsFor, bakuDayStart, bakuMonthStart, bakuDay, dailyGoal, normalizeRewards },
};
