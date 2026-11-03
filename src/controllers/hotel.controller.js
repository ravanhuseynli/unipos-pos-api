const { pool } = require('../config/database');
const { toImageValue } = require('./pos.controller');

/**
 * Otel QR portalı — QR qonağı üçün açıq, yalnız oxuyur.
 *
 * Portalın plitələri və siyahıları MENYUNUN ÖZÜDÜR (GET /pos/menu → general_categories, menu[] QR
 * sahələri ilə). Bu endpoint yalnız portalın öz parametrlərini (hero, sosial, rəy banneri) və bu gün
 * (Bakı) aktiv olan story-ləri qaytarır. Yazan admin backend-dir (`hotel_portal_settings` / `_stories`).
 * Müqavilə: admin repo `docs/hotel/QR_PORTAL_CONTRACT.md`.
 *
 * `profiles.is_hotel_mode != 1` → 404 { hotel:false } — otel olmayan restoranlar üçün heç nə qaytarılmır.
 * Cədvəllər hələ yaradılmayıbsa boş məzmun qaytarılır, xəta yox.
 */

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
 * @desc    Otel qonaq portalı — parametrlər və story-lər
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
        const [settingsRows, storyRows] = await Promise.all([
            queryOrEmpty('SELECT * FROM hotel_portal_settings WHERE profile_id = ? LIMIT 1', [profile.id]),
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

        const stories = storyRows.map((r) => ({
            id: r.id,
            title: tr(r, 'title'),
            caption: tr(r, 'caption'),
            button: tr(r, 'button'),
            image: image(r.image),
            link_type: r.link_type || 'none',
            link_value: r.link_value || null,
        }));

        res.json({ hotel: true, settings, stories });
    } catch (error) {
        console.error('GetHotelPortal error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

module.exports = { getHotelPortal };
