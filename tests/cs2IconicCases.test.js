const crypto = require('node:crypto');
const { skins, collections, cases } = require('../utils/cs2Catalogue');
const { iconicMatches } = require('../utils/cs2IconicCases');
const market = require('../utils/cs2Market');
const { ICONIC_CASE_IDS, customCases, customCasesById, TICKETS, casePricing,
    lockCasePricing, lockedCase, rollCustomCase } = require('../utils/cs2BattleCases');

const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const key = entry => market.marketQuoteKey(entry.ref.name, entry.ref.phase, entry.ref.paintSeed);
const added = ICONIC_CASE_IDS.map(id => customCasesById.get(id));
afterEach(() => jest.restoreAllMocks());

test('appends 36 iconic cases and preserves all 133 previous distributions and candidates', () => {
    expect(customCases).toHaveLength(169);
    expect(customCases.slice(133).map(item => item.id)).toEqual(ICONIC_CASE_IDS);
    expect(Object.isFrozen(ICONIC_CASE_IDS)).toBe(true);
    const previous = customCases.slice(0, 133).map(item => ({ id: item.id, entries: hash(item.entries),
        legacy: hash(item.legacyEntries), candidates: hash(item.candidates) }));
    expect(hash(previous)).toBe('58861b5ac7ab90dd429dd0dc29985f2d2972d963db03f16dae99a11b529c7156');
    expect(new Set(added.map(item => item.name)).size).toBe(36);
    const available = new Set(added.flatMap(item => item.candidates.map(entry => entry.drop.skinId)));
    for (const source of collections) for (const id of source.pools.flat()) expect(available.has(id)).toBe(true);
    expect(cases).toHaveLength(42);
    expect(cases.some(source => source.pools.flat().includes('skin-8aacf99e7f2f'))).toBe(false);
});

test.each(ICONIC_CASE_IDS)('%s draws exactly its published groups and locks supported quote variants', id => {
    jest.spyOn(market, 'peekMarketQuote').mockReturnValue(null);
    jest.spyOn(crypto, 'randomBytes').mockReturnValue(Buffer.alloc(4));
    const item = customCasesById.get(id);
    const matches = iconicMatches.get(id.slice(7));
    expect(item.entries).toHaveLength(6);
    expect(new Set(item.entries.map(key)).size).toBe(6);
    expect(item.entries.every(matches)).toBe(true);
    expect(item.candidates.every(matches)).toBe(true);
    const counts = { common: 0, regular: 0, premium: 0, jackpot: 0 };
    let start = 0;
    for (const [index, entry] of item.entries.entries()) {
        counts[item.bandByKey.get(key(entry))] += entry.weight;
        for (const ticket of [start, start + entry.weight - 1]) {
            const draw = (min, max) => max == null ? min === TICKETS ? ticket : 0 : min;
            const result = rollCustomCase(item, item.entries.map((_, i) => i + 1), 'iconic', 1, draw);
            expect(result.drop).toMatchObject({ skinId: entry.drop.skinId, caseId: entry.drop.caseId, battleCaseId: id });
            expect(result.value).toBe(BigInt(index + 1) * 100n);
            expect(result.drop.float).toBeGreaterThanOrEqual(skins[result.drop.skinId].min);
            expect(result.drop.float).toBeLessThanOrEqual(skins[result.drop.skinId].max);
        }
        start += entry.weight;
    }
    expect(start).toBe(TICKETS);
    expect(Object.values(counts)).toEqual(item.ticketProfile);
    const pricing = casePricing(item, () => 100);
    expect(pricing).toMatchObject({ expected: 10_000n, fee: 10_527n });
    expect(pricing.entries.every(matches)).toBe(true);
    expect(lockedCase(item, lockCasePricing(pricing)).entries).toEqual(pricing.entries);
    expect(casePricing(item, entry => key(entry) === key(item.entries[0]) ? null : 100)).toBeNull();
});

test('Howl has real normal/StatTrak variants and publishes actual priced hunting-group tickets', () => {
    const howl = customCasesById.get('battle-howl');
    expect(howl.candidates).toHaveLength(8);
    for (const entry of [...howl.entries, ...howl.candidates]) {
        expect(skins[entry.drop.skinId].rarity).toBe('Contraband');
        expect(entry.exterior).toBeLessThan(4);
    }
    const hunt = customCasesById.get('battle-howl-hunt');
    expect(hunt.jackpotTickets).toBe(100);
    expect(hunt.entries.filter(entry => skins[entry.drop.skinId].rarity === 'Contraband')
        .reduce((sum, entry) => sum + entry.weight, 0)).toBe(100);
    expect(hunt.candidates.every(entry => skins[entry.drop.skinId].name.startsWith('M4A4 | '))).toBe(true);
    // Expansion keeps real Howl variants; the final quoted ticket assignment
    // supplies the actual hunting-group odds rather than the source profile.
    jest.spyOn(market, 'peekMarketQuote').mockReturnValue(null);
    const expanded = casePricing(hunt, () => 100);
    const howlTickets = expanded.entries.filter(entry => skins[entry.drop.skinId].rarity === 'Contraband')
        .reduce((sum, entry) => sum + entry.weight, 0);
    expect(expanded.jackpotTickets).toBe(howlTickets);
    expect(expanded.bandTickets.jackpot).toBe(howlTickets);
    expect(expanded.ticketProfile.reduce((sum, tickets) => sum + tickets, 0)).toBe(TICKETS);
    expect(expanded.entries.every(entry => hunt.candidates.some(candidate => key(candidate) === key(entry)) ||
        hunt.entries.some(candidate => key(candidate) === key(entry)))).toBe(true);
    const emerald = customCasesById.get('battle-archive-train-2021').entries.at(-1);
    expect(emerald.ref.phase).toBe('Emerald');
});
