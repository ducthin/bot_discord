const { crc32, deflateSync } = require('node:zlib');

const WIDTH = 448;
const HEIGHT = 144;
const STRIDE = 1 + WIDTH * 4; // PNG filter byte followed by RGBA pixels.
const DIE_SIZE = 112;
const PIP_SIZE = 18;
const DIE_EDGE = [118, 137, 168, 255];
const DIE_FACE = [246, 249, 255, 255];
const DARK_PIP = [30, 44, 70, 255];
const RED_PIP = [179, 42, 58, 255];
const PIP_POSITIONS = [[4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]];

function drawRoundedSquare(pixels, left, top, size, radius, color) {
    for (let y = 0; y < size; y++) {
        const dy = Math.max(radius - y - 0.5, y + 0.5 - (size - radius), 0);
        const row = (top + y) * STRIDE + 1;
        for (let x = 0; x < size; x++) {
            const dx = Math.max(radius - x - 0.5, x + 0.5 - (size - radius), 0);
            if (dx * dx + dy * dy <= radius * radius) pixels.set(color, row + (left + x) * 4);
        }
    }
}

function pngChunk(type, data) {
    const chunk = Buffer.alloc(12 + data.length);
    chunk.writeUInt32BE(data.length);
    chunk.write(type, 4, 'ascii');
    data.copy(chunk, 8);
    chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
    return chunk;
}

function renderDice(dice) {
    const pixels = Buffer.alloc(STRIDE * HEIGHT);
    for (const [index, face] of dice.entries()) {
        const left = 36 + index * 132;
        const top = 12;
        drawRoundedSquare(pixels, left, top + 7, DIE_SIZE, 22, DIE_EDGE);
        drawRoundedSquare(pixels, left, top, DIE_SIZE, 22, DIE_FACE);
        for (const position of PIP_POSITIONS[face - 1]) {
            const x = left + 19 + (position % 3) * 28;
            const y = top + 19 + Math.floor(position / 3) * 28;
            drawRoundedSquare(pixels, x, y, PIP_SIZE, PIP_SIZE / 2, face === 1 ? RED_PIP : DARK_PIP);
        }
    }

    const header = Buffer.alloc(13);
    header.writeUInt32BE(WIDTH, 0);
    header.writeUInt32BE(HEIGHT, 4);
    header[8] = 8;
    header[9] = 6; // Truecolor with alpha.
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        pngChunk('IHDR', header),
        pngChunk('IDAT', deflateSync(pixels)),
        pngChunk('IEND', Buffer.alloc(0))
    ]);
}

module.exports = renderDice;
