const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const battle = require('../utils/cs2Battles');
const store = require('../utils/managementStore');
const market = require('../utils/cs2Market');
const wallet = require('../commands/taixiu');
const { customCases, casePricing, lockCasePricing } = require('../utils/cs2BattleCases');

const guild = { id: '1' };
const channelId = '20';
const hostId = '101';
const users = ['101', '102', '103', '104', '105'];
const NOW = Date.UTC(2026, 10, 16, 10);
let directory;
let disk;
let roomCounter = 8000;
let item;

beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-battle-seats-'));
    disk = store.createManagementStore(directory);
    jest.spyOn(store, 'read').mockImplementation(disk.read);
    jest.spyOn(store, 'transact').mockImplementation(disk.transact);
    jest.spyOn(market, 'peekMarketQuote').mockReturnValue({ priceVnd: 100 });
    jest.spyOn(wallet, 'refreshCoinLeaderboard').mockImplementation(() => {});
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    item = customCases[0];
    await change(state => { state.taixiu.balances = Object.fromEntries(users.map(id => [id, 1000])); });
});

afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(directory, { recursive: true, force: true });
});

async function change(operation) {
    await disk.transact(guild.id, async (state, save) => { operation(state); await save(); });
}

async function create(options = {}) {
    const pricing = lockCasePricing(casePricing(item, () => 100));
    const result = await battle.createRoom(guild.id, {
        id: String(++roomCounter), channelId, hostId, caseIds: [item.id], format: '4', mode: 'regular',
        expectedPrices: { [item.id]: pricing }, ...options
    });
    expect(result.error).toBeUndefined();
    return result.room;
}

const act = (room, userId, action, messageId) => battle.actOnRoom(guild, channelId, room.id, userId, action, undefined, messageId);
const ids = room => battle.getSeats(room).map(player => player?.id ?? null);

test('new rooms persist host seat one without adding fields to player objects', async () => {
    const room = await create();
    expect(room.players).toEqual([{ id: hostId }]);
    expect(room.seats).toEqual({ [hostId]: 1 });
    expect(ids(room)).toEqual([hostId, null, null, null]);
    expect((await battle.readRoom(guild.id, channelId, room.id)).seats).toEqual(room.seats);
    expect(battle.seatLabel(room, 3)).toContain('3');
    expect(battle.seatLabel({ ...room, format: 'teams' }, 1)).toBe('A1');
    expect(battle.seatLabel({ ...room, format: 'teams' }, 4)).toBe('B2');
});

test('the host can move to an empty position without paying, rerolling or altering player shape', async () => {
    const room = await create();
    const before = await disk.read(guild.id);
    const draw = jest.spyOn(crypto, 'randomInt');
    const moved = await act(room, hostId, 'seat-4');
    expect(moved.error).toBeUndefined();
    expect(ids(moved.room)).toEqual([null, null, null, hostId]);
    expect(moved.room.players).toEqual([{ id: hostId }]);
    const after = await disk.read(guild.id);
    expect(after.taixiu).toEqual(before.taixiu);
    expect(after.skinCases).toEqual(before.skinCases);
    expect(draw).not.toHaveBeenCalled();
    expect(wallet.refreshCoinLeaderboard).not.toHaveBeenCalled();
    const again = await act(room, hostId, 'seat-4');
    expect(ids(again.room)).toEqual([null, null, null, hostId]);
    expect((await disk.read(guild.id)).taixiu).toEqual(before.taixiu);
});

test('a player may choose team B before A fills and moving between teams follows the chosen seat', async () => {
    const room = await create({ format: 'teams' });
    const joined = await act(room, users[1], 'seat-4');
    expect(joined.room.players.find(player => player.id === users[1])).toEqual({ id: users[1], team: 'B' });
    expect(ids(joined.room)).toEqual([hostId, null, null, users[1]]);
    const moved = await act(room, hostId, 'seat-3');
    expect(moved.room.players.find(player => player.id === hostId)).toEqual({ id: hostId, team: 'B' });
    expect(ids(moved.room)).toEqual([null, null, hostId, users[1]]);
    expect((await disk.read(guild.id)).taixiu.balances).toEqual(Object.fromEntries(users.map(id => [id, 1000])));
});

test('ten-player custom rooms preserve explicitly selected seats nine and ten', async () => {
    const room = await create({ format: 'custom', playerLimit: 10 });
    await act(room, hostId, 'seat-10');
    const joined = await act(room, users[1], 'seat-9');
    expect(ids(joined.room)).toEqual([null, null, null, null, null, null, null, null, users[1], hostId]);
    expect(joined.room.seats).toEqual({ [hostId]: 10, [users[1]]: 9 });
    const automatic = await act(room, users[2], 'join');
    expect(ids(automatic.room)[0]).toBe(users[2]);
    expect(ids(automatic.room)[9]).toBe(hostId);
});

test('leaving frees only that seat and legacy auto-join fills the first empty position', async () => {
    const room = await create();
    await act(room, users[1], 'seat-3');
    await act(room, users[2], 'seat-4');
    const left = await act(room, users[1], 'leave');
    expect(ids(left.room)).toEqual([hostId, null, null, users[2]]);
    expect(left.room.seats).toEqual({ [hostId]: 1, [users[2]]: 4 });
    const joined = await act(room, users[3], 'join');
    expect(ids(joined.room)).toEqual([hostId, users[3], null, users[2]]);
});

test('legacy team join actions assign the first free seat in their requested team', async () => {
    const room = await create({ format: 'teams' });
    await act(room, users[1], 'join-b');
    const joined = await act(room, users[2], 'join-a');
    expect(ids(joined.room)).toEqual([hostId, users[2], users[1], null]);
    expect(joined.room.players.find(player => player.id === users[1]).team).toBe('B');
    expect(joined.room.players.find(player => player.id === users[2]).team).toBe('A');
});

test('an occupied seat rejects both a joining player and an existing member without changing state', async () => {
    const room = await create();
    await act(room, users[1], 'seat-3');
    const before = await disk.read(guild.id);
    expect((await act(room, users[2], 'seat-3')).error).toBeTruthy();
    expect((await act(room, hostId, 'seat-3')).error).toBeTruthy();
    expect(await disk.read(guild.id)).toEqual(before);
});

test('two players racing for one chosen seat produce one occupant without charging either wallet', async () => {
    const room = await create();
    const before = await disk.read(guild.id);
    const results = await Promise.all([act(room, users[1], 'seat-3'), act(room, users[2], 'seat-3')]);
    expect(results.filter(result => result.error)).toHaveLength(1);
    const saved = await disk.read(guild.id);
    expect(ids(saved.cs2Battles[room.id])[2]).toBe(users[1]);
    expect(saved.cs2Battles[room.id].players).toHaveLength(2);
    expect(saved.taixiu).toEqual(before.taixiu);
});

test('new joiners need the room fee while existing members can move after spending their balance', async () => {
    const room = await create();
    await change(state => { state.taixiu.balances[hostId] = 0; state.taixiu.balances[users[1]] = 0; });
    expect((await act(room, users[1], 'seat-3')).error).toMatch(/xu/);
    const moved = await act(room, hostId, 'seat-4');
    expect(ids(moved.room)).toEqual([null, null, null, hostId]);
    expect((await disk.read(guild.id)).taixiu.balances[hostId]).toBe(0);
});

test('removing an underfunded member frees only their chosen seat and defers all rolls and fees', async () => {
    const room = await create();
    await act(room, hostId, 'seat-4');
    await act(room, users[1], 'seat-1');
    await act(room, users[2], 'seat-3');
    await change(state => { state.taixiu.balances[users[2]] = 0; });
    const before = await disk.read(guild.id);
    const draw = jest.spyOn(crypto, 'randomInt').mockImplementation((min, max) => max == null ? 0 : min);
    const drops = jest.spyOn(crypto, 'randomBytes');

    const joined = await act(room, users[3], 'seat-2', '500');
    expect(joined.started).not.toBe(true);
    expect(joined.room.status).toBe('waiting');
    expect(joined.room.rounds).toBeUndefined();
    expect(ids(joined.room)).toEqual([users[1], users[3], null, hostId]);
    expect(joined.room.seats).toEqual({ [users[1]]: 1, [users[3]]: 2, [hostId]: 4 });
    expect(joined.room.players.some(player => player.id === users[2])).toBe(false);
    const waiting = await disk.read(guild.id);
    expect(waiting.taixiu).toEqual(before.taixiu);
    expect(waiting.skinCases).toEqual(before.skinCases);
    expect(draw).not.toHaveBeenCalled();
    expect(drops).not.toHaveBeenCalled();
    expect(wallet.refreshCoinLeaderboard).not.toHaveBeenCalled();

    const started = await act(room, users[4], 'seat-3', '500');
    expect(started.started).toBe(true);
    expect(started.room.status).toBe('revealing');
    expect(ids(started.room)).toEqual([users[1], users[3], users[4], hostId]);
    expect(drops).toHaveBeenCalledTimes(4);
    const paid = await disk.read(guild.id);
    for (const userId of [hostId, users[1], users[3], users[4]]) {
        expect(wallet.getCoinBalance(paid, userId)).toBe(wallet.getCoinBalance(before, userId) - BigInt(room.fee));
    }
    expect(paid.taixiu.balances[users[2]]).toBe(0);
});

test('a last-seat join racing a bot start settles once and charges each admitted human once', async () => {
    const room = await create();
    await act(room, hostId, 'seat-4');
    await act(room, users[1], 'seat-1');
    await act(room, users[2], 'seat-2');
    const before = await disk.read(guild.id);
    jest.spyOn(crypto, 'randomInt').mockImplementation((min, max) => max == null ? 0 : min);
    const drops = jest.spyOn(crypto, 'randomBytes');

    const results = await Promise.all([
        act(room, users[3], 'seat-3', '501'),
        act(room, hostId, 'bot-start', '501')
    ]);
    expect(results.filter(result => result.started)).toHaveLength(1);
    const saved = await disk.read(guild.id);
    const settled = saved.cs2Battles[room.id];
    expect(settled.status).toBe('revealing');
    expect(settled.pendingResultMessageId).toBe('501');
    expect(settled.rounds).toHaveLength(1);
    expect(settled.rounds[0].entries).toHaveLength(4);
    expect(drops).toHaveBeenCalledTimes(4);
    const positions = battle.getSeats(settled);
    expect(positions.map(player => player.id)).toEqual(settled.rounds[0].entries.map(entry => entry.userId));
    expect(positions[0].id).toBe(users[1]);
    expect(positions[1].id).toBe(users[2]);
    expect(positions[3].id).toBe(hostId);
    expect(positions[2].id === users[3]).toBe(Boolean(results[0].started));
    for (const userId of users) {
        const admitted = settled.players.some(player => player.id === userId);
        expect(wallet.getCoinBalance(saved, userId)).toBe(wallet.getCoinBalance(before, userId) - (admitted ? BigInt(room.fee) : 0n));
    }

    await Promise.all([act(room, users[3], 'seat-3', '501'), act(room, hostId, 'bot-start', '501')]);
    expect(await disk.read(guild.id)).toEqual(saved);
    expect(drops).toHaveBeenCalledTimes(4);
});

test.each(['seat-0', 'seat-5', 'seat-11', 'seat--1', 'seat-1.5', 'seat-01', 'seat-x'])('%s cannot mutate a four-seat room', async action => {
    const room = await create();
    const before = await disk.read(guild.id);
    expect((await act(room, hostId, action)).error).toBeTruthy();
    expect(await disk.read(guild.id)).toEqual(before);
});

test.each(['expired', 'revealing', 'finished'])('%s rooms reject seat changes without writing history or balances', async status => {
    const room = await create();
    await change(state => {
        if (status === 'expired') state.cs2Battles[room.id].expiresAt = NOW;
        else state.cs2Battles[room.id].status = status;
    });
    const before = await disk.read(guild.id);
    await act(room, hostId, 'seat-4');
    expect(await disk.read(guild.id)).toEqual(before);
});

test('bots fill the actual holes and settlement roll order follows fixed positions', async () => {
    const room = await create({ mode: 'sharing' });
    await act(room, hostId, 'seat-4');
    await act(room, users[1], 'seat-1');
    jest.spyOn(crypto, 'randomInt').mockImplementation((min, max) => max == null ? 0 : min);
    const result = await act(room, hostId, 'bot-start');
    const positions = battle.getSeats(result.room);
    expect(positions.map(player => player.id)).toEqual(result.room.players.map(player => player.id));
    expect(positions[0]).toEqual({ id: users[1] });
    expect(positions[3]).toEqual({ id: hostId });
    expect(positions.slice(1, 3).every(player => player.isBot)).toBe(true);
    expect(result.room.rounds[0].entries.map(entry => entry.userId)).toEqual(positions.map(player => player.id));
    expect(result.room.rounds[0].entries.map(entry => Number(entry.drop.id.split('-').at(-1)))).toEqual([1, 2, 3, 4]);
    expect(result.room.seats[hostId]).toBe(4);
});

test('team bots occupy empty positions with the correct team after a host changes sides', async () => {
    const room = await create({ format: 'teams' });
    await act(room, hostId, 'seat-4');
    jest.spyOn(crypto, 'randomInt').mockImplementation((min, max) => max == null ? 0 : min);
    const result = await act(room, hostId, 'bot-start');
    expect(battle.getSeats(result.room).map(player => player.team)).toEqual(['A', 'A', 'B', 'B']);
    expect(battle.getSeats(result.room)[3]).toEqual({ id: hostId, team: 'B' });
    expect(battle.getSeats(result.room).slice(0, 3).every(player => player.isBot)).toBe(true);
});

test('seat positions survive store restart and the per-player history snapshots', async () => {
    const room = await create({ format: 'teams' });
    await act(room, users[1], 'seat-4');
    await act(room, hostId, 'seat-2');
    const reopened = store.createManagementStore(directory);
    store.read.mockImplementation(reopened.read);
    store.transact.mockImplementation(reopened.transact);
    const restored = await battle.readRoom(guild.id, channelId, room.id);
    expect(ids(restored)).toEqual([null, hostId, null, users[1]]);
    expect((await battle.getHistoryConfig(guild.id, hostId, room.id)).seats).toEqual(restored.seats);
    expect((await battle.getHistoryConfig(guild.id, users[1], room.id)).seats).toEqual(restored.seats);
    expect((await battle.listHistory(guild.id, hostId)).entries[0].seats).toEqual(restored.seats);
});

test('legacy rooms infer deterministic team positions without changing player objects', async () => {
    const room = await create({ format: 'teams' });
    const legacyPlayers = [{ id: hostId, team: 'A' }, { id: users[1], team: 'B' }, { id: users[2], team: 'A' }];
    await change(state => {
        const current = state.cs2Battles[room.id];
        current.players = legacyPlayers;
        delete current.seats;
    });
    const legacy = await battle.readRoom(guild.id, channelId, room.id);
    expect(ids(legacy)).toEqual([hostId, users[2], users[1], null]);
    expect(legacy.players).toEqual(legacyPlayers);
    const moved = await act(room, users[1], 'seat-4');
    expect(ids(moved.room)).toEqual([hostId, users[2], null, users[1]]);
    expect(moved.room.seats).toEqual({ [hostId]: 1, [users[2]]: 2, [users[1]]: 4 });
});

test('a first legacy leave preserves inferred holes and subsequent automatic joins preserve legacy roll order', async () => {
    const room = await create();
    await change(state => {
        const current = state.cs2Battles[room.id];
        current.players = [{ id: hostId }, { id: users[1] }, { id: users[2] }];
        delete current.seats;
    });

    const left = await act(room, users[1], 'leave');
    expect(ids(left.room)).toEqual([hostId, null, users[2], null]);
    expect(left.room.seats).toEqual({ [hostId]: 1, [users[2]]: 3 });
    expect(left.room.legacySeatOrder).toBe(true);
    const persisted = (await disk.read(guild.id)).cs2Battles[room.id];
    expect(persisted.seats).toEqual(left.room.seats);
    expect(persisted.legacySeatOrder).toBe(true);

    const joined = await act(room, users[3], 'join');
    expect(ids(joined.room)).toEqual([hostId, users[3], users[2], null]);
    expect(joined.room.legacySeatOrder).toBe(true);
    jest.spyOn(crypto, 'randomInt').mockImplementation((min, max) => max == null ? 0 : min);
    const started = await act(room, hostId, 'bot-start', '502');
    expect(started.started).toBe(true);
    expect(started.room.players.slice(0, 3)).toEqual([{ id: hostId }, { id: users[2] }, { id: users[3] }]);
    expect(started.room.rounds[0].entries.slice(0, 3).map(entry => entry.userId)).toEqual([hostId, users[2], users[3]]);
    expect(ids(started.room).slice(0, 3)).toEqual([hostId, users[3], users[2]]);
});

const postgresTest = process.env.TEST_DATABASE_URL ? test : test.skip;
postgresTest('two PostgreSQL pools serialize a race for the same selected position', async () => {
    const { createDatabase } = require('../utils/database');
    const first = createDatabase({ connectionString: process.env.TEST_DATABASE_URL, max: 2 });
    const second = createDatabase({ connectionString: process.env.TEST_DATABASE_URL, max: 2 });
    try {
        await Promise.all([first.initialize(), second.initialize()]);
        const firstStore = store.createPostgresManagementStore(first);
        const secondStore = store.createPostgresManagementStore(second);
        const pgGuild = { id: '887766' };
        await firstStore.transact(pgGuild.id, async (state, save) => {
            state.taixiu.balances = Object.fromEntries(users.map(id => [id, 1000]));
            await save();
        });
        store.transact.mockImplementation(firstStore.transact);
        store.read.mockImplementation(firstStore.read);
        const pricing = lockCasePricing(casePricing(item, () => 100));
        const { room } = await battle.createRoom(pgGuild.id, {
            id: String(++roomCounter), channelId, hostId, caseIds: [item.id], format: '4', mode: 'regular',
            expectedPrices: { [item.id]: pricing }
        });
        let calls = 0;
        store.transact.mockImplementation((...args) => (++calls % 2 ? firstStore : secondStore).transact(...args));
        const results = await Promise.all(users.slice(1, 3).map(userId =>
            battle.actOnRoom(pgGuild, channelId, room.id, userId, 'seat-3')));
        expect(results.filter(result => result.error)).toHaveLength(1);
        const state = await secondStore.read(pgGuild.id);
        const seats = ids(state.cs2Battles[room.id]);
        expect(users.slice(1, 3)).toContain(seats[2]);
        expect(state.cs2Battles[room.id].players).toHaveLength(2);
        expect(state.taixiu.balances).toEqual(Object.fromEntries(users.map(id => [id, 1000])));
    } finally { await Promise.allSettled([first.close(), second.close()]); }
}, 15_000);
