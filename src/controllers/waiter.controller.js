const { pool } = require('../config/database');

/**
 * @desc    Get all waiters by profile_id
 * @route   GET /api/waiters/:profileId
 * @access  Public (No token required)
 */
const getWaitersByProfileId = async (req, res) => {
    try {
        const { profileId } = req.params;

        if (!profileId) {
            return res.status(400).json({
                success: false,
                message: 'Profile ID tələb olunur.'
            });
        }

        const [waiters] = await pool.execute(
            `SELECT * FROM waiters WHERE profile_id = ? ORDER BY id ASC`,
            [profileId]
        );

        res.status(200).json({
            success: true,
            count: waiters.length,
            data: waiters
        });

    } catch (error) {
        console.error('GetWaitersByProfileId xətası:', error);
        res.status(500).json({
            success: false,
            message: 'Server xətası baş verdi.'
        });
    }
};

/**
 * @desc    Get single waiter by id
 * @route   GET /api/waiters/single/:id
 * @access  Public (No token required)
 */
const getWaiterById = async (req, res) => {
    try {
        const { id } = req.params;

        const [waiters] = await pool.execute(
            `SELECT * FROM waiters WHERE id = ?`,
            [id]
        );

        if (waiters.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Ofisiant tapılmadı.'
            });
        }

        res.status(200).json({
            success: true,
            data: waiters[0]
        });

    } catch (error) {
        console.error('GetWaiterById xətası:', error);
        res.status(500).json({
            success: false,
            message: 'Server xətası baş verdi.'
        });
    }
};

module.exports = {
    getWaitersByProfileId,
    getWaiterById
};
