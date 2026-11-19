const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { skins } = require('./cs2Catalogue');
const { blue } = require('../assets/cs2-patterns.json');
const { getDropMarketHashName, marketQuoteKey, wearBounds } = require('./cs2MarketNames');
const { boundedJson, usdToXu, validExchangeRate, validTime, PRICE_TTL_MS, DISPLAY_TTL_MS } = require('./cs2PriceSnapshotWorker');

// OpenSkin's CSFloat pattern endpoint exposes individual named #seed listings.
// Generic lowest_ask and grouped tiers are deliberately not a seed quote.
const PATTERNS_URL = 'https://api-v2.openskin.dev/v1/prices/csfloat/patterns';
const FX_URL = 'https://api.frankfurter.dev/v2/rate/USD/VND';
const MARKET_URL = 'https://csfloat.com/search';
const REFRESH_MS = 30 * 60_000;
const CACHE_FILE = path.join(__dirname, '..', 'data', 'cs2-blue-gem-prices.json');
const CACHE_LIMIT = 512 * 1024;
const requests = new Map();

for (const [skinId, pattern] of Object.entries(blue)) {
    if (!pattern.gems?.length) continue;
    const skin = skins[skinId];
    for (let exterior = 0; exterior < 5; exterior++) {
        const float = Math.max(skin.min, wearBounds[exterior]);
        if (float > skin.max || float >= wearBounds[exterior + 1] && exterior < 4) continue;
        for (const statTrak of skin.stattrak ? [false, true] : [false]) {
            const name = getDropMarketHashName({ skinId, float, statTrak });
            if (name) requests.set(name, new Set(pattern.gems));
        }
    }
}

const supports = (name, paintSeed) => requests.get(name)?.has(paintSeed) === true;
const exactPattern = (pattern, seed) => typeof pattern === 'string' &&
    /^(?:Tier [1-4] )?#\d{1,4}$/.test(pattern) && Number(pattern.slice(pattern.lastIndexOf('#') + 1)) === seed;

function quoteFor(row) {
    return Object.freeze({ priceVnd: row.priceVnd, observedAt: row.observedAt,
        expiresAt: row.observedAt + PRICE_TTL_MS, source: 'csfloat', phase: null,
        paintSeed: row.paintSeed, pattern: row.pattern, url: MARKET_URL });
}

function validRow(row, time) {
    return row && supports(row.name, row.paintSeed) && exactPattern(row.pattern, row.paintSeed) &&
        Number.isSafeInteger(row.priceVnd) && row.priceVnd > 0 &&
        Number.isSafeInteger(row.count) && row.count > 0 && validTime(row.observedAt, time, DISPLAY_TTL_MS);
}

async function collectBlueGemPrices({ fetcher = fetch, now = Date.now, signal, names = requests } = {}) {
    const exchange = await boundedJson(fetcher, FX_URL, 4096, signal);
    const fx = { rate: exchange?.rate, observedAt: Date.parse(exchange?.date) };
    if (exchange?.base !== 'USD' || exchange.quote !== 'VND' || !validExchangeRate(fx, now())) throw new Error('Invalid USD/VND reference rate');
    const queue = [...names];
    const rows = [];
    const refreshedNames = [];
    let position = 0;
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
        while (position < queue.length) {
            const [name, seeds] = queue[position++];
            try {
                const url = new URL(PATTERNS_URL);
                url.searchParams.set('item', name);
                const document = await boundedJson(fetcher, url.href, 128 * 1024, signal);
                if (document?.item !== name || !Array.isArray(document.patterns) || document.patterns.length > 1001) continue;
                refreshedNames.push(name);
                for (const paintSeed of seeds) {
                    const matches = document.patterns.filter(row => row?.paint_seed === paintSeed && exactPattern(row.pattern, paintSeed));
                    if (matches.length !== 1) continue;
                    const source = matches[0];
                    const row = { name, paintSeed, priceVnd: usdToXu(source.ask, fx.rate),
                        observedAt: Date.parse(source.updated_at), pattern: source.pattern, count: source.sell_order_count };
                    if (validRow(row, now())) rows.push(row);
                }
            } catch (error) {
                if (signal?.aborted) throw error;
                // A failed item request retains only previously cached, still dated quotes.
            }
        }
    }));
    if (!refreshedNames.length) throw new Error('No valid CSFloat pattern responses');
    return { rows, refreshedNames };
}

function createBlueGemPrices({ file = CACHE_FILE, fetcher, now = Date.now } = {}) {
    let quotes = new Map();
    let checkedAt = null;
    let initialized;
    let running = false;
    let timer;
    let task;
    let controller;

    async function load() {
        try {
            if ((await fs.stat(file)).size > CACHE_LIMIT) throw new Error('Pattern snapshot is too large');
            const saved = JSON.parse(await fs.readFile(file, 'utf8'));
            if (saved.version !== 1 || saved.source !== 'csfloat' || !Array.isArray(saved.rows)) return;
            for (const row of saved.rows) if (validRow(row, now())) quotes.set(marketQuoteKey(row.name, null, row.paintSeed), { ...row, quote: quoteFor(row) });
            if (validTime(saved.checkedAt, now(), REFRESH_MS)) checkedAt = saved.checkedAt;
        } catch (error) {
            if (error.code !== 'ENOENT') console.warn('Không đọc được giá Blue Gem:', error.code ?? error.message);
        }
    }

    function peek(name, { paintSeed, allowStale = false } = {}) {
        if (!supports(name, paintSeed)) return null;
        const quote = quotes.get(marketQuoteKey(name, null, paintSeed))?.quote;
        return quote && validTime(quote.observedAt, now(), allowStale ? DISPLAY_TTL_MS : PRICE_TTL_MS) ? quote : null;
    }

    async function save() {
        const temporary = `${file}.${randomUUID()}.tmp`;
        try {
            await fs.mkdir(path.dirname(file), { recursive: true });
            const rows = [...quotes.values()].map(({ quote, ...row }) => row);
            await fs.writeFile(temporary, JSON.stringify({ version: 1, source: 'csfloat', checkedAt, rows }), { flag: 'wx', mode: 0o600 });
            await fs.rename(temporary, file);
        } finally { await fs.unlink(temporary).catch(() => {}); }
    }

    const status = result => ({ status: result, count: quotes.size, nextRefreshAt: nextRefreshAt() });
    const nextRefreshAt = () => (Math.floor(now() / REFRESH_MS) + 1) * REFRESH_MS;

    function refresh() {
        if (task) return task;
        initialized ??= load();
        controller = new AbortController();
        const active = controller;
        task = initialized.then(async () => {
            if (active.signal.aborted) return status('unavailable');
            const time = now();
            if (checkedAt != null && checkedAt >= time - time % REFRESH_MS) return status('cooldown');
            checkedAt = time;
            try {
                const result = await collectBlueGemPrices({ fetcher, now,
                    signal: AbortSignal.any([active.signal, AbortSignal.timeout(30_000)]) });
                active.signal.throwIfAborted();
                const refreshed = new Set(result.refreshedNames);
                const next = new Map([...quotes].filter(([, row]) => !refreshed.has(row.name) && validRow(row, now())));
                for (const row of result.rows) next.set(marketQuoteKey(row.name, null, row.paintSeed), { ...row, quote: quoteFor(row) });
                quotes = next;
                await save().catch(error => console.warn('Không lưu được giá Blue Gem:', error.code ?? error.message));
                return status('updated');
            } catch (error) {
                if (!active.signal.aborted) console.warn('Không đồng bộ được giá Blue Gem:', error.code ?? error.message);
                return status('unavailable');
            }
        }).finally(() => { task = undefined; controller = undefined; });
        return task;
    }

    function schedule() {
        if (!running) return;
        timer = setTimeout(() => {
            schedule();
            if (running) void refresh();
        }, Math.max(1, nextRefreshAt() - now()));
        timer.unref();
    }

    async function start() {
        if (running) return initialized;
        running = true;
        initialized ??= load();
        await initialized;
        if (!running) return;
        if (checkedAt == null) void refresh();
        schedule();
    }

    async function stop() {
        running = false;
        clearTimeout(timer);
        controller?.abort();
        await task;
    }

    return { peek, refresh, start, stop, nextRefreshAt };
}

module.exports = { ...createBlueGemPrices(), createBlueGemPrices, collectBlueGemPrices, supports, PATTERNS_URL, MARKET_URL, REFRESH_MS };
