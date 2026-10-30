const { pool } = require('../config/database');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const { createSession, verifySession, revokeSession } = require('../services/terminalSession.service');
const { POS_AUTH_MODE } = require('../middleware/pos_auth.middleware');

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
        // SELECT * — `terminal_type` sütunu hələ yaradılmayıbsa (terminalSchema.js) login sınmasın
        const [terminals] = await pool.execute(
            'SELECT * FROM terminal_groups WHERE profile_id = ? AND terminal_id = ? AND terminal_password = ?',
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

        // POS sessiya tokeni — POS bütün sorğularda `Authorization: Bearer <session_token>` göndərir.
        // Cədvəl yoxdursa / yazılmadısa compat rejimində login yenə uğurludur (köhnə POS-lar sınmasın).
        let session = null;
        try {
            // Rotasiya: POS hər açılışda yenidən login edir. Köhnə tokenini göndəribsə və o
            // ELƏ BU terminalındırsa, bağlanır — sessiyalar yığılmasın. Başqa terminalın
            // tokeni (məs. master slave-in login-ini ötürəndə öz tokenini qoşub) toxunulmur.
            const previousToken = (req.headers.authorization || '').startsWith('Bearer ')
                ? req.headers.authorization.slice(7).trim()
                : null;
            if (previousToken) {
                const previous = await verifySession(previousToken, req.ip).catch(() => null);
                if (previous && previous.terminalGroupId === Number(terminal.id)) {
                    await revokeSession(previous.id, 'rotated');
                }
            }

            session = await createSession({
                profileId: profile.id,
                terminalGroupId: terminal.id,
                terminalId: terminal.terminal_id,
                terminalPassword: terminal.terminal_password,
                deviceName: req.body.device_name,
                ip: req.ip
            });
        } catch (sessionError) {
            console.error('Terminal sessiyası yaradılmadı:', sessionError.message);
            if (POS_AUTH_MODE === 'strict') {
                return res.status(500).json({ success: false, message: 'Server xətası baş verdi.' });
            }
        }

        // Return success response
        res.status(200).json({
            success: true,
            message: 'Terminal uğurla daxil oldu!',
            data: {
                // Köhnə JWT — heç bir POS endpoint-i onu yoxlamır, uyğunluq üçün qalır
                token,
                session_token: session ? session.token : null,
                session_idle_days: session ? session.idleDays : null,
                profile: profileData,
                taxes: taxes,
                terminal: {
                    id: terminal.id,
                    terminal_id: terminal.terminal_id,
                    is_master: terminal.is_master,
                    terminal_type: terminal.terminal_type ?? null
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
 * @access  POS sessiyası (POS_AUTH_MODE)
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

        const [terminalRows] = await pool.execute(
            'SELECT * FROM terminal_groups WHERE profile_id = ?',
            [profileId]
        );
        // Şifrələr cavaba düşmür — əvvəl profileId bilən hər kəs bütün terminal şifrələrini görürdü
        const terminals = terminalRows.map(({ terminal_password, ...terminal }) => terminal);

        const { password, ...profile } = profiles[0];
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

/**
 * @desc    Cari sessiyanı bağlayır (terminal çıxışı)
 * @route   POST /api/terminal/logout
 * @access  POS sessiyası (həmişə tələb olunur)
 */
const terminalLogout = async (req, res) => {
    try {
        await revokeSession(req.terminal.id, 'logout');
        res.status(200).json({ success: true, message: 'Sessiya bağlandı.' });
    } catch (error) {
        console.error('Terminal logout xətası:', error);
        res.status(500).json({ success: false, message: 'Server xətası baş verdi.' });
    }
};

/**
 * @desc    Tokenin keçərli olduğunu yoxlayır, sessiyanın terminalını qaytarır
 * @route   GET /api/terminal/session
 * @access  POS sessiyası (həmişə tələb olunur)
 */
const getTerminalSession = (req, res) => {
    const { profileId, terminalId, terminalGroupId, isMaster, username } = req.terminal;
    res.status(200).json({
        success: true,
        data: {
            profile_id: profileId,
            username,
            terminal_id: terminalId,
            terminal_group_id: terminalGroupId,
            is_master: isMaster ? 1 : 0
        }
    });
};

module.exports = {
    terminalLogin,
    getTerminalInfo,
    terminalLogout,
    getTerminalSession
};
