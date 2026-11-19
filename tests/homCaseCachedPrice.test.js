const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const guild = { id: '1' };
const user = { id: '13' };
const caseId = 'crate-4904';
const caseName = 'Kilowatt Case';
const start = Date.UTC(2026, 0, 1);
const hour = 60 * 60_000;
const day = 24 * hour;
const initialCoins = 100_000;
const savedPrice = 3501;
let directory;
let disk;
let store;
let market;
let hom;
let fetcher;
let quote;
let nextInteraction;

beforeEach(async () => {
    jest.resetModules();
    jest.useFakeTimers({ now: start });
    const reel = require('../utils/cs2Reel');
    store = require('../utils/managementStore');
    market = require('../utils/cs2Market');
    const snapshot = require('../utils/cs2PriceSnapshot');
    hom = require('../commands/hom');
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-hom-saved-price-'));
    disk = store.createManagementStore(directory);
    nextInteraction = 500;
    fetcher = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Unexpected network request'));
    quote = { priceVnd: savedPrice, observedAt: start, expiresAt: start + day, source: 'buff', phase: null, url: market.BUFF_MARKET_URL };
    jest.spyOn(snapshot, 'peek').mockImplementation((name, { allowStale } = {}) =>
        name === caseName && (Date.now() < quote.expiresAt || (allowStale && Date.now() < quote.observedAt + 2 * day)) ? quote : null);
    jest.spyOn(store, 'read').mockImplementation(disk.read);
    jest.spyOn(store, 'transact').mockImplementation(disk.transact);
    jest.spyOn(reel, 'warmCaseReel').mockImplementation(() => {});
    await disk.transact(guild.id, async (state, save) => {
        state.taixiu.balances[user.id] = initialCoins;
        await save();
    });
});

afterEach(async () => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    for (const file of await fs.readdir(directory)) await fs.unlink(path.join(directory, file));
    await fs.rmdir(directory);
});

function interaction(customId, extras = {}) {
    return {
        id: String(++nextInteraction), customId, guild, guildId: guild.id, user, message: { id: '700' },
        reply: jest.fn(), deferReply: jest.fn(), deferUpdate: jest.fn(), editReply: jest.fn(),
        showModal: jest.fn(), followUp: jest.fn(), ...extras
    };
}

function payload(panel) {
    return panel.editReply.mock.calls.at(-1)?.[0];
}

function control(panel, action) {
    return payload(panel)?.components?.flatMap(row => row.toJSON().components)
        .find(item => item.custom_id?.startsWith(`mg_hom_${action}_`));
}

async function click(button) {
    expect(button).toBeDefined();
    const request = interaction(button.custom_id);
    await hom.button(request);
    return request;
}

async function openCase() {
    const request = interaction();
    await hom.execute(request);
    return request;
}

async function openOrder(panel) {
    const request = await click(control(panel, 'bulk'));
    const form = request.showModal.mock.calls[0]?.[0].toJSON();
    expect(form?.custom_id).toMatch(/^mg_hom_order_/);
    return form;
}

async function submit(form, values) {
    const fields = new Map(Object.entries(values).map(([name, value]) => [name, { value }]));
    const request = interaction(form.custom_id, {
        fields: { fields, getTextInputValue: field => fields.get(field)?.value ?? '' }
    });
    await hom.modal(request);
    return request;
}

test('single and bulk purchases use the cached BUFF quote without any network request', async () => {
    const casePanel = await openCase();
    expect(payload(casePanel).embeds[0].toJSON().fields[0].value).toMatch(/^\*\*3,501 xu\*\* mỗi hòm\n<t:\d+:R>$/);
    expect(control(casePanel, 'buy')).toMatchObject({ label: 'Mua hòm · 3,501 xu', disabled: false });

    const receipt = await click(control(casePanel, 'buy'));
    const afterOne = await disk.read(guild.id);
    expect(afterOne.taixiu.balances[user.id]).toBe(initialCoins - savedPrice);
    expect(afterOne.skinCases[user.id].cases[caseId]).toBe(1);
    const order = await openOrder(receipt);
    const [casesField] = order.components;
    expect(casesField.label ?? casesField.components[0].label).toContain('3,501 xu');

    await submit(order, { cases: '2', keys: '1' });
    const saved = await disk.read(guild.id);
    const stash = saved.skinCases[user.id];
    expect(stash.cases[caseId]).toBe(3);
    expect(Object.values(stash.keys)).toEqual([1]);
    expect(saved.taixiu.balances[user.id]).toBe(initialCoins - 3 * savedPrice - 60_000);
    expect(fetcher).not.toHaveBeenCalled();
});

test('a fresh BUFF price replaces the saved price without charging a confirmed bulk order', async () => {
    const order = await openOrder(await openCase());
    const before = await disk.read(guild.id);
    jest.setSystemTime(Date.now() + hour);
    quote = { ...quote, priceVnd: 3701, observedAt: Date.now(), expiresAt: Date.now() + day };

    const changed = await submit(order, { cases: '2', keys: '1' });
    expect(await disk.read(guild.id)).toEqual(before);
    expect(control(changed, 'buy')).toMatchObject({ label: 'Mua hòm · 3,701 xu', disabled: false });
    expect(payload(changed).embeds[0].toJSON().footer.text).toContain('Giá hòm đã đổi');
});

test('the price button reads the synced cache and shows the next sync time', async () => {
    jest.setSystemTime(start + hour - 60_000);
    const panel = await openCase();
    const refreshed = await click(control(panel, 'case-price'));
    expect(payload(refreshed).embeds[0].toJSON().footer.text)
        .toContain(`Lần đồng bộ tiếp theo <t:${(start + hour) / 1000}:t>`);
    await click(control(refreshed, 'buy'));
    expect((await disk.read(guild.id)).taixiu.balances[user.id]).toBe(initialCoins - savedPrice);
    expect(fetcher).not.toHaveBeenCalled();
});

test('buying a set charges only missing stock and rejects the same stale confirmation', async () => {
    const weaponCase = require('../assets/cs2-cases.json').cases.find(item => item.id === caseId);
    await disk.transact(guild.id, async (state, save) => {
        state.taixiu.balances[user.id] = 500_000;
        state.skinCases = { [user.id]: { cases: { [caseId]: 1 }, keys: { [weaponCase.key]: 2 } } };
        await save();
    });
    const sets = await click(control(await openCase(), 'buy-set'));
    const order = payload(sets).components[0].toJSON().components.find(button => button.label === 'Xác nhận mua bộ 3');
    expect(order.disabled).toBe(false);
    expect(payload(sets).embeds[0].toJSON().fields[1].value).toContain('67,002 xu');
    await click(order);
    const stocked = await disk.read(guild.id);
    expect(stocked.taixiu.balances[user.id]).toBe(432_998);
    expect(stocked.skinCases[user.id]).toMatchObject({ cases: { [caseId]: 3 }, keys: { [weaponCase.key]: 3 } });
    const stale = await click(order);
    expect(payload(stale).embeds[0].toJSON().footer.text).toContain('Số hòm hoặc chìa đã thay đổi');
    expect(await disk.read(guild.id)).toEqual(stocked);
});

test('a saved price that expires while checkout waits cannot debit xu, and key-only orders still work', async () => {
    jest.setSystemTime(start + day - 1);
    const casePanel = await openCase();
    expect(control(casePanel, 'buy')?.disabled).toBe(false);
    const before = await disk.read(guild.id);
    store.transact.mockImplementationOnce((guildId, operation) => disk.transact(guildId, (state, save) => {
        jest.setSystemTime(start + day);
        return operation(state, save);
    }));

    const expired = await click(control(casePanel, 'buy'));
    expect(await disk.read(guild.id)).toEqual(before);
    expect(market.peekMarketDisplay(caseName).status).toBe('estimate');
    expect(payload(expired).embeds[0].toJSON().fields[0].value).toContain('Giá đã lưu **3,501 xu**');
    expect(control(expired, 'buy')?.disabled).toBe(true);
    expect(control(expired, 'key')?.disabled).toBe(false);

    const order = await openOrder(expired);
    await submit(order, { keys: '1' });
    expect(fetcher).not.toHaveBeenCalled();
    const afterKey = await disk.read(guild.id);
    expect(afterKey.skinCases[user.id].cases).toBeUndefined();
    expect(Object.values(afterKey.skinCases[user.id].keys)).toEqual([1]);
    expect(afterKey.taixiu.balances[user.id]).toBe(initialCoins - 60_000);
});
