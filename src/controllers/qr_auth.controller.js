const { pool } = require('../config/database');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

/**
 * @desc    QR Menu İstifadəçi Qeydiyyatı
 * @route   POST /api/qr-auth/register
 * @access  Public
 * Body: { ad, soyad, nomre, sifre }
 * Qeyd: 'nomre' +994 ilə birlikdə frontdan gəlir (məs: +994501234567)
 */
const register = async (req, res) => {
    try {
        const { ad, soyad, nomre, sifre } = req.body;

        // Validation
        if (!ad || !soyad || !nomre || !sifre) {
            return res.status(400).json({
                success: false,
                message: 'Ad, soyad, nömrə və şifrə tələb olunur.'
            });
        }

        // Ad/soyad validation
        if (ad.trim().length < 2) {
            return res.status(400).json({
                success: false,
                message: 'Ad ən azı 2 simvol olmalıdır.'
            });
        }

        if (soyad.trim().length < 2) {
            return res.status(400).json({
                success: false,
                message: 'Soyad ən azı 2 simvol olmalıdır.'
            });
        }

        // Phone number validation - must start with +994
        const phoneRegex = /^\+994[0-9]{9}$/;
        if (!phoneRegex.test(nomre)) {
            return res.status(400).json({
                success: false,
                message: 'Telefon nömrəsi düzgün formatda deyil. (+994XXXXXXXXX)'
            });
        }

        // Password length validation
        if (sifre.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Şifrə ən azı 6 simvol olmalıdır.'
            });
        }

        // Check if phone number already exists
        const [existingUser] = await pool.execute(
            'SELECT id FROM qr_users WHERE nomre = ?',
            [nomre]
        );

        if (existingUser.length > 0) {
            return res.status(409).json({
                success: false,
                message: 'Bu nömrə ilə artıq hesab mövcuddur.'
            });
        }

        // Hash password
        const hashedSifre = await bcrypt.hash(sifre, 10);

        // Insert new user
        const [result] = await pool.execute(
            'INSERT INTO qr_users (ad, soyad, nomre, sifre) VALUES (?, ?, ?, ?)',
            [ad.trim(), soyad.trim(), nomre, hashedSifre]
        );

        const newUserId = result.insertId;

        // Generate JWT token
        const token = jwt.sign(
            {
                id: newUserId,
                nomre,
                type: 'qr_user'
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
        );

        return res.status(201).json({
            success: true,
            message: 'Qeydiyyat uğurla tamamlandı!',
            data: {
                token,
                user: {
                    id: newUserId,
                    ad: ad.trim(),
                    soyad: soyad.trim(),
                    nomre
                }
            }
        });

    } catch (error) {
        console.error('QR Register xətası:', error);
        return res.status(500).json({
            success: false,
            message: 'Server xətası baş verdi.'
        });
    }
};

/**
 * @desc    QR Menu İstifadəçi Girişi
 * @route   POST /api/qr-auth/login
 * @access  Public
 * Body: { nomre, sifre }
 * Qeyd: 'nomre' +994 ilə birlikdə frontdan gəlir (məs: +994501234567)
 */
const login = async (req, res) => {
    try {
        const { nomre, sifre } = req.body;

        // Validation
        if (!nomre || !sifre) {
            return res.status(400).json({
                success: false,
                message: 'Nömrə və şifrə tələb olunur.'
            });
        }

        // Phone number validation
        const phoneRegex = /^\+994[0-9]{9}$/;
        if (!phoneRegex.test(nomre)) {
            return res.status(400).json({
                success: false,
                message: 'Telefon nömrəsi düzgün formatda deyil. (+994XXXXXXXXX)'
            });
        }

        // Find user by phone number
        const [rows] = await pool.execute(
            'SELECT id, ad, soyad, nomre, sifre FROM qr_users WHERE nomre = ?',
            [nomre]
        );

        if (rows.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Nömrə və ya şifrə yanlışdır.'
            });
        }

        const user = rows[0];

        // Verify password
        const isPasswordValid = await bcrypt.compare(sifre, user.sifre);

        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                message: 'Nömrə və ya şifrə yanlışdır.'
            });
        }

        // Generate JWT token
        const token = jwt.sign(
            {
                id: user.id,
                nomre: user.nomre,
                type: 'qr_user'
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
        );

        return res.status(200).json({
            success: true,
            message: 'Uğurla daxil oldunuz!',
            data: {
                token,
                user: {
                    id: user.id,
                    ad: user.ad,
                    soyad: user.soyad,
                    nomre: user.nomre
                }
            }
        });

    } catch (error) {
        console.error('QR Login xətası:', error);
        return res.status(500).json({
            success: false,
            message: 'Server xətası baş verdi.'
        });
    }
};

/**
 * @desc    QR Menu İstifadəçi Profili
 * @route   GET /api/qr-auth/me
 * @access  Private (JWT token tələb olunur)
 */
const getMe = async (req, res) => {
    try {
        const [rows] = await pool.execute(
            'SELECT id, ad, soyad, nomre, created_at FROM qr_users WHERE id = ?',
            [req.qrUser.id]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'İstifadəçi tapılmadı.'
            });
        }

        return res.status(200).json({
            success: true,
            data: rows[0]
        });

    } catch (error) {
        console.error('QR GetMe xətası:', error);
        return res.status(500).json({
            success: false,
            message: 'Server xətası baş verdi.'
        });
    }
};

/**
 * @desc    QR Menu İstifadəçi Profilini Yenilə
 * @route   PUT /api/qr-auth/update
 * @access  Private (JWT token tələb olunur)
 * Body: { ad?, soyad?, yeni_sifre?, kohne_sifre? }
 * Qeyd: nomre dəyişdirilmir
 */
const updateProfile = async (req, res) => {
    try {
        const { ad, soyad, yeni_sifre, kohne_sifre } = req.body;
        const userId = req.qrUser.id;

        // Ən azı bir sahə tələb olunur
        if (!ad && !soyad && !yeni_sifre) {
            return res.status(400).json({
                success: false,
                message: 'Yeniləmək üçün ən azı bir sahə daxil edin.'
            });
        }

        // Get current user from DB
        const [rows] = await pool.execute(
            'SELECT id, ad, soyad, nomre, sifre FROM qr_users WHERE id = ?',
            [userId]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'İstifadəçi tapılmadı.'
            });
        }

        const currentUser = rows[0];

        // Build update fields
        const updates = {};

        if (ad !== undefined) {
            if (ad.trim().length < 2) {
                return res.status(400).json({
                    success: false,
                    message: 'Ad ən azı 2 simvol olmalıdır.'
                });
            }
            updates.ad = ad.trim();
        }

        if (soyad !== undefined) {
            if (soyad.trim().length < 2) {
                return res.status(400).json({
                    success: false,
                    message: 'Soyad ən azı 2 simvol olmalıdır.'
                });
            }
            updates.soyad = soyad.trim();
        }

        // Password change — requires old password verification
        if (yeni_sifre !== undefined) {
            if (!kohne_sifre) {
                return res.status(400).json({
                    success: false,
                    message: 'Mövcud şifrə tələb olunur.'
                });
            }

            const isOldPassValid = await bcrypt.compare(kohne_sifre, currentUser.sifre);
            if (!isOldPassValid) {
                return res.status(401).json({
                    success: false,
                    message: 'Mövcud şifrə yanlışdır.'
                });
            }

            if (yeni_sifre.length < 6) {
                return res.status(400).json({
                    success: false,
                    message: 'Yeni şifrə ən azı 6 simvol olmalıdır.'
                });
            }

            updates.sifre = await bcrypt.hash(yeni_sifre, 10);
        }

        // Build SQL SET clause dynamically
        const fields = Object.keys(updates);
        const values = Object.values(updates);

        const setClause = fields.map(f => `${f} = ?`).join(', ');
        await pool.execute(
            `UPDATE qr_users SET ${setClause} WHERE id = ?`,
            [...values, userId]
        );

        // Return updated user (without sifre)
        const [updated] = await pool.execute(
            'SELECT id, ad, soyad, nomre, created_at FROM qr_users WHERE id = ?',
            [userId]
        );

        return res.status(200).json({
            success: true,
            message: 'Profil uğurla yeniləndi!',
            data: updated[0]
        });

    } catch (error) {
        console.error('QR UpdateProfile xətası:', error);
        return res.status(500).json({
            success: false,
            message: 'Server xətası baş verdi.'
        });
    }
};

/**
 * @desc    QR Menu Rəy Göndərmək
 * @route   POST /api/qr-auth/review
 * @access  Private (JWT token tələb olunur)
 * Body: { business, rating, comment, profile_id }
 */
const sendReview = async (req, res) => {
    try {
        const { business, rating, comment, profile_id } = req.body;
        const userId = req.qrUser.id;

        if (!business || !rating) {
            return res.status(400).json({
                success: false,
                message: 'Zəhmət olmasa qiymətləndirməni seçin və biznes adını qeyd edin.'
            });
        }

        // Get user details
        const [users] = await pool.execute('SELECT ad, soyad, nomre FROM qr_users WHERE id = ?', [userId]);
        let userName = '';
        let userPhone = '';
        if (users.length > 0) {
            userName = `${users[0].ad} ${users[0].soyad}`.trim();
            userPhone = users[0].nomre;
        }

        const finalComment = (comment || '').trim();

        await pool.execute(
            'INSERT INTO reviews (business_name, rating, comment, profile_id, user, user_phone, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
            [business, rating, finalComment, profile_id || null, userName, userPhone]
        );

        // İstifadəçiyə cavabı gözlətmədən dərhal göndəririk
        res.status(201).json({
            success: true,
            message: 'Rəyiniz uğurla göndərildi. Təşəkkür edirik!'
        });

        // Arxa planda (background) profili update edirik (await istifadə edilmir)
        if (profile_id) {
            pool.execute(`
                UPDATE profiles 
                SET 
                    average_rating = (SELECT ROUND(AVG(rating), 1) FROM reviews WHERE profile_id = ?),
                    review_count = (SELECT COUNT(*) FROM reviews WHERE profile_id = ?)
                WHERE id = ?`,
                [profile_id, profile_id, profile_id]
            ).catch(err => console.error('Arxa planda average_rating yeniləmə xətası:', err));
        }

    } catch (error) {
        console.error('QR SendReview xətası:', error);
        return res.status(500).json({
            success: false,
            message: 'Server xətası baş verdi.'
        });
    }
};

module.exports = {
    register,
    login,
    getMe,
    updateProfile,
    sendReview
};
