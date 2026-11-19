const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const battle = require('../utils/cs2Battles');
const store = require('../utils/managementStore');
const market = require('../utils/cs2Market');
const { customCases, casePricing, lockCasePricing } = require('../utils/cs2BattleCases');
const { readCoins } = require('../utils/coins');

const guild = { id: '1' };
const channelId = '20';
const users = ['101', '102', '103', '104'];
const source = customCases[0].entries[0].drop;
let directory;
let disk;
let counter = 100;

beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-battle-settlement-'));
    disk = store.createManagementStore(directory);
    jest.spyOn(store, 'read').mockImplementation(disk.read);
    jest.spyOn(store, 'transact').mockImplementation(disk.transact);
    jest.spyOn(market, 'getDropMarketQuoteRef').mockImplementation(drop => ({ name: String(drop.testValue) }));
    jest.spyOn(market, 'peekMarketQuote').mockImplementation(name => ({ priceVnd: Number(name) || 100 }));
    jest.spyOn(crypto, 'randomInt').mockReturnValue(0);
    await disk.transact(guild.id, async (state, save) => {
        state.taixiu.balances = Object.fromEntries(users.map(id => [id, 1000]));
        await save();
    });
});

afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(directory, { recursive: true, force: true });
});

async function seedRoom(values, { tieRule = 'split', mode = 'regular', teams = false, id = String(++counter), ...extra } = {}) {
    const now = Date.now();
    const players = users.slice(0, values.length).map((id, index) => ({ id, ...(teams ? { team: index < 2 ? 'A' : 'B' } : {}) }));
    const room = { id, channelId, hostId: users[0], caseIds: [source.caseId], format: teams ? 'teams' : String(values.length),
        mode, tieRule, animationMode: 'fast', createdAt: now, expiresAt: now + 60_000, fee: '100', status: 'waiting',
        players: players.slice(0, -1), ...extra };
    if (tieRule === null) delete room.tieRule;
    await disk.transact(guild.id, async (state, save) => { (state.cs2Battles ??= {})[id] = room; await save(); });
    const roll = jest.fn((weaponCase, id, acquiredAt) => ({ ...source, id, acquiredAt, testValue: values[Number(id.split('-').at(-1)) - 1] }));
    const joiner = players.at(-1);
    const act = async () => {
        const result = await battle.actOnRoom(guild, channelId, id, joiner.id, teams ? 'join-b' : 'join', roll, 'message-1');
        if (result.room?.status === 'revealing') {
            const completed = await battle.completeReveal(guild, id);
            return { ...result, room: completed.room };
        }
        return result;
    };
    return { room, roll, act };
}

test('new rooms default to splitting ties, snapshot configuration and reject unknown tie rules', async () => {
    market.getDropMarketQuoteRef.mockRestore();
    market.peekMarketQuote.mockReturnValue({ priceVnd: 100 });
    const item = customCases[0];
    const args = { id: String(++counter), channelId, hostId: users[0], caseIds: [item.id], format: '2', mode: 'regular',
        expectedPrices: { [item.id]: lockCasePricing(casePricing(item)) } };
    expect(await battle.createRoom(guild.id, { ...args, tieRule: 'fake' })).toHaveProperty('error');
    const { room } = await battle.createRoom(guild.id, args);
    expect(room.tieRule).toBe('split');
    const history = await battle.listHistory(guild.id, users[0]);
    expect(history).toMatchObject({ total: 1, page: 0, pages: 1, pageSize: 5 });
    expect(history.entries[0]).toMatchObject({ id: room.id, status: 'waiting', roundCount: 1, tieRule: 'split' });
    expect(history.entries[0]).not.toHaveProperty('pricesByCase');
});

test.each(['regular', 'crazy'])('%s split ties pay the entire pool in exact cents and never grant duplicate skins', async mode => {
    const values = mode === 'regular' ? [100, 100, 100, 50] : [50, 50, 50, 100];
    const { act, room, roll } = await seedRoom(values, { mode });
    const [result, repeated] = await Promise.all([act(), act()]);
    expect(result.started).toBe(true);
    expect(repeated.started).toBeUndefined();
    const pool = BigInt(values.reduce((sum, value) => sum + value, 0)) * 100n;
    const winners = users.slice(0, 3);
    expect(result.room).toMatchObject({ tie: true, tieSplit: true, winners, payoutType: 'coins', pool: pool.toString(), tieBreaks: [] });
    const paid = Object.values(result.room.payouts).reduce((sum, value) => sum + BigInt(value), 0n);
    expect(paid).toBe(pool);
    expect(BigInt(result.room.payouts[users[0]]) - BigInt(result.room.payouts[users[2]])).toBeLessThanOrEqual(1n);
    const state = await disk.read(guild.id);
    expect(state.skinCases).toBeUndefined();
    expect(roll).toHaveBeenCalledTimes(4);
    for (const user of users) expect(readCoins(state.taixiu.balances[user])).toBe(100_000n - 100n + BigInt(result.room.payouts[user] ?? 0));
    expect((await battle.listHistory(guild.id, users[0])).total).toBe(1);
    expect((await battle.getHistoryConfig(guild.id, users[1], room.id)).totals[users[0]]).toBe(String(values[0] * 100));
});

test.each([
    ['coin', 'sharing'],
    ['skin', 'regular']
])('%s rewards stay pending until the reveal is completed', async (_kind, mode) => {
    const values = [200, 100];
    const { room, roll } = await seedRoom(values, { mode });
    const started = await battle.actOnRoom(guild, channelId, room.id, users[1], 'join', roll, 'message-pending');
    expect(started).toMatchObject({ started: true, room: { status: 'revealing' } });
    await expect(battle.pendingResults(guild.id)).resolves.toMatchObject([
        { id: room.id, status: 'revealing', pendingResultMessageId: 'message-pending' }
    ]);
    const pending = await disk.read(guild.id);
    expect(readCoins(pending.taixiu.balances[users[0]])).toBe(100_000n - BigInt(room.fee));
    expect(readCoins(pending.taixiu.balances[users[1]])).toBe(100_000n - BigInt(room.fee));
    expect(pending.skinCases).toBeUndefined();

    const completed = await battle.completeReveal(guild, room.id);
    expect(completed).toMatchObject({ completed: true, room: { status: 'finished' } });
    const settled = await disk.read(guild.id);
    if (mode === 'sharing') {
        expect(readCoins(settled.taixiu.balances[users[0]])).toBe(100_000n - BigInt(room.fee) + BigInt(completed.room.payouts[users[0]]));
        expect(readCoins(settled.taixiu.balances[users[1]])).toBe(100_000n - BigInt(room.fee) + BigInt(completed.room.payouts[users[1]]));
        expect(settled.skinCases).toBeUndefined();
    } else {
        expect(settled.skinCases[users[0]].drops).toHaveLength(2);
        expect(readCoins(settled.taixiu.balances[users[0]])).toBe(100_000n - BigInt(room.fee));
    }
    await battle.completeReveal(guild, room.id);
    expect(await disk.read(guild.id)).toEqual(settled);
});

test('two tied players split the pool and tied teams pay all four members', async () => {
    const first = await seedRoom([100, 100]);
    expect((await first.act()).room.payouts).toEqual({ [users[0]]: '10000', [users[1]]: '10000' });
    const teams = await seedRoom([50, 150, 100, 100], { teams: true });
    const result = (await teams.act()).room;
    expect(result).toMatchObject({ tieGroups: ['A', 'B'], winners: users, payoutType: 'coins', tieSplit: true });
    expect(result.payouts).toEqual(Object.fromEntries(users.map(id => [id, '10000'])));
    expect(crypto.randomInt).not.toHaveBeenCalled();
});

test.each([0, 1])('two-way sudden death uses one fair coin (%s), persists the outcome and has no extra drops or fees', async coin => {
    crypto.randomInt.mockReturnValue(coin);
    const { act, room, roll } = await seedRoom([100, 100], { tieRule: 'sudden-death' });
    const { room: result } = await act();
    expect(crypto.randomInt).toHaveBeenCalledTimes(1);
    expect(crypto.randomInt).toHaveBeenCalledWith(2);
    expect(result).toMatchObject({ tie: true, tieSplit: false, payoutType: 'skins', winners: [users[coin]],
        tieBreaks: [{ id: `${room.id}-tie-1`, round: 1, left: users[0], right: users[1], winner: users[coin], probability: 0.5 }] });
    expect(roll).toHaveBeenCalledTimes(2);
    const saved = await disk.read(guild.id);
    expect(saved.skinCases[users[coin]].drops).toHaveLength(2);
    expect(users.slice(0, 2).map(id => readCoins(saved.taixiu.balances[id]))).toEqual([99900n, 99900n]);
    const restartedDisk = store.createManagementStore(directory);
    store.read.mockImplementation(restartedDisk.read);
    store.transact.mockImplementation(restartedDisk.transact);
    crypto.randomInt.mockReturnValue(1 - coin);
    await act();
    await battle.markResultPublished(guild.id, room.id, 'message-1');
    const restored = await restartedDisk.read(guild.id);
    expect(restored.skinCases).toEqual(saved.skinCases);
    expect(restored.taixiu).toEqual(saved.taixiu);
    expect(restored.cs2Battles[room.id].tieBreaks).toEqual(result.tieBreaks);
    expect(crypto.randomInt).toHaveBeenCalledTimes(1);
});

test('team sudden death has one 50/50 match and splits the coin pool only between the winning team', async () => {
    crypto.randomInt.mockReturnValue(1);
    const { act, roll } = await seedRoom([50, 150, 100, 100], { tieRule: 'sudden-death', teams: true });
    const result = (await act()).room;
    expect(result).toMatchObject({ winners: users.slice(2), payoutType: 'coins', tieSplit: false,
        tieBreaks: [{ left: 'A', right: 'B', winner: 'B', probability: 0.5 }] });
    expect(result.payouts).toEqual({ [users[2]]: '20000', [users[3]]: '20000' });
    expect(roll).toHaveBeenCalledTimes(4);
    expect(crypto.randomInt).toHaveBeenCalledTimes(1);
});

test('three-way sudden death randomizes the bye and has equal overall odds for every participant', async () => {
    const wins = Object.fromEntries(users.slice(0, 3).map(id => [id, 0]));
    for (let shuffle3 = 0; shuffle3 < 3; shuffle3++) for (let shuffle2 = 0; shuffle2 < 2; shuffle2++) {
        for (let coin1 = 0; coin1 < 2; coin1++) for (let coin2 = 0; coin2 < 2; coin2++) {
            const draws = [shuffle3, shuffle2, coin1, coin2];
            crypto.randomInt.mockImplementation(() => draws.shift());
            const { act } = await seedRoom([100, 100, 100], { tieRule: 'sudden-death' });
            const result = (await act()).room;
            expect(result.tieBreaks).toHaveLength(2);
            expect(result.tieBracket.byes).toHaveLength(1);
            expect(result.tieBreaks.every(item => item.probability === 0.5)).toBe(true);
            wins[result.winners[0]]++;
            expect(draws).toEqual([]);
        }
    }
    expect(Object.values(wins)).toEqual([8, 8, 8]);
});

test('legacy rooms preserve random tie settlement and Sharing still pays all players', async () => {
    const legacy = await seedRoom([100, 100], { tieRule: null });
    const result = (await legacy.act()).room;
    expect(result).toMatchObject({ winners: [users[0]], payoutType: 'skins', tie: true, tieSplit: false, tieBreaks: [] });
    expect(crypto.randomInt).toHaveBeenCalledTimes(1);
    const sharing = await seedRoom([100, 200, 100], { mode: 'sharing', tieRule: 'sudden-death' });
    const shared = (await sharing.act()).room;
    expect(shared).toMatchObject({ winners: users.slice(0, 3), payoutType: 'coins', tie: false });
    expect(shared.payouts).toEqual({ [users[0]]: '13334', [users[1]]: '13333', [users[2]]: '13333' });
    expect(crypto.randomInt).toHaveBeenCalledTimes(2);
    expect(crypto.randomInt).toHaveBeenLastCalledWith(3);
});

test('history survives deleted result room pruning, denies outsiders and deduplicates updates across reloads', async () => {
    const first = await seedRoom([100, 200]);
    await first.act();
    await battle.markResultPublished(guild.id, first.room.id, 'message-1');
    await battle.markResultDeleted(guild.id, first.room.id, 'message-1');
    const owned = await battle.getHistoryConfig(guild.id, users[1], first.room.id);
    expect(owned).toMatchObject({ status: 'finished', hostId: users[0], winners: [users[1]] });
    expect(await battle.getHistoryConfig(guild.id, users[2], first.room.id)).toBeNull();
    expect((await battle.listHistory(guild.id, users[2])).total).toBe(0);
    await disk.transact(guild.id, async (state, save) => {
        for (let index = 0; index < 35; index++) state.cs2Battles[`closed-${index}`] = {
            ...first.room, id: `closed-${index}`, status: 'cancelled', finishedAt: Date.now() + index + 1000
        };
        await save();
    });
    market.getDropMarketQuoteRef.mockRestore();
    market.peekMarketQuote.mockReturnValue({ priceVnd: 100 });
    const item = customCases[0];
    const created = await battle.createRoom(guild.id, { id: String(++counter), channelId, hostId: users[0], caseIds: [item.id],
        format: '2', mode: 'regular', expectedPrices: { [item.id]: lockCasePricing(casePricing(item)) } });
    expect(created).toHaveProperty('room');
    expect(await battle.readRoom(guild.id, channelId, first.room.id)).toBeNull();
    expect(await battle.getHistoryConfig(guild.id, users[1], first.room.id)).toEqual(owned);
    owned.caseIds.push('fake-case');
    expect((await battle.getHistoryConfig(guild.id, users[1], first.room.id)).caseIds).toHaveLength(1);
    const restarted = store.createManagementStore(directory);
    store.read.mockImplementation(restarted.read);
    expect((await battle.listHistory(guild.id, users[1])).entries[0].id).toBe(first.room.id);
});

test('host and former participants retain their own configuration until history expires', async () => {
    market.getDropMarketQuoteRef.mockRestore();
    market.peekMarketQuote.mockReturnValue({ priceVnd: 100 });
    const item = customCases[0];
    const { room } = await battle.createRoom(guild.id, { id: String(++counter), channelId, hostId: users[0], caseIds: [item.id],
        format: '3', mode: 'regular', expectedPrices: { [item.id]: lockCasePricing(casePricing(item)) } });
    await battle.actOnRoom(guild, channelId, room.id, users[1], 'join');
    await battle.actOnRoom(guild, channelId, room.id, users[1], 'leave');
    const snapshot = await battle.getHistoryConfig(guild.id, users[1], room.id);
    expect(snapshot.players).toEqual([{ id: users[0] }]);
    expect((await battle.listHistory(guild.id, users[1])).total).toBe(1);
    jest.spyOn(Date, 'now').mockReturnValue(room.createdAt + battle.HISTORY_LIFETIME);
    expect(await battle.getHistoryConfig(guild.id, users[1], room.id)).toBeNull();
    expect((await battle.listHistory(guild.id, users[0])).total).toBe(0);
    const state = await disk.read(guild.id);
    expect(state.taixiu.balances[users[0]]).toBe(1000);
    expect(state.taixiu.balances[users[1]]).toBe(1000);
});

test('battle history is deleted after one minute', async () => {
    const { room } = await seedRoom([100, 200]);
    expect((await battle.listHistory(guild.id, users[0])).total).toBe(1);

    jest.spyOn(Date, 'now').mockReturnValue(room.createdAt + battle.HISTORY_LIFETIME);

    expect((await battle.listHistory(guild.id, users[0])).total).toBe(0);
    expect(await battle.getHistoryConfig(guild.id, users[0], room.id)).toBeNull();
    expect((await disk.read(guild.id)).cs2BattleHistory).toEqual({});
});

test('history keeps the latest 30 configurations per user, including cancelled rooms and correct pagination', async () => {
    for (let index = 0; index < 35; index++) {
        const { room } = await seedRoom([100, 100]);
        await battle.actOnRoom(guild, channelId, room.id, users[0], 'cancel');
    }
    const first = await battle.listHistory(guild.id, users[0]);
    const last = await battle.listHistory(guild.id, users[0], 999);
    expect(first).toMatchObject({ total: 30, pages: 6, page: 0, pageSize: 5 });
    expect(last).toMatchObject({ total: 30, page: 5, pages: 6 });
    expect(first.entries.every(entry => entry.status === 'cancelled')).toBe(true);
    const ids = [];
    for (let page = 0; page < first.pages; page++) ids.push(...(await battle.listHistory(guild.id, users[0], page)).entries.map(entry => entry.id));
    expect(new Set(ids).size).toBe(30);
});

test('legacy histories backfill only for owners and participants before rooms are pruned', async () => {
    const legacy = await seedRoom([100, 100], { tieRule: null });
    await legacy.act();
    await disk.transact(guild.id, async (state, save) => {
        delete state.cs2BattleHistory;
        delete state.cs2Battles[legacy.room.id].historyUserIds;
        await save();
    });
    const hostHistory = await battle.listHistory(guild.id, users[0]);
    expect(hostHistory.entries[0]).toMatchObject({ id: legacy.room.id, tieRule: 'legacy-random', status: 'finished' });
    expect(await battle.getHistoryConfig(guild.id, users[1], legacy.room.id)).toMatchObject({ id: legacy.room.id });
    expect(await battle.getHistoryConfig(guild.id, users[2], legacy.room.id)).toBeNull();
    const state = await disk.read(guild.id);
    expect(state.cs2BattleHistory[users[0]]).toHaveLength(1);
    expect(state.cs2BattleHistory[users[1]]).toHaveLength(1);
    expect(state.cs2BattleHistory[users[2]]).toBeUndefined();
});

test('pruning preserves unpublished and live published results while recording personal configurations', async () => {
    const pending = await seedRoom([100, 100], { tieRule: 'sudden-death' });
    await pending.act();
    const archived = await seedRoom([100, 200]);
    await archived.act();
    await battle.markResultPublished(guild.id, archived.room.id, 'message-1');
    await disk.transact(guild.id, async (state, save) => {
        delete state.cs2BattleHistory;
        for (let index = 0; index < 35; index++) state.cs2Battles[`cancelled-${index}`] = {
            ...archived.room, id: `cancelled-${index}`, hostId: users[2], players: [{ id: users[2] }],
            status: 'cancelled', finishedAt: Date.now() + index + 1000
        };
        await save();
    });
    market.getDropMarketQuoteRef.mockRestore();
    market.peekMarketQuote.mockReturnValue({ priceVnd: 100 });
    const item = customCases[0];
    await battle.createRoom(guild.id, { id: String(++counter), channelId, hostId: users[0], caseIds: [item.id],
        format: '2', mode: 'regular', expectedPrices: { [item.id]: lockCasePricing(casePricing(item)) } });
    expect(await battle.readRoom(guild.id, channelId, archived.room.id)).toMatchObject({ id: archived.room.id, status: 'finished' });
    expect(await battle.getHistoryConfig(guild.id, users[1], archived.room.id)).toMatchObject({ id: archived.room.id, status: 'finished' });
    expect(await battle.pendingResults(guild.id)).toMatchObject([{ id: pending.room.id, pendingResultMessageId: 'message-1' }]);
    expect(await battle.readRoom(guild.id, channelId, pending.room.id)).toMatchObject({ status: 'finished', pendingResultMessageId: 'message-1' });
});

test.each([['regular', false, 'skins'], ['sharing', false, 'coins'], ['regular', true, 'coins']])(
    'legacy %s teams=%s history derives payout type, pool and scores from validated rounds', async (mode, teams, payoutType) => {
        const values = teams ? [50, 150, 100, 100] : [100, 200];
        const { room, act } = await seedRoom(values, { mode, teams, tieRule: null });
        await act();
        const state = await disk.read(guild.id);
        const settled = state.cs2Battles[room.id];
        await disk.transact(guild.id, async (state, save) => {
            delete state.cs2BattleHistory;
            for (const key of ['payoutType', 'pool', 'totals']) delete state.cs2Battles[room.id][key];
            await save();
        });
        const entry = await battle.getHistoryConfig(guild.id, users[0], room.id);
        expect(entry.payoutType).toBe(payoutType);
        expect(entry.pool).toBe(String(values.reduce((sum, value) => sum + value, 0) * 100));
        expect(entry.totals).toEqual(Object.fromEntries(values.map((value, index) => [users[index], String(value * 100)])));
        expect(entry.payouts).toEqual(settled.payouts);
        expect((await disk.read(guild.id)).taixiu).toEqual(state.taixiu);
        await disk.transact(guild.id, async (state, save) => {
            for (const key of ['payoutType', 'pool', 'totals']) delete state.cs2BattleHistory[users[0]][0][key];
            await save();
        });
        expect(await battle.getHistoryConfig(guild.id, users[0], room.id)).toMatchObject({ payoutType, pool: entry.pool, totals: entry.totals });
    });

test.each(['invalid-value', 'duplicate-player', 'unknown-player', 'missing-player'])('legacy malformed %s rounds do not fabricate history totals', async corruption => {
    const { room, act } = await seedRoom([100, 200], { tieRule: null });
    await act();
    await disk.transact(guild.id, async (state, save) => {
        delete state.cs2BattleHistory;
        const old = state.cs2Battles[room.id];
        for (const key of ['payoutType', 'pool', 'totals']) delete old[key];
        const entries = old.rounds[0].entries;
        if (corruption === 'invalid-value') entries[0].value = '-100';
        else if (corruption === 'duplicate-player') entries[1].userId = entries[0].userId;
        else if (corruption === 'unknown-player') entries[0].userId = '999';
        else entries.pop();
        await save();
    });
    const entry = await battle.getHistoryConfig(guild.id, users[0], room.id);
    expect(entry.payoutType).toBe('skins');
    expect(entry.pool).toBeUndefined();
    expect(entry.totals).toBeUndefined();
});

test('room reads and settlement load only their sections and preserve unrelated players and settings', async () => {
    const untouched = { drops: [{ ...source, id: 'kept' }], cases: { [source.caseId]: 7 } };
    await disk.transact(guild.id, async (state, save) => {
        state.skinCases = { [users[3]]: untouched };
        state.settings = { privateChannel: '77' };
        state.taixiu.round = { id: 'dice', bets: { [users[3]]: { tai: 1, xiu: 0 } } };
        await save();
    });
    const { act, room } = await seedRoom([200, 100]);
    store.read.mockClear();
    await battle.readRoom(guild.id, channelId, room.id);
    expect(store.read.mock.calls[0][1]).toEqual({ sections: ['cs2Battles'] });
    await act();
    await battle.markResultPublished(guild.id, room.id, 'message-1');
    await battle.listHistory(guild.id, users[0]);
    const state = await disk.read(guild.id);
    expect(state.settings).toEqual({ privateChannel: '77' });
    expect(state.taixiu.round).toEqual({ id: 'dice', bets: { [users[3]]: { tai: 1, xiu: 0 } } });
    expect(state.taixiu.balances[users[3]]).toBe(1000);
    expect(state.skinCases[users[3]]).toEqual(untouched);
    const scopes = store.transact.mock.calls.map(([, , scope]) => scope);
    expect(scopes.some(scope => scope.inventory?.includes(users[0]))).toBe(true);
    expect(scopes.every(scope => scope.inventory !== 'all' && !scope.inventory?.includes(users[3]))).toBe(true);
});
