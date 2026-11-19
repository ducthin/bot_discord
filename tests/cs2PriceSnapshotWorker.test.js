const { collectMarketPrices, HOUR_MS } = require('../utils/cs2PriceSnapshotWorker');

const NOW = Date.parse('2026-11-14T10:00:00Z');
const CASE = 'Kilowatt Case';
const KNIFE = '★ Karambit | Doppler (Factory New)';
const date = time => new Date(time).toISOString();
const market = (ask, ageHours = 1, fields = {}) => ({
    ask, currency: 'USD', updated_at: date(NOW - ageHours * HOUR_MS), ...fields
});

function collect(data, phasesByName) {
    const fetcher = jest.fn(async url => url.includes('frankfurter')
        ? Response.json({ date: '2026-11-14', base: 'USD', quote: 'VND', rate: 25_000 })
        : Response.json({ data, count: Object.keys(data).length, updated_at: date(NOW) }));
    return collectMarketPrices(Object.keys(data), { fetcher, now: () => NOW, phasesByName });
}

test('only BUFF is read and the normalized USD quote is converted to xu', async () => {
    const buffUrl = 'https://buff.163.com/goods/980585';
    const { prices } = await collect({
        [CASE]: {
            buff: market(0.08, 1, { native_currency: { code: 'CNY', ask: 0.52 } }),
            csfloat: market(0.07, 0.1),
            skinport: market(0.15, 0.05),
            steam: market(0.13, 0.01),
            links: { buff: buffUrl }
        }
    });
    expect(prices).toEqual([[CASE, 2000, NOW - HOUR_MS, null, buffUrl]]);
});

test('invalid and expired BUFF asks are omitted and valid saved quotes remain available for display', async () => {
    const { prices } = await collect({
        [CASE]: {
            buff: market(0.08, 25),
            csfloat: market(0.07, 2),
            steam: market(0.13, 0.01)
        },
        'Glove Case': {
            buff: market(10, 48),
            csfloat: market(11, 2, { currency: 'CNY' }),
            skinport: market(0, 1),
            steam: market(13, 1)
        },
        'Prisma Case': { buff: market(1, 30), steam: market(2, 26) },
        'Prisma 2 Case': { buff: market(1, -1), skinport: market(2, 1) },
        'Gamma Case': { csfloat: market(1, 1), steam: market(2, 1) }
    });
    expect(prices).toEqual([
        [CASE, 2000, NOW - 25 * HOUR_MS, null, null],
        ['Prisma Case', 25_000, NOW - 30 * HOUR_MS, null, null]
    ]);
});

test('Doppler valuation requires an exact BUFF phase and uses its own timestamp', async () => {
    const phases = new Map([[KNIFE, new Set(['Ruby', 'Phase 1', 'Phase 2', 'Sapphire'])]]);
    const phase = (pattern, ask, ageHours, fields = {}) => ({ pattern, ask, updated_at: date(NOW - ageHours * HOUR_MS), ...fields });
    const buffUrl = 'https://buff.163.com/goods/42998';
    const { prices } = await collect({
        [KNIFE]: {
            buff: market(900, 0.5, { patterns: [
                phase('Ruby', 5000, 2), phase('Phase 1', 910, 30), phase('Phase 2', 1200, 1, { currency: 'CNY' })
            ] }),
            csfloat: market(5200, 0.2, { base_price: 1000, patterns: [phase('Ruby', 5200, 0.2), phase('Phase 1', 920, 1)] }),
            skinport: market(990, 0.5, { patterns: [phase('Phase 2', 1300, 1)] }),
            steam: market(960, 2, { patterns: [phase('Sapphire', 3200, 1)] }),
            links: { buff: buffUrl, csfloat: 'https://csfloat.com/search?paint_index=416' }
        }
    }, phases);
    expect(prices).toEqual([
        [KNIFE, 125_000_000, NOW - 2 * HOUR_MS, 'Ruby', buffUrl],
        [KNIFE, 22_750_000, NOW - 30 * HOUR_MS, 'Phase 1', buffUrl]
    ]);
});

test('an all-market snapshot without a valid BUFF quote fails without importing another price', async () => {
    await expect(collect({ [CASE]: { csfloat: market(1), steam: market(2) } }))
        .rejects.toThrow('No valid BUFF prices for the bot catalogue');
});
