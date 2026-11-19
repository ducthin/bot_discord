const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const hom = require('../commands/hom');
const store = require('../utils/managementStore');
const market = require('../utils/cs2Market');
const { terminals, skins } = require('../utils/cs2Catalogue');
const { isTradeUpInput } = require('../utils/cs2TradeUp');

const guild = { id: '1' };
const user = { id: '13' };
const [genesis, deadHand] = terminals;
let directory;
let disk;
let nextId;

beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-retired-terminal-'));
    disk = store.createManagementStore(directory);
    nextId = 200;
    jest.spyOn(store, 'read').mockImplementation(disk.read);
    jest.spyOn(store, 'transact').mockImplementation(disk.transact);
    jest.spyOn(require('../utils/cs2Reel'), 'warmCaseReel').mockResolvedValue();
    jest.spyOn(market, 'peekMarketQuote').mockImplementation(name => name ? {
        priceVnd: name.startsWith('Sealed ') ? 3_000 : 7_500,
        observedAt: Date.now() - 1000, expiresAt: Date.now() + 60_000,
        source: 'buff', url: 'https://buff.163.com/goods/12345'
    } : null);
    jest.spyOn(market, 'peekMarketDisplay').mockImplementation(name => {
        const quote = market.peekMarketQuote(name);
        return { status: quote ? 'fresh' : 'snapshot-missing', quote };
    });
    await disk.transact(guild.id, async (state, save) => {
        state.taixiu.balances[user.id] = 100_000;
        state.skinCases = { [user.id]: {
            cases: { [genesis.id]: 2, [deadHand.id]: 1 },
            terminalCaps: { [genesis.id]: 8_000 },
            terminalSessions: { [genesis.id]: {
                id: 'old-offer', step: 1, offerLimit: 5, expiresAt: Date.now() + 60_000,
                offer: { priceVnd: 7_500, drop: legacyDrop() }
            } },
            drops: [legacyDrop()]
        } };
        await save();
    });
});

afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(directory, { recursive: true, force: true });
});

function legacyDrop() {
    const skinId = genesis.pools[0][0];
    const skin = skins[skinId];
    return { id: 'legacy-skin', caseId: genesis.id, skinId, tier: 0,
        float: Math.round((skin.min + skin.max) / 2 * 1_000_000) / 1_000_000, statTrak: false };
}

function interaction(customId, extra = {}) {
    return {
        id: String(++nextId), customId, user, guild, guildId: guild.id, message: { id: '800' },
        deferReply: jest.fn(), deferUpdate: jest.fn(), editReply: jest.fn(), showModal: jest.fn(),
        reply: jest.fn(), followUp: jest.fn(), ...extra
    };
}

const payload = panel => panel.editReply.mock.calls.at(-1)?.[0];
const controls = panel => payload(panel).components.flatMap(row => row.toJSON().components);
const control = (panel, action) => controls(panel).find(item => item.custom_id?.startsWith(`mg_hom_${action}_`));

async function click(customId) {
    const panel = interaction(customId);
    await hom.button(panel);
    return panel;
}

test('/hom only offers ordinary cases, preserves other controls and has no Terminal entry', async () => {
    const main = interaction();
    await hom.execute(main);
    expect(hom.data.toJSON().description).not.toMatch(/terminal/i);
    expect(controls(main).some(item => /terminal/i.test(item.custom_id ?? item.label ?? ''))).toBe(false);
    const selector = controls(main).find(item => item.custom_id === 'mg_hom_select');
    expect(selector.options.every(item => !terminals.some(terminal => terminal.id === item.value))).toBe(true);
    expect(control(main, 'buy')).toBeDefined();
    expect(control(main, 'market')).toBeDefined();
    expect(control(main, 'battle-new')).toBeDefined();
});

test.each(['terminal', 'terminal-cap', 'terminal-open', 'terminal-skip', 'terminal-accept',
    'case', 'case-price', 'contents', 'buy', 'key', 'bulk', 'buy-set', 'confirm-set',
    'open', 'open-audio', 'open-batch', 'replay'])('old Terminal %s controls cannot change wallet or holdings', async action => {
    const before = await disk.read(guild.id);
    const argument = action === 'terminal-accept' || action === 'terminal-skip' ? 'old-offer-1' : '3000_xu1';
    const panel = await click(`mg_hom_${action}_${genesis.id}_${argument}`);
    expect(panel.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('/hom') }));
    expect(panel.deferUpdate).not.toHaveBeenCalled();
    expect(panel.showModal).not.toHaveBeenCalled();
    expect(store.transact).not.toHaveBeenCalled();
    expect(await disk.read(guild.id)).toEqual(before);
});

test('old Terminal selectors and modals are acknowledged without updating persisted data', async () => {
    const before = await disk.read(guild.id);
    const selector = interaction('mg_hom_select', { values: [deadHand.id] });
    await hom.select(selector);
    const modal = interaction(`mg_hom_terminal-cap-form_${genesis.id}`,
        { fields: { getTextInputValue: jest.fn(() => '1') } });
    await hom.modal(modal);
    const order = interaction(`mg_hom_order_${genesis.id}_3000_60000_xu1`);
    await hom.modal(order);
    for (const request of [selector, modal, order]) {
        expect(request.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('/hom') }));
        expect(request.deferUpdate).not.toHaveBeenCalled();
    }
    expect(modal.fields.getTextInputValue).not.toHaveBeenCalled();
    expect(store.transact).not.toHaveBeenCalled();
    expect(await disk.read(guild.id)).toEqual(before);
});

test('existing Terminal skins remain inspectable, lockable, sellable and eligible for Trade Up', async () => {
    const inventory = await click(`mg_hom_inventory_${genesis.id}`);
    const back = control(inventory, 'case');
    expect(back.label).toBe('Về hòm');
    expect(back.custom_id).toBe('mg_hom_case_crate-4904');
    expect(control(await click(back.custom_id), 'buy')).toBeDefined();
    const selected = interaction(control(inventory, 'inventory-select').custom_id, { values: ['drop_legacy-skin'] });
    await hom.select(selected);
    expect(payload(selected).embeds[0].toJSON().fields).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'Bộ sưu tập', value: genesis.collection })
    ]));
    expect(control(selected, 'replay')).toBeUndefined();
    expect(control(selected, 'market-list')).toBeDefined();
    expect(isTradeUpInput(legacyDrop())).toBe(true);

    const locked = await click(control(selected, 'lock-drop').custom_id);
    expect(control(locked, 'sell').disabled).toBe(true);
    const unlocked = await click(control(locked, 'unlock-drop').custom_id);
    const sale = await click(control(unlocked, 'sell').custom_id);
    await click(control(sale, 'confirm-sale').custom_id);
    const saved = await disk.read(guild.id);
    expect(saved.skinCases[user.id].drops).toEqual([]);
    expect(saved.taixiu.balances[user.id]).toBe(107_500);
    expect(saved.skinCases[user.id].cases).toEqual({ [genesis.id]: 2, [deadHand.id]: 1 });
    expect(saved.skinCases[user.id].terminalSessions[genesis.id].id).toBe('old-offer');
});

test('legacy sealed Terminals can still be sold from inventory', async () => {
    const initial = await disk.read(guild.id);
    const sale = await click(`mg_hom_sell-all_${genesis.id}`);
    await click(control(sale, 'confirm-bulk-sale').custom_id);
    const saved = await disk.read(guild.id);
    expect(saved.taixiu.balances[user.id]).toBe(116_500);
    expect(saved.skinCases[user.id].cases).toEqual({});
    expect(saved.skinCases[user.id].drops).toEqual([]);
    expect(saved.skinCases[user.id].terminalCaps).toEqual(initial.skinCases[user.id].terminalCaps);
    expect(saved.skinCases[user.id].terminalSessions).toEqual(initial.skinCases[user.id].terminalSessions);
});
