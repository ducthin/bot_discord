const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { skins } = require('./cs2Catalogue');
const { wearIndex } = require('./cs2MarketNames');
const { getBlueGemReference, getBlueGemArt } = require('./cs2BlueGemArt');
const { renderRoot, imagesBySkin } = require('../assets/cs2-wear-art.json');

const PREFIX = '/play/art/skins/';
// Vanilla knives use their weapon identity instead of the hashed finish ID.
// Both forms still have to exist in the checked-in catalogue before loading.
const SKIN_ID = /^skin-(?:[a-f0-9]{12}|vanilla-weapon_[a-z0-9_]+)$/;
const ROUTE = /^\/play\/art\/skins\/(skin-(?:[a-f0-9]{12}|vanilla-weapon_[a-z0-9_]+))\/(base|wear-[0-4]|seed-(?:0|[1-9]\d{0,3}))\.png$/;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_END = Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MEMORY_BYTES = 48 * 1024 * 1024;
const MEMORY_ENTRIES = 256;
const DISK_BYTES = 128 * 1024 * 1024;
const DISK_ENTRIES = 1024;
const REQUEST_TIMEOUT = 5000;
const FAILURE_TTL = 30_000;
const error = (status, message) => Object.assign(new Error(message), { status });
const hash = value => createHash('sha256').update(value).digest('hex');

function knownSkin(id) {
    return typeof id === 'string' && SKIN_ID.test(id) && Object.hasOwn(skins, id);
}

function getPlayerSkinImage(drop) {
    if (!knownSkin(drop?.skinId)) return null;
    const blueGem = getBlueGemReference(drop);
    const exterior = Number.isFinite(drop.float) && drop.float >= 0 && drop.float <= 1 ? wearIndex(drop.float) : null;
    const variant = blueGem ? `seed-${blueGem.paintSeed}` : exterior == null ? 'base' : `wear-${exterior}`;
    return `${PREFIX}${drop.skinId}/${variant}.png`;
}

function getPlayerTargetImage(target) {
    if (!knownSkin(target?.skinId ?? target?.drop?.skinId)) return null;
    const drop = target.drop ?? target;
    if (getBlueGemReference(drop)) return getPlayerSkinImage(drop);
    const exterior = Number.isInteger(target.exterior) && target.exterior >= 0 && target.exterior <= 4 ? target.exterior : null;
    return exterior == null ? getPlayerSkinImage(drop) : `${PREFIX}${target.skinId ?? drop.skinId}/wear-${exterior}.png`;
}

// URLs only come from the checked-in catalogue. The HTTP route never accepts a URL.
function safeSource(value) {
    if (typeof value !== 'string') return null;
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return null;
        if (url.hostname === 'community.akamai.steamstatic.com' && /^\/economy\/image\/[A-Za-z0-9_-]+$/.test(url.pathname)) return url.href;
        if (url.hostname === 'esm.sh' && url.href.startsWith(renderRoot) && url.pathname.endsWith('.png')) return url.href;
    } catch { /* An invalid catalogue reference cannot become a network request. */ }
    return null;
}

function descriptor(pathname) {
    const match = ROUTE.exec(pathname);
    if (!match || !knownSkin(match[1])) return null;
    const [, skinId, variant] = match;
    const fallback = safeSource(skins[skinId].image);
    if (variant.startsWith('seed-')) {
        const drop = { skinId, paintSeed: Number(variant.slice(5)) };
        return getBlueGemReference(drop) ? { drop, sources: fallback ? [fallback] : [] } : null;
    }
    let preferred;
    if (variant.startsWith('wear-')) {
        const art = imagesBySkin[skinId]?.[Number(variant.slice(5))];
        if (typeof art === 'string') preferred = safeSource(art.startsWith('https://') ? art : renderRoot + art.split('/').map(encodeURIComponent).join('/'));
    }
    return { sources: [...new Set([preferred, fallback].filter(Boolean))] };
}

function validPng(buffer) {
    return Buffer.isBuffer(buffer) && buffer.length >= 57 && buffer.length <= MAX_IMAGE_BYTES &&
        buffer.subarray(0, 8).equals(PNG_SIGNATURE) && buffer.readUInt32BE(8) === 13 &&
        buffer.toString('ascii', 12, 16) === 'IHDR' && buffer.readUInt32BE(16) > 0 &&
        buffer.readUInt32BE(20) > 0 && buffer.readUInt32BE(16) <= 2048 && buffer.readUInt32BE(20) <= 2048 &&
        buffer.subarray(-12).equals(PNG_END);
}

function createPlayerAssetHandler({ fetchImpl = (...args) => fetch(...args), cacheDir = path.join(__dirname, '..', 'data', 'player-images'),
    maxMemoryBytes = MEMORY_BYTES, maxMemoryEntries = MEMORY_ENTRIES, maxDiskBytes = DISK_BYTES, maxDiskEntries = DISK_ENTRIES,
    concurrency = 8, maxQueue = 64, now = Date.now } = {}) {
    const memory = new Map(), pending = new Map(), failures = new Map(), queue = [];
    let memoryUsed = 0, active = 0, diskReady, diskPrune, writesSincePrune = 0;

    function remember(key, buffer) {
        if (memory.has(key)) memoryUsed -= memory.get(key).length;
        memory.delete(key);
        memory.set(key, buffer);
        memoryUsed += buffer.length;
        while (memory.size > maxMemoryEntries || memoryUsed > maxMemoryBytes) {
            const oldest = memory.keys().next().value;
            memoryUsed -= memory.get(oldest).length;
            memory.delete(oldest);
        }
        return buffer;
    }
    async function pruneDisk() {
        if (!cacheDir) return;
        if (diskPrune) return diskPrune;
        diskPrune = (async () => {
            const names = (await fs.readdir(cacheDir)).filter(name => /^[a-f0-9]{64}\.png$/.test(name));
            const files = (await Promise.all(names.map(async name => {
                const file = path.join(cacheDir, name);
                try { const stat = await fs.stat(file); return stat.isFile() ? { file, size: stat.size, at: stat.mtimeMs } : null; }
                catch { return null; }
            }))).filter(Boolean).sort((a, b) => a.at - b.at);
            let bytes = files.reduce((sum, item) => sum + item.size, 0), count = files.length;
            for (const item of files) {
                if (bytes <= maxDiskBytes && count <= maxDiskEntries) break;
                await fs.unlink(item.file).catch(() => {});
                bytes -= item.size; count--;
            }
        })().catch(() => {}).finally(() => { diskPrune = null; });
        return diskPrune;
    }
    async function prepareDisk() {
        if (!cacheDir) return;
        diskReady ??= fs.mkdir(cacheDir, { recursive: true }).then(pruneDisk).catch(() => {});
        return diskReady;
    }
    async function readDisk(key) {
        if (!cacheDir) return null;
        await prepareDisk();
        const file = path.join(cacheDir, `${key}.png`);
        try {
            const stat = await fs.stat(file);
            if (!stat.isFile() || stat.size < 57 || stat.size > MAX_IMAGE_BYTES) return null;
            const buffer = await fs.readFile(file);
            if (validPng(buffer)) return buffer;
            await fs.unlink(file).catch(() => {});
        } catch { /* A missing cache must not prevent fetching the real image. */ }
        return null;
    }
    async function writeDisk(key, buffer) {
        if (!cacheDir) return;
        await prepareDisk();
        const temporary = path.join(cacheDir, `${key}-${randomUUID()}.tmp`);
        try {
            await fs.writeFile(temporary, buffer, { flag: 'wx' });
            await fs.rename(temporary, path.join(cacheDir, `${key}.png`));
            if (++writesSincePrune >= 8) { writesSincePrune = 0; await pruneDisk(); }
        } catch { /* Read-only disks still have the bounded memory cache. */ }
        finally { await fs.unlink(temporary).catch(() => {}); }
    }
    async function limited(task) {
        if (active >= concurrency) {
            if (queue.length >= maxQueue) throw error(503, 'Ảnh đang được tải. Vui lòng thử lại.');
            await new Promise((resolve, reject) => {
                const entry = { resolve, timer: null };
                entry.timer = setTimeout(() => {
                    const index = queue.indexOf(entry);
                    if (index >= 0) queue.splice(index, 1);
                    reject(error(503, 'Ảnh đang được tải. Vui lòng thử lại.'));
                }, REQUEST_TIMEOUT * 2);
                entry.timer.unref?.();
                queue.push(entry);
            });
        } else active++;
        try { return await task(); }
        finally {
            const next = queue.shift();
            if (next) { clearTimeout(next.timer); next.resolve(); }
            else active--;
        }
    }
    async function download(url) {
        if (!safeSource(url)) return null;
        return limited(async () => {
            const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT),
                headers: { Accept: 'image/png' } });
            if (!response.ok || !/^image\/png(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body ||
                Number(response.headers.get('content-length') ?? 0) > MAX_IMAGE_BYTES) {
                await response.body?.cancel?.().catch(() => {});
                return null;
            }
            let size = 0;
            const chunks = [];
            try {
                for await (const chunk of response.body) {
                    size += chunk.length;
                    if (size > MAX_IMAGE_BYTES) return null;
                    chunks.push(chunk);
                }
            } catch { return null; }
            const buffer = Buffer.concat(chunks, size);
            return validPng(buffer) ? buffer : null;
        });
    }
    async function sourceImage(url) {
        const key = hash(url);
        if (memory.has(key)) return remember(key, memory.get(key));
        if ((failures.get(key) ?? 0) > now()) return null;
        if (pending.has(key)) return pending.get(key);
        const result = (async () => {
            const stored = await readDisk(key);
            if (stored) return remember(key, stored);
            const buffer = await download(url).catch(() => null);
            if (buffer) {
                remember(key, buffer);
                await writeDisk(key, buffer);
                return buffer;
            }
            failures.delete(key);
            failures.set(key, now() + FAILURE_TTL);
            while (failures.size > 512) failures.delete(failures.keys().next().value);
            return null;
        })().finally(() => { pending.delete(key); });
        pending.set(key, result);
        return result;
    }
    async function load(pathname) {
        const item = descriptor(pathname);
        if (!item) throw error(404, 'Không tìm thấy ảnh skin.');
        if (item.drop) {
            const local = getBlueGemArt(item.drop)?.buffer;
            if (local && validPng(local)) return local;
        }
        for (const source of item.sources) {
            const buffer = await sourceImage(source);
            if (buffer) return buffer;
        }
        throw error(503, 'Ảnh skin chưa tải được. Vui lòng thử lại.');
    }
    const handler = async (req, res, pathname = req.url?.split('?')[0]) => {
        if (typeof pathname !== 'string' || !pathname.startsWith(PREFIX)) return false;
        if (!['GET', 'HEAD'].includes(req.method)) throw error(405, 'Phương thức không được hỗ trợ.');
        const buffer = await load(pathname);
        const etag = `"${hash(buffer)}"`;
        const headers = { 'Content-Type': 'image/png', 'Content-Length': buffer.length, 'Cache-Control': 'public, max-age=86400',
            'X-Content-Type-Options': 'nosniff', ETag: etag };
        if (req.headers?.['if-none-match'] === etag) {
            delete headers['Content-Length'];
            res.writeHead(304, headers); res.end();
        } else {
            res.writeHead(200, headers); res.end(req.method === 'HEAD' ? undefined : buffer);
        }
        return true;
    };
    handler.load = load;
    return handler;
}

const handlePlayerSkinImage = createPlayerAssetHandler();
module.exports = { getPlayerSkinImage, getPlayerTargetImage, createPlayerAssetHandler, handlePlayerSkinImage };
