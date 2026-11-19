const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const ffmpeg = require('ffmpeg-static');
const reel = require('../utils/cs2Reel');
const catalogue = require('../assets/cs2-battle-art/catalogue.json');

const execute = promisify(execFile);
const pixel = (buffer, width, x, y) => [...buffer.subarray((y * width + x) * 3, (y * width + x) * 3 + 3)];
const rgb = hex => hex.slice(1).match(/../g).map(value => Number.parseInt(value, 16));

test('a rare drop in each of three Battle rows stays in that same row through the real GIF encoder', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-battle-three-row-audit-'));
    const gun = catalogue.find(item => item.id === 'battle-usp');
    const picture = await fs.readFile(path.join(__dirname, '..', 'assets', 'cs2-battle-art', gun.source));
    const fetch = jest.spyOn(global, 'fetch').mockImplementation(async () =>
        new Response(picture, { headers: { 'content-type': 'image/png' } }));
    const colors = ['#dc3232', '#32c85a', '#3c64dc'];
    const gold = '#e4ae39';
    const image = 'https://community.akamai.steamstatic.com/economy/image/three-row-audit';
    try {
        for (const rareRow of [0, 1, 2]) {
            const expected = colors.map((color, row) => row === rareRow ? gold : color);
            const rounds = expected.map((color, row) => {
                const cards = Array.from({ length: 28 }, () => ({ image, color: colors[row] }));
                if (row === rareRow) cards[24] = { mystery: 'default_rare_item.png', color: gold };
                return { cards, selectedIndex: 24, landingSeed: 54 + row,
                    result: { image, color, tier: row === rareRow ? 4 : 0, title: `Position ${row + 1}`, detail: 'Seat audit' } };
            });
            const media = await reel.renderCaseBatch(rounds, 7_500_000, { profile: 'battle' });
            expect(media?.gif?.subarray(0, 6).toString()).toMatch(/^GIF8[79]a$/);
            const file = path.join(directory, `rare-in-position-${rareRow + 1}.gif`);
            await fs.writeFile(file, media.gif);
            for (const [input, x, rowY] of [
                [['-ss', '5.8', '-i', file], 180, 75],
                [['-i', file, '-vf', 'reverse'], 1, 39]
            ]) {
                const { stdout } = await execute(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...input,
                    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
                { encoding: 'buffer', maxBuffer: 2_000_000, timeout: 5000, windowsHide: true });
                expect(stdout.length).toBe(420 * 252 * 3);
                // Compare the selected tile before reveal and each final card's stripe.
                // Both samples avoid the center pointer and preserve the owner's row.
                for (const [row, color] of expected.entries()) {
                    const actual = pixel(stdout, 420, x, row * 84 + rowY);
                    for (const [channel, value] of rgb(color).entries()) {
                        expect(Math.abs(actual[channel] - value)).toBeLessThanOrEqual(3);
                    }
                }
            }
        }
    } finally {
        fetch.mockRestore();
        await fs.rm(directory, { recursive: true, force: true });
    }
}, 30_000);
