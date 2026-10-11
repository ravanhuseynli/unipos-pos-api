const { Server } = require('socket.io');
const { pool } = require('../config/database');
const { verifyGuestToken } = require('../utils/tableToken');
const qrOrders = require('../services/qrOrder.service');

/**
 * Global socket — bütün restoranların kassaları və QR qonaqları bura qoşulur.
 *
 *   /pos   — kassalar. Giriş POS-un onsuz da istifadə etdiyi məlumatlarla:
 *            { restaurantName (username), terminalId, terminalPassword }
 *   /guest — qonaq yalnız ÖZ sifarişinin statusunu izləyir: { orderUuid, guestToken }
 *
 * Klient otağı ÖZÜ SEÇMİR: `join` hadisəsi yoxdur. Server girişi yoxlayır,
 * restoranı özü tapır və socket-i otağa özü qoşur — başqa restoranın
 * sifarişlərini görmək mümkün deyil.
 */

const FAILED_AUTH_LIMIT = { count: 10, windowMs: 10 * 60 * 1000 };
const failedAuth = new Map(); // ip → { count, resetAt }

const clientIp = (socket) =>
    String(socket.handshake.headers['x-forwarded-for'] || socket.handshake.address || '')
        .split(',')[0]
        .trim();

const isBlocked = (ip) => {
    const entry = failedAuth.get(ip);
    if (!entry) return false;
    if (entry.resetAt < Date.now()) {
        failedAuth.delete(ip);
        return false;
    }
    return entry.count >= FAILED_AUTH_LIMIT.count;
};

const recordFailure = (ip) => {
    const now = Date.now();
    const entry = failedAuth.get(ip);
    if (!entry || entry.resetAt < now) failedAuth.set(ip, { count: 1, resetAt: now + FAILED_AUTH_LIMIT.windowMs });
    else entry.count += 1;
};

const authError = (code) => {
    const err = new Error(code);
    err.data = { code };
    return err;
};

/** POST /api/pos/profile ilə eyni yoxlama: username + terminal_id + terminal_password */
const authenticatePos = async (socket, next) => {
    const ip = clientIp(socket);
    if (isBlocked(ip)) return next(authError('too_many_attempts'));

    try {
        const { restaurantName, terminalId, terminalPassword } = socket.handshake.auth || {};
        if (!restaurantName || !terminalId || terminalPassword === undefined || terminalPassword === null) {
            recordFailure(ip);
            return next(authError('invalid_credentials'));
        }

        const [rows] = await pool.execute(
            `SELECT p.id AS profile_id, tg.terminal_id, tg.terminal_password, tg.is_master
               FROM profiles p
               JOIN terminal_groups tg ON tg.profile_id = p.id
              WHERE p.username = ? AND tg.terminal_id = ?
              LIMIT 1`,
            [String(restaurantName), String(terminalId)]
        );
        const terminal = rows[0];
        if (!terminal || String(terminal.terminal_password) !== String(terminalPassword)) {
            recordFailure(ip);
            return next(authError('invalid_credentials'));
        }

        // Sifarişi master kassa qəbul edir. Restoranda master təyin olunmayıbsa
        // (tək kassalı restoranlar), hər kassa master sayılır.
        let isMaster = Number(terminal.is_master) === 1;
        if (!isMaster) {
            const [[{ masters }]] = await pool.execute(
                'SELECT COUNT(*) AS masters FROM terminal_groups WHERE profile_id = ? AND is_master = 1',
                [terminal.profile_id]
            );
            isMaster = Number(masters) === 0;
        }

        socket.data.profileId = Number(terminal.profile_id);
        socket.data.terminalId = Number(terminal.terminal_id);
        socket.data.isMaster = isMaster;
        return next();
    } catch (error) {
        console.error('POS socket auth error:', error);
        return next(authError('server_error'));
    }
};

const onPosConnection = (socket) => {
    const { profileId, terminalId, isMaster } = socket.data;
    socket.join(qrOrders.restaurantRoom(profileId));
    if (isMaster) socket.join(qrOrders.masterRoom(profileId));

    socket.emit('qr:ready', { profileId, terminalId, isMaster });

    socket.on('qr:order:status', async (data, ack) => {
        let result;
        try {
            result = await qrOrders.applyPosStatus(profileId, data);
        } catch (error) {
            console.error('QR order status error:', error);
            result = { ok: false, error: 'server_error' };
        }
        if (typeof ack === 'function') ack(result);
    });

    if (isMaster) {
        qrOrders.flushPending(profileId).catch((err) => console.error('QR flush error:', err));
    }
};

const authenticateGuest = (socket, next) => {
    const { orderUuid, guestToken } = socket.handshake.auth || {};
    try {
        if (!orderUuid || !verifyGuestToken(String(orderUuid).toLowerCase(), guestToken)) {
            return next(authError('invalid_order'));
        }
    } catch (error) {
        return next(authError('server_error'));
    }
    socket.data.orderUuid = String(orderUuid).toLowerCase();
    return next();
};

const onGuestConnection = async (socket) => {
    const { orderUuid } = socket.data;
    socket.join(qrOrders.orderRoom(orderUuid));
    try {
        const order = await qrOrders.getOrderForGuest(orderUuid);
        if (order) socket.emit('qr:order:status', order);
    } catch (error) {
        console.error('Guest socket status error:', error);
    }
};

function initSocket(httpServer) {
    const origins = (process.env.SOCKET_CORS_ORIGIN || '*').split(',').map((o) => o.trim()).filter(Boolean);
    const io = new Server(httpServer, {
        cors: { origin: origins.includes('*') ? '*' : origins },
    });

    const pos = io.of('/pos');
    pos.use(authenticatePos);
    pos.on('connection', onPosConnection);

    const guest = io.of('/guest');
    guest.use(authenticateGuest);
    guest.on('connection', onGuestConnection);

    // Kök namespace istifadə olunmur
    io.of('/').use((socket, next) => next(authError('use_namespace')));

    qrOrders.attachNamespaces({ pos, guest });

    setInterval(() => {
        qrOrders.expirePending().catch((err) => console.error('QR expire error:', err));
    }, 60 * 1000).unref();

    return io;
}

module.exports = { initSocket };
