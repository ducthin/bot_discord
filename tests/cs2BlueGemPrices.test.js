const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { collectBlueGemPrices, createBlueGemPrices, PATTERNS_URL, supports } = require('../utils/cs2BlueGemPrices');
const market = require('../utils/cs2Market');
const blueGemPrices = require('../utils/cs2BlueGemPrices');
const snapshot = require('../utils/cs2PriceSnapshot');

const NOW = Date.UTC(2026, 10, 16, 12);
const HOUR = 3_600_000;
const NAME = 'AK-47 | Case Hardened (Field-Tested)';
const SEED = 661;
const FX = { base: 'USD', quote: 'VND', rate: 25_000, date: '2026-11-16' };
const response = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const row = overrides => ({ pattern: 'Tier 1 #661', paint_seed: SEED, ask: 60_000, sell_order_count: 1,
    updated_at: new Date(NOW - HOUR).toISOString(), ...overrides });
const fixture = (patterns, item = NAME) => jest.fn(async url => response(url === 'https://api.frankfurter.dev/v2/rate/USD/VND'
    ? FX : { item, patterns }));
const collect = fetcher => collectBlueGemPrices({ fetcher, now: () => NOW, names: new Map([[NAME, new Set([SEED])]]) });

afterEach(() => jest.restoreAllMocks());

test('uses the exact public CSFloat seed endpoint and its per-row time, with validated USD/VND conversion', async () => {
    const fetcher = fixture([row(), row({ pattern: 'Common', paint_seed: 1, ask: 100 })]);
    const result = await collect(fetcher);
    expect(result.rows).toEqual([{ name: NAME, paintSeed: SEED, priceVnd: 1_500_000_000,
        observedAt: NOW - HOUR, pattern: 'Tier 1 #661', count: 1 }]);
    const request = new URL(fetcher.mock.calls[1][0]);
    expect(`${request.origin}${request.pathname}`).toBe(PATTERNS_URL);
    expect(request.searchParams.get('item')).toBe(NAME);
    expect(fetcher.mock.calls[1][1]).toMatchObject({ redirect: 'error', headers: { accept: 'application/json' } });
    expect(fetcher.mock.calls[1][1].headers).not.toHaveProperty('Authorization');
});

test.each([
    { pattern: 'Common' }, { pattern: 'Tier 3-4' }, { pattern: 'Tier 1 #387' }, { paint_seed: 387 },
    { paint_seed: '661' }, { ask: 0 }, { ask: -1 }, { ask: '60000' }, { ask: null },
    { ask: 1e30 }, { sell_order_count: 0 }, { sell_order_count: null }, { sell_order_count: 1.2 },
    { updated_at: new Date(NOW - 49 * HOUR).toISOString() },
    { updated_at: new Date(NOW + 1).toISOString() }, { updated_at: 'invalid' }
])('rejects a grouped, mismatched, unavailable or incorrectly dated exact-seed row: %j', async overrides => {
    expect((await collect(fixture([row(overrides)]))).rows).toEqual([]);
});

test('never mixes wear, StatTrak, duplicate labels, or a generic lowest ask into the seed price', async () => {
    await expect(collect(fixture([row()], NAME.replace('Field-Tested', 'Factory New')))).rejects.toThrow('No valid');
    await expect(collect(fixture([row()], `StatTrak™ ${NAME}`))).rejects.toThrow('No valid');
    expect((await collect(fixture([row(), row()]))).rows).toEqual([]);
    const fetcher = jest.fn(async url => response(url.includes('frankfurter') ? FX : { item: NAME, lowest_ask: 177.51, patterns: [] }));
    expect((await collect(fetcher)).rows).toEqual([]);
    expect(supports(NAME, SEED)).toBe(true);
    expect(supports(NAME, 0)).toBe(false);
});

test('rejects an invalid exchange rate and bounds item JSON responses', async () => {
    await expect(collect(async () => response({ ...FX, rate: -1 }))).rejects.toThrow('Invalid USD/VND');
    const fetcher = async url => url.includes('frankfurter') ? response(FX)
        : new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': String(129 * 1024) } });
    await expect(collect(fetcher)).rejects.toThrow('No valid');
});

test('persists only validated exact quotes, expires transaction prices, keeps display estimates, and removes sold patterns', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-blue-gem-prices-'));
    const file = path.join(directory, 'prices.json');
    let time = NOW;
    let available = true;
    const fetcher = jest.fn(async url => {
        if (url.includes('frankfurter')) return response(FX);
        const name = new URL(url).searchParams.get('item');
        return response({ item: name, patterns: name === NAME && available ? [row()] : [] });
    });
    const prices = createBlueGemPrices({ file, fetcher, now: () => time });
    try {
        await expect(prices.refresh()).resolves.toMatchObject({ status: 'updated', count: 1 });
        expect(prices.peek(NAME, { paintSeed: SEED })).toMatchObject({ source: 'csfloat', paintSeed: SEED, priceVnd: 1_500_000_000 });
        expect(prices.peek(NAME, { paintSeed: 387 })).toBeNull();
        const disk = JSON.parse(await fs.readFile(file, 'utf8'));
        expect(disk.rows).toHaveLength(1);
        const restored = createBlueGemPrices({ file, fetcher, now: () => time });
        await restored.start();
        expect(restored.peek(NAME, { paintSeed: SEED })).toEqual(prices.peek(NAME, { paintSeed: SEED }));
        await restored.stop();
        time += 24 * HOUR;
        expect(prices.peek(NAME, { paintSeed: SEED })).toBeNull();
        expect(prices.peek(NAME, { paintSeed: SEED, allowStale: true })).not.toBeNull();
        available = false;
        await prices.refresh();
        expect(prices.peek(NAME, { paintSeed: SEED, allowStale: true })).toBeNull();
    } finally {
        await prices.stop();
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test('isolates stamped Blue Gems from ordinary BUFF buyback and refuses missing or wrong-seed premium quotes', () => {
    const drop = { skinId: 'skin-5fd3ee42a6c4', float: 0.2, statTrak: false, paintSeed: SEED };
    const base = market.getDropMarketQuoteRef(drop);
    const premium = market.getDropMarketQuoteRef({ ...drop, priceVariant: 'blue-gem' });
    expect(base).toEqual({ name: NAME, phase: null });
    expect(premium).toEqual({ name: NAME, phase: null, paintSeed: SEED });
    expect(market.getDropMarketQuoteRef({ ...drop, priceVariant: 'blue-gem', paintSeed: 0 })).toBeNull();
    expect(market.marketQuoteKey(base.name, base.phase)).not.toBe(market.marketQuoteKey(premium.name, premium.phase, premium.paintSeed));
    const baseQuote = { source: 'buff', phase: null, priceVnd: 100 };
    jest.spyOn(snapshot, 'peek').mockReturnValue(baseQuote);
    const lookup = jest.spyOn(blueGemPrices, 'peek').mockReturnValue(null);
    expect(market.peekMarketQuote(base.name, base)).toMatchObject(baseQuote);
    expect(market.peekMarketQuote(premium.name, premium)).toBeNull();
    lookup.mockReturnValue({ source: 'csfloat', phase: null, paintSeed: SEED, priceVnd: 1_500_000_000 });
    expect(market.peekMarketQuote(premium.name, premium)).toMatchObject({ source: 'csfloat', paintSeed: SEED });
    lookup.mockReturnValue({ source: 'csfloat', phase: null, paintSeed: 387, priceVnd: 1 });
    expect(market.peekMarketQuote(premium.name, premium)).toBeNull();
    expect(market.peekMarketQuote(NAME, { paintSeed: 0 })).toBeNull();
});

test('builds an exact Blue Gem reference for a naturally rolled #363 with its wear and StatTrak status', () => {
    const drop = { skinId: 'skin-133e4c36778f', float: 0.988009, paintSeed: 363 };
    const name = 'Five-SeveN | Case Hardened (Battle-Scarred)';
    expect(market.getDropMarketQuoteRef(drop)).toEqual({ name, phase: null });
    expect(market.getBlueGemMarketQuoteRef(drop)).toEqual({ name, phase: null, paintSeed: 363 });
    expect(market.getBlueGemMarketQuoteRef({ ...drop, statTrak: true })).toEqual({
        name: `StatTrak™ ${name}`, phase: null, paintSeed: 363
    });
    expect(market.getBlueGemMarketQuoteRef({ ...drop, paintSeed: 0 })).toBeNull();
    expect(market.getBlueGemMarketQuoteRef({ ...drop, float: 1.01 })).toBeNull();
    expect(market.getBlueGemMarketQuoteRef({ ...drop, skinId: 'unknown' })).toBeNull();
});
