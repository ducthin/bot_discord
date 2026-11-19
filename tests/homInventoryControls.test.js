const { SORT_ORDERS, normalizeSort, sortDrops } = require('../utils/cs2InventoryOrder');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const hom = require('../commands/hom');
const store = require('../utils/managementStore');
const market = require('../utils/cs2Market');
const { cases, skins } = require('../utils/cs2Catalogue');
const { getDropMarketHashName } = require('../utils/cs2MarketNames');

const guild = { id: '1' };
const user = { id: '13' };
const weaponCase = cases.find(item => item.id === 'crate-4904');
const skinId = weaponCase.pools[0].find(id => skins[id].min === 0 && skins[id].max === 1);
let directory;
let disk;
let counter = 60000;

beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-inventory-controls-'));
    disk = store.createManagementStore(directory);
    jest.spyOn(store, 'read').mockImplementation(disk.read);
    jest.spyOn(store, 'transact').mockImplementation(disk.transact);
    const quote = name => ({ priceVnd: name?.includes('Factory New') ? 300 : 100,
        expiresAt: Date.now() + 300000, observedAt: Date.now(), source: 'buff', url: market.BUFF_MARKET_URL });
    jest.spyOn(market, 'peekMarketQuote').mockImplementation(quote);
    jest.spyOn(market, 'peekMarketDisplay').mockImplementation(name => ({ status: 'fresh', quote: quote(name) }));
});

afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(directory, { recursive: true, force: true });
});

const item = (id, float = 0.25, extra = {}) => ({ id: String(id), caseId: weaponCase.id, skinId, tier: 0, float, ...extra });
const request = (customId, extra = {}) => ({ id: String(++counter), customId, guild, guildId: guild.id, user,
    message: { id: 'controls' }, reply: jest.fn(), followUp: jest.fn(), editReply: jest.fn(), deferUpdate: jest.fn(), ...extra });
const payload = interaction => interaction.editReply.mock.calls.at(-1)?.[0];
const controls = interaction => payload(interaction).components.flatMap(row => row.toJSON().components);
const control = (interaction, action) => controls(interaction).find(component => component.custom_id?.startsWith(`mg_hom_${action}_`));
async function click(id, extra) { const interaction = request(id, extra); await hom.button(interaction); return interaction; }
async function select(id, values, extra) { const interaction = request(id, { values, ...extra }); await hom.select(interaction); return interaction; }
async function stash(items, extra = {}) {
    await disk.transact(guild.id, async (state, save) => {
        state.taixiu.balances[user.id] = 1000;
        state.skinCases = { [user.id]: { drops: items, ...extra } };
        await save();
    });
}
const inventory = () => click(`mg_hom_inventory_${weaponCase.id}_0`);

function validPanel(interaction) {
    expect(payload(interaction).components.length).toBeLessThanOrEqual(5);
    for (const row of payload(interaction).components) expect(row.toJSON().components.length).toBeLessThanOrEqual(5);
}

const drops = [
    { id: 'old', tier: 1, float: 0.25, acquiredAt: 10 },
    { id: 'new', tier: 1, float: 0.10, acquiredAt: 20 },
    { id: 'gold', tier: 4, float: null, acquiredAt: 5 },
    { id: 'unknown', tier: 2, float: 0.4, acquiredAt: 30 }
];

test('inventory sort orders use stable newest tie breakers and keep unknown values last', () => {
    expect(normalizeSort('invalid')).toBe('tier-desc');
    expect(Object.keys(SORT_ORDERS)).toEqual(expect.arrayContaining(['float-asc', 'price-desc', 'tier-asc', 'newest']));
    expect(sortDrops(drops, 'tier-desc').map(drop => drop.id)).toEqual(['gold', 'unknown', 'new', 'old']);
    expect(sortDrops(drops, 'float-asc').map(drop => drop.id)).toEqual(['new', 'old', 'unknown', 'gold']);
    expect(sortDrops(drops, 'float-desc').map(drop => drop.id)).toEqual(['unknown', 'old', 'new', 'gold']);
    expect(sortDrops(drops, 'newest').map(drop => drop.id)).toEqual(['unknown', 'new', 'old', 'gold']);
});

test('price sort compares BigInt values exactly and puts missing quotes last', () => {
    const prices = { old: 100000000000000000001n, new: 2n, gold: null, unknown: 100000000000000000000n };
    expect(sortDrops(drops, 'price-asc', drop => prices[drop.id]).map(drop => drop.id))
        .toEqual(['new', 'unknown', 'old', 'gold']);
    expect(sortDrops(drops, 'price-desc', drop => prices[drop.id]).map(drop => drop.id))
        .toEqual(['old', 'unknown', 'new', 'gold']);
});

test('sort never mutates the stored drop array', () => {
    const original = [...drops];
    sortDrops(drops, 'float-asc');
    expect(drops).toEqual(original);
});

test('mixed dated and legacy undated drops always have a transitive newest tie order', () => {
    const mixed = [{ id: 'new', tier: 1, acquiredAt: 200 }, { id: 'undated', tier: 1 }, { id: 'old', tier: 1, acquiredAt: 100 }];
    for (const order of ['newest', 'tier-desc', 'price-asc']) {
        expect(sortDrops(mixed, order, () => 1n).map(drop => drop.id)).toEqual(['new', 'old', 'undated']);
    }
});

test('inventory sorting persists across reopening and applies float, price and tier order to item controls', async () => {
    const low = item('low', 0.01);
    const high = item('high', 0.9);
    const middle = item('middle', 0.25);
    await stash([low, high, middle]);
    let panel = await inventory();
    panel = await select(control(panel, 'inventory-sort').custom_id, ['float-asc']);
    validPanel(panel);
    expect(control(panel, 'inventory-select').options.map(option => option.value)).toEqual(['drop_low', 'drop_middle', 'drop_high']);
    expect((await disk.read(guild.id)).skinCases[user.id].inventorySort).toBe('float-asc');
    panel = await inventory();
    expect(control(panel, 'inventory-sort').options.find(option => option.default).value).toBe('float-asc');
    panel = await select(control(panel, 'inventory-sort').custom_id, ['price-desc']);
    expect(control(panel, 'inventory-select').options[0].value).toBe('drop_low');
    expect(getDropMarketHashName(low)).toContain('Factory New');
    panel = await select(control(panel, 'inventory-sort').custom_id, ['tier-asc']);
    expect(control(panel, 'inventory-sort').options.find(option => option.default).value).toBe('tier-asc');
});

test('locking an owned item persists, disables sale and listing, and unlocking restores the controls', async () => {
    await stash([item('keep')]);
    let panel = await inventory();
    panel = await select(control(panel, 'inventory-select').custom_id, ['drop_keep']);
    panel = await click(control(panel, 'lock-drop').custom_id);
    validPanel(panel);
    expect((await disk.read(guild.id)).skinCases[user.id].drops[0].locked).toBe(true);
    expect(payload(panel).embeds[0].data.description).toContain('Đã khóa');
    expect(control(panel, 'sell').disabled).toBe(true);
    expect(control(panel, 'market-list').disabled).toBe(true);
    panel = await click(control(panel, 'unlock-drop').custom_id);
    expect((await disk.read(guild.id)).skinCases[user.id].drops[0].locked).toBeUndefined();
    expect(control(panel, 'sell').disabled).toBe(false);
});

test('multi selection can lock and unlock items and sell-all preserves locked holdings', async () => {
    await stash([item('one'), item('two'), item('three')]);
    let panel = await inventory();
    panel = await select(control(panel, 'inventory-select').custom_id, ['drop_one', 'drop_two']);
    panel = await click(control(panel, 'lock-selected').custom_id);
    expect((await disk.read(guild.id)).skinCases[user.id].drops.filter(drop => drop.locked)).toHaveLength(2);
    let sale = await click(control(panel, 'sell-all').custom_id);
    expect(payload(sale).embeds[0].data.description).toContain('2 món đang khóa');
    sale = await click(control(sale, 'confirm-bulk-sale').custom_id);
    expect((await disk.read(guild.id)).skinCases[user.id].drops.map(drop => drop.id)).toEqual(['one', 'two']);
    panel = await select(control(sale, 'inventory-select').custom_id, ['drop_one', 'drop_two']);
    expect(control(panel, 'confirm-bulk-sale').disabled).toBe(true);
    panel = await click(control(panel, 'unlock-selected').custom_id);
    expect((await disk.read(guild.id)).skinCases[user.id].drops.every(drop => !drop.locked)).toBe(true);
});

test('a stale single or bulk confirmation cannot sell an item locked after review', async () => {
    await stash([item('one'), item('two')]);
    let panel = await inventory();
    const bulk = await select(control(panel, 'inventory-select').custom_id, ['drop_one', 'drop_two']);
    const confirm = control(bulk, 'confirm-bulk-sale').custom_id;
    const before = await disk.read(guild.id);
    await disk.transact(guild.id, async (state, save) => { state.skinCases[user.id].drops[0].locked = true; await save(); });
    panel = await click(confirm);
    expect(payload(panel).embeds[0].data.footer.text).toContain('vừa được khóa');
    expect((await disk.read(guild.id)).taixiu).toEqual(before.taixiu);
    expect((await disk.read(guild.id)).skinCases[user.id].drops).toHaveLength(2);
    const blocked = await click(`mg_hom_confirm-sale_${weaponCase.id}_one_100_xu1`);
    expect(payload(blocked).embeds[0].data.description).toContain('Đã khóa');
    expect((await disk.read(guild.id)).taixiu).toEqual(before.taixiu);
});

test('Trade Up sorting keeps selection across pages and review, and locked inputs cannot be consumed', async () => {
    await stash(Array.from({ length: 32 }, (_, index) => item(`trade-${index}`, 0.01 + index * 0.02)), { tradeUpSort: 'float-asc' });
    let panel = await inventory();
    panel = await click(control(panel, 'tradeup').custom_id);
    panel = await select(control(panel, 'tradeup-group').custom_id, ['0:0']);
    validPanel(panel);
    expect(control(panel, 'tradeup-sort').options.find(option => option.default).value).toBe('float-asc');
    expect(control(panel, 'tradeup-items').options[0].value).toBe('trade-0');
    expect(control(panel, 'tradeup-items').options).toHaveLength(25);
    const firstPageSelection = control(panel, 'tradeup-items').options.slice(0, 5).map(option => option.value);
    panel = await select(control(panel, 'tradeup-items').custom_id, firstPageSelection);
    const pickPage = (view, page) => controls(view).find(component =>
        component.custom_id?.startsWith('mg_hom_tradeup-pick-page_') && component.custom_id.endsWith(`_${page}`));
    panel = await click(pickPage(panel, 1).custom_id);
    expect(payload(panel).embeds[0].data.footer.text).toContain('Trang 2/2');
    expect(control(panel, 'tradeup-items').options[0].value).toBe('trade-25');
    const secondPageSelection = control(panel, 'tradeup-items').options.slice(0, 5).map(option => option.value);
    panel = await select(control(panel, 'tradeup-items').custom_id, secondPageSelection);
    expect(payload(panel).embeds[0].data.description).toContain('10/10');
    const selected = [...firstPageSelection, ...secondPageSelection];
    panel = await select(control(panel, 'tradeup-sort').custom_id, ['float-desc']);
    expect(control(panel, 'tradeup-items').options[0].value).toBe('trade-31');
    expect(control(panel, 'tradeup-items').options.filter(option => option.default).map(option => option.value))
        .toEqual(secondPageSelection.toReversed());
    expect(payload(panel).embeds[0].data.description).toContain('10/10');
    panel = await click(pickPage(panel, 1).custom_id);
    expect(control(panel, 'tradeup-items').options.filter(option => option.default).map(option => option.value))
        .toEqual(firstPageSelection.toReversed());
    panel = await click(control(panel, 'tradeup-review').custom_id);
    panel = await click(control(panel, 'tradeup-edit').custom_id);
    expect(control(panel, 'tradeup-sort').options.find(option => option.default).value).toBe('float-desc');
    expect(payload(panel).embeds[0].data.footer.text).toContain('Trang 2/2');
    expect(control(panel, 'tradeup-items').options.filter(option => option.default).map(option => option.value))
        .toEqual(firstPageSelection.toReversed());
    panel = await click(pickPage(panel, 0).custom_id);
    expect(control(panel, 'tradeup-items').options.filter(option => option.default).map(option => option.value))
        .toEqual(secondPageSelection.toReversed());
    validPanel(panel);
    panel = await click(control(panel, 'tradeup-review').custom_id);
    const before = await disk.read(guild.id);
    await disk.transact(guild.id, async (state, save) => {
        state.skinCases[user.id].drops.find(drop => drop.id === selected[0]).locked = true;
        await save();
    });
    panel = await click(control(panel, 'tradeup-confirm').custom_id);
    expect(payload(panel).embeds[0].data.footer.text).toContain('đang khóa');
    const after = await disk.read(guild.id);
    expect(after.skinCases[user.id].drops).toHaveLength(32);
    expect(after.taixiu).toEqual(before.taixiu);
    expect(after.skinCases[user.id].tradeUpSort).toBe('float-desc');
});
