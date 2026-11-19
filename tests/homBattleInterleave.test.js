const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { MessageFlags } = require('discord.js');
const store = require('../utils/managementStore');
const market = require('../utils/cs2Market');
const wallet = require('../commands/taixiu');
const battle = require('../utils/cs2Battles');
const { customCases, CREATIVE_CASE_IDS, DISCOVERY_CASE_IDS, casePricing } = require('../utils/cs2BattleCases');
const { createBattleUi, DRAFT_TTL } = require('../utils/cs2BattleUi');

const guild = { id: '1' };
const channelId = '20';
const users = ['101', '102', '103'];
// Deliberately use a different order from the catalogue.
const [A, B, C] = [customCases[2], customCases[0], customCases[1]];
const NOW = Date.UTC(2026, 10, 16, 12);
let directory;
let disk;
let ui;
let nextId = 300_000;

beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-battle-interleave-'));
    disk = store.createManagementStore(directory);
    jest.spyOn(store, 'read').mockImplementation(disk.read);
    jest.spyOn(store, 'transact').mockImplementation(disk.transact);
    jest.spyOn(market, 'peekMarketQuote').mockReturnValue({ priceVnd: 100 });
    jest.spyOn(wallet, 'refreshCoinLeaderboard').mockImplementation(() => {});
    jest.spyOn(crypto, 'randomInt').mockImplementation((min, max) => max == null ? 0 : min);
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    ui = createBattleUi({ rollDrop: jest.fn(), dropName: drop => `Skin ${drop.skinId}`,
        dropImage: () => 'https://example.com/skin.png', showResult: jest.fn(), reelRound: jest.fn() });
    await disk.transact(guild.id, async (state, save) => {
        state.taixiu.balances = Object.fromEntries(users.map(id => [id, 500_000]));
        await save();
    });
});

afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(directory, { recursive: true, force: true });
});

function interaction(userId, customId, extra = {}) {
    return { id: String(++nextId), guild, guildId: guild.id, channelId, user: { id: userId }, customId,
        attachmentSizeLimit: 0, reply: jest.fn(), deferReply: jest.fn(), deferUpdate: jest.fn(),
        editReply: jest.fn(), followUp: jest.fn(), showModal: jest.fn(), ...extra };
}

const payload = request => request.editReply.mock.calls.at(-1)[0];
const controls = panel => panel.components.flatMap(row => row.toJSON().components);
const control = (panel, action) => controls(panel).find(item => item.custom_id?.startsWith(`mg_hom_battle-${action}_`));
const scheduleText = panel => panel.embeds[0].data.fields.find(field => field.name.startsWith('Lịch mở ·')).value;
const expectedText = ids => ids.map((id, index) => `${index + 1}. ${battle.getBattleCase(id).name}`).join('\n');

async function click(panel, action, values, extra = {}, userId = users[0]) {
    const request = interaction(userId, control(panel, action).custom_id, { values, ...extra });
    await ui.handle(request);
    return request;
}

async function builder() {
    const request = interaction(users[0], 'mg_hom_battle-new_crate-4904');
    await ui.handle(request);
    return payload(request);
}

async function add(panel, item, quantity) {
    panel = payload(await click(panel, 'group', [item.group]));
    while (!control(panel, 'preview').options.some(option => option.value === item.id)) {
        expect(control(panel, 'preview').options.some(option => option.value === 'next')).toBe(true);
        panel = payload(await click(panel, 'preview', ['next']));
    }
    panel = payload(await click(panel, 'preview', [item.id]));
    const open = await click(panel, 'quantity');
    const modal = open.showModal.mock.calls[0][0].toJSON();
    const submit = interaction(users[0], modal.custom_id, { fields: { getTextInputValue: () => String(quantity) } });
    await ui.handle(submit);
    return payload(await click(payload(submit), 'add'));
}

async function schedule(entries = [[A, 3], [B, 2], [C, 1]]) {
    let panel = await builder();
    for (const [item, quantity] of entries) panel = await add(panel, item, quantity);
    return payload(await click(panel, 'schedule'));
}

async function publish(panel) {
    const send = jest.fn().mockResolvedValue({ url: 'https://example.com/room' });
    const request = await click(panel, 'publish', undefined, { channel: { isSendable: () => true, send } });
    expect(send).toHaveBeenCalledTimes(1);
    const state = await disk.read(guild.id);
    const room = state.cs2Battles[request.id];
    expect(room).toBeDefined();
    return { room, state, request };
}

function validPanel(panel) {
    expect(panel.components.length).toBeLessThanOrEqual(5);
    for (const row of panel.components) {
        const components = row.toJSON().components;
        expect(components.length).toBeLessThanOrEqual(5);
        for (const component of components) {
            expect(component.custom_id.length).toBeLessThanOrEqual(100);
            if (component.options) expect(component.options.length).toBeLessThanOrEqual(25);
        }
    }
}

async function assertSchedule(panel, ids) {
    const observed = [];
    for (let page = 0; ; page++) {
        validPanel(panel);
        expect(panel.embeds[0].data.fields[0].name).toContain(`Trang ${page + 1}/${ids.length}`);
        expect(scheduleText(panel).split('\n')).toHaveLength(1);
        observed.push(scheduleText(panel));
        const next = control(panel, 'schedule-next');
        if (next.disabled) break;
        expect(page + 1).toBeLessThan(ids.length);
        panel = payload(await click(panel, 'schedule-next'));
    }
    expect(observed).toHaveLength(ids.length);
    expect(observed.join('\n')).toBe(expectedText(ids));
    while (!control(panel, 'schedule-prev').disabled) panel = payload(await click(panel, 'schedule-prev'));
    expect(panel.embeds[0].data.fields[0].name).toContain(`Trang 1/${ids.length}`);
    return panel;
}

test('interleave uses first occurrence order and publishes the same counts, rounds and locked fee', async () => {
    let panel = await schedule();
    const before = [A.id, A.id, A.id, B.id, B.id, C.id];
    const expected = [A.id, B.id, C.id, A.id, B.id, A.id];
    panel = await assertSchedule(panel, before);
    const description = panel.embeds[0].data.description;
    const balance = (await disk.read(guild.id)).taixiu;
    const random = crypto.randomInt.mock.calls.length;
    expect(control(panel, 'interleave')).toMatchObject({ label: 'Xếp đan xen', disabled: false });
    panel = payload(await click(panel, 'interleave'));
    validPanel(panel);
    panel = await assertSchedule(panel, expected);
    expect(panel.embeds[0].data.description).toBe(description);
    expect(crypto.randomInt).toHaveBeenCalledTimes(random);
    expect((await disk.read(guild.id)).taixiu).toEqual(balance);
    const { room, state } = await publish(panel);
    expect(room.caseIds).toEqual(expected);
    expect(room.fee).toBe(before.reduce((sum, id) => sum + casePricing(battle.getBattleCase(id)).fee, 0n).toString());
    expect(room.caseIds).toHaveLength(6);
    expect(room).toMatchObject({ format: '2', mode: 'regular', tieRule: 'split', animationMode: 'full' });
    expect(state.taixiu).toEqual(balance);
    expect((await battle.getHistoryConfig(guild.id, users[0], room.id)).caseIds).toEqual(expected);
});

test.each([
    ['first expansion', () => customCases.slice(48, 72), ['weapon', 'theme', 'gold']],
    ['creative expansion', () => customCases.filter(item => CREATIVE_CASE_IDS.includes(item.id)), ['weapon', 'theme', 'gold', 'casual']],
    ['discovery expansion', () => customCases.filter(item => DISCOVERY_CASE_IDS.includes(item.id)), ['weapon', 'theme', 'gold', 'casual']]
])('the %s cases can be found, interleaved, opened and retained in history', async (_name, getCases, groups) => {
    const added = getCases();
    expect(added.length).toBeGreaterThan(0);
    const selected = groups.map(group => added.find(item => item.group === group));
    expect(selected.every(Boolean)).toBe(true);
    let panel = payload(await click(await schedule(selected.map(item => [item, 2])), 'interleave'));
    const expected = [...selected, ...selected].map(item => item.id);
    panel = await assertSchedule(panel, expected);
    const { room } = await publish(panel);
    expect(room.caseIds).toEqual(expected);
    const result = await battle.actOnRoom(guild, channelId, room.id, users[0], 'bot-start');
    expect(result.room.status).toBe('finished');
    expect(result.room.rounds.map(round => round.caseId)).toEqual(expected);
    for (const round of result.room.rounds) {
        expect(round.entries).toHaveLength(2);
        expect(round.entries.every(entry => entry.drop.battleCaseId === round.caseId)).toBe(true);
    }
    expect((await battle.getHistoryConfig(guild.id, users[0], room.id)).caseIds).toEqual(expected);
});

test('interleave is repeatable and later additions stay appended until the user rearranges again', async () => {
    let panel = payload(await click(await schedule(), 'interleave'));
    const expected = [A.id, B.id, C.id, A.id, B.id, A.id];
    panel = await assertSchedule(panel, expected);
    panel = payload(await click(panel, 'interleave'));
    panel = await assertSchedule(panel, expected);
    panel = payload(await click(panel, 'catalogue'));
    panel = await add(panel, C, 2);
    panel = payload(await click(panel, 'schedule'));
    const appended = [A.id, B.id, C.id, A.id, B.id, A.id, C.id, C.id];
    panel = await assertSchedule(panel, appended);
    expect(control(panel, 'add').label).toBe('Thêm ×2');
    const { room } = await publish(panel);
    expect(room.caseIds).toEqual(appended);
});

test('Blue Gem interleaves with ordinary cases and keeps its exact seeds and pricing identity in rounds and history', async () => {
    const blue = battle.getBattleCase('battle-blue-gem');
    const expected = [blue.id, A.id, blue.id];
    let panel = payload(await click(await schedule([[blue, 2], [A, 1]]), 'interleave'));
    panel = await assertSchedule(panel, expected);
    const { room } = await publish(panel);
    const result = await battle.actOnRoom(guild, channelId, room.id, users[0], 'bot-start');
    expect(result.room.rounds.map(round => round.caseId)).toEqual(expected);
    for (const round of result.room.rounds.filter(round => round.caseId === blue.id)) {
        expect(round.entries.every(entry => entry.drop.paintSeed === 868 && entry.drop.priceVariant === 'blue-gem')).toBe(true);
    }
    expect((await battle.getHistoryConfig(guild.id, users[0], room.id)).caseIds).toEqual(expected);
});

test('history reuse and participant recreation preserve the exact interleaved opening order', async () => {
    const expected = [A.id, B.id, C.id, A.id, B.id, A.id];
    const first = await publish(payload(await click(await schedule(), 'interleave')));
    const started = await battle.actOnRoom(guild, channelId, first.room.id, users[0], 'bot-start');
    expect(started.room.rounds.map(round => round.caseId)).toEqual(expected);
    expect((await battle.getHistoryConfig(guild.id, users[0], first.room.id)).caseIds).toEqual(expected);
    let panel = payload(await click(await builder(), 'settings'));
    panel = payload(await click(panel, 'history'));
    panel = payload(await click(panel, 'history-select', [first.room.id]));
    panel = payload(await click(panel, 'history-use'));
    const reused = await publish(panel);
    expect(reused.room.caseIds).toEqual(expected);
    expect(reused.room.fee).toBe(first.room.fee);
    await battle.actOnRoom(guild, channelId, reused.room.id, users[0], 'cancel');
    const original = (await disk.read(guild.id)).cs2Battles[first.room.id];
    const request = interaction(users[0], `mg_hom_battle-recreate_${first.room.id}`);
    await ui.handle(request);
    expect(request.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    const recreated = await publish(payload(request));
    expect(recreated.room.caseIds).toEqual(expected);
    expect(recreated.room.fee).toBe(first.room.fee);
    expect((await disk.read(guild.id)).cs2Battles[first.room.id]).toEqual(original);
});

test('a full 100-round schedule resets pagination, keeps every case and never adds a 101st round', async () => {
    let panel = await schedule([[A, 51], [B, 49]]);
    const description = panel.embeds[0].data.description;
    for (let index = 0; index < 4; index++) panel = payload(await click(panel, 'schedule-next'));
    expect(panel.embeds[0].data.fields[0].name).toContain('Trang 5/100');
    panel = payload(await click(panel, 'interleave'));
    validPanel(panel);
    expect(panel.embeds[0].data.fields[0].name).toContain('Trang 1/100');
    expect(panel.embeds[0].data.description).toBe(description);
    const expected = [...Array.from({ length: 49 }, () => [A.id, B.id]).flat(), A.id, A.id];
    panel = await assertSchedule(panel, expected);
    expect(control(panel, 'add').disabled).toBe(true);
    panel = payload(await click(panel, 'add'));
    const { room } = await publish(panel);
    expect(room.caseIds).toEqual(expected);
    expect(room.caseIds).toHaveLength(100);
    expect(room.fee).toBe((casePricing(A).fee * 51n + casePricing(B).fee * 49n).toString());
});

test('one case type disables interleave and a forged click preserves its count and fee', async () => {
    let panel = await schedule([[A, 3]]);
    expect(control(panel, 'interleave').disabled).toBe(true);
    const description = panel.embeds[0].data.description;
    panel = payload(await click(panel, 'interleave'));
    expect(panel.embeds[0].data.description).toBe(description);
    panel = await assertSchedule(panel, [A.id, A.id, A.id]);
    expect(control(panel, 'interleave').disabled).toBe(true);
    const { room } = await publish(panel);
    expect(room.caseIds).toEqual([A.id, A.id, A.id]);
    expect(room.fee).toBe((casePricing(A).fee * 3n).toString());
});

test('interleave rejects another user and old revisions without changing the current draft', async () => {
    let panel = await schedule();
    const id = control(panel, 'interleave').custom_id;
    const other = interaction(users[1], id);
    await ui.handle(other);
    expect(other.reply).toHaveBeenCalled();
    expect(other.editReply).not.toHaveBeenCalled();
    panel = payload(await click(panel, 'interleave'));
    const stale = interaction(users[0], id);
    await ui.handle(stale);
    expect(stale.reply).toHaveBeenCalled();
    expect(stale.editReply).not.toHaveBeenCalled();
    const { room } = await publish(panel);
    expect(room.caseIds).toEqual([A.id, B.id, C.id, A.id, B.id, A.id]);
});

test('a failed interleave panel edit preserves the original order and keeps the previous controls usable', async () => {
    const panel = await schedule();
    const id = control(panel, 'interleave').custom_id;
    const failed = interaction(users[0], id, { editReply: jest.fn().mockRejectedValue(new Error('Discord unavailable')) });
    await expect(ui.handle(failed)).rejects.toThrow('Discord unavailable');
    const { room } = await publish(panel);
    expect(room.caseIds).toEqual([A.id, A.id, A.id, B.id, B.id, C.id]);
});

test('an expired interleave control cannot publish or modify the old draft', async () => {
    const panel = await schedule();
    const state = await disk.read(guild.id);
    Date.now.mockReturnValue(NOW + DRAFT_TTL + 1);
    const request = interaction(users[0], control(panel, 'interleave').custom_id);
    await ui.handle(request);
    expect(request.reply).toHaveBeenCalled();
    expect(request.editReply).not.toHaveBeenCalled();
    expect(await disk.read(guild.id)).toEqual(state);
});
