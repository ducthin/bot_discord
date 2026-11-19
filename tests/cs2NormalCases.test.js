const { cases: discordCases, skins, terminals, collections } = require('../utils/cs2Catalogue');
const { normalCasesById, caseEntries, rollDrop } = require('../utils/cs2NormalCases');

test('includes exactly the cases openable in Discord, with every skin and its tier odds', () => {
    expect([...normalCasesById.values()]).toEqual(discordCases);
    const expectedTierWeights = [3125, 625, 125, 25, 10];
    for (const item of discordCases) {
        const entries = caseEntries(item);
        expect(entries.map(entry => entry.skinId)).toEqual(item.pools.flat());
        expect(entries.reduce((sum, entry) => sum + entry.chance, 0)).toBeCloseTo(100, 10);
        for (let tier = 0; tier < item.pools.length; tier++) {
            const odds = entries.filter(entry => entry.tier === tier);
            const expected = expectedTierWeights[tier] / 3910 * 100 / odds.length;
            expect(odds.every(entry => Math.abs(entry.chance - expected) < 1e-10)).toBe(true);
        }
    }
    expect([...terminals, ...collections].every(item => !normalCasesById.has(item.id))).toBe(true);
});

test('rolls a special drop with the same case provenance and finish data as Discord', () => {
    const item = normalCasesById.get('crate-4904');
    const skinId = item.pools[4][1];
    const draw = jest.fn().mockReturnValueOnce(3900).mockReturnValueOnce(1)
        .mockReturnValueOnce(123456).mockReturnValueOnce(0).mockReturnValueOnce(1000);
    const drop = rollDrop(item, 'receipt', 123, draw);
    expect(drop).toMatchObject({ id: 'receipt', caseId: item.id, skinId, tier: 4, acquiredAt: 123,
        float: 0.123456, statTrak: true, paintSeed: 1000 });
    expect(draw.mock.calls).toEqual([[3910], [item.pools[4].length],
        [Math.round(skins[skinId].min * 1_000_000), Math.round(skins[skinId].max * 1_000_000) + 1], [10], [1001]]);
});
