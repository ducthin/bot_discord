const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const hom = require('../commands/hom');
const store = require('../utils/managementStore');
const market = require('../utils/cs2Market');
const { cases, skins } = require('../utils/cs2Catalogue');

const weaponCase = cases.find(item => item.id === 'crate-4904');
const skinId = weaponCase.pools[0][0];
const guild = { id: '1' };
const user = { id: '13' };
let directory;
let disk;
let original;
let counter = 9000;
const drop = id => ({ id, caseId: weaponCase.id, skinId, tier: 0,
    float: Math.round((skins[skinId].min + skins[skinId].max) / 2 * 1_000_000) / 1_000_000 });
const request = (customId, extra = {}) => ({ id: String(++counter), customId, guild, guildId: guild.id, user,
    message: { id: '800' }, deferReply: jest.fn(), deferUpdate: jest.fn(), reply: jest.fn(), editReply: jest.fn(),
    followUp: jest.fn(), ...extra });

beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hom-scoped-'));
    disk = store.createManagementStore(directory);
    jest.spyOn(store, 'read').mockImplementation(disk.read);
    jest.spyOn(store, 'transact').mockImplementation(disk.transact);
    jest.spyOn(require('../utils/cs2Reel'), 'warmCaseReel').mockImplementation(() => {});
    jest.spyOn(market, 'peekMarketDisplay').mockReturnValue({ status: 'snapshot-missing', quote: null });
    await disk.transact(guild.id, async (state, save) => {
        state.settings = { taixiuRoom: { channelId: '20' }, preserved: true };
        state.taixiu = { balances: { 13: 200_000, 14: 321_000 }, round: { id: 'round', bets: {} },
            dailyClaimTimes: { 13: 1, 14: 2 } };
        state.skinCases = { 13: { drops: [drop('own')] }, 14: {
            drops: Array.from({ length: 200 }, (_, index) => drop(`other-${index}`)), cases: { [weaponCase.id]: 100 }
        } };
        state.cs2PlayerMarket = { 700: { id: '700', sellerId: '14', drop: drop('listed'), price: '10000', createdAt: 1 } };
        await save();
    });
    original = await disk.read(guild.id);
});

afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(directory, { recursive: true, force: true });
});

test('buying and locking only updates the caller while preserving another inventory and the active bakery round', async () => {
    const home = request();
    await hom.execute(home);
    const readState = await store.read.mock.results[0].value;
    expect(Object.keys(readState.skinCases)).toEqual(['13']);
    expect(Object.keys(readState.taixiu.balances)).toEqual(['13']);
    expect(readState.taixiu.round).toBeNull();
    expect(readState.cs2PlayerMarket).toBeUndefined();

    await hom.button(request(`mg_hom_key_${weaponCase.id}_60000_xu1`));
    await hom.button(request(`mg_hom_lock-drop_${weaponCase.id}_own`));
    const saved = await disk.read(guild.id);
    expect(saved.taixiu.balances['13']).toBe(140_000);
    expect(saved.skinCases['13'].keys[weaponCase.key]).toBe(1);
    expect(saved.skinCases['13'].drops[0].locked).toBe(true);
    expect(saved.skinCases['14']).toEqual(original.skinCases['14']);
    expect(saved.taixiu.round).toEqual(original.taixiu.round);
    expect(saved.taixiu.dailyClaimTimes).toEqual(original.taixiu.dailyClaimTimes);
    expect(saved.taixiu.balances['14']).toBe(original.taixiu.balances['14']);
    expect(saved.settings).toEqual(original.settings);
    expect(saved.cs2PlayerMarket).toEqual(original.cs2PlayerMarket);
});

test('the market still lists other players while reading no inventories', async () => {
    const panel = request(`mg_hom_market_${weaponCase.id}_0`);
    await hom.button(panel);
    const state = await store.read.mock.results.at(-1).value;
    expect(state.skinCases).toBeUndefined();
    expect(state.cs2PlayerMarket['700'].sellerId).toBe('14');
    const menu = panel.editReply.mock.calls.at(-1)[0].components.flatMap(row => row.toJSON().components)
        .find(component => component.custom_id?.startsWith('mg_hom_market-select_'));
    expect(menu.options.map(option => option.value)).toContain('700');
});
