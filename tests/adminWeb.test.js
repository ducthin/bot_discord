const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { hashPassword, verifyPassword, parseAdminConfig, createAdminAuth, SESSION_IDLE_MS } = require('../utils/adminAuth');
const { createAdminHandler } = require('../utils/adminWeb');
const { createHealthServer, startHealthServer } = require('../utils/runtime');
const { configure } = require('../scripts/admin-password');

let server, origin, hash, service;
const close = instance => new Promise(resolve => { instance.close(resolve); instance.closeAllConnections(); });
beforeAll(async () => { hash = await hashPassword('this-is-a-test-password'); });
beforeEach(async () => {
    service = Object.fromEntries(['overview', 'guild', 'members', 'catalogue', 'music', 'settings', 'coins', 'cancelBattle', 'refreshPrices', 'activity']
        .map(name => [name, jest.fn().mockResolvedValue({ message: 'OK' })]));
    const client = { isReady: () => true, guilds: { cache: new Map() } };
    let handler;
    server = createHealthServer(client, { handler: (...args) => handler(...args) });
    await startHealthServer(server, 0);
    origin = `http://127.0.0.1:${server.address().port}`;
    const config = parseAdminConfig({ ADMIN_ENABLED: 'true', ADMIN_PASSWORD_HASH: hash, ADMIN_ORIGIN: origin });
    handler = createAdminHandler({ config, service });
});
afterEach(async () => { await close(server); });

async function login() {
    const response = await fetch(`${origin}/admin/api/login`, { method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'this-is-a-test-password' }) });
    expect(response.status).toBe(200);
    return { cookie: response.headers.get('set-cookie').split(';')[0], ...(await response.json()) };
}
async function request(url, method = 'GET', session, body = {}) {
    return fetch(`${origin}${url}`, { method, headers: { Origin: origin, ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken } : {}),
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
}

test('the dashboard preserves health routes and serves only allowlisted public assets', async () => {
    expect((await fetch(`${origin}/health`)).status).toBe(200);
    expect((await fetch(`${origin}/`)).status).toBe(200);
    const html = await fetch(`${origin}/admin/`);
    expect(html.status).toBe(200);
    expect(await html.text()).toContain('Bot Studio');
    expect(html.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect((await fetch(`${origin}/admin/admin.js`)).status).toBe(200);
    expect((await fetch(`${origin}/admin/.env`)).status).toBe(401);
    expect((await fetch(`${origin}/admin/api/overview`)).status).toBe(401);
    expect(service.overview).not.toHaveBeenCalled();
});

test('login uses a private cookie, authenticated API and logout invalidates the session', async () => {
    const session = await login();
    const current = await request('/admin/api/session', 'GET', session);
    expect(await current.json()).toMatchObject({ authenticated: true, csrfToken: session.csrfToken });
    expect((await request('/admin/api/overview', 'GET', session)).status).toBe(200);
    expect(service.overview).toHaveBeenCalledTimes(1);
    const signedOut = await request('/admin/api/logout', 'POST', session);
    expect(signedOut.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict');
    expect(signedOut.headers.get('set-cookie')).toContain('Max-Age=0');
    expect((await request('/admin/api/overview', 'GET', session)).status).toBe(401);
});

test('foreign origins, missing CSRF, spoofed hosts and leaked source paths cannot mutate the bot', async () => {
    const session = await login();
    for (const headers of [
        { Origin: 'https://attacker.example', Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken },
        { Origin: origin, Cookie: session.cookie },
        { Origin: origin, Cookie: session.cookie, 'X-CSRF-Token': '\u00e9'.repeat(64) },
        { Origin: origin, Cookie: session.cookie, 'X-CSRF-Token': 'x'.repeat(64), Host: 'attacker.example' }
    ]) {
        const response = await fetch(`${origin}/admin/api/guilds/1/music`, { method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stop' }) });
        expect(response.status).toBe(403);
    }
    expect(service.music).not.toHaveBeenCalled();
    expect((await request('/admin/.env', 'GET', session)).status).toBe(404);
    expect((await request('/admin/utils/adminAuth.js', 'GET', session)).status).toBe(404);
});

test('validated actions reach the correct guild service and reject oversized or malformed requests', async () => {
    const session = await login();
    expect((await request('/admin/api/guilds/123/music', 'POST', session, { action: 'volume', volume: 40 })).status).toBe(200);
    expect(service.music).toHaveBeenCalledWith('123', { action: 'volume', volume: 40 });
    expect((await request('/admin/api/guilds/123/battles/456/cancel', 'POST', session)).status).toBe(200);
    expect(service.cancelBattle).toHaveBeenCalledWith('123', '456');
    expect((await request('/admin/api/guilds/123/coins', 'POST', session, { reason: 'x'.repeat(9000) })).status).toBe(413);
    expect(service.coins).not.toHaveBeenCalled();
    const invalid = await fetch(`${origin}/admin/api/guilds/123/music`, { method: 'POST',
        headers: { Origin: origin, Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken, 'Content-Type': 'application/json' }, body: '{bad' });
    expect(invalid.status).toBe(400);
});

test('member search requires authentication and forwards the decoded query only to the requested guild', async () => {
    expect((await request('/admin/api/guilds/123/members?search=An')).status).toBe(401);
    expect(service.members).not.toHaveBeenCalled();
    const session = await login();
    const payload = { members: [{ userId: '456', userName: 'Nguyễn An', username: 'nguyen', avatar: null }], hasMore: false };
    service.members.mockResolvedValue(payload);
    const result = await request('/admin/api/guilds/123/members?search=Nguy%E1%BB%85n%20An', 'GET', session);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual(payload);
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(service.members).toHaveBeenLastCalledWith('123', 'Nguyễn An');
    expect((await request('/admin/api/guilds/123/members', 'GET', session)).status).toBe(200);
    expect(service.members).toHaveBeenLastCalledWith('123', '');
    service.members.mockRejectedValueOnce(Object.assign(new Error('Không tìm thấy máy chủ được phép quản lý.'), { status: 404 }));
    expect((await request('/admin/api/guilds/999/members?search=456', 'GET', session)).status).toBe(404);
    expect(service.members).toHaveBeenLastCalledWith('999', '456');
    expect(service.guild).not.toHaveBeenCalled();
    expect(service.coins).not.toHaveBeenCalled();
});

test('internal errors do not expose credentials or stack traces', async () => {
    const session = await login();
    service.guild.mockRejectedValue(new Error('postgresql://SECRET_TOKEN@host/db'));
    const warn = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
        const response = await request('/admin/api/guilds/123', 'GET', session);
        expect(response.status).toBe(500);
        expect(await response.text()).not.toMatch(/SECRET_TOKEN|postgresql|stack/);
    } finally { warn.mockRestore(); }
});

test('password failures are rate limited without trusting forwarded client addresses', async () => {
    for (let index = 0; index < 5; index++) {
        const response = await fetch(`${origin}/admin/api/login`, { method: 'POST',
            headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Forwarded-For': `10.0.0.${index}` },
            body: JSON.stringify({ password: 'wrong-password' }) });
        expect(response.status).toBe(401);
    }
    const blocked = await request('/admin/api/login', 'POST', null, { password: 'this-is-a-test-password' });
    expect(blocked.status).toBe(429);
});

test('password hashing and configuration reject weak or public HTTP credentials', async () => {
    expect(await verifyPassword('this-is-a-test-password', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
    await expect(hashPassword('short')).rejects.toThrow();
    expect(() => parseAdminConfig({ ADMIN_ENABLED: 'true', ADMIN_PASSWORD_HASH: hash, ADMIN_ORIGIN: 'http://180.93.126.48:3001' })).toThrow();
    expect(() => parseAdminConfig({ ADMIN_ENABLED: 'true', ADMIN_PASSWORD_HASH: hash, ADMIN_ORIGIN: 'https://bot.example.com', ADMIN_COOKIE_SECURE: 'false' })).toThrow();
});

test('sessions expire after idle time and HTTPS accepts proxy headers only on loopback', async () => {
    let now = 1000;
    const config = parseAdminConfig({ ADMIN_ENABLED: 'true', ADMIN_PASSWORD_HASH: hash, ADMIN_ORIGIN: 'https://bot.example.com' });
    const auth = createAdminAuth(config, { now: () => now });
    const req = { headers: { host: 'bot.example.com', origin: config.origin, 'x-forwarded-proto': 'https' }, socket: { remoteAddress: '127.0.0.1' } };
    auth.validateRequest(req, true);
    const signedIn = await auth.login(req, 'this-is-a-test-password');
    expect(signedIn.cookie).toContain('; Secure;');
    req.headers.cookie = signedIn.cookie.split(';')[0];
    expect(auth.requireSession(req)).toBeTruthy();
    now += SESSION_IDLE_MS;
    expect(() => auth.requireSession(req)).toThrow('hết hạn');
    expect(() => auth.validateRequest({ ...req, socket: { remoteAddress: '203.0.113.1' } })).toThrow('HTTPS');
});

test('password setup preserves unrelated environment values and writes only a hash', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-admin-setup-'));
    try {
        const file = path.join(directory, '.env');
        await fs.writeFile(file, 'DISCORD_TOKEN=do-not-change\nADMIN_ENABLED=false\nDATABASE_URL=keep-me\n');
        await configure(file, hash, 'http://127.0.0.1:3001');
        const text = await fs.readFile(file, 'utf8');
        expect(text).toContain('DISCORD_TOKEN=do-not-change');
        expect(text).toContain('DATABASE_URL=keep-me');
        expect(text.match(/ADMIN_ENABLED=/g)).toHaveLength(1);
        expect(text).toContain(`ADMIN_PASSWORD_HASH=${hash}`);
        expect(text).not.toContain('this-is-a-test-password');
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
