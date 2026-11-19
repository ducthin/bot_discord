const fs = require('node:fs/promises');
const path = require('node:path');
const { createPlayerAuth, parsePlayerConfig } = require('./playerAuth');
const { handlePlayerSkinImage } = require('./playerAssets');
const { handlePlayerAudio } = require('./playerAudio');
const { botProfiles } = require('./playerBattleBotProfiles');
const ROOT = path.join(__dirname, '..', 'web', 'play');
const botAvatars = new Map(botProfiles.map(profile => [profile.avatar, `${profile.id}.svg`]));
const files = new Map([['/play/club-assets/heist-background.jpg', ['club-assets/heist-background.jpg', 'image/jpeg']],['/play/', ['index.html', 'text/html; charset=utf-8']],
    ['/play/play.css', ['play.css', 'text/css; charset=utf-8']], ['/play/app.css', ['app.css', 'text/css; charset=utf-8']],
    ['/play/activities.css', ['activities.css', 'text/css; charset=utf-8']],
    ['/play/app.js', ['app.js', 'text/javascript; charset=utf-8']], ['/play/play.js', ['play.js', 'text/javascript; charset=utf-8']],
    ['/play/audio.js', ['audio.js', 'text/javascript; charset=utf-8']],
    ['/play/battle-modes.js', ['../../utils/playerBattleModes.js', 'text/javascript; charset=utf-8']],
    ['/play/battle-presentation.js', ['battle-presentation.js', 'text/javascript; charset=utf-8']]]);
const fail = (status, message) => Object.assign(new Error(message), { status });
const json = (res, status, value, head = false) => {
    const body = JSON.stringify(value);
    const serverNow = Date.now();
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body),
        'X-Server-Time': String(serverNow),
        'X-Server-Elapsed': String(Math.max(0, serverNow - (res.playerRequestStartedAt ?? serverNow))) });
    res.end(head ? undefined : body);
};
async function readBody(req, limit = 16_384) {
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) throw fail(415, 'Yêu cầu cần dữ liệu JSON.');
    if (Number(req.headers['content-length']) > limit) throw fail(413, 'Dữ liệu quá lớn.');
    let size = 0;
    const chunks = [];
    const timer = setTimeout(() => req.destroy(), 5000);
    timer.unref?.();
    try { for await (const chunk of req) { size += chunk.length; if (size > limit) throw fail(413, 'Dữ liệu quá lớn.'); chunks.push(chunk); } }
    finally { clearTimeout(timer); }
    let value;
    try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail(400, 'Dữ liệu JSON chưa hợp lệ.'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(400, 'Dữ liệu chưa hợp lệ.');
    return value;
}
function createPlayerHandler({ client, isShuttingDown = () => false, config = parsePlayerConfig(), service, broker, sessionStore, demo = false } = {}) {
    if (!config.enabled) return null;
    service ??= require('./playerService').createPlayerService({ client, isShuttingDown });
    const auth = createPlayerAuth(config, { broker, sessionStore, validateOwner: owner => service.validateOwner(owner) });
    const publicSession = current => ({ app: 'may-skins', authenticated: Boolean(current), ...(demo ? { demo: true } : {}),
        ...(current ? { user: current.owner, csrfToken: current.csrfToken } : {}) });
    return async (req, res) => {
        const pathname = req.url?.split('?')[0];
        if (pathname !== '/play' && !pathname?.startsWith('/play/')) return false;
        res.playerRequestStartedAt = Date.now();
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
        res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
        try {
            const mutation = !['GET', 'HEAD'].includes(req.method);
            auth.validateRequest(req, mutation);
            if (!mutation && await handlePlayerAudio(req, res, pathname)) return true;
            if (!mutation && await handlePlayerSkinImage(req, res, pathname)) return true;
            if (!mutation && botAvatars.has(pathname)) {
                const buffer = await fs.readFile(path.join(ROOT, 'bot-avatars', botAvatars.get(pathname)));
                res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Content-Length': buffer.length,
                    'Cache-Control': 'public, max-age=86400' });
                res.end(req.method === 'HEAD' ? undefined : buffer);
                return true;
            }
            if (pathname === '/play' && !mutation) { res.writeHead(302, { Location: '/play/' }); res.end(); return true; }
            if (files.has(pathname) && !mutation) {
                const [file, type] = files.get(pathname);
                const buffer = await fs.readFile(path.join(ROOT, file));
                res.writeHead(200, { 'Content-Type': type, 'Content-Length': buffer.length });
                res.end(req.method === 'HEAD' ? undefined : buffer);
                return true;
            }
            const art = /^\/play\/art\/(battle-[a-z0-9-]+)\.png$/.exec(pathname);
            if (art && !mutation) {
                const image = require('./cs2BattleArt').getBattleCaseArt(art[1]);
                if (!image) throw fail(404, 'Không tìm thấy ảnh hòm.');
                res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': image.buffer.length, 'Cache-Control': 'public, max-age=86400' });
                res.end(req.method === 'HEAD' ? undefined : image.buffer);
                return true;
            }
            if (pathname === '/play/api/session' && req.method === 'GET') {
                const current = await auth.session(req);
                if (current?.cookie) res.setHeader('Set-Cookie', current.cookie);
                json(res, 200, publicSession(current)); return true;
            }
            if (isShuttingDown()) throw fail(503, 'Bot đang khởi động lại. Vui lòng thử lại sau.');
            if (pathname === '/play/api/login' && req.method === 'POST') {
                const current = await auth.login(req, (await readBody(req)).code);
                res.setHeader('Set-Cookie', current.cookie);
                json(res, 200, publicSession(current));
                return true;
            }
            if (req.method === 'GET' && pathname === '/play/api/catalogue') { json(res, 200, await service.catalogue()); return true; }
            const detail = /^\/play\/api\/cases\/(battle-[a-z0-9-]+|crate-\d+)$/.exec(pathname);
            if (detail && req.method === 'GET') { json(res, 200, await service.caseDetail(detail[1])); return true; }
            const current = await auth.requireSession(req, mutation);
            if (current.cookie) res.setHeader('Set-Cookie', current.cookie);
            let output;
            if (req.method === 'GET') {
                if (pathname === '/play/api/me') output = await service.me(current.owner);
                else if (pathname === '/play/api/activity-missions') output = await service.activityMissions(current.owner);
                else if (pathname === '/play/api/boss-hunt') output = await service.bossHunt(current.owner);
                else if (pathname === '/play/api/collection-book') output = await service.collectionBook(current.owner);
                else if (pathname === '/play/api/battles') output = await service.battleList(current.owner);
                else if (pathname === '/play/api/market') {
                    const params = new URL(req.url, config.origin).searchParams;
                    output = await service.marketListings(current.owner, { page: Number(params.get('page') || 0), mine: params.get('mine') === '1' });
                }
                else if (/^\/play\/api\/battles\/[0-9a-f-]{36}$/i.test(pathname)) output = await service.battleDetail(current.owner, pathname.split('/').pop());
                else if (pathname === '/play/api/targets') {
                    const params = new URL(req.url, config.origin).searchParams;
                    output = await service.targets(current.owner, { search: (params.get('search') || '').slice(0, 100),
                        page: Number(params.get('page') || 0), minValue: params.get('minValue') || '0',
                        ...(params.has('maxValue') ? { maxValue: params.get('maxValue') } : {}),
                        ...(params.has('desiredValue') ? { desiredValue: params.get('desiredValue') } : {}) });
                } else throw fail(404, 'Không tìm thấy chức năng.');
            } else if (req.method === 'POST') {
                if (pathname === '/play/api/logout') {
                    res.setHeader('Set-Cookie', await auth.logout(req));
                    json(res, 200, publicSession(null)); return true;
                }
                const actions = { '/play/api/open': 'open', '/play/api/open/quote': 'openQuote', '/play/api/sell/quote': 'sellQuote', '/play/api/sell': 'sell', '/play/api/locks': 'locks',
                    '/play/api/upgrade/preview': 'upgradePreview', '/play/api/upgrade/prepare': 'upgradePrepare', '/play/api/upgrade/settle': 'upgradeSettle',
                    '/play/api/battles': 'battleCreate', '/play/api/boss-hunt/attack': 'bossHuntAttack', '/play/api/boss-hunt/claim': 'bossHuntClaim',
                    '/play/api/activity-missions/claim': 'activityMissionClaim', '/play/api/collection-book/claim': 'collectionBookClaim' };
                const battle = /^\/play\/api\/battles\/([0-9a-f-]{36})\/(join|leave|cancel|start|seat|bot)$/i.exec(pathname);
                if (battle) {
                    const name = battle[2].toLowerCase();
                    const action = `battle${name[0].toUpperCase()}${name.slice(1)}`;
                    output = await service[action](current.owner, battle[1], await readBody(req));
                    json(res, 200, output); return true;
                }
                const marketActions = {
                    '/play/api/market/list': 'marketList', '/play/api/market/buy': 'marketBuy',
                    '/play/api/market/cancel': 'marketCancel', '/play/api/transfer/quote': 'transferQuote',
                    '/play/api/transfer': 'transfer'
                };
                if (marketActions[pathname]) {
                    output = await service[marketActions[pathname]](current.owner, await readBody(req));
                    json(res, 200, output); return true;
                }
                const action = actions[pathname];
                if (!action) throw fail(404, 'Không tìm thấy chức năng.');
                const limit = ['upgradePreview', 'upgradePrepare'].includes(action) ? 16 * 1024 * 1024 : 16_384;
                output = await service[action](current.owner, await readBody(req, limit));
            } else throw fail(405, 'Phương thức không được hỗ trợ.');
            json(res, 200, output);
        } catch (error) {
            if (res.destroyed || res.writableEnded) return true;
            const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
            if (status === 500) console.error('Lỗi web người chơi:', error.code ?? error.name);
            json(res, status, { error: `HTTP_${status}`, message: status === 500 ? 'Chưa thể xử lý. Vui lòng thử lại; kiểm tra lịch sử trước khi mở lượt mới.' : error.message }, req.method === 'HEAD');
        }
        return true;
    };
}
module.exports = { createPlayerHandler };
