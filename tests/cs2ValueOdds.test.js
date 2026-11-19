const crypto = require('node:crypto');
const market = require('../utils/cs2Market');
const { COIN_SCALE } = require('../utils/coins');
const { MAX_PAINT_SEED } = require('../utils/cs2Patterns');
const { TICKETS, customCases, customCasesById, casePricing, riskMetrics,
    lockCasePricing, lockedCase, rollCustomCase } = require('../utils/cs2BattleCases');

const keyOf = entry => market.marketQuoteKey(entry.ref.name, entry.ref.phase, entry.ref.paintSeed);
const hash = entries => crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex');
const weightsOf = entries => entries.map(entry => entry.weight).sort((left, right) => left - right);
const supportOf = entries => entries.map(({ weight, ...entry }) => entry);

function fixture() {
    const original = customCasesById.get('battle-blue-gem');
    const weights = [400, 3000, 700, 1800, 100, 4000];
    const entries = original.entries.map((entry, index) => Object.freeze({ ...entry, weight: weights[index] }));
    const item = { ...original, entries: Object.freeze(entries), candidates: [] };
    const values = [500, 100, 900, 500, 300, 100];
    const lookup = new Map(entries.map((entry, index) => [keyOf(entry), values[index]]));
    return { item, values, priceOf: entry => lookup.get(keyOf(entry)) ?? null };
}

function expectMonotone(pricing) {
    for (const [index, value] of pricing.values.entries()) {
        for (const [other, otherValue] of pricing.values.entries()) {
            if (value < otherValue) expect(pricing.entries[index].weight).toBeGreaterThanOrEqual(pricing.entries[other].weight);
        }
    }
}

beforeEach(() => jest.spyOn(market, 'peekMarketQuote').mockReturnValue(null));
afterEach(() => jest.restoreAllMocks());

test('moves the exact ticket multiset to ascending prices, including equal-price group boundaries, without changing support or order', () => {
    const { item, values, priceOf } = fixture();
    const original = JSON.stringify(item.entries);
    const pricing = casePricing(item, priceOf);
    expect(pricing.values).toEqual(values);
    expect(supportOf(pricing.entries)).toEqual(supportOf(item.entries));
    expect(weightsOf(pricing.entries)).toEqual(weightsOf(item.entries));
    expect(pricing.entries.map(entry => entry.weight)).toEqual([700, 4000, 100, 400, 1800, 3000]);
    expect(pricing.entries.reduce((sum, entry) => sum + entry.weight, 0)).toBe(TICKETS);
    expect(pricing.entries.every(entry => entry.weight > 0)).toBe(true);
    expectMonotone(pricing);
    expect(JSON.stringify(item.entries)).toBe(original);
    expect(pricing.revision).toBe(hash(pricing.entries));
    expect(pricing.revision).not.toBe(hash(item.entries));
    expect(casePricing(item, priceOf)).toEqual(pricing);

    const oldValue = item.entries.reduce((sum, entry, index) => sum + BigInt(entry.weight) * BigInt(values[index]), 0n);
    const finalValue = pricing.entries.reduce((sum, entry, index) => sum + BigInt(entry.weight) * BigInt(values[index]), 0n);
    expect(finalValue).toBeLessThan(oldValue);
    expect(pricing).toMatchObject({ goldTickets: 5200, jackpotTickets: 3000,
        bandTickets: { common: 4700, regular: 100, premium: 2200, jackpot: 3000 },
        ticketProfile: [4700, 100, 2200, 3000] });
});

test('orders all catalogue cases exactly at the largest safe prices and keeps unchanged entry references', () => {
    for (const original of customCases) {
        const item = { ...original, candidates: [], commonPriceCap: null };
        const quotes = new Map(item.entries.map((entry, index) => [keyOf(entry), Number.MAX_SAFE_INTEGER - index]));
        const pricing = casePricing(item, entry => quotes.get(keyOf(entry)));
        expect(pricing).not.toBeNull();
        expectMonotone(pricing);
        expect(supportOf(pricing.entries)).toEqual(supportOf(item.entries));
        expect(weightsOf(pricing.entries)).toEqual(weightsOf(item.entries));
        expect(pricing.values).toEqual(item.entries.map(entry => quotes.get(keyOf(entry))));
        expect(pricing.ticketProfile.reduce((sum, weight) => sum + weight, 0)).toBe(TICKETS);
        for (const [index, entry] of pricing.entries.entries()) {
            if (entry.weight === item.entries[index].weight) expect(entry).toBe(item.entries[index]);
            else expect(entry).not.toBe(item.entries[index]);
        }
    }
});

test('inherits expansion band identities and publishes the final actual group and gold totals', () => {
    const item = customCasesById.get('battle-farm-knife');
    const anchors = new Map(item.entries.map(entry => [keyOf(entry), entry.drop.tier === 4 ? 1_000_000 : 100]));
    const pricing = casePricing(item, entry => anchors.get(keyOf(entry)) ?? (entry.drop.tier === 4 ? null : 80));
    expect(pricing.entries.length).toBeGreaterThan(item.entries.length);
    expectMonotone(pricing);
    const gold = pricing.entries.reduce((sum, entry) => sum + (entry.drop.tier === 4 ? entry.weight : 0), 0);
    expect(pricing.goldTickets).toBe(gold);
    expect(pricing.jackpotTickets).toBe(gold);
    expect(pricing.bandTickets).toEqual({ common: TICKETS - gold, regular: 0, premium: 0, jackpot: gold });
    expect(pricing.entries.every(entry => !Object.hasOwn(entry, 'band'))).toBe(true);
    expect(lockedCase(item, lockCasePricing(pricing)).entries).toEqual(pricing.entries);
});

test('recomputes exact seed-aware EV, fee and risk from reassigned tickets', () => {
    const base = customCasesById.get('battle-case-hardened');
    const blue = base.entries.find(entry => entry.ref.name === 'Five-SeveN | Case Hardened (Battle-Scarred)');
    const other = customCasesById.get('battle-balance').entries[0];
    const entries = [{ ...blue, weight: 1000 }, { ...other, weight: 9000 }];
    const item = { ...base, entries, candidates: [], commonPriceCap: null };
    market.peekMarketQuote.mockImplementation((name, ref) => name === blue.ref.name && ref?.paintSeed === 363
        ? { source: 'csfloat', paintSeed: 363, priceVnd: 1_000_000 } : null);
    const pricing = casePricing(item, entry => keyOf(entry) === keyOf(blue) ? 100 : 200);
    expect(pricing.entries.map(entry => entry.weight)).toEqual([9000, 1000]);
    expect(pricing.entries[0].seedPrices).toEqual([[363, 1_000_000]]);
    const seeds = BigInt(MAX_PAINT_SEED + 1);
    const weighted = (100n * (seeds - 1n) + 1_000_000n) * 9000n + 200n * seeds * 1000n;
    const jointTickets = BigInt(TICKETS) * seeds;
    const numerator = weighted * COIN_SCALE * 100n;
    const denominator = jointTickets * 95n;
    expect(pricing.expected).toBe(weighted * COIN_SCALE / jointTickets);
    expect(pricing.fee * denominator).toBeGreaterThanOrEqual(numerator);
    expect((pricing.fee - 1n) * denominator).toBeLessThan(numerator);
    expect(pricing).toMatchObject(riskMetrics({ entries: pricing.entries, values: pricing.values }));
    expect(pricing.profitTickets).toBe(9000 / Number(seeds));
    expect(lockedCase(item, lockCasePricing(pricing)).entries).toEqual(pricing.entries);
});

test('every actual crypto ticket selects exactly its new advertised range and keeps fixed seed outcomes', () => {
    const { item, priceOf } = fixture();
    const pricing = casePricing(item, priceOf);
    jest.spyOn(crypto, 'randomBytes').mockReturnValue(Buffer.alloc(4));
    let ticket = 0;
    const random = jest.spyOn(crypto, 'randomInt').mockImplementation((min, max) => max === undefined ? ticket : min);
    const counts = pricing.entries.map(() => 0);
    let expected = 0;
    let boundary = pricing.entries[0].weight;
    for (ticket = 0; ticket < TICKETS; ticket++) {
        while (ticket >= boundary) boundary += pricing.entries[++expected].weight;
        const outcome = rollCustomCase({ ...item, entries: pricing.entries }, pricing.values, 'test', 1);
        const ref = market.getDropMarketQuoteRef(outcome.drop);
        const index = pricing.entries.findIndex(entry => keyOf(entry) === market.marketQuoteKey(ref.name, ref.phase, ref.paintSeed));
        expect(index).toBe(expected);
        expect(outcome.value).toBe(BigInt(pricing.values[index]) * COIN_SCALE);
        counts[index]++;
    }
    expect(counts).toEqual(pricing.entries.map(entry => entry.weight));
    expect(random.mock.calls.filter(args => args.length === 1 && args[0] === TICKETS)).toHaveLength(TICKETS);
});

test('restores old unsorted snapshots unchanged while locking the newly ordered distribution separately', () => {
    const { item, values, priceOf } = fixture();
    const old = { entries: item.entries, values, revision: hash(item.entries) };
    const saved = lockCasePricing(old);
    expect(lockedCase(item, saved).entries).toEqual(item.entries);
    expect(lockedCase(item, { revision: old.revision, values }).entries).toEqual(item.entries);
    const fresh = casePricing(item, priceOf);
    expect(lockedCase(item, lockCasePricing(fresh)).entries).toEqual(fresh.entries);
    expect(fresh.entries).not.toEqual(item.entries);
    expect(lockedCase(item, saved).entries).toEqual(item.entries);
});
