const crypto = require('node:crypto');
const market = require('../utils/cs2Market');
const { skins, containersById } = require('../utils/cs2Catalogue');
const { wearBounds } = require('../utils/cs2MarketNames');
const { TICKETS, CREATIVE_CASE_IDS, customCases, customCasesById, casePricing, lockCasePricing, lockedCase, rollCustomCase } = require('../utils/cs2BattleCases');

const weapons = { p2000: 'P2000', sg553: 'SG 553', aug: 'AUG', g3sg1: 'G3SG1', scar20: 'SCAR-20', nova: 'Nova', xm1014: 'XM1014', negev: 'Negev' };
const gold = { huntsman: '★ Huntsman Knife', bowie: '★ Bowie Knife', falchion: '★ Falchion Knife', 'shadow-daggers': '★ Shadow Daggers',
    paracord: '★ Paracord Knife', survival: '★ Survival Knife', nomad: '★ Nomad Knife', skeleton: '★ Skeleton Knife' };
const themes = {
    'neo-noir': / \| Neo-Noir$/, 'neon-rider': / \| Neon Rider$/, 'fuel-injector': / \| Fuel Injector$/,
    decimator: / \| Decimator$/, pulse: / \| Pulse$/, ember: /Flame|Fire|Heat|Blaze|Incinegator|Firefight/i,
    'night-safari': /Panther|Jaguar|Tiger|Leopard|Lion|Anolis|Chameleon/i,
    arcade: /Button Masher|Player Two|Player One|Game Over|K\.O\. Factory|BI83 Spectrum|Boost Protocol/i,
    botanical: /Bloomstick|Wild Lily|Petal|Rose|Flora|Lotus|Bloom|Arboreal/i,
    horror: /Night Terror|Monster|Apparition|Phobos|Necropos|Dream|Cortex|Grim/i,
    'street-art': /Graffiti|Street|Outbreak|In Living Color|Rebel|Snack Attack/i,
    engineering: /Torque|Power Loader|Control Panel|Lead Conduit|Circuit|Core Breach|Fuel Rod/i
};
const experienceWeapons = {
    'pistol-duel': ['P2000', 'USP-S', 'Glock-18', 'P250', 'Desert Eagle'],
    'eco-rush': ['MAC-10', 'MP9', 'MP5-SD', 'UMP-45', 'MP7'],
    'rifle-arena': ['AK-47', 'M4A4', 'M4A1-S', 'Galil AR', 'FAMAS'],
    'sniper-showdown': ['AWP', 'SSG 08', 'G3SG1', 'SCAR-20'],
    'shotgun-breach': ['Nova', 'XM1014', 'MAG-7', 'Sawed-Off'],
    'smg-overdrive': ['MAC-10', 'MP9', 'MP7', 'UMP-45', 'PP-Bizon', 'P90'],
    'arsenal-ascension': ['Glock-18', 'AK-47', 'AWP', '★ Butterfly Knife']
};
const profiles = {
    'pistol-duel': [5000, 3500, 1300, 200], 'eco-rush': [8000, 1600, 350, 50], 'rifle-arena': [3500, 3500, 2500, 500],
    'sniper-showdown': [6000, 2500, 1200, 300], 'shotgun-breach': [6500, 2500, 800, 200], 'smg-overdrive': [7000, 2200, 650, 150],
    'covert-vault': [9500, 350, 130, 20], 'arsenal-ascension': [2000, 3000, 3500, 1500]
};
const expectedIds = [...Object.keys(weapons), ...Object.keys(gold), ...Object.keys(themes), ...Object.keys(profiles)].map(id => `battle-${id}`);
const keyOf = entry => market.marketQuoteKey(entry.ref.name, entry.ref.phase);
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const inCollection = (item, entry) => {
    const id = item.id.slice(7);
    const name = skins[entry.drop.skinId].name;
    const weapon = name.split(' | ')[0];
    if (weapons[id]) return weapon === weapons[id];
    if (gold[id]) return entry.drop.tier === 4 && weapon === gold[id];
    if (themes[id]) return themes[id].test(name);
    if (id === 'covert-vault') return entry.drop.tier === 3;
    return experienceWeapons[id].includes(weapon);
};

afterEach(() => jest.restoreAllMocks());

test('appends 36 named cases and retains all 72 previous entries, snapshots, candidates and catalogue positions exactly', () => {
    expect(customCases).toHaveLength(169);
    expect(customCasesById.size).toBe(169);
    expect(CREATIVE_CASE_IDS).toEqual(expectedIds);
    expect(Object.isFrozen(CREATIVE_CASE_IDS)).toBe(true);
    expect(customCases.slice(72, 108).map(item => item.id)).toEqual(expectedIds);
    const original = customCases.slice(0, 72).map(item => ({ id: item.id, entriesHash: hash(item.entries),
        legacyHash: hash(item.legacyEntries), candidatesHash: hash(item.candidates) }));
    expect(hash(original)).toBe('cbe9b940131694fce3e1424e84da59eba940fe2c4841f08268695a11dd628925');
    const counts = customCases.slice(72, 108).reduce((result, item) => ({ ...result, [item.group]: (result[item.group] ?? 0) + 1 }), {});
    expect(counts).toEqual({ weapon: 8, gold: 8, theme: 12, casual: 8 });
    expect(new Set(customCases.slice(72, 108).map(item => item.name)).size).toBe(36);
});

test.each(expectedIds)('%s only contains matching real catalogue rewards with legal wear and integer tickets', id => {
    const item = customCasesById.get(id);
    expect(item.artId).toBe(id);
    expect(item.image).toMatch(/^https:\/\//);
    expect(item.legacyEntries).toHaveLength(6);
    for (const entries of [item.entries, item.legacyEntries]) {
        expect(entries.every(entry => Number.isSafeInteger(entry.weight) && entry.weight > 0)).toBe(true);
        expect(entries.reduce((sum, entry) => sum + entry.weight, 0)).toBe(TICKETS);
        expect(new Set(entries.map(keyOf)).size).toBe(entries.length);
    }
    for (const entry of [...item.legacyEntries, ...item.entries, ...item.candidates]) {
        expect(inCollection(item, entry)).toBe(true);
        expect(containersById.get(entry.drop.caseId).pools[entry.drop.tier]).toContain(entry.drop.skinId);
        const skin = skins[entry.drop.skinId];
        if (entry.exterior === null) {
            expect(skin.min == null && skin.max == null).toBe(true);
            expect(entry.min).toBeNull();
            expect(entry.max).toBeNull();
        } else {
            expect(entry.min).toBe(Math.max(Math.round(skin.min * 1_000_000), Math.round(wearBounds[entry.exterior] * 1_000_000)));
            expect(entry.max).toBe(Math.min(Math.round(skin.max * 1_000_000), Math.round(wearBounds[entry.exterior + 1] * 1_000_000) - Number(entry.exterior < 4)));
            expect(entry.min).toBeLessThanOrEqual(entry.max);
        }
    }
    if (item.group === 'weapon') expect(new Set(item.legacyEntries.map(entry => entry.drop.skinId)).size).toBe(6);
    if (item.group === 'theme') expect(new Set(item.legacyEntries.map(entry => entry.drop.skinId)).size).toBeGreaterThanOrEqual(2);
    if (item.group === 'gold') expect(item.goldTickets).toBe(TICKETS);
});

test.each(Object.keys(profiles))('%s publishes its own exact four-group profile and every ticket maps to that profile', id => {
    const item = customCasesById.get(`battle-${id}`);
    const profile = profiles[id];
    expect(item.ticketProfile).toEqual(profile);
    expect(Object.isFrozen(item.ticketProfile)).toBe(true);
    expect(item.entries).toHaveLength(6);
    const bandNames = ['common', 'regular', 'premium', 'jackpot'];
    const expected = Object.fromEntries(bandNames.map((band, index) => [band, profile[index]]));
    const bands = {};
    for (const entry of item.entries) {
        const band = item.bandByKey.get(keyOf(entry));
        bands[band] = (bands[band] ?? 0) + entry.weight;
    }
    expect(bands).toEqual(expected);
    for (let index = 0; index < 6; index++) {
        const expectedBand = index < 2 ? 'common' : index < 4 ? 'regular' : index === 4 ? 'premium' : 'jackpot';
        expect(item.bandByKey.get(keyOf(item.legacyEntries[index]))).toBe(expectedBand);
    }
    jest.spyOn(crypto, 'randomBytes').mockReturnValue(Buffer.alloc(4));
    const counts = Object.fromEntries(bandNames.map(band => [band, 0]));
    let expectedIndex = 0;
    let boundary = item.entries[0].weight;
    let mismatches = 0;
    for (let ticket = 0; ticket < TICKETS; ticket++) {
        while (ticket >= boundary) boundary += item.entries[++expectedIndex].weight;
        const draw = (min, max) => max == null ? (min === TICKETS ? ticket : 0) : min;
        const result = rollCustomCase(item, item.entries.map((_, index) => index + 1), 'same-seat-independent-id', 1, draw);
        const actual = Number(result.value / 100n) - 1;
        if (actual !== expectedIndex) mismatches++;
        counts[item.bandByKey.get(keyOf(item.entries[actual]))]++;
    }
    expect(mismatches).toBe(0);
    expect(counts).toEqual(expected);
});

test('creative experiences have eight distinct profiles and changing quotes preserves EV pricing rather than guaranteeing a profit', () => {
    expect(new Set(Object.values(profiles).map(JSON.stringify)).size).toBe(8);
    for (const id of Object.keys(profiles)) {
        const item = customCasesById.get(`battle-${id}`);
        const pricing = casePricing({ ...item, candidates: [] }, () => 100);
        expect(pricing).toMatchObject({ expected: 10_000n, fee: 10_527n, profitTickets: 0, lossTickets: TICKETS });
    }
});

test('all new cases require every published quote, use no network fallback, and keep locked snapshots and family-safe expansions', () => {
    const network = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Unexpected network access'));
    const lookup = jest.spyOn(market, 'peekMarketQuote');
    for (const id of expectedIds) {
        const item = customCasesById.get(id);
        const prices = new Map(item.entries.map((entry, index) => [keyOf(entry), 100 + index * 100]));
        lookup.mockImplementation((name, ref) => {
            const value = prices.get(market.marketQuoteKey(name, ref?.phase));
            return value == null ? null : { source: 'buff', priceVnd: value };
        });
        const pricing = casePricing(item);
        expect(pricing).not.toBeNull();
        expect(pricing.values).toEqual(pricing.entries.map(entry => prices.get(keyOf(entry))));
        expect(pricing.entries.map(({ weight, ...entry }) => entry)).toEqual(item.entries.map(({ weight, ...entry }) => entry));
        expect(pricing.entries.map(entry => entry.weight).sort((a, b) => a - b))
            .toEqual(item.entries.map(entry => entry.weight).sort((a, b) => a - b));
        const weighted = pricing.entries.reduce((sum, entry, index) => sum + BigInt(pricing.values[index]) * BigInt(entry.weight), 0n);
        const numerator = weighted * 100n * 100n;
        const denominator = BigInt(TICKETS) * 95n;
        expect(pricing.fee * denominator).toBeGreaterThanOrEqual(numerator);
        expect((pricing.fee - 1n) * denominator).toBeLessThan(numerator);
        for (const entry of item.entries) {
            const key = keyOf(entry);
            const previous = prices.get(key);
            prices.delete(key);
            expect(casePricing(item)).toBeNull();
            prices.set(key, previous);
        }
        const expanded = casePricing(item, () => 100);
        expect(expanded.entries.length).toBeGreaterThan(item.entries.length);
        expect(expanded.entries.every(entry => inCollection(item, entry))).toBe(true);
        expect(expanded.entries.reduce((sum, entry) => sum + entry.weight, 0)).toBe(TICKETS);
        const snapshot = lockCasePricing(expanded);
        expect(lockedCase(item, snapshot).entries).toEqual(expanded.entries);
        expect(lockedCase(item, { ...snapshot, revision: 'changed' })).toBeNull();
    }
    expect(network).not.toHaveBeenCalled();
});
