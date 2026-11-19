const { checkPricing, priceOddsInversions } = require('../scripts/audit-cs2-case-odds');
const { customCasesById, casePricing, riskMetrics } = require('../utils/cs2BattleCases');
const { blueGemSeeds } = require('../utils/cs2Patterns');
const market = require('../utils/cs2Market');

afterEach(() => jest.restoreAllMocks());

test('offline audit detects undercharging and overcharging by one hundredth of a coin', () => {
    jest.spyOn(market, 'peekMarketQuote').mockReturnValue(null);
    const original = customCasesById.get('battle-balance');
    const item = { ...original, candidates: [] };
    const pricing = casePricing(item, entry => entry.drop.tier === 4 ? 100_000 : 100);
    expect(checkPricing(pricing)).toEqual([]);
    expect(checkPricing({ ...pricing, fee: pricing.fee - 1n })).toContain('Expected return exceeds 95%');
    expect(checkPricing({ ...pricing, fee: pricing.fee + 1n })).toContain('Fee exceeds the exact EV / 95% ceiling');
});

test('offline audit preserves fractional risk tickets from seed-specific quotes', () => {
    jest.spyOn(market, 'peekMarketQuote').mockReturnValue(null);
    const original = customCasesById.get('battle-case-hardened');
    const anchor = original.entries.find(entry => blueGemSeeds(entry.drop.skinId).length);
    const seed = blueGemSeeds(anchor.drop.skinId)[0];
    const entries = [{ ...anchor, weight: 3333, seedPrices: [[seed, 10_000_000]] }, { ...anchor, weight: 6667 }];
    const metrics = riskMetrics({ entries, values: [100, 100] });
    const pricing = { entries, values: [100, 100], ...metrics };
    expect(Number.isInteger(pricing.profitTickets)).toBe(false);
    expect(checkPricing(pricing)).toEqual([]);
    expect(checkPricing({ ...pricing, profitTickets: Math.round(pricing.profitTickets) }))
        .toContain('Published profitTickets differs from prices');
    expect(checkPricing({ ...pricing, expected: pricing.expected + 1n }))
        .toContain('Expected value differs from joint seed distribution');
});

test('price audit compares complete equal-value buckets and every cheaper allocation', () => {
    const pricing = { values: [100, 100, 200, 200, 300],
        entries: [1000, 4000, 1000, 3000, 1000].map(weight => ({ weight })) };
    expect(priceOddsInversions(pricing)).toEqual([{ cheaperIndex: 0, cheaperValue: '100', cheaperTickets: 1000,
        expensiveIndex: 3, expensiveValue: '200', expensiveTickets: 3000 }]);
    const allEqual = { values: [100, 100, 100, 100, 100], entries: pricing.entries };
    expect(priceOddsInversions(allEqual)).toEqual([]);
    const valid = { values: [100, 100, 200, 200], entries: [3000, 4000, 1000, 2000].map(weight => ({ weight })) };
    expect(priceOddsInversions(valid)).toEqual([]);
    expect(priceOddsInversions({ values: ['9007199254740993000', '9007199254740993001'],
        entries: [{ weight: 1 }, { weight: 2 }] })).toHaveLength(1);
});

test('audit catches an inverted priced distribution even when fees and risk totals are correct', () => {
    const original = customCasesById.get('battle-balance');
    const entries = [{ ...original.entries[0], weight: 4000 }, { ...original.entries[1], weight: 6000 }];
    const values = [100, 200];
    const pricing = { entries, values, ...riskMetrics({ entries, values }) };
    expect(checkPricing(pricing)).toEqual(['More expensive reward has more tickets than a cheaper reward']);
});
