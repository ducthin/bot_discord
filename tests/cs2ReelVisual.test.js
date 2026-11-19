const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const ffmpeg = require('ffmpeg-static');
const reel = require('../utils/cs2Reel');
const catalogue = require('../assets/cs2-battle-art/catalogue.json');

const execute = promisify(execFile);

function gifTiming(buffer) {
    let offset = 13 + (buffer[10] & 0x80 ? 3 * 2 ** ((buffer[10] & 7) + 1) : 0);
    let delay = 0;
    let duration = 0;
    let frames = 0;
    const skipBlocks = () => {
        while (buffer[offset]) offset += 1 + buffer[offset];
        offset++;
    };
    while (offset < buffer.length) {
        const marker = buffer[offset++];
        if (marker === 0x3b) break;
        if (marker === 0x21) {
            const extension = buffer[offset++];
            if (extension === 0xf9) delay = buffer.readUInt16LE(offset + 2);
            skipBlocks();
        } else if (marker === 0x2c) {
            const packed = buffer[offset + 8];
            offset += 9 + (packed & 0x80 ? 3 * 2 ** ((packed & 7) + 1) : 0);
            offset++; // LZW minimum code size.
            skipBlocks();
            frames++;
            duration += delay;
        } else throw new Error(`Unexpected GIF block: ${marker}`);
    }
    return { frames, duration };
}

test('real single and batch GIFs land on a gold tile before the reveal, while a normal row stays blue', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-gold-visual-'));
    const gun = catalogue.find(item => item.id === 'battle-usp');
    const gold = catalogue.find(item => item.id === 'battle-balance');
    const sourceRoot = path.join(__dirname, '..', 'assets', 'cs2-battle-art');
    const [gunImage, goldImage] = await Promise.all([gun, gold].map(item => fs.readFile(path.join(sourceRoot, item.source))));
    const lookup = jest.spyOn(global, 'fetch').mockImplementation(async url => new Response(
        String(url).includes('/gold-visual-test') ? goldImage : gunImage, { headers: { 'content-type': 'image/png' } }
    ));
    try {
        const image = 'https://community.akamai.steamstatic.com/economy/image/gun-visual-test';
        const cards = Array.from({ length: 28 }, () => ({ image, color: '#4b69ff' }));
        cards[24] = { mystery: 'default_rare_item.png', color: '#e4ae39' };
        const result = { image: 'https://community.akamai.steamstatic.com/economy/image/gold-visual-test',
            color: '#e4ae39', tier: 4, title: 'Gold landing', detail: 'Rare Special Item' };
        const single = await reel.renderCaseReel(cards, 24, result, false, 54, 3_500_000);
        const rounds = [
            { cards, selectedIndex: 24, result, landingSeed: 54 },
            { cards: cards.map(() => ({ image, color: '#4b69ff' })), selectedIndex: 24,
                result: { ...result, image, color: '#4b69ff', tier: 0 }, landingSeed: 54 }
        ];
        const batch = await reel.renderCaseBatch(rounds, 7_500_000);
        const battle = await reel.renderCaseBatch(rounds, 7_500_000, { profile: 'battle' });
        const regularTiming = gifTiming(batch.gif);
        const battleTiming = gifTiming(battle.gif);
        expect(battleTiming.duration).toBe(regularTiming.duration);
        expect(battleTiming.duration).toBe(895);
        expect(battleTiming.frames).toBeLessThan(regularTiming.frames * 0.6);
        expect(battle.gif.length).toBeLessThan(batch.gif.length);

        const decoded = [];
        for (const [name, media] of [['single', single], ['batch', batch], ['battle', battle]]) {
            expect(media?.gif?.subarray(0, 6).toString()).toMatch(/^GIF8[79]a$/);
            const file = path.join(directory, `${name}.gif`);
            await fs.writeFile(file, media.gif);
            const { stdout } = await execute(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', '5.8', '-i', file,
                '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
            { encoding: 'buffer', maxBuffer: 2_000_000, timeout: 5000, windowsHide: true });
            decoded.push(stdout);
        }
        // Read the rarity stripe inside the winning tile, away from the central gold marker.
        // At 5.8 seconds the reel is still scrolling; the gold reveal starts at 6.6 seconds.
        const pixel = (buffer, width, x, y) => [...buffer.subarray((y * width + x) * 3, (y * width + x) * 3 + 3)];
        for (const [r, g, b] of [pixel(decoded[0], 460, 210, 173), pixel(decoded[1], 420, 180, 75), pixel(decoded[2], 420, 180, 75)]) {
            expect(r).toBeGreaterThan(170);
            expect(g).toBeGreaterThan(100);
            expect(b).toBeLessThan(120);
        }
        const [r, g, b] = pixel(decoded[1], 420, 180, 159);
        expect(b).toBeGreaterThan(170);
        expect(r).toBeLessThan(140);
        expect(g).toBeLessThan(160);
    } finally {
        lookup.mockRestore();
        await fs.rm(directory, { recursive: true, force: true });
    }
}, 20_000);
