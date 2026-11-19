const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
jest.mock('../commands/taixiu', () => ({
    getCoinBalance: (state, userId) => state.taixiu?.balances[userId] == null ? 100000n : require('../utils/coins').readCoins(state.taixiu.balances[userId]),
    refreshCoinLeaderboard: jest.fn()
}));
const store = require('../utils/managementStore');
const market = require('../utils/cs2Market');
const engine = require('../utils/cs2BattleCases');
const wallet = require('../commands/taixiu');
const { createPlayerService } = require('../utils/playerService');
const { verifyRoom, LIFETIME } = require('../utils/playerBattles');
const { readCoins } = require('../utils/coins');
const owner = { guildId: '1', userId: '13', displayName: 'Chủ phòng', avatar: 'https://cdn.example.com/avatar.png' };
const guest = { guildId: '1', userId: '14', displayName: 'Người tham gia', avatar: null };
let directory, disk, service, guild, client, priorGuildIds, price, expired;
const change = operation => disk.transact('1', async (state, save) => { operation(state); await save(); });
const rawRoom = async id => (await disk.read('1'))[`playerWebBattle:${id}`];
const body = () => ({ requestId: randomUUID() });
const createOptions = (extra = {}) => ({ requestId: randomUUID(), caseIds: ['battle-howl'], capacity: 2,
    quoteIds: { 'battle-howl': service.caseDetail('battle-howl').quoteId }, ...extra });
async function fullRoom(options = {}) {
    const created = await service.battleCreate(owner, createOptions(options));
    await service.battleJoin(guest, created.room.id, body());
    return created.room.id;
}

beforeEach(async () => {
    priorGuildIds = process.env.GUILD_IDS; process.env.GUILD_IDS = '1,2';
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'player-battles-'));
    disk = store.createManagementStore(directory);
    jest.spyOn(store, 'read').mockImplementation(disk.read);
    jest.spyOn(store, 'transact').mockImplementation(disk.transact);
    guild = { id: '1', available: true, channels: { cache: new Map() }, members: {
        fetch: jest.fn(async ({ user }) => ({ user: { id: user, bot: false } }))
    } };
    client = { isReady: jest.fn(() => true), guilds: { cache: new Map([['1', guild], ['2', { ...guild, id: '2' }]]) } };
    service = createPlayerService({ client });
    price = 100; expired = false;
    jest.spyOn(market, 'peekMarketQuote').mockImplementation((name, ref) => ({
        source: ref.paintSeed == null ? 'buff' : 'csfloat', phase: ref.phase ?? null,
        ...(ref.paintSeed == null ? {} : { paintSeed: ref.paintSeed }), priceVnd: price,
        observedAt: Date.now() - 1000, expiresAt: Date.now() + (expired ? -1 : 600000)
    }));
    await change(state => {
        state.settings = { preserved: true };
        state.taixiu = { balances: { 13: 1000000, 14: 1000000, 15: 1000000, 16: 1000000, 99: 777 }, round: { id: 'untouched' } };
        state.skinCases = { 13: { drops: [] }, 14: { drops: [] }, 99: { drops: [{ id: 'other-owner-drop' }] } };
        state.cs2Battles = { discord: { id: 'discord', future: 'private-discord-result' } };
    });
    wallet.refreshCoinLeaderboard.mockClear();
});
afterEach(async () => {
    jest.restoreAllMocks();
    if (priorGuildIds === undefined) delete process.env.GUILD_IDS; else process.env.GUILD_IDS = priorGuildIds;
    await fs.rm(directory, { recursive: true, force: true });
});

test('creation persists a private commitment and a safe lobby with no wallet debit or future outcomes', async () => {
    const before = await disk.read('1');
    const created = await service.battleCreate(owner, createOptions({ cases: [{ caseId: 'battle-howl', count: 2 }], caseIds: undefined }));
    expect(created.room).toMatchObject({ status: 'waiting', hostId: '13', capacity: 2, caseIds: ['battle-howl', 'battle-howl'], canCancel: true, canStart: false });
    expect(created.room.commitment).toMatch(/^[a-f0-9]{64}$/);
    const room = await rawRoom(created.room.id);
    expect(room.serverSeed).toMatch(/^[a-f0-9]{64}$/);
    const listed = await service.battleList(guest);
    expect(listed).toMatchObject({ limits: { rounds: 100, capacities: [2, 3, 4, 5, 6] }, rooms: [expect.objectContaining({ canJoin: true })] });
    const detail = await service.battleDetail(guest, created.room.id);
    expect(JSON.stringify([created, listed, detail])).not.toContain(room.serverSeed);
    expect(JSON.stringify([created, listed, detail])).not.toMatch(/pricesByCase|private-discord-result|other-owner-drop/);
    expect(created.room.rounds).toBeUndefined();
    expect(listed.rooms[0].rounds).toBeUndefined();
    expect(detail.room.proof).toBeUndefined();
    const after = await disk.read('1');
    expect(after.taixiu).toEqual(before.taixiu);
    expect(after.skinCases['99']).toEqual(before.skinCases['99']);
    expect(after.cs2Battles).toEqual(before.cs2Battles);
    expect(after.settings).toEqual(before.settings);
    expect((await service.me(owner)).history[0]).toMatchObject({ action: 'battle-create', roomId: room.id, roomStatus: 'waiting',
        message: 'Tạo phòng Battle · 2 vòng', total: '0', items: [] });
    expect(wallet.refreshCoinLeaderboard).not.toHaveBeenCalled();
    const restarted = createPlayerService({ client });
    expect(await restarted.battleDetail(owner, created.room.id)).toEqual({ room: created.room });
});

test('concurrent duplicate creation is exactly once and retry preserves its quoted room after market prices change', async () => {
    const options = createOptions();
    const [first, second] = await Promise.all([service.battleCreate(owner, options), service.battleCreate(owner, options)]);
    expect([first.replayed, second.replayed].sort()).toEqual([false, true]);
    expect(first.room).toEqual(second.room);
    expect((await service.battleList(owner)).rooms).toHaveLength(1);
    price = 500;
    expect(await service.battleCreate(owner, options)).toEqual({ ...first, replayed: true });
    await expect(service.battleCreate(owner, { ...options, capacity: 3 })).rejects.toMatchObject({ status: 409 });
    expect((await disk.read('1')).skinCases['13'].webRequestCount).toBe(1);
});

test('joining is idempotent, does not auto start a full room, and only its host can start or cancel', async () => {
    const created = await service.battleCreate(owner, createOptions());
    const id = created.room.id, request = body();
    const joins = await Promise.all([service.battleJoin(guest, id, request), service.battleJoin(guest, id, request)]);
    expect(joins[0].room.players.map(player => player.userId)).toEqual(['13', '14']);
    expect(joins.map(result => result.replayed).sort()).toEqual([false, true]);
    expect(joins[0].room.status).toBe('waiting');
    expect((await service.battleDetail(owner, id)).room.canStart).toBe(true);
    expect((await service.battleJoin(guest, id, body())).replayed).toBe(true);
    await expect(service.battleJoin({ ...guest, userId: '15' }, id, body())).rejects.toMatchObject({ status: 409 });
    await expect(service.battleStart(guest, id, body())).rejects.toMatchObject({ status: 403 });
    await expect(service.battleCancel(guest, id, body())).rejects.toMatchObject({ status: 403 });
    await expect(service.battleLeave(owner, id, body())).rejects.toMatchObject({ status: 409 });
    const leaving = body();
    expect((await service.battleLeave(guest, id, leaving)).room.players).toHaveLength(1);
    expect((await service.battleLeave(guest, id, leaving)).replayed).toBe(true);
    await expect(service.battleStart(owner, id, body())).rejects.toMatchObject({ status: 409 });
    expect((await rawRoom(id)).status).toBe('waiting');
    expect(readCoins((await disk.read('1')).taixiu.balances['13'])).toBe(100000000n);
});

test('bot seats are owner-controlled and sharing pays only the real player once', async () => {
    const created = await service.battleCreate(owner, createOptions({ capacity: 3, mode: 'sharing' }));
    const id = created.room.id;
    await expect(service.battleBot(guest, id, { ...body(), seat: 2 })).rejects.toMatchObject({ status: 403 });
    const add = { ...body(), seat: 2, botId: 'capy-chill' };
    const firstBot = await service.battleBot(owner, id, add);
    expect((await service.battleBot(owner, id, add)).replayed).toBe(true);
    expect(firstBot.room.players.filter(player => player.isBot)).toHaveLength(1);
    await service.battleBot(owner, id, { ...body(), seat: 3, botId: 'cat-broke' });
    const swapped = await service.battleSeat(owner, id, { ...body(), seat: 3 });
    expect(swapped.room.seats['13']).toBe(3);
    expect(swapped.room.players.find(player => player.botProfileId === 'cat-broke').seat).toBe(1);
    const before = await disk.read('1'), start = body();
    const result = await service.battleStart(owner, id, start);
    expect(result.room).toMatchObject({ status: 'finished', payoutType: 'coins', proof: { verified: true }, pool: '30000',
        payouts: { 13: '10000' }, unclaimedPayout: '20000', discardedSkins: 0 });
    expect(result.room.playbackStartedAt).toBe(result.room.finishedAt + 6000);
    expect((await service.battleDetail(guest, id)).room.playbackStartedAt).toBe(result.room.playbackStartedAt);
    expect((await service.battleList(guest)).rooms.find(room => room.id === id).playbackStartedAt).toBeUndefined();
    expect(Object.keys(result.room.botPayouts)).toHaveLength(2);
    expect(result.room.rounds[0].entries.map(entry => entry.userId)).toEqual(result.room.players.map(player => player.userId));
    expect((await service.battleStart(owner, id, start)).replayed).toBe(true);
    const saved = await disk.read('1');
    expect(readCoins(saved.taixiu.balances['13'])).toBe(readCoins(before.taixiu.balances['13']) - BigInt(result.room.fee) + 10000n);
    expect(Object.keys(saved.taixiu.balances).some(userId => userId.startsWith('web-bot:'))).toBe(false);
    expect(Object.keys(saved.skinCases).some(userId => userId.startsWith('web-bot:'))).toBe(false);
    expect(saved.skinCases['13'].drops).toEqual([]);
    expect(saved.taixiu.balances['14']).toBe(before.taixiu.balances['14']);
    expect(verifyRoom(await rawRoom(id))).toBe(true);
});

test('legacy finished Battle without finishedAt gets a stable playback epoch from startedAt', async () => {
    const id = await fullRoom();
    await service.battleStart(owner, id, body());
    const legacy = await rawRoom(id);
    delete legacy.finishedAt;
    await change(state => { state[`playerWebBattle:${id}`] = legacy; });
    const first = (await service.battleDetail(owner, id)).room;
    const second = (await service.battleDetail(guest, id)).room;
    expect(first.playbackStartedAt).toBe(legacy.startedAt + 6000);
    expect(second.playbackStartedAt).toBe(first.playbackStartedAt);
});

test('concurrent starts settle all fees and the skin prize once in a single participant-scoped transaction', async () => {
    const originalRoll = engine.rollCustomCase;
    jest.spyOn(engine, 'rollCustomCase').mockImplementation((item, prices, id, acquiredAt, draw) => ({
        ...originalRoll(item, prices, id, acquiredAt, draw), value: id.endsWith('-1') ? 10000n : 20000n
    }));
    const id = await fullRoom({ caseIds: ['battle-howl', 'battle-howl'] });
    const before = await disk.read('1'), request = body();
    const [first, second] = await Promise.all([service.battleStart(owner, id, request), service.battleStart(owner, id, request)]);
    expect(first.room).toMatchObject({ status: 'finished', winners: ['14'], payoutType: 'skins', pool: '60000', proof: { verified: true } });
    expect(first.room.rounds).toHaveLength(2);
    expect(first.room.rounds[0].entries.every(entry => entry.item.skinId && entry.item.value === entry.value)).toBe(true);
    expect(first.room).toEqual(second.room);
    expect([first.replayed, second.replayed].sort()).toEqual([false, true]);
    const fee = BigInt(first.room.fee), after = await disk.read('1');
    for (const userId of ['13', '14']) expect(readCoins(after.taixiu.balances[userId])).toBe(readCoins(before.taixiu.balances[userId]) - fee);
    expect(after.skinCases['13'].drops).toEqual([]);
    expect(after.skinCases['14'].drops).toHaveLength(4);
    expect(new Set(after.skinCases['14'].drops.map(drop => drop.id)).size).toBe(4);
    expect(after.taixiu.round).toEqual(before.taixiu.round);
    expect(after.skinCases['99']).toEqual(before.skinCases['99']);
    expect(after.taixiu.balances['99']).toBe(before.taixiu.balances['99']);
    expect(after.cs2Battles).toEqual(before.cs2Battles);
    expect(store.transact).toHaveBeenLastCalledWith('1', expect.any(Function), {
        sections: ['playerWebBattles', `playerWebBattle:${id}`, `playerWebRequest:13:${request.requestId}`], wallets: ['13', '14'], inventory: ['13', '14']
    });
    expect(wallet.refreshCoinLeaderboard).toHaveBeenCalledTimes(1);
    const duplicate = await service.battleStart(owner, id, body());
    expect(duplicate).toMatchObject({ replayed: true, room: { winners: ['14'] } });
    expect((await disk.read('1')).skinCases['14'].drops).toHaveLength(4);
    expect(wallet.refreshCoinLeaderboard).toHaveBeenCalledTimes(1);
    expect(verifyRoom(await rawRoom(id))).toBe(true);
    const tampered = await rawRoom(id); tampered.rounds[0].entries[0].value = '99999';
    expect(verifyRoom(tampered)).toBe(false);
});

test.each(['regular', 'crazy', 'sharing'])('equal totals and %s split the entire pool as coins without duplicating inventory', async mode => {
    const id = await fullRoom({ mode });
    const before = await disk.read('1');
    const result = await service.battleStart(owner, id, body());
    expect(result.room).toMatchObject({ status: 'finished', payoutType: 'coins', winners: ['13', '14'], pool: '20000' });
    expect(Object.values(result.room.payouts).reduce((sum, value) => sum + BigInt(value), 0n)).toBe(BigInt(result.room.pool));
    const after = await disk.read('1');
    for (const userId of ['13', '14']) {
        expect(readCoins(after.taixiu.balances[userId])).toBe(readCoins(before.taixiu.balances[userId]) - BigInt(result.room.fee) + BigInt(result.room.payouts[userId]));
        expect(after.skinCases[userId].drops).toEqual([]);
    }
    expect(result.room.proof.verified).toBe(true);
});

test('crazy awards skins to the smallest total, and a four-player room requires all seats', async () => {
    const originalRoll = engine.rollCustomCase;
    jest.spyOn(engine, 'rollCustomCase').mockImplementation((item, prices, id, acquiredAt, draw) => ({
        ...originalRoll(item, prices, id, acquiredAt, draw), value: BigInt(id.at(-1)) * 10000n
    }));
    const created = await service.battleCreate(owner, createOptions({ capacity: 4, mode: 'crazy' }));
    const id = created.room.id;
    for (const userId of ['14', '15']) await service.battleJoin({ ...guest, userId }, id, body());
    await expect(service.battleStart(owner, id, body())).rejects.toMatchObject({ status: 409 });
    await service.battleJoin({ ...guest, userId: '16' }, id, body());
    const result = await service.battleStart(owner, id, body());
    expect(result.room).toMatchObject({ winners: ['13'], payoutType: 'skins', pool: '100000' });
    expect((await disk.read('1')).skinCases['13'].drops).toHaveLength(4);
    expect(result.room.proof.verified).toBe(true);
});

test('a three-player hundred-round Battle preserves inventories beyond the 500-item display window and grants all three hundred prizes', async () => {
    const originalRoll = engine.rollCustomCase;
    jest.spyOn(engine, 'rollCustomCase').mockImplementation((item, prices, id, acquiredAt, draw) => ({
        ...originalRoll(item, prices, id, acquiredAt, draw), value: BigInt(id.at(-1)) * 10000n
    }));
    const created = await service.battleCreate(owner, createOptions({ capacity: 3, caseIds: Array(100).fill('battle-howl') }));
    for (const userId of ['14', '15']) await service.battleJoin({ ...guest, userId }, created.room.id, body());
    const template = engine.customCasesById.get('battle-howl').entries[0].drop;
    await change(state => { state.skinCases['15'] = { drops: Array.from({ length: 500 }, (_, index) => ({ ...template, id: `existing-${index}` })) }; });
    const result = await service.battleStart(owner, created.room.id, body());
    expect(result.room).toMatchObject({ winners: ['15'], payoutType: 'skins', pool: '6000000', proof: { verified: true } });
    expect(result.room.rounds).toHaveLength(100);
    expect(result.room.rounds.flatMap(round => round.entries)).toHaveLength(300);
    const saved = await disk.read('1');
    expect(saved.skinCases['15'].drops).toHaveLength(800);
    expect(saved.skinCases['15'].drops[0].id).toBe('existing-0');
    expect(new Set(saved.skinCases['15'].drops.map(drop => drop.id)).size).toBe(800);
    const inventory = await service.me({ ...guest, userId: '15' });
    expect(inventory.inventoryTotal).toBe(800);
    expect(inventory.inventory).toHaveLength(800);
    expect(inventory.inventory[0].id).toBe(`${created.room.id}-100-3`);
    for (const userId of ['13', '14', '15']) expect(readCoins(saved.taixiu.balances[userId])).toBe(100000000n - BigInt(result.room.fee));
});

test.each([21, 100])('a compressed %i-case Battle can be created beyond the former 20-round limit without charging the host', async count => {
    const before = await disk.read('1');
    const detail = service.caseDetail('battle-howl');
    const created = await service.battleCreate(owner, createOptions({ caseIds: undefined, cases: [{ caseId: 'battle-howl', count }] }));
    expect(created.room.caseIds).toEqual(Array(count).fill('battle-howl'));
    expect(created.room.fee).toBe((BigInt(detail.fee) * BigInt(count)).toString());
    expect((await disk.read('1')).taixiu).toEqual(before.taixiu);
});

test('mixed case quantities share the same 100-round Battle limit and preserve the requested order', async () => {
    const first = service.caseDetail('battle-howl'), second = service.caseDetail('battle-balance');
    const created = await service.battleCreate(owner, createOptions({ caseIds: undefined,
        cases: [{ caseId: 'battle-howl', count: 40 }, { caseId: 'battle-balance', count: 60 }],
        quoteIds: { 'battle-howl': first.quoteId, 'battle-balance': second.quoteId } }));
    expect(created.room.caseIds).toEqual([...Array(40).fill('battle-howl'), ...Array(60).fill('battle-balance')]);
    expect(created.room.fee).toBe((BigInt(first.fee) * 40n + BigInt(second.fee) * 60n).toString());
});

test.each([
    { caseIds: Array(101).fill('battle-howl') },
    { caseIds: undefined, cases: [{ caseId: 'battle-howl', count: 101 }] },
    { caseIds: undefined, cases: [{ caseId: 'battle-howl', count: 60 }, { caseId: 'battle-balance', count: 41 }] }
])('a Battle exceeding 100 total cases is rejected without changing wallets, inventory, rooms or receipts: %j', async extra => {
    const before = await disk.read('1');
    await expect(service.battleCreate(owner, createOptions(extra))).rejects.toMatchObject({ status: 400, message: expect.stringContaining('100') });
    expect(await disk.read('1')).toEqual(before);
});

test('a participant swap while start validates membership cannot settle against a wallet missing from its scoped snapshot', async () => {
    const created = await service.battleCreate(owner, createOptions({ capacity: 3 })), id = created.room.id;
    for (const userId of ['14', '15']) await service.battleJoin({ ...guest, userId }, id, body());
    let release, validating;
    const arrived = new Promise(resolve => { validating = resolve; });
    const normalFetch = guild.members.fetch.getMockImplementation();
    guild.members.fetch.mockImplementation(async options => {
        if (options.user !== '15') return normalFetch(options);
        guild.members.fetch.mockImplementation(normalFetch);
        validating();
        return new Promise(resolve => { release = () => resolve({ user: { id: '15', bot: false } }); });
    });
    const starting = service.battleStart(owner, id, body());
    await arrived;
    await service.battleLeave({ ...guest, userId: '15' }, id, body());
    await service.battleJoin({ ...guest, userId: '16' }, id, body());
    const before = await disk.read('1');
    release();
    await expect(starting).rejects.toMatchObject({ status: 409 });
    expect((await disk.read('1')).taixiu).toEqual(before.taixiu);
    expect((await rawRoom(id)).status).toBe('waiting');
    expect((await service.battleStart(owner, id, body())).room.status).toBe('finished');
});

test('price changes, stale quotes and spent wallets leave everyone uncharged and the room retryable', async () => {
    const id = await fullRoom();
    const before = await disk.read('1');
    price = 200;
    await expect(service.battleStart(owner, id, body())).rejects.toMatchObject({ status: 409 });
    expect((await disk.read('1')).taixiu).toEqual(before.taixiu);
    price = 100; expired = true;
    await expect(service.battleStart(owner, id, body())).rejects.toMatchObject({ status: 409 });
    expect((await disk.read('1')).taixiu).toEqual(before.taixiu);
    expired = false;
    await change(state => { state.taixiu.balances['14'] = '0'; });
    const spent = await disk.read('1');
    await expect(service.battleStart(owner, id, body())).rejects.toMatchObject({ status: 409 });
    expect((await disk.read('1')).taixiu).toEqual(spent.taixiu);
    expect((await rawRoom(id)).status).toBe('waiting');
});

test('a roll or database save failure propagates and persists neither debit nor prize, then the same request can safely retry', async () => {
    const id = await fullRoom(), request = body(), before = await disk.read('1');
    const roll = jest.spyOn(engine, 'rollCustomCase').mockImplementationOnce(() => { throw new Error('Roll unavailable'); });
    await expect(service.battleStart(owner, id, request)).rejects.toThrow('Roll unavailable');
    expect(await disk.read('1')).toEqual(before);
    roll.mockRestore();
    store.transact.mockImplementationOnce((guildId, operation, scope) => disk.transact(guildId, state => operation(state, async () => { throw new Error('Commit unavailable'); }), scope));
    await expect(service.battleStart(owner, id, request)).rejects.toThrow('Commit unavailable');
    expect(await disk.read('1')).toEqual(before);
    expect((await service.battleStart(owner, id, request)).room.status).toBe('finished');
});

test('cancellation, expiration and cross-guild access cannot charge a wallet or expose private room data', async () => {
    const created = await service.battleCreate(owner, createOptions()), id = created.room.id;
    const before = await disk.read('1');
    await expect(service.battleDetail({ ...owner, guildId: '2' }, id)).rejects.toMatchObject({ status: 404 });
    await expect(service.battleJoin({ ...guest, guildId: '2' }, id, body())).rejects.toMatchObject({ status: 404 });
    const request = body();
    expect((await service.battleCancel(owner, id, request)).room.status).toBe('cancelled');
    expect((await service.battleCancel(owner, id, request)).replayed).toBe(true);
    await expect(service.battleStart(owner, id, body())).rejects.toMatchObject({ status: 409 });
    expect((await disk.read('1')).taixiu).toEqual(before.taixiu);
    const other = await service.battleCreate(owner, createOptions());
    const now = Date.now(); jest.spyOn(Date, 'now').mockReturnValue(now + LIFETIME + 1);
    expect((await service.battleDetail(owner, other.room.id)).room).toMatchObject({ status: 'expired', canJoin: false, canStart: false });
    await expect(service.battleJoin(guest, other.room.id, body())).rejects.toMatchObject({ status: 409 });
    expect((await disk.read('1')).taixiu).toEqual(before.taixiu);
});

test('fresh membership, readiness, request UUID, case limits, quote and owner quota are validated before any debit', async () => {
    for (const extra of [{ capacity: 7 }, { capacity: 3, format: '2v2' }, { format: 'invalid' }, { format: ['solo'] }, { caseIds: [] }, { caseIds: Array(101).fill('battle-howl') }, { mode: 'invalid' }, { mode: ['regular'] },
        { quoteIds: {} }, { requestId: 'invalid' }, { clientSeed: 'bad\u0000seed' }]) {
        await expect(service.battleCreate(owner, createOptions(extra))).rejects.toMatchObject({ status: 400 });
    }
    const oldQuote = createOptions(); price = 200;
    await expect(service.battleCreate(owner, oldQuote)).rejects.toMatchObject({ status: 409 });
    price = 100;
    client.isReady.mockReturnValue(false);
    await expect(service.battleCreate(owner, createOptions())).rejects.toMatchObject({ status: 503 });
    client.isReady.mockReturnValue(true);
    guild.members.fetch.mockResolvedValueOnce({ user: { id: '999', bot: false } });
    await expect(service.battleCreate(owner, createOptions())).rejects.toMatchObject({ status: 403 });
    guild.members.fetch.mockResolvedValueOnce({ guild: { id: '2' }, user: { id: '13', bot: false } });
    await expect(service.battleCreate(owner, createOptions())).rejects.toMatchObject({ status: 403 });
    const id = await fullRoom();
    guild.members.fetch.mockImplementation(async ({ user }) => user === '14' ? null : { user: { id: user, bot: false } });
    await expect(service.battleStart(owner, id, body())).rejects.toMatchObject({ status: 403 });
    guild.members.fetch.mockImplementation(async ({ user }) => ({ user: { id: user, bot: false } }));
    await change(state => { state.skinCases['13'].webRequestCount = 5000; });
    await expect(service.battleStart(owner, id, body())).rejects.toMatchObject({ status: 409 });
    expect((await rawRoom(id)).status).toBe('waiting');
    expect((await disk.read('1')).taixiu.balances['13']).toBe(1000000);
});

test.each([
    ['regular', ['13']], ['crazy', ['14']], ['sharing', ['13', '14']],
    ['terminal', ['14']], ['terminal_crazy', ['13']], ['clutch', ['13']], ['clutch_crazy', ['14']],
    ['jackpot', null], ['jackpot_crazy', null]
])('web mode %s resolves its own rule and conserves settlement under replay', async (mode, expected) => {
    const original = engine.rollCustomCase, values = [[100n, 1n], [2n, 4n], [3n, 5n]];
    jest.spyOn(engine, 'rollCustomCase').mockImplementation((item, prices, id, acquiredAt, draw) => {
        const [, round, seat] = /-(\d+)-(\d+)$/.exec(id);
        return { ...original(item, prices, id, acquiredAt, draw), value: values[Number(round) - 1][Number(seat) - 1] * 100n };
    });
    const id = await fullRoom({ mode, caseIds: Array(3).fill('battle-howl') });
    const before = await disk.read('1'), request = body();
    const first = await service.battleStart(owner, id, request), replay = await service.battleStart(owner, id, request);
    expect(first.room.proof).toMatchObject({ verified: true, rulesVersion: 2, mode, format: 'solo' });
    expect(first.room.pool).toBe('11500');
    if (expected) expect(first.room.winners).toEqual(expected);
    else {
        expect(first.room.winners).toHaveLength(1);
        expect(first.room.decision.totalWeight).toMatch(/^\d+$/);
        expect(BigInt(first.room.decision.ticket)).toBeLessThan(BigInt(first.room.decision.totalWeight));
        expect(first.room.proof.jackpotAlgorithm).toBe('HMAC-SHA256/BigInt-rejection-v1');
    }
    expect(replay.room).toEqual(first.room);
    expect(replay.replayed).toBe(true);
    const after = await disk.read('1');
    if (first.room.payoutType === 'coins') expect(Object.values(first.room.payouts).reduce((sum, value) => sum + BigInt(value), 0n)).toBe(11500n);
    else expect(after.skinCases[first.room.winners[0]].drops).toHaveLength(6);
    for (const id of ['13', '14']) expect(readCoins(after.taixiu.balances[id])).toBe(readCoins(before.taixiu.balances[id]) - BigInt(first.room.fee) + BigInt(first.room.payouts[id] ?? 0));
    expect(verifyRoom(await rawRoom(first.room.id))).toBe(true);
    const tampered = await rawRoom(first.room.id); tampered.decision.winningGroups = ['forged'];
    expect(verifyRoom(tampered)).toBe(false);
});

test.each([['2v2', 4, ['13']], ['3v3', 6, ['13']], ['2v2v2', 6, ['13']]])('team format %s derives teams from seats and pays only real winners', async (format, capacity) => {
    const original = engine.rollCustomCase;
    jest.spyOn(engine, 'rollCustomCase').mockImplementation((item, prices, id, acquiredAt, draw) => ({
        ...original(item, prices, id, acquiredAt, draw), value: id.endsWith('-1') ? 100000n : 100n
    }));
    const created = await service.battleCreate(owner, createOptions({ format, capacity }));
    for (let seat = 2; seat <= capacity; seat++) await service.battleBot(owner, created.room.id, { ...body(), seat });
    const waiting = (await service.battleDetail(owner, created.room.id)).room;
    expect(waiting.players[0]).toMatchObject({ seat: 1, team: 'A' });
    expect(waiting.players.at(-1).team).toBe(format === '2v2v2' ? 'C' : 'B');
    expect(waiting.decision).toBeUndefined();
    const before = await disk.read('1'), result = (await service.battleStart(owner, created.room.id, body())).room;
    expect(result).toMatchObject({ format, capacity, payoutType: 'coins', proof: { verified: true } });
    expect(result.winners).toHaveLength(format === '3v3' ? 3 : 2);
    expect(result.winners).toContain('13');
    expect(Object.values(result.payouts).reduce((sum, value) => sum + BigInt(value), 0n) + BigInt(result.unclaimedPayout)).toBe(BigInt(result.pool));
    const after = await disk.read('1');
    expect(readCoins(after.taixiu.balances['13'])).toBe(readCoins(before.taixiu.balances['13']) - BigInt(result.fee) + BigInt(result.payouts['13']));
    expect(Object.keys(after.taixiu.balances).some(id => id.startsWith('web-bot:'))).toBe(false);
    expect(after.skinCases['13'].drops).toEqual([]);
    expect((await service.battleDetail(owner, result.id)).room).toEqual(result);
});

test('team badges and scoring follow seat swaps, and six-seat rooms accept the last seat', async () => {
    const created = await service.battleCreate(owner, createOptions({ format: '3v3', capacity: 6 }));
    for (let seat = 2; seat <= 6; seat++) await service.battleBot(owner, created.room.id, { ...body(), seat });
    const result = await service.battleSeat(owner, created.room.id, { ...body(), seat: 6, team: 'A' });
    expect(result.room.players.find(player => player.userId === owner.userId)).toMatchObject({ seat: 6, team: 'B' });
    const started = await service.battleStart(owner, created.room.id, body());
    expect(started.room.proof.verified).toBe(true);
});

test('legacy solo outcomes still verify with the original rules and random stream', async () => {
    const id = await fullRoom(); await service.battleStart(owner, id, body());
    const room = await rawRoom(id);
    delete room.rulesVersion; delete room.format; delete room.decision;
    expect(verifyRoom(room)).toBe(true);
});

const postgresTest = process.env.TEST_DATABASE_URL ? test : test.skip;
postgresTest('PostgreSQL Battle settlement survives reconnect and replays exactly once with isolated room and receipt sections', async () => {
    const { createDatabase } = require('../utils/database');
    let first, restarted;
    try {
        first = createDatabase({ connectionString: process.env.TEST_DATABASE_URL, max: 4 });
        await first.initialize();
        await first.reset();
        const pg = store.createPostgresManagementStore(first);
        const initial = await disk.read('1');
        await pg.transact('1', async (state, save) => { Object.assign(state, initial); await save(); });
        store.read.mockImplementation(pg.read);
        store.transact.mockImplementation(pg.transact);
        const options = createOptions();
        const created = await service.battleCreate(owner, options), id = created.room.id;
        await service.battleJoin(guest, id, body());
        const before = await pg.read('1'), request = body();
        const starts = await Promise.all([service.battleStart(owner, id, request), service.battleStart(owner, id, request)]);
        expect(starts.map(result => result.replayed).sort()).toEqual([false, true]);
        expect(starts[0].room.proof.verified).toBe(true);
        const sql = await first.query('SELECT section, entry_key, data FROM discord_bot.guild_records WHERE guild_id = $1 AND section = ANY($2::text[])',
            ['1', ['playerWebBattles', `playerWebBattle:${id}`, `playerWebRequest:13:${request.requestId}`]]);
        const index = sql.rows.find(row => row.section === 'playerWebBattles' && row.entry_key === id).data;
        expect(index.rounds).toBeUndefined(); expect(index.proof).toBeUndefined(); expect(index.serverSeed).toBeUndefined();
        expect(sql.rows.find(row => row.section === `playerWebBattle:${id}` && row.entry_key === 'rounds').data).toHaveLength(1);
        expect(sql.rows.find(row => row.section === `playerWebRequest:13:${request.requestId}` && row.entry_key === 'result').data.room.id).toBe(id);
        await first.close(); first = null;
        restarted = createDatabase({ connectionString: process.env.TEST_DATABASE_URL, max: 2 });
        const fresh = store.createPostgresManagementStore(restarted);
        store.read.mockImplementation(fresh.read); store.transact.mockImplementation(fresh.transact);
        const freshService = createPlayerService({ client });
        const replay = await freshService.battleStart(owner, id, request);
        expect(replay).toEqual({ ...starts[0], replayed: true });
        expect((await freshService.battleDetail(owner, id)).room).toEqual(starts[0].room);
        const after = await fresh.read('1');
        for (const userId of ['13', '14']) expect(readCoins(after.taixiu.balances[userId]))
            .toBe(readCoins(before.taixiu.balances[userId]) - BigInt(replay.room.fee) + BigInt(replay.room.payouts[userId] ?? 0));
        expect(after.cs2Battles).toEqual(before.cs2Battles);
        expect(after.skinCases['99']).toEqual(before.skinCases['99']);
        expect(after.skinCases['13'].webRequestCount).toBe(2);
    } finally { await Promise.allSettled([first?.close(), restarted?.close()]); }
});
