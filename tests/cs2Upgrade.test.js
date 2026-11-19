const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const store = require('../utils/managementStore');
const market = require('../utils/cs2Market');
const wallet = require('../commands/taixiu');
const upgrade = require('../utils/cs2Upgrade');
const { cases, skins } = require('../utils/cs2Catalogue');
const { COIN_SCALE } = require('../utils/coins');
const { wearBounds, wearIndex } = require('../utils/cs2MarketNames');

const NOW = Date.UTC(2026, 10, 16, 8);
const SERVER = 'c4ca4238a0b92382';
const SALT = '0dcc509a6f75849b';
const HASH = 'dc883b29588c1204fcad00984aaa2404c2251f9a0e5300106eb39aaebcc0f493';
const guild = { id: '1', channels: { cache: new Map() } };
const userId = '13';
const weaponCase = cases.find(item => item.id === 'crate-4904');
const skinId = weaponCase.pools[0].find(id => skins[id].min === 0 && skins[id].max === 1 && skins[id].stattrak);
const input = { id: 'input-1', caseId: weaponCase.id, skinId, tier: 0, float: 0.25, statTrak: false,
    paintSeed: 17, inventoryRevision: 'original' };
const gemSkinId = Object.keys(skins).find(id => skins[id].name === 'AK-47 | Case Hardened');
const gemCase = cases.find(item => item.pools.some(pool => pool.includes(gemSkinId)));
const premiumInput = { ...input, caseId: gemCase.id, skinId: gemSkinId,
    tier: gemCase.pools.findIndex(pool => pool.includes(gemSkinId)), paintSeed: 661, priceVariant: 'blue-gem' };
const unrelated = { ...input, id: 'keep' };
const targets = upgrade.targetCatalogue();
const target = targets.find(item => item.skinId !== skinId && item.statTrak && item.exterior === 1);
let directory;
let disk;
let quotes;

function price(ref, priceVnd, overrides = {}) {
    const quote = { source: ref.paintSeed == null ? 'buff' : 'csfloat', phase: ref.phase,
        ...(ref.paintSeed == null ? {} : { paintSeed: ref.paintSeed }),
        priceVnd, observedAt: NOW - 1000, expiresAt: NOW + 600_000, ...overrides };
    quotes.set(market.marketQuoteKey(ref.name, ref.phase, ref.paintSeed), quote);
    return quote;
}

async function usePremiumInput() {
    await change(state => { state.skinCases[userId].drops[0] = structuredClone(premiumInput); });
    const ref = market.getDropMarketQuoteRef(premiumInput);
    price(ref, 100);
    return ref;
}

function request(overrides = {}) {
    return { inputIds: [input.id], targetId: target.id, clientSeed: 'my_seed', ...overrides };
}

async function change(operation) {
    await disk.transact(guild.id, async (state, save) => { operation(state); await save(); });
}

function failCommitOnce(message) {
    store.transact.mockImplementationOnce(async (guildId, operation) => {
        await operation(await disk.read(guildId), async () => {});
        throw new Error(message);
    });
}

beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-cs2-upgrade-test-'));
    disk = store.createManagementStore(directory);
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    jest.spyOn(store, 'read').mockImplementation(disk.read);
    jest.spyOn(store, 'transact').mockImplementation(disk.transact);
    jest.spyOn(wallet, 'refreshCoinLeaderboard').mockImplementation(() => {});
    jest.spyOn(crypto, 'randomBytes').mockReturnValueOnce(Buffer.from(SERVER, 'hex')).mockReturnValueOnce(Buffer.from(SALT, 'hex'));
    quotes = new Map();
    jest.spyOn(market, 'peekMarketQuote').mockImplementation((name, { phase = null, paintSeed } = {}) =>
        quotes.get(market.marketQuoteKey(name, phase, paintSeed)) ?? null);
    price(market.getDropMarketQuoteRef(input), 100);
    price(target.marketRef, 400);
    await change(state => {
        state.taixiu.balances = { [userId]: 1000, 14: 700 };
        state.skinCases = {
            [userId]: { drops: [structuredClone(input), structuredClone(unrelated)], cases: { [weaponCase.id]: 2 },
                upgrade: { nextNonce: 4, lastSettledNonce: 0, history: [] } },
            14: { drops: [{ ...input, id: 'other-owner' }] }
        };
    });
});

afterEach(async () => {
    jest.restoreAllMocks();
    for (const file of await fs.readdir(directory)) await fs.unlink(path.join(directory, file));
    await fs.rmdir(directory);
});

test('the official HMAC fixture produces its exact commitment and ticket', () => {
    expect(upgrade.commitment(SERVER, SALT)).toBe(HASH);
    expect(upgrade.fairTicket(SERVER, 'my_seed', 4)).toBe(21752);
});

test('target descriptors are unique by phase and wear and stay within each skin float range', () => {
    expect(targets.length).toBeGreaterThan(1000);
    expect(new Set(targets.map(item => item.id)).size).toBe(targets.length);
    expect(new Set(targets.map(item => market.marketQuoteKey(item.marketRef.name, item.marketRef.phase))).size).toBe(targets.length);
    for (const item of targets) {
        expect(upgrade.getTarget(item.id)).toBe(item);
        expect(market.getDropMarketQuoteRef(item.drop)).toEqual(item.marketRef);
        if (item.minFloat == null) {
            expect(item.maxFloat).toBeNull();
            expect(item.exterior).toBeNull();
        } else {
            expect(item.minFloat).toBeLessThanOrEqual(item.maxFloat);
            expect(wearIndex(item.minFloat)).toBe(item.exterior);
            expect(wearIndex(item.maxFloat)).toBe(item.exterior);
            expect(item.minFloat).toBeGreaterThanOrEqual(Math.round(skins[item.skinId].min * 1e6) / 1e6);
            expect(item.maxFloat).toBeLessThanOrEqual(Math.round(skins[item.skinId].max * 1e6) / 1e6);
            expect(item.maxFloat).toBeLessThanOrEqual(wearBounds[item.exterior + 1]);
        }
    }
    const phased = targets.find(item => item.phase);
    expect(targets.some(item => item.name === phased.name && item.phase !== phased.phase && item.id !== phased.id)).toBe(true);
    expect(Object.isFrozen(targets)).toBe(true);
});

test('eligible inputs exclude locks, duplicate ownership IDs, invalid floats and forged catalogue entries', () => {
    const stash = { drops: [input, unrelated, { ...input, id: 'locked', locked: true },
        { ...input, id: 'bad-case', caseId: 'does-not-exist' }, { ...input, id: 'bad-tier', tier: 4 },
        { ...input, id: 'bad-float', float: 1.5 }, { ...input, id: 'bad-precision', float: 0.1234567 },
        { ...input, id: 'bad-seed', paintSeed: -1 }, { ...input, id: 'duplicate' }, { ...input, id: 'duplicate' }] };
    expect(upgrade.eligibleInputs(stash)).toEqual([input, unrelated]);
});

test('preview uses exact coin units, floors the 95 percent formula and applies chance limits', () => {
    let plan = upgrade.preview({ drops: [input], targetId: target.id, coinStake: 1n });
    expect(plan).toMatchObject({ status: 'ready', inputValue: 100n * COIN_SCALE, coinStake: 1n,
        stake: 100n * COIN_SCALE + 1n, targetValue: 400n * COIN_SCALE, winTickets: 23752, chance: 23.752 });
    expect(plan.multiplier).toBeCloseTo(40000 / 10001);
    expect(upgrade.preview({ drops: [input], targetId: target.id, coinStake: 299n * COIN_SCALE }).winTickets).toBe(90000);
    price(target.marketRef, 9500);
    expect(upgrade.preview({ drops: [input], targetId: target.id }).winTickets).toBe(1000);
    price(target.marketRef, 9501);
    expect(upgrade.preview({ drops: [input], targetId: target.id }).status).toBe('chance-too-low');
    price(target.marketRef, 100);
    expect(upgrade.preview({ drops: [input], targetId: target.id }).status).toBe('target-too-cheap');
});

test('invalid selections and stakes cannot prepare or reserve a seed', async () => {
    const before = await disk.read(guild.id);
    expect(upgrade.preview({ drops: {}, targetId: target.id }).status).toBe('invalid-inputs');
    expect(upgrade.preview({ drops: [input, input], targetId: target.id }).status).toBe('invalid-inputs');
    for (const coinStake of [-1n, 1, '100']) expect(upgrade.preview({ drops: [input], targetId: target.id, coinStake }).status).toBe('invalid-stake');
    await expect(upgrade.prepare(guild.id, userId, request({ inputIds: [input.id, input.id] }))).resolves.toEqual({ status: 'stale-inputs' });
    await expect(upgrade.prepare(guild.id, userId, request({ inputIds: ['missing'] }))).resolves.toEqual({ status: 'stale-inputs' });
    await expect(upgrade.prepare(guild.id, userId, request({ clientSeed: 'bad\nseed' }))).resolves.toEqual({ status: 'invalid-client-seed' });
    await expect(upgrade.prepare(guild.id, userId, request({ direction: 'sideways' }))).resolves.toEqual({ status: 'invalid-direction' });
    expect(await disk.read(guild.id)).toEqual(before);
    expect(crypto.randomBytes).not.toHaveBeenCalled();
});

test('the entire eligible inventory can be prepared and consumed atomically beyond the former ten-skin cap', async () => {
    const inventory = Array.from({ length: 501 }, (_, id) => ({ ...input, id: `inventory-${id}` }));
    const locked = { ...unrelated, locked: true };
    await change(state => { state.skinCases[userId].drops = [...inventory, locked]; });
    price(target.marketRef, 100_000);
    const inputIds = upgrade.eligibleInputs((await disk.read(guild.id)).skinCases[userId]).map(drop => drop.id);
    expect(inputIds).toHaveLength(501);
    const preview = upgrade.preview({ drops: inventory, targetId: target.id });
    expect(preview).toMatchObject({ status: 'ready', inputValue: 50_100n * COIN_SCALE, winTickets: 47595 });
    const { attempt } = await upgrade.prepare(guild.id, userId, request({ inputIds,
        expectedSignature: preview.signature, expectedPrices: preview.prices }));
    expect(attempt.inputIds).toEqual(inputIds);
    const results = await Promise.all([upgrade.settle(guild.id, userId, attempt.id), upgrade.settle(guild.id, userId, attempt.id)]);
    expect(results.map(result => result.status).sort()).toEqual(['duplicate', 'settled']);
    expect(results[0].receipt).toEqual(results[1].receipt);
    expect(upgrade.verify(results[0].receipt)).toBe(true);
    const state = await disk.read(guild.id);
    expect(state.skinCases[userId].drops).toEqual([locked, results[0].receipt.drop]);
    expect(state.taixiu.balances[userId]).toBe(1000);
    expect(state.skinCases['14'].drops).toEqual([{ ...input, id: 'other-owner' }]);
});

test.each([-1, 100_000, 0.1, NaN, Infinity, '0', null])('invalid circular range start %s cannot reserve a seed', async startTicket => {
    const before = await disk.read(guild.id);
    expect(upgrade.preview({ drops: [input], targetId: target.id, startTicket })).toEqual({ status: 'invalid-start-ticket' });
    await expect(upgrade.prepare(guild.id, userId, request({ startTicket }))).resolves.toEqual({ status: 'invalid-start-ticket' });
    expect(await disk.read(guild.id)).toEqual(before);
    expect(crypto.randomBytes).not.toHaveBeenCalled();
});

test('preparation reuses only the same circular region and preserves it when the client seed changes', async () => {
    const first = await upgrade.prepare(guild.id, userId, request({ startTicket: 98_002 }));
    const repeated = await upgrade.prepare(guild.id, userId, request({ startTicket: 98_002 }));
    expect(repeated).toEqual(first);
    const updated = await upgrade.updateClientSeed(guild.id, userId, first.attempt.id, 'after-commit');
    expect(updated.attempt).toMatchObject({ startTicket: 98_002, hash: first.attempt.hash, nonce: first.attempt.nonce });
    const shifted = await upgrade.prepare(guild.id, userId, request({ startTicket: 98_001 }));
    expect(shifted.attempt.id).not.toBe(first.attempt.id);
    expect(shifted.attempt).toMatchObject({ startTicket: 98_001, nonce: first.attempt.nonce + 1 });
});

test('preparing is idempotent and discloses only the commitment before settlement', async () => {
    const before = await disk.read(guild.id);
    const plan = upgrade.preview({ drops: [input], targetId: target.id });
    const options = request({ expectedSignature: plan.signature, expectedPrices: plan.prices });
    const [first, second] = await Promise.all([upgrade.prepare(guild.id, userId, options), upgrade.prepare(guild.id, userId, options)]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ status: 'prepared', attempt: { nonce: 4, hash: HASH, winTickets: 23750 } });
    expect(first.attempt).not.toHaveProperty('serverSeed');
    expect(first.attempt).not.toHaveProperty('salt');
    expect(JSON.stringify(first.attempt)).not.toContain(SERVER);
    expect(await upgrade.pending(guild.id, userId)).toEqual(first.attempt);
    const after = await disk.read(guild.id);
    expect(after.taixiu.balances).toEqual(before.taixiu.balances);
    expect(after.skinCases[userId].drops).toEqual(before.skinCases[userId].drops);
    expect(after.skinCases[userId].upgrade.nextNonce).toBe(5);
    expect(crypto.randomBytes).toHaveBeenCalledTimes(2);
});

test('the client seed can change after commitment without rotating the server seed or nonce', async () => {
    const { attempt: prepared } = await upgrade.prepare(guild.id, userId, request());
    const changed = await upgrade.updateClientSeed(guild.id, userId, prepared.id, 'picked_after_commit');
    expect(changed.status).toBe('updated');
    expect(changed.attempt).toMatchObject({
        id: prepared.id, nonce: prepared.nonce, hash: prepared.hash, signature: prepared.signature,
        prices: prepared.prices, expiresAt: prepared.expiresAt, clientSeed: 'picked_after_commit'
    });
    expect(changed.attempt).not.toHaveProperty('serverSeed');
    expect(changed.attempt).not.toHaveProperty('salt');
    const result = await upgrade.settle(guild, userId, prepared.id);
    expect(result.receipt.clientSeed).toBe('picked_after_commit');
    expect(result.receipt.ticket).toBe(upgrade.fairTicket(SERVER, 'picked_after_commit', prepared.nonce));
    expect(result.receipt.hash).toBe(prepared.hash);
    expect(upgrade.verify(result.receipt)).toBe(true);
});

test('an old client-seed confirmation consumes nothing after a seed update', async () => {
    const { attempt } = await upgrade.prepare(guild.id, userId, request({ coinStake: 50n * COIN_SCALE }));
    await upgrade.updateClientSeed(guild.id, userId, attempt.id, 'updated_seed');
    const before = await disk.read(guild.id);
    await expect(upgrade.settle(guild, userId, attempt.id, {
        expectedClientSeed: attempt.clientSeed, expectedHash: attempt.hash
    })).resolves.toEqual({ status: 'stale-confirmation' });
    await expect(upgrade.settle(guild, userId, attempt.id, {
        expectedClientSeed: 'updated_seed', expectedHash: 'unseen_hash'
    })).resolves.toEqual({ status: 'stale-confirmation' });
    expect(await disk.read(guild.id)).toEqual(before);
    expect(wallet.refreshCoinLeaderboard).not.toHaveBeenCalled();
    const result = await upgrade.settle(guild, userId, attempt.id, {
        expectedClientSeed: 'updated_seed', expectedHash: attempt.hash
    });
    expect(result).toMatchObject({ status: 'settled', balance: 950n * COIN_SCALE });
    expect(upgrade.verify(result.receipt)).toBe(true);
});

test('a stale preview signature or a changed price cannot become a new attempt', async () => {
    const plan = upgrade.preview({ drops: [input], targetId: target.id });
    await change(state => { state.skinCases[userId].drops[0].inventoryRevision = 'changed'; });
    await expect(upgrade.prepare(guild.id, userId, request({ expectedSignature: plan.signature }))).resolves.toEqual({ status: 'stale-inputs' });
    price(target.marketRef, 401);
    await expect(upgrade.prepare(guild.id, userId, request({ expectedPrices: plan.prices }))).resolves.toEqual({ status: 'price-changed' });
    expect(await upgrade.pending(guild.id, userId)).toBeNull();
    expect(crypto.randomBytes).not.toHaveBeenCalled();
});

test.each(['expired', 'phase', 'changed'])('a %s quote blocks settlement without consuming anything', async mode => {
    const { attempt } = await upgrade.prepare(guild.id, userId, request());
    const quote = quotes.get(market.marketQuoteKey(target.marketRef.name, target.marketRef.phase));
    if (mode === 'expired') quote.expiresAt = NOW;
    if (mode === 'phase') quote.phase = 'Wrong phase';
    if (mode === 'changed') quote.priceVnd++;
    const before = await disk.read(guild.id);
    await expect(upgrade.settle(guild, userId, attempt.id)).resolves.toEqual({ status: mode === 'changed' ? 'price-changed' : 'missing-price' });
    expect(await disk.read(guild.id)).toEqual(before);
    expect(wallet.refreshCoinLeaderboard).not.toHaveBeenCalled();
});

test('phased targets require the exact phase price instead of accepting the base finish quote', () => {
    const phased = targets.find(item => item.phase);
    price(phased.marketRef, 400, { phase: null });
    expect(upgrade.preview({ drops: [input], targetId: phased.id }).status).toBe('missing-price');
    price(phased.marketRef, 400);
    expect(upgrade.preview({ drops: [input], targetId: phased.id })).toMatchObject({ status: 'ready', target: { phase: phased.phase } });
    expect(market.peekMarketQuote).toHaveBeenCalledWith(phased.marketRef.name, phased.marketRef);
});

test('premium inputs use their exact seed price and retain source and seed in verifiable receipts', async () => {
    const ref = await usePremiumInput();
    price({ name: ref.name, phase: ref.phase }, 1);
    const plan = upgrade.preview({ drops: [premiumInput], targetId: target.id });
    expect(plan).toMatchObject({ status: 'ready', inputValue: 100n * COIN_SCALE,
        prices: { inputs: [{ id: premiumInput.id, name: ref.name, source: 'csfloat', paintSeed: 661, priceVnd: 100 }] } });
    expect(market.peekMarketQuote).toHaveBeenCalledWith(ref.name, ref);
    const { attempt } = await upgrade.prepare(guild.id, userId,
        request({ expectedSignature: plan.signature, expectedPrices: plan.prices }));
    const result = await upgrade.settle(guild.id, userId, attempt.id);
    expect(result.status).toBe('settled');
    expect(result.receipt.prices.inputs[0]).toMatchObject({ source: 'csfloat', paintSeed: 661, priceVnd: 100 });
    expect(result.receipt.prices.target).not.toHaveProperty('paintSeed');
    expect(result.receipt.prices.target).not.toHaveProperty('source');
    expect(result.drop).not.toHaveProperty('priceVariant');
    expect(upgrade.verify(result.receipt)).toBe(true);
    for (const mutate of [quote => { quote.source = 'buff'; }, quote => { delete quote.source; },
        quote => { quote.paintSeed = 321; }, quote => { delete quote.paintSeed; }]) {
        const changed = structuredClone(result.receipt);
        mutate(changed.prices.inputs[0]);
        expect(upgrade.verify(changed)).toBe(false);
    }
});

test.each(['missing', 'wrong-source', 'wrong-seed', 'missing-seed', 'expired'])(
    'a %s premium quote cannot use the base finish price or consume an input', async mode => {
        const ref = await usePremiumInput();
        price({ name: ref.name, phase: ref.phase }, 100);
        const quote = quotes.get(market.marketQuoteKey(ref.name, ref.phase, ref.paintSeed));
        if (mode === 'missing') quotes.delete(market.marketQuoteKey(ref.name, ref.phase, ref.paintSeed));
        if (mode === 'wrong-source') quote.source = 'buff';
        if (mode === 'wrong-seed') quote.paintSeed = 321;
        if (mode === 'missing-seed') delete quote.paintSeed;
        if (mode === 'expired') quote.expiresAt = NOW;
        const before = await disk.read(guild.id);
        expect(upgrade.preview({ drops: [premiumInput], targetId: target.id }).status).toBe('missing-price');
        await expect(upgrade.prepare(guild.id, userId, request())).resolves.toEqual({ status: 'missing-price' });
        expect(await disk.read(guild.id)).toEqual(before);
        expect(crypto.randomBytes).not.toHaveBeenCalled();
    }
);

test.each(['source', 'seed'])('a changed premium %s in preview prices requires a new confirmation', async field => {
    await usePremiumInput();
    const plan = upgrade.preview({ drops: [premiumInput], targetId: target.id });
    const expectedPrices = structuredClone(plan.prices);
    if (field === 'source') expectedPrices.inputs[0].source = 'buff';
    if (field === 'seed') expectedPrices.inputs[0].paintSeed = 321;
    const before = await disk.read(guild.id);
    await expect(upgrade.prepare(guild.id, userId, request({ expectedPrices }))).resolves.toEqual({ status: 'price-changed' });
    expect(await disk.read(guild.id)).toEqual(before);
    expect(crypto.randomBytes).not.toHaveBeenCalled();
});

test.each(['paintSeed', 'priceVariant'])('a changed premium input %s invalidates its committed signature', async field => {
    const ref = await usePremiumInput();
    const { attempt } = await upgrade.prepare(guild.id, userId, request());
    await change(state => {
        const drop = state.skinCases[userId].drops[0];
        if (field === 'paintSeed') drop.paintSeed = 321;
        if (field === 'priceVariant') delete drop.priceVariant;
    });
    price({ name: ref.name, phase: ref.phase }, 100);
    const before = await disk.read(guild.id);
    await expect(upgrade.settle(guild.id, userId, attempt.id)).resolves.toEqual({ status: 'stale-inputs' });
    expect(await disk.read(guild.id)).toEqual(before);
});

test.each(['removed', 'revision', 'locked'])('a %s input after preparation cannot be consumed', async mode => {
    const { attempt } = await upgrade.prepare(guild.id, userId, request());
    await change(state => {
        const stash = state.skinCases[userId];
        if (mode === 'removed') stash.drops.shift();
        if (mode === 'revision') stash.drops[0].inventoryRevision = 'new revision';
        if (mode === 'locked') stash.drops[0].locked = true;
    });
    const before = await disk.read(guild.id);
    const result = await upgrade.settle(guild, userId, attempt.id);
    expect(['stale-inputs', 'locked']).toContain(result.status);
    expect(await disk.read(guild.id)).toEqual(before);
});

test.each(['under', 'over'])('deterministic %s settlement consumes once and records a verifiable result', async direction => {
    const { attempt } = await upgrade.prepare(guild.id, userId, request({ direction, coinStake: 50n * COIN_SCALE }));
    const [first, second] = await Promise.all([upgrade.settle(guild, userId, attempt.id), upgrade.settle(guild, userId, attempt.id)]);
    expect([first.status, second.status].sort()).toEqual(['duplicate', 'settled']);
    expect(first.receipt).toEqual(second.receipt);
    const settled = first.status === 'settled' ? first : second;
    const won = direction === 'under';
    expect(settled).toMatchObject({ status: 'settled', balance: 950n * COIN_SCALE,
        receipt: { ticket: 21752, won, serverSeed: SERVER, salt: SALT, hash: HASH, nonce: 4 } });
    expect(upgrade.verify(settled.receipt)).toBe(true);
    expect(() => JSON.stringify(settled.receipt)).not.toThrow();
    const state = await disk.read(guild.id);
    expect(state.taixiu.balances).toEqual({ 13: 950, 14: 700 });
    expect(state.skinCases[userId].drops.some(drop => drop.id === input.id)).toBe(false);
    expect(state.skinCases[userId].drops.filter(drop => drop.id === unrelated.id)).toEqual([unrelated]);
    expect(state.skinCases[userId].drops).toHaveLength(won ? 2 : 1);
    expect(state.skinCases['14'].drops).toEqual([{ ...input, id: 'other-owner' }]);
    expect(state.skinCases[userId].cases).toEqual({ [weaponCase.id]: 2 });
    expect(state.skinCases[userId].upgrade.history).toHaveLength(1);
    expect(state.skinCases[userId].upgrade.pending).toBeUndefined();
    expect(wallet.refreshCoinLeaderboard).toHaveBeenCalledTimes(1);
});

test.each([[0, true], [21_751, true], [21_752, false], [98_002, true], [98_001, false], [99_999, true], [50_000, false]])(
    'circular range start %i has exact inclusive boundaries and wrapped settlement (%s)', async (startTicket, won) => {
        const plan = upgrade.preview({ drops: [input], targetId: target.id, startTicket });
        expect(plan).toMatchObject({ status: 'ready', winTickets: 23750, startTicket });
        const { attempt } = await upgrade.prepare(guild.id, userId, request({ startTicket }));
        expect(attempt.startTicket).toBe(startTicket);
        const result = await upgrade.settle(guild.id, userId, attempt.id);
        expect(result).toMatchObject({ status: 'settled', receipt: { ticket: 21752, winTickets: 23750, startTicket, won } });
        expect(upgrade.verify(result.receipt)).toBe(true);
        const changed = structuredClone(result.receipt);
        changed.startTicket = won ? 21_752 : 21_751;
        expect(upgrade.verify(changed)).toBe(false);
        changed.startTicket = 100_000;
        expect(upgrade.verify(changed)).toBe(false);
        if (!won) {
            delete changed.startTicket;
            expect(upgrade.verify(changed)).toBe(false);
        }
    }
);

test('an invalid stored circular region cannot consume assets', async () => {
    const { attempt } = await upgrade.prepare(guild.id, userId, request({ startTicket: 25_000 }));
    await change(state => { state.skinCases[userId].upgrade.pending.startTicket = -1; });
    const before = await disk.read(guild.id);
    await expect(upgrade.settle(guild.id, userId, attempt.id)).resolves.toEqual({ status: 'invalid-state' });
    expect(await disk.read(guild.id)).toEqual(before);
});

test('a winning output preserves the selected StatTrak, phase and exterior with deterministic float and seed', async () => {
    const phased = targets.find(item => item.phase && item.statTrak && item.exterior === 1);
    price(phased.marketRef, 400);
    const { attempt } = await upgrade.prepare(guild.id, userId, request({ targetId: phased.id }));
    const result = await upgrade.settle(guild.id, userId, attempt.id);
    expect(result.receipt.won).toBe(true);
    expect(result.drop).toMatchObject({ skinId: phased.skinId, caseId: phased.caseId, tier: phased.tier, statTrak: true,
        upgrade: true, upgradeAttemptId: attempt.id });
    expect(result.drop.float).toBeGreaterThanOrEqual(phased.minFloat);
    expect(result.drop.float).toBeLessThanOrEqual(phased.maxFloat);
    expect(wearIndex(result.drop.float)).toBe(phased.exterior);
    expect(Number.isInteger(result.drop.float * 1e6)).toBe(true);
    expect(result.drop.paintSeed).toBeGreaterThanOrEqual(0);
    expect(result.drop.paintSeed).toBeLessThanOrEqual(1000);
    expect(market.getDropMarketQuoteRef(result.drop)).toEqual(phased.marketRef);
    expect(upgrade.verify(result.receipt)).toBe(true);
});

test('coin-only upgrades debit the wallet and leave every pre-existing skin intact', async () => {
    const { attempt } = await upgrade.prepare(guild.id, userId, request({ inputIds: [], coinStake: 100n * COIN_SCALE }));
    expect(attempt).toMatchObject({ inputValue: '0', coinStake: '10000', stake: '10000', winTickets: 23750 });
    const result = await upgrade.settle(guild, userId, attempt.id);
    expect(result).toMatchObject({ status: 'settled', balance: 900n * COIN_SCALE, receipt: { won: true } });
    const state = await disk.read(guild.id);
    expect(state.skinCases[userId].drops).toEqual([input, unrelated, result.drop]);
    expect(state.taixiu.balances[userId]).toBe(900);
    expect(upgrade.verify(result.receipt)).toBe(true);
});

test('a balance spent after preparation blocks settlement and preserves its pending attempt', async () => {
    const { attempt } = await upgrade.prepare(guild.id, userId, request({ coinStake: 100n * COIN_SCALE }));
    await change(state => { state.taixiu.balances[userId] = 99; });
    const before = await disk.read(guild.id);
    await expect(upgrade.settle(guild, userId, attempt.id)).resolves.toEqual({ status: 'insufficient-funds' });
    expect(await disk.read(guild.id)).toEqual(before);
    expect(await upgrade.pending(guild.id, userId)).toEqual(attempt);
    expect(wallet.refreshCoinLeaderboard).not.toHaveBeenCalled();
});

test('settlement records renewed quote timestamps when prices remain unchanged', async () => {
    const { attempt } = await upgrade.prepare(guild.id, userId, request());
    Date.now.mockReturnValue(NOW + 2000);
    const inputQuote = price(market.getDropMarketQuoteRef(input), 100, { observedAt: NOW + 1000, expiresAt: NOW + 600_000 });
    const targetQuote = price(target.marketRef, 400, { observedAt: NOW + 1000, expiresAt: NOW + 600_000 });
    const result = await upgrade.settle(guild, userId, attempt.id);
    expect(result.status).toBe('settled');
    expect(result.receipt.prices).toEqual({
        inputs: [{ id: input.id, name: market.getDropMarketQuoteRef(input).name,
            phase: market.getDropMarketQuoteRef(input).phase, priceVnd: inputQuote.priceVnd,
            observedAt: inputQuote.observedAt, expiresAt: inputQuote.expiresAt }],
        target: { name: target.marketRef.name, phase: target.marketRef.phase, priceVnd: targetQuote.priceVnd,
            observedAt: targetQuote.observedAt, expiresAt: targetQuote.expiresAt }
    });
    expect(upgrade.verify(result.receipt)).toBe(true);
});

test('settlement uses one timestamp across attempt expiry, quote expiry and receipt verification', async () => {
    const { attempt } = await upgrade.prepare(guild.id, userId, request());
    const boundary = NOW + 100;
    await change(state => { state.skinCases[userId].upgrade.pending.expiresAt = boundary; });
    price(target.marketRef, 400, { expiresAt: boundary });
    price(market.getDropMarketQuoteRef(input), 100, { expiresAt: boundary });
    Date.now.mockImplementationOnce(() => boundary - 1).mockImplementationOnce(() => boundary + 1);
    const result = await upgrade.settle(guild, userId, attempt.id);
    expect(result.status).toBe('settled');
    expect(result.receipt.at).toBe(boundary - 1);
    expect(result.receipt.prices.target.expiresAt).toBe(boundary);
    expect(upgrade.verify(result.receipt)).toBe(true);
});

test('receipt verification rejects altered commitments, values, inputs and output attributes', async () => {
    const { attempt } = await upgrade.prepare(guild.id, userId, request());
    const { receipt } = await upgrade.settle(guild.id, userId, attempt.id);
    expect(upgrade.verify(receipt)).toBe(true);
    const mutations = [r => { r.ticket++; }, r => { r.hash = '0'.repeat(64); }, r => { r.serverSeed += 'a'; },
        r => { r.won = !r.won; }, r => { r.stake = String(BigInt(r.stake) + 1n); },
        r => { r.inputs[0].float = 0.3; }, r => { r.prices.target.priceVnd++; },
        r => { r.drop.float = 0.2; }, r => { r.drop.paintSeed = (r.drop.paintSeed + 1) % 1001; }];
    for (const mutate of mutations) {
        const changed = structuredClone(receipt);
        mutate(changed);
        expect(upgrade.verify(changed)).toBe(false);
    }
});

test('a failed prepare commit exposes no pending attempt and leaves its nonce and funds unchanged', async () => {
    const before = await disk.read(guild.id);
    failCommitOnce('Prepare COMMIT failed');
    await expect(upgrade.prepare(guild.id, userId, request())).rejects.toThrow('Prepare COMMIT failed');
    expect(await upgrade.pending(guild.id, userId)).toBeNull();
    expect(await disk.read(guild.id)).toEqual(before);
    expect(wallet.refreshCoinLeaderboard).not.toHaveBeenCalled();
});

test('a failed settle commit retries the same committed random result and pays exactly once', async () => {
    const { attempt } = await upgrade.prepare(guild.id, userId, request({ coinStake: 50n * COIN_SCALE }));
    const before = await disk.read(guild.id);
    failCommitOnce('Settle COMMIT failed');
    await expect(upgrade.settle(guild, userId, attempt.id)).rejects.toThrow('Settle COMMIT failed');
    expect(await disk.read(guild.id)).toEqual(before);
    expect(wallet.refreshCoinLeaderboard).not.toHaveBeenCalled();
    const result = await upgrade.settle(guild, userId, attempt.id);
    expect(result).toMatchObject({ status: 'settled', receipt: { ticket: 21752, won: true } });
    expect(upgrade.verify(result.receipt)).toBe(true);
    expect(crypto.randomBytes).toHaveBeenCalledTimes(2);
    const reopened = store.createManagementStore(directory);
    store.read.mockImplementation(reopened.read);
    store.transact.mockImplementation(reopened.transact);
    expect(await upgrade.pending(guild.id, userId)).toBeNull();
    const receipts = await upgrade.history(guild.id, userId);
    expect(receipts).toEqual([result.receipt]);
    receipts[0].ticket = 1;
    expect((await upgrade.history(guild.id, userId))[0].ticket).toBe(21752);
    await expect(upgrade.settle(guild, userId, attempt.id)).resolves.toEqual({ status: 'duplicate', receipt: result.receipt });
    expect((await reopened.read(guild.id)).taixiu.balances[userId]).toBe(950);
});

test('an expired pending attempt consumes nothing and a new reservation advances the nonce', async () => {
    const { attempt } = await upgrade.prepare(guild.id, userId, request());
    Date.now.mockReturnValue(NOW + upgrade.PENDING_TTL_MS);
    const before = await disk.read(guild.id);
    expect(await upgrade.pending(guild.id, userId)).toBeNull();
    await expect(upgrade.settle(guild, userId, attempt.id)).resolves.toEqual({ status: 'expired' });
    expect(await disk.read(guild.id)).toEqual(before);
    const next = await upgrade.prepare(guild.id, userId, request());
    expect(next).toMatchObject({ status: 'prepared', attempt: { nonce: 5 } });
    expect(next.attempt.id).not.toBe(attempt.id);
});

test('pruned receipts remain non-replayable after the bounded history evicts the original', async () => {
    await change(state => { state.taixiu.balances[userId] = 100_000; });
    const settled = [];
    for (let index = 0; index < upgrade.HISTORY_LIMIT + 1; index++) {
        const { attempt } = await upgrade.prepare(guild.id, userId, request({ inputIds: [], coinStake: 100n * COIN_SCALE }));
        const result = await upgrade.settle(guild.id, userId, attempt.id);
        expect(result.status).toBe('settled');
        settled.push(result);
    }
    const state = await disk.read(guild.id);
    expect(state.skinCases[userId].upgrade.history).toHaveLength(upgrade.HISTORY_LIMIT);
    expect(state.skinCases[userId].upgrade.history.map(receipt => receipt.id)).not.toContain(settled[0].receipt.id);
    expect(state.skinCases[userId].upgrade.lastSettledNonce).toBe(4 + upgrade.HISTORY_LIMIT);
    expect(state.taixiu.balances[userId]).toBe(100_000 - 100 * (upgrade.HISTORY_LIMIT + 1));
    await expect(upgrade.settle(guild, userId, settled[0].receipt.id)).resolves.toEqual({ status: 'not-found' });
    expect((await disk.read(guild.id)).taixiu.balances[userId]).toBe(100_000 - 100 * (upgrade.HISTORY_LIMIT + 1));
});

// Only the disposable PostgreSQL runner sets this variable; never read DATABASE_URL.
const postgresTest = process.env.TEST_DATABASE_URL ? test : test.skip;
postgresTest('two PostgreSQL pools settle a single attempt once without duplicating its output', async () => {
    const { createDatabase } = require('../utils/database');
    const first = createDatabase({ connectionString: process.env.TEST_DATABASE_URL, max: 2 });
    const second = createDatabase({ connectionString: process.env.TEST_DATABASE_URL, max: 2 });
    try {
        await Promise.all([first.initialize(), second.initialize()]);
        const boardStore = store.createPostgresManagementStore(first);
        const otherStore = store.createPostgresManagementStore(second);
        const initial = await disk.read(guild.id);
        await boardStore.transact('912345', async (state, save) => {
            state.taixiu = initial.taixiu;
            state.skinCases = initial.skinCases;
            await save();
        });
        store.transact.mockImplementation(boardStore.transact);
        store.read.mockImplementation(boardStore.read);
        const { attempt } = await upgrade.prepare('912345', userId, request({ coinStake: 50n * COIN_SCALE }));
        let call = 0;
        store.transact.mockImplementation((...args) => (++call % 2 ? boardStore : otherStore).transact(...args));
        const outcomes = await Promise.all([upgrade.settle('912345', userId, attempt.id), upgrade.settle('912345', userId, attempt.id)]);
        expect(outcomes.map(result => result.status).sort()).toEqual(['duplicate', 'settled']);
        expect(outcomes[0].receipt).toEqual(outcomes[1].receipt);
        const state = await otherStore.read('912345');
        expect(state.taixiu.balances).toEqual({ 13: 950, 14: 700 });
        expect(state.skinCases[userId].drops).toHaveLength(2);
        expect(state.skinCases[userId].drops.filter(drop => drop.upgradeAttemptId === attempt.id)).toHaveLength(1);
        expect(state.skinCases[userId].upgrade.history).toHaveLength(1);
        expect(state.skinCases[userId].upgrade.pending).toBeUndefined();
        expect(upgrade.verify(outcomes[0].receipt)).toBe(true);
    } finally { await Promise.allSettled([first.close(), second.close()]); }
}, 15_000);
