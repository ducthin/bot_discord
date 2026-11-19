const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const SESSION_IDLE_MS = 30 * 60_000;
const SESSION_MAX_MS = 12 * 60 * 60_000;
const LOGIN_WINDOW_MS = 15 * 60_000;
const COOKIE = 'bot_admin';

function validPasswordHash(hash) {
    return typeof hash === 'string' && /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(hash);
}

async function hashPassword(password) {
    if (typeof password !== 'string' || password.length < 12 || password.length > 256) {
        throw new Error('Mật khẩu phải có từ 12 đến 256 ký tự.');
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const key = await scrypt(password, salt, 64);
    return `scrypt$${salt}$${key.toString('hex')}`;
}

async function verifyPassword(password, hash) {
    if (!validPasswordHash(hash) || typeof password !== 'string' || password.length > 256) return false;
    const [, salt, expected] = hash.split('$');
    const key = await scrypt(password, salt, 64);
    return crypto.timingSafeEqual(key, Buffer.from(expected, 'hex'));
}

function loopback(address = '') {
    return address === '127.0.0.1' || address === '::1' || address.startsWith('::ffff:127.');
}

function parseAdminConfig(env = process.env) {
    const enabled = env.ADMIN_ENABLED === 'true';
    if (!enabled) return { enabled: false };
    if (!validPasswordHash(env.ADMIN_PASSWORD_HASH)) throw new Error('ADMIN_PASSWORD_HASH chưa hợp lệ. Chạy scripts/admin-password.js để thiết lập.');
    let url;
    try { url = new URL(env.ADMIN_ORIGIN); } catch { throw new Error('ADMIN_ORIGIN phải là địa chỉ đầy đủ của trang quản trị.'); }
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash) throw new Error('Trang quản trị cần HTTPS hoặc HTTP qua localhost. ADMIN_ORIGIN chỉ gồm giao thức, tên miền và cổng.');
    if (url.protocol === 'https:' && env.ADMIN_COOKIE_SECURE === 'false') throw new Error('Cookie quản trị HTTPS phải bật Secure.');
    return { enabled: true, passwordHash: env.ADMIN_PASSWORD_HASH, origin: url.origin,
        host: url.host.toLowerCase(), secure: url.protocol === 'https:', local };
}

function createAdminAuth(config, { now = Date.now } = {}) {
    const sessions = new Map();
    const attempts = new Map();
    let hashing = 0;
    const digest = token => crypto.createHash('sha256').update(token).digest('hex');
    const fail = (status, message) => Object.assign(new Error(message), { status });
    function validateRequest(req, mutation = false) {
        if (!config.enabled) throw fail(404, 'Trang quản trị chưa được bật.');
        if (req.headers.host?.toLowerCase() !== config.host) throw fail(403, 'Địa chỉ trang quản trị không hợp lệ.');
        if (config.local && !loopback(req.socket.remoteAddress)) throw fail(403, 'Dùng kết nối localhost hoặc SSH tunnel để mở trang quản trị.');
        if (config.secure && !req.socket.encrypted && !(loopback(req.socket.remoteAddress) && req.headers['x-forwarded-proto'] === 'https')) {
            throw fail(403, 'Trang quản trị yêu cầu kết nối HTTPS.');
        }
        if (req.headers.origin && req.headers.origin !== config.origin) throw fail(403, 'Nguồn yêu cầu không hợp lệ.');
        if (mutation && req.headers.origin !== config.origin) throw fail(403, 'Thiếu xác thực nguồn yêu cầu.');
        if (req.headers['sec-fetch-site'] === 'cross-site') throw fail(403, 'Nguồn yêu cầu không hợp lệ.');
    }
    function prune() {
        const time = now();
        for (const [id, session] of sessions) if (session.expiresAt <= time || session.createdAt + SESSION_MAX_MS <= time) sessions.delete(id);
        for (const [ip, attempt] of attempts) if (attempt.until <= time) attempts.delete(ip);
    }
    function session(req, renew = true) {
        prune();
        const token = req.headers.cookie?.split(';').map(item => item.trim()).find(item => item.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
        if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
        const id = digest(token);
        const current = sessions.get(id);
        if (!current) return null;
        if (renew) current.expiresAt = Math.min(now() + SESSION_IDLE_MS, current.createdAt + SESSION_MAX_MS);
        return { ...current, id };
    }
    function requireSession(req, mutation = false) {
        const current = session(req);
        if (!current) throw fail(401, 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
        if (mutation) {
            const token = req.headers['x-csrf-token'];
            if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) ||
                !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(current.csrfToken))) throw fail(403, 'Mã xác nhận phiên không hợp lệ. Tải lại trang rồi thử lại.');
        }
        return current;
    }
    async function login(req, password) {
        prune();
        // Use the connection address, never an untrusted X-Forwarded-For value.
        const ip = req.socket.remoteAddress ?? 'unknown';
        const attempt = attempts.get(ip) ?? { count: 0, until: now() + LOGIN_WINDOW_MS };
        if (attempt.count >= 5) throw fail(429, 'Bạn đã thử đăng nhập nhiều lần. Hãy thử lại sau 15 phút.');
        if (hashing >= 2) throw fail(429, 'Đang xử lý đăng nhập. Vui lòng thử lại sau.');
        attempt.count++;
        if (attempts.size >= 1024 && !attempts.has(ip)) attempts.delete(attempts.keys().next().value);
        attempts.set(ip, attempt);
        hashing++;
        let valid;
        try { valid = await verifyPassword(password, config.passwordHash); } finally { hashing--; }
        if (!valid) throw fail(401, 'Mật khẩu không đúng.');
        attempts.delete(ip);
        const previous = session(req, false);
        if (previous) sessions.delete(previous.id);
        if (sessions.size >= 128) sessions.delete(sessions.keys().next().value);
        const token = crypto.randomBytes(32).toString('hex');
        const current = { createdAt: now(), expiresAt: now() + SESSION_IDLE_MS, csrfToken: crypto.randomBytes(32).toString('hex') };
        sessions.set(digest(token), current);
        return { ...current, cookie: cookie(token) };
    }
    function cookie(token, clear = false) {
        return `${COOKIE}=${token}; Path=/admin; HttpOnly; SameSite=Strict${config.secure ? '; Secure' : ''}; Max-Age=${clear ? 0 : SESSION_MAX_MS / 1000}`;
    }
    function logout(req) {
        const current = requireSession(req, true);
        sessions.delete(current.id);
        return cookie('', true);
    }
    return { validateRequest, session, requireSession, login, logout };
}

module.exports = { createAdminAuth, parseAdminConfig, hashPassword, verifyPassword, validPasswordHash, SESSION_IDLE_MS, SESSION_MAX_MS };
