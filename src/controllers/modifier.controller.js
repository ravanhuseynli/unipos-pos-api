const { pool } = require('../config/database');

/**
 * @desc    Get all modifier groups with items by profile_id
 * @route   GET /api/modifiers/:profileId
 * @access  Public
 */
const getModifiersByProfileId = async (req, res) => {
    try {
        const { profileId } = req.params;

        if (!profileId) {
            return res.status(400).json({ success: false, message: 'Profile ID tələb olunur.' });
        }

        // Get all modifier groups
        const [groups] = await pool.execute(
            'SELECT * FROM product_modifiergroups WHERE profile_id = ? ORDER BY ordering ASC, id ASC',
            [profileId]
        );

        // Get all modifier items for these groups
        const groupIds = groups.map(g => g.id);
        let items = [];
        if (groupIds.length > 0) {
            const placeholders = groupIds.map(() => '?').join(',');
            [items] = await pool.execute(
                `SELECT * FROM product_modifieritems WHERE modifier_group_id IN (${placeholders}) ORDER BY ordering ASC, id ASC`,
                groupIds
            );
        }

        // Nest items inside groups
        const data = groups.map(group => ({
            ...group,
            items: items.filter(item => item.modifier_group_id === group.id)
        }));

        res.json({ success: true, count: data.length, data });
    } catch (error) {
        console.error('GetModifiersByProfileId error:', error);
        res.status(500).json({ success: false, message: 'Server xətası baş verdi.' });
    }
};

/**
 * @desc    Get modifier groups with items by product_id and profile_id
 * @route   GET /api/modifiers/:profileId/product/:productId
 * @access  Public
 */
const getModifiersByProductId = async (req, res) => {
    try {
        const { profileId, productId } = req.params;

        if (!profileId) {
            return res.status(400).json({ success: false, message: 'Profile ID tələb olunur.' });
        }

        const [groups] = await pool.execute(
            'SELECT * FROM product_modifiergroups WHERE product_id = ? AND profile_id = ? ORDER BY ordering ASC, id ASC',
            [productId, profileId]
        );

        const groupIds = groups.map(g => g.id);
        let items = [];
        if (groupIds.length > 0) {
            const placeholders = groupIds.map(() => '?').join(',');
            [items] = await pool.execute(
                `SELECT * FROM product_modifieritems WHERE modifier_group_id IN (${placeholders}) ORDER BY ordering ASC, id ASC`,
                groupIds
            );
        }

        const data = groups.map(group => ({
            ...group,
            items: items.filter(item => item.modifier_group_id === group.id)
        }));

        res.json({ success: true, count: data.length, data });
    } catch (error) {
        console.error('GetModifiersByProductId error:', error);
        res.status(500).json({ success: false, message: 'Server xətası baş verdi.' });
    }
};

/**
 * @desc    Get single modifier group with items by profile_id
 * @route   GET /api/modifiers/:profileId/group/:groupId
 * @access  Public
 */
const getModifierGroupById = async (req, res) => {
    try {
        const { profileId, groupId } = req.params;

        if (!profileId) {
            return res.status(400).json({ success: false, message: 'Profile ID tələb olunur.' });
        }

        const [groups] = await pool.execute(
            'SELECT * FROM product_modifiergroups WHERE id = ? AND profile_id = ?',
            [groupId, profileId]
        );

        if (groups.length === 0) {
            return res.status(404).json({ success: false, message: 'Modifier group tapılmadı.' });
        }

        const [items] = await pool.execute(
            'SELECT * FROM product_modifieritems WHERE modifier_group_id = ? ORDER BY ordering ASC, id ASC',
            [groupId]
        );

        res.json({
            success: true,
            data: { ...groups[0], items }
        });
    } catch (error) {
        console.error('GetModifierGroupById error:', error);
        res.status(500).json({ success: false, message: 'Server xətası baş verdi.' });
    }
};

module.exports = {
    getModifiersByProfileId,
    getModifiersByProductId,
    getModifierGroupById
};
