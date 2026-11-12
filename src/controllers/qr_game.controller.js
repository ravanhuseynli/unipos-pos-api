const qrGame = require('../services/qrGame.service');
const { verifyQrUserToken, QrSessionError } = require('../utils/qrUserToken');

/**
 * QR oyunu — müqavilə: `unipos-qr-next/docs/QR_GAME.md`.
 * Xətalar `{ success: false, code, message }` — klient `code`-a görə mətn göstərir.
 */

const fail = (res, err, label) => {
    if (err instanceof qrGame.GameError || err instanceof QrSessionError) {
        return res.status(err.status).json({ success: false, code: err.code, message: err.message });
    }
    console.error(`QR oyun (${label}):`, err);
    return res.status(500).json({ success: false, code: 'server_error', message: 'Server xətası baş verdi.' });
};

/** Token varsa yoxlanır (etibarsızdırsa 401), yoxdursa qonaq — req.qrUser = null */
const optionalAuth = async (req, res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        req.qrUser = null;
        return next();
    }
    try {
        const { decoded } = await verifyQrUserToken(header.split(' ')[1]);
        req.qrUser = decoded;
        return next();
    } catch (err) {
        return fail(res, err, 'auth');
    }
};

const wrap = (label, fn) => async (req, res) => {
    try {
        res.json({ success: true, data: await fn(req) });
    } catch (err) {
        fail(res, err, label);
    }
};

module.exports = {
    optionalAuth,
    info: wrap('info', (req) => qrGame.publicInfo(req.params.username)),
    start: wrap('start', (req) => qrGame.startRound(req.params.username, req.qrUser, req.ip)),
    finish: wrap('finish', (req) => qrGame.finishRound(req.params.id, req.body, req.qrUser)),
    claim: wrap('claim', (req) => qrGame.claimRounds(req.params.username, req.body?.rounds, req.qrUser)),
    me: wrap('me', (req) => qrGame.myState(req.params.username, req.qrUser)),
    redeem: wrap('redeem', (req) => qrGame.redeem(req.params.username, req.body?.reward, req.qrUser)),
};
