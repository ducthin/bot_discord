const { performance } = require('node:perf_hooks');

const enabled = process.env.HOM_PERF_METRICS === 'true';
const INTERVAL_MS = 60_000;
const LABELS = new Set([
    'store.read', 'store.transaction', 'store.locked',
    'hom.render.queue', 'hom.render.single', 'hom.render.batch', 'hom.render.inventory',
    'hom.upload', 'battle.upload', 'hom.render.batch.cacheHit', 'hom.render.batch.coalesced',
    'youtube.search', 'youtube.queue', 'youtube.worker', 'youtube.cacheHit', 'youtube.coalesced',
    'youtube.rejected', 'youtube.timeout'
]);
const BOUNDS_MS = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000, 20_000, 60_000, Infinity];
const samples = new Map();
const round = value => Math.round(value * 100) / 100;
const bufferBytes = value => value instanceof Uint8Array ? value.byteLength : 0;

function payloadBytes(payload) {
    if (!Array.isArray(payload?.files)) return 0;
    return payload.files.reduce((total, file) => Math.min(Number.MAX_SAFE_INTEGER,
        total + bufferBytes(file instanceof Uint8Array ? file : file?.attachment)), 0);
}

function mediaBytes(media) {
    return bufferBytes(media?.gif) + bufferBytes(media?.png) + bufferBytes(media?.audio);
}

function record(name, elapsed, result, failed, bytesOf) {
    let item = samples.get(name);
    if (!item) {
        item = { count: 0, error: 0, null: 0, bytes: 0, totalMs: 0, maxMs: 0, buckets: Array(BOUNDS_MS.length).fill(0) };
        samples.set(name, item);
    }
    const duration = Math.max(0, elapsed);
    item.count++;
    item.error += Number(failed);
    item.null += Number(!failed && result === null);
    item.totalMs += duration;
    item.maxMs = Math.max(item.maxMs, duration);
    item.buckets[BOUNDS_MS.findIndex(bound => duration <= bound)]++;
    if (!failed && bytesOf) {
        // Instrumentation must never change a successful operation's result.
        try {
            const bytes = bytesOf(result);
            if (Number.isSafeInteger(bytes) && bytes >= 0) item.bytes = Math.min(Number.MAX_SAFE_INTEGER, item.bytes + bytes);
        } catch {}
    }
}

function measure(name, operation, bytesOf) {
    // Unknown labels are ignored so IDs, queries and URLs cannot grow the map
    // or enter logs. Disabled metrics preserve the original return/throw behavior.
    if (!enabled || !LABELS.has(name)) return operation();
    const started = performance.now();
    try {
        const result = operation();
        if (result && typeof result.then === 'function') {
            return Promise.resolve(result).then(value => {
                record(name, performance.now() - started, value, false, bytesOf);
                return value;
            }, error => {
                record(name, performance.now() - started, undefined, true);
                throw error;
            });
        }
        record(name, performance.now() - started, result, false, bytesOf);
        return result;
    } catch (error) {
        record(name, performance.now() - started, undefined, true);
        throw error;
    }
}

function increment(name) {
    if (enabled && LABELS.has(name)) record(name, 0, undefined, false);
}

function snapshot(reset = false) {
    const metrics = {};
    for (const [name, item] of samples) {
        let cumulative = 0;
        const percentile = Math.ceil(item.count * 0.95);
        const upper = BOUNDS_MS[item.buckets.findIndex(count => (cumulative += count) >= percentile)];
        metrics[name] = { count: item.count, error: item.error, null: item.null, bytes: item.bytes,
            meanMs: round(item.totalMs / item.count), maxMs: round(item.maxMs),
            p95UpperMs: Number.isFinite(upper) ? upper : '>60000' };
    }
    const result = { enabled, rssBytes: process.memoryUsage().rss, metrics };
    if (reset) samples.clear();
    return result;
}

if (enabled) {
    setInterval(() => {
        if (samples.size) console.log('[performance]', JSON.stringify(snapshot(true)));
    }, INTERVAL_MS).unref();
}

module.exports = { measure, increment, snapshot, payloadBytes, mediaBytes };
