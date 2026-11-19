const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { blue } = require('../assets/cs2-patterns.json');
const { items } = require('../assets/cs2-blue-gems/manifest.json');
const { getBlueGemArt, getBlueGemImage, getBlueGemReference } = require('../utils/cs2BlueGemArt');
const reel = require('../utils/cs2Reel');

const hash = buffer => createHash('sha256').update(buffer).digest('hex');
const root = path.join(__dirname, '..', 'assets', 'cs2-blue-gems');

afterEach(() => jest.restoreAllMocks());

test('all supported Blue Gem seeds have distinct local images bound to their exact provider reference', () => {
    const expected = Object.entries(blue).flatMap(([skinId, data]) => (data.gems ?? []).map(paintSeed => `${skinId}:${paintSeed}`));
    expect(new Set(items.map(item => `${item.skinId}:${item.paintSeed}`))).toEqual(new Set(expected));
    const hashes = new Set();
    for (const item of items) {
        const art = getBlueGemArt(item);
        expect(art).toMatchObject({ sourceUrl: item.sourceUrl, patternUrl: item.patternUrl,
            width: item.width, height: item.height, url: `attachment://cs2-blue-gem-${item.skinId}-${item.paintSeed}.png` });
        expect(art.buffer.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        expect(art.buffer.readUInt32BE(16)).toBe(item.width);
        expect(art.buffer.readUInt32BE(20)).toBe(item.height);
        expect(hash(art.buffer)).toBe(item.pngSha256);
        expect(hash(fs.readFileSync(path.join(root, item.sourceFile)))).toBe(item.sourceSha256);
        expect(item.patternUrl).toMatch(new RegExp(`/${item.paintSeed}$`));
        expect(item.sourceUrl).toMatch(/^https:\/\/static\.pattern\.wiki\/img\/[a-f0-9]{40}$/);
        hashes.add(item.pngSha256);
    }
    expect(hashes.size).toBe(items.length);
});

test('unknown seed pairs and unregistered image URLs cannot select another seed or local path', async () => {
    const item = items[0];
    for (const drop of [null, {}, { skinId: item.skinId, paintSeed: '661' }, { skinId: item.skinId, paintSeed: -1 },
        { skinId: item.skinId, paintSeed: 1001 }, { skinId: item.skinId, paintSeed: 0 },
        { skinId: '../../cs2-cases', paintSeed: item.paintSeed }]) expect(getBlueGemArt(drop)).toBeNull();
    for (const url of [null, '../cs2-cases.json', `${item.sourceUrl}?seed=1`, `${item.sourceUrl}/128fx96f`,
        'https://static.pattern.wiki/img/0000000000000000000000000000000000000000']) {
        expect(await getBlueGemImage(url)).toBeNull();
    }
});

test('the reel serves registered seed images offline without widening its remote host allowlist', async () => {
    const fetch = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network must remain unused'));
    const item = items.find(entry => entry.paintSeed === 661);
    const [first, repeated] = await Promise.all([reel.cachedImage(item.sourceUrl), reel.cachedImage(item.sourceUrl)]);
    expect(hash(first)).toBe(item.pngSha256);
    expect(repeated).toBe(first);
    await expect(reel.cachedImage(`${item.sourceUrl}?unregistered=1`)).rejects.toThrow('Unexpected CS2 image source');
    expect(fetch).not.toHaveBeenCalled();
});

test('a corrupt seed image falls back cleanly instead of displaying an unverified pattern', () => {
    const item = items[0];
    const file = path.join(root, item.filename);
    const read = fs.readFileSync;
    const damaged = Buffer.from(read(file));
    damaged[24] ^= 1;
    jest.spyOn(fs, 'readFileSync').mockImplementation((candidate, ...args) => candidate === file ? damaged : read(candidate, ...args));
    let fresh;
    jest.isolateModules(() => { fresh = require('../utils/cs2BlueGemArt'); });
    expect(fresh.getBlueGemArt(item)).toBeNull();
    expect(fresh.getBlueGemReference(item)).toMatchObject({ sourceUrl: item.sourceUrl, patternUrl: item.patternUrl });
});

test('the Five-SeveN #363 stays exact in Battle and does not display ordinary paint if its local image is corrupt', async () => {
    const drop = { skinId: 'skin-133e4c36778f', paintSeed: 363, float: 0.988009 };
    const item = getBlueGemReference(drop);
    expect(item.patternUrl).toBe('https://pattern.wiki/skin/aq_oiled/weapon_fiveseven/363');
    const baseImage = 'https://community.akamai.steamstatic.com/economy/image/fiveseven-base';
    const fetch = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('No remote artwork'));
    const cards = Array.from({ length: 28 }, () => ({ image: item.sourceUrl, color: '#8847ff' }));
    const round = { cards, selectedIndex: 24, landingSeed: 54, result: {
        image: item.sourceUrl, fallbackImage: baseImage, color: '#8847ff', tier: 0,
        title: 'Five-SeveN | Case Hardened · Blue Gem #363', detail: 'Restricted · Battle-Scarred'
    } };
    const confirmed = await reel.renderCaseBatch([round, round], 7_500_000, { profile: 'battle' });
    expect(confirmed?.gif?.subarray(0, 3).toString('ascii')).toBe('GIF');
    expect(fetch).not.toHaveBeenCalled();

    const originalRead = fs.readFileSync;
    const filename = path.join(root, item.filename);
    jest.spyOn(fs, 'readFileSync').mockImplementation((candidate, ...args) =>
        candidate === filename ? Buffer.alloc(310546) : originalRead(candidate, ...args));
    let fresh;
    jest.isolateModules(() => { fresh = require('../utils/cs2Reel'); });
    const unavailable = await fresh.renderCaseBatch([round, round], 7_500_000, { profile: 'battle' });
    expect(unavailable?.gif?.subarray(0, 3).toString('ascii')).toBe('GIF');
    expect(unavailable.gif.equals(confirmed.gif)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
}, 20_000);
