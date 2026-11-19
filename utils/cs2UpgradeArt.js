const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { crc32, deflateSync } = require('node:zlib');
const ffmpeg = require('ffmpeg-static');
const reel = require('./cs2Reel');

const execute = promisify(execFile);
const WIDTH = 400;
const HEIGHT = 360;
const FPS = 20;
const SPIN_FRAMES = 48;
const HOLD_FRAMES = 12;
const FRAME_COUNT = SPIN_FRAMES + HOLD_FRAMES;
const MAX_BYTES = 2_000_000;
const TICKETS = 100_000;
const CENTER_X = WIDTH / 2;
const CENTER_Y = 184;
const TWO_PI = Math.PI * 2;
const COLORS = {
    background: [18, 19, 29], panel: [25, 26, 39], track: [53, 51, 70], arc: [149, 92, 246],
    text: [244, 241, 255], muted: [153, 153, 176], win: [141, 237, 191], loss: [255, 148, 167]
};
const FONT = {
    '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
    '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
    '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
    '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
    '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
    '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
    '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
    '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
    A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
    D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
    E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
    G: ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
    H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
    I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
    L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
    N: ['10001', '11001', '11001', '10101', '10011', '10011', '10001'],
    O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
    R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
    S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
    T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
    V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
    W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
    '%': ['11001', '11010', '00010', '00100', '01000', '01011', '10011'],
    '.': ['00000', '00000', '00000', '00000', '00000', '00100', '00100']
};

function validRound(round) {
    if (!round || typeof round !== 'object' || !Number.isInteger(round.ticket) || round.ticket < 1 || round.ticket > TICKETS ||
        !Number.isInteger(round.winTickets) || round.winTickets < 1 || round.winTickets > TICKETS) return null;
    const direction = round.direction ?? 'under';
    if (direction !== 'under' && direction !== 'over') return null;
    if (round.startTicket !== undefined && (!Number.isInteger(round.startTicket) || round.startTicket < 0 || round.startTicket >= TICKETS)) return null;
    const startTicket = round.startTicket ?? (direction === 'over' ? TICKETS - round.winTickets : 0);
    const won = (round.ticket - 1 - startTicket + TICKETS) % TICKETS < round.winTickets;
    if (round.won !== undefined && round.won !== won) return null;
    return { ticket: round.ticket, winTickets: round.winTickets, direction, startTicket,
        customRange: round.startTicket !== undefined, won };
}

function pixel(pixels, x, y, color, alpha = 1) {
    if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
    const offset = (y * WIDTH + x) * 3;
    for (let channel = 0; channel < 3; channel++) {
        pixels[offset + channel] = Math.round(pixels[offset + channel] * (1 - alpha) + color[channel] * alpha);
    }
}

function text(pixels, value, top, scale, color) {
    let left = Math.floor((WIDTH - (value.length * 6 - 1) * scale) / 2);
    for (const character of value) {
        const glyph = FONT[character];
        if (glyph) for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++) {
            if (glyph[y][x] !== '1') continue;
            for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
                pixel(pixels, left + x * scale + dx, top + y * scale + dy, color);
            }
        }
        left += 6 * scale;
    }
}

function wheel(round) {
    const pixels = Buffer.alloc(WIDTH * HEIGHT * 3);
    const arcLength = round.winTickets / TICKETS;
    const arcStart = round.startTicket / TICKETS;
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
        const dx = x + 0.5 - CENTER_X;
        const dy = y + 0.5 - CENTER_Y;
        const radius = Math.hypot(dx, dy);
        const background = y >= 52 && y < 316 ? COLORS.panel : COLORS.background;
        pixel(pixels, x, y, background);
        if (radius < 94 || radius > 118) continue;
        const fraction = ((Math.atan2(dx, -dy) / TWO_PI) + 1) % 1;
        const winning = (fraction - arcStart + 1) % 1 < arcLength;
        const edge = Math.min(1, radius - 94, 118 - radius);
        pixel(pixels, x, y, winning ? COLORS.arc : COLORS.track, Math.max(0, edge));
    }
    text(pixels, 'UPGRADE', 17, 3, COLORS.text);
    text(pixels, `${(round.winTickets / 1000).toFixed(3)}%`, 161, 4, COLORS.text);
    text(pixels, 'WIN CHANCE', 201, 1, COLORS.muted);
    const threshold = round.direction === 'under' ? round.winTickets : TICKETS - round.winTickets;
    const rangeLabel = round.customRange
        ? `${String(round.startTicket + 1).padStart(6, '0')} TO ${String((round.startTicket + round.winTickets - 1) % TICKETS + 1).padStart(6, '0')}`
        : `${round.direction.toUpperCase()} ${String(threshold).padStart(6, '0')}`;
    text(pixels, rangeLabel, 329, 2, COLORS.muted);
    return pixels;
}

function pointer(pixels, angle, color) {
    const point = (radius, offset = 0) => [CENTER_X + Math.sin(angle + offset) * radius, CENTER_Y - Math.cos(angle + offset) * radius];
    const vertices = [point(91), point(130, -0.055), point(130, 0.055)];
    const [a, b, c] = vertices;
    const edge = (first, second, x, y) => (second[0] - first[0]) * (y - first[1]) - (second[1] - first[1]) * (x - first[0]);
    const left = Math.max(0, Math.floor(Math.min(...vertices.map(v => v[0]))));
    const right = Math.min(WIDTH - 1, Math.ceil(Math.max(...vertices.map(v => v[0]))));
    const top = Math.max(0, Math.floor(Math.min(...vertices.map(v => v[1]))));
    const bottom = Math.min(HEIGHT - 1, Math.ceil(Math.max(...vertices.map(v => v[1]))));
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
        const edges = [edge(a, b, x + 0.5, y + 0.5), edge(b, c, x + 0.5, y + 0.5), edge(c, a, x + 0.5, y + 0.5)];
        if (edges.every(value => value >= 0) || edges.every(value => value <= 0)) pixel(pixels, x, y, color);
    }
}

function finalFrame(base, round) {
    const pixels = Buffer.from(base);
    // Bin centers keep boundary tickets on their mathematically correct side.
    pointer(pixels, (round.ticket - 0.5) / TICKETS * TWO_PI, round.won ? COLORS.win : COLORS.loss);
    text(pixels, round.won ? 'WIN' : 'LOSS', 230, 2, round.won ? COLORS.win : COLORS.loss);
    text(pixels, `ROLL ${String(round.ticket).padStart(6, '0')}`, 310, 2, COLORS.text);
    return pixels;
}

function pngChunk(type, data) {
    const result = Buffer.alloc(12 + data.length);
    result.writeUInt32BE(data.length);
    result.write(type, 4, 'ascii');
    data.copy(result, 8);
    result.writeUInt32BE(crc32(result.subarray(4, -4)), result.length - 4);
    return result;
}

function png(pixels) {
    const stride = WIDTH * 3;
    const scanlines = Buffer.alloc((stride + 1) * HEIGHT);
    for (let row = 0; row < HEIGHT; row++) pixels.copy(scanlines, row * (stride + 1) + 1, row * stride, (row + 1) * stride);
    const header = Buffer.alloc(13);
    header.writeUInt32BE(WIDTH);
    header.writeUInt32BE(HEIGHT, 4);
    header[8] = 8;
    header[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(scanlines)), pngChunk('IEND', Buffer.alloc(0))]);
}

async function renderUpgrade(input, attachmentSizeLimit = MAX_BYTES) {
    const round = validRound(input);
    if (!round || !ffmpeg || !Number.isSafeInteger(attachmentSizeLimit) || attachmentSizeLimit <= 0) return null;
    const release = reel.reserveArtworkSlot();
    if (!release) return null;
    let directory;
    try {
        directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-cs2-upgrade-'));
        const frames = await fs.open(path.join(directory, 'frames.rgb'), 'w');
        const base = wheel(round);
        const last = finalFrame(base, round);
        try {
            for (let frame = 0; frame < FRAME_COUNT; frame++) {
                let pixels = last;
                if (frame < SPIN_FRAMES - 1) {
                    pixels = Buffer.from(base);
                    const progress = frame / (SPIN_FRAMES - 1);
                    const turns = (4 + (round.ticket - 0.5) / TICKETS) * (1 - (1 - progress) ** 3);
                    pointer(pixels, turns * TWO_PI, COLORS.text);
                    text(pixels, 'ROLLING', 310, 2, COLORS.muted);
                }
                await frames.writeFile(pixels);
            }
        } finally { await frames.close(); }
        await execute(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '1',
            '-filter_threads', '1', '-filter_complex_threads', '1', '-f', 'rawvideo', '-pixel_format', 'rgb24',
            '-video_size', `${WIDTH}x${HEIGHT}`, '-framerate', String(FPS), '-i', 'frames.rgb',
            '-filter_complex', '[0:v]split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle',
            '-loop', '-1', '-y', 'upgrade.gif'], { cwd: directory, windowsHide: true, timeout: 8000, maxBuffer: 128 * 1024 });
        const gif = await fs.readFile(path.join(directory, 'upgrade.gif'));
        const maxBytes = Math.min(attachmentSizeLimit, MAX_BYTES);
        if (!gif.length || gif.length > maxBytes || !/^GIF8[79]a$/.test(gif.subarray(0, 6).toString('ascii'))) return null;
        const still = png(last);
        return { gif, ...(still.length <= maxBytes ? { png: still } : {}), durationMs: FRAME_COUNT / FPS * 1000, width: WIDTH, height: HEIGHT };
    } catch { return null; }
    finally {
        if (directory) await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
        release();
    }
}

module.exports = { renderUpgrade };
