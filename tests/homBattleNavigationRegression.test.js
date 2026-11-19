jest.mock('../utils/cs2BattleArt', () => ({
    getBattleCaseArt: jest.fn(() => null), getBattleTieArt: jest.fn(() => null),
    getBattleTieAnimation: jest.fn(() => null)
}));

const { MessageFlags } = require('discord.js');
const market = require('../utils/cs2Market');
const battle = require('../utils/cs2Battles');
const { customCasesById } = require('../utils/cs2BattleCases');
const { createBattleUi } = require('../utils/cs2BattleUi');

const IDLE_LIMIT = 15 * 60_000;
const BROWSE_INTERVAL = 14 * 60_000;
const guild = { id: '1' };
let now;
let nextId = 910_000;
let ui;

function request(customId, options = {}) {
    return {
        id: String(++nextId), customId, guild, guildId: guild.id, channelId: '20',
        user: { id: '101' }, message: { id: 'builder-message' }, attachmentSizeLimit: 0,
        reply: jest.fn(), deferReply: jest.fn(), deferUpdate: jest.fn(), editReply: jest.fn(),
        update: jest.fn(), followUp: jest.fn(), showModal: jest.fn(), ...options
    };
}

function response(interaction) {
    for (const method of ['editReply', 'update', 'reply']) {
        if (interaction[method].mock.calls.length) return interaction[method].mock.calls.at(-1)[0];
    }
    throw new Error('Interaction did not receive a response');
}
const controls = panel => (panel.components ?? []).flatMap(row => row.toJSON?.().components ?? row.components ?? []);
const control = (panel, action) => controls(panel).find(item => item.custom_id?.startsWith(`mg_hom_battle-${action}_`));
const rounds = panel => panel.embeds[0].data.fields.find(field => field.name.startsWith('Số vòng')).name;

async function builder(messageId = 'builder-message') {
    const interaction = request('mg_hom_battle-new_crate-4904_battle-knife', { message: { id: messageId } });
    await ui.handle(interaction);
    return response(interaction);
}
async function click(panel, action, options = {}) {
    const item = control(panel, action);
    expect(item).toBeDefined();
    const interaction = request(item.custom_id, options);
    await ui.handle(interaction);
    return interaction;
}

beforeEach(() => {
    now = Date.UTC(2026, 10, 17, 8);
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    jest.spyOn(market, 'peekMarketQuote').mockReturnValue({ priceVnd: 100 });
    jest.spyOn(battle, 'createRoom').mockRejectedValue(new Error('Unexpected room creation'));
    jest.spyOn(battle, 'openSolo').mockRejectedValue(new Error('Unexpected charge'));
    ui = createBattleUi({ rollDrop: jest.fn(), dropName: drop => drop.skinId,
        dropImage: () => 'https://example.com/skin.png', showResult: jest.fn(), reelRound: jest.fn() });
});
afterEach(() => jest.restoreAllMocks());

test('viewing and paging odds keeps the builder usable when the player returns after reading', async () => {
    const panel = await builder();
    now += BROWSE_INTERVAL;
    const opened = await click(panel, 'draft-odds');
    const first = response(opened);
    expect(first.embeds[0].data.title).toContain('Vật phẩm');
    now += BROWSE_INTERVAL;
    const nextId = controls(first).find(item => item.label === 'Trang sau').custom_id;
    const next = request(nextId, { message: { id: 'odds-message', flags: { has: flag => flag === MessageFlags.Ephemeral } } });
    await ui.handle(next);
    expect(response(next).embeds[0].data.footer.text).toContain('Trang 2/');
    now += BROWSE_INTERVAL;
    const add = await click(panel, 'add');
    expect(rounds(response(add))).toBe('Số vòng · 1/100');
    expect(battle.openSolo).not.toHaveBeenCalled();
    expect(battle.createRoom).not.toHaveBeenCalled();
});

test('opening the quantity modal counts as activity while the player fills the form', async () => {
    const panel = await builder();
    now += BROWSE_INTERVAL;
    const opened = await click(panel, 'quantity');
    const form = opened.showModal.mock.calls[0][0].toJSON();
    now += BROWSE_INTERVAL;
    const submitted = request(form.custom_id, { fields: { getTextInputValue: () => '3' } });
    await ui.handle(submitted);
    const add = await click(response(submitted), 'add');
    expect(rounds(response(add))).toBe('Số vòng · 3/100');
});

test('separate builder messages for the same player keep their own schedules and controls', async () => {
    const first = await builder('first-message');
    const second = await builder('second-message');
    const editedFirst = await click(first, 'add', { message: { id: 'first-message' } });
    expect(rounds(response(editedFirst))).toBe('Số vòng · 1/100');
    const editedSecond = await click(second, 'add', { message: { id: 'second-message' } });
    expect(rounds(response(editedSecond))).toBe('Số vòng · 1/100');
    const anotherFirst = await click(response(editedFirst), 'add', { message: { id: 'first-message' } });
    expect(rounds(response(anotherFirst))).toBe('Số vòng · 2/100');
});

test('odds opened earlier keep the original case after the builder selects another case', async () => {
    const initial = await builder();
    const odds = response(await click(initial, 'draft-odds'));
    const title = odds.embeds[0].data.title;
    const alternative = control(initial, 'preview').options.find(option => !option.default && option.value.startsWith('battle-'));
    expect(alternative).toBeDefined();
    const selected = await click(initial, 'preview', { values: [alternative.value] });
    const next = request(controls(odds).find(item => item.label === 'Trang sau').custom_id,
        { message: { id: 'odds-message' } });
    await ui.handle(next);
    expect(response(next).embeds[0].data.title).toBe(title);
    expect(response(next).embeds[0].data.footer.text).toContain('Trang 2/');
    const add = await click(response(selected), 'add');
    expect(rounds(response(add))).toBe('Số vòng · 1/100');
    expect(response(add).embeds[0].data.title).toContain(alternative.label);
});

test('returning after market prices move a selected case to another page keeps that case selected', async () => {
    const item = customCasesById.get('battle-archive-anubis');
    const names = new Set(item.entries.map(entry => entry.ref.name));
    let selectedPrice = 1;
    market.peekMarketQuote.mockImplementation(name => ({ priceVnd: names.has(name) ? selectedPrice : 100 }));
    const opened = request(`mg_hom_battle-new_crate-4904_${item.id}`);
    await ui.handle(opened);
    const panel = response(opened);
    expect(control(panel, 'preview').options.some(option => option.value === 'previous')).toBe(false);
    await click(panel, 'draft-odds');
    selectedPrice = 1_000_000;
    now += 6_000;
    const returned = response(await click(panel, 'add'));
    expect(rounds(returned)).toBe('Số vòng · 1/100');
    expect(returned.embeds[0].data.title).toContain(item.name);
    const menu = control(returned, 'preview');
    expect(menu.options.find(option => option.default).value).toBe(item.id);
    expect(menu.options.some(option => option.value === 'previous')).toBe(true);
});

test('a failed replacement of the same message leaves its existing builder usable', async () => {
    const initial = await builder('same-message');
    const failure = new Error('Discord unavailable');
    const replacement = request('mg_hom_battle-new_crate-4904_battle-knife', {
        message: { id: 'same-message' }, editReply: jest.fn().mockRejectedValue(failure)
    });
    await expect(ui.handle(replacement)).rejects.toBe(failure);
    const add = await click(initial, 'add', { message: { id: 'same-message' } });
    expect(rounds(response(add))).toBe('Số vòng · 1/100');
});

test('a failed odds reply does not renew the idle session', async () => {
    const initial = await builder();
    now += BROWSE_INTERVAL;
    const failure = new Error('Discord unavailable');
    const opened = request(control(initial, 'draft-odds').custom_id, { reply: jest.fn().mockRejectedValue(failure) });
    await expect(ui.handle(opened)).rejects.toBe(failure);
    now += 2 * 60_000;
    const expired = await click(initial, 'add');
    expect(response(expired).content).toBeTruthy();
    expect(expired.editReply).not.toHaveBeenCalled();
});

test('an old revision cannot repeat an action or alter the latest builder', async () => {
    const initial = await builder();
    const changed = await click(initial, 'add');
    const stale = await click(initial, 'add');
    expect(response(stale).content).toContain('Bảng vừa đổi');
    expect(stale.editReply).not.toHaveBeenCalled();
    const current = await click(response(changed), 'add');
    expect(rounds(response(current))).toBe('Số vòng · 2/100');
});

test('another player cannot use a private builder even with its complete button identity', async () => {
    const panel = await builder();
    const outsider = await click(panel, 'solo', { user: { id: '102' } });
    expect(response(outsider).content).toBeTruthy();
    expect(outsider.editReply).not.toHaveBeenCalled();
    expect(battle.openSolo).not.toHaveBeenCalled();
    const owner = await click(panel, 'add');
    expect(rounds(response(owner))).toBe('Số vòng · 1/100');
});

test('a truly idle expired money action offers recovery without opening or charging', async () => {
    const panel = await builder();
    now += IDLE_LIMIT + 1;
    const expired = await click(panel, 'solo');
    const warning = response(expired);
    expect(warning.content).toBeTruthy();
    expect(battle.openSolo).not.toHaveBeenCalled();
    expect(battle.createRoom).not.toHaveBeenCalled();
    const reopen = controls(warning).find(item => item.custom_id?.startsWith('mg_hom_battle-new_'));
    expect(reopen).toBeDefined();
    const recovered = request(reopen.custom_id, { message: { id: 'recovery-message' } });
    await ui.handle(recovered);
    expect(rounds(response(recovered))).toBe('Số vòng · 0/100');
    expect(battle.openSolo).not.toHaveBeenCalled();
});
