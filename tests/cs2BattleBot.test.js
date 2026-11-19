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
const hostId = '101';
const outsiderId = '102';
let directory;
let disk;
let counter = 900;
let item;

beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-battle-bot-'));
    disk = store.createManagementStore(directory);
    jest.spyOn(store, 'read').mockImplementation(disk.read);
    jest.spyOn(store, 'transact').mockImplementation(disk.transact);
    jest.spyOn(market, 'peekMarketQuote').mockReturnValue({ priceVnd: 100 });
    item = customCases[0];
    await disk.transact(guild.id, async (state, save) => {
        state.taixiu.balances = { [hostId]: 1000, [outsiderId]: 1000 };
        await save();
    });
});

afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(directory, { recursive: true, force: true });
});

async function create({ format = '2', mode = 'regular', tieRule = 'split' } = {}) {
    const expectedPrices = lockCasePricing(casePricing(item, () => 100));
    return battle.createRoom(guild.id, { id: String(++counter), channelId, hostId, caseIds: [item.id], format, mode, tieRule,
        expectedPrices: { [item.id]: expectedPrices } });
}

function drawAllAtTicketZero(tieWinner = 0) {
    jest.spyOn(crypto, 'randomInt').mockImplementation((max, upper) => {
        if (upper != null) return max;
        if (max === 10_000) return 0;
        if (max === 2) return tieWinner;
        return 0;
    });
}

function expectConservedCoinPool(room) {
    const paid = Object.values(room.payouts).reduce((sum, amount) => sum + BigInt(amount), 0n);
    expect(paid + BigInt(room.unclaimedPayout ?? 0)).toBe(BigInt(room.pool));
    expect(room.players.filter(player => player.isBot).every(player => room.payouts[player.id] === undefined)).toBe(true);
}

async function seedLegacyBotRoom(values) {
    const id = String(++counter);
    const botId = `${battle.BOT_ID}:${id}:1`;
    const source = item.entries[0].drop;
    const seats = [hostId, botId, outsiderId].map((id, index) => ({ id,
        ...(index === 1 ? { isBot: true, name: 'Bot' } : {}) }));
    const now = Date.now();
    const room = { id, channelId, hostId, caseIds: [source.caseId], format: String(values.length), mode: 'sharing', tieRule: 'split',
        fee: '100', status: 'waiting', createdAt: now, expiresAt: now + 60_000, players: seats.slice(0, -1) };
    await disk.transact(guild.id, async (state, save) => { (state.cs2Battles ??= {})[id] = room; await save(); });
    jest.spyOn(market, 'getDropMarketQuoteRef').mockImplementation(drop => ({ name: String(drop.testValue) }));
    market.peekMarketQuote.mockImplementation(name => ({ priceVnd: Number(name) }));
    const roll = jest.fn((_weaponCase, dropId, acquiredAt) => ({ ...source, id: dropId, acquiredAt,
        testValue: values[Number(dropId.split('-').at(-1)) - 1] }));
    const act = () => battle.actOnRoom(guild, channelId, id, outsiderId, 'join', roll);
    return { room, botId, act, roll };
}

async function seedTeamBotRoom(mode, values, withOpponent) {
    const id = String(++counter);
    const source = item.entries[0].drop;
    const now = Date.now();
    const room = { id, channelId, hostId, caseIds: [source.caseId], format: 'teams', mode, tieRule: 'split',
        fee: '100', status: 'waiting', createdAt: now, expiresAt: now + 60_000, players: [{ id: hostId, team: 'A' }] };
    await disk.transact(guild.id, async (state, save) => { (state.cs2Battles ??= {})[id] = room; await save(); });
    if (withOpponent) {
        const joined = await battle.actOnRoom(guild, channelId, id, outsiderId, 'join-b');
        expect(joined.room.players).toEqual([{ id: hostId, team: 'A' }, { id: outsiderId, team: 'B' }]);
    }
    jest.spyOn(market, 'getDropMarketQuoteRef').mockImplementation(drop => ({ name: String(drop.testValue) }));
    market.peekMarketQuote.mockImplementation(name => ({ priceVnd: Number(name) }));
    const roll = jest.fn((_weaponCase, dropId, acquiredAt) => ({ ...source, id: dropId, acquiredAt,
        testValue: values[Number(dropId.split('-').at(-1)) - 1] }));
    const act = () => battle.actOnRoom(guild, channelId, id, hostId, 'bot-start', roll);
    return { room, act, roll };
}

test('only the host can start a bot match, and all seats settle once without charging or rewarding the bot', async () => {
    const { room } = await create({ tieRule: 'sudden-death' });
    const denied = await battle.actOnRoom(guild, channelId, room.id, outsiderId, 'bot-start');
    expect(denied.error).toMatch(/Chỉ chủ phòng/);
    expect((await battle.readRoom(guild.id, channelId, room.id)).players).toEqual([{ id: hostId }]);

    await disk.transact(guild.id, async (state, save) => { state.taixiu.balances[hostId] = 0; await save(); });
    const unaffordable = await battle.actOnRoom(guild, channelId, room.id, hostId, 'bot-start');
    expect(unaffordable.error).toMatch(/không còn đủ xu/);
    expect((await battle.readRoom(guild.id, channelId, room.id)).players).toEqual([{ id: hostId }]);

    await disk.transact(guild.id, async (state, save) => { state.taixiu.balances[hostId] = 1000; await save(); });
    drawAllAtTicketZero(1);
    const started = await battle.actOnRoom(guild, channelId, room.id, hostId, 'bot-start', undefined, 'message-1');
    const bot = started.room.players.find(player => player.isBot);
    expect(started).toMatchObject({ started: true, room: { status: 'revealing', winners: [bot.id], payoutType: 'skins', discardedSkins: 2 } });
    expect(bot).toMatchObject({ id: `${battle.BOT_ID}:${room.id}:1`, name: 'Bot', isBot: true });
    expect(started.room.pendingResultMessageId).toBe('message-1');

    const saved = await disk.read(guild.id);
    expect(readCoins(saved.taixiu.balances[hostId])).toBe(100_000n - BigInt(room.fee));
    expect(saved.taixiu.balances[bot.id]).toBeUndefined();
    expect(saved.skinCases).toBeUndefined();
    expect(saved.cs2BattleHistory[hostId][0].players).toEqual(started.room.players);
    expect(saved.cs2BattleHistory[bot.id]).toBeUndefined();
    expect(await battle.getHistoryConfig(guild.id, bot.id, room.id)).toBeNull();

    await expect(battle.completeReveal(guild, room.id)).resolves.toMatchObject({ completed: true, room: { status: 'finished' } });

    const repeated = await battle.actOnRoom(guild, channelId, room.id, hostId, 'bot-start', undefined, 'message-1');
    expect(repeated.started).toBeUndefined();
    const afterRetry = await disk.read(guild.id);
    expect(afterRetry.taixiu).toEqual(saved.taixiu);
    expect(afterRetry.skinCases).toEqual(saved.skinCases);
    expect(afterRetry.cs2Battles[room.id].rounds).toEqual(saved.cs2Battles[room.id].rounds);
});

test('the human gets skins when they beat a bot, while the bot never receives inventory', async () => {
    const { room } = await create({ tieRule: 'sudden-death' });
    drawAllAtTicketZero(0);
    const started = await battle.actOnRoom(guild, channelId, room.id, hostId, 'bot-start', undefined, 'message-winner');
    expect(started).toMatchObject({ started: true, room: { status: 'revealing', winners: [hostId] } });
    const pending = await disk.read(guild.id);
    expect(pending.skinCases).toBeUndefined();
    expect(readCoins(pending.taixiu.balances[hostId])).toBe(100_000n - BigInt(room.fee));
    const completed = await battle.completeReveal(guild, room.id);
    expect(completed.room.status).toBe('finished');
    const saved = await disk.read(guild.id);
    expect(saved.skinCases[hostId].drops).toHaveLength(2);
    expect(saved.skinCases[started.room.players[1].id]).toBeUndefined();

    const balance = saved.taixiu.balances[hostId];
    const drops = structuredClone(saved.skinCases[hostId].drops);
    await battle.actOnRoom(guild, channelId, room.id, hostId, 'bot-start');
    const repeated = await disk.read(guild.id);
    expect(repeated.taixiu.balances[hostId]).toBe(balance);
    expect(repeated.skinCases[hostId].drops).toEqual(drops);
});

test('bot seats are balanced across teams and split ties reserve each bot share', async () => {
    const { room } = await create({ format: 'teams', mode: 'regular' });
    drawAllAtTicketZero();
    const started = await battle.actOnRoom(guild, channelId, room.id, hostId, 'bot-start');
    const teamA = started.room.players.filter(player => player.team === 'A');
    const teamB = started.room.players.filter(player => player.team === 'B');
    expect(teamA).toHaveLength(2);
    expect(teamB).toHaveLength(2);
    expect(teamA.filter(player => player.isBot)).toHaveLength(1);
    expect(teamB.every(player => player.isBot)).toBe(true);
    const share = BigInt(started.room.pool) / 4n;
    expect(started.room).toMatchObject({ status: 'finished', payoutType: 'coins', tie: true, tieSplit: true,
        winners: started.room.players.map(player => player.id), payouts: { [hostId]: share.toString() },
        unclaimedPayout: (share * 3n).toString() });
    expectConservedCoinPool(started.room);
    const saved = await disk.read(guild.id);
    for (const player of started.room.players.filter(player => player.isBot)) {
        expect(saved.taixiu.balances[player.id]).toBeUndefined();
        expect(saved.skinCases?.[player.id]).toBeUndefined();
        expect(saved.cs2BattleHistory[player.id]).toBeUndefined();
    }
    expect(readCoins(saved.taixiu.balances[hostId])).toBe(100_000n - BigInt(room.fee) + share);
});

test.each(['2', '4'])('sharing across %s seats reserves bot shares without creating bot balances or history', async format => {
    const { room } = await create({ mode: 'sharing', format });
    drawAllAtTicketZero();
    const started = await battle.actOnRoom(guild, channelId, room.id, hostId, 'bot-start');
    const share = BigInt(started.room.pool) / BigInt(format);
    expect(started.room.payouts).toEqual({ [hostId]: share.toString() });
    expect(BigInt(started.room.unclaimedPayout)).toBe(BigInt(started.room.pool) - share);
    expectConservedCoinPool(started.room);
    const saved = await disk.read(guild.id);
    expect(readCoins(saved.taixiu.balances[hostId])).toBe(100_000n - BigInt(room.fee) + share);
    for (const bot of started.room.players.filter(player => player.isBot)) {
        expect(saved.taixiu.balances[bot.id]).toBeUndefined();
        expect(saved.skinCases?.[bot.id]).toBeUndefined();
        expect(saved.cs2BattleHistory[bot.id]).toBeUndefined();
    }
    expect((await battle.getHistoryConfig(guild.id, hostId, room.id)).unclaimedPayout).toBe(started.room.unclaimedPayout);
    await battle.actOnRoom(guild, channelId, room.id, hostId, 'bot-start');
    const repeated = await disk.read(guild.id);
    expect(repeated.taixiu).toEqual(saved.taixiu);
    expect(repeated.cs2Battles[room.id].payouts).toEqual(started.room.payouts);
});

test('cent remainders include a bot between two humans and are settled only once', async () => {
    const random = jest.spyOn(crypto, 'randomInt').mockReturnValue(0);
    const { room, botId, act, roll } = await seedLegacyBotRoom([100, 100, 102]);
    const [result, repeated] = await Promise.all([act(), act()]);
    expect(result.started).toBe(true);
    expect(repeated.started).toBeUndefined();
    expect(result.room).toMatchObject({ winners: [hostId, botId, outsiderId], pool: '30200',
        payouts: { [hostId]: '10067', [outsiderId]: '10066' }, unclaimedPayout: '10067' });
    expectConservedCoinPool(result.room);
    const saved = await disk.read(guild.id);
    expect(readCoins(saved.taixiu.balances[hostId])).toBe(100_000n - BigInt(room.fee) + 10067n);
    expect(readCoins(saved.taixiu.balances[outsiderId])).toBe(100_000n - BigInt(room.fee) + 10066n);
    expect(saved.taixiu.balances[botId]).toBeUndefined();
    expect(saved.skinCases).toBeUndefined();
    expect(saved.cs2BattleHistory[botId]).toBeUndefined();
    expect(roll).toHaveBeenCalledTimes(3);
    expect(random).toHaveBeenCalledTimes(1);
    expect(random).toHaveBeenCalledWith(3);
});

test.each(['regular', 'crazy'])('%s split ties with a bot pay only the human share', async mode => {
    const { room } = await create({ mode });
    drawAllAtTicketZero();
    const { room: result } = await battle.actOnRoom(guild, channelId, room.id, hostId, 'bot-start');
    const share = BigInt(result.pool) / 2n;
    expect(result).toMatchObject({ tie: true, tieSplit: true, payoutType: 'coins',
        payouts: { [hostId]: share.toString() }, unclaimedPayout: share.toString() });
    expectConservedCoinPool(result);
    const saved = await disk.read(guild.id);
    expect(readCoins(saved.taixiu.balances[hostId])).toBe(100_000n - BigInt(room.fee) + share);
    expect(saved.skinCases).toBeUndefined();
});

test('a human and bot on the winning team each keep one half of its award', async () => {
    const { room } = await create({ format: 'teams', tieRule: 'sudden-death' });
    drawAllAtTicketZero(0);
    const { room: result } = await battle.actOnRoom(guild, channelId, room.id, hostId, 'bot-start');
    const share = BigInt(result.pool) / 2n;
    expect(result.winners).toEqual(result.players.filter(player => player.team === 'A').map(player => player.id));
    expect(result).toMatchObject({ tieSplit: false, payoutType: 'coins', payouts: { [hostId]: share.toString() },
        unclaimedPayout: share.toString() });
    expectConservedCoinPool(result);
    const saved = await disk.read(guild.id);
    expect(readCoins(saved.taixiu.balances[hostId])).toBe(100_000n - BigInt(room.fee) + share);
    expect(result.players.filter(player => player.isBot).every(player => saved.taixiu.balances[player.id] === undefined)).toBe(true);
});

test.each([
    { mode: 'regular', withOpponent: false, values: [200, 50, 50, 300], winningTeam: 'A' },
    { mode: 'crazy', withOpponent: false, values: [50, 200, 300, 50], winningTeam: 'A' },
    { mode: 'regular', withOpponent: true, values: [50, 200, 300, 50], winningTeam: 'B' },
    { mode: 'crazy', withOpponent: true, values: [200, 50, 50, 300], winningTeam: 'B' }
])('$mode non-tie team win reserves the bot half (human opponent: $withOpponent)', async ({ mode, withOpponent, values, winningTeam }) => {
    const { room, act, roll } = await seedTeamBotRoom(mode, values, withOpponent);
    const attempts = await Promise.all([act(), act()]);
    expect(attempts.filter(attempt => attempt.started)).toHaveLength(1);
    const { room: result } = attempts.find(attempt => attempt.started);
    const winnerId = withOpponent ? outsiderId : hostId;
    const winningSeats = result.players.filter(player => player.team === winningTeam);
    expect(winningSeats).toHaveLength(2);
    expect(winningSeats.filter(player => player.isBot)).toHaveLength(1);
    expect(result.players.filter(player => player.isBot)).toHaveLength(withOpponent ? 2 : 3);
    expect(result).toMatchObject({ status: 'finished', tie: false, tieSplit: false, tieBreaks: [],
        winners: winningSeats.map(player => player.id), payoutType: 'coins', pool: '60000',
        payouts: { [winnerId]: '30000' }, unclaimedPayout: '30000' });
    expect(result.payouts).toEqual({ [winnerId]: '30000' });
    expectConservedCoinPool(result);

    const saved = await disk.read(guild.id);
    expect(readCoins(saved.taixiu.balances[hostId])).toBe(100_000n - BigInt(room.fee) + (withOpponent ? 0n : 30_000n));
    expect(readCoins(saved.taixiu.balances[outsiderId])).toBe(withOpponent ? 100_000n - BigInt(room.fee) + 30_000n : 100_000n);
    expect(saved.skinCases).toBeUndefined();
    for (const bot of result.players.filter(player => player.isBot)) {
        expect(saved.taixiu.balances[bot.id]).toBeUndefined();
        expect(saved.cs2BattleHistory[bot.id]).toBeUndefined();
    }
    expect((await battle.getHistoryConfig(guild.id, winnerId, room.id))).toMatchObject({
        payouts: { [winnerId]: '30000' }, unclaimedPayout: '30000'
    });

    expect((await act()).started).toBeUndefined();
    const repeated = await disk.read(guild.id);
    expect(repeated.taixiu).toEqual(saved.taixiu);
    expect(repeated.cs2BattleHistory).toEqual(saved.cs2BattleHistory);
    expect(repeated.cs2Battles[room.id]).toEqual(saved.cs2Battles[room.id]);
    expect(roll).toHaveBeenCalledTimes(4);
});

test.each(['regular', 'crazy'])('%s custom-case team win from room creation pays only the human half', async mode => {
    const highPriceName = item.entries[0].ref.name;
    const priceOf = entry => entry.ref.name === highPriceName ? 300 : 100;
    market.peekMarketQuote.mockImplementation(name => ({ priceVnd: name === highPriceName ? 300 : 100 }));
    const pricing = casePricing(item, priceOf);
    const expectedPrices = lockCasePricing(pricing);
    const created = await battle.createRoom(guild.id, { id: String(++counter), channelId, hostId,
        caseIds: [item.id], format: 'teams', mode, tieRule: 'split', expectedPrices: { [item.id]: expectedPrices } });
    expect(created.error).toBeUndefined();
    const room = created.room;
    const ticketFor = value => {
        const index = pricing.values.indexOf(value);
        expect(index).toBeGreaterThanOrEqual(0);
        return pricing.entries.slice(0, index).reduce((sum, entry) => sum + entry.weight, 0);
    };
    const low = ticketFor(100);
    const high = ticketFor(300);
    // New rooms roll in physical position order: A1, A2, B1, B2.
    const tickets = mode === 'regular' ? [high, high, low, low] : [low, low, high, high];
    let draws = 0;
    jest.spyOn(crypto, 'randomInt').mockImplementation((max, upper) => {
        if (upper != null) return max;
        if (max === 10_000) return tickets[draws++];
        return 0;
    });

    const { room: result, started } = await battle.actOnRoom(guild, channelId, room.id, hostId, 'bot-start');
    expect(started).toBe(true);
    const winningTeam = result.players.filter(player => player.team === 'A');
    expect(winningTeam).toEqual([{ id: hostId, team: 'A' }, expect.objectContaining({ isBot: true, team: 'A' })]);
    expect(result.winners).toEqual(winningTeam.map(player => player.id));
    expect(result).toMatchObject({ status: 'finished', tie: false, tieSplit: false, tieBreaks: [],
        payoutType: 'coins', pool: '80000', payouts: { [hostId]: '40000' }, unclaimedPayout: '40000' });
    expect(result.payouts).toEqual({ [hostId]: '40000' });
    expectConservedCoinPool(result);
    const saved = await disk.read(guild.id);
    expect(readCoins(saved.taixiu.balances[hostId])).toBe(100_000n - BigInt(room.fee) + 40_000n);
    expect(saved.skinCases).toBeUndefined();
    expect(result.players.filter(player => player.isBot).every(player => saved.taixiu.balances[player.id] === undefined)).toBe(true);
    await battle.actOnRoom(guild, channelId, room.id, hostId, 'bot-start');
    expect((await disk.read(guild.id)).taixiu).toEqual(saved.taixiu);
    expect(draws).toBe(4);
});

test('a bot-only winning team has no human payout and burns its unclaimed coin pool', async () => {
    const { room } = await create({ format: 'teams', mode: 'regular', tieRule: 'sudden-death' });
    drawAllAtTicketZero(1);
    const started = await battle.actOnRoom(guild, channelId, room.id, hostId, 'bot-start');
    const bots = started.room.players.filter(player => player.isBot);
    expect(started.room.tieBreaks).toMatchObject([{ left: 'A', right: 'B', winner: 'B' }]);
    expect(started.room.winners).toEqual(bots.filter(player => player.team === 'B').map(player => player.id));
    expect(started.room).toMatchObject({ payouts: {}, unclaimedPayout: started.room.pool, payoutType: 'coins' });
    expectConservedCoinPool(started.room);
    const saved = await disk.read(guild.id);
    expect(readCoins(saved.taixiu.balances[hostId])).toBe(100_000n - BigInt(room.fee));
    expect(bots.every(bot => saved.taixiu.balances[bot.id] === undefined)).toBe(true);
});
