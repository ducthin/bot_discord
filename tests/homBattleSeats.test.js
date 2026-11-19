const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const battle = require('../utils/cs2Battles');
const store = require('../utils/managementStore');
const market = require('../utils/cs2Market');
const reel = require('../utils/cs2Reel');
const { createBattleUi } = require('../utils/cs2BattleUi');
const { customCases, casePricing, lockCasePricing } = require('../utils/cs2BattleCases');

const guild = { id: '1' };
const channelId = '20';
const users = ['101', '102', '103', '104'];
let directory, disk, ui, counter;

beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-battle-seats-ui-'));
    disk = store.createManagementStore(directory);
    counter = 89000;
    jest.spyOn(store, 'read').mockImplementation(disk.read);
    jest.spyOn(store, 'transact').mockImplementation(disk.transact);
    jest.spyOn(market, 'peekMarketQuote').mockReturnValue({ priceVnd: 100 });
    jest.spyOn(crypto, 'randomInt').mockImplementation((min, max) => max == null ? 0 : min);
    jest.spyOn(reel, 'renderCaseBatch').mockResolvedValue(null);
    jest.spyOn(battle, 'markResultPublished').mockResolvedValue(null);
    ui = createBattleUi({ rollDrop: jest.fn(), dropName: () => 'Skin kết quả', dropImage: () => null,
        showResult: jest.fn(), reelRound: (_item, drop) => ({ result: drop }) });
    await disk.transact(guild.id, async (state, save) => {
        state.taixiu.balances = Object.fromEntries(users.map(id => [id, 500000]));
        await save();
    });
});

afterEach(async () => {
    jest.restoreAllMocks();
    for (const file of await fs.readdir(directory)) await fs.unlink(path.join(directory, file));
    await fs.rmdir(directory);
});

async function create(options = {}) {
    const item = customCases[0];
    const result = await battle.createRoom(guild.id, { id: String(++counter), channelId, hostId: users[0],
        caseIds: [item.id], format: '3', mode: 'regular', expectedPrices: { [item.id]: lockCasePricing(casePricing(item)) }, ...options });
    expect(result.error).toBeUndefined();
    return result.room;
}
function request(room, action, userId = users[0], extra = {}) {
    return { id: String(++counter), customId: `mg_hom_battle-${action}_${room.id}`, guild, guildId: guild.id,
        channelId, user: { id: userId }, message: { id: 'message-1' }, attachmentSizeLimit: 0,
        deferUpdate: jest.fn(), editReply: jest.fn(), reply: jest.fn(), followUp: jest.fn(), ...extra };
}
async function act(room, action, userId, extra) {
    const interaction = request(room, action, userId, extra); await ui.handle(interaction); return interaction;
}
const payload = interaction => interaction.editReply.mock.calls.at(-1)?.[0];
const controls = interaction => payload(interaction)?.components.flatMap(row => row.toJSON().components) ?? [];
const seatMenu = interaction => controls(interaction).find(item => item.custom_id?.startsWith('mg_hom_battle-seat_'));
const playersText = interaction => payload(interaction).embeds[0].toJSON().fields.find(field => field.name === 'Người chơi').value;
const choose = (room, seat, userId = users[0]) => act(room, 'seat', userId, { values: [String(seat)] });

function validPanel(interaction) {
    const view = payload(interaction);
    expect(view.components.length).toBeLessThanOrEqual(5);
    let length = 0;
    for (const row of view.components) {
        const items = row.toJSON().components;
        expect(items.length).toBeLessThanOrEqual(5);
        for (const item of items) {
            expect(item.custom_id.length).toBeLessThanOrEqual(100);
            if (item.options) {
                expect(item.options.length).toBeLessThanOrEqual(25);
                for (const option of item.options) {
                    expect(option.label.length).toBeLessThanOrEqual(100);
                    expect(option.description?.length ?? 0).toBeLessThanOrEqual(100);
                }
            }
        }
    }
    for (const embed of view.embeds) {
        const data = embed.toJSON();
        expect(data.description.length).toBeLessThanOrEqual(4096);
        expect(data.fields.length).toBeLessThanOrEqual(25);
        length += (data.title?.length ?? 0) + data.description.length + (data.footer?.text.length ?? 0);
        for (const field of data.fields) {
            expect(field.value.length).toBeLessThanOrEqual(1024);
            length += field.name.length + field.value.length;
        }
    }
    expect(length).toBeLessThanOrEqual(6000);
}

test.each([
    ['2', undefined, ['2']], ['3', undefined, ['2', '3']], ['4', undefined, ['2', '3', '4']],
    ['teams', undefined, ['2', '3', '4']], ['custom', 10, ['2', '3', '4', '5', '6', '7', '8', '9', '10']]
])('the %s lobby offers every empty position and fits Discord limits', async (format, playerLimit, values) => {
    const room = await create({ format, playerLimit });
    const panel = await act(room, 'refresh');
    expect(seatMenu(panel).options.map(option => option.value)).toEqual(values);
    expect(playersText(panel)).toContain(format === 'teams' ? 'A1 · <@101>' : 'Vị trí 1 · <@101>');
    expect(playersText(panel)).toContain('Trống');
    if (format === 'teams') expect(seatMenu(panel).options.map(option => option.label)).toEqual(['A2', 'B1', 'B2']);
    validPanel(panel);
});

test('the host can move before anyone joins and the public menu frees only the former position', async () => {
    const room = await create();
    const before = await disk.read(guild.id);
    const moved = await choose(room, 3);
    expect(playersText(moved)).toContain('Vị trí 3 · <@101>');
    expect(seatMenu(moved).options.map(option => option.value)).toEqual(['1', '2']);
    const current = await battle.readRoom(guild.id, channelId, room.id);
    expect(current.hostId).toBe(users[0]);
    expect(battle.getSeats(current).map(player => player?.id ?? null)).toEqual([null, null, users[0]]);
    expect((await disk.read(guild.id)).taixiu).toEqual(before.taixiu);
    validPanel(moved);
});

test('a player selects a position, can change it, and leaving keeps the remaining positions fixed', async () => {
    const room = await create({ format: '4' });
    await choose(room, 4, users[1]);
    const before = await disk.read(guild.id);
    const moved = await choose(room, 2, users[1]);
    expect(playersText(moved)).toContain('Vị trí 2 · <@102>');
    expect(seatMenu(moved).options.map(option => option.value)).toEqual(['3', '4']);
    await choose(room, 4, users[2]);
    const left = await act(room, 'leave', users[1]);
    expect(playersText(left)).toContain('Vị trí 4 · <@103>');
    expect(seatMenu(left).options.map(option => option.value)).toEqual(['2', '3']);
    expect((await disk.read(guild.id)).taixiu).toEqual(before.taixiu);
});

test('selecting a team position switches teams and the result retains positions in roll order', async () => {
    const room = await create({ format: 'teams' });
    const moved = await choose(room, 4);
    expect(playersText(moved)).toContain('B2 · <@101> · Đội B');
    await choose(room, 2, users[1]);
    await choose(room, 3, users[2]);
    const result = await choose(room, 1, users[3]);
    const saved = await battle.readRoom(guild.id, channelId, room.id);
    expect(saved.status).toBe('finished');
    expect(saved.rounds[0].entries.map(entry => entry.userId)).toEqual([users[3], users[1], users[2], users[0]]);
    const scores = payload(result).embeds[0].toJSON().fields.find(field => field.name === 'Bảng điểm').value;
    expect(scores).toContain('A1 · <@104>'); expect(scores).toContain('B2 · <@101>');
    expect(seatMenu(result)).toBeUndefined();
    validPanel(result);
});

test.each([['0'], ['11'], ['01'], ['1', '2'], [], ['bad']].map(values => [values]))('malformed position selection %j does not touch the room', async values => {
    const room = await create();
    const before = await disk.read(guild.id);
    const invalid = await act(room, 'seat', users[1], { values });
    expect(invalid.reply).toHaveBeenCalled();
    expect(await disk.read(guild.id)).toEqual(before);
});

test('an occupied stale position produces a private error and preserves assets', async () => {
    const room = await create({ format: '4' });
    await choose(room, 3, users[1]);
    const before = await disk.read(guild.id);
    const invalid = await choose(room, 3, users[2]);
    expect(invalid.followUp).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/vị trí|chỗ/i) }));
    expect(invalid.editReply).not.toHaveBeenCalled();
    expect(await disk.read(guild.id)).toEqual(before);
});

test('refreshing after a reload preserves selected positions and expired lobbies hide controls', async () => {
    const room = await create();
    await choose(room, 3);
    const stored = await battle.readRoom(guild.id, channelId, room.id);
    const panel = await act(stored, 'refresh');
    expect(playersText(panel)).toContain('Vị trí 3 · <@101>');
    expect(seatMenu(panel).options.map(option => option.value)).toEqual(['1', '2']);
    jest.spyOn(Date, 'now').mockReturnValue(stored.expiresAt);
    const before = await disk.read(guild.id);
    const expired = await choose(room, 1, users[1]);
    expect(payload(expired).components).toEqual([]);
    expect(await disk.read(guild.id)).toEqual(before);
});
