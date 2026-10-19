const { pool } = require('../config/database');
const bcrypt = require('bcryptjs');
const { isValidPhone, PHONE_FORMAT_MESSAGE } = require('../utils/phone');
const { signQrUserToken } = require('../utils/qrUserToken');
const { sendOtp: sendOtpCode, verifyOtp, markOtpUsed, isOtpRequired, OtpError, PURPOSES } = require('../services/qrOtp.service');

/**
 * Nömrə limitləri üçün qonağın IP-si. Proxy arxasında `trust proxy` (TRUST_PROXY)
 * qurulmayıbsa `req.ip` proxy-nin ünvanıdır — hamı bir IP sayılardı və limit hamını
 * birdən bağlayardı. Həmin halda IP limiti tətbiq olunmur (nömrə limitləri qalır).
 */
const clientIp = (req) =>
    (req.app.get('trust proxy') || !req.headers['x-forwarded-for'] ? String(req.ip || '').replace(/^::ffff:/, '') || null : null);

const otpErrorResponse = (res, error) =>
    res.status(error.status).json({ success: false, code: error.code, message: error.message, ...error.extra });

/**
 * @desc    Telefon nömrəsinə təsdiq kodu (WhatsApp)
 * @route   POST /api/qr-auth/otp/send
 * @access  Public
 * Body: { nomre, purpose? = 'register' | 'reset' }
 *   register — nömrə hələ qeydiyyatda olmamalıdır (409 phone_taken)
 *   reset    — şifrə bərpası, nömrə ilə hesab olmalıdır (404 phone_not_found)
 * Cavab: { request_id, expires_in, resend_in, code_length } — request_id növbəti sorğuda geri göndərilir
 */
const sendOtp = async (req, res) => {
    try {
        const { nomre, purpose = 'register' } = req.body;

        if (!PURPOSES.has(purpose)) {
            return res.status(400).json({ success: false, message: 'Naməlum təsdiq növü.' });
        }
        if (!isValidPhone(nomre)) {
            return res.status(400).json({ success: false, message: PHONE_FORMAT_MESSAGE });
        }

        const [existingUser] = await pool.execute('SELECT id FROM qr_users WHERE nomre = ?', [nomre]);
        if (purpose === 'register' && existingUser.length > 0) {
            return res.status(409).json({
                success: false,
                code: 'phone_taken',
                message: 'Bu nömrə ilə artıq hesab mövcuddur.'
            });
        }
        if (purpose === 'reset' && existingUser.length === 0) {
            return res.status(404).json({
                success: false,
                code: 'phone_not_found',
                message: 'Bu nömrə ilə hesab tapılmadı.'
            });
        }

        const data = await sendOtpCode({ nomre, purpose, ip: clientIp(req) });
        return res.status(200).json({
            success: true,
            message: 'Təsdiq kodu WhatsApp-a göndərildi.',
            data
        });

    } catch (error) {
        if (error instanceof OtpError) return otpErrorResponse(res, error);
        console.error('QR SendOtp xətası:', error);
        return res.status(500).json({
            success: false,
            message: 'Server xətası baş verdi.'
        });
    }
};

/**
 * @desc    QR Menu İstifadəçi Qeydiyyatı
 * @route   POST /api/qr-auth/register
 * @access  Public
 * Body: { ad, soyad, nomre, sifre, request_id, kod }
 * Qeyd: 'nomre' ölkə kodu ilə birlikdə gəlir (məs: +994501234567).
 * `request_id` + `kod` — POST /otp/send-dən; nömrə təsdiqlənmədən hesab yaradılmır
 * (QR_OTP_REQUIRED=0 olmadıqda). Kod və hesab eyni tranzaksiyadadır.
 */
const register = async (req, res) => {
    let conn;
    try {
        const { ad, soyad, nomre, sifre, request_id, kod } = req.body;

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

        if (!isValidPhone(nomre)) {
            return res.status(400).json({
                success: false,
                message: PHONE_FORMAT_MESSAGE
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

        const hasOtp = Boolean(request_id || kod);
        if (isOtpRequired() && !hasOtp) {
            return res.status(400).json({
                success: false,
                code: 'otp_required',
                message: 'Telefon nömrəsi təsdiqlənməlidir.'
            });
        }

        // Hash password
        const hashedSifre = await bcrypt.hash(sifre, 10);

        conn = await pool.getConnection();
        await conn.beginTransaction();

        if (hasOtp) {
            const otp = await verifyOtp(conn, { requestId: request_id, nomre, code: kod, purpose: 'register' });
            await markOtpUsed(conn, otp.id);
        }

        // Insert new user
        const [result] = await conn.execute(
            'INSERT INTO qr_users (ad, soyad, nomre, sifre, phone_verified_at) VALUES (?, ?, ?, ?, IF(?, NOW(), NULL))',
            [ad.trim(), soyad.trim(), nomre, hashedSifre, hasOtp ? 1 : 0]
        );
        await conn.commit();

        const newUserId = result.insertId;

        // Generate JWT token (yeni hesab — token_version 0)
        const token = signQrUserToken({ id: newUserId, nomre, token_version: 0 });

        return res.status(201).json({
            success: true,
            message: 'Qeydiyyat uğurla tamamlandı!',
            data: {
                token,
                user: {
                    id: newUserId,
                    ad: ad.trim(),
                    soyad: soyad.trim(),
                    nomre,
                    phone_verified: hasOtp
                }
            }
        });

    } catch (error) {
        if (conn) {
            // Səhv kodda cəhd sayı yazılmalıdır — əks halda 5 cəhd limiti işləməzdi
            if (error instanceof OtpError) await conn.commit().catch(() => {});
            else await conn.rollback().catch(() => {});
        }
        if (error instanceof OtpError) return otpErrorResponse(res, error);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                success: false,
                message: 'Bu nömrə ilə artıq hesab mövcuddur.'
            });
        }
        console.error('QR Register xətası:', error);
        return res.status(500).json({
            success: false,
            message: 'Server xətası baş verdi.'
        });
    } finally {
        if (conn) conn.release();
    }
};

/**
 * @desc    QR Menu İstifadəçi Girişi
 * @route   POST /api/qr-auth/login
 * @access  Public
 * Body: { nomre, sifre }
 * Qeyd: 'nomre' ölkə kodu ilə birlikdə gəlir (məs: +994501234567)
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

        if (!isValidPhone(nomre)) {
            return res.status(400).json({
                success: false,
                message: PHONE_FORMAT_MESSAGE
            });
        }

        // Find user by phone number
        const [rows] = await pool.execute(
            'SELECT id, ad, soyad, nomre, sifre, phone_verified_at, token_version FROM qr_users WHERE nomre = ?',
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
        const token = signQrUserToken(user);

        return res.status(200).json({
            success: true,
            message: 'Uğurla daxil oldunuz!',
            data: {
                token,
                user: {
                    id: user.id,
                    ad: user.ad,
                    soyad: user.soyad,
                    nomre: user.nomre,
                    phone_verified: Boolean(user.phone_verified_at)
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
 * @desc    Şifrə bərpası — "Şifrəni unutdum"
 * @route   POST /api/qr-auth/password/reset
 * @access  Public
 * Body: { nomre, request_id, kod, yeni_sifre }
 * `request_id` + `kod` — POST /otp/send ({ purpose: 'reset' }) cavabından.
 * Kod nömrənin sahibi olduğunu sübut edir — ona görə nömrə həm də təsdiqlənmiş sayılır.
 * Cavab login ilə eynidir ({ token, user }) — qonaq dərhal daxil olur.
 * token_version artırılır — digər cihazlardakı bütün sessiyalar bitir.
 */
const resetPassword = async (req, res) => {
    let conn;
    try {
        const { nomre, request_id, kod, yeni_sifre } = req.body;

        if (!nomre || !request_id || !kod || !yeni_sifre) {
            return res.status(400).json({
                success: false,
                message: 'Nömrə, kod və yeni şifrə tələb olunur.'
            });
        }
        if (!isValidPhone(nomre)) {
            return res.status(400).json({ success: false, message: PHONE_FORMAT_MESSAGE });
        }
        if (typeof yeni_sifre !== 'string' || yeni_sifre.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Yeni şifrə ən azı 6 simvol olmalıdır.'
            });
        }

        const hashedSifre = await bcrypt.hash(yeni_sifre, 10);

        conn = await pool.getConnection();
        await conn.beginTransaction();

        const otp = await verifyOtp(conn, { requestId: request_id, nomre, code: kod, purpose: 'reset' });

        const [rows] = await conn.execute(
            'SELECT id, ad, soyad, nomre, token_version FROM qr_users WHERE nomre = ? FOR UPDATE',
            [nomre]
        );
        const user = rows[0];
        if (!user) {
            await conn.rollback();
            return res.status(404).json({
                success: false,
                code: 'phone_not_found',
                message: 'Bu nömrə ilə hesab tapılmadı.'
            });
        }

        await conn.execute(
            `UPDATE qr_users
                SET sifre = ?, token_version = token_version + 1,
                    phone_verified_at = COALESCE(phone_verified_at, NOW())
              WHERE id = ?`,
            [hashedSifre, user.id]
        );
        await markOtpUsed(conn, otp.id);
        await conn.commit();

        const token = signQrUserToken({ ...user, token_version: Number(user.token_version) + 1 });

        return res.status(200).json({
            success: true,
            message: 'Şifrə yeniləndi!',
            data: {
                token,
                user: { id: user.id, ad: user.ad, soyad: user.soyad, nomre: user.nomre, phone_verified: true }
            }
        });

    } catch (error) {
        if (conn) {
            // Səhv kodda cəhd sayı yazılmalıdır — bax: register
            if (error instanceof OtpError) await conn.commit().catch(() => {});
            else await conn.rollback().catch(() => {});
        }
        if (error instanceof OtpError) return otpErrorResponse(res, error);
        console.error('QR ResetPassword xətası:', error);
        return res.status(500).json({
            success: false,
            message: 'Server xətası baş verdi.'
        });
    } finally {
        if (conn) conn.release();
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
            'SELECT id, ad, soyad, nomre, phone_verified_at IS NOT NULL AS phone_verified, created_at FROM qr_users WHERE id = ?',
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
            data: { ...rows[0], phone_verified: Boolean(rows[0].phone_verified) }
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
 * Şifrə dəyişəndə token_version artırılır — digər cihazlardakı sessiyalar bitir;
 * bu cihaz üçün yeni token cavabın kökündə qaytarılır (`token`).
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

        let setClause = fields.map(f => `${f} = ?`).join(', ');
        if (updates.sifre) setClause += ', token_version = token_version + 1';
        await pool.execute(
            `UPDATE qr_users SET ${setClause} WHERE id = ?`,
            [...values, userId]
        );

        // Return updated user (without sifre)
        const [updated] = await pool.execute(
            'SELECT id, ad, soyad, nomre, phone_verified_at IS NOT NULL AS phone_verified, token_version, created_at FROM qr_users WHERE id = ?',
            [userId]
        );
        const { token_version, ...user } = updated[0];

        return res.status(200).json({
            success: true,
            message: 'Profil uğurla yeniləndi!',
            data: { ...user, phone_verified: Boolean(user.phone_verified) },
            // Şifrə dəyişibsə köhnə token artıq keçmir — klient bunu saxlamalıdır
            ...(updates.sifre ? { token: signQrUserToken({ id: user.id, nomre: user.nomre, token_version }) } : {})
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
    sendOtp,
    register,
    login,
    resetPassword,
    getMe,
    updateProfile,
    sendReview
};
