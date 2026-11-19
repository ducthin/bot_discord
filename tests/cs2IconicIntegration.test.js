const { cases, collections, containersById, skins } = require('../utils/cs2Catalogue');
const { tradeUpPool } = require('../utils/cs2TradeUpCatalogue');
const { isTradeUpInput, buildTradeUp, drawTradeUp } = require('../utils/cs2TradeUp');
const upgrade = require('../utils/cs2Upgrade');
const market = require('../utils/cs2Market');
const playerMarket = require('../utils/cs2PlayerMarket');

const howlId = Object.keys(skins).find(id => skins[id].name === 'M4A4 | Howl');
const dragonId = Object.keys(skins).find(id => skins[id].name === 'AWP | Dragon Lore');
const howlSource = containersById.get('special-contraband');
const cobblestone = collections.find(source => source.pools[3].includes(dragonId));
const drop = (source, skinId, tier, id = skinId) => ({ id, caseId: source.id, skinId, tier,
    float: Math.round(skins[skinId].min * 1_000_000) / 1_000_000, statTrak: false });

afterEach(() => jest.restoreAllMocks());

test('Howl is excluded as both a contract input and a potential output', () => {
    for (const statTrak of [false, true]) {
        const howl = { ...drop(howlSource, howlId, 3), statTrak };
        expect(isTradeUpInput(howl)).toBe(false);
        expect(() => buildTradeUp(Array.from({ length: 5 }, (_, index) => ({ ...howl, id: String(index) }))))
            .toThrow('không đủ điều kiện');
    }
    expect(tradeUpPool(howlSource, 3)).toEqual([]);
    // Skin metadata also blocks it if another source accidentally references it.
    expect(tradeUpPool({ id: 'test-source', pools: [[], [], [], [howlId]] }, 3)).toEqual([]);
    expect(cases.every(source => !source.pools.flat().includes(howlId))).toBe(true);
});

test('collection contracts can produce Dragon Lore while top collection skins have no gold upgrade', () => {
    const knightId = cobblestone.pools[2][0];
    const inputs = Array.from({ length: 10 }, (_, index) => drop(cobblestone, knightId, 2, `knight-${index}`));
    const plan = buildTradeUp(inputs);
    expect(plan.sources).toHaveLength(1);
    expect(plan.sources[0].outcomes.map(result => result.skinId)).toEqual([dragonId]);
    const dragon = drawTradeUp(plan, () => 0);
    expect(dragon).toMatchObject({ skinId: dragonId, caseId: cobblestone.id, tier: 3, statTrak: false });
    expect(isTradeUpInput({ ...dragon, id: 'dragon' })).toBe(false);
    expect(isTradeUpInput({ ...inputs[0], statTrak: true })).toBe(false);
});

test('Upgrade includes every valid Howl exterior and quality and validates its inventory source', () => {
    const targets = upgrade.targetCatalogue().filter(target => target.skinId === howlId);
    expect(targets).toHaveLength(8);
    expect(new Set(targets.map(target => target.wear))).toEqual(new Set([
        'Factory New', 'Minimal Wear', 'Field-Tested', 'Well-Worn'
    ]));
    expect(targets.every(target => target.maxFloat <= 0.4 && target.caseId === howlSource.id)).toBe(true);
    const howl = { ...drop(howlSource, howlId, 3), statTrak: true };
    const dragon = drop(cobblestone, dragonId, 3);
    expect(upgrade.eligibleInputs({ drops: [howl, dragon] })).toEqual([howl, dragon]);
    expect(upgrade.eligibleInputs({ drops: [{ ...howl, caseId: cobblestone.id }, { ...dragon, float: 1.1 }] })).toEqual([]);
    const now = Date.now();
    jest.spyOn(market, 'peekMarketQuote').mockReturnValue({ priceVnd: 100_000, source: 'buff', phase: null,
        observedAt: now - 1_000, expiresAt: now + 60_000 });
    expect(upgrade.preview({ targetId: targets[0].id, coinStake: 1_000_000n }, now))
        .toMatchObject({ status: 'ready', targetValue: 10_000_000n, winTickets: 9_500 });
});

test('player market accepts real collection skins and rejects forged source or tier', () => {
    const listing = skin => ({ id: '501', sellerId: '13', drop: skin, price: '10000', createdAt: 1 });
    for (const skin of [drop(howlSource, howlId, 3), drop(cobblestone, dragonId, 3)]) {
        const valid = listing(skin);
        expect(playerMarket.getListing({ cs2PlayerMarket: { '501': valid } }, '501')).toBe(valid);
        for (const fake of [{ ...skin, caseId: cases[0].id }, { ...skin, tier: 0 }]) {
            expect(playerMarket.getListings({ cs2PlayerMarket: { '501': listing(fake) } })).toEqual([]);
        }
    }
    const huntsman = containersById.get('crate-4017');
    for (const [skinId, tier] of [['skin-c928639d51cb', 1], ['skin-a503e5d8d0b7', 2]]) {
        const successor = listing(drop(huntsman, skinId, tier));
        expect(playerMarket.getListing({ cs2PlayerMarket: { '501': successor } }, '501')).toBe(successor);
    }
});
