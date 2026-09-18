const { pool } = require('../config/database');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const UPLOADS_BASE = '/root/new-unipos-backend';

const MIME_TYPES = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif'
};

const imageToBase64 = async (filePath) => {
    if (!filePath) return '';
    try {
        const fullPath = path.join(UPLOADS_BASE, filePath);
        const ext = path.extname(filePath).toLowerCase();
        const mimeType = MIME_TYPES[ext] || 'image/jpeg';
        const buffer = await fs.promises.readFile(fullPath);
        return `data:${mimeType};base64,${buffer.toString('base64')}`;
    } catch (err) {
        return '';
    }
};

/**
 * @desc    Terminal Login
 * @route   POST /api/terminal/login
 * @access  Public
 */
const terminalLogin = async (req, res) => {
    try {
        const { username, terminal_id, terminal_password } = req.body;

        // Validate input
        if (!username || !terminal_id || !terminal_password) {
            return res.status(400).json({
                success: false,
                message: 'İstifadəçi adı, terminal ID və terminal şifrəsi tələb olunur.'
            });
        }

        // Find profile by username
        const [profiles] = await pool.execute(
            'SELECT * FROM profiles WHERE username = ?',
            [username]
        );

        if (profiles.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'İstifadəçi tapılmadı.'
            });
        }

        const profile = profiles[0];

        // Check if profile is active
        if (!profile.is_working) {
            return res.status(403).json({
                success: false,
                message: 'Hesab aktiv deyil. Dəstək xidməti ilə əlaqə saxlayın.'
            });
        }

        // Find terminal by profile_id, terminal_id and terminal_password
        const [terminals] = await pool.execute(
            'SELECT id, profile_id, terminal_id, terminal_password, is_master FROM terminal_groups WHERE profile_id = ? AND terminal_id = ? AND terminal_password = ?',
            [profile.id, terminal_id, terminal_password]
        );

        if (terminals.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Terminal ID və ya şifrə yanlışdır.'
            });
        }

        const terminal = terminals[0];

        // Get profile taxes
        const [taxes] = await pool.execute(
            'SELECT * FROM profile_taxes WHERE profile_id = ?',
            [profile.id]
        );

        // Convert profile images to base64
        const profileData = { ...profile };
        profileData.logo = await imageToBase64(profileData.logo);
        profileData.background_img = await imageToBase64(profileData.background_img);

        // Generate JWT token
        const token = jwt.sign(
            {
                profile_id: profile.id,
                terminal_id: terminal.terminal_id,
                terminal_group_id: terminal.id,
                is_master: terminal.is_master,
                username: profile.username,
                restaurant_name: profile.restaurant_name
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
        );

        // Return success response
        res.status(200).json({
            success: true,
            message: 'Terminal uğurla daxil oldu!',
            data: {
                token,
                profile: profileData,
                taxes: taxes,
                terminal: {
                    id: terminal.id,
                    terminal_id: terminal.terminal_id,
                    is_master: terminal.is_master
                }
            }
        });

    } catch (error) {
        console.error('Terminal login xətası:', error);
        res.status(500).json({
            success: false,
            message: 'Server xətası baş verdi.'
        });
    }
};

/**
 * @desc    Get terminal info by profile_id
 * @route   GET /api/terminal/me/:profileId
 * @access  Public (No token required)
 */
const getTerminalInfo = async (req, res) => {
    try {
        const { profileId } = req.params;

        if (!profileId) {
            return res.status(400).json({
                success: false,
                message: 'Profile ID tələb olunur.'
            });
        }

        const [profiles] = await pool.execute(
            `SELECT * FROM profiles WHERE id = ?`,
            [profileId]
        );

        if (profiles.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Profil tapılmadı.'
            });
        }

        const [terminals] = await pool.execute(
            'SELECT * FROM terminal_groups WHERE profile_id = ?',
            [profileId]
        );

        const profile = { ...profiles[0] };
        profile.logo = await imageToBase64(profile.logo);
        profile.background_img = await imageToBase64(profile.background_img);

        res.status(200).json({
            success: true,
            data: {
                profile: profile,
                terminals: terminals
            }
        });

    } catch (error) {
        console.error('GetTerminalInfo xətası:', error);
        res.status(500).json({
            success: false,
            message: 'Server xətası baş verdi.'
        });
    }
};

module.exports = {
    terminalLogin,
    getTerminalInfo
};
