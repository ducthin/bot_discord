jest.mock('../utils/cs2BattleArt', () => ({
    getBattleCaseArt: () => null, getBattleTieArt: () => null, getBattleTieAnimation: () => null
}));

const { MessageFlags } = require('discord.js');
const battle = require('../utils/cs2Battles');
const { customCases } = require('../utils/cs2BattleCases');
const { createBattleUi } = require('../utils/cs2BattleUi');

const lifetime = 60_000;
const startedAt = Date.UTC(2026, 10, 15, 0, 0, 0);
const caseId = customCases[0].id;
const room = () => ({ id: '100', channelId: '20', status: 'finished', format: '2', mode: 'regular',
    tieRule: 'split', fee: '100', players: [{ id: '101' }, { id: '102' }], winners: ['102'], payoutType: 'skins',
    caseIds: [caseId], totals: { 101: '100', 102: '200' }, pool: '300',
    rounds: [{ caseId, entries: ['101', '102'].map((userId, index) => ({ userId, value: String(100 + index * 100),
        drop: { skinId: 'skin', float: 0.1 } })) }] });

let saved;
let currentRoom;
let channel;
let guild;

const makeUi = () => createBattleUi({ rollDrop: jest.fn(), reelRound: jest.fn(), dropName: () => 'Skin',
    dropImage: () => '', showResult: jest.fn() });
const refresh = (extra = {}) => ({ id: 'interaction', customId: 'mg_hom_battle-refresh_100', guild, guildId: guild.id,
    channelId: '20', channel, message: { id: 'message-100' }, user: { id: '101' }, attachmentSizeLimit: 0,
    deferUpdate: jest.fn(), editReply: jest.fn(), followUp: jest.fn(), reply: jest.fn(), ...extra });

beforeEach(() => {
    jest.useFakeTimers().setSystemTime(startedAt);
    saved = null;
    currentRoom = room();
    channel = { messages: { edit: jest.fn(), delete: jest.fn().mockResolvedValue() } };
    guild = { id: '1', channels: { fetch: jest.fn().mockResolvedValue(channel) } };
    jest.spyOn(battle, 'readRoom').mockImplementation(async () => currentRoom);
    jest.spyOn(battle, 'pendingResults').mockResolvedValue([]);
    jest.spyOn(battle, 'pendingResultDeletions').mockImplementation(async () => saved ? [{ ...saved }] : []);
    jest.spyOn(battle, 'markResultPublished').mockImplementation(async (_guild, roomId, messageId) => {
        saved ??= { roomId, channelId: '20', messageId, publishedAt: Date.now(), deleteAt: Date.now() + lifetime };
        return { ...saved };
    });
    jest.spyOn(battle, 'markResultDeleted').mockImplementation(async () => { saved = null; });
});

afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
});

test('the result stays for one minute from its first appearance, and refresh does not extend it', async () => {
    const ui = makeUi();
    const request = refresh();
    await ui.handle(request);
    expect(request.editReply.mock.calls[0][0].embeds[0].data.footer.text).toContain('tự xóa sau 1 phút');
    expect(saved.deleteAt).toBe(startedAt + lifetime);
    const page = refresh({ customId: 'mg_hom_battle-result-page_100_0' });
    await ui.handle(page);
    expect(battle.markResultPublished).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(lifetime - 1);
    expect(channel.messages.delete).not.toHaveBeenCalled();
    await ui.handle(refresh());
    expect(saved.deleteAt).toBe(startedAt + lifetime);
    await jest.advanceTimersByTimeAsync(1);
    expect(channel.messages.delete).toHaveBeenCalledTimes(1);
    expect(channel.messages.delete).toHaveBeenCalledWith('message-100');
    expect(battle.markResultDeleted).toHaveBeenCalledWith('1', '100', 'message-100');
    expect(saved).toBeNull();
    expect(currentRoom.status).toBe('finished');
    expect(currentRoom.pool).toBe('300');
});

test('restart restores the original remaining time using the bot API, without editing the result again', async () => {
    await makeUi().handle(refresh());
    jest.clearAllTimers(); // Timers disappear when the process exits; the stored deadline remains.
    jest.setSystemTime(startedAt + 40_000);
    const restarted = makeUi();
    await restarted.restoreResults(guild);
    expect(channel.messages.edit).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(20_000 - 1);
    expect(channel.messages.delete).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(guild.channels.fetch).toHaveBeenCalledWith('20');
    expect(channel.messages.delete).toHaveBeenCalledWith('message-100');
    expect(saved).toBeNull();
});

test('overdue results are removed immediately after restart even when the room has already been pruned', async () => {
    saved = { roomId: 'pruned-room', channelId: '20', messageId: 'old-result', publishedAt: startedAt - lifetime,
        deleteAt: startedAt - 1 };
    currentRoom = null;
    await makeUi().restoreResults(guild);
    expect(channel.messages.delete).toHaveBeenCalledWith('old-result');
    expect(battle.markResultDeleted).toHaveBeenCalledWith('1', 'pruned-room', 'old-result');
    expect(jest.getTimerCount()).toBe(0);
});

test('deleted messages are acknowledged and transient delete errors retry without duplicate timers', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    saved = { roomId: '100', channelId: '20', messageId: 'message-100', publishedAt: startedAt - lifetime,
        deleteAt: startedAt - 1 };
    channel.messages.delete.mockRejectedValueOnce(new Error('Discord temporarily unavailable'))
        .mockRejectedValueOnce(Object.assign(new Error('Unknown Message'), { code: 10008 }));
    const ui = makeUi();
    await ui.restoreResults(guild);
    await ui.restoreResults(guild);
    expect(channel.messages.delete).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(1);
    await jest.advanceTimersByTimeAsync(59_999);
    expect(channel.messages.delete).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(channel.messages.delete).toHaveBeenCalledTimes(2);
    expect(saved).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
});

test('an unpublished restored result starts its one minute only after its final panel is sent', async () => {
    currentRoom.pendingResultMessageId = 'message-100';
    battle.pendingResults.mockResolvedValue([currentRoom]);
    await makeUi().restoreResults(guild);
    expect(channel.messages.edit).toHaveBeenCalledWith('message-100', expect.objectContaining({ embeds: expect.any(Array) }));
    expect(saved.publishedAt).toBe(startedAt);
    expect(saved.deleteAt).toBe(startedAt + lifetime);
    await jest.advanceTimersByTimeAsync(lifetime);
    expect(channel.messages.delete).toHaveBeenCalledWith('message-100');
});

test('concurrent reconnects share an in-flight deletion and acknowledge it once', async () => {
    saved = { roomId: '100', channelId: '20', messageId: 'message-100', publishedAt: startedAt - lifetime,
        deleteAt: startedAt - 1 };
    let finishDelete;
    let startDelete;
    const deleting = new Promise(resolve => { startDelete = resolve; });
    channel.messages.delete.mockImplementation(() => {
        startDelete();
        return new Promise(resolve => { finishDelete = resolve; });
    });
    const ui = makeUi();
    const first = ui.restoreResults(guild);
    await deleting;
    expect(channel.messages.delete).toHaveBeenCalledTimes(1);
    await ui.restoreResults(guild);
    expect(channel.messages.delete).toHaveBeenCalledTimes(1);
    finishDelete();
    await first;
    expect(battle.markResultDeleted).toHaveBeenCalledTimes(1);
    expect(saved).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
});

test('a failed final edit never starts the result lifetime or acknowledges publication', async () => {
    const request = refresh();
    request.editReply.mockRejectedValue(new Error('Discord edit failed'));
    channel.messages.edit.mockRejectedValue(new Error('Discord edit failed'));
    await expect(makeUi().handle(request)).rejects.toThrow('Discord edit failed');
    expect(battle.markResultPublished).not.toHaveBeenCalled();
    expect(saved).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
});

test('ephemeral or unrelated-channel interactions never register a public result for deletion', async () => {
    const ui = makeUi();
    await ui.handle(refresh({ message: { id: 'ephemeral', flags: { has: flag => flag === MessageFlags.Ephemeral } } }));
    await ui.handle(refresh({ channelId: 'other-channel' }));
    expect(battle.markResultPublished).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
});
