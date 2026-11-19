const {
    getCaseMarketHashName, isCaseMarketHashName, getKeyMarketHashName, getDropMarketHashName
} = require('../utils/cs2MarketNames');

test('resolves exact Steam case names and only the tradable key catalogue', () => {
    expect(getCaseMarketHashName('crate-4010')).toBe('CS:GO Weapon Case 3');
    expect(getCaseMarketHashName('crate-4818')).toBe('Dreams & Nightmares Case');
    expect(getKeyMarketHashName('key-1204')).toBe('eSports Key');
    expect(getKeyMarketHashName('key-1385')).toBe('CS20 Case Key');
    expect(getKeyMarketHashName('key-1384')).toBeNull();
    expect(getKeyMarketHashName('key-7008')).toBeNull();
    expect(getCaseMarketHashName('unknown')).toBeNull();
});

test('uses the sealed Terminal and its individual offers as Steam market names', () => {
    expect(getCaseMarketHashName('crate-5176')).toBe('Sealed Genesis Terminal');
    expect(getCaseMarketHashName('crate-5181')).toBe('Sealed Dead Hand Terminal');
    expect(isCaseMarketHashName('Sealed Dead Hand Terminal')).toBe(true);
    expect(getDropMarketHashName({ skinId: 'skin-e8ce6f07d5e7', float: 0.2, statTrak: true }))
        .toBe('StatTrak™ SCAR-20 | Caged (Field-Tested)');
    expect(getDropMarketHashName({ skinId: 'skin-b8f492474850', float: 0.06, statTrak: false }))
        .toBe('★ Driver Gloves | Brocade Crane (Factory New)');
});

test.each([
    [0.069999, 'Factory New'], [0.07, 'Minimal Wear'], [0.15, 'Field-Tested'],
    [0.379999, 'Field-Tested'], [0.38, 'Well-Worn'],
    [0.449999, 'Well-Worn'], [0.45, 'Battle-Scarred']
])('uses the correct Steam exterior for float %s', (float, wear) => {
    expect(getDropMarketHashName({ skinId: 'skin-5626422553f8', float, statTrak: true }))
        .toBe(`StatTrak™ M4A4 | Choppa (${wear})`);
});

test('keeps the knife prefix, groups Doppler phases, and leaves vanilla knives wear-free', () => {
    for (const skinId of ['skin-48064d096b19', 'skin-b0db8f2d815b']) {
        expect(getDropMarketHashName({ skinId, float: 0.075, statTrak: true }))
            .toBe('★ StatTrak™ Survival Knife | Doppler (Minimal Wear)');
    }
    expect(getDropMarketHashName({ skinId: 'skin-bd871a344e30', float: 0.01 }))
        .toBe('★ Bowie Knife | Gamma Doppler (Factory New)');
    expect(getDropMarketHashName({ skinId: 'skin-vanilla-weapon_knife_karambit', float: null, statTrak: true }))
        .toBe('★ StatTrak™ Karambit');
});

test('leaves unsupported legacy and invalid rolls unpriced', () => {
    expect(getDropMarketHashName({ skinId: 'glock-signal', float: 0.15 })).toBeNull();
    expect(getDropMarketHashName({ skinId: 'constructor', float: 0.15 })).toBeNull();
    expect(getDropMarketHashName({ skinId: 'skin-5626422553f8' })).toBeNull();
    expect(getDropMarketHashName({ skinId: 'skin-48064d096b19', float: 0.9 })).toBeNull();
    expect(getDropMarketHashName({ skinId: 'skin-7b51c8bd957b', float: 0.2, statTrak: true })).toBeNull();
});
