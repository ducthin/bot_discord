const { cases, terminals, skins } = require('../utils/cs2Catalogue');
const { tradeUpGroups, isTradeUpInput, buildTradeUp, drawTradeUp } = require('../utils/cs2TradeUp');

const caseByName = name => cases.find(weaponCase => weaponCase.name === name);
const kilowatt = caseByName('Kilowatt Case');
const weaponCase = caseByName('CS:GO Weapon Case');
const glove = caseByName('Glove Case');
const chroma = caseByName('Chroma Case');
const huntsman = caseByName('Huntsman Weapon Case');
const [genesis, deadHand] = terminals;

function inputs(source, tier, count, { statTrak = false, atMax = false } = {}) {
    const skinId = source.pools[tier][0];
    const skin = skins[skinId];
    return Array.from({ length: count }, (_, index) => ({
        id: `${source.id}-${tier}-${statTrak}-${index}`, caseId: source.id, skinId, tier,
        float: atMax ? skin.max : skin.min, statTrak
    }));
}

test('10 inputs weight each collection by item count and normalize each skin before averaging', () => {
    const selected = [...inputs(kilowatt, 0, 7), ...inputs(weaponCase, 0, 3, { atMax: true })];
    const plan = buildTradeUp(selected);
    expect(plan).toMatchObject({ required: 10, tier: 0, statTrak: false });
    expect(plan.sources.map(({ caseId, count, outcomes }) => [caseId, count, outcomes.length])).toEqual([
        [kilowatt.id, 7, 5], [weaponCase.id, 3, 3]
    ]);

    const lastKilowattTicket = jest.fn().mockReturnValueOnce(6).mockReturnValueOnce(4);
    expect(drawTradeUp(plan, lastKilowattTicket)).toMatchObject({ caseId: kilowatt.id, tier: 1, statTrak: false });
    expect(lastKilowattTicket.mock.calls).toEqual([[10], [5]]);
    const firstWeaponCaseTicket = jest.fn().mockReturnValueOnce(7).mockReturnValueOnce(0);
    expect(drawTradeUp(plan, firstWeaponCaseTicket)).toEqual({
        caseId: weaponCase.id, skinId: weaponCase.pools[1][0], tier: 1, float: 0.024, statTrak: false
    });
    expect(firstWeaponCaseTicket.mock.calls).toEqual([[10], [3]]);
});

test('5 normal Coverts select the source case gold pool, including gloves', () => {
    const plan = buildTradeUp([...inputs(kilowatt, 3, 3), ...inputs(glove, 3, 2, { atMax: true })]);
    expect(plan).toMatchObject({ required: 5, tier: 3, statTrak: false });
    const randomInt = jest.fn().mockReturnValueOnce(3).mockReturnValueOnce(0);
    expect(drawTradeUp(plan, randomInt)).toEqual({
        caseId: glove.id, skinId: glove.pools[4][0], tier: 4, float: 0.356, statTrak: false
    });
    expect(randomInt.mock.calls).toEqual([[5], [24]]);
});

test('Terminal skins use their own collection in contracts and respect the glove pool', () => {
    expect(buildTradeUp(inputs(genesis, 0, 10, { statTrak: true })).sources[0].outcomes.map(({ skinId }) => skinId))
        .toEqual(genesis.pools[1]);
    expect(isTradeUpInput(inputs(genesis, 3, 1)[0])).toBe(false);
    expect(isTradeUpInput(inputs(deadHand, 3, 1, { statTrak: true })[0])).toBe(false);
    expect(buildTradeUp(inputs(deadHand, 3, 5)).sources[0].outcomes.map(({ skinId }) => skinId))
        .toEqual(deadHand.pools[4]);
});

test('StatTrak contracts preserve quality and exclude glove-only sources', () => {
    const knifeInputs = inputs(kilowatt, 3, 5, { statTrak: true });
    const gloveInputs = inputs(glove, 3, 1, { statTrak: true });
    expect(isTradeUpInput(gloveInputs[0])).toBe(false);
    expect(() => buildTradeUp([...knifeInputs.slice(0, 4), ...gloveInputs])).toThrow('không đủ điều kiện');
    const plan = buildTradeUp(knifeInputs);
    expect(plan.sources[0].outcomes.every(({ skinId }) => skins[skinId].stattrak)).toBe(true);
    const vanilla = plan.sources[0].outcomes.findIndex(outcome => outcome.float === null);
    expect(vanilla).toBeGreaterThanOrEqual(0);
    expect(drawTradeUp(plan, jest.fn().mockReturnValueOnce(0).mockReturnValueOnce(vanilla)))
        .toMatchObject({ tier: 4, float: null, statTrak: true });
    const normalStatTrak = buildTradeUp(inputs(kilowatt, 2, 10, { statTrak: true }));
    expect(drawTradeUp(normalStatTrak, () => 0)).toMatchObject({ tier: 3, statTrak: true });
});

test('Doppler variants split the chosen base finish and never add extra finish tickets', () => {
    const plan = buildTradeUp(inputs(chroma, 3, 5));
    const { outcomes } = plan.sources[0];
    expect(outcomes).toHaveLength(30);
    const doppler = outcomes.findIndex(outcome => skins[outcome.skinId].name === '★ Karambit | Doppler');
    const { variants } = outcomes[doppler];
    expect(variants.map(({ skinId }) => skins[skinId].phase)).toEqual([
        'Ruby', 'Sapphire', 'Black Pearl', 'Phase 1', 'Phase 2', 'Phase 3', 'Phase 4'
    ]);
    const randomInt = jest.fn().mockReturnValueOnce(0).mockReturnValueOnce(doppler).mockReturnValueOnce(6);
    expect(drawTradeUp(plan, randomInt)).toEqual(variants[6]);
    expect(randomInt.mock.calls).toEqual([[5], [30], [7]]);
});

test('collection-only Huntsman outputs can be crafted and used in later contracts', () => {
    const restricted = buildTradeUp(inputs(huntsman, 0, 10)).sources[0].outcomes;
    const curse = restricted.find(({ skinId }) => skins[skinId].name === 'MAC-10 | Curse');
    expect(curse).toMatchObject({ caseId: huntsman.id, tier: 1 });
    expect(isTradeUpInput({ ...curse, id: 'previous-contract' })).toBe(true);
    const selected = [{ ...curse, id: 'previous-contract' }, ...inputs(huntsman, 1, 9)];
    const classified = buildTradeUp(selected).sources[0].outcomes;
    expect(classified.map(({ skinId }) => skins[skinId].name)).toContain('USP-S | Orion');
});

test('rejects invalid, repeated, mixed-quality, mixed-rarity and wrong-count inputs', () => {
    const normal = inputs(kilowatt, 0, 10);
    const tracked = inputs(kilowatt, 0, 1, { statTrak: true });
    const higher = inputs(kilowatt, 1, 1);
    const invalid = { ...normal[0], id: 'bad-float', float: 0.99 };
    const wrongCase = { ...normal[0], id: 'bad-case', caseId: glove.id };
    const gold = { ...drawTradeUp(buildTradeUp(inputs(kilowatt, 3, 5)), () => 0), id: 'gold' };
    expect(tradeUpGroups([...normal, normal[0], ...tracked, ...higher, invalid, wrongCase, gold])).toEqual([
        { tier: 0, statTrak: false, required: 10, count: 10 },
        { tier: 0, statTrak: true, required: 10, count: 1 },
        { tier: 1, statTrak: false, required: 10, count: 1 }
    ]);
    expect(() => buildTradeUp(normal.slice(0, 9))).toThrow('đúng 10');
    expect(() => buildTradeUp(inputs(kilowatt, 3, 4))).toThrow('đúng 5');
    expect(() => buildTradeUp([...normal.slice(0, 9), normal[0]])).toThrow('một lần');
    expect(() => buildTradeUp([...normal.slice(0, 9), ...tracked])).toThrow('cùng độ hiếm');
    expect(() => buildTradeUp([...normal.slice(0, 9), ...higher])).toThrow('cùng độ hiếm');
    expect(() => buildTradeUp([...normal.slice(0, 9), invalid])).toThrow('không đủ điều kiện');
    expect(() => buildTradeUp([...normal.slice(0, 9), wrongCase])).toThrow('không đủ điều kiện');
});

test('locked skins cannot be counted, selected or consumed by a Trade Up plan', () => {
    const selected = inputs(kilowatt, 0, 10);
    const locked = { ...selected[0], locked: true };
    expect(isTradeUpInput(locked)).toBe(false);
    expect(tradeUpGroups([locked, ...selected.slice(1)])).toEqual([
        { tier: 0, statTrak: false, required: 10, count: 9 }
    ]);
    expect(() => buildTradeUp([locked, ...selected.slice(1)])).toThrow('không đủ điều kiện');
    expect(isTradeUpInput({ ...locked, locked: false })).toBe(true);
    expect(buildTradeUp(selected).required).toBe(10);
});
