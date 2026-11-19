const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomInt } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const ffmpeg = require('ffmpeg-static');
const metrics = require('./performanceMetrics');
const { createBattleRenderCache } = require('./cs2BattleRenderCache');
const { getBlueGemImage, isBlueGemImage } = require('./cs2BlueGemArt');

const execute = promisify(execFile);
const TILE_WIDTH = 92;
const HEIGHT = 96;
const PREVIEW_WIDTH = 70;
const PREVIEW_HEIGHT = 58;
const VISIBLE_TILES = 5;
const SCENE_WIDTH = TILE_WIDTH * VISIBLE_TILES;
const SCENE_HEIGHT = 256;
const PRIZE_HEIGHT = 194;
const SCENE_BACKGROUND = '0x1e2330';
const BATCH_LAYOUT = { columns: 1, gap: 0, tileWidth: 84, tileHeight: 78, rowHeight: 84 };
const LARGE_BATCH_LAYOUT = { columns: 2, gap: 4, tileWidth: 56, tileHeight: 56, rowHeight: 60 };
const LARGE_BATTLE_LAYOUT = {
    ...LARGE_BATCH_LAYOUT, tileHeight: 82, rowHeight: 88,
    card: { width: 110, height: 74, wrapAt: 18, titleSize: 18, threeLineSize: 15, detailSize: 13 },
    tileArtwork: { normal: '50:54', rare: '52:64' }
};
const FULL_WIDTH_BATTLE_LAYOUT = {
    ...BATCH_LAYOUT, tileWidth: 104, tileHeight: 104, rowHeight: 112,
    card: { width: 200, height: 94, wrapAt: 23, titleSize: 24, threeLineSize: 20, detailSize: 16 },
    tileArtwork: { normal: '86:74', rare: '96:86' }
};
const BATCH_MAX_BYTES = 7_500_000;
const SINGLE_MAX_BYTES = 3_500_000;
const RENDER_SLOTS = 2;
const OPENING_QUEUE_LIMIT = 12;
const OPENING_QUEUE_WAIT_MS = 4000;
const BATTLE_QUEUE_WAIT_MS = 12_000;
const COMPACT_REEL_SCALE = ',scale=iw*2/3:ih*2/3:flags=neighbor';
// GIF timestamps use centiseconds. A uniform 20 ms step gives 50 fps.
const FRAME_DELAY_CS = 2;
const FRAME_RATE = 100 / FRAME_DELAY_CS;
const SCROLL_CS = 600;
const SCROLL_FRAMES = SCROLL_CS / FRAME_DELAY_CS;
const DEFAULT_TIMING = { frameDelay: FRAME_DELAY_CS, frameRate: FRAME_RATE, scrollFrames: SCROLL_FRAMES };
const BATTLE_TIMING = { frameDelay: 4, frameRate: 25, scrollFrames: SCROLL_CS / 4 };
const SCROLL_EASING = 2.2;
const REVEAL_CS = SCROLL_CS + 60;
const RARE_REVEAL_CS = 795;
const GOLD_STAGES = [
    { time: REVEAL_CS, opacity: 0.07, border: 1, progress: 0.25 },
    { time: 705, opacity: 0.14, border: 2, progress: 0.55 },
    { time: 745, opacity: 0.24, border: 3, progress: 0.85 }
];
const REEL_REVEAL_MS = REVEAL_CS * 10;
const RESULT_FRAME_DELAY_CS = 100;
const REEL_PLAYBACK_MS = REEL_REVEAL_MS + RESULT_FRAME_DELAY_CS * 10;
const RARE_REEL_PLAYBACK_MS = (RARE_REVEAL_CS + RESULT_FRAME_DELAY_CS) * 10;
const SAMPLE_RATE = 44100;
const AUDIO_CHANNELS = 2;
const SAMPLES_PER_CS = SAMPLE_RATE / 100 * AUDIO_CHANNELS;
const BIG_ENDIAN = os.endianness() === 'BE';
const SOUND_DIRECTORY = path.join(__dirname, '..', 'assets', 'csgo-case-audio');
const MYSTERY_DIRECTORY = path.join(__dirname, '..', 'assets', 'cs2-rare-reel');
const { default: defaultMysteryIcon } = require('../assets/cs2-rare-reel/index.json');
// Cue names and relative gains match the Panorama weapon-container sound events.
const REVEAL_SOUNDS = [
    ['case_reveal_rare_01', 0.3],
    ['case_reveal_mythical_01', 0.2],
    ['case_reveal_legendary_01', 0.3],
    ['case_reveal_ancient_01', 0.3],
    ['case_reveal_ancient_01', 0.3]
];
const ASSET_WAIT_MS = 1250;
const MAX_CACHED_IMAGES = 96;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_CACHE_BYTES = 32 * 1024 * 1024;
const TRANSPARENT_PIXEL = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=', 'base64'
);
// Keep a visible gold symbol even when both local mystery artwork files are missing.
const GOLD_MYSTERY_FALLBACK = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAB70lEQVR42u1b0U0DMQx1nm4IVugIDNAtmKAVE/DNBKhMwBYdgBG6AlvAH4LqmovPju30bKnqT5XYz89O0rwQpaWlpW3YiuVkX58v362/fXh8LXcBACdoDzCKZdBPh7fmMT7en03AKL0D5wTNAUMLiNIjeI2gW8DQAKF4B34+7Wh/vLgBgRGyvtRPJI0WnsGfT7t/3x4gFEnw0qz/DXxNGcyVBLccECF4CQuu2cBlAjyC790XOCDAckenlW1NfyFpPNqmAQzXP1hT3yL7nFLA6HUvBQGWTrVk34IhzQCMmn0OCxAp+x4sAFH+JaZGf6vMcbfNtW3yFG0J0/CDAxB6Iu9hXB/BpX9kEG75VlsNYIFyxMyLV4FIIEh8mTQm9mqOGklAFEe85kQ0h6znQlTHrOZAdAd7j41RHO0F7OYPQwkAVa6gb11RexyaJGPWToPJgASA6rKUtWUQxZbuDJMBns1qf7z8fryaK1rUWdplMBd0j41Oy5X5RIFOcB7Ha7Rq9KQs4GSYUxZSwUTR1AbMZU6D2tfjLo3JUYtAQ7PXK4trQOQydeLIVVuum3ud2rj9oVUrVLw0Qh6bHpUSiLpDXKsSKyOKJDUVo9CQsHuxQUMuCy0dvzUIWlrhVItTvhegfDFC+WaINvtqLC0tbdv2A1mHRZq/JHhFAAAAAElFTkSuQmCC', 'base64'
);
const fontPath = process.platform === 'win32'
    ? path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', 'segoeui.ttf')
    : '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const images = new Map();
const pendingImages = new Map();
const mysteryImages = new Map();
const sounds = new Map();
const openingQueue = [];
let occupiedSlots = 0;
let activeWarmups = 0;
let preparingResultArtwork = false;
let artworkEncoder;
let imageCacheBytes = 0;

async function findArtworkEncoder() {
    // The bundled Linux build can encode the animation, but may lack drawtext.
    for (const executable of new Set([ffmpeg, 'ffmpeg'].filter(Boolean))) {
        const supportsText = await execute(executable, ['-hide_banner', '-filters'], { timeout: 2000, windowsHide: true })
            .then(({ stdout }) => /^\s*[TSC.]{3}\s+drawtext\s/m.test(stdout), () => false);
        if (supportsText) return executable;
    }
    return null;
}

async function prepareArtworkRenderer(destination) {
    const encoder = await (artworkEncoder ??= findArtworkEncoder());
    const hasFont = encoder ? await fs.copyFile(fontPath, destination).then(() => true, () => false) : false;
    return { encoder: hasFont ? encoder : ffmpeg, hasFont };
}

function logReelFailure(error) {
    const stderr = error.stderr?.toString().trim().split(/\r?\n/).slice(-3).join(' ');
    const reason = error.killed ? 'FFmpeg hết thời gian xử lý' : stderr || error.code || error.name;
    console.warn('Lỗi tạo GIF mở hòm:', String(reason).slice(0, 500));
}

function drainOpeningQueue() {
    while (openingQueue.length && occupiedSlots + openingQueue[0].slots <= RENDER_SLOTS) {
        const entry = openingQueue.shift();
        clearTimeout(entry.timer);
        occupiedSlots += entry.slots;
        entry.resolve(true);
    }
}

function releaseRenderSlots(slots) {
    occupiedSlots -= slots;
    drainOpeningQueue();
}

function reelMaxBytes(attachmentSizeLimit, configuredLimit) {
    return Number.isSafeInteger(attachmentSizeLimit) ? Math.min(attachmentSizeLimit, configuredLimit) : configuredLimit;
}

function reserveOpeningSlots(slots, waitMs = OPENING_QUEUE_WAIT_MS) {
    return metrics.measure('hom.render.queue', () => {
        if (openingQueue.length >= OPENING_QUEUE_LIMIT) return Promise.resolve(false);
        return new Promise(resolve => {
            const entry = { slots, resolve, timer: setTimeout(() => {
                openingQueue.splice(openingQueue.indexOf(entry), 1);
                resolve(false);
                drainOpeningQueue();
            }, waitMs) };
            openingQueue.push(entry);
            drainOpeningQueue();
        });
    });
}

function reserveArtworkSlot() {
    if (openingQueue.length || occupiedSlots >= RENDER_SLOTS) return null;
    occupiedSlots++;
    return () => releaseRenderSlots(1);
}

async function loadImage(url) {
    const source = new URL(url);
    const steam = source.hostname === 'community.akamai.steamstatic.com' && source.pathname.startsWith('/economy/image/');
    const catalogue = source.hostname === 'esm.sh' && source.pathname.startsWith('/gh/isaac-goldberg/cs2-images@');
    if (source.protocol !== 'https:' || (!steam && !catalogue)) {
        throw new Error('Unexpected CS2 image source.');
    }
    const response = await fetch(source, { signal: AbortSignal.timeout(2400), redirect: 'error' });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/png') || !response.body) {
        await response.body?.cancel().catch(() => {});
        throw new Error('Could not load a CS2 image.');
    }
    if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) {
        await response.body.cancel().catch(() => {});
        throw new Error('CS2 image exceeds the download limit.');
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > MAX_IMAGE_BYTES) throw new Error('CS2 image exceeds the download limit.');
        chunks.push(chunk);
    }
    if (!size) throw new Error('Empty CS2 image.');
    return Buffer.concat(chunks, size);
}

function findImage(url) {
    const saved = images.get(url);
    if (saved) {
        images.delete(url);
        images.set(url, saved);
    }
    return saved;
}

function readyImage(url) {
    const saved = findImage(url);
    return Buffer.isBuffer(saved) ? saved : undefined;
}

function cachedImage(url) {
    const saved = findImage(url);
    if (saved) return Promise.resolve(saved);
    if (pendingImages.has(url)) return pendingImages.get(url);
    const patternImage = getBlueGemImage(url);
    const pending = (patternImage ? Promise.resolve(patternImage) : loadImage(url)).then(image => {
        while (images.size >= MAX_CACHED_IMAGES || imageCacheBytes + image.length > MAX_IMAGE_CACHE_BYTES) {
            const oldest = images.keys().next().value;
            imageCacheBytes -= images.get(oldest).length;
            images.delete(oldest);
        }
        images.set(url, image);
        imageCacheBytes += image.length;
        return image;
    }).finally(() => pendingImages.delete(url));
    pendingImages.set(url, pending);
    return pending;
}

const thumbnailUrl = url => url.startsWith('https://community.akamai.steamstatic.com/economy/image/') ? `${url}/128fx96f` : url;
const thumbnail = url => cachedImage(thumbnailUrl(url));
const cardSource = card => card.mystery ?? card.image;

function mysteryImage(filename) {
    if (!mysteryImages.has(filename)) {
        const pending = fs.readFile(path.join(MYSTERY_DIRECTORY, filename)).catch(() =>
            filename === defaultMysteryIcon ? GOLD_MYSTERY_FALLBACK : mysteryImage(defaultMysteryIcon));
        mysteryImages.set(filename, pending);
    }
    return mysteryImages.get(filename);
}

async function warmCaseReel(urls, prizeUrls = []) {
    if (!ffmpeg || activeWarmups >= 2) return;
    const missing = [...new Set([...urls.map(thumbnailUrl), ...prizeUrls])]
        .filter(url => !images.has(url) && !pendingImages.has(url));
    if (!missing.length) return;
    activeWarmups++;
    let next = 0;
    const worker = async () => {
        while (next < missing.length) {
            await cachedImage(missing[next++]).catch(() => {});
        }
    };
    try {
        await Promise.all(Array.from({ length: 3 }, worker));
    } finally {
        activeWarmups--;
    }
}

async function collectArtwork(cards, selectedIndex, { image: prizeUrl, fallbackImage }) {
    const exactPattern = isBlueGemImage(prizeUrl);
    if (exactPattern) fallbackImage = undefined;
    const mysteryIcons = [...new Set(cards.filter(card => card.mystery).map(cardSource))];
    const art = new Map(await Promise.all(mysteryIcons.map(async icon => [icon, await mysteryImage(icon)])));
    let prize = readyImage(prizeUrl);
    let fallback = fallbackImage && readyImage(fallbackImage);
    const sources = [...new Set(cards.filter(card => !card.mystery).map(cardSource))];
    const winnerUrl = cards[selectedIndex].image;
    const needed = Math.min(sources.length + mysteryIcons.length, VISIBLE_TILES);
    for (const url of sources) {
        const image = readyImage(thumbnailUrl(url));
        if (image) art.set(url, image);
    }
    const hasStrip = () => art.size + (winnerUrl && !art.has(winnerUrl) && (prize || fallback) ? 1 : 0) >= needed;
    if (prize && hasStrip()) return { images: art, prize };

    let ready;
    const enough = new Promise(resolve => { ready = resolve; });
    const checkReady = () => {
        if (prize && hasStrip()) ready();
    };
    const tasks = [];
    if (!prize) {
        tasks.push(cachedImage(prizeUrl).then(image => {
            prize = image;
            checkReady();
        }, () => {}));
        if (fallbackImage && fallbackImage !== prizeUrl && !fallback) {
            tasks.push(cachedImage(fallbackImage).then(image => { fallback = image; }, () => {}));
        }
    }
    const needMoreTiles = !hasStrip();
    for (const url of sources) {
        if (art.has(url) || (url === winnerUrl ? prize : !needMoreTiles)) continue;
        tasks.push(thumbnail(url).then(image => {
            art.set(url, image);
            checkReady();
        }, () => {}));
    }
    let timer;
    await Promise.race([
        enough,
        Promise.allSettled(tasks),
        new Promise(resolve => { timer = setTimeout(resolve, ASSET_WAIT_MS); })
    ]);
    clearTimeout(timer);
    return { images: new Map(art), prize: prize ?? fallback ?? (exactPattern ? TRANSPARENT_PIXEL : undefined) };
}

function groupTiles(cards) {
    const groups = new Map();
    for (const [position, card] of cards.entries()) {
        const key = `${cardSource(card)}|${card.color}`;
        if (!groups.has(key)) groups.set(key, { card, positions: [] });
        groups.get(key).positions.push(position);
    }
    return [...groups.values()];
}

function landingDistance(cardCount, selectedIndex, tileWidth, landingSeed) {
    const width = tileWidth * VISIBLE_TILES;
    const tileCenter = selectedIndex * tileWidth + tileWidth / 2;
    // Pick a landing point with space between the marker and both edges of the winning tile.
    const offsetLimit = tileWidth / 2 - 8;
    const offset = Number.isInteger(landingSeed) && landingSeed >= 0 && landingSeed <= 0xffffffff
        ? landingSeed % (offsetLimit * 2 + 1) - offsetLimit
        : randomInt(-offsetLimit, offsetLimit + 1);
    const landing = tileCenter + offset;
    return Math.max(0, Math.min(landing - width / 2, cardCount * tileWidth - width));
}

function caseSound(name) {
    if (!sounds.has(name)) {
        const pending = fs.readFile(path.join(SOUND_DIRECTORY, `${name}.pcm`))
            .then(buffer => {
                if (BIG_ENDIAN) buffer.swap16();
                return new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2);
            })
            .catch(error => {
                sounds.delete(name);
                throw error;
            });
        sounds.set(name, pending);
    }
    return sounds.get(name);
}

async function reelAudio(stop, tier, revealAt) {
    const [revealName, revealGain] = REVEAL_SOUNDS[tier] ?? REVEAL_SOUNDS[0];
    const [unlock, ticker, reveal] = await Promise.all([
        caseSound('case_unlock_01'), caseSound('crate_item_scroll'), caseSound(revealName)
    ]);
    const samples = new Float32Array(revealAt * SAMPLES_PER_CS + reveal.length);
    const play = (clip, time, gain) => {
        const start = time * SAMPLES_PER_CS;
        const length = Math.min(samples.length - start, clip.length);
        for (let sample = 0; sample < length; sample++) {
            samples[start + sample] += clip[sample] * gain;
        }
    };

    play(unlock, 0, 0.5);
    play(ticker, 0, 0.2);
    let current = Math.floor(SCENE_WIDTH / 2 / TILE_WIDTH);
    for (let elapsed = FRAME_DELAY_CS; elapsed <= SCROLL_CS; elapsed += FRAME_DELAY_CS) {
        const offset = Math.round(stop * (1 - (1 - elapsed / SCROLL_CS) ** SCROLL_EASING));
        const next = Math.floor((offset + SCENE_WIDTH / 2) / TILE_WIDTH);
        if (next === current) continue;
        play(ticker, elapsed, 0.2);
        current = next;
    }
    play(reveal, revealAt, revealGain);

    const pcm = new Int16Array(samples.length);
    for (let sample = 0; sample < samples.length; sample++) {
        pcm[sample] = Math.round(Math.max(-32768, Math.min(samples[sample], 32767)));
    }
    const audio = Buffer.from(pcm.buffer);
    return BIG_ENDIAN ? audio.swap16() : audio;
}

function executeWithInput(args, input, options) {
    const command = execute(ffmpeg, args, options);
    command.child.stdin.on('error', () => {});
    command.child.stdin.end(input);
    return command;
}

async function encodeReelAudio(stop, tier, revealAt) {
    const pcm = await reelAudio(stop, tier, revealAt);
    const { stdout } = await executeWithInput([
        '-hide_banner', '-loglevel', 'error', '-f', 's16le', '-ar', String(SAMPLE_RATE),
        '-ac', String(AUDIO_CHANNELS), '-i', 'pipe:0', '-c:a', 'libopus', '-ar', '48000',
        '-b:a', '64k', '-compression_level', '3', '-f', 'ogg', 'pipe:1'
    ], pcm, { encoding: 'buffer', timeout: 2200, maxBuffer: 256000, windowsHide: true });
    return stdout.length ? stdout : null;
}

async function renderResultArtwork(url) {
    if (!ffmpeg || preparingResultArtwork) return null;
    preparingResultArtwork = true;
    let release;
    try {
        const image = await cachedImage(url);
        if (image.length < 24 || image.toString('ascii', 12, 16) !== 'IHDR') return null;
        const width = image.readUInt32BE(16);
        const height = image.readUInt32BE(20);
        if (!width || !height || width * height > 1024 * 1024) return null;
        release = reserveArtworkSlot();
        if (!release) return null;

        const decode = ['-hide_banner', '-i', 'pipe:0'];
        const options = { encoding: 'buffer', timeout: 1500, maxBuffer: 1024 * 1024, windowsHide: true };
        const { stderr } = await executeWithInput([...decode, '-loglevel', 'info', '-vf', 'format=rgba,alphaextract,bbox=min_val=4',
            '-frames:v', '1', '-f', 'null', '-'], image, options);
        const match = /x1:(\d+) x2:(\d+) y1:(\d+) y2:(\d+)/.exec(stderr.toString());
        if (!match) return null;

        const [, left, right, top, bottom] = match.map(Number);
        const padding = 16;
        const x = Math.max(0, left - padding);
        const y = Math.max(0, top - padding);
        const croppedWidth = Math.min(width, right + padding + 1) - x;
        const croppedHeight = Math.min(height, bottom + padding + 1) - y;
        if (width - croppedWidth < 32 && height - croppedHeight < 32) return null;

        const { stdout } = await executeWithInput([...decode, '-loglevel', 'error', '-vf',
            `format=rgba,crop=${croppedWidth}:${croppedHeight}:${x}:${y}:exact=1`,
            '-frames:v', '1', '-compression_level', '3', '-c:v', 'png', '-f', 'image2pipe', 'pipe:1'], image, options);
        return stdout.length ? stdout : null;
    } catch {
        return null;
    } finally {
        release?.();
        preparingResultArtwork = false;
    }
}

function scrollExpression(stop, scrollFrames = SCROLL_FRAMES) {
    return `${stop}*(1-pow(1-n/${scrollFrames},${SCROLL_EASING}))`;
}

function goldStageFilters(tiles, scale) {
    const inputs = GOLD_STAGES.map((_, index) => `[hold${index}]`).join('');
    return [`[mystery]split=${GOLD_STAGES.length}${inputs}`, ...GOLD_STAGES.flatMap(({ opacity, border, progress }, index) => {
        const highlights = tiles.flatMap(({ x, y, width, height }) => [
            `drawbox=x=${x}:y=${y}:w=${width}:h=${height}:color=0xffbe36@${opacity}:t=fill`,
            `drawbox=x=${x}:y=${y}:w=${width}:h=${height}:color=0xffdd78:t=${border}`,
            `drawbox=x=${x}:y=${y + height - 4}:w=${Math.round(width * progress)}:h=4:color=0xffedab:t=fill`
        ]).join(',');
        return [
            `[hold${index}]${highlights}${scale},split[glow${index}][glowColors${index}]`,
            `[glowColors${index}]palettegen=max_colors=128[glowPalette${index}]`,
            `[glow${index}][glowPalette${index}]paletteuse=dither=none[gold${index}]`
        ];
    })];
}

function revealFilter(rare, { frameDelay, scrollFrames } = DEFAULT_TIMING) {
    const stages = rare ? GOLD_STAGES.map(({ time }) => time) : [];
    const gold = stages.map((_, index) => `[gold${index}]`).join('');
    const times = [...stages, rare ? RARE_REVEAL_CS : REVEAL_CS];
    const timestamps = times.reduce((expression, time, index) =>
        `if(eq(N,${scrollFrames + 1 + index}),${time},${expression})`, `N*${frameDelay}`);
    return `[reel]${gold}[landed]concat=n=${times.length + 1}:v=1:a=0,settb=1/100,setpts='${timestamps}'[visual]`;
}

function reelFilter(groups, cardCount, stop, selectedIndex, result, hasFont, rare, compact) {
    const scroll = scrollExpression(stop);
    const scale = compact ? COMPACT_REEL_SCALE : '';
    const layout = Array.from({ length: cardCount }, (_, index) => `${index * TILE_WIDTH}_0`).join('|');
    const inputs = Array.from({ length: cardCount }, (_, index) => `[card${index}]`).join('');
    const tiles = groups.map(({ card, positions }, index) => {
        const outputs = positions.map(position => `[card${position}]`).join('');
        const split = positions.length > 1 ? `,split=${positions.length}` : '';
        const size = card.mystery ? '84:68' : `${PREVIEW_WIDTH}:${PREVIEW_HEIGHT}`;
        return `color=c=0x292e39:s=${TILE_WIDTH}x${HEIGHT}:r=${FRAME_RATE}:d=${1 / FRAME_RATE}[background${index}];` +
            `[${index}:v]format=rgba,scale=${size}:force_original_aspect_ratio=decrease:flags=lanczos[skin${index}];` +
            `[background${index}][skin${index}]overlay=(W-w)/2:(H-h)/2:shortest=1:format=rgb,` +
            `drawbox=x=0:y=0:w=2:h=ih:color=0x171b24:t=fill,` +
            `drawbox=x=2:y=ih-6:w=iw-2:h=6:color=0x${card.color.slice(1)}:t=fill${split}${outputs}`;
    });
    const titleSize = Math.min(21, Math.floor((SCENE_WIDTH - 28) / (result.title.length * 0.65)));
    const labels = hasFont
        ? `,drawtext=fontfile=result.ttf:textfile=title.txt:expansion=none:fontsize=${titleSize}:fontcolor=0xf4f5f8:x=(w-tw)/2:y=199` +
            ',drawtext=fontfile=result.ttf:textfile=detail.txt:expansion=none:fontsize=15:fontcolor=0xc5cbd8:x=(w-tw)/2:y=228'
        : '';
    return [
        ...tiles,
        // Scrolling and stopped frames share the same winning tile, including its gold artwork.
        `${inputs}xstack=inputs=${cardCount}:layout=${layout},format=rgb24,${rare ? 'split=3[strip][colors][still]' : 'split[strip][colors]'}`,
        `[strip]loop=loop=${SCROLL_FRAMES}:size=1:start=0,` +
            `settb=1/100,setpts=N*${FRAME_DELAY_CS},crop=${SCENE_WIDTH}:${HEIGHT}:x='round(${scroll})':y=0:exact=1,` +
            'drawbox=x=iw/2-1:y=0:w=3:h=ih:color=0xe8c77b:t=fill,' +
            `pad=${SCENE_WIDTH}:${SCENE_HEIGHT}:0:(oh-ih)/2:color=${SCENE_BACKGROUND}${scale}[frames]`,
        `color=c=${SCENE_BACKGROUND}:s=${SCENE_WIDTH}x${SCENE_HEIGHT}:r=${FRAME_RATE}:d=${1 / FRAME_RATE}[finishBackground]`,
        `[${groups.length}:v]format=rgba,scale=420:${PRIZE_HEIGHT}:force_original_aspect_ratio=decrease:flags=lanczos[prize]`,
        `[finishBackground][prize]overlay=(W-w)/2:(${PRIZE_HEIGHT + 6}-h)/2:shortest=1:format=rgb,` +
            `drawbox=x=0:y=ih-4:w=iw:h=4:color=0x${result.color.slice(1)}:t=fill${labels}${scale},split[finish][finishColors]`,
        '[colors]drawbox=x=0:y=0:w=3:h=ih:color=0xe8c77b:t=fill,' +
            `pad=iw:ih+2:0:0:color=${SCENE_BACKGROUND},palettegen=max_colors=52[palette]`,
        '[frames][palette]paletteuse=dither=none:diff_mode=rectangle[reel]',
        '[finishColors]palettegen=max_colors=256[finishPalette]',
        '[finish][finishPalette]paletteuse=dither=bayer:bayer_scale=4[landed]',
        ...(rare ? [
            `[still]crop=${SCENE_WIDTH}:${HEIGHT}:x=${Math.round(stop)}:y=0:exact=1,` +
                'drawbox=x=iw/2-1:y=0:w=3:h=ih:color=0xe8c77b:t=fill,' +
                `pad=${SCENE_WIDTH}:${SCENE_HEIGHT}:0:(oh-ih)/2:color=${SCENE_BACKGROUND}[mystery]`,
            ...goldStageFilters([{ x: selectedIndex * TILE_WIDTH - Math.round(stop) + 2,
                y: (SCENE_HEIGHT - HEIGHT) / 2 + 1, width: TILE_WIDTH - 3, height: HEIGHT - 2 }], scale)
        ] : []),
        revealFilter(rare)
    ].join(';');
}

async function prepareReelArtwork(cards, selectedIndex, result) {
    const { images: art, prize } = await collectArtwork(cards, selectedIndex, result);
    const winnerUrl = cards[selectedIndex].image;
    const prizeArt = prize ?? art.get(winnerUrl);
    if (!prizeArt) return null;
    if (winnerUrl && prize && !art.has(winnerUrl)) art.set(winnerUrl, prize);
    const available = cards.filter(card => !card.mystery && art.has(card.image));
    const visibleCards = cards.map((card, index) => index === selectedIndex || art.has(cardSource(card))
        ? card : available[index % available.length] ?? card);
    return { art, prizeArt, visibleCards };
}

async function encodeReelGif(encoder, directory, pictures, filterArgs, timeout, maxBuffer, { frameRate } = DEFAULT_TIMING) {
    const { stdout } = await execute(encoder, [
        '-hide_banner', '-loglevel', 'error', '-filter_threads', '1', '-filter_complex_threads', '1',
        ...pictures.flatMap(file => ['-threads', '1', '-framerate', String(frameRate), '-i', file]),
        ...filterArgs, '-map', '[visual]', '-threads', '1', '-fps_mode', 'passthrough', '-enc_time_base', '1:100',
        '-final_delay', String(RESULT_FRAME_DELAY_CS), '-loop', '-1', '-f', 'gif', 'pipe:1'
    ], { cwd: directory, encoding: 'buffer', timeout, maxBuffer, windowsHide: true });
    return stdout.length ? stdout : null;
}

async function renderCaseReel(cards, selectedIndex, result, withSound = false, landingSeed, attachmentSizeLimit) {
    const slots = withSound ? RENDER_SLOTS : 1;
    const maxBytes = reelMaxBytes(attachmentSizeLimit, SINGLE_MAX_BYTES);
    if (!ffmpeg || maxBytes <= 0 || !(await reserveOpeningSlots(slots))) return null;
    let directory;
    let files = [];
    let audioTask;
    try {
        const stop = landingDistance(cards.length, selectedIndex, TILE_WIDTH, landingSeed);
        const rare = Boolean(cards[selectedIndex].mystery);
        const media = { gif: null, audio: null };
        if (withSound) {
            // Voice reads this after the GIF upload. A slow encode cannot hold up the animation.
            audioTask = encodeReelAudio(stop, result.tier, rare ? RARE_REVEAL_CS : REVEAL_CS)
                .then(audio => { media.audio = audio; }, () => {});
            media.audioReady = audioTask;
        }
        const artwork = await prepareReelArtwork(cards, selectedIndex, result);
        if (!artwork) return null;
        const { art, prizeArt, visibleCards } = artwork;
        const groups = groupTiles(visibleCards);
        directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-cs2-reel-'));
        const pictureFiles = groups.map((_, index) => path.join(directory, `${index}.png`));
        const prizeFile = path.join(directory, 'prize.png');
        const titleFile = path.join(directory, 'title.txt');
        const detailFile = path.join(directory, 'detail.txt');
        const resultFont = path.join(directory, 'result.ttf');
        files = [...pictureFiles, prizeFile, titleFile, detailFile, resultFont];
        const renderer = prepareArtworkRenderer(resultFont);
        const writes = await Promise.allSettled([
            ...pictureFiles.map((file, index) => fs.writeFile(file, art.get(cardSource(groups[index].card)) ?? TRANSPARENT_PIXEL)),
            fs.writeFile(prizeFile, prizeArt),
            fs.writeFile(titleFile, result.title),
            fs.writeFile(detailFile, result.detail)
        ]);
        const { encoder, hasFont } = await renderer;
        const failed = writes.find(write => write.status === 'rejected');
        if (failed) throw failed.reason;
        const encode = compact => {
            const filter = reelFilter(groups, visibleCards.length, stop, selectedIndex, result, hasFont, rare, compact);
            return encodeReelGif(encoder, directory, [...pictureFiles, prizeFile], ['-filter_complex', filter], 5500, maxBytes);
        };
        try {
            media.gif = await encode(false);
        } catch (error) {
            if (error.code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw error;
            media.gif = await encode(true);
        }
        return media.gif ? media : null;
    } catch (error) {
        logReelFailure(error);
        return null;
    } finally {
        // Keep the concurrency slot until both FFmpeg processes have finished.
        if (audioTask) void audioTask.then(() => releaseRenderSlots(slots));
        else releaseRenderSlots(slots);
        if (directory) {
            await Promise.allSettled(files.map(file => fs.unlink(file)));
            await fs.rmdir(directory).catch(() => {});
        }
    }
}

function batchResultText(result, layout) {
    // The rarity stripe and subtitle carry the knife/glove star in this panel.
    const title = result.title.replace('★ ', '');
    const detail = result.detail.split(' · Float ', 1)[0];
    const wrapAt = layout.card?.wrapAt;
    if (wrapAt && title.length > wrapAt) {
        // Keep the weapon and finish on separate lines when the name is long.
        const linePattern = new RegExp(`.{1,${wrapAt}}(?:\\s+|$)|\\S+(?:\\s+|$)`, 'gu');
        const lines = title.split(' | ').flatMap(part => part.match(linePattern) ?? [part])
            .map(line => line.trimEnd());
        const [first, second, ...rest] = lines;
        return { ...result, title: [first, second, rest.join(' ')].filter(Boolean).join('\n'), detail };
    }
    const lineLength = layout.columns > 1 ? 28 : 32;
    const breakAt = title.length > lineLength ? title.lastIndexOf(' ', lineLength) : -1;
    return {
        ...result,
        title: breakAt > 0 ? `${title.slice(0, breakAt)}\n${title.slice(breakAt + 1)}` : title,
        detail
    };
}

function batchFilter(rounds, layout, hasFont, compact = false, timing = DEFAULT_TIMING) {
    const inputs = new Map();
    const tiles = new Map();
    const scale = compact ? COMPACT_REEL_SCALE : '';
    const highlighted = [];
    const { columns, gap, tileWidth, tileHeight, rowHeight, card: resultCard, tileArtwork } = layout;
    const { frameDelay, frameRate, scrollFrames } = timing;
    const width = tileWidth * VISIBLE_TILES;
    const twoColumns = columns > 1;
    const prizeWidth = resultCard?.width ?? (twoColumns ? 86 : 124);
    const prizeHeight = resultCard?.height ?? (twoColumns ? 46 : 68);
    const textX = prizeWidth + (twoColumns ? 14 : 20);
    const rowPositions = rounds.map((_, index) => ({
        x: index % columns * (width + gap), y: Math.floor(index / columns) * rowHeight
    }));
    const getInput = image => {
        if (!inputs.has(image)) inputs.set(image, { index: inputs.size, outputs: [] });
        return inputs.get(image);
    };
    const readInput = input => {
        const label = `[image${input.index}_${input.outputs.length}]`;
        input.outputs.push(label);
        return label;
    };
    const rows = rounds.map(({ art, prizeArt, visibleCards, selectedIndex, stop, result }, row) => {
        const cardLabels = visibleCards.map((card, position) => {
            const input = getInput(art.get(cardSource(card)) ?? TRANSPARENT_PIXEL);
            const key = `${input.index}|${card.color}|${Boolean(card.mystery)}`;
            if (!tiles.has(key)) {
                tiles.set(key, { index: tiles.size, input: readInput(input), card, outputs: [] });
            }
            const label = `[card${row}_${position}]`;
            tiles.get(key).outputs.push(label);
            return label;
        });
        const stripLayout = visibleCards.map((_, position) => `${position * tileWidth}_0`).join('|');
        const prize = readInput(getInput(prizeArt));
        const titleLines = result.title.split('\n');
        const wrapped = titleLines.length > 1;
        const longestLine = Math.max(...titleLines.map(line => line.length));
        const textWidth = width - textX - 6;
        const titleSize = resultCard ? Math.min(titleLines.length === 3 ? resultCard.threeLineSize : resultCard.titleSize,
            Math.max(1, Math.floor(textWidth / (longestLine * 0.58))))
            : twoColumns ? Math.min(12, Math.floor(textWidth / (longestLine * 0.66))) : 15;
        const detailSize = resultCard ? Math.min(resultCard.detailSize, Math.max(1, Math.floor(textWidth / (result.detail.length * 0.59))))
            : twoColumns ? 9 : 12;
        const lineSpacing = resultCard ? 1 : 3;
        const titleHeight = titleLines.length * Math.ceil(titleSize * 1.25) + (titleLines.length - 1) * lineSpacing;
        const titleY = resultCard ? Math.floor((tileHeight - titleHeight - detailSize - 5) / 2)
            : twoColumns ? (wrapped ? 7 : 14) : (wrapped ? 12 : 22);
        const detailY = resultCard ? titleY + titleHeight + 5 : twoColumns ? (wrapped ? 39 : 34) : (wrapped ? 55 : 48);
        const labels = hasFont
            ? `,drawtext=fontfile=result.ttf:textfile=title${row}.txt:expansion=none:fontsize=${titleSize}:line_spacing=${lineSpacing}:fontcolor=0xf4f5f8:x=${textX}:y=${titleY}` +
                `,drawtext=fontfile=result.ttf:textfile=detail${row}.txt:expansion=none:fontsize=${detailSize}:fontcolor=0xc5cbd8:x=${textX}:y=${detailY}`
            : '';
        const rare = Boolean(visibleCards[selectedIndex].mystery);
        if (rare) highlighted.push({ x: rowPositions[row].x + selectedIndex * tileWidth - Math.round(stop) + 2,
            y: rowPositions[row].y + 1, width: tileWidth - 3, height: tileHeight - 2 });
        return [
            `${cardLabels.join('')}xstack=inputs=${cardLabels.length}:layout=${stripLayout},format=rgb24` +
                (rare ? `,split[strip${row}][still${row}]` : `[strip${row}]`),
            `[strip${row}]loop=loop=${scrollFrames}:size=1:start=0,settb=1/100,setpts=N*${frameDelay},` +
                `crop=${width}:${tileHeight}:x='round(${scrollExpression(stop, scrollFrames)})':y=0:exact=1,` +
                'drawbox=x=iw/2-1:y=0:w=3:h=ih:color=0xe8c77b:t=fill,' +
                `pad=${width}:${rowHeight}:0:0:color=${SCENE_BACKGROUND}[track${row}]`,
            `color=c=0x292e39:s=${width}x${tileHeight}:r=${frameRate}:d=${1 / frameRate}[prizeBg${row}]`,
            `${prize}format=rgba,scale=${prizeWidth}:${prizeHeight}:force_original_aspect_ratio=decrease:flags=lanczos[prizeArt${row}]`,
            `[prizeBg${row}][prizeArt${row}]overlay=10+(${prizeWidth}-w)/2:(H-h)/2:shortest=1:format=rgb,` +
                `drawbox=x=0:y=0:w=4:h=ih:color=0x${result.color.slice(1)}:t=fill${labels},` +
                `pad=${width}:${rowHeight}:0:0:color=${SCENE_BACKGROUND}[result${row}]`,
            ...(rare ? [`[still${row}]crop=${width}:${tileHeight}:x=${Math.round(stop)}:y=0:exact=1,` +
                'drawbox=x=iw/2-1:y=0:w=3:h=ih:color=0xe8c77b:t=fill,' +
                `pad=${width}:${rowHeight}:0:0:color=${SCENE_BACKGROUND}[mystery${row}]`] : [])
        ];
    });
    const tileFilters = [...tiles.values()].map(({ index, input, card, outputs }) => {
        const size = tileArtwork ? tileArtwork[card.mystery ? 'rare' : 'normal']
            : twoColumns ? (card.mystery ? '50:44' : '44:35') : (card.mystery ? '76:61' : '60:48');
        return `color=c=0x292e39:s=${tileWidth}x${tileHeight}:r=${frameRate}:d=${1 / frameRate}[tileBg${index}];` +
            `${input}format=rgba,scale=${size}:force_original_aspect_ratio=decrease:flags=lanczos[tileArt${index}];` +
            `[tileBg${index}][tileArt${index}]overlay=(W-w)/2:(H-h)/2:shortest=1:format=rgb,` +
            'drawbox=x=0:y=0:w=2:h=ih:color=0x171b24:t=fill,' +
            `drawbox=x=2:y=ih-5:w=iw-2:h=5:color=0x${card.color.slice(1)}:t=fill,` +
            `split=${outputs.length + 1}${outputs.join('')}[tileColor${index}]`;
    });
    const inputFilters = [...inputs.values()].map(({ index, outputs }) => {
        const split = outputs.length === 1 ? 'null' : `split=${outputs.length}`;
        return `[${index}:v]${split}${outputs.join('')}`;
    });
    const colors = [...tiles.values()].map(({ index }) => `[tileColor${index}]`).join('');
    const colorStack = tiles.size === 1 ? 'null' : `hstack=inputs=${tiles.size}`;
    const stack = twoColumns
        ? `xstack=inputs=${rounds.length}:layout=${rowPositions.map(({ x, y }) => `${x}_${y}`).join('|')}:fill=${SCENE_BACKGROUND}`
        : `vstack=inputs=${rounds.length}`;
    const stackRows = kind => rounds.map((_, row) => `[${kind}${row}]`).join('') + stack;
    const rare = highlighted.length > 0;
    const filter = [
        ...inputFilters, ...tileFilters, ...rows.flat(),
        `${colors}${colorStack},drawbox=x=0:y=0:w=3:h=ih:color=0xe8c77b:t=fill,` +
            `pad=iw:ih+2:0:0:color=${SCENE_BACKGROUND},palettegen=max_colors=48[palette]`,
        `${stackRows('track')}${scale}[frames]`,
        ...(rare ? rounds.flatMap(({ visibleCards, selectedIndex }, row) => visibleCards[selectedIndex].mystery
            ? [`[result${row}]null[final${row}]`]
            : [`[result${row}]split[final${row}][mystery${row}]`]) : []),
        `${stackRows(rare ? 'final' : 'result')}${scale},split[finish][finishColors]`,
        '[frames][palette]paletteuse=dither=none:diff_mode=rectangle[reel]',
        '[finishColors]palettegen=max_colors=256[finishPalette]',
        '[finish][finishPalette]paletteuse=dither=bayer:bayer_scale=4[landed]',
        ...(rare ? [`${stackRows('mystery')}[mystery]`, ...goldStageFilters(highlighted, scale)] : []),
        revealFilter(rare, timing)
    ].join(';');
    return { filter, pictures: [...inputs.keys()] };
}

async function renderCaseBatch(rounds, attachmentSizeLimit, options = {}) {
    const maxBytes = reelMaxBytes(attachmentSizeLimit, BATCH_MAX_BYTES);
    const battle = options?.profile === 'battle';
    const fullWidth = battle && options.fullWidth === true;
    const supported = battle ? rounds.length >= 2 && rounds.length <= (fullWidth ? 3 : 10) : [2, 3, 4, 5, 10].includes(rounds.length);
    if (!ffmpeg || maxBytes <= 0 || !supported) return null;
    const timing = battle ? BATTLE_TIMING : DEFAULT_TIMING;
    // Battle GIFs are lighter and use one bounded lane, allowing two rooms to prepare together.
    const slots = battle ? 1 : RENDER_SLOTS;
    if (!(await reserveOpeningSlots(slots, battle ? BATTLE_QUEUE_WAIT_MS : OPENING_QUEUE_WAIT_MS))) return null;
    const layout = fullWidth ? FULL_WIDTH_BATTLE_LAYOUT : rounds.length <= 5 ? BATCH_LAYOUT : battle ? LARGE_BATTLE_LAYOUT : LARGE_BATCH_LAYOUT;
    let directory;
    const files = new Map();
    try {
        const prepared = await Promise.all(rounds.map(async ({ cards, selectedIndex, result, landingSeed }) => {
            const artwork = await prepareReelArtwork(cards, selectedIndex, result);
            return artwork && { ...artwork, selectedIndex, result: batchResultText(result, layout),
                stop: landingDistance(cards.length, selectedIndex, layout.tileWidth, landingSeed) };
        }));
        if (prepared.some(round => !round)) return null;
        directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-cs2-batch-'));
        const font = path.join(directory, 'result.ttf');
        const { encoder, hasFont } = await prepareArtworkRenderer(font);
        const { filter, pictures } = batchFilter(prepared, layout, hasFont, false, timing);
        const pictureNames = pictures.map((image, index) => {
            const name = `${index}.png`;
            files.set(name, image);
            return name;
        });
        for (const [index, { result }] of prepared.entries()) {
            files.set(`title${index}.txt`, result.title);
            files.set(`detail${index}.txt`, result.detail);
        }
        // Store the graph on disk to keep the Windows command line short.
        files.set('batch.txt', filter);
        const writes = await Promise.allSettled([...files].map(([name, data]) => fs.writeFile(path.join(directory, name), data)));
        const failed = writes.find(write => write.status === 'rejected');
        if (failed) throw failed.reason;
        const encode = () => encodeReelGif(encoder, directory, pictureNames, ['-filter_complex_script', 'batch.txt'], 8000, maxBytes, timing);
        let gif;
        try {
            gif = await encode();
        } catch (error) {
            if (error.code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw error;
            await fs.writeFile(path.join(directory, 'batch.txt'), batchFilter(prepared, layout, hasFont, true, timing).filter);
            gif = await encode();
        }
        return gif ? { gif } : null;
    } catch (error) {
        logReelFailure(error);
        return null;
    } finally {
        releaseRenderSlots(slots);
        if (directory) {
            await Promise.allSettled(['result.ttf', ...files.keys()].map(name => fs.unlink(path.join(directory, name))));
            await fs.rmdir(directory).catch(() => {});
        }
    }
}

const renderBatchCached = createBattleRenderCache(renderCaseBatch);

module.exports = {
    warmCaseReel,
    renderCaseReel: (...args) => metrics.measure('hom.render.single', () => renderCaseReel(...args), metrics.mediaBytes),
    renderCaseBatch: (...args) => metrics.measure('hom.render.batch', () => renderBatchCached(...args), metrics.mediaBytes),
    renderResultArtwork, cachedImage, prepareArtworkRenderer, reserveArtworkSlot,
    REEL_REVEAL_MS, REEL_PLAYBACK_MS, RARE_REEL_PLAYBACK_MS
};
