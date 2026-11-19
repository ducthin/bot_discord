const { createCodeBroker, createPlayerAuth, parsePlayerConfig, CODE_TTL, IDLE_TTL, MAX_TTL } = require('../utils/playerAuth');
const { createPlayerHandler } = require('../utils/playerWeb');
const { createHealthServer, startHealthServer } = require('../utils/runtime');
const command = require('../commands/web');
const { MessageFlags } = require('discord.js');

let server, origin, service, broker;
const owner = { guildId: '123', userId: '456', displayName: 'Người chơi', avatar: 'https://example.com/avatar.png' };
beforeEach(async () => {
    broker = createCodeBroker();
    service = Object.fromEntries(['validateOwner', 'catalogue', 'caseDetail', 'me', 'open', 'openQuote', 'sellQuote', 'sell', 'locks', 'targets', 'upgradePreview', 'upgradePrepare', 'upgradeSettle',
        'marketListings', 'marketList', 'marketBuy', 'marketCancel', 'transferQuote', 'transfer',
        'battleList', 'battleDetail', 'battleCreate', 'battleJoin', 'battleLeave', 'battleCancel', 'battleStart', 'battleSeat', 'battleBot',
        'bossHunt', 'bossHuntAttack', 'bossHuntClaim', 'activityMissions', 'activityMissionClaim', 'collectionBook', 'collectionBookClaim']
        .map(name => [name, jest.fn().mockResolvedValue({ ok: true })]));
    let handler;
    server = createHealthServer({ isReady: () => true, guilds: { cache: new Map() } }, { handler: (...args) => handler(...args) });
    await startHealthServer(server, 0);
    origin = `http://127.0.0.1:${server.address().port}`;
    handler = createPlayerHandler({ config: parsePlayerConfig({ PLAYER_ENABLED: 'true', PLAYER_ORIGIN: origin }), service, broker });
});
afterEach(async () => { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); jest.restoreAllMocks(); });
async function login() {
    const code = broker.issue(owner).code;
    const response = await fetch(origin + '/play/api/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    expect(response.status).toBe(200);
    return { cookie: response.headers.get('set-cookie').split(';')[0], ...(await response.json()) };
}
const post = (path, body, session, extra = {}) => fetch(origin + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json',
    ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken } : {}), ...extra }, body: JSON.stringify(body) });

test('public catalogue works and private wallet cannot be read without a Discord code', async () => {
    expect((await fetch(origin + '/health')).status).toBe(200);
    expect(await (await fetch(origin + '/play/api/session')).json()).toEqual({ app: 'may-skins', authenticated: false });
    const catalogue = await fetch(origin + '/play/api/catalogue');
    expect(catalogue.status).toBe(200);
    const serverTime = Number(catalogue.headers.get('x-server-time'));
    expect(Number.isFinite(serverTime)).toBe(true);
    expect(Math.abs(Date.now() - serverTime)).toBeLessThan(5000);
    expect(Number(catalogue.headers.get('x-server-elapsed'))).toBeGreaterThanOrEqual(0);
    const unauthorized = await fetch(origin + '/play/api/me');
    expect(unauthorized.status).toBe(401);
    expect(Number(unauthorized.headers.get('x-server-time'))).toBeGreaterThanOrEqual(serverTime);
    expect((await fetch(origin + '/play/.env')).status).toBe(401);
    expect(service.me).not.toHaveBeenCalled();
});
test('player entrypoint serves every linked local script and stylesheet with the correct MIME type', async () => {
    const response = await fetch(origin + '/play/');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^text\/html/);
    const page = await response.text();
    const paths = [...page.matchAll(/(?:src|href)="(\/play\/[^"?#]+\.(?:js|css))"/g)].map(match => match[1]);
    expect(paths.some(path => path.endsWith('.js'))).toBe(true);
    expect(paths.some(path => path.endsWith('.css'))).toBe(true);
    await Promise.all(paths.map(async path => {
        const asset = await fetch(origin + path);
        expect({ path, status: asset.status }).toEqual({ path, status: 200 });
        expect(asset.headers.get('content-type')).toMatch(path.endsWith('.css') ? /^text\/css/ : /^text\/javascript/);
        expect((await asset.text()).length).toBeGreaterThan(0);
    }));
});
test.each(['battle-howl', 'crate-4904'])('%s details and odds are publicly reachable before sign-in', async caseId => {
    const detail = { case: { id: caseId }, entries: [{ id: 'reward', chance: 100 }] };
    service.caseDetail.mockResolvedValueOnce(detail);
    const response = await fetch(origin + '/play/api/cases/' + caseId);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(detail);
    expect(service.caseDetail).toHaveBeenCalledWith(caseId);
});
test('standard case checkout quotes require a Discord session and bind to its owner', async () => {
    const path = '/play/api/open/quote', body = { caseId: 'crate-4904', count: 2, guildId: '999', userId: '999' };
    expect((await post(path, body)).status).toBe(401);
    const session = await login();
    expect((await post(path, body, session, { 'X-CSRF-Token': '' })).status).toBe(403);
    expect(service.openQuote).not.toHaveBeenCalled();
    expect((await post(path, body, session)).status).toBe(200);
    expect(service.openQuote).toHaveBeenCalledWith(owner, body);
});
test('single use Discord identity determines wallet and ignores supplied owner IDs', async () => {
    const code = broker.issue(owner).code;
    const session = await login();
    await post('/play/api/open', { guildId: '999', userId: '999', caseId: 'battle-balance' }, session);
    expect(service.open).toHaveBeenCalledWith(owner, expect.objectContaining({ userId: '999' }));
    expect(service.validateOwner).toHaveBeenCalledWith(owner);
    const signed = await post('/play/api/login', { code });
    expect(signed.status).toBe(401); // issuing the second code above revoked the first
    expect(await (await fetch(origin + '/play/api/session', { headers: { Cookie: session.cookie } })).json()).toMatchObject({ authenticated: true, user: owner });
    expect((await post('/play/api/logout', {}, session)).status).toBe(200);
    expect((await fetch(origin + '/play/api/me', { headers: { Cookie: session.cookie } })).status).toBe(401);
});
test('code consumption is atomic, expires, and retries after a temporary membership error', async () => {
    let now = 1000;
    const codes = createCodeBroker({ now: () => now });
    const one = codes.issue(owner);
    let release;
    const pending = codes.consume(one.code, () => new Promise(resolve => { release = resolve; }));
    await expect(codes.consume(one.code, async () => {})).rejects.toMatchObject({ status: 401 });
    release();
    expect(await pending).toEqual(owner);
    await expect(codes.consume(one.code, async () => {})).rejects.toMatchObject({ status: 401 });
    const two = codes.issue(owner);
    await expect(codes.consume(two.code, async () => { throw new Error('temporary'); })).rejects.toThrow('temporary');
    expect(await codes.consume(two.code, async () => {})).toEqual(owner);
    const three = codes.issue(owner); now += CODE_TTL;
    await expect(codes.consume(three.code, async () => {})).rejects.toMatchObject({ status: 401 });
});
test('cross-origin requests, invalid CSRF and Host spoofing cannot spend coins', async () => {
    const session = await login();
    for (const extra of [{ Origin: 'https://evil.example' }, { 'X-CSRF-Token': 'é'.repeat(64) }, { 'X-CSRF-Token': '' }]) {
        expect((await post('/play/api/open', {}, session, extra)).status).toBe(403);
    }
    expect(service.open).not.toHaveBeenCalled();
    const huge = await post('/play/api/open', { x: 'a'.repeat(17000) }, session);
    expect(huge.status).toBe(413);
});

test('Upgrade routes accept a complete inventory and its price snapshot beyond the normal JSON limit', async () => {
    const session = await login();
    const inputIds = Array.from({ length: 525 }, (_, index) => `owned-${index}`);
    const body = { inputIds, targetId: 'target', coinStake: '0', startTicket: 99000,
        expectedPrices: { inputs: inputIds.map(id => ({ id, name: 'Owned skin', priceVnd: 100, observedAt: 1, expiresAt: 2 })), target: { priceVnd: 105000 } } };
    expect(Buffer.byteLength(JSON.stringify(body))).toBeGreaterThan(16_384);
    for (const action of ['preview', 'prepare']) {
        const response = await post(`/play/api/upgrade/${action}`, body, session);
        expect(response.status).toBe(200);
        expect(service[action === 'preview' ? 'upgradePreview' : 'upgradePrepare']).toHaveBeenCalledWith(owner, body);
    }
    expect((await post('/play/api/open', body, session)).status).toBe(413);
    expect(service.open).not.toHaveBeenCalled();
});

test('target recommendations forward the desired value and both bounds for the authenticated owner', async () => {
    const session = await login();
    const response = await fetch(origin + '/play/api/targets?search=AK&page=1&minValue=10001&maxValue=950000&desiredValue=20000', { headers: { Cookie: session.cookie } });
    expect(response.status).toBe(200);
    expect(service.targets).toHaveBeenCalledWith(owner, { search: 'AK', page: 1, minValue: '10001', maxValue: '950000', desiredValue: '20000' });
});

test('market and transfer routes require an authenticated session and forward identity-bound inputs', async () => {
    expect((await fetch(origin + '/play/api/market')).status).toBe(401);
    expect((await post('/play/api/transfer', { requestId: '12345678-1234-4234-8234-123456789012', recipientId: '789', amount: '5.00' })).status).toBe(401);
    const session = await login();
    const headers = { Cookie: session.cookie };
    expect((await fetch(origin + '/play/api/market?page=2&mine=1', { headers })).status).toBe(200);
    expect(service.marketListings).toHaveBeenCalledWith(owner, { page: 2, mine: true });
    for (const [path, name, body] of [
        ['/market/list', 'marketList', { requestId: '12345678-1234-4234-8234-123456789012', itemId: 'drop', price: '10', expectedMarketValue: '100' }],
        ['/market/buy', 'marketBuy', { requestId: '12345678-1234-4234-8234-123456789012', listingId: '12345' }],
        ['/market/cancel', 'marketCancel', { requestId: '12345678-1234-4234-8234-123456789012', listingId: '12345' }],
        ['/transfer/quote', 'transferQuote', { recipientId: '789', amount: '5.00' }],
        ['/transfer', 'transfer', { requestId: '12345678-1234-4234-8234-123456789012', recipientId: '789', amount: '5.00' }]
    ]) {
        expect((await post('/play/api' + path, body, session)).status).toBe(200);
        expect(service[name]).toHaveBeenCalledWith(owner, body);
    }
});

test('community Boss Hunt and collection book routes require a Discord session and bind mutations to its owner', async () => {
    expect((await fetch(origin + '/play/api/boss-hunt')).status).toBe(401);
    expect((await fetch(origin + '/play/api/activity-missions')).status).toBe(401);
    expect((await fetch(origin + '/play/api/collection-book')).status).toBe(401);
    const attack = { requestId: '12345678-1234-4234-8234-123456789012', style: 'steady' };
    const medal = { requestId: '23456789-1234-4234-8234-123456789012' };
    const claim = { requestId: '87654321-1234-4234-8234-123456789012', collectionId: 'collection-set-cobblestone' };
    const activityClaim = { requestId: '98765432-1234-4234-8234-123456789012', type: 'daily', missionId: 'open-cases' };
    expect((await post('/play/api/boss-hunt/attack', attack)).status).toBe(401);
    expect((await post('/play/api/boss-hunt/claim', medal)).status).toBe(401);
    expect((await post('/play/api/activity-missions/claim', activityClaim)).status).toBe(401);
    expect((await post('/play/api/collection-book/claim', claim)).status).toBe(401);
    const session = await login();
    expect((await fetch(origin + '/play/api/boss-hunt', { headers: { Cookie: session.cookie } })).status).toBe(200);
    expect(service.bossHunt).toHaveBeenCalledWith(owner);
    expect((await fetch(origin + '/play/api/activity-missions', { headers: { Cookie: session.cookie } })).status).toBe(200);
    expect(service.activityMissions).toHaveBeenCalledWith(owner);
    expect((await fetch(origin + '/play/api/collection-book', { headers: { Cookie: session.cookie } })).status).toBe(200);
    expect(service.collectionBook).toHaveBeenCalledWith(owner);
    expect((await post('/play/api/boss-hunt/attack', attack, session)).status).toBe(200);
    expect(service.bossHuntAttack).toHaveBeenCalledWith(owner, attack);
    expect((await post('/play/api/boss-hunt/claim', medal, session)).status).toBe(200);
    expect(service.bossHuntClaim).toHaveBeenCalledWith(owner, medal);
    expect((await post('/play/api/activity-missions/claim', activityClaim, session)).status).toBe(200);
    expect(service.activityMissionClaim).toHaveBeenCalledWith(owner, activityClaim);
    expect((await post('/play/api/collection-book/claim', claim, session)).status).toBe(200);
    expect(service.collectionBookClaim).toHaveBeenCalledWith(owner, claim);
});

test('Battle routes bind every action and room read to the authenticated Discord owner', async () => {
    const id = '12345678-1234-4234-8234-123456789012';
    expect((await fetch(origin + '/play/api/battles')).status).toBe(401);
    expect((await post(`/play/api/battles/${id}/start`, {})).status).toBe(401);
    const session = await login();
    const headers = { Cookie: session.cookie };
    expect((await fetch(origin + '/play/api/battles', { headers })).status).toBe(200);
    expect(service.battleList).toHaveBeenCalledWith(owner);
    expect((await fetch(origin + `/play/api/battles/${id}`, { headers })).status).toBe(200);
    expect(service.battleDetail).toHaveBeenCalledWith(owner, id);
    const body = { requestId: id, userId: '999', guildId: '999' };
    expect((await post('/play/api/battles', body, session)).status).toBe(200);
    expect(service.battleCreate).toHaveBeenCalledWith(owner, body);
    for (const action of ['join', 'leave', 'cancel', 'start', 'seat', 'bot']) {
        expect((await post(`/play/api/battles/${id}/${action}`, body, session)).status).toBe(200);
        expect(service[`battle${action[0].toUpperCase()}${action.slice(1)}`]).toHaveBeenCalledWith(owner, id, body);
    }
    service.battleStart.mockClear();
    expect((await post(`/play/api/battles/${id}/start`, body, session, { 'X-CSRF-Token': '' })).status).toBe(403);
    expect(service.battleStart).not.toHaveBeenCalled();
    service.battleStart.mockRejectedValueOnce(new Error('private-database-error'));
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    const failed = await post(`/play/api/battles/${id}/start`, body, session);
    expect(failed.status).toBe(500);
    expect(await failed.text()).not.toContain('private-database-error');
    errorLog.mockRestore();
});
test('login brute-force limit ignores forwarded addresses and errors hide secrets', async () => {
    for (let i = 0; i < 10; i++) expect((await post('/play/api/login', { code: 'invalid' }, null, { 'X-Forwarded-For': `1.1.1.${i}` })).status).toBe(401);
    expect((await post('/play/api/login', { code: broker.issue(owner).code })).status).toBe(429);
});

test.each(['198.51.100.21', '2001:db8::21'])('HTTPS proxy keeps login failure limits separate for client %s', async otherAddress => {
    const config = parsePlayerConfig({ PLAYER_ENABLED: 'true', PLAYER_ORIGIN: 'https://teoteo.site' });
    const auth = createPlayerAuth(config, { broker });
    const request = address => ({ headers: { host: config.host, origin: config.origin,
        'x-forwarded-proto': 'https', 'x-forwarded-for': address }, socket: { remoteAddress: '127.0.0.1' } });
    const blocked = request('198.51.100.20');
    for (let i = 0; i < 10; i++) await expect(auth.login(blocked, 'invalid')).rejects.toMatchObject({ status: 401 });
    const other = request(otherAddress);
    expect(() => auth.validateRequest(other, true)).not.toThrow();
    await expect(auth.login(other, broker.issue(owner).code)).resolves.toMatchObject({ owner });
    await expect(auth.login(blocked, broker.issue(owner).code)).rejects.toMatchObject({ status: 429 });
});

test.each([
    { name: 'direct HTTPS client', remoteAddress: '198.51.100.30', protocol: 'https' },
    { name: 'proxy without HTTPS', remoteAddress: '127.0.0.1', protocol: undefined },
    { name: 'proxy with HTTP', remoteAddress: '127.0.0.1', protocol: 'http' },
    { name: 'proxy protocol list', remoteAddress: '127.0.0.1', protocol: 'https,http' }
])('$name cannot evade the failure limit with spoofed forwarding headers', async ({ remoteAddress, protocol }) => {
    const config = parsePlayerConfig({ PLAYER_ENABLED: 'true', PLAYER_ORIGIN: 'https://teoteo.site' });
    const auth = createPlayerAuth(config, { broker });
    const request = address => ({ headers: { 'x-forwarded-proto': protocol, 'x-forwarded-for': address },
        socket: { remoteAddress, encrypted: true } });
    for (let i = 0; i < 10; i++) await expect(auth.login(request(`198.51.100.${i}`), 'invalid')).rejects.toMatchObject({ status: 401 });
    await expect(auth.login(request('203.0.113.1'), broker.issue(owner).code)).rejects.toMatchObject({ status: 429 });
});

test('HTTPS proxy ignores IP lists, arrays and malformed client addresses', async () => {
    const config = parsePlayerConfig({ PLAYER_ENABLED: 'true', PLAYER_ORIGIN: 'https://teoteo.site' });
    const auth = createPlayerAuth(config, { broker });
    const invalidAddresses = ['198.51.100.1, 203.0.113.1', 'unknown', '999.1.1.1', '', ' 198.51.100.1',
        '198.51.100.1:443', '[2001:db8::1]', ['198.51.100.1'], undefined, '203.0.113'];
    const request = address => ({ headers: { 'x-forwarded-proto': 'https', 'x-forwarded-for': address },
        socket: { remoteAddress: '::ffff:127.0.0.1' } });
    for (const address of invalidAddresses) await expect(auth.login(request(address), 'invalid')).rejects.toMatchObject({ status: 401 });
    await expect(auth.login(request('not-an-ip'), broker.issue(owner).code)).rejects.toMatchObject({ status: 429 });
});
test('session idle expiry and public HTTP rejection keep account access bounded', async () => {
    expect(() => parsePlayerConfig({ PLAYER_ENABLED: 'true', PLAYER_ORIGIN: 'http://180.93.126.48:3001' })).toThrow();
    let now = 10;
    const config = parsePlayerConfig({ PLAYER_ENABLED: 'true', PLAYER_ORIGIN: origin });
    const auth = createPlayerAuth(config, { broker, now: () => now, validateOwner: async () => {} });
    const req = { headers: { host: config.host, origin }, socket: { remoteAddress: '127.0.0.1' } };
    const signed = await auth.login(req, broker.issue(owner).code);
    req.headers.cookie = signed.cookie.split(';')[0];
    expect((await auth.requireSession(req)).owner).toEqual(owner);
    now += IDLE_TTL;
    await expect(auth.requireSession(req)).rejects.toMatchObject({ status: 401 });
    expect(() => auth.validateRequest({ ...req, socket: { remoteAddress: '8.8.8.8' } })).toThrow();
    expect(() => auth.validateRequest({ ...req, headers: { ...req.headers, host: 'evil.example' } })).toThrow();
});

test('persistent opaque sessions survive auth recreation and expire on the configured long idle window', async () => {
    let now = 10_000;
    const rows = new Map();
    const sessionStore = { query: jest.fn(async (sql, values = []) => {
        if (sql.includes('SELECT owner, created_at')) {
            const row = rows.get(values[0]);
            return { rows: row && row.expires_at > values[1] && row.created_at + values[2] > values[1] ? [{ ...row }] : [] };
        }
        if (sql.includes('SET expires_at = LEAST')) {
            const row = rows.get(values[0]);
            if (!row || row.expires_at <= values[3] || row.created_at + values[2] <= values[3]) return { rows: [] };
            row.expires_at = Math.min(values[1], row.created_at + values[2]);
            return { rows: [{ expires_at: row.expires_at }] };
        }
        if (sql.includes('SET window_until = CASE')) {
            const row = rows.get(values[0]);
            if (!row || row.expires_at <= values[1] || row.created_at + values[2] <= values[1] || (row.window_until > values[1] && row.mutations >= 60)) return { rows: [] };
            if (row.window_until <= values[1]) { row.window_until = values[1] + 60_000; row.mutations = 1; }
            else row.mutations++;
            return { rows: [{ mutations: row.mutations, window_until: row.window_until }] };
        }
        if (sql.includes('INSERT INTO discord_bot.player_sessions')) {
            rows.set(values[0], { owner: values[1], created_at: values[2], expires_at: values[3], csrf_token: values[4], mutations: values[5], window_until: values[6] });
            return { rows: [] };
        }
        if (sql.startsWith('DELETE FROM discord_bot.player_sessions WHERE token_hash')) { rows.delete(values[0]); return { rows: [] }; }
        if (sql.includes('DELETE FROM discord_bot.player_sessions') && sql.includes('expires_at <= $1')) {
            for (const [key, row] of rows) if (row.expires_at <= values[0] || row.created_at + values[1] <= values[0]) rows.delete(key);
            return { rows: [] };
        }
        throw new Error(`Unexpected session query: ${sql}`);
    }) };
    const config = parsePlayerConfig({ PLAYER_ENABLED: 'true', PLAYER_ORIGIN: origin });
    const makeAuth = () => createPlayerAuth(config, { broker, now: () => now, sessionStore });
    const firstAuth = makeAuth();
    const req = { headers: { host: config.host, origin }, socket: { remoteAddress: '127.0.0.1' } };
    const signed = await firstAuth.login(req, broker.issue(owner).code);
    expect(signed.cookie).toContain(`Max-Age=${MAX_TTL / 1000}`);
    const cookieHeader = signed.cookie.split(';')[0];
    const resumedReq = { ...req, headers: { ...req.headers, cookie: cookieHeader, 'x-csrf-token': signed.csrfToken } };
    const restartedAuth = makeAuth();
    expect((await restartedAuth.requireSession(resumedReq)).owner).toEqual(owner);
    expect(rows.size).toBe(1);
    now += IDLE_TTL;
    await expect(restartedAuth.requireSession(resumedReq)).rejects.toMatchObject({ status: 401 });
});
test('new login command publishes the account code only ephemerally', async () => {
    const old = { PLAYER_ENABLED: process.env.PLAYER_ENABLED, PLAYER_ORIGIN: process.env.PLAYER_ORIGIN, GUILD_IDS: process.env.GUILD_IDS };
    Object.assign(process.env, { PLAYER_ENABLED: 'true', PLAYER_ORIGIN: origin, GUILD_IDS: '123' });
    try {
        const interaction = { guildId: '123', guild: { name: 'Test guild' }, member: { displayName: 'Tên của tôi' },
            user: { id: '456', bot: false, username: 'player', displayAvatarURL: () => 'https://example.com/a.png' }, reply: jest.fn().mockResolvedValue() };
        await command.execute(interaction);
        expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral, content: expect.stringContaining('/play/') }));
        expect(interaction.reply.mock.calls[0][0].content).toMatch(/[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){3}/);
    } finally { for (const [key, value] of Object.entries(old)) { if (value == null) delete process.env[key]; else process.env[key] = value; } }
});
