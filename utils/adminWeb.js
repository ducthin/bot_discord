const fs = require('node:fs/promises');
const path = require('node:path');
const { createAdminAuth, parseAdminConfig } = require('./adminAuth');

const STATIC_ROOT = path.join(__dirname, '..', 'web', 'admin');
const MAX_BODY = 8192;
const staticFiles = new Map([['/admin/', ['index.html', 'text/html; charset=utf-8']],
    ['/admin/admin.css', ['admin.css', 'text/css; charset=utf-8']],
    ['/admin/admin.js', ['admin.js', 'text/javascript; charset=utf-8']]]);
const fail = (status, message) => Object.assign(new Error(message), { status });

function headers(res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
}

function json(res, status, payload, head = false) {
    const body = JSON.stringify(payload);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
    res.end(head ? undefined : body);
}

async function readBody(req) {
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) throw fail(415, 'Yêu cầu phải có dữ liệu JSON.');
    const length = Number(req.headers['content-length']);
    if (Number.isFinite(length) && length > MAX_BODY) throw fail(413, 'Dữ liệu yêu cầu quá lớn.');
    const chunks = [];
    let size = 0;
    const timer = setTimeout(() => req.destroy(), 5000);
    timer.unref?.();
    try {
        for await (const chunk of req) {
            size += chunk.length;
            if (size > MAX_BODY) throw fail(413, 'Dữ liệu yêu cầu quá lớn.');
            chunks.push(chunk);
        }
    } finally { clearTimeout(timer); }
    let value;
    try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail(400, 'Dữ liệu JSON không hợp lệ.'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(400, 'Dữ liệu yêu cầu không hợp lệ.');
    return value;
}

function createAdminHandler({ client, commands, isShuttingDown = () => false, config = parseAdminConfig(), service } = {}) {
    if (!config.enabled) return null;
    const auth = createAdminAuth(config);
    service ??= require('./adminService').createAdminService({ client, commands, isShuttingDown });
    return async function adminHandler(req, res) {
        const pathname = req.url?.split('?')[0];
        if (pathname !== '/admin' && !pathname?.startsWith('/admin/')) return false;
        headers(res);
        try {
            const mutation = !['GET', 'HEAD'].includes(req.method);
            auth.validateRequest(req, mutation);
            if (pathname === '/admin') {
                if (mutation) throw fail(405, 'Phương thức không được hỗ trợ.');
                res.writeHead(302, { Location: '/admin/' });
                res.end();
                return true;
            }
            const staticFile = staticFiles.get(pathname);
            if (staticFile) {
                if (mutation) throw fail(405, 'Phương thức không được hỗ trợ.');
                const body = await fs.readFile(path.join(STATIC_ROOT, staticFile[0]));
                res.writeHead(200, { 'Content-Type': staticFile[1], 'Content-Length': body.length });
                res.end(req.method === 'HEAD' ? undefined : body);
                return true;
            }
            if (pathname === '/admin/api/session' && req.method === 'GET') {
                const current = auth.session(req);
                json(res, 200, { configured: true, authenticated: Boolean(current), ...(current ? { csrfToken: current.csrfToken } : {}) });
                return true;
            }
            if (pathname === '/admin/api/login' && req.method === 'POST') {
                const body = await readBody(req);
                const current = await auth.login(req, body.password);
                res.setHeader('Set-Cookie', current.cookie);
                json(res, 200, { configured: true, authenticated: true, csrfToken: current.csrfToken });
                return true;
            }
            auth.requireSession(req, mutation);
            if (isShuttingDown()) throw fail(503, 'Bot đang khởi động lại. Vui lòng thử lại sau.');
            if (pathname === '/admin/api/logout' && req.method === 'POST') {
                res.setHeader('Set-Cookie', auth.logout(req));
                json(res, 200, { authenticated: false });
                return true;
            }
            const art = /^\/admin\/art\/(battle-[a-z0-9-]+)\.png$/.exec(pathname);
            if (art && !mutation) {
                const image = require('./cs2BattleArt').getBattleCaseArt(art[1]);
                if (!image) throw fail(404, 'Không tìm thấy ảnh hòm.');
                res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': image.buffer.length });
                res.end(req.method === 'HEAD' ? undefined : image.buffer);
                return true;
            }
            let output;
            if (req.method === 'GET') {
                if (pathname === '/admin/api/overview') output = await service.overview();
                else if (pathname === '/admin/api/catalogue') output = await service.catalogue();
                else if (pathname === '/admin/api/activity') output = { activity: await service.activity() };
                else {
                    const guild = /^\/admin\/api\/guilds\/(\d{1,20})$/.exec(pathname);
                    const members = /^\/admin\/api\/guilds\/(\d{1,20})\/members$/.exec(pathname);
                    if (members) output = await service.members(members[1], new URL(req.url, config.origin).searchParams.get('search') ?? '');
                    else if (guild) output = await service.guild(guild[1]);
                    else throw fail(404, 'Không tìm thấy chức năng.');
                }
            } else if (req.method === 'POST') {
                const body = await readBody(req);
                if (pathname === '/admin/api/prices/refresh') output = await service.refreshPrices();
                else {
                    const route = /^\/admin\/api\/guilds\/(\d{1,20})\/(music|settings|coins)$/.exec(pathname);
                    const cancel = /^\/admin\/api\/guilds\/(\d{1,20})\/battles\/([a-zA-Z0-9-]{1,100})\/cancel$/.exec(pathname);
                    if (route) output = await service[route[2]](route[1], body);
                    else if (cancel) output = await service.cancelBattle(cancel[1], cancel[2]);
                    else throw fail(404, 'Không tìm thấy chức năng.');
                }
            } else throw fail(405, 'Phương thức không được hỗ trợ.');
            json(res, 200, output ?? { ok: true });
        } catch (error) {
            if (res.destroyed || res.writableEnded) return true;
            const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
            if (status === 500) console.error('Lỗi trang quản trị:', error.code ?? error.name);
            json(res, status, { error: `HTTP_${status}`, message: status === 500 ? 'Chưa thể xử lý yêu cầu. Kiểm tra kết nối bot và PostgreSQL rồi thử lại.' : error.message }, req.method === 'HEAD');
        }
        return true;
    };
}

module.exports = { createAdminHandler };
