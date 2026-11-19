const { isMainThread, parentPort, workerData } = require('node:worker_threads');

const PRICES_URL = 'https://api.openskin.dev/v1/prices/all';
const FX_URL = 'https://api.frankfurter.dev/v2/rate/USD/VND';
const HOUR_MS = 60 * 60_000;
const PRICE_TTL_MS = 24 * HOUR_MS;
const DISPLAY_TTL_MS = 48 * HOUR_MS;
const FX_TTL_MS = 7 * 24 * HOUR_MS;
const PRICES_LIMIT = 80 * 1024 * 1024;
const FX_LIMIT = 4096;

function validTime(time, now, maxAge) {
    return Number.isSafeInteger(time) && time <= now && time > now - maxAge;
}

function validExchangeRate(fx, now) {
    return Number.isFinite(fx?.rate) && fx.rate > 0 && validTime(fx.observedAt, now, FX_TTL_MS);
}

function usdToXu(priceUsd, rate) {
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) return null;
    const priceXu = Math.round(priceUsd * rate);
    return Number.isSafeInteger(priceXu) && priceXu > 0 ? priceXu : null;
}

async function boundedJson(fetcher, url, limit, signal) {
    const response = await fetcher(url, { headers: { accept: 'application/json' }, redirect: 'error', signal });
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith('application/json') || !response.body) {
        await response.body?.cancel().catch(() => {});
        throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
    }
    if (Number(response.headers.get('content-length')) > limit) {
        await response.body.cancel().catch(() => {});
        throw new Error('Response is larger than the snapshot limit');
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > limit) throw new Error('Response is larger than the snapshot limit');
        chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
}

function buffPrice(quote, rate, now) {
    if (!quote || (quote.currency != null && quote.currency !== 'USD')) return null;
    const observedAt = Date.parse(quote.updated_at);
    const priceVnd = usdToXu(quote.ask, rate);
    return priceVnd != null && validTime(observedAt, now, DISPLAY_TTL_MS) ? [priceVnd, observedAt] : null;
}

async function collectMarketPrices(names, { fetcher = fetch, now = Date.now, signal, phasesByName } = {}) {
    const [snapshot, exchange] = await Promise.all([
        boundedJson(fetcher, PRICES_URL, PRICES_LIMIT, signal),
        boundedJson(fetcher, FX_URL, FX_LIMIT, signal)
    ]);
    const time = now();
    const fx = { rate: exchange?.rate, observedAt: Date.parse(exchange?.date) };
    if (exchange?.base !== 'USD' || exchange.quote !== 'VND' || !validExchangeRate(fx, time)) {
        throw new Error('Invalid USD/VND reference rate');
    }
    const updatedAt = Date.parse(snapshot?.updated_at);
    if (!Number.isSafeInteger(snapshot?.count) || snapshot.count < 1 || !snapshot.data ||
        typeof snapshot.data !== 'object' || Array.isArray(snapshot.data) || !validTime(updatedAt, time, DISPLAY_TTL_MS)) {
        throw new Error('Invalid source snapshot');
    }
    const prices = [];
    for (const name of names) {
        if (!Object.hasOwn(snapshot.data, name)) continue;
        const item = snapshot.data[name];
        const buff = item?.buff;
        if (buff?.currency !== 'USD') continue;
        const link = typeof item.links?.buff === 'string' ? item.links.buff : null;
        const phases = phasesByName?.get(name);
        if (!phases?.size) {
            const base = buffPrice(buff, fx.rate, time);
            if (base) prices.push([name, ...base, null, link]);
            continue;
        }
        // The top-level BUFF ask for a Doppler can belong to any one phase.
        const patterns = Array.isArray(buff.patterns) ? buff.patterns : [];
        for (const phase of phases) {
            const quote = buffPrice(patterns.find(row => row?.pattern === phase), fx.rate, time);
            if (quote) prices.push([name, ...quote, phase, link]);
        }
    }
    if (!prices.length) throw new Error('No valid BUFF prices for the bot catalogue');
    return { updatedAt, prices };
}

if (!isMainThread && workerData?.priceNames) {
    // The raw bulk document stays in this worker.
    void collectMarketPrices(workerData.priceNames, { phasesByName: workerData.phasesByName }).then(
        data => parentPort.postMessage({ data }),
        error => parentPort.postMessage({ error: error.code ?? error.message })
    );
}

module.exports = {
    collectMarketPrices, validTime, HOUR_MS, PRICE_TTL_MS, DISPLAY_TTL_MS,
    boundedJson, usdToXu, validExchangeRate
};
