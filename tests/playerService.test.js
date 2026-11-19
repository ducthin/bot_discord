const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
jest.mock('../commands/taixiu', () => ({
    getCoinBalance: (state, userId) => state.taixiu?.balances[userId] == null ? 100000n : require('../utils/coins').readCoins(state.taixiu.balances[userId]),
    refreshCoinLeaderboard: jest.fn()
}));
const store = require('../utils/managementStore');
const market = require('../utils/cs2Market');
const upgrade = require('../utils/cs2Upgrade');
const { customCasesById, casePricing } = require('../utils/cs2BattleCases');
const { cases, skins } = require('../utils/cs2Catalogue');
const { getCaseMarketHashName, wearBounds, wearNames } = require('../utils/cs2MarketNames');
const { readCoins, serializeCoins } = require('../utils/coins');
const { createPlayerService, REQUEST_LIMIT } = require('../utils/playerService');

const owner = { guildId: '1', userId: '13', displayName: 'Chủ kho', avatar: 'https://cdn.example.com/avatar.png' };
const weaponCase = cases.find(item => item.id === 'crate-4904');
const caseMarketName = getCaseMarketHashName(weaponCase.id);
const skinId = weaponCase.pools[0][0];
const input = { id: 'owned', caseId: weaponCase.id, skinId, tier: 0, float: Math.round((skins[skinId].min + skins[skinId].max) * 500000) / 1000000,
    acquiredAt: 100, paintSeed: 17, statTrak: false, inventoryRevision: 'first' };
let directory, disk, service, client, guild, priorGuildIds, prices, expired;
const quoteRef = drop => market.getDropMarketQuoteRef(drop);
async function change(operation) {
    return disk.transact('1', async (state, save) => { operation(state); await save(); });
}

beforeEach(async () => {
    priorGuildIds = process.env.GUILD_IDS; process.env.GUILD_IDS = '1';
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'player-service-'));
    disk = store.createManagementStore(directory);
    jest.spyOn(store, 'read').mockImplementation(disk.read);
    jest.spyOn(store, 'transact').mockImplementation(disk.transact);
    guild = { id: '1', available: true, channels: { cache: new Map() }, members: {
        fetch: jest.fn(async ({ user }) => ({ user: { id: user, bot: false } }))
    } };
    client = { isReady: () => true, guilds: { cache: new Map([['1', guild]]) } };
    service = createPlayerService({ client });
    prices = new Map(); expired = false;
    jest.spyOn(market, 'peekMarketQuote').mockImplementation((name, ref = {}) => ({
        source: ref.paintSeed == null ? 'buff' : 'csfloat', phase: ref.phase ?? null,
        ...(ref.paintSeed == null ? {} : { paintSeed: ref.paintSeed }), priceVnd: prices.get(name) ?? 100,
        observedAt: Date.now() - 1000, expiresAt: Date.now() + (expired ? -1 : 600000)
    }));
    await change(state => {
        state.settings = { preserved: true };
        state.taixiu = { balances: { 13: 1000000, 14: 555 }, round: { id: 'untouched' } };
        state.skinCases = { 13: { drops: [structuredClone(input)] }, 14: { drops: [{ ...input, id: 'other' }] } };
    });
});
afterEach(async () => {
    jest.restoreAllMocks();
    if (priorGuildIds === undefined) delete process.env.GUILD_IDS; else process.env.GUILD_IDS = priorGuildIds;
    await fs.rm(directory, { recursive: true, force: true });
});

test('catalogue and detail use real case odds and exact minor-unit prices without mutation', async () => {
    const data = service.catalogue();
    expect(data.cases.filter(item => item.id.startsWith('battle-'))).toHaveLength(customCasesById.size);
    const standardCases = data.cases.filter(item => item.kind === 'standard');
    expect(standardCases.map(item => item.id).sort()).toEqual(cases.map(item => item.id).sort());
    expect(data.cases).toHaveLength(customCasesById.size + cases.length);
    expect(data.groups).toContain('standard');
    expect(standardCases.find(item => item.id === weaponCase.id)).toMatchObject({
        group: 'standard', name: weaponCase.name, keyId: weaponCase.key, available: true, fee: '6010000'
    });
    expect(data.cases.find(item => item.id === 'battle-howl')).toMatchObject({ available: true, image: '/play/art/battle-howl.png' });
    const detail = service.caseDetail('battle-howl');
    expect(detail.quoteId).toMatch(/^[a-f0-9]{64}$/);
    expect(detail.entries.reduce((sum, item) => sum + item.chance, 0)).toBeCloseTo(100, 8);
    expect(detail.entries.every(item => item.rarity === 'Contraband' && item.value === '10000')).toBe(true);
    expect(store.transact).not.toHaveBeenCalled();
    data.cases[0].name = 'tampered';
    expect(service.catalogue().cases[0].name).not.toBe('tampered');
});

test('each Discord hòm publishes every finish with its exact tier odds even when prices are stale', () => {
    expired = true;
    const standard = service.catalogue().cases.filter(item => item.kind === 'standard');
    expect(standard).toHaveLength(cases.length);
    expect(standard.every(item => !item.available && item.fee === null)).toBe(true);
    const weights = [3125, 625, 125, 25, 10];
    for (const discordCase of cases) {
        const detail = service.caseDetail(discordCase.id);
        expect(detail.case).toMatchObject({ id: discordCase.id, keyId: discordCase.key, available: false, fee: null });
        expect(detail.entries.reduce((total, item) => total + item.chance, 0)).toBeCloseTo(100, 8);
        expect(detail.entries.every(item => item.valueFormatted === 'Chưa có giá')).toBe(true);
        for (const [tier, pool] of discordCase.pools.entries()) {
            const entries = detail.entries.filter(item => item.tier === tier);
            expect(entries.map(item => item.skinId).sort()).toEqual([...pool].sort());
            for (const entry of entries) {
                expect(entry.chance).toBeCloseTo(100 * weights[tier] / (3910 * pool.length), 10);
                expect(entry.exclusiveEligible).not.toBe(true);
            }
        }
    }
});

test('standard contents show a fresh price range across the skin\'s available wear grades', () => {
    const skin = skins[skinId], scale = 1_000_000, available = [];
    const skinMin = Math.round(skin.min * scale), skinMax = Math.round(skin.max * scale);
    for (let exterior = 0; exterior < wearNames.length; exterior++) {
        const min = Math.max(skinMin, Math.round(wearBounds[exterior] * scale));
        const max = Math.min(skinMax, Math.round(wearBounds[exterior + 1] * scale) - (exterior === wearNames.length - 1 ? 0 : 1));
        if (min > max) continue;
        for (const statTrak of [false, true]) {
            const ref = market.getDropMarketQuoteRef({ skinId, float: min / scale, statTrak });
            const priceVnd = (statTrak ? 200 : 100) + exterior * 25;
            prices.set(ref.name, priceVnd);
            available.push({ wear: wearNames[exterior], statTrak, priceVnd });
        }
    }
    const entry = service.caseDetail(weaponCase.id).entries.find(item => item.skinId === skinId);
    const regular = available.filter(variant => !variant.statTrak), statTrak = available.filter(variant => variant.statTrak);
    expect(entry.valueFormatted).toBe(`${Math.min(regular[0].priceVnd, statTrak[0].priceVnd)} xu – ${Math.max(regular.at(-1).priceVnd, statTrak.at(-1).priceVnd)} xu`);
    expect(entry.priceNote).toContain('Giá thị trường theo độ mòn');
    expect(entry).toMatchObject({ statTrak: null, possibleStatTrak: true });
    for (const variant of available) expect(entry.priceNote).toContain(`${variant.statTrak ? 'StatTrak™ · ' : ''}${variant.wear}: ${variant.priceVnd} xu`);
});

test('all standard cases merge fresh wear and StatTrak market prices on every entry', () => {
    for (const discordCase of cases) {
        const detail = service.caseDetail(discordCase.id);
        expect(detail.entries).toHaveLength(discordCase.pools.flat().length);
        expect(detail.entries.every(entry => entry.valueFormatted !== 'Chưa có giá' && entry.priceNote)).toBe(true);
    }
});

test('every Battle case also exposes a merged market value for each reward', () => {
    for (const item of customCasesById.values()) {
        const detail = service.caseDetail(item.id);
        expect(detail.entries.length).toBeGreaterThan(0);
        for (const entry of detail.entries) {
            expect(entry.marketRangeFormatted).toBeDefined();
            expect(entry.marketRangeNote).toBeDefined();
            if (entry.priceVariant === 'blue-gem') expect(entry.marketRangeLabel).toContain('Seed #');
            else expect(entry.marketRangeNote).toContain('Giá thị trường theo độ mòn');
        }
    }
});

const standardBody = (count, quote) => ({ caseId: weaponCase.id, count, quote, requestId: randomUUID() });
async function setStandardStock(casesOwned, keysOwned) {
    await change(state => {
        state.skinCases[13].cases = { [weaponCase.id]: casesOwned };
        state.skinCases[13].keys = { [weaponCase.key]: keysOwned };
    });
}

test('an ordinary web opening uses Discord stock first and retries atomically without another purchase', async () => {
    await setStandardStock(2, 1);
    prices.set(caseMarketName, 1234);
    const before = await disk.read('1');
    expect((await service.me(owner)).caseStock).toEqual({ cases: { [weaponCase.id]: 2 }, keys: { [weaponCase.key]: 1 } });
    const fee = (1234n + 2n * 60000n) * 100n;
    const quote = await service.openQuote(owner, { caseId: weaponCase.id, count: 3 });
    expect(quote).toMatchObject({ fee: fee.toString(), ownedCases: 2, ownedKeys: 1, missingCases: 1, missingKeys: 2, affordable: true });
    expect(await disk.read('1')).toEqual(before);
    const body = standardBody(3, quote.quote);
    const receipts = await Promise.all([service.open(owner, body), service.open(owner, body)]);
    expect(receipts.map(receipt => receipt.replayed).sort()).toEqual([false, true]);
    expect(receipts[0].results).toEqual(receipts[1].results);
    expect(receipts[0].total).toBe(fee.toString());
    const saved = await disk.read('1');
    expect(saved.skinCases[13].cases[weaponCase.id] ?? 0).toBe(0);
    expect(saved.skinCases[13].keys[weaponCase.key] ?? 0).toBe(0);
    expect(saved.skinCases[13].drops.slice(1).map(item => item.id)).toEqual(receipts[0].results.map(item => item.id));
    for (const drop of saved.skinCases[13].drops.slice(1)) {
        expect(drop.caseId).toBe(weaponCase.id);
        expect(weaponCase.pools[drop.tier]).toContain(drop.skinId);
        expect(drop.exclusiveDrop).not.toBe(true);
    }
    expect(readCoins(saved.taixiu.balances[13])).toBe(readCoins(before.taixiu.balances[13]) - fee);
    expect(saved.skinCases[14]).toEqual(before.skinCases[14]);
    expect(saved.skinCases[13].webRequestCount).toBe(1);
    expired = true;
    expect(await service.open(owner, body)).toEqual({ ...receipts[0], replayed: true });
});

test('an ordinary opening rejects changed stock or price before spending xu and stores no failed receipt', async () => {
    await setStandardStock(1, 1);
    const quote = await service.openQuote(owner, { caseId: weaponCase.id, count: 2 });
    const body = standardBody(2, quote.quote);
    await setStandardStock(0, 1);
    const before = await disk.read('1');
    await expect(service.open(owner, body)).rejects.toMatchObject({ status: 409 });
    expect(await disk.read('1')).toEqual(before);

    await setStandardStock(1, 1);
    prices.set(caseMarketName, 101);
    const beforePrice = await disk.read('1');
    await expect(service.open(owner, body)).rejects.toMatchObject({ status: 409 });
    expect(await disk.read('1')).toEqual(beforePrice);

    const fresh = await service.openQuote(owner, { caseId: weaponCase.id, count: 2 });
    expired = true;
    await expect(service.open(owner, { ...body, quote: fresh.quote })).rejects.toMatchObject({ status: 409 });
    expect(await disk.read('1')).toEqual(beforePrice);
});

test('ordinary cases bought on Discord can still be opened on the web at zero charge without a market price', async () => {
    expired = true;
    await setStandardStock(3, 2);
    await change(state => { state.taixiu.balances[13] = 0; });
    const quote = await service.openQuote(owner, { caseId: weaponCase.id, count: 2 });
    expect(quote).toMatchObject({ fee: '0', missingCases: 0, missingKeys: 0, affordable: true });
    const receipt = await service.open(owner, standardBody(2, quote.quote));
    expect(receipt).toMatchObject({ total: '0', balance: '0' });
    expect(receipt.results).toHaveLength(2);
    expect((await service.me(owner)).caseStock.cases[weaponCase.id]).toBe(1);
    expect((await service.me(owner)).caseStock.keys[weaponCase.key] ?? 0).toBe(0);
});

test('a fresh case is usable at the fixed key price even while its case-price snapshot is stale', async () => {
    expired = true;
    await setStandardStock(2, 1);
    const quote = await service.openQuote(owner, { caseId: weaponCase.id, count: 2 });
    expect(quote).toMatchObject({ fee: '6000000', ownedCases: 2, ownedKeys: 1, missingCases: 0, missingKeys: 1, affordable: true });
    const receipt = await service.open(owner, standardBody(2, quote.quote));
    expect(receipt).toMatchObject({ total: '6000000', balance: '94000000' });
    expect(receipt.results).toHaveLength(2);
    expect((await service.me(owner)).caseStock.cases[weaponCase.id]).toBe(0);
    expect((await service.me(owner)).caseStock.keys[weaponCase.key] ?? 0).toBe(0);
});

test('the standard checkout quote binds the signed-in player, quantity, and expiration', async () => {
    const { quote, expiresAt } = await service.openQuote(owner, { caseId: weaponCase.id, count: 1 });
    const body = standardBody(1, quote);
    const before = await disk.read('1');
    await expect(service.open({ ...owner, userId: '14' }, body)).rejects.toMatchObject({ status: 409 });
    await expect(service.open(owner, { ...body, count: 2 })).rejects.toMatchObject({ status: 409 });
    jest.spyOn(Date, 'now').mockReturnValue(expiresAt);
    await expect(service.open(owner, body)).rejects.toMatchObject({ status: 409 });
    expect(await disk.read('1')).toEqual(before);
});

test('standard case opening does not inherit the 100-case Discord limit or change Battle case selection', async () => {
    const count = 101;
    await setStandardStock(count, count);
    const quote = await service.openQuote(owner, { caseId: weaponCase.id, count });
    const before = await disk.read('1');
    await expect(service.battleCreate(owner, {
        requestId: randomUUID(), caseIds: [weaponCase.id], capacity: 2, quoteIds: { [weaponCase.id]: 'a'.repeat(64) }
    })).rejects.toMatchObject({ status: 400 });
    expect(await disk.read('1')).toEqual(before);
    const open = await service.open(owner, standardBody(count, quote.quote));
    expect(open.total).toBe('0');
    expect(open.results).toHaveLength(count);
});

test('case descriptions publish the final priced group odds after ticket redistribution', () => {
    const item = customCasesById.get('battle-jackpot-10');
    for (const entry of item.entries) {
        if (item.bandByKey.get(market.marketQuoteKey(entry.ref.name, entry.ref.phase, entry.ref.paintSeed)) === 'jackpot') {
            prices.set(entry.ref.name, 10);
        }
    }
    const pricing = casePricing(item);
    expect(pricing.jackpotTickets).not.toBe(item.jackpotTickets);
    const text = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(pricing.jackpotTickets / 100);
    const summary = service.catalogue().cases.find(entry => entry.id === item.id);
    const detail = service.caseDetail(item.id);
    expect(summary.name).not.toMatch(/%/);
    expect(summary.description).toContain(`${text}% nhóm giải lớn`);
    expect(detail.case.description).toBe(summary.description);
    expect(detail.entries.reduce((sum, entry) => sum + entry.chance, 0)).toBeCloseTo(100, 8);
});

test('player read scopes expose only own inventory/wallet and pending commitments hide server seed', async () => {
    await change(state => { state.skinCases[13].upgrade = { pending: { id: 'attempt', expiresAt: Date.now() + 10000,
        targetValue: '10000', serverSeed: 'DO_NOT_DISCLOSE', salt: 'DO_NOT_DISCLOSE', hash: 'public_hash', inputs: [] }, history: [] }; });
    const data = await service.me(owner);
    expect(data.inventory.map(item => item.id)).toEqual(['owned']);
    expect(data.inventory[0].upgradeEligible).toBe(true);
    expect(data.balance).toBe('100000000');
    expect(JSON.stringify(data)).not.toMatch(/DO_NOT_DISCLOSE|untouched|other/);
    expect(store.read).toHaveBeenLastCalledWith('1', { wallets: ['13'], inventory: ['13'] });
});

test('the web inventory exposes every owned skin and upgrades all eligible inputs beyond the old 500-item window', async () => {
    const drops = Array.from({ length: 525 }, (_, index) => ({ ...input, id: `owned-${index}` }));
    await change(state => { state.skinCases[13].drops = [...drops, { ...input, id: 'locked', locked: true }]; });
    const data = await service.me(owner);
    expect(data.inventoryTotal).toBe(526);
    expect(data.inventory).toHaveLength(526);
    expect(data.inventory.at(-1).id).toBe('owned-0');
    const inputIds = data.inventory.filter(item => item.upgradeEligible).map(item => item.id);
    expect(inputIds).toHaveLength(525);
    expect(inputIds).not.toContain('locked');
    const target = upgrade.targetCatalogue().find(item => item.name !== quoteRef(input).name && item.skinId !== input.skinId && item.tier === 1);
    prices.set(target.marketRef.name, 105000);
    const body = { inputIds, targetId: target.id, coinStake: '0', clientSeed: 'whole-inventory', direction: 'under', startTicket: 99000 };
    const plan = await service.upgradePreview(owner, body);
    expect(plan).toMatchObject({ inputValue: '5250000', targetValue: '10500000', startTicket: 99000, winTickets: 47500 });
    const { attempt } = await service.upgradePrepare(owner, { ...body, expectedSignature: plan.signature, expectedPrices: plan.prices });
    expect(attempt.startTicket).toBe(99000);
    expect(attempt.inputIds).toHaveLength(525);
    const { receipt } = await service.upgradeSettle(owner, { attemptId: attempt.id, expectedHash: attempt.hash, expectedClientSeed: attempt.clientSeed });
    expect(receipt).toMatchObject({ startTicket: 99000, verified: true });
    const state = await disk.read('1');
    expect(state.skinCases[13].drops.some(item => inputIds.includes(item.id))).toBe(false);
    expect(state.skinCases[13].drops.some(item => item.id === 'locked' && item.locked)).toBe(true);
    expect(state.skinCases[14].drops[0].id).toBe('other');
});

test('two concurrent identical opening requests debit once and preserve unrelated guild data', async () => {
    const detail = service.caseDetail('battle-howl');
    const body = { requestId: randomUUID(), caseId: 'battle-howl', count: 3, quoteId: detail.quoteId };
    const before = await disk.read('1');
    const results = await Promise.all([service.open(owner, body), service.open(owner, body)]);
    expect(results.map(item => item.replayed).sort()).toEqual([false, true]);
    expect(results[0].results).toEqual(results[1].results);
    const saved = await disk.read('1');
    expect(saved.skinCases[13].drops).toHaveLength(4);
    expect(readCoins(saved.taixiu.balances[13])).toBe(readCoins(before.taixiu.balances[13]) - BigInt(results[0].total));
    expect(saved.skinCases[14]).toEqual(before.skinCases[14]);
    expect(saved.taixiu.round).toEqual(before.taixiu.round);
    expect(saved.settings).toEqual(before.settings);
    expect(saved.skinCases[13].webHistory).toHaveLength(1);
    expect(saved.skinCases[13].webRequestCount).toBe(1);
    expect(saved.skinCases[13].webRequests).toBeUndefined();
    expect(saved[`playerWebRequest:13:${body.requestId}`].result).toMatchObject({ results: results[0].results, total: results[0].total });
    expect(store.transact).toHaveBeenCalledWith('1', expect.any(Function), {
        wallets: ['13'], inventory: ['13'], sections: [`playerWebRequest:13:${body.requestId}`]
    });
});

test.each([2, 4, 6, 11, 257])('opening %i cases settles the exact count and retries without another charge', async count => {
    const detail = service.caseDetail('battle-howl');
    const body = { requestId: randomUUID(), caseId: 'battle-howl', count, quoteId: detail.quoteId };
    const before = await disk.read('1');
    const first = await service.open(owner, body);
    expect(first.results).toHaveLength(count);
    expect(first.total).toBe((BigInt(detail.fee) * BigInt(count)).toString());
    expect(await service.open(owner, body)).toEqual({ ...first, replayed: true });
    const saved = await disk.read('1');
    expect(saved.skinCases[13].drops).toHaveLength(count + 1);
    expect(readCoins(saved.taixiu.balances[13])).toBe(readCoins(before.taixiu.balances[13]) - BigInt(first.total));
});

test.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '2', null])('invalid opening count %j cannot charge the wallet', async count => {
    const detail = service.caseDetail('battle-howl');
    const before = await disk.read('1');
    await expect(service.open(owner, { requestId: randomUUID(), caseId: 'battle-howl', count, quoteId: detail.quoteId }))
        .rejects.toMatchObject({ status: 400 });
    expect(await disk.read('1')).toEqual(before);
});

test('opening rejects a batch exceeding available heap before randomness, debit, or receipt mutation', async () => {
    const detail = service.caseDetail('battle-howl');
    const before = await disk.read('1');
    const random = jest.spyOn(require('node:crypto'), 'randomInt');
    jest.spyOn(require('node:v8'), 'getHeapStatistics').mockReturnValue({ heap_size_limit: 1024 * 1024, used_heap_size: 900 * 1024 });
    await expect(service.open(owner, { requestId: randomUUID(), caseId: 'battle-howl', count: 257, quoteId: detail.quoteId }))
        .rejects.toMatchObject({ status: 413, message: 'Lượt mở quá lớn so với bộ nhớ máy chủ hiện có. Hãy chia thành các lượt nhỏ hơn.' });
    expect(random).not.toHaveBeenCalled();
    expect(await disk.read('1')).toEqual(before);
});

test('opening beyond JavaScript array capacity fails cleanly even when the wallet can afford the request', async () => {
    const detail = service.caseDetail('battle-howl');
    const count = 0x100000000;
    await change(state => { state.taixiu.balances[13] = serializeCoins(BigInt(detail.fee) * BigInt(count)); });
    const before = await disk.read('1');
    await expect(service.open(owner, { requestId: randomUUID(), caseId: 'battle-howl', count, quoteId: detail.quoteId }))
        .rejects.toMatchObject({ status: 413 });
    expect(await disk.read('1')).toEqual(before);
});

test('the maximum affordable custom count spends the exact balance and one extra case cannot mutate state', async () => {
    const detail = service.caseDetail('battle-howl'), count = 37;
    await change(state => { state.taixiu.balances[13] = serializeCoins(BigInt(detail.fee) * BigInt(count)); });
    const before = await disk.read('1');
    await expect(service.open(owner, { requestId: randomUUID(), caseId: 'battle-howl', count: count + 1, quoteId: detail.quoteId }))
        .rejects.toMatchObject({ status: 409 });
    expect(await disk.read('1')).toEqual(before);
    const receipt = await service.open(owner, { requestId: randomUUID(), caseId: 'battle-howl', count, quoteId: detail.quoteId });
    expect(receipt.results).toHaveLength(count);
    expect(receipt.balance).toBe('0');
    expect(readCoins((await disk.read('1')).taixiu.balances[13])).toBe(0n);
});

test('opening retry succeeds after market price changes but reused request id cannot change content', async () => {
    const detail = service.caseDetail('battle-howl');
    const body = { requestId: randomUUID(), caseId: 'battle-howl', count: 1, quoteId: detail.quoteId };
    const first = await service.open(owner, body);
    const entry = customCasesById.get('battle-howl').entries[0];
    prices.set(entry.ref.name, 200);
    expect(await service.open(owner, body)).toEqual({ ...first, replayed: true });
    await expect(service.open(owner, { ...body, count: 3 })).rejects.toMatchObject({ status: 409 });
    await expect(service.open(owner, { ...body, requestId: randomUUID() })).rejects.toMatchObject({ status: 409 });
    expect((await disk.read('1')).skinCases[13].drops).toHaveLength(2);
});

test('insufficient funds and full durable request log never mutate inventory or wallet', async () => {
    const detail = service.caseDetail('battle-howl');
    const body = { requestId: randomUUID(), caseId: 'battle-howl', count: 1, quoteId: detail.quoteId };
    await change(state => { state.taixiu.balances[13] = 0; });
    const before = await disk.read('1');
    await expect(service.open(owner, body)).rejects.toMatchObject({ status: 409 });
    expect(await disk.read('1')).toEqual(before);
    await change(state => {
        state.taixiu.balances[13] = 1000000;
        state.skinCases[13].webRequestCount = REQUEST_LIMIT;
    });
    const capped = await disk.read('1');
    await expect(service.open(owner, body)).rejects.toMatchObject({ status: 409 });
    expect(await disk.read('1')).toEqual(capped);
});

test('sell validates ownership, lock and exact current price before atomic single payout', async () => {
    await expect(service.sellQuote(owner, { itemIds: ['other'] })).rejects.toMatchObject({ status: 409 });
    const quote = await service.sellQuote(owner, { itemIds: ['owned'] });
    await service.locks(owner, { itemIds: ['owned'], locked: true });
    await expect(service.sell(owner, { requestId: randomUUID(), itemIds: ['owned'], quoteId: quote.quoteId })).rejects.toMatchObject({ status: 409 });
    await service.locks(owner, { itemIds: ['owned'], locked: false });
    prices.set(quoteRef(input).name, 101);
    await expect(service.sell(owner, { requestId: randomUUID(), itemIds: ['owned'], quoteId: quote.quoteId })).rejects.toMatchObject({ status: 409 });
    const fresh = await service.sellQuote(owner, { itemIds: ['owned'] });
    const body = { requestId: randomUUID(), itemIds: ['owned'], quoteId: fresh.quoteId };
    const results = await Promise.all([service.sell(owner, body), service.sell(owner, body)]);
    expect(results.map(item => item.replayed).sort()).toEqual([false, true]);
    const saved = await disk.read('1');
    expect(saved.skinCases[13].drops).toEqual([]);
    expect(readCoins(saved.taixiu.balances[13])).toBe(100000000n + 10100n);
    expect(saved.skinCases[14].drops[0].id).toBe('other');
    expect(saved.skinCases[13].webRequestCount).toBe(1);
    expect(saved.skinCases[13].webRequests).toBeUndefined();
    const scoped = await disk.read('1', { inventory: ['13'] });
    expect(Object.keys(scoped).some(key => key.startsWith('playerWebRequest:'))).toBe(false);
    expect((await disk.read('1', { sections: [`playerWebRequest:13:${body.requestId}`] }))[`playerWebRequest:13:${body.requestId}`].result.total).toBe('10100');
});

test('web market lists locked-value inventory at a chosen price and settles purchase exactly once', async () => {
    const requestId = randomUUID();
    const listed = await service.marketList(owner, { requestId, itemId: 'owned', price: '250.50', expectedMarketValue: '10000' });
    expect(listed).toMatchObject({ status: 'listed', listing: { sellerId: '13', price: '25050', marketValue: '10000', own: true } });
    expect((await service.marketListings(owner, { mine: '1' })).listings).toHaveLength(1);
    const stale = await service.marketListings({ ...owner, userId: '14' });
    expect(stale.listings[0]).toMatchObject({ sellerId: '13', own: false, priceFormatted: '250.50 xu' });
    const listingId = stale.listings[0].listingId;
    const buyRequest = randomUUID();
    const [purchase, retry] = await Promise.all([
        service.marketBuy({ ...owner, userId: '14' }, { requestId: buyRequest, listingId }),
        service.marketBuy({ ...owner, userId: '14' }, { requestId: buyRequest, listingId })
    ]);
    expect([purchase.replayed, retry.replayed].sort()).toEqual([false, true]);
    expect(purchase).toMatchObject({ status: 'bought', item: { id: 'owned' } });
    const saved = await disk.read('1');
    expect(saved.skinCases[13].drops).toEqual([]);
    expect(saved.skinCases[14].drops.at(-1)).toMatchObject({ id: 'owned', inventoryRevision: listingId });
    expect(readCoins(saved.taixiu.balances[14])).toBe(readCoins('555') - BigInt('25050'));
    expect(readCoins(saved.taixiu.balances[13])).toBe(readCoins('1000000') + 25050n);
});

test('web market rejects locked, stale-priced, self-purchase and quote-less listings', async () => {
    await service.locks(owner, { itemIds: ['owned'], locked: true });
    await expect(service.marketList(owner, { requestId: randomUUID(), itemId: 'owned', price: '1', expectedMarketValue: '10000' })).rejects.toMatchObject({ status: 409 });
    await service.locks(owner, { itemIds: ['owned'], locked: false });
    await expect(service.marketList(owner, { requestId: randomUUID(), itemId: 'owned', price: '1', expectedMarketValue: '9999' })).rejects.toMatchObject({ status: 409 });
    await expect(service.marketList(owner, { requestId: randomUUID(), itemId: 'owned', price: '1', expectedMarketValue: '10000' })).resolves.toMatchObject({ status: 'listed' });
    const listing = (await service.marketListings(owner)).listings[0];
    await expect(service.marketBuy(owner, { requestId: randomUUID(), listingId: listing.listingId })).rejects.toMatchObject({ status: 409 });
    await change(state => { state.cs2PlayerMarket[listing.listingId].price = '999999999'; });
    await expect(service.marketBuy({ ...owner, userId: '14' }, { requestId: randomUUID(), listingId: listing.listingId })).rejects.toMatchObject({ status: 409 });
    expired = true;
    await expect(service.marketBuy({ ...owner, userId: '14' }, { requestId: randomUUID(), listingId: listing.listingId })).rejects.toMatchObject({ status: 409 });
});

test('web transfer validates same-guild recipients, balance and idempotent retries', async () => {
    await expect(service.transferQuote(owner, { recipientId: owner.userId, amount: '1' })).rejects.toMatchObject({ status: 400 });
    guild.members.fetch.mockImplementationOnce(async ({ user }) => ({ user: { id: user, bot: false } }))
        .mockImplementationOnce(async () => null);
    await expect(service.transferQuote(owner, { recipientId: '999', amount: '1' })).rejects.toMatchObject({ status: 404 });
    guild.members.fetch.mockImplementationOnce(async ({ user }) => ({ user: { id: user, bot: false } }))
        .mockImplementationOnce(async ({ user }) => ({ user: { id: user, bot: false }, guild: { id: '2' } }));
    await expect(service.transferQuote(owner, { recipientId: '999', amount: '1' })).rejects.toMatchObject({ status: 404 });
    await expect(service.transferQuote(owner, { recipientId: '14', amount: '999999999' })).rejects.toMatchObject({ status: 409 });
    const quote = await service.transferQuote(owner, { recipientId: '14', amount: '10.25' });
    expect(quote).toMatchObject({ recipientId: '14', recipientName: 'Người chơi 14', amount: '1025', amountInput: '10.25', fee: '0', balanceAfter: (100000000 - 1025).toString() });
    const requestId = randomUUID(), body = { requestId, recipientId: '14', amount: quote.amountInput };
    const [first, retry] = await Promise.all([service.transfer(owner, body), service.transfer(owner, body)]);
    expect([first.replayed, retry.replayed].sort()).toEqual([false, true]);
    const saved = await disk.read('1');
    expect(readCoins(saved.taixiu.balances[13])).toBe(100000000n - 1025n);
    expect(readCoins(saved.taixiu.balances[14])).toBe(55500n + 1025n);
    expect(saved.skinCases[13].webHistory[0].action).toBe('transfer');
    expect(saved.skinCases[14].webHistory[0].action).toBe('receive');
    await expect(service.transfer(owner, { ...body, amount: '10.50' })).rejects.toMatchObject({ status: 409 });
});

test('large transfer confirmation reuses normalized xu input instead of minor units', async () => {
    await change(state => { state.taixiu.balances[13] = serializeCoins(30_000_000n * 100n); });
    const quote = await service.transferQuote(owner, { recipientId: '14', amount: '20,000,000' });
    expect(quote).toMatchObject({ amount: '2000000000', amountInput: '20000000.00' });
    const result = await service.transfer(owner, { requestId: randomUUID(), recipientId: '14', amount: quote.amountInput });
    expect(result.balance).toBe('1000000000');
    const saved = await disk.read('1');
    expect(readCoins(saved.taixiu.balances[13])).toBe(10_000_000n * 100n);
    expect(readCoins(saved.taixiu.balances[14])).toBe(20_000_555n * 100n);
});

test('web transfer limits repeated sends to ten per hour', async () => {
    for (let index = 0; index < 10; index++) {
        await service.transfer(owner, { requestId: randomUUID(), recipientId: '14', amount: '1' });
    }
    await expect(service.transfer(owner, { requestId: randomUUID(), recipientId: '14', amount: '1' })).rejects.toMatchObject({ status: 429 });
});

test('sale quotes expire and inventory revision changes reject stale confirmation', async () => {
    const quote = await service.sellQuote(owner, { itemIds: ['owned'] });
    expired = true;
    await expect(service.sellQuote(owner, { itemIds: ['owned'] })).rejects.toMatchObject({ status: 409 });
    expired = false;
    await change(state => { state.skinCases[13].drops[0].inventoryRevision = 'returned-from-market'; });
    await expect(service.sell(owner, { requestId: randomUUID(), itemIds: ['owned'], quoteId: quote.quoteId })).rejects.toMatchObject({ status: 409 });
});

test('opening cannot use an expired market quote even if the cached market adapter returns it', async () => {
    const detail = service.caseDetail('battle-howl');
    const before = await disk.read('1');
    expired = true;
    expect(service.caseDetail('battle-howl').case.available).toBe(false);
    await expect(service.open(owner, { requestId: randomUUID(), caseId: 'battle-howl', count: 1, quoteId: detail.quoteId })).rejects.toMatchObject({ status: 409 });
    expect(await disk.read('1')).toEqual(before);
});

test('fresh member validation rejects forged guilds, left members, bot accounts and stopped client', async () => {
    await expect(service.validateOwner({ ...owner, guildId: '2' })).rejects.toMatchObject({ status: 403 });
    guild.members.fetch.mockResolvedValueOnce(null);
    await expect(service.validateOwner(owner)).rejects.toMatchObject({ status: 403 });
    guild.members.fetch.mockResolvedValueOnce({ user: { id: owner.userId, bot: true } });
    await expect(service.locks(owner, { itemIds: ['owned'], locked: true })).rejects.toMatchObject({ status: 403 });
    client.isReady = () => false;
    await expect(service.validateOwner(owner)).rejects.toMatchObject({ status: 503 });
    expect(guild.members.fetch).toHaveBeenCalledWith({ user: owner.userId, force: true, cache: false });
});

test('upgrade wraps existing atomic engine, hides prepared seed and retries settled receipt without double spend', async () => {
    const target = upgrade.targetCatalogue().find(item => item.name !== quoteRef(input).name && item.skinId !== input.skinId && item.tier === 1);
    prices.set(target.marketRef.name, 400);
    const body = { inputIds: ['owned'], targetId: target.id, coinStake: '1.25', clientSeed: 'web-seed', direction: 'under' };
    const preview = await service.upgradePreview(owner, body);
    expect(preview).toMatchObject({ status: 'ready', inputValue: '10000', coinStake: '125', stake: '10125', targetValue: '40000' });
    const prepared = await service.upgradePrepare(owner, { ...body, expectedSignature: preview.signature, expectedPrices: preview.prices });
    expect(prepared.attempt.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(prepared)).not.toMatch(/serverSeed|salt/);
    const confirm = { attemptId: prepared.attempt.id, expectedHash: prepared.attempt.hash, expectedClientSeed: 'web-seed' };
    const [first, second] = await Promise.all([service.upgradeSettle(owner, confirm), service.upgradeSettle(owner, confirm)]);
    expect([first.replayed, second.replayed].sort()).toEqual([false, true]);
    expect(first.receipt).toMatchObject({ verified: true, clientSeed: 'web-seed' });
    expect(first.receipt.serverSeed).toMatch(/^[a-f0-9]{64}$/);
    const saved = await disk.read('1');
    expect(readCoins(saved.taixiu.balances[13])).toBe(100000000n - 125n);
    expect(saved.skinCases[13].upgrade.history).toHaveLength(1);
    expect(saved.skinCases[14].drops[0].id).toBe('other');
});

test('upgrade target results are bounded and exact zero coin input remains valid', async () => {
    const list = await service.targets(owner, { search: 'Howl', minValue: '1' });
    expect(list.items.length).toBeGreaterThan(0);
    expect(list.items.length).toBeLessThanOrEqual(50);
    expect(list.items.every(item => item.name.includes('Howl') && item.value === '10000')).toBe(true);
    const target = upgrade.targetCatalogue().find(item => item.skinId !== input.skinId && item.tier === 1);
    prices.set(target.marketRef.name, 400);
    expect((await service.upgradePreview(owner, { inputIds: ['owned'], targetId: target.id, coinStake: '0' })).coinStake).toBe('0');
    await expect(service.targets(owner, { minValue: '-1' })).rejects.toMatchObject({ status: 400 });
});

test('target recommendations choose the closest suitable value within exact stake and odds bounds', async () => {
    const candidates = [...new Map(upgrade.targetCatalogue().map(target => [target.marketRef.name, target])).values()].slice(0, 3);
    prices.set(candidates[0].marketRef.name, 150);
    prices.set(candidates[1].marketRef.name, 220);
    prices.set(candidates[2].marketRef.name, 500);
    const query = { minValue: '10001', maxValue: '30000', desiredValue: '20000' };
    const nearest = await service.targets(owner, query);
    expect(nearest.items.length).toBeGreaterThan(1);
    expect(nearest.items[0].value).toBe('22000');
    expect(nearest.items.every(item => BigInt(item.value) > 10000n && BigInt(item.value) <= 30000n)).toBe(true);
    const ascending = await service.targets(owner, { minValue: query.minValue, maxValue: query.maxValue });
    expect(ascending.items[0].value).toBe('15000');
    const tied = await service.targets(owner, { ...query, desiredValue: '18500' });
    expect(tied.items[0].value).toBe('15000');
    for (const invalid of [{ maxValue: '-1' }, { desiredValue: 'nope' }, { minValue: '100', maxValue: '99' }]) {
        await expect(service.targets(owner, invalid)).rejects.toMatchObject({ status: 400 });
    }
});

test.each([-1, 100000, 1.5, '100', null])('upgrade API rejects invalid circular region offset %p', async startTicket => {
    const body = { inputIds: ['owned'], coinStake: '0', startTicket };
    await expect(service.upgradePreview(owner, body)).rejects.toMatchObject({ status: 400 });
    await expect(service.upgradePrepare(owner, body)).rejects.toMatchObject({ status: 400 });
});

test('whole inventory requests still reject duplicate, foreign and locked inputs', async () => {
    const target = upgrade.targetCatalogue().find(item => item.name !== quoteRef(input).name && item.skinId !== input.skinId && item.tier === 1);
    prices.set(target.marketRef.name, 400);
    const body = { inputIds: ['owned', 'owned'], targetId: target.id, coinStake: '0' };
    await expect(service.upgradePreview(owner, body)).rejects.toMatchObject({ status: 400 });
    await expect(service.upgradePreview(owner, { ...body, inputIds: ['other'] })).rejects.toMatchObject({ status: 409 });
    await change(state => { state.skinCases[13].drops[0].locked = true; });
    await expect(service.upgradePreview(owner, { ...body, inputIds: ['owned'] })).rejects.toMatchObject({ status: 409 });
});

const postgresTest = process.env.TEST_DATABASE_URL ? test : test.skip;
postgresTest('PostgreSQL persists each receipt separately and replays after a fresh database connection without charging twice', async () => {
    const { createDatabase } = require('../utils/database');
    let first, restarted;
    try {
        first = createDatabase({ connectionString: process.env.TEST_DATABASE_URL, max: 3 });
        await first.initialize();
        await first.reset();
        const pg = store.createPostgresManagementStore(first);
        const initial = await disk.read('1');
        await pg.transact('1', async (state, save) => { Object.assign(state, initial); await save(); });
        store.read.mockImplementation(pg.read);
        store.transact.mockImplementation(pg.transact);
        const detail = service.caseDetail('battle-howl');
        const body = { requestId: randomUUID(), caseId: 'battle-howl', count: 3, quoteId: detail.quoteId };
        const results = await Promise.all([service.open(owner, body), service.open(owner, body)]);
        expect(results.map(result => result.replayed).sort()).toEqual([false, true]);
        const section = `playerWebRequest:13:${body.requestId}`;
        const rows = await first.query('SELECT section, entry_key, data FROM discord_bot.guild_records WHERE guild_id = $1 AND section = $2', ['1', section]);
        expect(rows.rows.filter(row => row.entry_key === 'result')).toHaveLength(1);
        expect(rows.rows.find(row => row.entry_key === 'result').data.results).toHaveLength(3);
        const metadata = await first.query('SELECT data FROM discord_bot.guild_records WHERE guild_id = $1 AND section = $2 AND entry_key = $3', ['1', 'skinCases', '13']);
        expect(metadata.rows[0].data).toMatchObject({ webRequestCount: 1, drops: [] });
        expect(metadata.rows[0].data.webRequests).toBeUndefined();
        await first.close(); first = null;
        restarted = createDatabase({ connectionString: process.env.TEST_DATABASE_URL, max: 2 });
        const fresh = store.createPostgresManagementStore(restarted);
        store.read.mockImplementation(fresh.read);
        store.transact.mockImplementation(fresh.transact);
        const retry = await service.open(owner, body);
        expect(retry).toEqual({ ...results[0], replayed: true });
        const saved = await fresh.read('1', { wallets: ['13'], inventory: ['13'] });
        expect(saved.skinCases[13].drops).toHaveLength(4);
        expect(saved.skinCases[13].webRequestCount).toBe(1);
        expect(Object.keys(saved).some(key => key.startsWith('playerWebRequest:'))).toBe(false);
        expect(readCoins(saved.taixiu.balances[13])).toBe(100000000n - BigInt(retry.total));
    } finally { await Promise.allSettled([first?.close(), restarted?.close()]); }
});
