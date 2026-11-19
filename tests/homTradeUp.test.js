const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const hom = require('../commands/hom');
const store = require('../utils/managementStore');
const market = require('../utils/cs2Market');
const playerMarket = require('../utils/cs2PlayerMarket');
const { cases, skins } = require('../assets/cs2-cases.json');
const { getDropMarketHashName } = require('../utils/cs2MarketNames');

const guild = { id: '1' };
const user = { id: '13' };
const kilowatt = cases.find(item => item.id === 'crate-4904');
const revolution = cases.find(item => item.id === 'crate-4880');
let directory;
let disk;
let nextInteraction;

beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-hom-trade-up-'));
    disk = store.createManagementStore(directory);
    nextInteraction = 500;
    jest.spyOn(store, 'read').mockImplementation(disk.read);
    jest.spyOn(store, 'transact').mockImplementation(disk.transact);
    jest.spyOn(market, 'peekMarketQuote').mockReturnValue(null);
    jest.spyOn(market, 'peekMarketDisplay').mockReturnValue({ status: 'snapshot-missing', quote: null });
});

afterEach(async () => {
    jest.restoreAllMocks();
    for (const file of await fs.readdir(directory)) await fs.unlink(path.join(directory, file));
    await fs.rmdir(directory);
});

function drop(id, weaponCase = kilowatt, statTrak = false) {
    const skinId = weaponCase.pools[0].find(id => skins[id].min === 0 && skins[id].max === 1 && skins[id].stattrak);
    return { id: String(id), caseId: weaponCase.id, skinId, tier: 0, float: 0.25, statTrak };
}

async function setStash(drops) {
    await disk.transact(guild.id, async (state, save) => {
        state.taixiu.balances[user.id] = 600;
        state.skinCases = { [user.id]: { drops, cases: { [kilowatt.id]: 1 }, keys: { [kilowatt.key]: 2 } } };
        await save();
    });
}

function interaction(customId, overrides = {}) {
    return {
        id: String(++nextInteraction), customId, guild, guildId: guild.id, user, message: { id: '700' },
        reply: jest.fn(), followUp: jest.fn(), deferUpdate: jest.fn(), editReply: jest.fn(),
        ...overrides
    };
}

function payload(panel) {
    return panel.editReply.mock.calls.at(-1)?.[0];
}

function control(panel, prefix) {
    return payload(panel)?.components?.flatMap(row => row.toJSON().components)
        .find(item => item.custom_id?.startsWith(prefix));
}

function enabledControl(panel, prefix) {
    return payload(panel)?.components?.flatMap(row => row.toJSON().components)
        .find(item => item.custom_id?.startsWith(prefix) && !item.disabled);
}

function quickControl(panel, group, action = 'quick') {
    return payload(panel)?.components?.flatMap(row => row.toJSON().components)
        .find(item => item.custom_id?.startsWith(`mg_hom_tradeup-${action}_`) && item.custom_id.endsWith(`_${group}`));
}

async function click(customId, overrides) {
    const button = interaction(customId, overrides);
    await hom.button(button);
    return button;
}

async function select(customId, values) {
    const menu = interaction(customId, { values });
    await hom.select(menu);
    return menu;
}

async function openTradeUp() {
    const inventory = await click(`mg_hom_inventory_${kilowatt.id}_0`);
    const entry = control(inventory, 'mg_hom_tradeup_');
    expect(entry?.disabled).toBe(false);
    return click(entry.custom_id);
}

async function pickGroup() {
    const panel = await openTradeUp();
    const menu = control(panel, 'mg_hom_tradeup-group_');
    expect(menu?.options.some(option => option.value === '0:0')).toBe(true);
    return select(menu.custom_id, ['0:0']);
}

async function chooseDrops(panel, count) {
    const menu = control(panel, 'mg_hom_tradeup-items_');
    const ids = menu?.options.slice(0, count).map(option => option.value);
    expect(ids).toHaveLength(count);
    return { panel: await select(menu.custom_id, ids), ids };
}

test('a failed Trade Up edit leaves the visible selection usable', async () => {
    await setStash(Array.from({ length: 10 }, (_, index) => drop(600 + index)));
    const panel = await pickGroup();
    const menu = control(panel, 'mg_hom_tradeup-items_');
    const values = menu.options.slice(0, 2).map(option => option.value);
    const failed = interaction(menu.custom_id, { values, editReply: jest.fn().mockRejectedValue(new Error('Discord unavailable')) });
    await expect(hom.select(failed)).rejects.toThrow('Discord unavailable');
    const retry = await select(menu.custom_id, values);
    expect(payload(retry).embeds[0].toJSON().description).toContain('2/10');
    expect(retry.reply).not.toHaveBeenCalled();
});

async function review(panel) {
    const button = control(panel, 'mg_hom_tradeup-review_');
    expect(button?.disabled).toBe(false);
    const preview = await click(button.custom_id);
    expect(control(preview, 'mg_hom_tradeup-confirm_')?.disabled).toBe(false);
    return preview;
}

test('direct Trade Up consumes the selected skins once without visiting the odds panel', async () => {
    jest.spyOn(crypto, 'randomInt').mockReturnValue(0);
    const drops = Array.from({ length: 12 }, (_, index) => drop(100 + index));
    await setStash(drops);
    const before = await disk.read(guild.id);
    const picker = await pickGroup();
    expect(enabledControl(picker, 'mg_hom_tradeup-direct_')).toBeUndefined();
    const { panel, ids } = await chooseDrops(picker, 10);
    const direct = enabledControl(panel, 'mg_hom_tradeup-direct_');
    expect(direct).toBeDefined();
    expect(enabledControl(panel, 'mg_hom_tradeup-review_')).toBeDefined();
    expect(await disk.read(guild.id)).toEqual(before);

    await click(direct.custom_id, { message: { id: '701' } });
    expect(await disk.read(guild.id)).toEqual(before);
    const confirmed = await click(direct.custom_id);
    const saved = await disk.read(guild.id);
    expect(saved.skinCases[user.id].drops.filter(item => !item.tradeUp)).toEqual(drops.filter(item => !ids.includes(item.id)));
    const crafted = saved.skinCases[user.id].drops.filter(item => item.tradeUp);
    expect(crafted).toEqual([
        expect.objectContaining({ id: confirmed.id, tier: 1, statTrak: false, tradeUp: true, paintSeed: 0, acquiredAt: expect.any(Number) })
    ]);
    const result = payload(confirmed).embeds[0].toJSON();
    expect(result.fields).toContainEqual(expect.objectContaining({ name: 'Seed', value: '0' }));
    expect(result.fields).toContainEqual(expect.objectContaining({
        name: 'Ngày nhận', value: `<t:${Math.floor(crafted[0].acquiredAt / 1000)}:D>`
    }));
    expect(JSON.stringify(result)).toContain('Kilowatt Collection');
    const reopened = await select(`mg_hom_inventory-select_${kilowatt.id}_0`, [`drop_${confirmed.id}`]);
    expect(payload(reopened).embeds[0].toJSON().fields).toContainEqual(expect.objectContaining({ name: 'Seed', value: '0' }));
    expect(saved.taixiu).toEqual(before.taixiu);
    await click(direct.custom_id);
    expect(await disk.read(guild.id)).toEqual(saved);
});

test('direct Trade Up leaves the inventory intact if a selected skin is gone', async () => {
    await setStash(Array.from({ length: 11 }, (_, index) => drop(100 + index)));
    const { panel, ids } = await chooseDrops(await pickGroup(), 10);
    const direct = enabledControl(panel, 'mg_hom_tradeup-direct_');
    expect(direct).toBeDefined();
    await disk.transact(guild.id, async (state, save) => {
        const stash = state.skinCases[user.id];
        stash.drops = stash.drops.filter(item => item.id !== ids[0]);
        await save();
    });
    const before = await disk.read(guild.id);
    await click(direct.custom_id);
    expect(await disk.read(guild.id)).toEqual(before);
});

test('quick Mil-Spec preselects ten cheapest eligible skins with cached prices only', async () => {
    const cheap = Array.from({ length: 9 }, (_, index) => drop(100 + index, revolution));
    const expensive = [drop(200), drop(201)];
    const unpriced = { ...drop(202), float: 0.1 };
    const statTrak = Array.from({ length: 10 }, (_, index) => drop(300 + index, kilowatt, true));
    const quotes = new Map([
        [getDropMarketHashName(cheap[0]), { priceVnd: 500, observedAt: Date.now(), expiresAt: Date.now() + 60_000 }],
        [getDropMarketHashName(expensive[0]), { priceVnd: 1_500, observedAt: Date.now(), expiresAt: Date.now() + 60_000 }]
    ]);
    market.peekMarketQuote.mockImplementation(name => quotes.get(name) ?? null);
    market.peekMarketDisplay.mockImplementation(name => ({ status: 'fresh', quote: quotes.get(name) ?? null }));
    await setStash([...expensive, unpriced, ...cheap, ...statTrak]);
    const before = await disk.read(guild.id);
    const group = await openTradeUp();
    const quick = quickControl(group, '0:0');
    expect(quick?.disabled).toBe(false);
    const picker = await click(quick.custom_id);
    const { options } = control(picker, 'mg_hom_tradeup-items_');
    const selected = options.filter(option => option.default).map(option => option.value);
    expect(selected).toHaveLength(10);
    expect(selected).toEqual(expect.arrayContaining(cheap.map(item => item.id)));
    expect(selected.filter(id => expensive.some(item => item.id === id))).toHaveLength(1);
    expect(options.find(item => item.value === cheap[0].id).description).toContain('500 xu');
    expect(options.find(item => item.value === unpriced.id).description).toContain('Chưa có giá');
    expect(payload(picker).embeds[0].toJSON().fields.at(-1).value).toBe('**6,000 xu**');
    expect(enabledControl(picker, 'mg_hom_tradeup-direct_')).toBeDefined();
    expect(enabledControl(picker, 'mg_hom_tradeup-review_')).toBeDefined();
    expect(await disk.read(guild.id)).toEqual(before);
});

test('quick StatTrak Mil-Spec stays separate and uses the oldest eligible skins if unpriced', async () => {
    const ordinary = Array.from({ length: 10 }, (_, index) => drop(100 + index));
    const statTrak = Array.from({ length: 22 }, (_, index) => drop(200 + index, kilowatt, true));
    await setStash([...ordinary, ...statTrak]);
    const group = await openTradeUp();
    const quick = quickControl(group, '0:1');
    expect(quick?.disabled).toBe(false);
    const picker = await click(quick.custom_id);
    const selected = control(picker, 'mg_hom_tradeup-items_').options.filter(option => option.default).map(option => option.value);
    expect(new Set(selected)).toEqual(new Set(statTrak.slice(0, 10).map(item => item.id)));
    expect(payload(picker).embeds[0].toJSON().fields.at(-1).value).toBe('10/10 món chưa có giá');
    const confirmed = await click(enabledControl(picker, 'mg_hom_tradeup-direct_').custom_id);
    const saved = await disk.read(guild.id);
    expect(saved.skinCases[user.id].drops.filter(item => !item.tradeUp)).toEqual([...ordinary, ...statTrak.slice(10)]);
    expect(saved.skinCases[user.id].drops.find(item => item.tradeUp)).toMatchObject({ id: confirmed.id, tier: 1, statTrak: true });

    const next = quickControl(confirmed, '0:1', 'next');
    expect(next).toBeDefined();
    const nextPicker = await click(next.custom_id);
    const nextSelected = control(nextPicker, 'mg_hom_tradeup-items_').options.filter(option => option.default).map(option => option.value);
    expect(new Set(nextSelected)).toEqual(new Set(statTrak.slice(10, 20).map(item => item.id)));
    expect(await disk.read(guild.id)).toEqual(saved);
});

test.each([
    [1, false, 10], [1, true, 10],
    [2, false, 10], [2, true, 10],
    [3, false, 5], [3, true, 5]
])('quick Trade Up for tier %i and StatTrak %s selects exactly %i from that group', async (tier, statTrak, count) => {
    const skinId = kilowatt.pools[tier].find(id => skins[id].stattrak && skins[id].min != null && skins[id].max > skins[id].min);
    const { min, max } = skins[skinId];
    const makeDrop = (id, tracked) => ({ id: String(id), caseId: kilowatt.id, skinId, tier, float: (min + max) / 2, statTrak: tracked });
    const sameGroup = Array.from({ length: 2 * count }, (_, index) => makeDrop(100 + index, statTrak));
    const otherGroup = Array.from({ length: count }, (_, index) => makeDrop(200 + index, !statTrak));
    await setStash([...sameGroup, ...otherGroup]);
    const before = await disk.read(guild.id);
    const board = await openTradeUp();
    const group = `${tier}:${Number(statTrak)}`;
    const quick = quickControl(board, group);
    expect(quick?.disabled).toBe(false);
    const picker = await click(quick.custom_id);
    expect(payload(picker).embeds[0].toJSON().description).toContain(`${count}/${count}`);
    const selected = control(picker, 'mg_hom_tradeup-items_').options.filter(option => option.default).map(option => option.value);
    expect(new Set(selected)).toEqual(new Set(sameGroup.slice(0, count).map(item => item.id)));
    expect(await disk.read(guild.id)).toEqual(before);

    const confirmed = await click(enabledControl(picker, 'mg_hom_tradeup-direct_').custom_id);
    const saved = await disk.read(guild.id);
    expect(saved.skinCases[user.id].drops.filter(item => !item.tradeUp)).toEqual([...sameGroup.slice(count), ...otherGroup]);
    expect(saved.skinCases[user.id].drops.find(item => item.tradeUp)).toMatchObject({ id: confirmed.id, tier: tier + 1, statTrak });
    const next = quickControl(confirmed, group, 'next');
    expect(next?.disabled).toBe(false);
    const nextPicker = await click(next.custom_id);
    const nextSelected = control(nextPicker, 'mg_hom_tradeup-items_').options.filter(option => option.default).map(option => option.value);
    expect(new Set(nextSelected)).toEqual(new Set(sameGroup.slice(count).map(item => item.id)));
    expect(await disk.read(guild.id)).toEqual(saved);
});

test('quick controls for all eligible rarity groups fit the Discord message', async () => {
    const drops = [0, 1, 2, 3].flatMap(tier => {
        const skinId = kilowatt.pools[tier].find(id => skins[id].stattrak && skins[id].min != null && skins[id].max > skins[id].min);
        const { min, max } = skins[skinId];
        return [false, true].flatMap(statTrak => Array.from({ length: tier === 3 ? 5 : 10 }, (_, index) => ({
            id: String(tier * 100 + Number(statTrak) * 20 + index + 100), caseId: kilowatt.id, skinId, tier,
            float: (min + max) / 2, statTrak
        })));
    });
    await setStash(drops);
    const board = await openTradeUp();
    const rows = payload(board).components.map(row => row.toJSON().components);
    expect(rows.length).toBeLessThanOrEqual(5);
    expect(rows.every(row => row.length <= 5)).toBe(true);
    expect(rows.flat().filter(item => item.custom_id?.startsWith('mg_hom_tradeup-quick_'))).toHaveLength(8);
});

test('Trade Up combines picks across pages and persists one result after an authorized confirmation', async () => {
    const drops = Array.from({ length: 32 }, (_, index) => drop(100 + index, index % 2 ? revolution : kilowatt));
    const protectedDrop = drop(150, kilowatt, true);
    await setStash([...drops, protectedDrop]);
    const before = await disk.read(guild.id);
    const firstPage = await pickGroup();
    expect(control(firstPage, 'mg_hom_tradeup-review_')?.disabled ?? true).toBe(true);
    const firstPick = await chooseDrops(firstPage, 4);
    const next = enabledControl(firstPick.panel, 'mg_hom_tradeup-pick-page_');
    expect(next).toBeDefined();
    const secondPage = await click(next.custom_id);
    const secondPick = await chooseDrops(secondPage, 6);
    const selectedIds = new Set([...firstPick.ids, ...secondPick.ids]);
    expect(selectedIds.size).toBe(10);
    const preview = await review(secondPick.panel);
    const oddsNext = enabledControl(preview, 'mg_hom_tradeup-odds-page_');
    expect(oddsNext).toBeDefined();
    const lastOdds = await click(oddsNext.custom_id);
    const visibleOutcomes = [preview, lastOdds].flatMap(panel => payload(panel).embeds.map(embed => embed.toJSON()));
    const selectedCases = [...new Set(drops.filter(item => selectedIds.has(item.id)).map(item => item.caseId))];
    expect(selectedCases).toHaveLength(2);
    for (const weaponCase of [kilowatt, revolution]) {
        for (const skinId of weaponCase.pools[1]) {
            expect(JSON.stringify(visibleOutcomes)).toContain(skins[skinId].name);
        }
    }
    expect(await disk.read(guild.id)).toEqual(before);

    const confirmId = control(lastOdds, 'mg_hom_tradeup-confirm_').custom_id;
    await click(confirmId, { message: { id: '701' } });
    await click(confirmId, { user: { id: '14' } });
    expect(await disk.read(guild.id)).toEqual(before);

    const confirmed = await click(confirmId);
    const saved = await disk.read(guild.id);
    const stash = saved.skinCases[user.id];
    const result = stash.drops.find(item => item.tradeUp);
    expect(result).toMatchObject({ id: confirmed.id, tier: 1, statTrak: false, tradeUp: true });
    expect(cases.find(item => item.id === result.caseId).pools[1]).toContain(result.skinId);
    const { min, max } = skins[result.skinId];
    expect(result.float).toBe(Math.round((min + 0.25 * (max - min)) * 1e6) / 1e6);
    expect(stash.drops.filter(item => item.id !== result.id)).toEqual(
        [...drops, protectedDrop].filter(item => !selectedIds.has(item.id))
    );
    expect(stash.cases).toEqual(before.skinCases[user.id].cases);
    expect(stash.keys).toEqual(before.skinCases[user.id].keys);
    expect(saved.taixiu).toEqual(before.taixiu);
    expect(JSON.stringify(payload(confirmed).embeds.map(embed => embed.toJSON()))).toContain('Trade Up');
    expect(control(confirmed, 'mg_hom_replay_')).toBeUndefined();

    await click(confirmId, { id: confirmed.id });
    expect(await disk.read(guild.id)).toEqual(saved);
});

test('Trade Up rejects the previous confirmation after the selection is edited', async () => {
    await setStash(Array.from({ length: 11 }, (_, index) => drop(100 + index)));
    const before = await disk.read(guild.id);
    const firstPick = await chooseDrops(await pickGroup(), 10);
    const firstReview = await review(firstPick.panel);
    const oldConfirm = control(firstReview, 'mg_hom_tradeup-confirm_').custom_id;
    const edit = await click(control(firstReview, 'mg_hom_tradeup-edit_').custom_id);
    const menu = control(edit, 'mg_hom_tradeup-items_');
    const replacementIds = menu.options.slice(-10).map(option => option.value);
    const nextPick = await select(menu.custom_id, replacementIds);
    const secondReview = await review(nextPick);
    const newConfirm = control(secondReview, 'mg_hom_tradeup-confirm_').custom_id;
    expect(newConfirm).not.toBe(oldConfirm);
    await click(oldConfirm);
    expect(await disk.read(guild.id)).toEqual(before);
    await click(newConfirm);
    const saved = await disk.read(guild.id);
    expect(saved.skinCases[user.id].drops.filter(item => !item.tradeUp).map(item => item.id))
        .toEqual(before.skinCases[user.id].drops.filter(item => !replacementIds.includes(item.id)).map(item => item.id));
});

test('Trade Up rechecks selected inventory before consuming any items', async () => {
    await setStash(Array.from({ length: 11 }, (_, index) => drop(100 + index)));
    const { panel, ids } = await chooseDrops(await pickGroup(), 10);
    const preview = await review(panel);
    const confirmId = control(preview, 'mg_hom_tradeup-confirm_').custom_id;
    await disk.transact(guild.id, async (state, save) => {
        const stash = state.skinCases[user.id];
        stash.drops = stash.drops.filter(item => item.id !== ids[0]);
        await save();
    });
    const before = await disk.read(guild.id);
    await click(confirmId);
    expect(await disk.read(guild.id)).toEqual(before);
});

test('Trade Up confirms the same items after their inventory order changes', async () => {
    await setStash(Array.from({ length: 10 }, (_, index) => drop(100 + index)));
    const { panel } = await chooseDrops(await pickGroup(), 10);
    const confirm = control(await review(panel), 'mg_hom_tradeup-confirm_');
    await disk.transact(guild.id, async (state, save) => {
        state.skinCases[user.id].drops.reverse();
        await save();
    });
    const completed = await click(confirm.custom_id);
    expect((await disk.read(guild.id)).skinCases[user.id].drops).toEqual([
        expect.objectContaining({ id: completed.id, tradeUp: true })
    ]);
});

test('Trade Up asks for a new confirmation if an item left and re-entered the inventory', async () => {
    const initial = Array.from({ length: 10 }, (_, index) => ({ ...drop(100 + index), acquiredAt: Date.now() - 1000 }));
    await setStash(initial);
    const { panel } = await chooseDrops(await pickGroup(), 10);
    const confirm = control(await review(panel), 'mg_hom_tradeup-confirm_');
    await disk.transact(guild.id, async (state, save) => {
        state.skinCases[user.id].drops[0].acquiredAt += 500;
        await save();
    });
    const before = await disk.read(guild.id);
    const stale = await click(confirm.custom_id);
    expect(payload(stale).embeds[0].toJSON().footer.text).toContain('Kho đã thay đổi');
    expect(await disk.read(guild.id)).toEqual(before);
});

test.each(['direct', 'review'])('Trade Up %s rejects a selection after a skin is listed and returned by cancelling escrow', async stage => {
    const initial = Array.from({ length: 10 }, (_, index) => ({ ...drop(100 + index), acquiredAt: Date.now() - 1000 }));
    await setStash(initial);
    const { panel } = await chooseDrops(await pickGroup(), 10);
    const confirm = stage === 'review' ? control(await review(panel), 'mg_hom_tradeup-confirm_')
        : enabledControl(panel, 'mg_hom_tradeup-direct_');
    await expect(playerMarket.listSkin(guild.id, user.id, initial[0].id, 100n, '9002')).resolves.toHaveProperty('status', 'listed');
    await expect(playerMarket.cancelListing(guild.id, user.id, '9002')).resolves.toHaveProperty('status', 'cancelled');
    const before = await disk.read(guild.id);

    const stale = await click(confirm.custom_id);

    expect(await disk.read(guild.id)).toEqual(before);
    expect(payload(stale).embeds[0].toJSON().footer.text).toContain('Kho đã thay đổi');
});

test('Covert Trade Up combines matching knife odds across cases and shows the phase split', async () => {
    const chroma = cases.find(item => item.id === 'crate-4061');
    const chroma2 = cases.find(item => item.id === 'crate-4089');
    const drops = [chroma, chroma, chroma2, chroma2, chroma2].map((weaponCase, index) => {
        const skinId = weaponCase.pools[3][0];
        const { min, max } = skins[skinId];
        return { id: String(100 + index), caseId: weaponCase.id, skinId, tier: 3, float: (min + max) / 2, statTrak: true };
    });
    await setStash(drops);
    const group = control(await openTradeUp(), 'mg_hom_tradeup-group_');
    const picker = await select(group.custom_id, ['3:1']);
    const { panel } = await chooseDrops(picker, 5);
    const preview = await review(panel);
    const embed = payload(preview).embeds[0].toJSON();
    expect(embed.description).toContain('**3,333%**');
    expect(embed.description).toContain('0,476% mỗi phase');
    expect(embed.fields[0].value).toContain('Chroma Case · **40%**');
    expect(embed.fields[0].value).toContain('Chroma 2 Case · **60%**');
    await click(control(preview, 'mg_hom_tradeup-confirm_').custom_id);
    const [result] = (await disk.read(guild.id)).skinCases[user.id].drops;
    expect(result).toMatchObject({ tier: 4, statTrak: true, tradeUp: true });
    expect(chroma.pools[4]).toContain(result.skinId);
});
