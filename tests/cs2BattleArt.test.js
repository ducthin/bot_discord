const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { customCases, customCasesById, TICKETS, casePricing } = require('../utils/cs2BattleCases');
const { getBattleCaseArt, getBattleTieArt, getBattleTieAnimation } = require('../utils/cs2BattleArt');

test('every case has its own portable PNG cover with correct dimensions and Discord attachment reference', () => {
    const hashes = new Set();
    const names = new Set();
    for (const item of customCases) {
        const art = getBattleCaseArt(item);
        expect(art).toMatchObject({ name: `cs2-${item.id}.png`, url: `attachment://cs2-${item.id}.png`, width: 1024, height: 640 });
        expect(art.buffer.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        expect(art.buffer.readUInt32BE(16)).toBe(1024);
        expect(art.buffer.readUInt32BE(20)).toBe(640);
        expect(art.buffer.length).toBeLessThan(500 * 1024);
        expect(art.buffer.length).toBeGreaterThan(20 * 1024);
        hashes.add(crypto.createHash('sha256').update(art.buffer).digest('hex'));
        names.add(art.name);
    }
    expect(hashes.size).toBe(customCases.length);
    expect(names.size).toBe(customCases.length);
});

test('artwork honors the current attachment limit even for cached buffers and invalid paths fall back cleanly', () => {
    const item = customCases[0];
    const art = getBattleCaseArt(item.id);
    expect(getBattleCaseArt(item.id, art.buffer.length)).toBe(art);
    expect(getBattleCaseArt(item.id, art.buffer.length - 1)).toBeNull();
    expect(getBattleCaseArt(item.id, 0)).toBeNull();
    expect(getBattleCaseArt(item.id, NaN)).toBeNull();
    expect(getBattleCaseArt('battle-missing-case')).toBeNull();
    expect(getBattleCaseArt('../cs2-cases.json')).toBeNull();
    expect(getBattleCaseArt({ id: '../../invalid' })).toBeNull();
    expect(getBattleCaseArt(null)).toBeNull();
    expect(item.image).toMatch(/^https:\/\//);
});

test('tie artwork and deterministic left/right animations are locally available and respect limits', () => {
    const still = getBattleTieArt();
    expect(still).toMatchObject({ width: 1024, height: 640, name: 'cs2-tie.png' });
    expect(getBattleTieArt(still.buffer.length - 1)).toBeNull();
    const left = getBattleTieAnimation('left');
    const right = getBattleTieAnimation('right');
    for (const [side, art] of [['left', left], ['right', right]]) {
        expect(art).toMatchObject({ name: `cs2-tie-${side}.gif`, url: `attachment://cs2-tie-${side}.gif`,
            width: 768, height: 480, durationMs: 2600 });
        expect(art.buffer.toString('ascii', 0, 6)).toBe('GIF89a');
        expect(art.buffer.length).toBeLessThan(600 * 1024);
        expect(getBattleTieAnimation(side, art.buffer.length)).toBe(art);
        expect(getBattleTieAnimation(side, art.buffer.length - 1)).toBeNull();
    }
    expect(left.buffer.equals(right.buffer)).toBe(false);
    expect(getBattleTieAnimation('not-a-side')).toBeNull();
    expect(getBattleTieAnimation('left', 0)).toBeNull();
});

test('the added creative themes have valid supported rewards and exact independent ticket distributions', () => {
    const ids = ['dragon', 'frost', 'cosmos', 'sakura', 'spectrum', 'cyber', 'desert', 'abyss', 'venom', 'royal',
        'pistol-lottery', 'duel-storm', 'treasure', 'glove-vault'];
    for (const id of ids) {
        const item = customCasesById.get(`battle-${id}`);
        expect(item).toBeDefined();
        expect(item.artId).toBe(item.id);
        expect(item.entries.every(entry => Number.isSafeInteger(entry.weight) && entry.weight > 0 && entry.ref?.name)).toBe(true);
        expect(item.entries.reduce((sum, entry) => sum + entry.weight, 0)).toBe(TICKETS);
        const pricing = casePricing(item, () => 100);
        expect(pricing).not.toBeNull();
        expect(pricing.lossTickets + pricing.profitTickets + pricing.breakEvenTickets).toBe(TICKETS);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'cs2-battle-art', 'catalogue.json'), 'utf8'));
    expect(new Set(manifest.map(item => item.id))).toEqual(new Set(customCases.map(item => item.id)));
});
