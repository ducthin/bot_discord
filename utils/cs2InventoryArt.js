const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const ffmpeg = require('ffmpeg-static');
const metrics = require('./performanceMetrics');
const { cachedImage, prepareArtworkRenderer, reserveArtworkSlot } = require('./cs2Reel');

const execute = promisify(execFile);
const WIDTH = 2256;
const GAP = 24;
const CARD_HEIGHT = 472;
const ART_HEIGHT = 178;
const TEXT_INSET = 28;
const IMAGE_WAIT_MS = 2200;
const GRID_CACHE_TTL_MS = 45_000;
const GRID_CACHE_MAX_BYTES = 16_000_000;
const GRID_CACHE_MAX_ENTRIES = 24;
const cachedGrids = new Map();
const pendingGrids = new Map();
const artworkCrops = new WeakMap();
let cachedBytes = 0;
let rendering = 0;

function removeCachedGrid(key) {
    cachedBytes -= cachedGrids.get(key).grid.png.length;
    cachedGrids.delete(key);
}

function cacheGrid(key, grid) {
    if (grid.png.length > GRID_CACHE_MAX_BYTES) return;
    if (cachedGrids.has(key)) removeCachedGrid(key);
    while (cachedGrids.size >= GRID_CACHE_MAX_ENTRIES || cachedBytes + grid.png.length > GRID_CACHE_MAX_BYTES) {
        removeCachedGrid(cachedGrids.keys().next().value);
    }
    cachedGrids.set(key, { grid, expiresAt: Date.now() + GRID_CACHE_TTL_MS });
    cachedBytes += grid.png.length;
}

async function collectImages(cards) {
    const images = new Map();
    const preferredImages = new Set();
    let ready;
    const preferredReady = new Promise(resolve => { ready = resolve; });
    let timer;
    const requests = cards.flatMap(({ image, fallback }, index) => {
        const preferred = cachedImage(image).then(artwork => {
            images.set(index, artwork);
            preferredImages.add(index);
            if (preferredImages.size === cards.length) ready();
        }, () => {});
        if (image === fallback) return [preferred];
        // Let an already cached preferred image settle before requesting its fallback.
        const alternate = Promise.resolve().then(() => {
            if (preferredImages.has(index)) return;
            return cachedImage(fallback).then(artwork => {
                if (!images.has(index)) images.set(index, artwork);
            }, () => {});
        });
        return [preferred, alternate];
    });
    await Promise.race([
        preferredReady,
        Promise.all(requests),
        new Promise(resolve => { timer = setTimeout(resolve, IMAGE_WAIT_MS); })
    ]);
    clearTimeout(timer);
    return { images: new Map(images), complete: preferredImages.size === cards.length };
}

function titleLines(title, maxLength) {
    if (title.length <= maxLength) return title;
    const space = title.lastIndexOf(' ', maxLength);
    const split = space > maxLength / 2 ? space : maxLength;
    return `${title.slice(0, split).trimEnd()}\n${title.slice(split).trimStart()}`;
}

function gridFilters(cards, images, crops, hasFont) {
    const columns = Math.min(3, cards.length);
    const cardWidth = Math.floor((WIDTH - GAP * (columns + 1)) / columns);
    const height = Math.ceil(cards.length / columns) * (CARD_HEIGHT + GAP) + GAP;
    const filters = [];
    const tiles = [];
    const positions = [];
    const titles = [];
    let input = 0;
    for (const [index, card] of cards.entries()) {
        const background = `[background${index}]`;
        const cardArt = `[card${index}]`;
        const tile = `[tile${index}]`;
        const labels = [];
        filters.push(
            `color=c=0x202630:s=${cardWidth}x${CARD_HEIGHT}:r=1:d=1,format=rgb24,` +
            'drawbox=x=0:y=0:w=iw:h=224:color=0x292f3c:t=fill,' +
            `drawbox=x=0:y=220:w=iw:h=6:color=0x${card.color.slice(1)}:t=fill${background}`
        );
        if (images.has(index)) {
            const art = `[art${index}]`;
            const crop = crops.has(index) ? `crop=${crops.get(index)}:exact=1,` : '';
            filters.push(
                `[${input++}:v]format=rgba,${crop}scale=${cardWidth - 108}:${ART_HEIGHT}:force_original_aspect_ratio=decrease:flags=lanczos${art}`,
                `${background}${art}overlay=x=(W-w)/2:y=20+(${ART_HEIGHT}-h)/2:format=rgb:shortest=1${cardArt}`
            );
        } else {
            filters.push(`${background}null${cardArt}`);
        }
        if (hasFont) {
            const textWidth = cardWidth - 64;
            const title = titleLines(card.name.replace('★ ', ''), Math.floor(textWidth / 24));
            titles[index] = title;
            const longest = Math.max(...title.split('\n').map(line => line.length));
            const titleSize = Math.min(title.includes('\n') ? 38 : 46, Math.floor(textWidth / (Math.max(1, longest) * 0.61)));
            const collectionSize = Math.min(32, Math.floor(textWidth / (Math.max(1, card.collection?.length ?? 0) * 0.59)));
            const detailSize = Math.min(34, Math.floor(textWidth / (card.detail.length * 0.59)));
            const priceSize = Math.min(38, Math.floor(textWidth / (card.price.length * 0.59)));
            labels.push(
                `drawtext=fontfile=result.ttf:text='${card.number}':fontsize=44:fontcolor=0xe3e7ef:x=${TEXT_INSET}:y=24`,
                ...(card.locked === true ? [
                    'drawbox=x=iw-220:y=22:w=196:h=48:color=0x151922@0.95:t=fill',
                    'drawtext=fontfile=result.ttf:text=ĐÃ KHÓA:expansion=none:fontsize=30:fontcolor=0xffd578:x=w-tw-40:y=30'
                ] : []),
                `drawtext=fontfile=result.ttf:textfile=name${index}.txt:expansion=none:fontsize=${titleSize}:line_spacing=2:fontcolor=0xf4f5f8:x=${TEXT_INSET}:y=244`,
                ...(card.collection ? [`drawtext=fontfile=result.ttf:textfile=collection${index}.txt:expansion=none:fontsize=${collectionSize}:fontcolor=0xc1cad7:x=${TEXT_INSET}:y=342`] : []),
                `drawtext=fontfile=result.ttf:textfile=wear${index}.txt:expansion=none:fontsize=${detailSize}:fontcolor=0xaeb9c9:x=${TEXT_INSET}:y=382`,
                `drawtext=fontfile=result.ttf:textfile=price${index}.txt:expansion=none:fontsize=${priceSize}:fontcolor=0x${card.hasPrice ? '9ee6c0' : 'aeb9c9'}:x=${TEXT_INSET}:y=425`
            );
            if (!images.has(index)) {
                labels.push("drawtext=fontfile=result.ttf:text='Ảnh chưa tải':fontsize=36:fontcolor=0xaeb9c9:x=(w-tw)/2:y=86");
            }
        }
        filters.push(`${cardArt}${[...labels, 'format=rgb24'].join(',')}${tile}`);
        tiles.push(tile);
        positions.push(`${(index % columns) * (cardWidth + GAP)}_${Math.floor(index / columns) * (CARD_HEIGHT + GAP)}`);
    }
    const stack = tiles.length > 1 ? `xstack=inputs=${tiles.length}:layout=${positions.join('|')}:fill=0x151922,` : '';
    filters.push(`${tiles.join('')}${stack}pad=${WIDTH}:${height}:${GAP}:${GAP}:color=0x151922[grid]`);
    return { filter: filters.join(';'), titles };
}

async function findArtworkCrops(directory, images, pictures) {
    const missing = new Map();
    for (const index of pictures) {
        const image = images.get(index);
        if (!artworkCrops.has(image) && !missing.has(image)) missing.set(image, index);
    }
    const probes = [...missing.values()];
    if (probes.length) {
        const filter = probes.map((index, input) => `[${input}:v]format=rgba,alphaextract,bbox@item${index}=min_val=4[alpha${index}]`).join(';');
        try {
            const { stderr } = await execute(ffmpeg, [
                '-hide_banner', '-nostats', '-loglevel', 'info', '-filter_complex_threads', '1',
                ...probes.flatMap(index => ['-i', `item${index}.png`]), '-filter_complex', filter,
                ...probes.flatMap(index => ['-map', `[alpha${index}]`]), '-frames:v', '1', '-f', 'null', '-'
            ], { cwd: directory, timeout: 1500, maxBuffer: 256_000, windowsHide: true });
            const detected = new Map();
            for (const match of stderr.matchAll(/\[bbox@item(\d+) @[^\]]+\][^\r\n]+crop=([1-9]\d*:[1-9]\d*:\d+:\d+)/g)) {
                detected.set(Number(match[1]), match[2]);
            }
            for (const [image, index] of missing) artworkCrops.set(image, detected.get(index));
        } catch {
            // Keep using the original artwork and retry the crop on a future render.
        }
    }
    const crops = new Map();
    for (const index of pictures) {
        const crop = artworkCrops.get(images.get(index));
        if (crop) crops.set(index, crop);
    }
    return crops;
}

async function buildGrid(cards, limit, key) {
    rendering++;
    let directory;
    let release;
    try {
        const { images, complete } = await collectImages(cards);
        if (!images.size) return null;
        directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-inventory-'));
        const pictures = [...images.keys()].sort((left, right) => left - right);
        const pictureWrites = await Promise.allSettled(pictures.map(index => fs.writeFile(path.join(directory, `item${index}.png`), images.get(index))));
        if (pictureWrites.some(write => write.status === 'rejected')) return null;
        release = reserveArtworkSlot();
        if (!release) return null;
        const inputs = pictures.flatMap(index => ['-i', `item${index}.png`]);
        const [{ encoder, hasFont }, crops] = await Promise.all([
            prepareArtworkRenderer(path.join(directory, 'result.ttf')),
            findArtworkCrops(directory, images, pictures)
        ]);
        const { filter, titles } = gridFilters(cards, images, crops, hasFont);
        const files = [
            ['grid.txt', filter],
            ...titles.flatMap((title, index) => [
                [`name${index}.txt`, title],
                [`collection${index}.txt`, cards[index].collection ?? ''],
                [`wear${index}.txt`, cards[index].detail],
                [`price${index}.txt`, cards[index].price]
            ])
        ];
        const writes = await Promise.allSettled(files.map(([name, data]) => fs.writeFile(path.join(directory, name), data)));
        if (writes.some(write => write.status === 'rejected')) return null;
        const { stdout } = await execute(encoder, [
            '-hide_banner', '-loglevel', 'error', '-filter_complex_threads', '1',
            ...inputs,
            '-filter_complex_script', 'grid.txt', '-map', '[grid]', '-frames:v', '1',
            '-c:v', 'png', '-compression_level', '3', '-f', 'image2pipe', 'pipe:1'
        ], { cwd: directory, encoding: 'buffer', maxBuffer: limit, timeout: 2200, windowsHide: true });
        if (!stdout.length || stdout.length > limit) return null;
        const grid = { png: stdout, hasLabels: hasFont };
        // Retry incomplete artwork on the next visit instead of caching a degraded grid.
        if (complete) cacheGrid(key, grid);
        return grid;
    } catch {
        return null;
    } finally {
        release?.();
        if (directory) await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
        rendering--;
    }
}

async function renderInventoryGrid(cards, limit) {
    if (!ffmpeg || !cards.length || !Number.isSafeInteger(limit) || limit <= 0) return null;
    const key = JSON.stringify(cards.map(({ number, name, image, fallback, color, detail, collection, hasPrice, price, locked }) =>
        [number, name, image, fallback, color, detail, collection, hasPrice, price, locked === true]));
    const saved = cachedGrids.get(key);
    if (saved && saved.expiresAt > Date.now()) {
        cachedGrids.delete(key);
        cachedGrids.set(key, saved);
        return saved.grid.png.length <= limit ? saved.grid : null;
    }
    if (saved) removeCachedGrid(key);

    const requestKey = `${limit}:${key}`;
    const pending = pendingGrids.get(requestKey);
    if (pending) return pending;
    if (rendering >= 2) return null;
    const task = buildGrid(cards, limit, key).finally(() => pendingGrids.delete(requestKey));
    pendingGrids.set(requestKey, task);
    return task;
}

module.exports = {
    renderInventoryGrid: (...args) => metrics.measure('hom.render.inventory', () => renderInventoryGrid(...args), metrics.mediaBytes)
};
