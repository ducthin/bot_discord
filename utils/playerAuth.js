const crypto = require('node:crypto');
const { isIP } = require('node:net');

const CODE_TTL = 5 * 60_000;
const IDLE_TTL = 30 * 24 * 60 * 60_000;
const MAX_TTL = 90 * 24 * 60 * 60_000;
const COOKIE = 'may_player';
const fail = (status, message) => Object.assign(new Error(message), { status });
const digest = token => crypto.createHash('sha256').update(token).digest('hex');
const loopback = value => value === '127.0.0.1' || value === '::1' || /^::ffff:127\./.test(value ?? '');

function loginAddress(req, config) {
    const address = req.socket.remoteAddress;
    const forwarded = req.headers['x-forwarded-for'];
    // The local HTTPS proxy replaces this header with its connection's client IP.
    // Direct clients and HTTP tunnels cannot supply a trusted forwarding header.
    if (config.secure && loopback(address) && req.headers['x-forwarded-proto'] === 'https' &&
        typeof forwarded === 'string' && isIP(forwarded)) return forwarded;
    return address ?? 'unknown';
}

function parsePlayerConfig(env = process.env) {
    if (env.PLAYER_ENABLED !== 'true') return { enabled: false };
    let url;
    try { url = new URL(env.PLAYER_ORIGIN || env.ADMIN_ORIGIN); }
    catch { throw new Error('PLAYER_ORIGIN phải là địa chỉ đầy đủ của trang người chơi.'); }
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash) throw new Error('Trang người chơi cần HTTPS hoặc HTTP localhost qua SSH.');
    return { enabled: true, origin: url.origin, host: url.host.toLowerCase(), local, secure: url.protocol === 'https:' };
}

function createCodeBroker({ now = Date.now } = {}) {
    const codes = new Map();
    const prune = () => { for (const [key, item] of codes) if (item.expiresAt <= now()) codes.delete(key); };
    function issue(owner) {
        if (!/^[1-9]\d{0,19}$/.test(owner.guildId) || !/^[1-9]\d{0,19}$/.test(owner.userId)) throw new Error('Invalid player identity.');
        prune();
        for (const [key, item] of codes) if (item.owner.guildId === owner.guildId && item.owner.userId === owner.userId) codes.delete(key);
        if (codes.size >= 4096) codes.delete(codes.keys().next().value);
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        const raw = Array.from({ length: 16 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
        const expiresAt = now() + CODE_TTL;
        codes.set(digest(raw), { owner: structuredClone(owner), expiresAt, consuming: false });
        return { code: raw.match(/.{4}/g).join('-'), expiresAt };
    }
    async function consume(code, validateOwner) {
        prune();
        const raw = typeof code === 'string' ? code.replace(/[\s-]/g, '').toUpperCase() : '';
        if (!/^[A-HJ-NP-Z2-9]{16}$/.test(raw)) throw fail(401, 'Mã đăng nhập chưa đúng. Dùng /web trong Discord để lấy mã mới.');
        const key = digest(raw);
        const item = codes.get(key);
        if (!item || item.consuming) throw fail(401, 'Mã đã hết hạn hoặc đã được dùng. Hãy lấy mã mới bằng /web.');
        item.consuming = true;
        try {
            await validateOwner(item.owner);
            if (codes.get(key) !== item || item.expiresAt <= now()) throw fail(401, 'Mã đã hết hạn. Hãy lấy mã mới bằng /web.');
            codes.delete(key);
            return structuredClone(item.owner);
        } catch (error) { item.consuming = false; throw error; }
    }
    return { issue, consume };
}

const codeBroker = createCodeBroker();

function createPlayerAuth(config, { broker = codeBroker, now = Date.now, validateOwner = async () => {}, sessionStore } = {}) {
    const sessions = new Map();
    const attempts = new Map();
    const prune = () => {
        const time = now();
        for (const [key, value] of sessions) if (value.expiresAt <= time || value.createdAt + MAX_TTL <= time) sessions.delete(key);
        for (const [key, value] of attempts) if (value.until <= time) attempts.delete(key);
    };
    function validateRequest(req, mutation = false) {
        if (!config.enabled) throw fail(404, 'Trang người chơi chưa được bật.');
        if (req.headers.host?.toLowerCase() !== config.host) throw fail(403, 'Địa chỉ trang không hợp lệ.');
        if (config.local && !loopback(req.socket.remoteAddress)) throw fail(403, 'Mở trang qua kết nối SSH trên máy của bạn.');
        if (config.secure && !req.socket.encrypted && !(loopback(req.socket.remoteAddress) && req.headers['x-forwarded-proto'] === 'https')) {
            throw fail(403, 'Trang người chơi yêu cầu HTTPS.');
        }
        const pathname = req.url?.split('?')[0];
        const pageNavigation = !mutation && ['GET', 'HEAD'].includes(req.method) &&
            (pathname === '/play' || pathname === '/play/') &&
            req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document';
        if ((req.headers.origin && req.headers.origin !== config.origin) || (mutation && req.headers.origin !== config.origin) ||
            (req.headers['sec-fetch-site'] === 'cross-site' && !pageNavigation)) throw fail(403, 'Nguồn yêu cầu không hợp lệ.');
    }
    const cookie = (token, clear = false) => `${COOKIE}=${token}; Path=/play; HttpOnly; SameSite=Strict${config.secure ? '; Secure' : ''}; Max-Age=${clear ? 0 : MAX_TTL / 1000}`;
    async function session(req, renew = true) {
        prune();
        const token = req.headers.cookie?.split(';').map(item => item.trim()).find(item => item.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
        if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
        const key = digest(token);
        if (sessionStore) {
            const time = now();
            const result = await sessionStore.query(`SELECT owner, created_at, expires_at, csrf_token, mutations, window_until
                FROM discord_bot.player_sessions
                WHERE token_hash = $1 AND expires_at > $2 AND created_at + $3 > $2`, [key, time, MAX_TTL]);
            const row = result.rows[0];
            if (!row) return null;
            const value = { owner: typeof row.owner === 'string' ? JSON.parse(row.owner) : row.owner,
                createdAt: Number(row.created_at), expiresAt: Number(row.expires_at), csrfToken: row.csrf_token,
                mutations: Number(row.mutations), windowUntil: Number(row.window_until) };
            if (renew) {
                const renewed = await sessionStore.query(`UPDATE discord_bot.player_sessions
                    SET expires_at = LEAST($2, created_at + $3)
                    WHERE token_hash = $1 AND expires_at > $4 AND created_at + $3 > $4
                    RETURNING expires_at`, [key, time + IDLE_TTL, MAX_TTL, time]);
                if (!renewed.rows[0]) return null;
                value.expiresAt = Number(renewed.rows[0].expires_at);
            }
            return { ...value, key, cookie: cookie(token), owner: structuredClone(value.owner) };
        }
        const value = sessions.get(key);
        if (!value) return null;
        if (renew) value.expiresAt = Math.min(now() + IDLE_TTL, value.createdAt + MAX_TTL);
        return { ...value, key, cookie: cookie(token), owner: structuredClone(value.owner) };
    }
    async function requireSession(req, mutation = false) {
        const value = await session(req);
        return requireSessionValue(value, req, mutation);
    }
    function requireSessionValue(value, req, mutation) {
        if (!value) throw fail(401, 'Hãy đăng nhập bằng mã từ lệnh /web trong Discord.');
        if (mutation) {
            const csrf = req.headers['x-csrf-token'];
            if (typeof csrf !== 'string' || !/^[a-f0-9]{64}$/.test(csrf) ||
                !crypto.timingSafeEqual(Buffer.from(csrf), Buffer.from(value.csrfToken))) throw fail(403, 'Phiên xác nhận chưa hợp lệ. Tải lại trang rồi thử lại.');
            const time = now();
            if (sessionStore) return sessionStore.query(`UPDATE discord_bot.player_sessions
                    SET window_until = CASE WHEN window_until <= $2 THEN $2 + 60000 ELSE window_until END,
                        mutations = CASE WHEN window_until <= $2 THEN 1 ELSE mutations + 1 END
                    WHERE token_hash = $1 AND expires_at > $2 AND created_at + $3 > $2
                        AND (window_until <= $2 OR mutations < 60)
                    RETURNING mutations, window_until`, [value.key, time, MAX_TTL]).then(updated => {
                if (!updated.rows[0]) throw fail(429, 'Thao tác quá nhanh. Hãy đợi một phút.');
                value.mutations = Number(updated.rows[0].mutations);
                value.windowUntil = Number(updated.rows[0].window_until);
                return value;
            });
            else {
                if (value.windowUntil <= time) { value.windowUntil = time + 60_000; value.mutations = 0; }
                if (value.mutations >= 60) throw fail(429, 'Thao tác quá nhanh. Hãy đợi một phút.');
                value.mutations++;
                Object.assign(sessions.get(value.key), { windowUntil: value.windowUntil, mutations: value.mutations });
            }
        }
        return value;
    }
    async function login(req, code) {
        prune();
        const ip = loginAddress(req, config);
        const attempt = attempts.get(ip) ?? { count: 0, until: now() + 15 * 60_000 };
        if (attempt.count >= 10) throw fail(429, 'Đã thử đăng nhập quá nhiều lần. Hãy đợi 15 phút.');
        if (attempts.size >= 2048 && !attempts.has(ip)) attempts.delete(attempts.keys().next().value);
        attempt.count++;
        attempts.set(ip, attempt);
        const owner = await broker.consume(code, validateOwner);
        attempts.delete(ip);
        const previous = await session(req, false);
        if (previous) {
            if (sessionStore) await sessionStore.query('DELETE FROM discord_bot.player_sessions WHERE token_hash = $1', [previous.key]);
            else sessions.delete(previous.key);
        }
        if (!sessionStore && sessions.size >= 4096) sessions.delete(sessions.keys().next().value);
        const token = crypto.randomBytes(32).toString('hex');
        const value = { owner, createdAt: now(), expiresAt: now() + IDLE_TTL,
            csrfToken: crypto.randomBytes(32).toString('hex'), mutations: 0, windowUntil: now() + 60_000 };
        const key = digest(token);
        if (sessionStore) {
            await sessionStore.query(`DELETE FROM discord_bot.player_sessions
                WHERE expires_at <= $1 OR created_at + $2 <= $1`, [value.createdAt, MAX_TTL]);
            await sessionStore.query(`INSERT INTO discord_bot.player_sessions
                (token_hash, owner, created_at, expires_at, csrf_token, mutations, window_until)
                VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [key, value.owner, value.createdAt, value.expiresAt, value.csrfToken, value.mutations, value.windowUntil]);
        } else sessions.set(key, value);
        return { owner, csrfToken: value.csrfToken, cookie: cookie(token) };
    }
    async function logout(req) {
        const value = await requireSession(req, true);
        if (sessionStore) await sessionStore.query('DELETE FROM discord_bot.player_sessions WHERE token_hash = $1', [value.key]);
        else sessions.delete(value.key);
        return cookie('', true);
    }
    return { validateRequest, session, requireSession, login, logout };
}

module.exports = { CODE_TTL, IDLE_TTL, MAX_TTL, parsePlayerConfig, createCodeBroker, codeBroker, createPlayerAuth };
