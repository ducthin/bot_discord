const cases = require('../utils/cs2BattleCases');
const { VERSION, exclusivePlan, describeExclusive, rollExclusiveCase } = require('../utils/playerExclusiveDrop');

function pricingWith(weights) {
    const entries = weights.map((weight, index) => ({ weight, drop: { skinId: 'skin-' + index } }));
    const remainder = cases.TICKETS - weights.reduce((sum, weight) => sum + weight, 0);
    entries.push({ weight: remainder, drop: { skinId: 'common' } });
    return { fee: 10n, entries, values: entries.map((_, index) => index === entries.length - 1 ? 1 : 100) };
}

test('new Exclusive Drop odds are capped at 0.2% per opening', () => {
    const pricing = pricingWith([10, 5, 5]);
    const plan = exclusivePlan(pricing);
    const description = describeExclusive(pricing, (drop, value) => ({ ...drop, value: value.toString() }));

    expect(VERSION).toBe(2);
    expect(plan.weight).toBe(20);
    expect(description).toMatchObject({ version: 2, available: true, chance: 0.2, trigger: { chance: 0.2 } });
    expect(description.items.map(item => item.overallChance)).toEqual([0.1, 0.05, 0.05]);
});

test('version 1 plans retain their prior 10% odds for battles already waiting', () => {
    const pricing = pricingWith(Array(12).fill(100));
    const plan = exclusivePlan(pricing, 1);
    const description = describeExclusive(pricing, (drop, value) => ({ ...drop, value: value.toString() }), 1);

    expect(plan.weight).toBe(1000);
    expect(description).toMatchObject({ version: 1, available: true, chance: 10, trigger: { chance: 10 } });
    expect(exclusivePlan(pricing)).toBeNull();
});

test('the new trigger threshold rolls exactly on its published 0.2% boundary', () => {
    const pricing = pricingWith([10, 5, 5]);
    const locked = { entries: pricing.entries };
    const drawUnder = jest.fn(() => 9979);
    const regular = rollExclusiveCase(locked, pricing, 'regular', 1, drawUnder);
    expect(regular.exclusive).toBeUndefined();

    const values = [9980, 0, 0, 0, 0];
    const drawAt = jest.fn(() => values.shift() ?? 0);
    const exclusive = rollExclusiveCase(locked, pricing, 'exclusive', 1, drawAt);
    expect(exclusive.exclusive).toMatchObject({ triggered: true, version: 2, chance: 0.2, entryIndex: 0 });
});
