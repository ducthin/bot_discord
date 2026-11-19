const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const battle = require('../utils/cs2Battles');
const store = require('../utils/managementStore');
const market = require('../utils/cs2Market');
const { createBattleUi } = require('../utils/cs2BattleUi');

const guildId = '1';
const channelId = '20';
const roomId = '300';
const hostId = '101';
const guestId = '102';
const formerId = '103';
const botId = `${battle.BOT_ID}:${roomId}:1`;
let directory;
let disk;
let now;

beforeEach(async () => {
    now = 1_800_000_000_000;
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-battle-recreate-'));
    disk = store.createManagementStore(directory);
    jest.spyOn(store, 'read').mockImplementation(disk.read);
    jest.spyOn(store, 'transact').mockImplementation(disk.transact);
    jest.spyOn(Date, 'now').mockImplementation(() => now);
});

afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(directory, { recursive: true, force: true });
});

async function seedRoom({ publish = true } = {}) {
    const room = { id: roomId, channelId, hostId, format: '3', mode: 'crazy', tieRule: 'sudden-death',
        caseIds: Array(30).fill('battle-archive-anubis'), animationMode: 'full', status: 'finished',
        players: [{ id: hostId }, { id: guestId }, { id: botId, isBot: true, name: 'Bot' }],
        seats: { [hostId]: 2, [guestId]: 3, [botId]: 1 }, historyUserIds: [hostId, guestId, formerId],
        createdAt: now - 5 * 60_000, finishedAt: now - 1_000, expiresAt: now + 5 * 60_000,
        fee: '50000', pendingResultMessageId: '500' };
    await disk.transact(guildId, async (state, save) => {
        state.cs2Battles = { [roomId]: room };
        state.taixiu.balances = { [hostId]: 1_000, [guestId]: 2_000 };
        state.skinCases = { [hostId]: { drops: [{ id: 'untouched', locked: true }] } };
        await save();
    });
    if (publish) await battle.markResultPublished(guildId, roomId, '500');
    return room;
}

test('a 30-round result remains recreatable by final human participants after personal history expired', async () => {
    await seedRoom();
    expect(await battle.getHistoryConfig(guildId, hostId, roomId)).toBeNull();
    expect((await battle.listHistory(guildId, guestId)).total).toBe(0);
    const before = await disk.read(guildId);
    for (const userId of [hostId, guestId]) {
        expect(await battle.getRecreateConfig(guildId, userId, roomId, channelId)).toMatchObject({
            id: roomId, caseIds: Array(30).fill('battle-archive-anubis'), format: '3', mode: 'crazy',
            animationMode: 'full', tieRule: 'sudden-death'
        });
    }
    expect(await disk.read(guildId)).toEqual(before);
});

test('recreate rejects spectators, former leavers, bots, a different room and a different channel', async () => {
    await seedRoom();
    for (const userId of ['999', formerId, botId]) {
        expect(await battle.getRecreateConfig(guildId, userId, roomId, channelId)).toBeNull();
    }
    expect(await battle.getRecreateConfig(guildId, hostId, 'missing-room', channelId)).toBeNull();
    expect(await battle.getRecreateConfig(guildId, hostId, roomId, 'other-channel')).toBeNull();
});

test.each(['waiting', 'revealing', 'cancelled'])('a %s room or legacy history cannot be used as a finished result', async status => {
    const room = await seedRoom({ publish: false });
    await disk.transact(guildId, async (state, save) => {
        state.cs2Battles[roomId].status = status;
        state.cs2BattleHistory = { [hostId]: [{ ...room, status, createdAt: now }] };
        await save();
    });
    expect(await battle.getRecreateConfig(guildId, hostId, roomId, channelId)).toBeNull();
});

test('the published minimal configuration survives pruning and reload, retains its first deadline and changes no rewards', async () => {
    await seedRoom();
    const first = (await battle.pendingResultDeletions(guildId))[0];
    const before = await disk.read(guildId);
    const internal = before.cs2BattleResultMessages[roomId].recreateConfig;
    expect(internal).not.toHaveProperty('rounds');
    expect(internal).not.toHaveProperty('payouts');
    expect(first).not.toHaveProperty('recreateConfig');
    now += 40_000;
    expect(await battle.markResultPublished(guildId, roomId, '500')).toEqual(first);
    await disk.transact(guildId, async (state, save) => {
        // Same data that room-count/history pruning can discard while this public
        // result and its participant-only button are still visible.
        state.cs2Battles = {};
        state.cs2BattleHistory = {};
        await save();
    });
    disk = store.createManagementStore(directory);
    store.read.mockImplementation(disk.read);
    store.transact.mockImplementation(disk.transact);
    const copy = await battle.getRecreateConfig(guildId, guestId, roomId, channelId);
    expect(copy.caseIds).toHaveLength(30);
    copy.caseIds.push('forged');
    expect((await battle.getRecreateConfig(guildId, guestId, roomId, channelId)).caseIds).toHaveLength(30);
    const after = await disk.read(guildId);
    expect(after.taixiu).toEqual(before.taixiu);
    expect(after.skinCases).toEqual(before.skinCases);
    now = first.deleteAt;
    expect(await battle.getRecreateConfig(guildId, hostId, roomId, channelId)).toBeNull();
});

test('a persisted ten-minute result uses the one-minute deadline after reload and rejects recreation once overdue', async () => {
    await seedRoom();
    const publishedAt = now;
    await disk.transact(guildId, async (state, save) => {
        state.cs2BattleResultMessages[roomId].deleteAt = publishedAt + 10 * 60_000;
        await save();
    });
    const before = await disk.read(guildId);
    disk = store.createManagementStore(directory);
    store.read.mockImplementation(disk.read);
    store.transact.mockImplementation(disk.transact);
    now = publishedAt + 59_999;
    expect(await battle.pendingResultDeletions(guildId)).toMatchObject([
        { roomId, publishedAt, deleteAt: publishedAt + 60_000 }
    ]);
    expect(await battle.getRecreateConfig(guildId, hostId, roomId, channelId)).toMatchObject({ id: roomId });
    now++;
    expect(await battle.getRecreateConfig(guildId, hostId, roomId, channelId)).toBeNull();
    // The overdue record still reaches startup cleanup instead of being discarded.
    expect(await battle.pendingResultDeletions(guildId)).toMatchObject([
        { roomId, publishedAt, deleteAt: now }
    ]);
    expect(await battle.markResultPublished(guildId, roomId, '500')).toMatchObject({ deleteAt: now });
    const after = await disk.read(guildId);
    expect(after.taixiu).toEqual(before.taixiu);
    expect(after.skinCases).toEqual(before.skinCases);
});

test('a pre-update retained room recovers the configuration without publishing or reviving personal history', async () => {
    await seedRoom({ publish: false });
    const before = await disk.read(guildId);
    expect(await battle.getRecreateConfig(guildId, hostId, roomId, channelId)).toMatchObject({ id: roomId });
    expect(await battle.getRecreateConfig(guildId, formerId, roomId, channelId)).toBeNull();
    expect(await disk.read(guildId)).toEqual(before);
});

test('legacy unexpired personal history can recover a pruned room only for its final participants', async () => {
    const room = await seedRoom({ publish: false });
    await disk.transact(guildId, async (state, save) => {
        state.cs2Battles = {};
        state.cs2BattleHistory = Object.fromEntries([hostId, guestId, formerId].map(id =>
            [id, [{ ...room, createdAt: now - 1_000, format: 'custom', playerLimit: 7 }]]));
        await save();
    });
    expect(await battle.getRecreateConfig(guildId, guestId, roomId, channelId)).toMatchObject({ format: 'custom', playerLimit: 7 });
    expect(await battle.getRecreateConfig(guildId, formerId, roomId, channelId)).toBeNull();
    now += battle.HISTORY_LIFETIME;
    expect(await battle.getRecreateConfig(guildId, guestId, roomId, channelId)).toBeNull();
});

test('the real recreate UI handles a long finished battle, edits the recovered schedule and publishes without charging twice', async () => {
    await seedRoom();
    jest.spyOn(market, 'peekMarketQuote').mockReturnValue({ priceVnd: 100 });
    await disk.transact(guildId, async (state, save) => {
        state.taixiu.balances[hostId] = 1_000_000;
        await save();
    });
    expect(await battle.getHistoryConfig(guildId, hostId, roomId)).toBeNull();
    const before = await disk.read(guildId);
    const guild = { id: guildId };
    const ui = createBattleUi({ rollDrop: jest.fn(), dropName: drop => drop.skinId,
        dropImage: () => 'https://example.com/skin.png', reelRound: jest.fn(), showResult: jest.fn() });
    let nextId = 1000;
    const request = (customId, extra = {}) => ({ id: String(++nextId), customId, guild, guildId, channelId,
        user: { id: hostId }, attachmentSizeLimit: 0, message: { id: 'builder-message' },
        deferReply: jest.fn(), deferUpdate: jest.fn(), reply: jest.fn(), followUp: jest.fn(),
        editReply: jest.fn().mockResolvedValue({ id: 'builder-message' }), ...extra });
    const payload = interaction => interaction.editReply.mock.calls.at(-1)[0];
    const control = (panel, action) => panel.components.flatMap(row => row.toJSON().components)
        .find(item => item.custom_id?.startsWith(`mg_hom_battle-${action}_`));
    const recreate = request(`mg_hom_battle-recreate_${roomId}`);
    await ui.handle(recreate);
    const panel = payload(recreate);
    expect(panel.embeds[0].toJSON().footer.text).toContain('chưa trừ xu');
    expect(control(panel, 'publish')).toBeDefined();
    const add = request(control(panel, 'add').custom_id);
    await ui.handle(add);
    const added = payload(add);
    expect(added.embeds[0].toJSON().fields.find(field => field.name.startsWith('Số vòng')).name).toContain('31/100');
    const send = jest.fn().mockResolvedValue({ id: 'new-room-message', url: 'https://example.com/room' });
    const publish = request(control(added, 'publish').custom_id, { channel: { isSendable: () => true, send } });
    await ui.handle(publish);
    expect(send).toHaveBeenCalledTimes(1);
    const after = await disk.read(guildId);
    expect(after.cs2Battles[publish.id]).toMatchObject({ status: 'waiting', hostId, mode: 'crazy', format: '3' });
    expect(after.cs2Battles[publish.id].caseIds).toHaveLength(31);
    expect(after.taixiu).toEqual(before.taixiu);
    expect(after.skinCases).toEqual(before.skinCases);
});
