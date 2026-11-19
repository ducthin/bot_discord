const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const store = require('../utils/managementStore');
const market = require('../utils/cs2Market');
const wallet = require('../commands/taixiu');
const battle = require('../utils/cs2Battles');
const { customCases, casePricing, lockCasePricing } = require('../utils/cs2BattleCases');
const { createBattleUi } = require('../utils/cs2BattleUi');

const guild = { id: '1' };
const channelId = '20';
const hostId = '101';
let nextId = 400_000;
let directory;
let disk;
let ui;

beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-battle-modal-'));
    disk = store.createManagementStore(directory);
    jest.spyOn(store, 'read').mockImplementation(disk.read);
    jest.spyOn(store, 'transact').mockImplementation(disk.transact);
    jest.spyOn(market, 'peekMarketQuote').mockReturnValue({ priceVnd: 100 });
    jest.spyOn(wallet, 'refreshCoinLeaderboard').mockImplementation(() => {});
    jest.spyOn(crypto, 'randomInt').mockImplementation((min, max) => max == null ? 0 : min);
    ui = createBattleUi({ rollDrop: jest.fn(), dropName: drop => `Skin ${drop.skinId}`,
        dropImage: () => 'https://example.com/skin.png', showResult: jest.fn(), reelRound: jest.fn() });
    await disk.transact(guild.id, async (state, save) => {
        state.taixiu.balances[hostId] = 500_000;
        await save();
    });
});

afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(directory, { recursive: true, force: true });
});

function validateModal(modal) {
    const data = modal.toJSON();
    for (const [rowIndex, row] of data.components.entries()) for (const [index, field] of row.components.entries()) {
        if (typeof field.value === 'string' && field.max_length != null && field.value.length > field.max_length) {
            const error = new Error(`Invalid Form Body: data.components[${rowIndex}].components[${index}].value ` +
                `BASE_TYPE_MAX_LENGTH: '${field.value}' has ${field.value.length} characters; maximum ${field.max_length}`);
            error.code = 50035;
            throw error;
        }
    }
    return data;
}

function interaction(customId, extra = {}) {
    return { id: String(++nextId), guild, guildId: guild.id, channelId, user: { id: hostId }, customId,
        attachmentSizeLimit: 0, reply: jest.fn(), deferReply: jest.fn(), deferUpdate: jest.fn(), editReply: jest.fn(),
        followUp: jest.fn(), showModal: jest.fn(async modal => validateModal(modal)), ...extra };
}

const payload = request => request.editReply.mock.calls.at(-1)[0];
const control = (panel, action) => panel.components.flatMap(row => row.toJSON().components)
    .find(item => item.custom_id?.startsWith(`mg_hom_battle-${action}_`));

async function click(panel, action, values) {
    const request = interaction(control(panel, action).custom_id, { values });
    await ui.handle(request);
    return request;
}

async function builder() {
    const request = interaction('mg_hom_battle-new_crate-4904');
    await ui.handle(request);
    return payload(request);
}

async function finishedRoom(format, playerLimit) {
    const item = customCases[0];
    const { room, error } = await battle.createRoom(guild.id, { id: String(++nextId), channelId, hostId,
        caseIds: [item.id], format, ...(playerLimit == null ? {} : { playerLimit }), mode: 'regular',
        expectedPrices: { [item.id]: lockCasePricing(casePricing(item)) } });
    expect(error).toBeUndefined();
    const result = await battle.actOnRoom(guild, channelId, room.id, hostId, 'bot-start');
    expect(result.room.status).toBe('finished');
    return result.room;
}

async function recreate(room) {
    const request = interaction(`mg_hom_battle-recreate_${room.id}`);
    await ui.handle(request);
    return payload(request);
}

function input(request, value) {
    expect(request.showModal).toHaveBeenCalledTimes(1);
    const modal = validateModal(request.showModal.mock.calls[0][0]);
    const field = modal.components[0].components[0];
    const maxLength = field.custom_id === 'quantity' ? 3 : 2;
    expect(field).toMatchObject({ value: String(value), max_length: maxLength });
    expect(field.value).toMatch(new RegExp(`^\\d{1,${maxLength}}$`));
    return modal;
}

test.each(['2', '3', '4', 'teams'])('recreating %s and changing to custom opens a valid default five-player modal', async format => {
    const room = await finishedRoom(format);
    let panel = await recreate(room);
    input(await click(panel, 'quantity'), 1);
    panel = payload(await click(panel, 'rules', ['custom:regular']));
    panel = payload(await click(panel, 'settings'));
    input(await click(panel, 'player-limit'), 5);
});

test('a new draft has safe quantity and custom-player defaults', async () => {
    let panel = await builder();
    input(await click(panel, 'quantity'), 1);
    panel = payload(await click(panel, 'rules', ['custom:crazy']));
    panel = payload(await click(panel, 'settings'));
    input(await click(panel, 'player-limit'), 5);
});

test.each([5, 10])('recreating a valid %i-player custom history preserves that limit and a valid quantity', async limit => {
    let panel = await recreate(await finishedRoom('custom', limit));
    input(await click(panel, 'quantity'), 1);
    panel = payload(await click(panel, 'settings'));
    input(await click(panel, 'player-limit'), limit);
});

test('a recreated ordinary battle can publish custom five-player rules without opening the limit modal', async () => {
    const original = await finishedRoom('2');
    let panel = await recreate(original);
    panel = payload(await click(panel, 'rules', ['custom:regular']));
    const before = await disk.read(guild.id);
    const send = jest.fn().mockResolvedValue({ url: 'https://example.com/room' });
    const request = interaction(control(panel, 'publish').custom_id, { channel: { isSendable: () => true, send } });
    await ui.handle(request);
    expect(send).toHaveBeenCalledTimes(1);
    const after = await disk.read(guild.id);
    expect(after.cs2Battles[request.id]).toMatchObject({ format: 'custom', playerLimit: 5, caseIds: original.caseIds });
    expect(after.taixiu).toEqual(before.taixiu);
    expect(after.cs2Battles[original.id]).toEqual(before.cs2Battles[original.id]);
});

test('a valid ten-player custom limit survives switching to ordinary rules and back', async () => {
    let panel = await recreate(await finishedRoom('custom', 10));
    panel = payload(await click(panel, 'rules', ['2:regular']));
    panel = payload(await click(panel, 'rules', ['custom:crazy']));
    panel = payload(await click(panel, 'settings'));
    input(await click(panel, 'player-limit'), 10);
});

test('using ordinary history from a new draft still opens a valid custom-player default', async () => {
    const room = await finishedRoom('3');
    let panel = payload(await click(await builder(), 'settings'));
    panel = payload(await click(panel, 'history'));
    panel = payload(await click(panel, 'history-select', [room.id]));
    panel = payload(await click(panel, 'history-use'));
    panel = payload(await click(panel, 'rules', ['custom:regular']));
    panel = payload(await click(panel, 'settings'));
    input(await click(panel, 'player-limit'), 5);
});

test('quantity one hundred remains within the modal limit after invalid submitted values', async () => {
    let panel = await builder();
    const open = await click(panel, 'quantity');
    const modal = input(open, 1);
    const submit = interaction(modal.custom_id, { fields: { getTextInputValue: () => '100' } });
    await ui.handle(submit);
    panel = payload(submit);
    for (const invalid of ['101', '-1', 'undefined', '0', '1.5', '1e2']) {
        const next = input(await click(panel, 'quantity'), 100);
        const bad = interaction(next.custom_id, { fields: { getTextInputValue: () => invalid } });
        await ui.handle(bad);
        panel = payload(bad);
        input(await click(panel, 'quantity'), 100);
    }
});
