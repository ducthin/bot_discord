const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const hom = require('../commands/hom');
const store = require('../utils/managementStore');
const market = require('../utils/cs2Market');
const playerMarket = require('../utils/cs2PlayerMarket');
const inventoryArt = require('../utils/cs2InventoryArt');
const { getBlueGemArt } = require('../utils/cs2BlueGemArt');
const { customCasesById } = require('../utils/cs2BattleCases');
const { readCoins } = require('../utils/coins');

const guild = { id: '1' };
const user = { id: '13' };
const buyer = '14';
const gem = { ...customCasesById.get('battle-blue-gem').entries.at(-1).drop,
    id: '1001', acquiredAt: 1000, battleCaseId: 'battle-blue-gem' };
let directory;
let disk;
let id = 90_000;
let premiumAvailable;

const request = customId => ({ id: String(++id), customId, guild, guildId: guild.id, user,
    message: { id: 'blue-gem' }, attachmentSizeLimit: 0, deferUpdate: jest.fn(), editReply: jest.fn(),
    reply: jest.fn(), followUp: jest.fn() });
const payload = interaction => interaction.editReply.mock.calls.at(-1)?.[0];
const control = (interaction, action) => payload(interaction).components.flatMap(row => row.toJSON().components)
    .find(item => item.custom_id?.startsWith(`mg_hom_${action}_`));
const click = async customId => { const interaction = request(customId); await hom.button(interaction); return interaction; };

beforeEach(async () => {
    premiumAvailable = true;
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-blue-gem-ui-'));
    disk = store.createManagementStore(directory);
    jest.spyOn(store, 'read').mockImplementation(disk.read);
    jest.spyOn(store, 'transact').mockImplementation(disk.transact);
    jest.spyOn(inventoryArt, 'renderInventoryGrid').mockResolvedValue(null);
    jest.spyOn(market, 'peekMarketQuote').mockImplementation((name, ref) => {
        if (!name || ref?.paintSeed != null && !premiumAvailable) return null;
        const priceVnd = ref?.paintSeed === 955 ? 500 : ref?.paintSeed === 387 ? 700 : 100;
        return { priceVnd, source: ref?.paintSeed != null ? 'csfloat' : 'buff', phase: null,
            ...(ref?.paintSeed != null ? { paintSeed: ref.paintSeed } : {}),
            url: ref?.paintSeed != null ? 'https://csfloat.com/search' : market.BUFF_MARKET_URL,
            observedAt: Date.now(), expiresAt: Date.now() + 300_000 };
    });
    jest.spyOn(market, 'peekMarketDisplay').mockImplementation((name, ref) => {
        const quote = market.peekMarketQuote(name, ref);
        return { status: quote ? 'fresh' : 'snapshot-missing', quote };
    });
    await disk.transact(guild.id, async (state, save) => {
        state.taixiu.balances = { [user.id]: 300, [buyer]: 1000 };
        state.skinCases = { [user.id]: { drops: [gem] } };
        await save();
    });
});

afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(directory, { recursive: true, force: true });
});

async function details(dropId = gem.id) {
    const panel = await click(`mg_hom_inventory_${gem.caseId}_0`);
    const interaction = request(control(panel, 'inventory-select').custom_id);
    interaction.values = [`drop_${dropId}`];
    await hom.select(interaction);
    return interaction;
}

test('inventory details show the correct local-backed seed image, premium source and market link', async () => {
    const interaction = await details();
    const embed = payload(interaction).embeds[0].toJSON();
    expect(embed.title).toContain('Blue Gem #955');
    expect(embed.image.url).toBe(getBlueGemArt(gem).sourceUrl);
    expect(embed.fields).toContainEqual(expect.objectContaining({ name: 'Ảnh pattern', value: expect.stringContaining('/955') }));
    expect(embed.fields).toContainEqual(expect.objectContaining({ name: 'Giá CSFloat · Seed #955', value: expect.stringContaining('500 xu') }));
    expect(payload(interaction).components.flatMap(row => row.toJSON().components)).toContainEqual(
        expect.objectContaining({ label: 'CSFloat', url: 'https://csfloat.com/search' }));
    expect(market.peekMarketQuote).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ paintSeed: 955 }));
});

test('inventory retries the same exact seed image if the local PNG attachment is rejected', async () => {
    const panel = await click(`mg_hom_inventory_${gem.caseId}_0`);
    const interaction = request(control(panel, 'inventory-select').custom_id);
    interaction.values = [`drop_${gem.id}`];
    const exact = getBlueGemArt(gem);
    interaction.attachmentSizeLimit = exact.buffer.length;
    interaction.editReply.mockImplementation(async update => {
        if (update.files) throw Object.assign(new Error('Attachment rejected'), { code: 40005 });
    });
    await hom.select(interaction);
    const upload = interaction.editReply.mock.calls.find(([update]) => update.files)?.[0];
    expect(upload?.embeds[0].data.image.url).toMatch(/^attachment:\/\//);
    expect(upload?.files[0].attachment).toBe(exact.buffer);
    expect(payload(interaction).embeds[0].data.image.url).toBe(exact.sourceUrl);
});

test('a missing seed quote blocks premium buyback while an ordinary historical drop keeps its base valuation', async () => {
    premiumAvailable = false;
    let interaction = await details();
    expect(payload(interaction).embeds[0].toJSON().fields).toContainEqual(expect.objectContaining({
        name: 'Giá CSFloat · Seed #955', value: 'Chưa có giá CSFloat cho Blue Gem #955'
    }));
    expect(control(interaction, 'sell')).toBeUndefined();
    await disk.transact(guild.id, async (state, save) => {
        delete state.skinCases[user.id].drops[0].priceVariant;
        await save();
    });
    interaction = await details();
    const fields = payload(interaction).embeds[0].toJSON().fields;
    expect(fields).toContainEqual(expect.objectContaining({ name: 'Giá BUFF.163', value: expect.stringContaining('100 xu') }));
    expect(fields).toContainEqual(expect.objectContaining({ name: 'Định giá', value: 'Giá mua lại theo skin và độ mòn' }));
    expect(control(interaction, 'sell')).toBeDefined();
});

test('sell-all isolates prices of two seeds with the same skin and wear, then credits the premium sum once', async () => {
    await disk.transact(guild.id, async (state, save) => {
        state.skinCases[user.id].drops.push({ ...gem, id: '1002', paintSeed: 387 });
        await save();
    });
    const panel = await click(`mg_hom_inventory_${gem.caseId}_0`);
    const sale = await click(control(panel, 'sell-all').custom_id);
    expect(payload(sale).embeds[0].toJSON().description).toContain('1,200 xu');
    const customId = control(sale, 'confirm-bulk-sale').custom_id;
    await click(customId);
    let state = await disk.read(guild.id);
    expect(state.skinCases[user.id].drops).toEqual([]);
    expect(readCoins(state.taixiu.balances[user.id])).toBe(150_000n);
    await click(customId);
    state = await disk.read(guild.id);
    expect(readCoins(state.taixiu.balances[user.id])).toBe(150_000n);
});

test('player-market escrow, purchase and cancellation preserve the exact premium seed and image', async () => {
    const listed = await playerMarket.listSkin(guild.id, user.id, gem.id, 50_000n, '2001');
    expect(listed.status).toBe('listed');
    const bought = await playerMarket.buySkin(guild.id, buyer, '2001');
    expect(bought).toMatchObject({ status: 'bought', drop: { paintSeed: 955, priceVariant: 'blue-gem' } });
    expect(getBlueGemArt(bought.drop).sourceUrl).toBe(getBlueGemArt(gem).sourceUrl);
    const ref = market.getDropMarketQuoteRef(bought.drop);
    expect(ref.paintSeed).toBe(955);
    await playerMarket.listSkin(guild.id, buyer, gem.id, 50_000n, '2002');
    const cancelled = await playerMarket.cancelListing(guild.id, buyer, '2002');
    expect(cancelled.status).toBe('cancelled');
    const restored = (await disk.read(guild.id)).skinCases[buyer].drops[0];
    expect(restored).toMatchObject({ paintSeed: 955, priceVariant: 'blue-gem' });
});

test('the Blue Gem market listing uses the local exact image when it fits', async () => {
    const listed = await playerMarket.listSkin(guild.id, user.id, gem.id, 50_000n, '2001');
    expect(listed.status).toBe('listed');
    const listing = await click(`mg_hom_market_${gem.caseId}_0`);
    const component = payload(listing).components.flatMap(row => row.toJSON().components)
        .find(item => item.options?.some(option => option.value === '2001'));
    const interaction = request(component.custom_id);
    interaction.values = ['2001'];
    const exact = getBlueGemArt(gem);
    interaction.attachmentSizeLimit = exact.buffer.length;
    await hom.select(interaction);
    expect(payload(interaction).embeds[0].data.image.url).toBe(exact.url);
    expect(payload(interaction).files[0].attachment).toBe(exact.buffer);
});

test('Upgrade offers a seed-priced input at its premium amount and hides it when that exact quote disappears', async () => {
    let interaction = await click(`mg_hom_upgrade_${gem.caseId}`);
    let menus = payload(interaction).components.flatMap(row => row.toJSON().components);
    expect(menus.flatMap(menu => menu.options ?? [])).toContainEqual(expect.objectContaining({
        value: gem.id, label: expect.stringContaining('Blue Gem #955'), description: expect.stringContaining('500 xu')
    }));
    premiumAvailable = false;
    interaction = await click(`mg_hom_upgrade_${gem.caseId}`);
    menus = payload(interaction).components.flatMap(row => row.toJSON().components);
    expect(menus.flatMap(menu => menu.options ?? []).some(option => option.value === gem.id)).toBe(false);
});
