const crypto = require('node:crypto');
const market = require('../utils/cs2Market');
const { skins, containersById } = require('../utils/cs2Catalogue');
const { isBlueGem } = require('../utils/cs2Patterns');
const {
    TICKETS, BLUE_GEM_CASE_IDS, customCases, customCasesById, cachedPrices,
    casePricing, lockCasePricing, lockedCase, rollCustomCase
} = require('../utils/cs2BattleCases');

const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const keyOf = entry => market.marketQuoteKey(entry.ref.name, entry.ref.phase, entry.ref.paintSeed);
const item = customCasesById.get('battle-blue-gem');
const values = [1000, 2000, 60_000_000, 38_000_000, 13_000_000, 100_000_000];
const fixedPrices = entry => values[item.entries.findIndex(candidate => keyOf(candidate) === keyOf(entry))];

afterEach(() => jest.restoreAllMocks());

test('appends one certified Blue Gem case while all 108 existing distributions and candidates remain identical', () => {
    expect(BLUE_GEM_CASE_IDS).toEqual(['battle-blue-gem']);
    expect(Object.isFrozen(BLUE_GEM_CASE_IDS)).toBe(true);
    expect(customCases).toHaveLength(169);
    expect(customCasesById.size).toBe(169);
    expect(customCases[108]).toBe(item);
    const previous = customCases.slice(0, 108).map(entry => ({
        id: entry.id, entries: hash(entry.entries), legacy: hash(entry.legacyEntries), candidates: hash(entry.candidates)
    }));
    expect(hash(previous)).toBe('a96f6d2f566f85d393d277edc8922d4f3c8a572888662e7b0e2b95eeb9a81e4f');
    expect(previous).toHaveLength(108);
    expect(customCases.slice(0, 108).every(entry => entry.entries.every(({ drop }) =>
        !Object.hasOwn(drop, 'paintSeed') && !Object.hasOwn(drop, 'priceVariant')))).toBe(true);
});

test('publishes six exact seed and wear outcomes from real source cases without ordinary expansion candidates', () => {
    expect(item).toMatchObject({ name: 'Blue Gem', group: 'theme', blueOnly: true, candidates: [], goldTickets: 800, jackpotTickets: 50 });
    expect(item.entries).toBe(item.legacyEntries);
    expect(item.entries.map(entry => [skins[entry.drop.skinId].name, entry.exterior, entry.drop.paintSeed, entry.weight])).toEqual([
        ['Five-SeveN | Case Hardened', 4, 868, 5000],
        ['Five-SeveN | Case Hardened', 2, 868, 3000],
        ['AK-47 | Case Hardened', 2, 661, 1200],
        ['★ M9 Bayonet | Case Hardened', 2, 150, 500],
        ['★ Butterfly Knife | Case Hardened', 2, 182, 250],
        ['★ Karambit | Case Hardened', 2, 955, 50]
    ]);
    for (const entry of item.entries) {
        expect(containersById.get(entry.drop.caseId).pools[entry.drop.tier]).toContain(entry.drop.skinId);
        expect(isBlueGem(entry.drop.skinId, entry.drop.paintSeed)).toBe(true);
        expect(entry.drop.priceVariant).toBe('blue-gem');
        expect(entry.ref.paintSeed).toBe(entry.drop.paintSeed);
        expect(entry.min).toBeLessThanOrEqual(entry.max);
    }
    expect(item.entries.reduce((sum, entry) => sum + entry.weight, 0)).toBe(TICKETS);
    expect(new Set(item.entries.map(keyOf)).size).toBe(6);
});

test('every published ticket selects its fixed seed and exact prize without an extra seed draw', () => {
    jest.spyOn(crypto, 'randomBytes').mockReturnValue(Buffer.alloc(4));
    const counts = Array(6).fill(0);
    let index = 0;
    let boundary = item.entries[0].weight;
    for (let ticket = 0; ticket < TICKETS; ticket++) {
        while (ticket >= boundary) boundary += item.entries[++index].weight;
        const entry = item.entries[index];
        const calls = [];
        const draw = (...args) => {
            calls.push(args);
            return args.length === 1 ? ticket : args[0];
        };
        const outcome = rollCustomCase(item, values, 'drop', 123, draw);
        expect(outcome.value).toBe(BigInt(values[index]) * 100n);
        expect(outcome.drop).toMatchObject({
            skinId: entry.drop.skinId, paintSeed: entry.drop.paintSeed, priceVariant: 'blue-gem',
            float: entry.min / 1_000_000, id: 'drop', acquiredAt: 123, battleCaseId: item.id
        });
        expect(calls).toEqual([[TICKETS], [entry.min, entry.max + 1]]);
        counts[index]++;
    }
    expect(counts).toEqual([5000, 3000, 1200, 500, 250, 50]);
});

test('ordinary Case Hardened cases retain their independent random seed draw and base pricing provenance', () => {
    const ordinary = customCasesById.get('battle-case-hardened');
    const entry = ordinary.entries[0];
    const draw = jest.fn((min, max) => max === undefined ? min === TICKETS ? 0 : 661 : min);
    const result = rollCustomCase(ordinary, ordinary.entries.map(() => 1000), 'legacy-drop', 5, draw);
    expect(draw.mock.calls).toEqual([[TICKETS], [entry.min, entry.max + 1], [1001]]);
    expect(result.drop.paintSeed).toBe(661);
    expect(result.drop.priceVariant).toBeUndefined();
    expect(market.getDropMarketQuoteRef(result.drop)).not.toHaveProperty('paintSeed');
    expect(result.value).toBe(100_000n);
});

test('ordinary Battle prices and risk include exact seed odds while keeping the base and locking old room behavior', () => {
    const ordinary = { ...customCasesById.get('battle-case-hardened'), candidates: [] };
    const index = ordinary.entries.findIndex(entry => entry.ref.name === 'Five-SeveN | Case Hardened (Battle-Scarred)');
    const entry = ordinary.entries[index];
    const seed = 363;
    const base = 231_415;
    const premium = 7_729_500;
    const quote = jest.spyOn(market, 'peekMarketQuote').mockReturnValue(null);
    const legacy = lockCasePricing(casePricing(ordinary, () => base));
    expect(legacy).not.toHaveProperty('seedPrices');
    quote.mockImplementation((name, ref) => {
        if (name !== entry.ref.name || ref.paintSeed !== seed) return null;
        return { source: 'csfloat', paintSeed: seed, priceVnd: premium };
    });
    const pricing = casePricing(ordinary, () => base);
    expect(pricing.entries[index].seedPrices).toEqual([[seed, premium]]);
    expect(pricing.entries[index].weight).toBe(entry.weight);
    expect(pricing.values[index]).toBe(base);
    const jointTickets = BigInt(TICKETS * 1001);
    const weighted = BigInt(base) * jointTickets + BigInt((premium - base) * entry.weight);
    const numerator = weighted * 10_000n;
    const denominator = jointTickets * 95n;
    expect(pricing.expected).toBe(weighted * 100n / jointTickets);
    expect(pricing.fee).toBe((numerator + denominator - 1n) / denominator);
    expect(pricing.profitTickets).toBeCloseTo(entry.weight / 1001, 10);
    expect(pricing.lossTickets).toBeCloseTo(TICKETS - entry.weight / 1001, 10);
    expect(pricing.maxValue).toBe(BigInt(premium) * 100n);
    const locked = JSON.parse(JSON.stringify(lockCasePricing(pricing)));
    expect(locked.seedPrices[index]).toEqual([[seed, premium]]);
    expect(locked.revision).not.toBe(legacy.revision);
    const tampered = structuredClone(locked);
    tampered.seedPrices[index][0][1] = premium + 1;
    expect(lockedCase(ordinary, tampered)).toBeNull();
    for (const badRows of [[[seed, 0]], [[1, premium]], [[seed, premium], [seed, premium]], []]) {
        const malformed = structuredClone(locked);
        malformed.seedPrices[index] = badRows;
        expect(lockedCase(ordinary, malformed)).toBeNull();
    }

    quote.mockClear().mockImplementation(() => { throw new Error('Locked price cannot be refreshed during a roll.'); });
    const ticket = ordinary.entries.slice(0, index).reduce((sum, candidate) => sum + candidate.weight, 0);
    const draw = pattern => jest.fn((min, max) => max !== undefined ? max - 1 : min === TICKETS ? ticket : pattern);
    const restored = lockedCase(ordinary, locked);
    const selectSeed = draw(seed);
    const result = rollCustomCase(restored, locked.values, 'new-drop', 123, selectSeed);
    expect(selectSeed.mock.calls).toEqual([[TICKETS], [entry.min, entry.max + 1], [1001]]);
    expect(result).toMatchObject({ value: BigInt(premium) * 100n, drop: { paintSeed: seed, priceVariant: 'blue-gem' } });
    const unknownPrice = rollCustomCase(restored, locked.values, 'other-drop', 123, draw(868));
    expect(unknownPrice.value).toBe(BigInt(base) * 100n);
    expect(unknownPrice.drop).not.toHaveProperty('priceVariant');
    const oldRoom = rollCustomCase(lockedCase(ordinary, legacy), legacy.values, 'legacy-drop', 123, draw(seed));
    expect(oldRoom.value).toBe(BigInt(base) * 100n);
    expect(oldRoom.drop).not.toHaveProperty('priceVariant');
    expect(quote).not.toHaveBeenCalled();
});

test('uses only exact seed quotes and disables the whole case when any published premium quote is unavailable', () => {
    const network = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Unexpected network access'));
    const prices = new Map(item.entries.map((entry, index) => [keyOf(entry), values[index]]));
    const lookup = jest.spyOn(market, 'peekMarketQuote').mockImplementation((name, ref) => {
        const priceVnd = ref?.paintSeed == null ? 1 : prices.get(market.marketQuoteKey(name, ref.phase, ref.paintSeed));
        return priceVnd == null ? null : { source: 'csfloat', priceVnd, paintSeed: ref?.paintSeed };
    });
    const pricing = casePricing(item);
    expect(pricing.entries.map(({ weight, ...entry }) => entry)).toEqual(item.entries.map(({ weight, ...entry }) => entry));
    expect(pricing.entries.map(entry => entry.weight).sort((a, b) => a - b))
        .toEqual(item.entries.map(entry => entry.weight).sort((a, b) => a - b));
    expect(pricing.values).toEqual(values);
    expect(lookup).toHaveBeenCalledTimes(6);
    for (const entry of item.entries) {
        const key = keyOf(entry);
        const price = prices.get(key);
        prices.delete(key);
        expect(casePricing(item)).toBeNull();
        prices.set(key, price);
    }
    expect(network).not.toHaveBeenCalled();
});

test('keeps different seed quote caches separate and forwards the full quote reference', () => {
    const entry = item.entries[2];
    const other = { ...entry, ref: { ...entry.ref, paintSeed: 387 }, drop: { ...entry.drop, paintSeed: 387 } };
    const lookup = jest.spyOn(market, 'peekMarketQuote').mockImplementation((name, ref) => ({ priceVnd: ref.paintSeed }));
    const priceOf = cachedPrices();
    expect(priceOf(entry)).toBe(661);
    expect(priceOf(other)).toBe(387);
    expect(priceOf(entry)).toBe(661);
    expect(lookup.mock.calls).toEqual([[entry.ref.name, entry.ref], [other.ref.name, other.ref]]);
});

test('calculates the fee from the actual weighted per-seed prizes without averaging a selected prize', () => {
    const pricing = casePricing(item, fixedPrices);
    const weighted = values.reduce((sum, value, index) => sum + BigInt(value) * BigInt(pricing.entries[index].weight), 0n);
    const numerator = weighted * 100n * 100n;
    const denominator = BigInt(TICKETS) * 95n;
    expect(pricing.expected).toBe(weighted * 100n / BigInt(TICKETS));
    expect(pricing.fee * denominator).toBeGreaterThanOrEqual(numerator);
    expect((pricing.fee - 1n) * denominator).toBeLessThan(numerator);
    expect(pricing.maxValue).toBe(10_000_000_000n);
});

test('locks exact seeds, certification and values through JSON persistence and later quote changes', () => {
    const pricing = casePricing(item, fixedPrices);
    const saved = JSON.parse(JSON.stringify(lockCasePricing(pricing)));
    expect(saved.items.every(tuple => tuple.length === 6)).toBe(true);
    expect(saved.items.map(tuple => tuple[5])).toEqual([868, 868, 661, 150, 182, 955]);
    const restored = lockedCase(item, saved);
    expect(restored.entries).toEqual(pricing.entries);
    // New price-dependent ticket rows must travel in the snapshot; historical rowless
    // snapshots remain valid against their exact original catalogue revision.
    expect(lockedCase(item, { revision: pricing.revision, values: pricing.values })).toBeNull();
    expect(lockedCase(item, { revision: hash(item.entries), values: pricing.values }).entries).toEqual(item.entries);
    jest.spyOn(market, 'peekMarketQuote').mockReturnValue({ priceVnd: 1 });
    expect(casePricing(item).values).toEqual(Array(6).fill(1));
    const output = rollCustomCase(restored, saved.values, 'after-restart', 44,
        (min, max) => max === undefined ? TICKETS - 1 : max - 1);
    expect(output.drop).toMatchObject({ paintSeed: 955, priceVariant: 'blue-gem', float: restored.entries[5].max / 1_000_000 });
    expect(output.value).toBe(BigInt(values[5]) * 100n);
    const ordinary = casePricing({ ...customCases[0], candidates: [] }, () => 100);
    expect(lockCasePricing(ordinary).items.every(tuple => tuple.length === 5)).toBe(true);
});

test.each([-1, 1001, 1, null, '868', {}, undefined])('rejects an invalid or absent certified seed %p in locked items', seed => {
    const saved = JSON.parse(JSON.stringify(lockCasePricing(casePricing(item, fixedPrices))));
    saved.items[0][5] = seed;
    expect(lockedCase(item, saved)).toBeNull();
});

test('rejects changed seeds, malformed rows, extra marker fields and forged unseeded Blue Gem snapshots', () => {
    const pricing = casePricing(item, fixedPrices);
    const saved = lockCasePricing(pricing);
    const changed = JSON.parse(JSON.stringify(saved));
    changed.items[0][5] = 363;
    expect(lockedCase(item, changed)).toBeNull();
    for (const invalid of [null, {}, 'invalid', [...saved.items[0], 'blue-gem'], [...saved.items[0].slice(0, 4), 'true', 868]]) {
        const malformed = { ...saved, items: [invalid, ...saved.items.slice(1)] };
        expect(() => lockedCase(item, malformed)).not.toThrow();
        expect(lockedCase(item, malformed)).toBeNull();
    }
    const baseEntries = item.entries.map(entry => {
        const { paintSeed, priceVariant, ...drop } = entry.drop;
        const { paintSeed: refSeed, ...ref } = entry.ref;
        return { ...entry, drop, ref };
    });
    const forged = lockCasePricing({ entries: baseEntries, values, revision: hash(baseEntries) });
    expect(lockedCase(item, forged)).toBeNull();
    const invalidMarker = item.entries.map(entry => ({ ...entry, drop: { ...entry.drop, priceVariant: 'unknown' } }));
    expect(lockedCase(item, lockCasePricing({ entries: invalidMarker, values, revision: hash(invalidMarker) }))).toBeNull();
});

test('solo opening charges the certified case fee and stores the exact seed and pricing provenance', async () => {
    const battle = require('../utils/cs2Battles');
    const wallet = require('../commands/taixiu');
    const state = {};
    const quoted = new Map(item.entries.map((entry, index) => [keyOf(entry), values[index]]));
    jest.spyOn(market, 'peekMarketQuote').mockImplementation((name, ref) => ({
        priceVnd: quoted.get(market.marketQuoteKey(name, ref.phase, ref.paintSeed))
    }));
    const pricing = casePricing(item);
    const purchase = jest.spyOn(wallet, 'purchaseWithCoins').mockImplementation(async (_guild, _user, _fee, reward) => ({ reward: reward(state) }));
    jest.spyOn(crypto, 'randomInt').mockImplementation((min, max) => max === undefined ? TICKETS - 1 : min);
    const result = await battle.openSolo({ id: 'blue-solo-guild' }, '101', 'blue-solo-drop', item, lockCasePricing(pricing));
    expect(result).toMatchObject({ status: 'opened', fee: pricing.fee, value: BigInt(values[5]) * 100n,
        drop: { paintSeed: 955, priceVariant: 'blue-gem' } });
    expect(purchase.mock.calls[0][2]).toBe(pricing.fee);
    expect(state.skinCases['101'].drops).toEqual([result.drop]);
    expect(market.getDropMarketQuoteRef(result.drop).paintSeed).toBe(955);
});

test('battle settlement and reveal keep locked seed prizes and grant their provenance exactly once', async () => {
    const battle = require('../utils/cs2Battles');
    const store = require('../utils/managementStore');
    const wallet = require('../commands/taixiu');
    const pricing = casePricing(item, fixedPrices);
    const room = { id: 'blue-locked-room', hostId: '101', channelId: '20', caseIds: [item.id],
        format: '2', mode: 'regular', tieRule: 'split', status: 'waiting', fee: pricing.fee.toString(),
        createdAt: Date.now(), expiresAt: Date.now() + 60_000, players: [{ id: '101' }], seats: { 101: 1 },
        pricesByCase: { [item.id]: JSON.parse(JSON.stringify(lockCasePricing(pricing))) } };
    const state = { taixiu: { balances: { 101: 1_000_000_000, 102: 1_000_000_000 } },
        cs2Battles: { [room.id]: room } };
    const tickets = [0, TICKETS - 1];
    jest.spyOn(crypto, 'randomInt').mockImplementation((min, max) => max === undefined ? tickets.shift() : min);
    const lookup = jest.spyOn(market, 'peekMarketQuote').mockImplementation(() => { throw new Error('Settlement must use locked values'); });
    const legacyRoll = jest.fn(() => { throw new Error('Certified custom case must use its locked entries'); });
    jest.spyOn(store, 'read').mockResolvedValue(state);
    const save = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(store, 'transact').mockImplementation((_guildId, change) => change(state, save));
    jest.spyOn(wallet, 'refreshCoinLeaderboard').mockImplementation(() => {});
    const joined = await battle.actOnRoom({ id: '1' }, room.channelId, room.id, '102', 'join', legacyRoll, 'message-1');
    expect(joined.started).toBe(true);
    expect(room).toMatchObject({ status: 'revealing', winners: ['102'], payoutType: 'skins',
        totals: { 101: String(values[0] * 100), 102: String(values[5] * 100) } });
    expect(room.rounds[0].entries.map(entry => [entry.drop.paintSeed, entry.drop.priceVariant, entry.value])).toEqual([
        [868, 'blue-gem', String(values[0] * 100)], [955, 'blue-gem', String(values[5] * 100)]
    ]);
    expect(lookup).not.toHaveBeenCalled();
    expect(legacyRoll).not.toHaveBeenCalled();
    const completed = await battle.completeReveal({ id: '1' }, room.id);
    expect(completed.completed).toBe(true);
    expect(state.skinCases['102'].drops).toEqual(room.rounds[0].entries.map(entry => entry.drop));
    expect(state.skinCases['102'].drops.map(drop => market.getDropMarketQuoteRef(drop).paintSeed)).toEqual([868, 955]);
    await battle.completeReveal({ id: '1' }, room.id);
    expect(state.skinCases['102'].drops).toHaveLength(2);
    expect(save).toHaveBeenCalledTimes(2);
});
