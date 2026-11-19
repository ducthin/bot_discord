const fs = require('node:fs');
const path = require('node:path');

const ART_ROOT = path.join(__dirname, '..', 'assets', 'cs2-battle-art');
const MAX_FILE_BYTES = 600 * 1024;
const CACHE_BYTES = 12 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const cache = new Map();
let used = 0;

function remember(id, art) {
    cache.set(id, art);
    used += art.buffer.length;
    while (used > CACHE_BYTES && cache.size > 1) {
        const oldest = cache.keys().next().value;
        used -= cache.get(oldest).buffer.length;
        cache.delete(oldest);
    }
    return art;
}

function loadArt(id, attachmentLimit) {
    if (!/^(battle-[a-z0-9-]+|tie)$/.test(id ?? '') ||
        typeof attachmentLimit !== 'number' || attachmentLimit <= 0 || Number.isNaN(attachmentLimit)) return null;
    let art = cache.get(id);
    if (art) {
        cache.delete(id);
        cache.set(id, art);
    } else {
        try {
            const file = path.join(ART_ROOT, `${id}.png`);
            const stat = fs.statSync(file);
            if (!stat.isFile() || stat.size < 24 || stat.size > MAX_FILE_BYTES || stat.size > attachmentLimit) return null;
            const buffer = fs.readFileSync(file);
            if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE) || buffer.toString('ascii', 12, 16) !== 'IHDR') return null;
            const width = buffer.readUInt32BE(16);
            const height = buffer.readUInt32BE(20);
            if (width !== 1024 || height !== 640) return null;
            const name = `cs2-${id}.png`;
            art = Object.freeze({ buffer, name, url: `attachment://${name}`, width, height });
            remember(id, art);
        } catch {
            return null;
        }
    }
    return art.buffer.length <= attachmentLimit ? art : null;
}

function getBattleCaseArt(itemOrId, attachmentLimit = Infinity) {
    const id = typeof itemOrId === 'string' ? itemOrId : itemOrId?.artId ?? itemOrId?.id;
    return loadArt(id, attachmentLimit);
}

function getBattleTieArt(attachmentLimit = Infinity) {
    return loadArt('tie', attachmentLimit);
}

function getBattleTieAnimation(winnerSide, attachmentLimit = Infinity) {
    if (!['left', 'right'].includes(winnerSide) || typeof attachmentLimit !== 'number' || attachmentLimit <= 0 || Number.isNaN(attachmentLimit)) return null;
    const id = `tie-${winnerSide}`;
    let art = cache.get(id);
    if (!art) {
        try {
            const file = path.join(ART_ROOT, `${id}.gif`);
            const stat = fs.statSync(file);
            if (!stat.isFile() || stat.size < 13 || stat.size > MAX_FILE_BYTES || stat.size > attachmentLimit) return null;
            const buffer = fs.readFileSync(file);
            if (!['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6)) ||
                buffer.readUInt16LE(6) !== 768 || buffer.readUInt16LE(8) !== 480) return null;
            const name = `cs2-${id}.gif`;
            art = remember(id, Object.freeze({ buffer, name, url: `attachment://${name}`, durationMs: 2600, width: 768, height: 480 }));
        } catch {
            return null;
        }
    } else {
        cache.delete(id);
        cache.set(id, art);
    }
    return art.buffer.length <= attachmentLimit ? art : null;
}

module.exports = { getBattleCaseArt, getBattleTieArt, getBattleTieAnimation };
