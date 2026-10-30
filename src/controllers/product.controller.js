const { pool } = require('../config/database');

/**
 * @desc    Get all products by profile_id
 * @route   GET /api/products/:profileId
 * @access  POS sessiyası (POS_AUTH_MODE)
 */
const getAllProducts = async (req, res) => {
    try {
        const { profileId } = req.params;

        if (!profileId) {
            return res.status(400).json({
                success: false,
                message: 'Profile ID tələb olunur.'
            });
        }

        let actualProfileId = profileId;
        if (isNaN(profileId)) {
            const [profiles] = await pool.execute('SELECT id FROM profiles WHERE username = ?', [profileId]);
            if (profiles.length === 0) {
                return res.status(404).json({ success: false, message: 'Profil tapılmadı.' });
            }
            actualProfileId = profiles[0].id;
        }

        const [products] = await pool.execute(
            `SELECT 
                id,
                profile_id,
                category_id,
                name,
                price,
                discount,
                img,
                ordering,
                is_hidden_qr,
                is_hidden_pos,
                is_highlight_qr,
                no_discount,
                no_service_fee,
                own_set_price,
                ingredient,
                product_type,
                timer_intervals,
                are_orders_included,
                hourly_price,
                createdAt
             FROM products 
             WHERE profile_id = ?
             ORDER BY ordering ASC, id ASC`,
            [actualProfileId]
        );

        res.status(200).json({
            success: true,
            count: products.length,
            data: products
        });

    } catch (error) {
        console.error('GetAllProducts xətası:', error);
        res.status(500).json({
            success: false,
            message: 'Server xətası baş verdi.'
        });
    }
};

/**
 * @desc    Get single product by id and profile_id
 * @route   GET /api/products/:profileId/:id
 * @access  POS sessiyası (POS_AUTH_MODE)
 */
const getProductById = async (req, res) => {
    try {
        const { profileId, id } = req.params;

        let actualProfileId = profileId;
        if (isNaN(profileId)) {
            const [profiles] = await pool.execute('SELECT id FROM profiles WHERE username = ?', [profileId]);
            if (profiles.length === 0) {
                return res.status(404).json({ success: false, message: 'Profil tapılmadı.' });
            }
            actualProfileId = profiles[0].id;
        }

        const [products] = await pool.execute(
            `SELECT * FROM products WHERE id = ? AND profile_id = ?`,
            [id, actualProfileId]
        );

        if (products.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Məhsul tapılmadı.'
            });
        }

        res.status(200).json({
            success: true,
            data: products[0]
        });

    } catch (error) {
        console.error('GetProductById xətası:', error);
        res.status(500).json({
            success: false,
            message: 'Server xətası baş verdi.'
        });
    }
};

/**
 * @desc    Get products by category and profile_id
 * @route   GET /api/products/:profileId/category/:categoryId
 * @access  POS sessiyası (POS_AUTH_MODE)
 */
const getProductsByCategory = async (req, res) => {
    try {
        const { profileId, categoryId } = req.params;

        let actualProfileId = profileId;
        if (isNaN(profileId)) {
            const [profiles] = await pool.execute('SELECT id FROM profiles WHERE username = ?', [profileId]);
            if (profiles.length === 0) {
                return res.status(404).json({ success: false, message: 'Profil tapılmadı.' });
            }
            actualProfileId = profiles[0].id;
        }

        const [products] = await pool.execute(
            `SELECT * FROM products 
             WHERE profile_id = ? AND category_id = ?
             ORDER BY ordering ASC, id ASC`,
            [actualProfileId, categoryId]
        );

        res.status(200).json({
            success: true,
            count: products.length,
            data: products
        });

    } catch (error) {
        console.error('GetProductsByCategory xətası:', error);
        res.status(500).json({
            success: false,
            message: 'Server xətası baş verdi.'
        });
    }
};

module.exports = {
    getAllProducts,
    getProductById,
    getProductsByCategory
};
