const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: realSetTimeout } = require('node:timers');
const { ChannelType, PermissionsBitField, RESTJSONErrorCodes } = require('discord.js');
const store = require('../utils/managementStore');
const taixiu = require('../commands/taixiu');
const { COIN_SCALE } = require('../utils/coins');

let directory;
let disk;
let guild;
let channel;
let fixtureId = 1000;

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

async function until(predicate) {
    for (let attempt = 0; attempt < 400; attempt++) {
        if (predicate()) return;
        await new Promise(resolve => realSetTimeout(resolve, 5));
    }
    throw new Error('The expected asynchronous operation did not complete.');
}

function createChannel(id, messageId = '99') {
    const chat = {
        id, type: ChannelType.GuildText,
        permissionsFor: () => new PermissionsBitField(PermissionsBitField.All),
        messages: { edit: jest.fn().mockResolvedValue({ id: messageId }) },
        send: jest.fn().mockResolvedValue({ id: messageId })
    };
    guild.channels.cache.set(id, chat);
    return chat;
}

async function changeState(operation) {
    return disk.transact(guild.id, async (state, save) => { operation(state); await save(); });
}

function acceptedRound(overrides = {}) {
    return { id: 'round', automatic: true, channelId: channel.id, messageId: '99', closesAt: null, bets: {}, ...overrides };
}

function pendingPublication(overrides = {}) {
    return {
        id: 'publication-nonce', owner: 'previous-process', leaseUntil: 0, kind: 'new',
        sourceId: null, sourceMessageId: null, sourceChannelId: null, sourcePhase: 'none',
        settingChannelId: channel.id,
        round: { id: 'next-round', automatic: true, channelId: channel.id, closesAt: null, bets: {} },
        ...overrides
    };
}

function interaction(overrides = {}) {
    return {
        id: '101', guild, guildId: guild.id, user: { id: '13' }, member: {},
        channel, channelId: channel.id, message: { id: '99' },
        deferReply: jest.fn().mockResolvedValue(), editReply: jest.fn().mockResolvedValue(),
        followUp: jest.fn().mockResolvedValue(), ...overrides
    };
}

function bet(id = '101', amount = '100') {
    return interaction({
        id, customId: 'mg_taixiu_bet_tai_round', fields: { getTextInputValue: () => amount }
    });
}

async function purchase() {
    return taixiu.purchaseWithCoins(guild, '13', 100n * COIN_SCALE, state => {
        state.skinCases['13'].drops.push({ id: 'new-item' });
        return true;
    }, { wallets: ['13'], inventory: ['13'] });
}

beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-board-publication-'));
    disk = store.createManagementStore(directory);
    jest.spyOn(store, 'read').mockImplementation(disk.read);
    jest.spyOn(store, 'transact').mockImplementation(disk.transact);
    guild = { id: String(++fixtureId), members: { me: {} }, channels: { cache: new Map() } };
    channel = createChannel('10');
    await changeState(state => {
        state.settings.taixiuRoom = { channelId: channel.id };
        state.taixiu.balances = { 13: 1000, 14: 5000 };
        state.taixiu.round = null;
        state.skinCases = { 13: { drops: [] } };
    });
});

afterEach(async () => {
    jest.clearAllTimers();
    jest.restoreAllMocks();
    jest.useRealTimers();
    for (const file of await fs.readdir(directory)) await fs.unlink(path.join(directory, file));
    await fs.rmdir(directory);
});

test.each(['send', 'edit'])('a slow board %s releases the guild transaction for a purchase and daily claim', async method => {
    if (method === 'edit') await changeState(state => { state.taixiu.round = acceptedRound(); });
    const network = deferred();
    const request = method === 'send' ? channel.send : channel.messages.edit;
    request.mockReturnValueOnce(network.promise);
    const publishing = taixiu.syncAutomaticBoard(guild);
    await until(() => request.mock.calls.length === 1);
    let purchaseDone = false;
    let dailyDone = false;
    const buying = purchase().then(() => { purchaseDone = true; });
    const daily = taixiu.claimDaily(interaction({ user: { id: '14' } })).then(() => { dailyDone = true; });
    try {
        await until(() => purchaseDone && dailyDone);
        const state = await disk.read(guild.id);
        expect(state.taixiu.balances).toEqual({ 13: 900, 14: 5_005_000 });
        expect(state.skinCases['13'].drops).toEqual([{ id: 'new-item' }]);
        if (method === 'send') expect(state.taixiu.round).toBeNull();
    } finally {
        network.resolve({ id: '99' });
        await Promise.all([publishing, buying, daily]);
    }
    expect((await disk.read(guild.id)).taixiu.round.messageId).toBe('99');
});

test('a new board refreshes a balance changed by a full-scope purchase during its send', async () => {
    const network = deferred();
    channel.send.mockReturnValueOnce(network.promise);
    const publishing = taixiu.syncAutomaticBoard(guild);
    await until(() => channel.send.mock.calls.length === 1);
    const sentRanking = channel.send.mock.calls[0][0].embeds[1].toJSON().description;
    expect(sentRanking).toContain('<@13> · **1,000 xu**');
    try {
        // A full-scope trade updates the cached ranking while Discord is pending.
        await taixiu.purchaseWithCoins(guild, '13', 100n * COIN_SCALE, state => {
            state.skinCases['13'].drops.push({ id: 'new-item' });
            return true;
        });
    } finally {
        network.resolve({ id: '99' });
        await publishing;
    }
    expect((await disk.read(guild.id)).taixiu.balances['13']).toBe(900);
    await jest.advanceTimersByTimeAsync(1000);
    await until(() => channel.messages.edit.mock.calls.length > 0);
    const refreshedRanking = channel.messages.edit.mock.calls.at(-1)[1].embeds[1].toJSON().description;
    expect(refreshedRanking).toContain('<@13> · **900 xu**');
    expect(refreshedRanking).not.toContain('<@13> · **1,000 xu**');
});

test('a reservation commit failure sends no board and starts no timer', async () => {
    store.transact.mockImplementationOnce(async (guildId, operation) => {
        await operation(await disk.read(guildId), async () => {});
        throw new Error('Reservation commit failed');
    });
    await expect(taixiu.syncAutomaticBoard(guild)).rejects.toThrow('Reservation commit failed');
    expect(channel.send).not.toHaveBeenCalled();
    expect(channel.messages.edit).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    const state = await disk.read(guild.id);
    expect(state.taixiu.round).toBeNull();
    expect(state.taixiu.boardPublication).toBeUndefined();
});

test('a failed send preserves the accepted round and retries its stable nonce', async () => {
    const previous = acceptedRound({
        channelId: '20', closesAt: Date.now() - 1000, bets: { 13: { tai: 100, xiu: 0 } },
        result: { dice: [4, 3, 5], total: 12, winner: 'tai' }
    });
    await changeState(state => {
        state.taixiu.round = previous;
        state.taixiu.balances['13'] = 900;
    });
    channel.send.mockRejectedValueOnce(new Error('Discord unavailable'));
    await expect(taixiu.syncAutomaticBoard(guild)).rejects.toThrow('Discord unavailable');
    const failed = await disk.read(guild.id);
    expect(failed.taixiu.round).toEqual(previous);
    expect(failed.taixiu.balances['13']).toBe(900);
    const nonce = failed.taixiu.boardPublication.id;
    expect(channel.send.mock.calls[0][0]).toMatchObject({ nonce, enforceNonce: true });
    await taixiu.syncAutomaticBoard(guild);
    expect(channel.send.mock.calls[1][0]).toMatchObject({ nonce, enforceNonce: true });
    const recovered = await disk.read(guild.id);
    expect(recovered.taixiu.round).toMatchObject({ automatic: true, messageId: '99', closesAt: null, bets: {} });
    expect(recovered.taixiu.balances['13']).toBe(900);
    expect(recovered.taixiu.boardPublication).toBeUndefined();
});

test('a failed initial send waits for its board retry without scheduling a ranking read', async () => {
    channel.send.mockRejectedValueOnce(new Error('Missing permissions'));
    await expect(taixiu.syncAutomaticBoard(guild)).rejects.toThrow('Missing permissions');
    store.transact.mockClear();
    await jest.advanceTimersByTimeAsync(1000);
    expect(store.transact).not.toHaveBeenCalled();
    expect((await disk.read(guild.id)).taixiu.round).toBeNull();
    await taixiu.syncAutomaticBoard(guild);
    expect((await disk.read(guild.id)).taixiu.round.messageId).toBe('99');
});

test('an uncertain final commit retries the same Discord nonce before accepting one round', async () => {
    let transaction = 0;
    store.transact.mockImplementation(async (guildId, operation, scope) => {
        if (++transaction === 2) {
            await operation(await disk.read(guildId), async () => {});
            throw new Error('Final commit failed');
        }
        return disk.transact(guildId, operation, scope);
    });
    await expect(taixiu.syncAutomaticBoard(guild)).rejects.toThrow('Final commit failed');
    let state = await disk.read(guild.id);
    expect(state.taixiu.round).toBeNull();
    const { id: nonce, round } = state.taixiu.boardPublication;
    await taixiu.syncAutomaticBoard(guild);
    expect(channel.send).toHaveBeenCalledTimes(2);
    expect(channel.send.mock.calls.map(([payload]) => payload.nonce)).toEqual([nonce, nonce]);
    state = await disk.read(guild.id);
    expect(state.taixiu.round).toEqual({ ...round, messageId: '99' });
    expect(state.taixiu.balances).toEqual({ 13: 1000, 14: 5000 });
    expect(state.taixiu.history).toBeUndefined();
    expect(state.taixiu.boardPublication).toBeUndefined();
});

test('simultaneous automatic resumes accept one new board', async () => {
    await Promise.all([taixiu.syncAutomaticBoard(guild), taixiu.syncAutomaticBoard(guild), taixiu.syncAutomaticBoard(guild)]);
    expect(channel.send).toHaveBeenCalledTimes(1);
    const state = await disk.read(guild.id);
    expect(state.taixiu.round).toMatchObject({ automatic: true, channelId: channel.id, messageId: '99' });
    expect(state.taixiu.boardPublication).toBeUndefined();
});

test('simultaneous manual replays publish one board while a purchase commits', async () => {
    await changeState(state => {
        delete state.settings.taixiuRoom;
        state.taixiu.round = acceptedRound({ automatic: false, closesAt: Date.now() - 1000,
            result: { dice: [4, 3, 5], total: 12, winner: 'tai' } });
    });
    const network = deferred();
    channel.send.mockReturnValueOnce(network.promise);
    const first = interaction({ id: '111' });
    const second = interaction({ id: '112' });
    const opening = taixiu.play(first, 'round');
    await until(() => channel.send.mock.calls.length === 1);
    const duplicate = taixiu.play(second, 'round');
    try {
        await purchase();
        expect((await disk.read(guild.id)).taixiu.round.id).toBe('round');
    } finally {
        network.resolve({ id: '100' });
        await Promise.all([opening, duplicate]);
    }
    expect(channel.send).toHaveBeenCalledTimes(1);
    const state = await disk.read(guild.id);
    expect(state.taixiu.round).toMatchObject({ id: '111', messageId: '100', bets: {} });
    expect(state.taixiu.balances['13']).toBe(900);
    expect(first.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Đã mở bàn') }));
    expect(second.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('đang có một bàn') }));
});

test('a failed draw commit cannot publish dice or alter committed stakes', async () => {
    await changeState(state => {
        state.taixiu.round = acceptedRound({ closesAt: Date.now() - 5000, bets: { 13: { tai: 100, xiu: 0 } } });
        state.taixiu.balances['13'] = 900;
    });
    store.transact.mockImplementationOnce(async (guildId, operation) => {
        await operation(await disk.read(guildId), async () => {});
        throw new Error('Draw commit failed');
    });
    await expect(taixiu.syncAutomaticBoard(guild)).rejects.toThrow('Draw commit failed');
    expect(channel.send).not.toHaveBeenCalled();
    expect(channel.messages.edit).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    const state = await disk.read(guild.id);
    expect(state.taixiu.round.draw).toBeUndefined();
    expect(state.taixiu.round.bets).toEqual({ 13: { tai: 100, xiu: 0 } });
    expect(state.taixiu.balances['13']).toBe(900);
});

test('a changed setup during a slow send rejects the obsolete destination', async () => {
    const destination = createChannel('20', '200');
    const network = deferred();
    const obsolete = { id: '99', delete: jest.fn().mockResolvedValue() };
    channel.send.mockReturnValueOnce(network.promise);
    const publishing = taixiu.syncAutomaticBoard(guild);
    await until(() => channel.send.mock.calls.length === 1);
    await changeState(state => { state.settings.taixiuRoom = { channelId: destination.id }; });
    const latest = taixiu.syncAutomaticBoard(guild);
    network.resolve(obsolete);
    await Promise.all([publishing, latest]);
    const state = await disk.read(guild.id);
    expect(state.settings.taixiuRoom.channelId).toBe(destination.id);
    expect(state.taixiu.round).toMatchObject({ channelId: destination.id, messageId: '200' });
    expect(obsolete.delete).toHaveBeenCalledTimes(1);
    expect(destination.send).toHaveBeenCalledTimes(1);
});

test('a first bet on the source board makes an in-flight replacement obsolete', async () => {
    await changeState(state => {
        state.taixiu.round = acceptedRound();
        state.taixiu.boardPublication = pendingPublication({
            sourceId: 'round', sourceMessageId: '99', sourceChannelId: channel.id, sourcePhase: 'waiting'
        });
    });
    const network = deferred();
    const obsolete = { id: '100', delete: jest.fn().mockResolvedValue() };
    channel.send.mockReturnValueOnce(network.promise);
    const publishing = taixiu.syncAutomaticBoard(guild);
    await until(() => channel.send.mock.calls.length === 1);
    try {
        await taixiu.modal(bet());
    } finally {
        network.resolve(obsolete);
        await publishing;
    }
    const state = await disk.read(guild.id);
    expect(state.taixiu.round).toMatchObject({ id: 'round', messageId: '99', bets: { 13: { tai: 100, xiu: 0 } } });
    expect(state.taixiu.round.closesAt).toBeGreaterThan(Date.now());
    expect(state.taixiu.balances['13']).toBe(900);
    expect(state.taixiu.boardPublication).toBeUndefined();
    expect(obsolete.delete).toHaveBeenCalledTimes(1);
});

test('repairing a deleted board merges its new message ID without losing concurrent bets', async () => {
    await changeState(state => {
        state.taixiu.round = acceptedRound({ closesAt: Date.now() + 30_000, bets: { 13: { tai: 100, xiu: 0 } } });
        state.taixiu.balances['13'] = 900;
    });
    const network = deferred();
    channel.send.mockReturnValueOnce(network.promise);
    const repairing = taixiu.recoverDeleted(guild, new Set(['99']));
    await until(() => channel.send.mock.calls.length === 1);
    try {
        await taixiu.modal(bet('102', '75'));
    } finally {
        network.resolve({ id: '100' });
        await repairing;
    }
    const state = await disk.read(guild.id);
    expect(state.taixiu.round).toMatchObject({ id: 'round', messageId: '100', bets: { 13: { tai: 175, xiu: 0 } }, betRequests: ['102'] });
    expect(state.taixiu.balances['13']).toBe(825);
    expect(state.taixiu.boardPublication).toBeUndefined();
});

test.each(['idle', 'active'])('resume restores an offline-deleted %s automatic board and accepts a fresh bet', async phase => {
    const active = phase === 'active';
    const previous = acceptedRound({
        closesAt: active ? Date.now() + 30_000 : null,
        bets: active ? { 13: { tai: 100, xiu: 0 } } : {}
    });
    await changeState(state => {
        state.taixiu.round = previous;
        state.taixiu.balances['13'] = active ? 900 : 1000;
    });
    channel.messages.edit.mockRejectedValueOnce(Object.assign(new Error('Unknown Message'), { code: RESTJSONErrorCodes.UnknownMessage }));
    channel.send.mockResolvedValueOnce({ id: '100' });
    await taixiu.resume(guild);
    const restored = await disk.read(guild.id);
    expect(restored.taixiu.round).toEqual({ ...previous, messageId: '100' });
    expect(restored.taixiu.balances['13']).toBe(active ? 900 : 1000);
    expect(restored.taixiu.boardPublication).toBeUndefined();
    const request = bet('103', '75');
    request.message.id = '100';
    await taixiu.modal(request);
    const state = await disk.read(guild.id);
    expect(state.taixiu.round.id).toBe(previous.id);
    expect(state.taixiu.round.bets['13']).toEqual({ tai: active ? 175 : 75, xiu: 0 });
    expect(state.taixiu.balances['13']).toBe(active ? 825 : 925);
    expect(request.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Đã đặt') }));
    expect(channel.send).toHaveBeenCalledTimes(1);
});

test('restart recovery waits for a foreign lease then reuses the expired reservation nonce', async () => {
    const leaseUntil = Date.now() + 60_000;
    await changeState(state => { state.taixiu.boardPublication = pendingPublication({ leaseUntil }); });
    await taixiu.syncAutomaticBoard(guild);
    expect(channel.send).not.toHaveBeenCalled();
    expect((await disk.read(guild.id)).taixiu.boardPublication.owner).toBe('previous-process');
    jest.setSystemTime(leaseUntil + 1);
    await taixiu.syncAutomaticBoard(guild);
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(channel.send.mock.calls[0][0]).toMatchObject({ nonce: 'publication-nonce', enforceNonce: true });
    const state = await disk.read(guild.id);
    expect(state.taixiu.round).toMatchObject({ id: 'next-round', messageId: '99' });
    expect(state.taixiu.boardPublication).toBeUndefined();
});

// The runner creates a fresh local cluster; production DATABASE_URL is never used.
const postgresTest = process.env.TEST_DATABASE_URL ? test : test.skip;
postgresTest('PostgreSQL releases its guild advisory lock while the board send is pending', async () => {
    // pg uses nextTick for its protocol; keep this actual database case on real time.
    jest.useRealTimers();
    const { createDatabase } = require('../utils/database');
    const first = createDatabase({ connectionString: process.env.TEST_DATABASE_URL, max: 2 });
    const second = createDatabase({ connectionString: process.env.TEST_DATABASE_URL, max: 2 });
    const network = deferred();
    let publishing;
    let buying;
    try {
        await Promise.all([first.initialize(), second.initialize()]);
        const boardStore = store.createPostgresManagementStore(first);
        const coinStore = store.createPostgresManagementStore(second);
        await boardStore.transact(guild.id, async (state, save) => {
            state.settings.taixiuRoom = { channelId: channel.id };
            state.taixiu.balances['13'] = 1000;
            state.skinCases = { 13: { drops: [] } };
            await save();
        });
        store.transact.mockImplementation(boardStore.transact);
        store.read.mockImplementation(boardStore.read);
        channel.send.mockReturnValueOnce(network.promise);
        publishing = taixiu.syncAutomaticBoard(guild);
        await until(() => channel.send.mock.calls.length === 1);

        // A separate pool must acquire the same guild advisory lock for this trade.
        store.transact.mockImplementation(coinStore.transact);
        let committed = false;
        buying = taixiu.purchaseWithCoins(guild, '13', 100n * COIN_SCALE, state => {
            state.skinCases['13'].drops.push({ id: 'new-item' });
            return true;
        }).then(() => { committed = true; });
        await until(() => committed);
        const pending = await coinStore.read(guild.id);
        expect(pending.taixiu.round).toBeNull();
        expect(pending.taixiu.boardPublication).toBeDefined();
        expect(pending.taixiu.balances['13']).toBe(900);
        expect(pending.skinCases['13'].drops).toEqual([{ id: 'new-item' }]);

        network.resolve({ id: '99' });
        await publishing;
        const saved = await boardStore.read(guild.id);
        expect(saved.taixiu.round).toMatchObject({ messageId: '99', channelId: channel.id });
        expect(saved.taixiu.balances['13']).toBe(900);
        expect(saved.skinCases['13'].drops).toEqual([{ id: 'new-item' }]);
        expect(saved.taixiu.boardPublication).toBeUndefined();
    } finally {
        network.resolve({ id: '99' });
        await Promise.allSettled([publishing, buying].filter(Boolean));
        await Promise.allSettled([first.close(), second.close()]);
        jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    }
}, 15_000);
