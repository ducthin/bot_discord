const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { Worker } = require('node:worker_threads');
const { containers, skins } = require('./cs2Catalogue');
const { getCaseMarketHashName, getDropMarketHashName, marketQuoteKey, wearBounds } = require('./cs2MarketNames');
const { collectMarketPrices, validTime, HOUR_MS, PRICE_TTL_MS, DISPLAY_TTL_MS } = require('./cs2PriceSnapshotWorker');

const CACHE_FILE = path.join(__dirname, '..', 'data', 'cs2-price-snapshot.json');
const REFRESH_MS = HOUR_MS / 2;
const CACHE_VERSION = 3;
const CACHE_LIMIT = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;

function getCatalogueQuotes() {
    const names = new Set(containers.map(({ id }) => getCaseMarketHashName(id)).filter(Boolean));
    const phasesByName = new Map();
    for (const [skinId, skin] of Object.entries(skins)) {
        const min = Math.round(skin.min * 1_000_000) / 1_000_000;
        const max = Math.round(skin.max * 1_000_000) / 1_000_000;
        const floats = skin.min == null && skin.max == null ? [null]
            : [min, ...wearBounds.filter(bound => bound > min && bound <= max)];
        for (const float of floats) {
            for (const statTrak of skin.stattrak ? [false, true] : [false]) {
                const name = getDropMarketHashName({ skinId, float, statTrak });
                if (!name) continue;
                names.add(name);
                if (skin.phase) {
                    if (!phasesByName.has(name)) phasesByName.set(name, new Set());
                    phasesByName.get(name).add(skin.phase);
                }
            }
        }
    }
    return { names, phasesByName };
}

const { names: catalogueNames, phasesByName } = getCatalogueQuotes();
const catalogueKeys = new Map([...catalogueNames].map(name => [name, null]));
for (const [name, phases] of phasesByName) {
    for (const phase of phases) catalogueKeys.set(marketQuoteKey(name, phase), phase);
}
const catalogueRevision = createHash('sha256').update([...catalogueKeys.keys()].sort().join('\n')).digest('hex');

function makeQuote(priceVnd, observedAt, phase = null, url = null) {
    return Object.freeze({ priceVnd, observedAt, expiresAt: observedAt + PRICE_TTL_MS, source: 'buff', phase,
        url: typeof url === 'string' && url.length <= 512 ? url : null });
}

async function collectInWorker(signal) {
    signal.throwIfAborted();
    const worker = new Worker(path.join(__dirname, 'cs2PriceSnapshotWorker.js'), {
        workerData: { priceNames: [...catalogueNames], phasesByName }
    });
    let abort;
    try {
        return await new Promise((resolve, reject) => {
            abort = () => reject(signal.reason);
            signal.addEventListener('abort', abort, { once: true });
            worker.once('message', ({ data, error }) => error ? reject(new Error(error)) : resolve(data));
            worker.once('error', reject);
            worker.once('exit', code => reject(new Error(`Price snapshot worker stopped before replying (${code})`)));
        });
    } finally {
        signal.removeEventListener('abort', abort);
        await worker.terminate();
    }
}

async function writeSnapshot(file, data) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(temporary, JSON.stringify(data), { flag: 'wx', mode: 0o600 });
        await fs.rename(temporary, file);
    } finally {
        await fs.unlink(temporary).catch(() => {});
    }
}

function createPriceSnapshot({ file = CACHE_FILE, fetcher, now = Date.now } = {}) {
    let quotes = new Map();
    let sourceUpdatedAt = null;
    let attemptedAt = null;
    let initialized;
    let running = false;
    let timer;
    let task;
    let request;

    async function load() {
        try {
            if ((await fs.stat(file)).size > CACHE_LIMIT) throw new Error('Snapshot file is too large');
            const snapshot = JSON.parse(await fs.readFile(file, 'utf8'));
            if (snapshot.version === 1) return;
            const mixed = snapshot.version === 2;
            if ((!mixed && snapshot.version !== CACHE_VERSION) || !Array.isArray(snapshot.quotes)) {
                throw new Error('Invalid snapshot format');
            }
            const time = now();
            const phaseIndex = mixed ? 4 : 3;
            for (const entry of snapshot.quotes) {
                if (!Array.isArray(entry) || (mixed && entry[3] !== 'buff')) continue;
                const [key, priceVnd, observedAt] = entry;
                const phase = entry[phaseIndex] ?? null;
                const url = entry[phaseIndex + 1];
                if (phase === catalogueKeys.get(key) &&
                    Number.isSafeInteger(priceVnd) && priceVnd > 0 && validTime(observedAt, time, DISPLAY_TTL_MS)) {
                    quotes.set(key, makeQuote(priceVnd, observedAt, phase, url));
                }
            }
            if (!quotes.size) return;
            sourceUpdatedAt = validTime(snapshot.updatedAt, time, DISPLAY_TTL_MS) ? snapshot.updatedAt : null;
            // Refresh at startup after the pricing policy or catalogue changes.
            if (!mixed && snapshot.catalogueRevision === catalogueRevision && validTime(snapshot.checkedAt, time, DISPLAY_TTL_MS)) {
                attemptedAt = snapshot.checkedAt;
            }
        } catch (error) {
            if (error.code !== 'ENOENT') console.warn('Không đọc được bảng giá CS2:', error.code ?? error.message);
        }
    }

    function peek(name, { phase = null, allowStale = false } = {}) {
        const quote = quotes.get(marketQuoteKey(name, phase));
        if (!quote) return null;
        return validTime(quote.observedAt, now(), allowStale ? DISPLAY_TTL_MS : PRICE_TTL_MS) ? quote : null;
    }

    function status(result) {
        return { status: result, count: quotes.size, updatedAt: sourceUpdatedAt, nextRefreshAt: nextRefreshAt() };
    }

    function nextRefreshAt() {
        return (Math.floor(now() / REFRESH_MS) + 1) * REFRESH_MS;
    }

    async function download(controller) {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
        try {
            const { updatedAt, prices } = fetcher ? await collectMarketPrices(catalogueNames, { fetcher, now, signal, phasesByName })
                : await collectInWorker(signal);
            signal.throwIfAborted();
            const time = now();
            const next = new Map([...quotes].filter(([, quote]) => validTime(quote.observedAt, time, DISPLAY_TTL_MS)));
            let changed = next.size !== quotes.size;
            for (const [name, priceVnd, observedAt, phase, url] of prices) {
                const key = marketQuoteKey(name, phase);
                const saved = next.get(key);
                if (saved?.observedAt > observedAt) continue;
                const quote = makeQuote(priceVnd, observedAt, phase, url);
                if (saved?.observedAt !== observedAt || saved.priceVnd !== priceVnd || saved.url !== quote.url) {
                    changed = true;
                    next.set(key, quote);
                }
            }
            quotes = next;
            sourceUpdatedAt = Math.max(sourceUpdatedAt ?? 0, updatedAt);
            try {
                await writeSnapshot(file, { version: CACHE_VERSION, catalogueRevision, checkedAt: attemptedAt, updatedAt: sourceUpdatedAt,
                    quotes: [...quotes].map(([key, quote]) => [key, quote.priceVnd, quote.observedAt, quote.phase, quote.url]) });
            } catch (error) {
                console.warn('Không lưu được bảng giá CS2:', error.code ?? error.message);
            }
            return status(changed ? 'updated' : 'unchanged');
        } catch (error) {
            if (!controller.signal.aborted) console.warn('Không đồng bộ được bảng giá CS2:', error.code ?? error.message);
            return status('unavailable');
        } finally {
            controller.abort();
        }
    }

    function refresh() {
        if (!task) {
            initialized ??= load();
            const controller = new AbortController();
            request = controller;
            task = initialized.then(() => {
                if (controller.signal.aborted) return status('unavailable');
                const time = now();
                const slotStart = time - time % REFRESH_MS;
                if (attemptedAt != null && attemptedAt >= slotStart) return status('cooldown');
                attemptedAt = time;
                return download(controller);
            }).finally(() => {
                request = undefined;
                task = undefined;
            });
        }
        return task;
    }

    function schedule() {
        if (!running) return;
        const target = nextRefreshAt();
        timer = setTimeout(async () => {
            schedule();
            if (now() < target) return;
            await task;
            if (running) await refresh();
        }, Math.max(0, target - now())).unref();
    }

    async function start() {
        if (running) return initialized;
        running = true;
        initialized ??= load();
        await initialized;
        if (!running) return;
        // Load missing prices once at startup. Subsequent checks follow the wall clock.
        if (attemptedAt == null || now() % REFRESH_MS === 0) void refresh();
        schedule();
    }

    async function stop() {
        running = false;
        clearTimeout(timer);
        request?.abort();
        await task;
    }

    return { peek, start, stop, refresh, nextRefreshAt };
}

module.exports = { ...createPriceSnapshot(), createPriceSnapshot, REFRESH_MS };
