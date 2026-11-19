const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Collection, ComponentType, ModalSubmitFields } = require('discord.js');
const hom = require('../commands/hom');
const store = require('../utils/managementStore');
const market = require('../utils/cs2Market');
const { collections, skins, cases } = require('../utils/cs2Catalogue');

const guild = { id: '1' }, seller = { id: '13' }, buyer = { id: '14' };
const howlSource = collections.find(source => source.id === 'special-contraband');
const howl = { id: 'howl-owned', caseId: howlSource.id, skinId: howlSource.pools[3][0], tier: 3,
    float: 0.061234, statTrak: true, paintSeed: 309 };
const dragonId = Object.keys(skins).find(id => skins[id].name === 'AWP | Dragon Lore');
const dragonSource = collections.find(source => source.pools[3].includes(dragonId));
const dragon = { id: 'dragon-owned', caseId: dragonSource.id, skinId: dragonId, tier: 3, float: 0.051234, statTrak: false };
let directory, disk, nextId;

beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-iconic-'));
    disk = store.createManagementStore(directory);
    nextId = 700;
    jest.spyOn(store, 'read').mockImplementation(disk.read);
    jest.spyOn(store, 'transact').mockImplementation(disk.transact);
    jest.spyOn(require('../utils/cs2Reel'), 'warmCaseReel').mockResolvedValue();
    jest.spyOn(market, 'peekMarketQuote').mockImplementation(name => name ? { priceVnd: 7_500,
        observedAt: Date.now() - 1000, expiresAt: Date.now() + 60_000, source: 'buff', phase: null } : null);
    jest.spyOn(market, 'peekMarketDisplay').mockImplementation(name => {
        const quote = market.peekMarketQuote(name);
        return { status: quote ? 'fresh' : 'snapshot-missing', quote };
    });
    await disk.transact(guild.id, async (state, save) => {
        state.taixiu.balances = { [seller.id]: 100_000, [buyer.id]: 100_000 };
        state.skinCases = { [seller.id]: { drops: [howl, dragon] }, [buyer.id]: { drops: [] } };
        await save();
    });
});

afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(directory, { recursive: true, force: true });
});

const request = (customId, user = seller, extras = {}) => ({ id: String(++nextId), customId, guild,
    guildId: guild.id, user, message: { id: user.id }, reply: jest.fn(), followUp: jest.fn(),
    deferReply: jest.fn(), deferUpdate: jest.fn(), editReply: jest.fn(), showModal: jest.fn(), ...extras });
const payload = panel => panel.editReply.mock.calls.at(-1)?.[0];
const controls = panel => payload(panel).components.flatMap(row => row.toJSON().components);
const control = (panel, action) => controls(panel).find(item => item.custom_id?.startsWith(`mg_hom_${action}_`));
async function click(customId, user = seller) {
    const panel = request(customId, user);
    await hom.button(panel);
    return panel;
}
async function inspect(drop, user = seller) {
    const panel = request(`mg_hom_inventory-select_crate-4904_0`, user, { values: [`drop_${drop.id}`] });
    await hom.select(panel);
    return panel;
}

test('collection sources cannot be bought or opened through stale or forged controls', async () => {
    const before = await disk.read(guild.id);
    for (const source of [howlSource, dragonSource]) {
        for (const action of ['case', 'case-price', 'contents', 'buy', 'key', 'bulk', 'buy-set', 'confirm-set',
            'open', 'open-audio', 'open-batch', 'replay']) {
            const panel = await click(`mg_hom_${action}_${source.id}_3000_xu1`);
            expect(panel.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('/hom') }));
            expect(panel.deferUpdate).not.toHaveBeenCalled();
            expect(panel.showModal).not.toHaveBeenCalled();
        }
        const selector = request('mg_hom_select', seller, { values: [source.id] });
        await hom.select(selector);
        expect(selector.reply).toHaveBeenCalled();
        const modal = request(`mg_hom_order_${source.id}_3000_60000_xu1`);
        await hom.modal(modal);
        expect(modal.reply).toHaveBeenCalled();
    }
    expect(store.transact).not.toHaveBeenCalled();
    expect(await disk.read(guild.id)).toEqual(before);
});

test('Howl displays Contraband, real collection details and working inventory navigation', async () => {
    const panel = await inspect(howl);
    const embed = payload(panel).embeds[0].toJSON();
    expect(embed.description).toContain('Contraband');
    expect(embed.description).not.toContain('Covert');
    expect(embed.color).toBe(0xe4ae39);
    expect(embed.title).toContain('M4A4 | Howl');
    expect(control(panel, 'replay')).toBeUndefined();
    expect(control(panel, 'market-list')).toBeDefined();
    const inventory = await click(control(panel, 'inventory').custom_id);
    expect(control(inventory, 'case').custom_id).toBe('mg_hom_case_crate-4904');
    const dragonPanel = await inspect(dragon);
    expect(payload(dragonPanel).embeds[0].toJSON().fields).toContainEqual(expect.objectContaining({
        name: 'Bộ sưu tập', value: dragonSource.name
    }));
});

test('a Howl can be sold at the market, inspected as Contraband and bought with its original quality', async () => {
    const details = await inspect(howl);
    const prompt = await click(control(details, 'market-list').custom_id);
    const form = prompt.showModal.mock.calls[0][0].toJSON();
    const listed = request(form.custom_id, seller, { fields: {
        fields: new Collection([['price', { value: '125.75' }]]), getTextInputValue: () => '125.75'
    } });
    await hom.modal(listed);
    const saved = await disk.read(guild.id);
    expect(saved.cs2PlayerMarket[listed.id]).toMatchObject({ drop: howl, price: '12575' });
    expect(saved.skinCases[seller.id].drops).toEqual([dragon]);
    const board = await click('mg_hom_market_crate-4904_0', buyer);
    const menu = control(board, 'market-select');
    const selection = request(menu.custom_id, buyer, { values: [listed.id] });
    await hom.select(selection);
    expect(payload(selection).embeds[0].toJSON().description).toContain('Contraband');
    await click(control(selection, 'market-buy').custom_id, buyer);
    const bought = await disk.read(guild.id);
    expect(bought.skinCases[buyer.id].drops[0]).toMatchObject(howl);
    expect(bought.taixiu.balances).toEqual({ [seller.id]: '100125.75', [buyer.id]: '99874.25' });
});

test('market filters list Howl under Contraband and keep it out of the Covert filter', async () => {
    const ordinary = { id: 'ordinary', caseId: cases[0].id, skinId: cases[0].pools[3][0], tier: 3,
        float: skins[cases[0].pools[3][0]].min, statTrak: false };
    await disk.transact(guild.id, async (state, save) => {
        state.cs2PlayerMarket = Object.fromEntries([howl, ordinary].map((drop, index) => [String(501 + index), {
            id: String(501 + index), drop, sellerId: seller.id, price: '10000', createdAt: 1
        }]));
        await save();
    });
    for (const [tier, expected] of [['contraband', '501'], ['3', '502']]) {
        const board = await click('mg_hom_market_crate-4904_0', buyer);
        const prompt = await click(control(board, 'market-filter').custom_id, buyer);
        const form = prompt.showModal.mock.calls[0][0].toJSON();
        const rarityOptions = form.components.find(field => field.component.custom_id === 'tier').component.options;
        expect(rarityOptions.some(option => option.value === 'contraband')).toBe(true);
        const fields = new ModalSubmitFields([
            ...['name', 'min', 'max'].map(customId => ({ component: { type: ComponentType.TextInput, customId, value: '' } })),
            { component: { type: ComponentType.StringSelect, customId: 'tier', values: [tier] } }
        ]);
        const filtered = request(form.custom_id, buyer, { fields });
        await hom.modal(filtered);
        expect(control(filtered, 'market-select').options.map(option => option.value)).toEqual([expected]);
    }
});
