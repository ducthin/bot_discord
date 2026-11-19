const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { items } = require('../assets/cs2-blue-gems/manifest.json');

const ROOT = path.join(__dirname, '..', 'assets', 'cs2-blue-gems');
const MAX_BYTES = 2 * 1024 * 1024;
const CACHE_BYTES = 12 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const records = new Map(items.map(item => [`${item.skinId}:${item.paintSeed}`, Object.freeze(item)]));
const urls = new Map(items.map(item => [item.sourceUrl, item]));
const cache = new Map();
let used = 0;

function getBlueGemReference(drop) {
    if (!drop || typeof drop.skinId !== 'string' || !Number.isInteger(drop.paintSeed) || drop.paintSeed < 0 || drop.paintSeed > 1000) return null;
    const item = records.get(`${drop.skinId}:${drop.paintSeed}`);
    if (!item || item.filename !== `${item.skinId}-seed-${item.paintSeed}.png` ||
        !/^skin-[a-f0-9]{12}$/.test(item.skinId)) return null;
    return item;
}

function getBlueGemArt(drop) {
    const item = getBlueGemReference(drop);
    if (!item) return null;
    const key = `${item.skinId}:${item.paintSeed}`;
    let art = cache.get(key);
    if (art) {
        cache.delete(key);
        cache.set(key, art);
        return art;
    }
    try {
        const file = path.join(ROOT, item.filename);
        const stat = fs.statSync(file);
        if (!stat.isFile() || stat.size < 24 || stat.size > MAX_BYTES) return null;
        const buffer = fs.readFileSync(file);
        if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE) || buffer.toString('ascii', 12, 16) !== 'IHDR' ||
            buffer.readUInt32BE(16) !== item.width || buffer.readUInt32BE(20) !== item.height ||
            item.width <= 0 || item.height <= 0 || item.width > 2048 || item.height > 2048 ||
            createHash('sha256').update(buffer).digest('hex') !== item.pngSha256) return null;
        const name = `cs2-blue-gem-${item.skinId}-${item.paintSeed}.png`;
        art = Object.freeze({ buffer, name, url: `attachment://${name}`, sourceUrl: item.sourceUrl,
            patternUrl: item.patternUrl, filename: item.filename, width: item.width, height: item.height });
        cache.set(key, art);
        used += buffer.length;
        while (used > CACHE_BYTES && cache.size > 1) {
            const oldest = cache.keys().next().value;
            used -= cache.get(oldest).buffer.length;
            cache.delete(oldest);
        }
        return art;
    } catch {
        return null;
    }
}

function getBlueGemImage(url) {
    const item = urls.get(url);
    return item ? getBlueGemArt(item)?.buffer ?? null : null;
}

const isBlueGemImage = url => urls.has(url);

module.exports = { getBlueGemReference, getBlueGemArt, getBlueGemImage, isBlueGemImage };
