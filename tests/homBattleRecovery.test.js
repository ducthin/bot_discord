jest.mock('../utils/cs2BattleArt', () => ({
    getBattleCaseArt: () => null, getBattleTieArt: () => null, getBattleTieAnimation: () => null
}));

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { setImmediate: nextTurn } = require('node:timers/promises');
const battle = require('../utils/cs2Battles');
const store = require('../utils/managementStore');
const reel = require('../utils/cs2Reel');
const { customCases } = require('../utils/cs2BattleCases');
const { createBattleUi } = require('../utils/cs2BattleUi');

const caseId = customCases[0].id;
const roomId = '100';
const channelId = '20';
const messageId = '800';
let directory;
let disk;
let guild;
let channel;
let ui;
let stopped;
let finishedRecovery;

const request = () => ({ id: '200', customId: `mg_hom_battle-refresh_${roomId}`, guild, guildId: guild.id,
    channelId, channel, message: { id: messageId }, user: { id: '101' }, attachmentSizeLimit: 0,
    deferUpdate: jest.fn(), editReply: jest.fn(), followUp: jest.fn(), reply: jest.fn() });

beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-battle-recovery-'));
    disk = store.createManagementStore(directory);
    stopped = false;
    jest.useFakeTimers();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(store, 'read').mockImplementation(disk.read);
    jest.spyOn(store, 'transact').mockImplementation(disk.transact);
    jest.spyOn(reel, 'renderCaseBatch').mockResolvedValue(null);
    jest.spyOn(battle, 'completeReveal');
    jest.spyOn(battle, 'markResultPublished');
    const pendingDeletions = battle.pendingResultDeletions;
    jest.spyOn(battle, 'pendingResultDeletions').mockImplementation(async (...args) => {
        const result = await pendingDeletions(...args);
        finishedRecovery?.();
        return result;
    });
    channel = { messages: { edit: jest.fn().mockResolvedValue(), delete: jest.fn().mockResolvedValue() } };
    guild = { id: '1', channels: { fetch: jest.fn().mockResolvedValue(channel) } };
    ui = createBattleUi({ rollDrop: jest.fn(), reelRound: () => ({ cards: [{}], selectedIndex: 0, result: {} }),
        dropName: () => 'Skin', dropImage: () => '', showResult: jest.fn(), shuttingDown: () => stopped });
    await disk.transact(guild.id, async (state, save) => {
        state.taixiu.balances = { 101: 900, 102: 900 };
        state.cs2Battles = { [roomId]: {
            id: roomId, channelId, hostId: '101', status: 'revealing', format: '2', mode: 'sharing', tieRule: 'split',
            fee: '10000', players: [{ id: '101' }, { id: '102' }], winners: ['101', '102'], payoutType: 'coins',
            payouts: { 101: '30000', 102: '30000' }, pendingResultMessageId: messageId,
            caseIds: [caseId], totals: { 101: '30000', 102: '30000' }, pool: '60000', createdAt: Date.now(),
            rounds: [{ caseId, entries: ['101', '102'].map(userId => ({ userId, value: '30000',
                drop: { ...customCases[0].entries[0].drop, id: `drop-${userId}` } })) }]
        } };
        await save();
    });
});

afterEach(async () => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
    await fs.rm(directory, { recursive: true, force: true });
});

async function recover() {
    const done = new Promise(resolve => { finishedRecovery = resolve; });
    await jest.advanceTimersByTimeAsync(60_000);
    await done;
    await nextTurn();
    finishedRecovery = undefined;
}

test('transient round edits retry automatically and release the stored payout exactly once', async () => {
    const interaction = request();
    interaction.editReply.mockRejectedValue(new Error('Temporary edit failure'));
    channel.messages.edit.mockRejectedValueOnce(new Error('Temporary bot edit failure'));
    await ui.handle(interaction);
    expect(battle.completeReveal).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(1);
    expect((await disk.read(guild.id)).taixiu.balances).toEqual({ 101: 900, 102: 900 });

    await recover();
    const state = await disk.read(guild.id);
    expect(state.taixiu.balances).toEqual({ 101: 1200, 102: 1200 });
    expect(state.cs2Battles[roomId].status).toBe('finished');
    expect(state.cs2Battles[roomId].pendingResultMessageId).toBeUndefined();
    expect(state.cs2BattleResultMessages[roomId].messageId).toBe(messageId);
    await ui.restoreResults(guild);
    expect(battle.completeReveal).toHaveBeenCalledTimes(1);
    expect((await disk.read(guild.id)).taixiu.balances).toEqual(state.taixiu.balances);
});

test('a failed final edit retries publication without paying twice', async () => {
    const interaction = request();
    interaction.editReply.mockImplementation(async payload => {
        if (payload.embeds[0].data.title === '🏆 Kết quả Case Battle') throw new Error('Final edit failed');
    });
    channel.messages.edit.mockRejectedValueOnce(new Error('Final bot edit failed'));
    await expect(ui.handle(interaction)).rejects.toThrow('Final bot edit failed');
    const pending = await disk.read(guild.id);
    expect(pending.cs2Battles[roomId].status).toBe('finished');
    expect(pending.cs2Battles[roomId].pendingResultMessageId).toBe(messageId);
    expect(jest.getTimerCount()).toBe(1);

    await recover();
    expect(battle.completeReveal).toHaveBeenCalledTimes(1);
    const state = await disk.read(guild.id);
    expect(state.taixiu.balances).toEqual(pending.taixiu.balances);
    expect(state.cs2Battles[roomId].pendingResultMessageId).toBeUndefined();
    expect(state.cs2BattleResultMessages[roomId].messageId).toBe(messageId);
});

test('a failed publication acknowledgement retries the saved result', async () => {
    battle.markResultPublished.mockRejectedValueOnce(new Error('Temporary storage failure'));
    await expect(ui.handle(request())).rejects.toThrow('Temporary storage failure');
    expect(jest.getTimerCount()).toBe(1);
    await recover();
    const state = await disk.read(guild.id);
    expect(state.taixiu.balances).toEqual({ 101: 1200, 102: 1200 });
    expect(state.cs2Battles[roomId].pendingResultMessageId).toBeUndefined();
    expect(battle.completeReveal).toHaveBeenCalledTimes(1);
    expect(battle.markResultPublished).toHaveBeenCalledTimes(2);
});

test('shutdown leaves the pending result for restart without scheduling new retries', async () => {
    const interaction = request();
    stopped = true;
    await ui.handle(interaction);
    expect(battle.completeReveal).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    expect((await disk.read(guild.id)).cs2Battles[roomId].pendingResultMessageId).toBe(messageId);
});

test('recovery retries after repeated temporary storage read failures', async () => {
    jest.spyOn(battle, 'pendingResults')
        .mockRejectedValueOnce(new Error('Database temporarily unavailable'))
        .mockRejectedValueOnce(new Error('Database still unavailable'));
    await expect(ui.restoreResults(guild)).rejects.toThrow('Database temporarily unavailable');
    expect(jest.getTimerCount()).toBe(1);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(battle.pendingResults).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(1);
    await recover();
    const state = await disk.read(guild.id);
    expect(state.cs2Battles[roomId].status).toBe('finished');
    expect(state.taixiu.balances).toEqual({ 101: 1200, 102: 1200 });
    expect(battle.completeReveal).toHaveBeenCalledTimes(1);
});

test('concurrent reconnects share one recovery pass before the first read finishes', async () => {
    let finishRead;
    const pendingResults = battle.pendingResults;
    jest.spyOn(battle, 'pendingResults').mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
    const first = ui.restoreResults(guild);
    await ui.restoreResults(guild);
    expect(battle.pendingResults).toHaveBeenCalledTimes(1);
    finishRead(await pendingResults(guild.id));
    await first;
    expect(battle.completeReveal).toHaveBeenCalledTimes(1);
    expect(battle.markResultPublished).toHaveBeenCalledTimes(1);
});

test('shutdown during a recovery render preserves the pending reward without sending more panels', async () => {
    let finishRender;
    let startRender;
    const rendering = new Promise(resolve => { startRender = resolve; });
    reel.renderCaseBatch.mockImplementationOnce(() => {
        startRender();
        return new Promise(resolve => { finishRender = resolve; });
    });
    const recovery = ui.restoreResults(guild);
    await rendering;
    const sent = channel.messages.edit.mock.calls.length;
    stopped = true;
    finishRender({ gif: Buffer.from('GIF89a') });
    await recovery;
    await ui.restoreResults(guild);
    expect(channel.messages.edit).toHaveBeenCalledTimes(sent);
    expect(battle.completeReveal).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    const state = await disk.read(guild.id);
    expect(state.cs2Battles[roomId].status).toBe('revealing');
    expect(state.taixiu.balances).toEqual({ 101: 900, 102: 900 });
});

test('shutdown at the end of a recovered tie break keeps rewards pending for the next start', async () => {
    await disk.transact(guild.id, async (state, save) => {
        state.cs2Battles[roomId].tieBreaks = [{ left: '101', right: '102', winner: '101' }];
        await save();
    });
    channel.messages.edit.mockImplementation(async (_id, panel) => {
        if (panel.embeds[0].data.title.startsWith('🪙')) stopped = true;
    });
    await ui.restoreResults(guild);
    expect(stopped).toBe(true);
    expect(battle.completeReveal).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    expect((await disk.read(guild.id)).cs2Battles[roomId].status).toBe('revealing');
});
