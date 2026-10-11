const qrOrders = require('../services/qrOrder.service');
const { verifyGuestToken } = require('../utils/tableToken');

const clientIp = (req) =>
    String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '')
        .split(',')[0]
        .trim()
        .slice(0, 45);

const handleError = (res, error, label) => {
    if (error instanceof qrOrders.QrOrderError) {
        return res.status(error.status).json({ success: false, code: error.code, message: error.message });
    }
    console.error(`${label} xətası:`, error);
    return res.status(500).json({ success: false, code: 'server_error', message: 'Server xətası baş verdi.' });
};

/**
 * @desc    Masa QR-ının məlumatı: masa, zal, sifariş rejimi, restoran onlayndırmı
 * @route   GET /api/qr-orders/table/:token?r=<username>
 * @access  Public (token imzalıdır)
 */
const getTable = async (req, res) => {
    try {
        const data = await qrOrders.describeTable({ token: req.params.token, username: req.query.r });
        res.json({ success: true, data });
    } catch (error) {
        handleError(res, error, 'QR table');
    }
};

/**
 * @desc    QR-dan sifariş — qiymətlər serverdə hesablanır, kassaya socket ilə gedir
 * @route   POST /api/qr-orders
 * @body    { token, r, orderUuid?, note?, guestCount?, items: [{ productId, quantity, comment?, modifiers?: [{ id, count }] }] }
 * @access  Public (token imzalıdır)
 */
const createOrder = async (req, res) => {
    try {
        const { order, guestToken, created } = await qrOrders.createOrder({ body: req.body, ip: clientIp(req) });
        res.status(created ? 201 : 200).json({ success: true, data: { ...order, guestToken } });
    } catch (error) {
        handleError(res, error, 'QR order create');
    }
};

/**
 * @desc    Sifarişin statusu (socket əlçatan olmayanda polling üçün)
 * @route   GET /api/qr-orders/:uuid?guestToken=...
 * @access  Public (guestToken ilə)
 */
const getOrder = async (req, res) => {
    try {
        const uuid = String(req.params.uuid || '').toLowerCase();
        if (!verifyGuestToken(uuid, req.query.guestToken)) {
            return res.status(404).json({ success: false, code: 'order_not_found', message: 'Sifariş tapılmadı.' });
        }
        const order = await qrOrders.getOrderForGuest(uuid);
        if (!order) return res.status(404).json({ success: false, code: 'order_not_found', message: 'Sifariş tapılmadı.' });
        res.json({ success: true, data: order });
    } catch (error) {
        handleError(res, error, 'QR order status');
    }
};

module.exports = { getTable, createOrder, getOrder };
