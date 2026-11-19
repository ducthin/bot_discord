const iconic = require('../assets/cs2-iconic-collections.json');
const caseCatalogue = require('../assets/cs2-cases.json');
const terminalCatalogue = require('../assets/cs2-terminals.json');
const finishCatalogue = require('../assets/cs2-finish-catalog.json');
const collectionLabels = require('../assets/cs2-collections.json');
const { cases, collections, skins, containersById } = require('../utils/cs2Catalogue');
const { getCaseMarketHashName, isCaseMarketHashName, getDropMarketHashName } = require('../utils/cs2MarketNames');

const famousNames = [
    'M4A4 | Howl', 'AWP | Dragon Lore', 'AWP | Gungnir', 'AWP | Medusa', 'AWP | The Prince',
    'AWP | Desert Hydra', 'AWP | Fade', 'AWP | Silk Tiger', 'AWP | CMYK',
    'AK-47 | Wild Lotus', 'AK-47 | Gold Arabesque', 'AK-47 | Hydroponic', 'AK-47 | X-Ray',
    'AK-47 | Panthera onca', 'AK-47 | Jet Set', 'AK-47 | B the Monster',
    'M4A1-S | Welcome to the Jungle', 'M4A1-S | Icarus Fell', 'M4A1-S | Knight',
    'M4A1-S | Hot Rod', 'M4A1-S | Blue Phosphor', 'M4A1-S | Imminent Danger', 'M4A1-S | Fade',
    'M4A4 | Poseidon', 'M4A4 | Eye of Horus', 'AUG | Akihabara Accept',
    'Desert Eagle | Blaze', 'Desert Eagle | Hand Cannon', 'Desert Eagle | Emerald Jörmungandr',
    'Glock-18 | Fade', 'Glock-18 | Twilight Galaxy', 'Glock-18 | Gamma Doppler',
    'MP9 | Wild Lily', 'MP9 | Hot Rod', 'UMP-45 | Blaze', 'Negev | Mjölnir',
    'USP-S | Target Acquired', 'SG 553 | Integrale', 'MAG-7 | Cinquedea'
];

test.each(famousNames)('includes the iconic finish %s with an identifiable source', name => {
    const matching = Object.entries(iconic.skins).filter(([, skin]) => skin.name === name);
    expect(matching.length).toBeGreaterThan(0);
    for (const [skinId, skin] of matching) {
        const source = containersById.get(skin.collectionId);
        expect(source.kind).toBe('collection');
        expect(source.pools.flat()).toContain(skinId);
        expect(Number.isInteger(finishCatalogue[skinId])).toBe(true);
        expect(skin.image).toMatch(/^https:\/\//);
    }
});

test('retains pinned provenance and original case metadata while merging collection skins', () => {
    expect(iconic.source).toMatchObject(caseCatalogue.source);
    expect(cases).toEqual(caseCatalogue.cases);
    expect(new Set(collections.map(source => source.id)).size).toBe(collections.length);
    const originalSkins = { ...caseCatalogue.skins, ...terminalCatalogue.skins };
    for (const [skinId, skin] of Object.entries(originalSkins)) {
        expect(Object.hasOwn(iconic.skins, skinId)).toBe(false);
        expect(skins[skinId]).toBe(skin);
    }
});

test('source pools retain weapon rarity and avoid incompatible low grades and gold outcomes', () => {
    const rarities = ['Mil-Spec Grade', 'Restricted', 'Classified', 'Covert'];
    const covered = new Set();
    for (const source of iconic.collections) {
        expect(source).toMatchObject({ kind: 'collection', nonMarketable: true });
        expect(source.pools).toHaveLength(5);
        expect(source.pools[4]).toEqual([]);
        expect(collectionLabels[source.id]).toBe(source.name);
        expect(new Set(source.pools.flat()).size).toBe(source.pools.flat().length);
        for (const [tier, pool] of source.pools.entries()) {
            for (const skinId of pool) {
                const skin = skins[skinId];
                expect(skin).toBeDefined();
                expect(skin.collectionId).toBe(source.id);
                expect(skin.rarity).toBe(source.id === 'special-contraband' ? 'Contraband' : rarities[tier]);
                expect(skin.min).toBeGreaterThanOrEqual(0);
                expect(skin.max).toBeGreaterThanOrEqual(skin.min);
                expect(skin.max).toBeLessThanOrEqual(1);
                expect(typeof skin.stattrak).toBe('boolean');
                covered.add(skinId);
            }
        }
    }
    expect(covered).toEqual(new Set(Object.keys(iconic.skins)));
});

test('collection source names are never advertised as sealed market items', () => {
    for (const source of iconic.collections) {
        expect(getCaseMarketHashName(source.id)).toBeNull();
        expect(isCaseMarketHashName(source.name)).toBe(false);
    }
    expect(getCaseMarketHashName('crate-4017')).toBe('Huntsman Weapon Case');
});

test('Howl preserves Contraband identity and its real exterior and StatTrak limits', () => {
    const skinId = 'skin-8aacf99e7f2f';
    expect(iconic.skins[skinId]).toMatchObject({
        name: 'M4A4 | Howl', min: 0, max: 0.4, stattrak: true,
        rarity: 'Contraband', tradeUp: false, collectionId: 'special-contraband'
    });
    expect(finishCatalogue[skinId]).toBe(309);
    expect(containersById.get('special-contraband')).toMatchObject({ tradeUp: false });
    expect(containersById.get('special-contraband').pools).toEqual([[], [], [], [skinId], []]);
    expect(cases.every(source => !source.pools.flat().includes(skinId))).toBe(true);
    expect(getDropMarketHashName({ skinId, float: 0.4, statTrak: true }))
        .toBe('StatTrak™ M4A4 | Howl (Well-Worn)');
    expect(getDropMarketHashName({ skinId, float: 0.400001 })).toBeNull();
    expect(getDropMarketHashName({ skinId, float: 0.45 })).toBeNull();
});

test('collection grails reject fictional StatTrak quality and preserve constrained wear ranges', () => {
    const knight = Object.entries(iconic.skins).find(([, skin]) => skin.name === 'M4A1-S | Knight')[0];
    const dragonLore = 'skin-4f8d99d09ded';
    expect(skins[dragonLore]).toMatchObject({ min: 0, max: 0.7, stattrak: false });
    expect(skins[knight]).toMatchObject({ min: 0, max: 0.1, stattrak: false });
    expect(getDropMarketHashName({ skinId: knight, float: 0.1 })).toBe('M4A1-S | Knight (Minimal Wear)');
    expect(getDropMarketHashName({ skinId: knight, float: 0.15 })).toBeNull();
    expect(getDropMarketHashName({ skinId: dragonLore, float: 0.01, statTrak: true })).toBeNull();
});

test('Glock Gamma Doppler keeps Emerald and all four distinct phase records', () => {
    const variants = Object.entries(iconic.skins).filter(([, skin]) => skin.name === 'Glock-18 | Gamma Doppler');
    expect(variants.map(([, skin]) => skin.phase).sort()).toEqual([
        'Emerald', 'Phase 1', 'Phase 2', 'Phase 3', 'Phase 4'
    ]);
    expect(new Set(variants.map(([id]) => finishCatalogue[id])).size).toBe(5);
    for (const [skinId, skin] of variants) {
        expect(skin).toMatchObject({ min: 0, max: 0.5, stattrak: false, collectionId: 'collection-set-train-2021' });
        expect(getDropMarketHashName({ skinId, float: 0.01 })).toBe('Glock-18 | Gamma Doppler (Factory New)');
    }
});
