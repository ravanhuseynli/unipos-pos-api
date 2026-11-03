const { pool } = require('../config/database');
const { toImageValue } = require('./pos.controller');

/**
 * Otel QR portalı — QR qonağı üçün açıq, yalnız oxuyur.
 *
 * Məzmunu admin panel yazır (`hotel_portal_*` cədvəlləri, admin backend `ensureHotelPortalSchema`).
 * Müqavilə: admin repo `docs/hotel/QR_PORTAL_CONTRACT.md`.
 *
 * `profiles.is_hotel_mode != 1` → 404 { hotel:false } — otel olmayan restoranlar üçün heç nə qaytarılmır.
 * Cədvəllər hələ yaradılmayıbsa (admin backend yenilənməyib) boş məzmun qaytarılır, xəta yox:
 * QR portalın qabığı (hero, sosial) onsuz da göstərilə bilir.
 */

const SECTION_KEYS = ['info', 'fnb', 'spa', 'entertainment', 'contacts', 'specials'];

/** Story tarixləri otelin yerli günüdür — server UTC-dədir, gecə 00:00–04:00 arası səhv gün olardı */
const bakuToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Baku' });
const LANGS = ['az', 'en', 'ru'];

/** { title_az, title_en, title_ru } → { az, en, ru } (boş → null) */
const tr = (row, name) => {
    const out = {};
    for (const l of LANGS) {
        const v = row?.[`${name}_${l}`];
        out[l] = v !== null && v !== undefined && String(v).trim() ? String(v) : null;
    }
    return out;
};

const image = (v) => (v ? toImageValue(v, null) : null);

const isMissingTable = (error) => error && error.code === 'ER_NO_SUCH_TABLE';

async function queryOrEmpty(sql, params) {
    try {
        const [rows] = await pool.execute(sql, params);
        return rows;
    } catch (error) {
        if (isMissingTable(error)) return [];
        throw error;
    }
}

/**
 * @desc    Otel qonaq portalı (bölmələr, sətirlər, parametrlər)
 * @route   GET /api/hotel/:username   (rəqəmli id də qəbul olunur)
 */
const getHotelPortal = async (req, res) => {
    try {
        const key = String(req.params.username || '').trim();
        if (!key) return res.status(400).json({ hotel: false, message: 'username tələb olunur' });

        const byId = /^\d+$/.test(key);
        const [profiles] = await pool.execute(
            `SELECT id, is_hotel_mode FROM profiles WHERE ${byId ? 'id' : 'username'} = ? LIMIT 1`,
            [byId ? Number(key) : key]
        );
        const profile = profiles[0];
        if (!profile || Number(profile.is_hotel_mode) !== 1) {
            return res.status(404).json({ hotel: false });
        }

        const today = bakuToday();
        const [settingsRows, sectionRows, itemRows, storyRows] = await Promise.all([
            queryOrEmpty('SELECT * FROM hotel_portal_settings WHERE profile_id = ? LIMIT 1', [profile.id]),
            queryOrEmpty('SELECT * FROM hotel_portal_sections WHERE profile_id = ?', [profile.id]),
            queryOrEmpty(
                'SELECT * FROM hotel_portal_items WHERE profile_id = ? AND is_active = 1 ORDER BY sort_order, id',
                [profile.id]
            ),
            // Yalnız bu gün (Bakı) aralığa düşən aktiv story-lər; tarixsiz story həmişə görünür
            queryOrEmpty(
                `SELECT * FROM hotel_portal_stories
                  WHERE profile_id = ? AND is_active = 1 AND image IS NOT NULL
                    AND (starts_on IS NULL OR starts_on <= ?) AND (ends_on IS NULL OR ends_on >= ?)
                  ORDER BY sort_order, id`,
                [profile.id, today, today]
            ),
        ]);

        const s = settingsRows[0] || null;
        const settings = {
            tagline: tr(s, 'tagline'),
            hero_subtitle: tr(s, 'hero_subtitle'),
            hero_logo: image(s?.hero_logo),
            stars: s && Number(s.stars) >= 1 && Number(s.stars) <= 5 ? Number(s.stars) : null,
            whatsapp: s?.whatsapp || null,
            // Instagram / Facebook / TikTok boşdursa QR profildəkini götürür
            instagram: s?.instagram || null,
            tripadvisor: s?.tripadvisor || null,
            facebook: s?.facebook || null,
            youtube: s?.youtube || null,
            tiktok: s?.tiktok || null,
            feedback_image: image(s?.feedback_image),
        };

        // Sətri olmayan bölmə aktiv sayılır və standart yerində qalır
        const byKey = new Map(sectionRows.map((r) => [r.section_key, r]));
        const sections = SECTION_KEYS.map((k, i) => {
            const row = byKey.get(k);
            return {
                key: k,
                active: row ? Number(row.is_active) === 1 : true,
                order: row ? Number(row.sort_order) || 0 : i,
                title: tr(row, 'title'),
                subtitle: tr(row, 'subtitle'),
                image: image(row?.image),
            };
        })
            .filter((x) => x.active)
            .sort((a, b) => a.order - b.order || SECTION_KEYS.indexOf(a.key) - SECTION_KEYS.indexOf(b.key))
            .map(({ active, order, ...rest }) => rest);

        // Deaktiv valideynin uşaqları da gizlənir; deaktiv bölmənin sətirləri qaytarılmır
        const activeSections = new Set(sections.map((x) => x.key));
        const topIds = new Set(itemRows.filter((r) => !r.parent_id).map((r) => r.id));
        const items = itemRows
            .filter((r) => activeSections.has(r.section_key) && (!r.parent_id || topIds.has(r.parent_id)))
            .map((r) => ({
                id: r.id,
                section: r.section_key,
                parent_id: r.parent_id || null,
                title: tr(r, 'title'),
                subtitle: tr(r, 'subtitle'),
                badge: tr(r, 'badge'),
                body: tr(r, 'body'),
                image: image(r.image),
                icon: r.icon || null,
                tag: r.tag || null,
                action_type: r.action_type || 'page',
                action_value: r.action_value || null,
                menu_category_id: r.menu_category_id || null,
            }));

        const stories = storyRows.map((r) => ({
            id: r.id,
            title: tr(r, 'title'),
            caption: tr(r, 'caption'),
            button: tr(r, 'button'),
            image: image(r.image),
            link_type: r.link_type || 'none',
            link_value: r.link_value || null,
        }));

        res.json({ hotel: true, settings, sections, items, stories });
    } catch (error) {
        console.error('GetHotelPortal error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

module.exports = { getHotelPortal };
