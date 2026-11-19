const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Collection, ComponentType, ModalSubmitFields } = require('discord.js');
const hom = require('../commands/hom');
const reel = require('../utils/cs2Reel');
const market = require('../utils/cs2Market');
const store = require('../utils/managementStore');
const { cases, skins } = require('../assets/cs2-cases.json');

const guild = { id: '1' };
const seller = { id: '13', username: 'seller' };
const buyer = { id: '14', username: 'buyer' };
const weaponCase = cases.find(item => item.id === 'crate-4904');
const skinId = weaponCase.pools[0].find(id => skins[id].stattrak && skins[id].min === 0 && skins[id].max === 1);
const forSale = { id: '111', caseId: weaponCase.id, skinId, tier: 0, float: 0.216543, statTrak: true };
const buyerItem = { ...forSale, id: '222', statTrak: false };
let directory;
let disk;
let interactionId;

beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-hom-player-market-'));
    disk = store.createManagementStore(directory);
    interactionId = 700;
    jest.spyOn(store, 'read').mockImplementation(disk.read);
    jest.spyOn(store, 'transact').mockImplementation(disk.transact);
    jest.spyOn(market, 'peekMarketQuote').mockReturnValue(null);
    jest.spyOn(market, 'peekMarketDisplay').mockReturnValue({ status: 'snapshot-missing', quote: null });
    jest.spyOn(reel, 'warmCaseReel').mockImplementation(() => {});
    await disk.transact(guild.id, async (state, save) => {
        state.taixiu.balances = { [seller.id]: 400, [buyer.id]: 200 };
        state.skinCases = { [seller.id]: { drops: [forSale] }, [buyer.id]: { drops: [buyerItem] } };
        await save();
    });
});

afterEach(async () => {
    jest.restoreAllMocks();
    for (const file of await fs.readdir(directory)) await fs.unlink(path.join(directory, file));
    await fs.rmdir(directory);
});

function interaction(user, customId, extras = {}) {
    return {
        id: String(++interactionId), guild, guildId: guild.id, user, customId, message: { id: user.id },
        reply: jest.fn(), followUp: jest.fn(), deferReply: jest.fn(), deferUpdate: jest.fn(), update: jest.fn(),
        editReply: jest.fn(), showModal: jest.fn(), ...extras
    };
}

function panelPayload(panel) {
    return panel.editReply.mock.calls.at(-1)?.[0] ?? panel.update.mock.calls.at(-1)?.[0];
}

function control(panel, prefix) {
    return panelPayload(panel)?.components?.flatMap(row => row.toJSON().components)
        .find(item => item.custom_id?.startsWith(prefix));
}

async function click(user, button) {
    expect(button).toBeDefined();
    expect(button.disabled).not.toBe(true);
    const request = interaction(user, button.custom_id);
    await hom.button(request);
    return request;
}

async function select(user, menu, value) {
    expect(menu?.options.some(option => option.value === value)).toBe(true);
    const request = interaction(user, menu.custom_id, { values: [value] });
    await hom.select(request);
    return request;
}

async function home(user) {
    const request = interaction(user);
    await hom.execute(request);
    return request;
}

async function listingForm() {
    const inventory = await click(seller, control(await home(seller), 'mg_hom_inventory_'));
    const details = await select(seller, control(inventory, 'mg_hom_inventory-select_'), `drop_${forSale.id}`);
    const listing = await click(seller, control(details, 'mg_hom_market-list_'));
    const form = listing.showModal.mock.calls[0]?.[0].toJSON();
    expect(form?.custom_id).toMatch(/^mg_hom_market-price_/);
    expect(form.components.map(field => field.component?.custom_id ?? field.components[0].custom_id)).toEqual(['price']);
    return form;
}

async function submitListing(form, price) {
    const request = interaction(seller, form.custom_id, {
        fields: {
            fields: new Collection([['price', { value: price }]]),
            getTextInputValue: field => field === 'price' ? price : undefined
        }
    });
    await hom.modal(request);
    return request;
}

async function openMarket(user) {
    return click(user, control(await home(user), 'mg_hom_market_'));
}

async function inspectListing(user, listingId) {
    const board = await openMarket(user);
    const menu = control(board, 'mg_hom_market-select_');
    const option = menu?.options.find(item => item.value.endsWith(listingId));
    expect(option).toBeDefined();
    return select(user, menu, option.value);
}

async function filterMarket(user, board, { name = '', tier = 'all', min = '', max = '' }) {
    const openForm = await click(user, control(board, 'mg_hom_market-filter_'));
    const form = openForm.showModal.mock.calls[0][0].toJSON();
    expect(form.components.map(field => field.component.custom_id)).toEqual(['name', 'tier', 'min', 'max']);
    const fields = new ModalSubmitFields([
        ...Object.entries({ name, min, max }).map(([customId, value]) => ({ component: { type: ComponentType.TextInput, customId, value } })),
        { component: { type: ComponentType.StringSelect, customId: 'tier', values: [tier] } }
    ]);
    const request = interaction(user, form.custom_id, { fields });
    await hom.modal(request);
    return request;
}

function visibleText(panel) {
    const payload = panelPayload(panel);
    const embeds = payload?.embeds?.map(embed => embed.toJSON()) ?? [];
    return JSON.stringify([payload?.content, ...embeds]);
}

test('publishing from inventory and buying from the market preserves the exact skin and decimal price', async () => {
    const form = await listingForm();
    const listing = await submitListing(form, '125,75');
    const published = await disk.read(guild.id);
    expect(published.skinCases[seller.id].drops).toEqual([]);
    expect(published.cs2PlayerMarket[listing.id]).toMatchObject({ drop: forSale, price: '12575', sellerId: seller.id });
    expect(published.taixiu.balances).toEqual({ [seller.id]: 400, [buyer.id]: 200 });

    const ownDetails = await inspectListing(seller, listing.id);
    expect(control(ownDetails, 'mg_hom_market-buy_')?.disabled ?? true).toBe(true);
    expect(control(ownDetails, 'mg_hom_market-cancel_')?.disabled).toBe(false);
    const buyerDetails = await inspectListing(buyer, listing.id);
    expect(control(buyerDetails, 'mg_hom_market-cancel_')).toBeUndefined();
    expect(visibleText(buyerDetails)).toContain(skins[skinId].name);
    expect(visibleText(buyerDetails)).toContain('0.216543');
    expect(visibleText(buyerDetails)).toContain('125.75 xu');

    // Resolve the seller before checkout; the receipt must not read inventory after the trade commits.
    store.read.mockClear();
    store.read.mockImplementationOnce(disk.read).mockRejectedValueOnce(new Error('Disk read unavailable after checkout'));
    const bought = await click(buyer, control(buyerDetails, 'mg_hom_market-buy_'));
    expect(store.read).toHaveBeenCalledTimes(1);
    expect(store.read).toHaveBeenCalledWith(guild.id, { sections: ['cs2PlayerMarket'] });
    store.read.mockReset().mockImplementation(disk.read);
    const settled = await disk.read(guild.id);
    expect(settled.skinCases[seller.id].drops).toEqual([]);
    const acquired = settled.skinCases[buyer.id].drops[1];
    expect(settled.skinCases[buyer.id].drops).toEqual([buyerItem, { ...forSale, acquiredAt: expect.any(Number), inventoryRevision: listing.id }]);
    expect(settled.taixiu.balances).toEqual({ [seller.id]: '525.75', [buyer.id]: '74.25' });
    expect(visibleText(bought)).toContain('Đã mua với 125.75 xu');
    expect(visibleText(bought)).toContain(`<t:${Math.floor(acquired.acquiredAt / 1000)}:D>`);
    const refreshed = await click(buyer, control(bought, 'mg_hom_result_'));
    const returnedToMarket = await click(buyer, control(refreshed, 'mg_hom_market_'));
    expect(control(returnedToMarket, 'mg_hom_market-select_')).toBeUndefined();
});

test('case contents finishes editing the panel before another navigation can change it', async () => {
    let finishContentsEdit;
    const editing = new Promise(resolve => { finishContentsEdit = resolve; });
    let startedContentsEdit;
    const started = new Promise(resolve => { startedContentsEdit = resolve; });
    const contents = interaction(buyer, `mg_hom_contents_${weaponCase.id}`, {
        editReply: jest.fn(() => {
            startedContentsEdit();
            return editing;
        })
    });
    const opening = hom.button(contents);
    await started;
    const inventory = interaction(buyer, `mg_hom_inventory_${weaponCase.id}_0`);
    try {
        await hom.button(inventory);
        expect(inventory.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Đang xử lý hòm') }));
        expect(inventory.editReply).not.toHaveBeenCalled();
    } finally {
        finishContentsEdit();
        await opening;
    }
    const retry = interaction(buyer, inventory.customId);
    await hom.button(retry);
    expect(panelPayload(retry).embeds[0].toJSON().title).toBe('Kho đồ của bạn');
});

test('invalid listing price preserves the inventory and the seller can retrieve an escrowed skin by canceling', async () => {
    const form = await listingForm();
    const initial = await disk.read(guild.id);
    await submitListing(form, '0');
    expect(await disk.read(guild.id)).toEqual(initial);

    const listing = await submitListing(form, '75');
    const sellerDetails = await select(seller, control(listing, 'mg_hom_market-select_'), listing.id);
    await click(seller, control(sellerDetails, 'mg_hom_market-cancel_'));
    const canceled = await disk.read(guild.id);
    expect(canceled.skinCases).toMatchObject(initial.skinCases);
    expect(canceled.taixiu.balances).toEqual(initial.taixiu.balances);
    expect(control(await openMarket(buyer), 'mg_hom_market-select_')).toBeUndefined();
});

test('the market shows the full listing price even when the wallet display would abbreviate it', async () => {
    const form = await listingForm();
    const listing = await submitListing(form, '12345678901234567890123456789012');
    const buyerDetails = await inspectListing(buyer, listing.id);
    const price = '12,345,678,901,234,567,890,123,456,789,012 xu';
    expect(visibleText(buyerDetails)).toContain(price);
    expect(control(buyerDetails, 'mg_hom_market-buy_').label).toBe(`Mua · ${price}`);
    await click(buyer, control(buyerDetails, 'mg_hom_market-buy_'));
    const state = await disk.read(guild.id);
    expect(state.taixiu.balances[buyer.id]).toBe(200);
    expect(state.skinCases[buyer.id].drops).toEqual([buyerItem]);
    expect(control(await openMarket(buyer), 'mg_hom_market-select_').options).toHaveLength(1);
});

test('market combines name, rarity and inclusive decimal price bounds across listing navigation', async () => {
    const secondSkin = weaponCase.pools[1][0];
    await disk.transact(guild.id, async (state, save) => {
        state.cs2PlayerMarket = {
            '501': { id: '501', sellerId: seller.id, drop: forSale, price: '12575', createdAt: 1 },
            '502': { id: '502', sellerId: seller.id, drop: { ...forSale, id: '502' }, price: '12576', createdAt: 2 },
            '503': { id: '503', sellerId: seller.id, drop: { ...forSale, id: '503', skinId: secondSkin, tier: 1 }, price: '12575', createdAt: 3 }
        };
        await save();
    });
    const board = await openMarket(buyer);
    expect(control(board, 'mg_hom_market-select_').options).toHaveLength(3);
    const priced = await filterMarket(buyer, board, { min: '125,75', max: '125.75' });
    expect(control(priced, 'mg_hom_market-select_').options.map(item => item.value)).toEqual(['503', '501']);
    const ranked = await filterMarket(buyer, priced, { tier: '0', min: '125,75', max: '125.75' });
    expect(control(ranked, 'mg_hom_market-select_').options.map(item => item.value)).toEqual(['501']);
    const query = skins[skinId].name.split(' | ')[1].toUpperCase();
    const filtered = await filterMarket(buyer, ranked, { name: query, tier: '0', min: '125,75', max: '125.75' });
    const filteredMenu = control(filtered, 'mg_hom_market-select_');
    expect(filteredMenu.options.map(item => item.value)).toEqual(['501']);
    expect(visibleText(filtered)).toContain('**1** tin phù hợp');
    const details = await select(buyer, filteredMenu, '501');
    const returned = await click(buyer, control(details, 'mg_hom_market_'));
    expect(control(returned, 'mg_hom_market-select_').options.map(item => item.value)).toEqual(['501']);
    const cleared = await click(buyer, control(returned, 'mg_hom_market-clear-filter_'));
    expect(control(cleared, 'mg_hom_market-select_').options).toHaveLength(3);

    const empty = await filterMarket(buyer, cleared, { name: 'skin-that-does-not-exist' });
    expect(visibleText(empty)).toContain('Không có tin phù hợp với bộ lọc.');
    const invalid = await filterMarket(buyer, empty, { min: '200', max: '100' });
    expect(invalid.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Giá tối thiểu') }));
    expect(invalid.deferUpdate).not.toHaveBeenCalled();
});
