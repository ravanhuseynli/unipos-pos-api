const { pool } = require('../config/database');

/**
 * @desc    Get all halls (table_groups) by profile_id
 * @route   GET /api/halls/:profileId
 * @access  Public (No token required)
 */
const getHallsByProfileId = async (req, res) => {
    try {
        const { profileId } = req.params;

        if (!profileId) {
            return res.status(400).json({
                success: false,
                message: 'Profile ID tələb olunur.'
            });
        }

        const [halls] = await pool.execute(
            `SELECT * FROM table_groups WHERE profile_id = ? ORDER BY ordering ASC, id ASC`,
            [profileId]
        );

        res.status(200).json({
            success: true,
            count: halls.length,
            data: halls
        });

    } catch (error) {
        console.error('GetHallsByProfileId xətası:', error);
        res.status(500).json({
            success: false,
            message: 'Server xətası baş verdi.'
        });
    }
};

/**
 * @desc    Get all tables by profile_id
 * @route   GET /api/tables/:profileId
 * @access  Public (No token required)
 */
const getTablesByProfileId = async (req, res) => {
    try {
        const { profileId } = req.params;

        if (!profileId) {
            return res.status(400).json({
                success: false,
                message: 'Profile ID tələb olunur.'
            });
        }

        const [tables] = await pool.execute(
            `SELECT * FROM tables WHERE profile_id = ? ORDER BY hall_id ASC, ordering ASC`,
            [profileId]
        );

        res.status(200).json({
            success: true,
            count: tables.length,
            data: tables
        });

    } catch (error) {
        console.error('GetTablesByProfileId xətası:', error);
        res.status(500).json({
            success: false,
            message: 'Server xətası baş verdi.'
        });
    }
};

/**
 * @desc    Get tables by hall_id
 * @route   GET /api/tables/hall/:hallId
 * @access  Public (No token required)
 */
const getTablesByHallId = async (req, res) => {
    try {
        const { hallId } = req.params;

        const [tables] = await pool.execute(
            `SELECT * FROM tables WHERE hall_id = ? ORDER BY ordering ASC`,
            [hallId]
        );

        res.status(200).json({
            success: true,
            count: tables.length,
            data: tables
        });

    } catch (error) {
        console.error('GetTablesByHallId xətası:', error);
        res.status(500).json({
            success: false,
            message: 'Server xətası baş verdi.'
        });
    }
};

/**
 * @desc    Get halls with their tables by profile_id
 * @route   GET /api/halls/:profileId/with-tables
 * @access  Public (No token required)
 */
const getHallsWithTables = async (req, res) => {
    try {
        const { profileId } = req.params;

        if (!profileId) {
            return res.status(400).json({
                success: false,
                message: 'Profile ID tələb olunur.'
            });
        }

        // Get halls
        const [halls] = await pool.execute(
            `SELECT * FROM table_groups WHERE profile_id = ? ORDER BY ordering ASC, id ASC`,
            [profileId]
        );

        // Get tables
        const [tables] = await pool.execute(
            `SELECT * FROM tables WHERE profile_id = ? ORDER BY ordering ASC`,
            [profileId]
        );

        // Group tables by hall_id
        const hallsWithTables = halls.map(hall => ({
            ...hall,
            tables: tables.filter(table => table.hall_id === hall.id)
        }));

        res.status(200).json({
            success: true,
            count: hallsWithTables.length,
            data: hallsWithTables
        });

    } catch (error) {
        console.error('GetHallsWithTables xətası:', error);
        res.status(500).json({
            success: false,
            message: 'Server xətası baş verdi.'
        });
    }
};

module.exports = {
    getHallsByProfileId,
    getTablesByProfileId,
    getTablesByHallId,
    getHallsWithTables
};
