const crypto = require('node:crypto');
const market = require('../utils/cs2Market');
const { skins, containersById } = require('../utils/cs2Catalogue');
const {
    TICKETS, customCases, customCasesById, casePricing, cachedPrices, riskMetrics,
    lockCasePricing, lockedCase, rollCustomCase
} = require('../utils/cs2BattleCases');

const keyOf = entry => market.marketQuoteKey(entry.ref.name, entry.ref.phase);
const fixedPrices = item => {
    const prices = new Map(item.entries.map(entry => [keyOf(entry), {
        common: 100, regular: 1000, premium: 10_000, jackpot: 1_000_000
    }[item.bandByKey.get(keyOf(entry))]]));
    return entry => prices.get(keyOf(entry)) ?? null;
};

afterEach(() => jest.restoreAllMocks());

test('retains the 31 established case IDs and adds explicit 1%, 5% and 10% jackpot groups', () => {
    const established = ['balance', 'rifles', 'farm', 'starter', 'quick-hit', 'mil-spec', 'restricted', 'classified',
        'covert', 'zeus', 'glock', 'usp', 'deagle', 'smg', 'scout', 'ak', 'm4a4', 'm4a1', 'awp', 'printstream',
        'neon', 'crimson', 'vintage', 'farm-knife', 'farm-glove', 'knife', 'glove', 'fade', 'doppler', 'gamma', 'elite'];
    expect(customCases).toHaveLength(169);
    for (const id of established) expect(customCasesById.has(`battle-${id}`)).toBe(true);
    for (const id of ['dragon', 'frost', 'cosmos', 'sakura', 'spectrum', 'cyber', 'desert', 'abyss',
        'venom', 'royal', 'pistol-lottery', 'duel-storm', 'treasure', 'glove-vault']) {
        expect(customCasesById.has(`battle-${id}`)).toBe(true);
    }
    for (const percent of [1, 5, 10]) {
        const item = customCasesById.get(`battle-jackpot-${percent}`);
        const common = item.entries.filter(entry => item.bandByKey.get(keyOf(entry)) === 'common');
        expect(item.jackpotTickets).toBe(percent * 100);
        expect(common.reduce((sum, entry) => sum + entry.weight, 0)).toBe(TICKETS - percent * 100);
        expect(new Set(common.map(entry => skins[entry.drop.skinId].name.split(' | ')[0])).size).toBeGreaterThanOrEqual(5);
    }
});

test('every integer ticket in every case reaches its published range exactly once', () => {
    jest.spyOn(crypto, 'randomBytes').mockReturnValue(Buffer.alloc(4));
    for (const item of customCases) {
        expect(item.entries.every(entry => Number.isSafeInteger(entry.weight) && entry.weight > 0)).toBe(true);
        expect(item.entries.reduce((sum, entry) => sum + entry.weight, 0)).toBe(TICKETS);
        const values = item.entries.map((_, index) => index + 1);
        const counts = item.entries.map(() => 0);
        let expectedIndex = 0;
        let boundary = item.entries[0].weight;
        let mismatches = 0;
        for (let ticket = 0; ticket < TICKETS; ticket++) {
            while (ticket >= boundary) boundary += item.entries[++expectedIndex].weight;
            const draw = (min, max) => max == null ? (min === TICKETS ? ticket : 0) : min;
            const outcome = rollCustomCase(item, values, 'drop', 123, draw);
            const index = Number(outcome.value / 100n) - 1;
            counts[index]++;
            if (index !== expectedIndex || outcome.drop.skinId !== item.entries[expectedIndex].drop.skinId) mismatches++;
        }
        expect({ id: item.id, mismatches, counts }).toEqual({ id: item.id, mismatches: 0, counts: item.entries.map(entry => entry.weight) });
    }
}, 30_000);

test.each(['farm', 'farm-knife', 'farm-glove'])('%s has 99% diversified cheap guns and 1% gold without adapting to the player', id => {
    const item = customCasesById.get(`battle-${id}`);
    const pricing = casePricing(item, fixedPrices(item));
    const common = item.entries.filter(entry => entry.drop.tier < 4);
    expect(item.goldTickets).toBe(100);
    expect(common.reduce((sum, entry) => sum + entry.weight, 0)).toBe(9900);
    expect(new Set(common.map(entry => entry.drop.skinId)).size).toBeGreaterThanOrEqual(8);
    expect(pricing).toMatchObject({ lossTickets: 9900, profitTickets: 100, breakEvenTickets: 0,
        maxValue: 100_000_000n, riskLevel: 'extreme' });
    expect(pricing.maxValue / pricing.fee).toBeGreaterThan(50n);
});

test('weapon and rarity cases retain their themes while adding common finishes', () => {
    const weaponCases = { ak: 'AK-47', awp: 'AWP', m4a4: 'M4A4', m4a1: 'M4A1-S', scout: 'SSG 08', usp: 'USP-S' };
    for (const [id, weapon] of Object.entries(weaponCases)) {
        const item = customCasesById.get(`battle-${id}`);
        expect(item.entries.length).toBeGreaterThan(item.legacyEntries.length);
        expect(item.entries.every(entry => skins[entry.drop.skinId].name.startsWith(`${weapon} | `))).toBe(true);
        expect(item.entries.filter(entry => entry.drop.tier <= 1).reduce((sum, entry) => sum + entry.weight, 0)).toBeGreaterThanOrEqual(8500);
    }
    for (const [tier, id] of ['mil-spec', 'restricted', 'classified', 'covert'].entries()) {
        expect(customCasesById.get(`battle-${id}`).entries.every(entry => entry.drop.tier === tier)).toBe(true);
    }
    for (const id of ['knife', 'glove', 'fade', 'doppler', 'gamma']) {
        expect(customCasesById.get(`battle-${id}`).goldTickets).toBe(TICKETS);
    }
});

test('fees are EV / 95% rounded up once to exact cents, with explicit loss, break-even and profit tickets', () => {
    const base = customCases[0];
    const entries = [
        { ...base.entries[0], weight: 5500 },
        { ...base.entries[1], weight: 4500 }
    ];
    const item = { ...base, entries, candidates: [] };
    const pricing = casePricing(item, entry => entry === entries[0] ? 100 : 110);
    expect(pricing).toMatchObject({ fee: 11000n, expected: 10450n, lossTickets: 5500, breakEvenTickets: 4500,
        profitTickets: 0, maxValue: 11000n, riskLevel: 'low' });
    expect(riskMetrics({ entries, values: [100, 200] }, 15000n)).toMatchObject({ lossTickets: 5500, profitTickets: 4500, breakEvenTickets: 0 });
    const awkward = casePricing(item, entry => entry === entries[0] ? 101 : 997);
    const numerator = (101n * 5500n + 997n * 4500n) * 100n * 100n;
    const denominator = BigInt(TICKETS) * 95n;
    expect(awkward.fee * denominator >= numerator).toBe(true);
    expect((awkward.fee - 1n) * denominator < numerator).toBe(true);
    expect(awkward.lossTickets + awkward.profitTickets + awkward.breakEvenTickets).toBe(TICKETS);
});

test('expansion uses only quoted variants in the same value bands and preserves farm loss and gold tickets', () => {
    const item = customCasesById.get('battle-farm-knife');
    const anchors = fixedPrices(item);
    const priceOf = entry => anchors(entry) ?? (entry.drop.tier === 4 ? 800_000 : 60);
    const pricing = casePricing(item, priceOf);
    expect(pricing.entries.length).toBeGreaterThan(item.entries.length);
    expect(new Set(pricing.entries.map(entry => entry.drop.skinId)).size).toBeGreaterThan(item.entries.length);
    expect(pricing.entries.reduce((sum, entry) => sum + entry.weight, 0)).toBe(TICKETS);
    expect(pricing.entries.reduce((sum, entry) => sum + (entry.drop.tier === 4 ? entry.weight : 0), 0)).toBe(100);
    expect(pricing).toMatchObject({ lossTickets: 9900, profitTickets: 100 });
    for (const [index, entry] of pricing.entries.entries()) {
        expect(pricing.values[index]).toBe(priceOf(entry));
        expect(containersById.get(entry.drop.caseId).pools[entry.drop.tier]).toContain(entry.drop.skinId);
    }
});

test('expansion falls back to the published anchors if changed EV would cross a loss or break-even boundary', () => {
    const base = customCasesById.get('battle-balance');
    const entries = [{ ...base.entries[0], weight: 5500 }, { ...base.entries[1], weight: 4500 }];
    const anchorKeys = new Map([[keyOf(entries[0]), 100], [keyOf(entries[1]), 110]]);
    const item = { ...base, entries };
    const pricing = casePricing(item, entry => anchorKeys.get(keyOf(entry)) ?? 90);
    expect(pricing.entries).toEqual(entries);
    expect(pricing).toMatchObject({ fee: 11000n, lossTickets: 5500, breakEvenTickets: 4500 });
});

test('missing or invalid cache prices block pricing, and missing expansion quotes never invent values', () => {
    const item = customCasesById.get('battle-jackpot-1');
    const request = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Unexpected network request'));
    const anchors = fixedPrices(item);
    const lookup = jest.spyOn(market, 'peekMarketQuote').mockImplementation((name, ref) => {
        const entry = item.entries.find(entry => entry.ref.name === name && entry.ref.phase === ref?.phase);
        return entry ? { source: 'buff', priceVnd: anchors(entry) } : null;
    });
    const pricing = casePricing(item);
    expect(pricing.entries).toEqual(item.entries);
    expect(pricing.values).toEqual(item.entries.map(anchors));
    expect(request).not.toHaveBeenCalled();
    const readPrice = cachedPrices();
    lookup.mockClear();
    readPrice(item.entries[0]);
    readPrice(item.entries[0]);
    expect(lookup).toHaveBeenCalledTimes(1);
    for (const invalid of [null, undefined, 0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        expect(casePricing(item, () => invalid)).toBeNull();
    }
    lookup.mockReturnValue(null);
    expect(casePricing(item)).toBeNull();
});

test('farm common drops replace unavailable or overpriced seeds with other quoted cheap guns', () => {
    const item = customCasesById.get('battle-farm');
    const quotes = new Map(item.entries.map(entry => [keyOf(entry), fixedPrices(item)(entry)]));
    quotes.delete(keyOf(item.entries[0]));
    quotes.set(keyOf(item.entries[1]), item.commonPriceCap + 1);
    const anchorKeys = new Set(item.entries.map(keyOf));
    const replacements = item.candidates.filter(entry => !anchorKeys.has(keyOf(entry)) && entry.drop.tier === 0 &&
        !entry.drop.statTrak && entry.exterior === 2).filter((entry, index, pool) =>
        pool.findIndex(other => other.drop.skinId === entry.drop.skinId) === index).slice(0, 2);
    expect(replacements).toHaveLength(2);
    replacements.forEach((entry, index) => quotes.set(keyOf(entry), 50 + index));
    const pricing = casePricing(item, entry => quotes.get(keyOf(entry)) ?? null);
    expect(pricing).toMatchObject({ lossTickets: 9900, profitTickets: 100 });
    expect(pricing.entries[0].drop.skinId).toBe(replacements[0].drop.skinId);
    expect(pricing.entries[1].drop.skinId).toBe(replacements[1].drop.skinId);
    expect(pricing.entries.slice(0, 8).every((entry, index) => pricing.values[index] <= item.commonPriceCap && entry.drop.tier === 0)).toBe(true);
    expect(pricing.values).toEqual(pricing.entries.map(entry => quotes.get(keyOf(entry))));
    quotes.delete(keyOf(replacements[1]));
    expect(casePricing(item, entry => quotes.get(keyOf(entry)) ?? null)).toBeNull();
});

test('farm expansion respects the cheap-price cap and cannot substitute for a missing jackpot quote', () => {
    const item = customCasesById.get('battle-farm');
    const anchorKeys = new Map(item.entries.map(entry => [keyOf(entry), entry.drop.tier === 4 ? 1_000_000 : item.commonPriceCap]));
    const pricing = casePricing(item, entry => anchorKeys.get(keyOf(entry)) ?? (entry.drop.tier === 4 ? 1_000_000 : item.commonPriceCap + 1));
    expect(pricing.entries.filter(entry => entry.drop.tier !== 4).every(entry => anchorKeys.has(keyOf(entry)))).toBe(true);
    expect(pricing.values.filter((_, index) => pricing.entries[index].drop.tier !== 4).every(value => value <= item.commonPriceCap)).toBe(true);
    const jackpot = item.entries.find(entry => entry.drop.tier === 4);
    anchorKeys.delete(keyOf(jackpot));
    expect(casePricing(item, entry => anchorKeys.get(keyOf(entry)) ?? null)).toBeNull();
});

test('integer candidate price bounds stay exact even at the largest supported quote', () => {
    const base = customCases[0];
    const entries = [{ ...base.entries[0], weight: 7000 }, { ...base.entries[1], weight: 3000 }];
    const anchors = new Set(entries.map(keyOf));
    const item = { ...base, entries, commonPriceCap: null };
    const pricing = casePricing(item, entry => anchors.has(keyOf(entry)) ? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER - 1);
    expect(pricing).not.toBeNull();
    expect(pricing.entries.reduce((sum, entry) => sum + entry.weight, 0)).toBe(TICKETS);
    expect(pricing.values.every(Number.isSafeInteger)).toBe(true);
    expect(pricing.lossTickets + pricing.profitTickets + pricing.breakEvenTickets).toBe(TICKETS);
});

test('a named jackpot group describes its fixed tickets, while profitability follows actual prices', () => {
    for (const chance of [1, 5, 10]) {
        const item = customCasesById.get(`battle-jackpot-${chance}`);
        const realistic = casePricing(item, fixedPrices(item));
        expect(realistic.profitTickets).toBe(chance * 100);
        const equal = casePricing({ ...item, candidates: [] }, () => 100);
        expect(item.jackpotTickets).toBe(chance * 100);
        expect(equal).toMatchObject({ profitTickets: 0, lossTickets: TICKETS });
    }
});

test('every opening asks crypto for a new full ticket draw, independent of previous drops and identities', () => {
    const item = customCasesById.get('battle-jackpot-1');
    const tickets = [0, TICKETS - 1];
    const draw = jest.spyOn(crypto, 'randomInt').mockImplementation((min, max) =>
        max == null ? (min === TICKETS ? tickets.shift() : 0) : min);
    const pricing = casePricing(item, fixedPrices(item));
    const first = rollCustomCase(item, pricing.values, 'same-id', 1);
    const second = rollCustomCase(item, pricing.values, 'same-id', 1);
    expect(item.bandByKey.get(keyOf(item.entries[0]))).toBe('common');
    expect(first.value).toBe(10_000n);
    expect(second.value).toBe(100_000_000n);
    expect(draw.mock.calls.filter(args => args.length === 1 && args[0] === TICKETS)).toHaveLength(2);
    expect(tickets).toHaveLength(0);
});

test('old snapshots restore the exact pre-update case entries with and without serialized items', () => {
    for (const previous of customCases.filter(item => !item.id.startsWith('battle-jackpot-'))) {
        const values = previous.legacyEntries.map((_, index) => 100 + index);
        const revision = crypto.createHash('sha256').update(JSON.stringify(previous.legacyEntries)).digest('hex');
        expect(lockedCase(previous, { values, revision }).entries).toEqual(previous.legacyEntries);
        const serialized = lockCasePricing({ entries: previous.legacyEntries, values, revision });
        expect(lockedCase(previous, serialized).entries).toEqual(previous.legacyEntries);
    }
    const item = customCasesById.get('battle-balance');
    const old = {
        entries: item.legacyEntries,
        values: item.legacyEntries.map((_, index) => 100 + index),
        revision: crypto.createHash('sha256').update(JSON.stringify(item.legacyEntries)).digest('hex')
    };
    const saved = lockCasePricing(old);
    expect(lockedCase(item, saved).entries).toEqual(item.legacyEntries);
    expect(lockedCase(item, { revision: old.revision, values: old.values }).entries).toEqual(item.legacyEntries);
    const current = casePricing(item, fixedPrices(item));
    const snapshot = lockCasePricing(current);
    const restored = lockedCase(item, snapshot);
    expect(restored.entries).toEqual(current.entries);
    expect(restored.entries.map(({ weight, ...entry }) => entry)).toEqual(item.entries.map(({ weight, ...entry }) => entry));
    expect(riskMetrics({ entries: restored.entries, values: snapshot.values })).toMatchObject({ lossTickets: expect.any(Number), maxValue: expect.any(BigInt) });
    expect(lockedCase(item, { ...saved, revision: 'changed' })).toBeNull();
    expect(lockedCase(item, { ...saved, values: [-1] })).toBeNull();
    expect(lockedCase(item, { ...saved, items: {} })).toBeNull();
    const invalidItems = saved.items.map(row => [...row]);
    invalidItems[0][3] = 0;
    expect(lockedCase(item, { ...saved, items: invalidItems })).toBeNull();
});
