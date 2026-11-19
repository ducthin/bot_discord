const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const battle = require('../utils/cs2Battles');
const store = require('../utils/managementStore');
const market = require('../utils/cs2Market');
const { customCases, casePricing, lockCasePricing } = require('../utils/cs2BattleCases');
const { createBattleUi } = require('../utils/cs2BattleUi');

const guildId = '1';
const channelId = '20';
const hostId = '101';
const otherId = '102';
const item = customCases[0];
const RESULT_LIFETIME_MS = 60_000;
let directory;
let disk;
let now;

beforeEach(async () => {
    now = 1_800_000_000_000;
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-battle-expiry-'));
    disk = store.createManagementStore(directory);
    jest.spyOn(store, 'read').mockImplementation(disk.read);
    jest.spyOn(store, 'transact').mockImplementation(disk.transact);
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    jest.spyOn(market, 'peekMarketQuote').mockReturnValue({ priceVnd: 100 });
});

afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(directory, { recursive: true, force: true });
});

async function seedRoom({ id = '300', pending = '500', status = 'finished' } = {}) {
    const players = [{ id: hostId }, { id: otherId }];
    const room = {
        id, channelId, hostId, status, caseIds: [item.id], format: '2', mode: 'sharing', tieRule: 'split',
        players, createdAt: now - 40_000, finishedAt: now - 30_000, expiresAt: now + 60_000,
        fee: '100', pool: '20000', payouts: { [hostId]: '10000', [otherId]: '10000' },
        payoutType: 'coins', totals: { [hostId]: '10000', [otherId]: '10000' },
        rounds: [{ caseId: item.id, entries: players.map((player, index) => ({ userId: player.id,
            drop: { ...item.entries[0].drop, id: `${id}-1-${index + 1}` }, value: '10000' })) }],
        ...(pending ? { pendingResultMessageId: pending } : {})
    };
    await disk.transact(guildId, async (state, save) => {
        state.taixiu.balances = { [hostId]: 100_000, [otherId]: 200_000 };
        state.skinCases = { [hostId]: { drops: [{ id: 'keep', locked: true }] } };
        (state.cs2Battles ??= {})[id] = room;
        state.cs2BattleHistory = { [hostId]: [{ id, status, payouts: room.payouts, pool: room.pool }] };
        await save();
    });
    return room;
}

const monetaryState = state => ({ taixiu: state.taixiu, skinCases: state.skinCases, history: state.cs2BattleHistory });

test('the one-minute deadline begins when the final result is published and leaves rewards/history untouched', async () => {
    const room = await seedRoom();
    const before = await disk.read(guildId);
    const published = await battle.markResultPublished(guildId, room.id, '500');
    expect(published).toEqual({ roomId: room.id, messageId: '500', channelId,
        publishedAt: now, deleteAt: now + RESULT_LIFETIME_MS });
    const after = await disk.read(guildId);
    expect(after.cs2Battles[room.id].pendingResultMessageId).toBeUndefined();
    expect(monetaryState(after)).toEqual(monetaryState(before));
    expect(await battle.pendingResults(guildId)).toEqual([]);
    expect(await battle.pendingResultDeletions(guildId)).toEqual([published]);
});

test('unrelated messages and unfinished rooms cannot acquire a result deletion deadline', async () => {
    const room = await seedRoom();
    const before = await disk.read(guildId);
    expect(await battle.markResultPublished(guildId, room.id, 'unrelated')).toBeFalsy();
    expect(await battle.markResultPublished(guildId, 'missing-room', '500')).toBeFalsy();
    expect(await battle.pendingResultDeletions(guildId)).toEqual([]);
    expect(await disk.read(guildId)).toEqual(before);
    await disk.transact(guildId, async (state, save) => { state.cs2Battles[room.id].status = 'waiting'; await save(); });
    expect(await battle.markResultPublished(guildId, room.id, '500')).toBeFalsy();
    expect(await battle.pendingResultDeletions(guildId)).toEqual([]);
});

test('refreshes and simultaneous publications retain the first deadline rather than extending it', async () => {
    const room = await seedRoom();
    const [first, repeated] = await Promise.all([
        battle.markResultPublished(guildId, room.id, '500'),
        battle.markResultPublished(guildId, room.id, '500')
    ]);
    expect(repeated).toEqual(first);
    now += 40_000;
    expect(await battle.markResultPublished(guildId, room.id, '500')).toEqual(first);
    expect(await battle.pendingResultDeletions(guildId)).toEqual([first]);
});

test('legacy finished results gain a deadline on their first refresh and survive store recreation past expiry', async () => {
    const room = await seedRoom({ pending: null });
    const first = await battle.markResultPublished(guildId, room.id, '500');
    expect(first).toMatchObject({ roomId: room.id, deleteAt: now + RESULT_LIFETIME_MS });
    const restarted = store.createManagementStore(directory);
    store.read.mockImplementation(restarted.read);
    store.transact.mockImplementation(restarted.transact);
    now += RESULT_LIFETIME_MS + 1;
    // Expired records remain available so startup can delete the message immediately.
    expect(await battle.pendingResultDeletions(guildId)).toEqual([first]);
    expect(await battle.markResultPublished(guildId, room.id, '500')).toEqual(first);
});

test('deletion acknowledgement matches both room and message and never changes money or history', async () => {
    const room = await seedRoom();
    const published = await battle.markResultPublished(guildId, room.id, '500');
    const before = await disk.read(guildId);
    await battle.markResultDeleted(guildId, room.id, 'wrong-message');
    await battle.markResultDeleted(guildId, 'wrong-room', '500');
    expect(await battle.pendingResultDeletions(guildId)).toEqual([published]);
    await battle.markResultDeleted(guildId, room.id, '500');
    await battle.markResultDeleted(guildId, room.id, '500');
    expect(await battle.pendingResultDeletions(guildId)).toEqual([]);
    const after = await disk.read(guildId);
    expect(after.cs2Battles[room.id]).toEqual(before.cs2Battles[room.id]);
    expect(monetaryState(after)).toEqual(monetaryState(before));
});

test('a result message already missing before publication clears only its matching pending recovery', async () => {
    const room = await seedRoom();
    const before = await disk.read(guildId);
    await battle.markResultDeleted(guildId, room.id, 'wrong-message');
    expect(await battle.pendingResults(guildId)).toMatchObject([{ id: room.id, pendingResultMessageId: '500' }]);
    await battle.markResultDeleted(guildId, room.id, '500');
    expect(await battle.pendingResults(guildId)).toEqual([]);
    expect(await battle.pendingResultDeletions(guildId)).toEqual([]);
    expect(monetaryState(await disk.read(guildId))).toEqual(monetaryState(before));
});

test('room pruning preserves live result navigation and releases the room after its original deadline', async () => {
    const room = await seedRoom();
    const published = await battle.markResultPublished(guildId, room.id, '500');
    await disk.transact(guildId, async (state, save) => {
        const saved = state.cs2Battles[room.id];
        saved.caseIds = Array(8).fill(item.id);
        saved.rounds = Array.from({ length: 8 }, () => structuredClone(room.rounds[0]));
        saved.winners = [hostId, otherId];
        saved.pricesByCase = { [item.id]: lockCasePricing(casePricing(item)) };
        for (let index = 0; index < 35; index++) state.cs2Battles[`closed-${index}`] = {
            ...room, id: `closed-${index}`, pendingResultMessageId: undefined,
            status: 'cancelled', finishedAt: now + index + 1000
        };
        await save();
    });
    const before = await disk.read(guildId);
    const expectedPrices = lockCasePricing(casePricing(item));
    expect(await battle.createRoom(guildId, { id: 'new-room', channelId, hostId, caseIds: [item.id],
        format: '2', mode: 'regular', expectedPrices: { [item.id]: expectedPrices } })).toHaveProperty('room');
    expect(await battle.readRoom(guildId, channelId, room.id)).toMatchObject({ id: room.id, status: 'finished' });
    expect(await battle.pendingResultDeletions(guildId)).toEqual([published]);
    const ui = createBattleUi({ rollDrop: jest.fn(), dropName: drop => drop.skinId,
        dropImage: () => '', reelRound: jest.fn(), showResult: jest.fn() });
    const click = async customId => {
        const interaction = { customId, guildId, channelId, user: { id: hostId }, message: { id: '500' },
            attachmentSizeLimit: 0, deferReply: jest.fn(), deferUpdate: jest.fn(), editReply: jest.fn(), followUp: jest.fn() };
        await ui.handle(interaction);
        expect(interaction.followUp).not.toHaveBeenCalled();
        return interaction.editReply.mock.calls.at(-1)[0];
    };
    expect((await click(`mg_hom_battle-room-odds_${room.id}`)).embeds[0].data.title).toBe(`Vật phẩm · ${item.name}`);
    expect((await click(`mg_hom_battle-result-page_${room.id}_1`)).embeds[0].data.footer.text).toContain('Trang 2/2');
    expect((await click(`mg_hom_battle-room-schedule_${room.id}_1`)).embeds[0].data.footer.text).toContain('Trang 2/8');
    expect((await click(`mg_hom_battle-result-page_${room.id}_0`)).embeds[0].data.footer.text).toContain('Trang 1/2');
    const after = await disk.read(guildId);
    expect(after.taixiu).toEqual(before.taixiu);
    expect(after.skinCases).toEqual(before.skinCases);
    expect(await battle.getHistoryConfig(guildId, hostId, room.id)).not.toBeNull();
    now = published.deleteAt;
    expect(await battle.getHistoryConfig(guildId, hostId, room.id)).toBeNull();
    await battle.actOnRoom({ id: guildId }, channelId, 'new-room', hostId, 'cancel');
    expect(await battle.createRoom(guildId, { id: 'next-room', channelId, hostId, caseIds: [item.id],
        format: '2', mode: 'regular', expectedPrices: { [item.id]: expectedPrices } })).toHaveProperty('room');
    expect(await battle.readRoom(guildId, channelId, room.id)).toBeNull();
    expect(await battle.pendingResultDeletions(guildId)).toEqual([published]);
    await battle.markResultDeleted(guildId, room.id, '500');
    expect(await battle.pendingResultDeletions(guildId)).toEqual([]);
});
