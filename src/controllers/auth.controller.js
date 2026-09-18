const { pool } = require('../config/database');
const jwt = require('jsonwebtoken');

/**
 * @desc    Admin Login
 * @route   POST /api/auth/login
 * @access  Public
 */
const login = async (req, res) => {
    try {
        const { username, password } = req.body;

        // Validate input
        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: 'İstifadəçi adı və şifrə tələb olunur.'
            });
        }

        // Find user by username
        const [rows] = await pool.execute(
            'SELECT id, username, password, restaurant_name, logo, is_working, is_pos, is_menu FROM profiles WHERE username = ?',
            [username]
        );

        if (rows.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'İstifadəçi adı və ya şifrə yanlışdır.'
            });
        }

        const user = rows[0];

        // Check password (plain text comparison as per existing database structure)
        if (user.password !== password) {
            return res.status(401).json({
                success: false,
                message: 'İstifadəçi adı və ya şifrə yanlışdır.'
            });
        }

        // Check if account is active
        if (!user.is_working) {
            return res.status(403).json({
                success: false,
                message: 'Hesabınız aktiv deyil. Zəhmət olmasa dəstək xidməti ilə əlaqə saxlayın.'
            });
        }

        // Generate JWT token
        const token = jwt.sign(
            {
                id: user.id,
                username: user.username,
                restaurant_name: user.restaurant_name
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
        );

        // Return success response
        res.status(200).json({
            success: true,
            message: 'Uğurla daxil oldunuz!',
            data: {
                token,
                user: {
                    id: user.id,
                    username: user.username,
                    restaurant_name: user.restaurant_name,
                    logo: user.logo,
                    is_pos: user.is_pos,
                    is_menu: user.is_menu
                }
            }
        });

    } catch (error) {
        console.error('Login xətası:', error);
        res.status(500).json({
            success: false,
            message: 'Server xətası baş verdi.'
        });
    }
};

/**
 * @desc    Get current user profile
 * @route   GET /api/auth/me
 * @access  Private
 */
const getMe = async (req, res) => {
    try {
        const [rows] = await pool.execute(
            `SELECT id, username, restaurant_name, logo, boss_name, boss_phone_number, 
                    region, email, phone, address, is_working, is_pos, is_menu, 
                    is_tax, service_fee, tax_percent
             FROM profiles WHERE id = ?`,
            [req.user.id]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'İstifadəçi tapılmadı.'
            });
        }

        res.status(200).json({
            success: true,
            data: rows[0]
        });

    } catch (error) {
        console.error('GetMe xətası:', error);
        res.status(500).json({
            success: false,
            message: 'Server xətası baş verdi.'
        });
    }
};

module.exports = {
    login,
    getMe
};
