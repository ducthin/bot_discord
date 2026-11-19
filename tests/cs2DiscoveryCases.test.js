const crypto = require('node:crypto');
const { skins, containersById } = require('../utils/cs2Catalogue');
const market = require('../utils/cs2Market');
const { discoveryMatches } = require('../utils/cs2DiscoveryCases');
const { TICKETS, DISCOVERY_CASE_IDS, customCases, customCasesById, casePricing,
    lockCasePricing, lockedCase, rollCustomCase } = require('../utils/cs2BattleCases');

const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const key = entry => market.marketQuoteKey(entry.ref.name, entry.ref.phase, entry.ref.paintSeed);
const added = DISCOVERY_CASE_IDS.map(id => customCasesById.get(id));
const bands = ['common', 'regular', 'premium', 'jackpot'];

afterEach(() => jest.restoreAllMocks());

test('appends 24 distinct cases while retaining all 109 published distributions and candidates', () => {
    expect(customCases).toHaveLength(169);
    expect(customCasesById.size).toBe(169);
    expect(customCases.slice(109, 133).map(item => item.id)).toEqual(DISCOVERY_CASE_IDS);
    expect(Object.isFrozen(DISCOVERY_CASE_IDS)).toBe(true);
    expect(new Set(added.map(item => item.name)).size).toBe(24);
    const previous = customCases.slice(0, 109).map(item => ({ id: item.id, entries: hash(item.entries),
        legacy: hash(item.legacyEntries), candidates: hash(item.candidates) }));
    expect(hash(previous)).toBe('26be062f6544cf8cb4f1051bf9470489f62dbe153055c96e124421ce596712d7');
    expect(added.reduce((counts, item) => {
        counts[item.group] = (counts[item.group] ?? 0) + 1;
        return counts;
    }, {})).toEqual({ weapon: 4, gold: 6, theme: 6, casual: 8 });
    expect(new Set(added.map(item => JSON.stringify(item.ticketProfile))).size).toBeGreaterThanOrEqual(12);
});

test.each(DISCOVERY_CASE_IDS)('%s stays within its advertised collection and preserves its exact profile at ticket boundaries', id => {
    const item = customCasesById.get(id);
    const matches = discoveryMatches.get(id.slice(7));
    expect(item.entries).toHaveLength(6);
    expect(Object.isFrozen(item.ticketProfile)).toBe(true);
    expect(item.ticketProfile.reduce((sum, value) => sum + value, 0)).toBe(TICKETS);
    expect(new Set(item.entries.map(key)).size).toBe(6);
    for (const entry of [...item.entries, ...item.legacyEntries, ...item.candidates]) {
        expect(matches(skins[entry.drop.skinId].name, entry.drop.tier)).toBe(true);
        expect(containersById.get(entry.drop.caseId).pools[entry.drop.tier]).toContain(entry.drop.skinId);
        if (entry.exterior === null) {
            expect(entry.min).toBeNull();
            expect(entry.max).toBeNull();
        } else expect(entry.min).toBeLessThanOrEqual(entry.max);
    }
    const counts = Object.fromEntries(bands.map(band => [band, 0]));
    let start = 0;
    jest.spyOn(crypto, 'randomBytes').mockReturnValue(Buffer.alloc(4));
    item.entries.forEach((entry, index) => {
        expect(Number.isSafeInteger(entry.weight) && entry.weight > 0).toBe(true);
        counts[item.bandByKey.get(key(entry))] += entry.weight;
        for (const ticket of [start, start + entry.weight - 1]) {
            const draw = (min, max) => max == null ? (min === TICKETS ? ticket : 0) : min;
            const result = rollCustomCase(item, item.entries.map((_, i) => i + 1), 'boundary', 1, draw);
            expect(result.value).toBe(BigInt(index + 1) * 100n);
            expect(result.drop).toMatchObject({ skinId: entry.drop.skinId, battleCaseId: id });
        }
        start += entry.weight;
    });
    expect(bands.map(band => counts[band])).toEqual(item.ticketProfile);
    expect(start).toBe(TICKETS);
    expect(item.jackpotTickets).toBe(item.ticketProfile[3]);
    if (item.group === 'gold' || item.group === 'theme') expect(item.goldTickets).toBe(TICKETS);
});

test('new cases use available quotes, preserve their collection through expansion and lock the exact distribution', () => {
    jest.spyOn(market, 'peekMarketQuote').mockReturnValue(null);
    const network = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Unexpected network request'));
    for (const item of added) {
        const priceOf = () => 100;
        const pricing = casePricing(item, priceOf);
        expect(pricing.entries.length).toBeGreaterThan(6);
        expect(pricing.entries.reduce((sum, entry) => sum + entry.weight, 0)).toBe(TICKETS);
        expect(pricing.entries.every(entry => discoveryMatches.get(item.id.slice(7))(skins[entry.drop.skinId].name, entry.drop.tier))).toBe(true);
        expect(pricing).toMatchObject({ expected: 10_000n, fee: 10_527n, profitTickets: 0, lossTickets: TICKETS });
        const saved = lockCasePricing(pricing);
        expect(lockedCase(item, saved).entries).toEqual(pricing.entries);
        expect(lockedCase(item, { ...saved, revision: 'tampered' })).toBeNull();
        const missing = key(item.entries[0]);
        expect(casePricing(item, entry => key(entry) === missing ? null : 100)).toBeNull();
    }
    expect(network).not.toHaveBeenCalled();
});

test('collection matchers reject unrelated weapons, gold and wrong finish variants', () => {
    expect(discoveryMatches.get('mag7')('Nova | Hyper Beast', 2)).toBe(false);
    expect(discoveryMatches.get('flip')('★ Butterfly Knife | Fade', 4)).toBe(false);
    expect(discoveryMatches.get('tiger-tooth')('★ Gut Knife | Fade', 4)).toBe(false);
    expect(discoveryMatches.get('silent-strike')('AK-47 | Vulcan', 3)).toBe(false);
    expect(discoveryMatches.get('ct-loadout')('Glock-18 | Bullet Queen', 3)).toBe(false);
    expect(discoveryMatches.get('t-loadout')('USP-S | Printstream', 3)).toBe(false);
    expect(discoveryMatches.get('pistol-premium')('P250 | Cassette', 0)).toBe(false);
    expect(discoveryMatches.get('orange-white')('★ Bayonet | Fade', 4)).toBe(false);
});
