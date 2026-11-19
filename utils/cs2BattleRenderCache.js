const { createHash } = require('node:crypto');
const metrics = require('./performanceMetrics');

const TTL_MS = 30_000;
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_ENTRIES = 8;
const MAX_PENDING = 14;
const MAX_GIF_BYTES = 7_500_000;

// Short-lived render reuse only. No persisted media or replay controls.
function createBattleRenderCache(render) {
    const saved = new Map();
    const pending = new Map();
    let bytes = 0;
    const remove = key => { bytes -= saved.get(key).media.gif.length; saved.delete(key); };
    return function renderBatch(rounds, attachmentSizeLimit, options = {}) {
        const limit = Number.isSafeInteger(attachmentSizeLimit) ? Math.min(attachmentSizeLimit, MAX_GIF_BYTES) : MAX_GIF_BYTES;
        // Legacy unseeded animation must still draw a fresh landing position.
        if (options?.profile !== 'battle' || limit <= 0 || !Array.isArray(rounds) || rounds.length < 2 || rounds.length > 10 ||
            !rounds.every(round => Number.isInteger(round.landingSeed) && round.landingSeed >= 0 && round.landingSeed <= 0xffffffff)) {
            return render(rounds, attachmentSizeLimit, options);
        }
        const now = Date.now();
        for (const [key, entry] of saved) if (entry.expiresAt <= now) remove(key);
        const key = createHash('sha256').update(JSON.stringify([limit, options, rounds])).digest('hex');
        if (saved.has(key)) {
            const entry = saved.get(key);
            saved.delete(key);
            saved.set(key, entry);
            metrics.increment('hom.render.batch.cacheHit');
            return Promise.resolve(entry.media);
        }
        if (pending.has(key)) {
            metrics.increment('hom.render.batch.coalesced');
            return pending.get(key);
        }
        if (pending.size >= MAX_PENDING) return render(rounds, attachmentSizeLimit, options);
        const task = Promise.resolve().then(() => render(rounds, attachmentSizeLimit, options)).then(media => {
            if (media?.gif?.length > 0 && media.gif.length <= limit && media.gif.length <= MAX_BYTES) {
                while (saved.size >= MAX_ENTRIES || bytes + media.gif.length > MAX_BYTES) remove(saved.keys().next().value);
                saved.set(key, { media, expiresAt: Date.now() + TTL_MS });
                bytes += media.gif.length;
            }
            return media;
        }).finally(() => pending.delete(key));
        pending.set(key, task);
        return task;
    };
}

module.exports = { createBattleRenderCache };
