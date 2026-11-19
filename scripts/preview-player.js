// Isolated UI test: no dotenv, Discord login, PostgreSQL, or production wallet.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const store = require('../utils/managementStore');
const market = require('../utils/cs2Market');
const upgrade = require('../utils/cs2Upgrade');
const { skins } = require('../utils/cs2Catalogue');
const { normalCasesById } = require('../utils/cs2NormalCases');
const { createPlayerService } = require('../utils/playerService');
const { createPlayerHandler } = require('../utils/playerWeb');
const { createCodeBroker, parsePlayerConfig } = require('../utils/playerAuth');
const { createHealthServer, startHealthServer } = require('../utils/runtime');

async function main() {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'may-skins-preview-'));
    const disk = store.createManagementStore(directory);
    store.read = disk.read; store.transact = disk.transact;
    process.env.GUILD_IDS = '123';
    const tierPrice = [1200, 6000, 30000, 180000, 1200000];
    const prices = new Map(upgrade.targetCatalogue().map(target => [market.marketQuoteKey(target.marketRef.name, target.marketRef.phase),
        tierPrice[target.tier] + parseInt(target.id.slice(0, 3), 16) * 80]));
    market.peekMarketQuote = (name, ref = {}) => ({ priceVnd: prices.get(market.marketQuoteKey(name, ref.phase)) ?? 5000,
        observedAt: Date.now() - 1000, expiresAt: Date.now() + 3600_000,
        phase: ref.phase ?? null, source: ref.paintSeed == null ? 'buff' : 'csfloat', ...(ref.paintSeed == null ? {} : { paintSeed: ref.paintSeed }) });
    const owner = { guildId: '123', userId: '456', displayName: 'Người chơi thử', avatar: null };
    const demoUsers = new Map([['456', owner], ['789', { ...owner, userId: '789', displayName: 'Minh Anh · Bản thử' }],
        ['790', { ...owner, userId: '790', displayName: 'Lan Hương · Bản thử' }], ['791', { ...owner, userId: '791', displayName: 'Đức Hải · Bản thử' }]]);
    const guild = { id: '123', available: true, name: 'Happy house Scam Club · Bản thử', members: { fetch: async id => {
        const demoUser = demoUsers.get(typeof id === 'string' ? id : id?.user);
        if (!demoUser) throw new Error('Không tìm thấy thành viên xem thử.');
        return { id: demoUser.userId, displayName: demoUser.displayName, user: { id: demoUser.userId, username: demoUser.displayName, bot: false } };
    } }, channels: { cache: new Map() } };
    const client = { guilds: { cache: new Map([['123', guild]]) }, isReady: () => true };
    await disk.transact('123', async (state, save) => {
        for (const id of demoUsers.keys()) state.taixiu.balances[id] = '50000000000000';
        const targets = upgrade.targetCatalogue().filter(target => target.tier <= 2).slice(0, 8);
        const previewCase = normalCasesById.get('crate-4904');
        state.skinCases = { '456': { drops: targets.map((target, i) => ({ ...target.drop, id: `preview-${i}`, acquiredAt: Date.now() - i * 1000, paintSeed: 100 })),
            cases: { [previewCase.id]: 2 }, keys: { [previewCase.key]: 1 } } };
        await save();
    });
    const broker = createCodeBroker();
    const port = Number(process.argv[2] || 4318), origin = `http://127.0.0.1:${port}`;
    const service = createPlayerService({ client });
    // Optional scenes use the real service against this disposable store only.
    // They never load .env or touch the Discord/VPS database.
    if (process.argv.includes('--scenes')) {
        for (const [mode, capacity, caseIds] of [
            ['regular', 4, ['battle-balance', 'battle-howl', 'battle-knife']],
            ['crazy', 4, ['battle-howl', 'battle-balance', 'battle-knife']],
            ['sharing', 3, ['battle-balance', 'battle-fade']]
        ]) {
            const quoteIds = Object.fromEntries([...new Set(caseIds)].map(id => [id, service.caseDetail(id).quoteId]));
            const created = await service.battleCreate(owner, { requestId: crypto.randomUUID(), caseIds, quoteIds, capacity, mode });
            for (const guest of [...demoUsers.values()].slice(1, capacity)) {
                await service.battleJoin(guest, created.room.id, { requestId: crypto.randomUUID() });
            }
            await service.battleStart(owner, created.room.id, { requestId: crypto.randomUUID() });
        }
    }
    const handler = createPlayerHandler({ client, broker, service, demo: true, config: parsePlayerConfig({ PLAYER_ENABLED: 'true', PLAYER_ORIGIN: origin }) });
    const server = createHealthServer(client, { handler: async (req, res) => {
        const previewUrl = new URL(req.url, origin);
        if (previewUrl.pathname === '/preview-code' && req.method === 'GET') {
            const demoUser = demoUsers.get(previewUrl.searchParams.get('user') || '456');
            if (!demoUser) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ message: 'Demo user không tồn tại.' })); return true; }
            const body = JSON.stringify({ demo: true, user: demoUser, ...broker.issue(demoUser) });
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(body); return true;
        }
        return handler(req, res);
    } });
    await startHealthServer(server, port);
    console.log(`Isolated player preview: ${origin}/play/`);
    console.log(`Demo code: ${broker.issue(owner).code}`);
    let closing = false;
    const close = async () => { if (closing) return; closing = true; server.closeAllConnections(); server.close(); await fs.rm(directory, { recursive: true, force: true }); process.exit(0); };
    process.once('SIGINT', close); process.once('SIGTERM', close);
}
main().catch(error => { console.error('Preview failed:', error.message); process.exitCode = 1; });
