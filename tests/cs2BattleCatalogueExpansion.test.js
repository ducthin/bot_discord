const crypto = require('node:crypto');
const market = require('../utils/cs2Market');
const { skins, containersById } = require('../utils/cs2Catalogue');
const { wearBounds } = require('../utils/cs2MarketNames');
const { customCases, customCasesById, TICKETS, casePricing, lockCasePricing, lockedCase } = require('../utils/cs2BattleCases');

const weaponCases = {
    p250: 'P250', 'five-seven': 'Five-SeveN', tec9: 'Tec-9', cz75: 'CZ75-Auto',
    'dual-berettas': 'Dual Berettas', ump45: 'UMP-45', p90: 'P90', 'pp-bizon': 'PP-Bizon',
    mp7: 'MP7', mp5: 'MP5-SD', galil: 'Galil AR', famas: 'FAMAS'
};
const finishCases = {
    asiimov: 'Asiimov', 'mecha-industries': 'Mecha Industries', bloodsport: 'Bloodsport',
    'hyper-beast': 'Hyper Beast', 'wasteland-rebel': 'Wasteland Rebel', 'case-hardened': 'Case Hardened'
};
const goldCases = {
    karambit: '★ Karambit', butterfly: '★ Butterfly Knife', 'm9-bayonet': '★ M9 Bayonet',
    bayonet: '★ Bayonet', talon: '★ Talon Knife', 'sport-gloves': '★ Sport Gloves'
};
const addedIds = [...Object.keys(weaponCases), ...Object.keys(finishCases), ...Object.keys(goldCases)].map(id => `battle-${id}`);
const added = addedIds.map(id => customCasesById.get(id));
const keyOf = entry => market.marketQuoteKey(entry.ref.name, entry.ref.phase);
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const matches = (item, entry) => {
    const id = item.id.slice('battle-'.length);
    const name = skins[entry.drop.skinId].name;
    if (weaponCases[id]) return name.startsWith(`${weaponCases[id]} | `);
    if (finishCases[id]) return name.endsWith(` | ${finishCases[id]}`);
    return entry.drop.tier === 4 && (name === goldCases[id] || name.startsWith(`${goldCases[id]} | `));
};

afterEach(() => jest.restoreAllMocks());

test('appends 24 distinct collections while all 48 earlier ticket tables, snapshots and candidates stay identical', () => {
    expect(customCases.length).toBeGreaterThanOrEqual(72);
    expect(customCasesById.size).toBe(customCases.length);
    expect(customCases.slice(48, 72).map(item => item.id)).toEqual(addedIds);
    const originals = customCases.slice(0, 48).map(item => ({ id: item.id,
        entriesHash: hash(item.entries), legacyHash: hash(item.legacyEntries), candidatesHash: hash(item.candidates) }));
    // Captured from the 48-case catalogue before this append-only expansion.
    expect(hash(originals)).toBe('c1bee8bcbde0ab66161ae03e0f775dbc5c86c4efac4411f1e6d8c1ebfd3f326e');
    expect(new Set(added.map(item => item.name)).size).toBe(24);
    expect(added.filter(item => item.group === 'weapon')).toHaveLength(12);
    expect(added.filter(item => item.group === 'theme')).toHaveLength(6);
    expect(added.filter(item => item.group === 'gold')).toHaveLength(6);
});

test.each(addedIds)('%s uses real source pools, valid wear ranges and exactly 10,000 integer tickets', id => {
    const item = customCasesById.get(id);
    expect(item).toBeDefined();
    expect(item.artId).toBe(id);
    expect(item.image).toMatch(/^https:\/\//);
    expect(item.legacyEntries).toHaveLength(6);
    for (const entries of [item.entries, item.legacyEntries]) {
        expect(entries.every(entry => Number.isSafeInteger(entry.weight) && entry.weight > 0)).toBe(true);
        expect(entries.reduce((sum, entry) => sum + entry.weight, 0)).toBe(TICKETS);
        expect(new Set(entries.map(keyOf)).size).toBe(entries.length);
    }
    for (const entry of [...item.legacyEntries, ...item.entries, ...item.candidates]) {
        const skin = skins[entry.drop.skinId];
        const source = containersById.get(entry.drop.caseId);
        expect(source.pools[entry.drop.tier]).toContain(entry.drop.skinId);
        expect(matches(item, entry)).toBe(true);
        expect(entry.ref.name).toBeTruthy();
        if (entry.exterior === null) {
            expect(skin.min == null && skin.max == null).toBe(true);
            expect(entry.min).toBeNull();
            expect(entry.max).toBeNull();
            continue;
        }
        expect(entry.exterior).toBeGreaterThanOrEqual(0);
        expect(entry.exterior).toBeLessThanOrEqual(4);
        const min = Math.max(Math.round(skin.min * 1_000_000), Math.round(wearBounds[entry.exterior] * 1_000_000));
        const max = Math.min(Math.round(skin.max * 1_000_000), Math.round(wearBounds[entry.exterior + 1] * 1_000_000) - Number(entry.exterior < 4));
        expect(entry.min).toBe(min);
        expect(entry.max).toBe(max);
        expect(min).toBeLessThanOrEqual(max);
    }
    if (item.group === 'weapon') expect(new Set(item.legacyEntries.map(entry => entry.drop.skinId)).size).toBe(6);
    if (item.group === 'theme') expect(new Set(item.legacyEntries.map(entry => entry.drop.skinId)).size).toBeGreaterThanOrEqual(2);
    if (item.group === 'gold') expect(item.goldTickets).toBe(TICKETS);
});

test('new weapon collections offer several ticket profiles without changing their exclusive weapon families', () => {
    const commonTickets = Object.entries(weaponCases).map(([id]) => {
        const item = customCasesById.get(`battle-${id}`);
        return item.entries.reduce((sum, entry) => sum + (item.bandByKey.get(keyOf(entry)) === 'common' ? entry.weight : 0), 0);
    });
    expect(new Set(commonTickets)).toEqual(new Set([7000, 8500, 9500]));
});

test('new collections only use cached quoted values and never invent a price when any required quote is missing', () => {
    const network = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Unexpected network access'));
    const quote = jest.spyOn(market, 'peekMarketQuote');
    for (const item of added) {
        const values = new Map(item.entries.map(entry => [keyOf(entry), {
            common: 100, regular: 1000, premium: 10_000, jackpot: 1_000_000
        }[item.bandByKey.get(keyOf(entry))]]));
        quote.mockImplementation((name, ref) => {
            const priceVnd = values.get(market.marketQuoteKey(name, ref?.phase));
            return priceVnd == null ? null : { source: 'buff', priceVnd };
        });
        const pricing = casePricing(item);
        expect(pricing).not.toBeNull();
        expect(pricing.entries.map(({ weight, ...entry }) => entry)).toEqual(item.entries.map(({ weight, ...entry }) => entry));
        expect(pricing.entries.map(entry => entry.weight).sort((a, b) => a - b))
            .toEqual(item.entries.map(entry => entry.weight).sort((a, b) => a - b));
        expect(pricing.values).toEqual(pricing.entries.map(entry => values.get(keyOf(entry))));
        expect(pricing.entries.reduce((sum, entry) => sum + entry.weight, 0)).toBe(TICKETS);
        const weighted = pricing.entries.reduce((sum, entry, index) => sum + BigInt(pricing.values[index]) * BigInt(entry.weight), 0n);
        const numerator = weighted * 100n * 100n;
        const denominator = BigInt(TICKETS) * 95n;
        expect(pricing.fee * denominator).toBeGreaterThanOrEqual(numerator);
        expect((pricing.fee - 1n) * denominator).toBeLessThan(numerator);
        values.delete(keyOf(item.entries.at(-1)));
        expect(casePricing(item)).toBeNull();
    }
    expect(network).not.toHaveBeenCalled();
});

test('quoted expansion variants keep every new collection theme and round-trip the exact locked snapshot', () => {
    for (const item of added) {
        const pricing = casePricing(item, () => 100);
        expect(pricing).not.toBeNull();
        expect(pricing.entries.length).toBeGreaterThan(item.entries.length);
        expect(pricing.entries.every(entry => matches(item, entry))).toBe(true);
        expect(pricing.entries.reduce((sum, entry) => sum + entry.weight, 0)).toBe(TICKETS);
        const locked = lockCasePricing(pricing);
        expect(lockedCase(item, locked).entries).toEqual(pricing.entries);
        expect(locked.values).toEqual(pricing.values);
        expect(lockedCase(item, { ...locked, revision: 'invalid' })).toBeNull();
    }
});
