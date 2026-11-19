jest.mock('node:timers/promises', () => ({ setTimeout: jest.fn() }));

const { setTimeout: playback } = require('node:timers/promises');
const battle = require('../utils/cs2Battles');
const reel = require('../utils/cs2Reel');
const { customCases } = require('../utils/cs2BattleCases');
const { createBattleUi } = require('../utils/cs2BattleUi');

const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
const gif = label => ({ gif: Buffer.from(label) });
const room = (id, count = 3, gold = false) => ({
    id, status: 'finished', channelId: '20', format: '2', mode: 'regular', tieRule: 'split',
    fee: '100', players: [{ id: '101' }, { id: '102' }], winners: ['102'], payoutType: 'skins',
    caseIds: Array(count).fill(customCases[0].id), pendingResultMessageId: `message-${id}`,
    rounds: Array.from({ length: count }, (_, index) => ({ caseId: customCases[0].id,
        entries: ['101', '102'].map((userId, player) => ({ userId, value: String(100 + player),
            drop: { tag: `${id}${index + 1}`, gold, skinId: 'skin', float: 0.1 } }))
    }))
});
const request = (id, action = 'join', extra = {}) => ({
    id: `interaction-${id}`, customId: `mg_hom_battle-${action}_${id}`,
    guild: { id: '1' }, guildId: '1', channelId: '20', user: { id: '102' },
    message: { id: `message-${id}` }, attachmentSizeLimit: 1_000_000,
    deferUpdate: jest.fn(), editReply: jest.fn(), followUp: jest.fn(), reply: jest.fn(), ...extra
});
const gifRounds = interaction => interaction.editReply.mock.calls
    .map(([payload]) => payload.files?.[0]?.attachment.toString()).filter(Boolean);
const titles = interaction => interaction.editReply.mock.calls.map(([payload]) => payload.embeds[0].data.title);

let jobs;
let waits;
let stopped;
let ui;

beforeEach(() => {
    jobs = [];
    waits = [];
    stopped = false;
    playback.mockReset().mockImplementation(ms => {
        const wait = { ...deferred(), ms };
        waits.push(wait);
        return wait.promise;
    });
    jest.spyOn(reel, 'renderCaseBatch').mockImplementation((rounds, limit, options) => {
        const job = { ...deferred(), tag: rounds[0].result.tag, limit, options };
        jobs.push(job);
        return job.promise;
    });
    jest.spyOn(battle, 'markResultPublished').mockResolvedValue();
    ui = createBattleUi({ rollDrop: jest.fn(), dropName: drop => drop.tag,
        dropImage: jest.fn(), showResult: jest.fn(), shuttingDown: () => stopped,
        reelRound: (_item, drop) => ({ cards: [{ mystery: drop.gold }], selectedIndex: 0, result: drop }) });
});

afterEach(() => { jest.restoreAllMocks(); });

function startRooms(...rooms) {
    const saved = new Map(rooms.map(item => [item.id, item]));
    jest.spyOn(battle, 'actOnRoom').mockImplementation(async (_guild, _channel, id) => ({ room: saved.get(id), started: true }));
    jest.spyOn(battle, 'readRoom').mockImplementation(async (_guild, _channel, id) => saved.get(id));
    return rooms.map(item => {
        const interaction = request(item.id);
        return { interaction, done: ui.handle(interaction) };
    });
}

test('two rooms progress independently, prefetch only one next round and deduplicate active playback', async () => {
    const [a, b] = startRooms(room('A'), room('B'));
    await flush();
    expect(jobs.map(job => job.tag)).toEqual(['A1', 'B1']);
    jobs.find(job => job.tag === 'B1').resolve(gif('B1'));
    await flush();
    expect(gifRounds(a.interaction)).toEqual([]);
    expect(gifRounds(b.interaction)).toEqual(['B1']);
    expect(jobs.map(job => job.tag)).toEqual(['A1', 'B1', 'B2']);
    jobs.find(job => job.tag === 'B2').resolve(gif('B2'));
    await flush();
    expect(jobs).toHaveLength(3);
    const duplicate = request('B', 'refresh');
    await ui.handle(duplicate);
    expect(duplicate.reply).toHaveBeenCalled();
    expect(battle.actOnRoom).toHaveBeenCalledTimes(2);
    expect(jobs).toHaveLength(3);

    jobs.find(job => job.tag === 'A1').resolve(gif('A1'));
    await flush();
    expect(jobs.map(job => job.tag)).toEqual(['A1', 'B1', 'B2', 'A2']);
    waits[0].resolve(); // B advances while A keeps playing its first round.
    await flush();
    expect(gifRounds(b.interaction)).toEqual(['B1', 'B2']);
    expect(gifRounds(a.interaction)).toEqual(['A1']);
    expect(jobs.map(job => job.tag)).toEqual(['A1', 'B1', 'B2', 'A2', 'B3']);
    jobs.find(job => job.tag === 'A2').resolve(gif('A2'));
    jobs.find(job => job.tag === 'B3').resolve(gif('B3'));
    waits[1].resolve();
    await flush();
    expect(jobs.map(job => job.tag)).toEqual(['A1', 'B1', 'B2', 'A2', 'B3', 'A3']);
    jobs.find(job => job.tag === 'A3').resolve(gif('A3'));
    waits[2].resolve();
    waits[3].resolve();
    await flush();
    waits[4].resolve();
    waits[5].resolve();
    await Promise.all([a.done, b.done]);
    expect(gifRounds(a.interaction)).toEqual(['A1', 'A2', 'A3']);
    expect(gifRounds(b.interaction)).toEqual(['B1', 'B2', 'B3']);
    for (const entry of [a, b]) {
        expect(titles(entry.interaction).at(-1)).toBe('🏆 Kết quả Case Battle');
        expect(entry.interaction.editReply).toHaveBeenCalledTimes(5); // loading + 3 GIFs + result
    }
    expect(jobs.every(job => job.options.profile === 'battle')).toBe(true);
    expect(battle.markResultPublished).toHaveBeenCalledTimes(2);
    const refreshed = request('B', 'refresh');
    await ui.handle(refreshed);
    expect(titles(refreshed)).toEqual(['🏆 Kết quả Case Battle']);
    expect(jobs).toHaveLength(6);
});

test('a revealing Battle keeps rewards pending until the last round finishes', async () => {
    const pending = room('pending', 2);
    pending.status = 'revealing';
    const finished = { ...pending, status: 'finished' };
    const [run] = startRooms(pending);
    jest.spyOn(battle, 'completeReveal').mockResolvedValue({ room: finished, completed: true });

    await flush();
    jobs[0].resolve(gif('pending1'));
    await flush();
    expect(battle.completeReveal).not.toHaveBeenCalled();
    expect(titles(run.interaction)).not.toContain('🏆 Kết quả Case Battle');

    waits[0].resolve();
    await flush();
    expect(battle.completeReveal).not.toHaveBeenCalled();
    jobs.find(job => job.tag === 'pending2').resolve(gif('pending2'));
    await flush();
    expect(battle.completeReveal).not.toHaveBeenCalled();

    waits[1].resolve();
    await run.done;
    expect(battle.completeReveal).toHaveBeenCalledTimes(1);
    expect(titles(run.interaction).at(-1)).toBe('🏆 Kết quả Case Battle');
});

test('startup recovery replays every pending round before applying rewards', async () => {
    const pending = room('recovery', 2);
    pending.status = 'revealing';
    const finished = { ...pending, status: 'finished' };
    let published = false;
    jest.spyOn(battle, 'pendingResults').mockImplementation(async () => published ? [] : [pending]);
    jest.spyOn(battle, 'completeReveal').mockResolvedValue({ room: finished, completed: true });
    jest.spyOn(battle, 'markResultPublished').mockImplementation(async () => { published = true; return null; });
    jest.spyOn(battle, 'pendingResultDeletions').mockResolvedValue([]);
    const edit = jest.fn().mockResolvedValue({});
    const channel = { messages: { edit } };
    const guild = { id: '1', channels: { fetch: jest.fn().mockResolvedValue(channel) } };

    const restoring = ui.restoreResults(guild);
    await flush();
    expect(edit).toHaveBeenCalledTimes(1);
    expect(battle.completeReveal).not.toHaveBeenCalled();
    expect(jobs.map(job => job.tag)).toEqual(['recovery1']);

    jobs[0].resolve(gif('recovery1'));
    await flush();
    expect(battle.completeReveal).not.toHaveBeenCalled();
    expect(waits[0].ms).toBe(reel.REEL_PLAYBACK_MS);
    waits[0].resolve();
    await flush();

    expect(jobs.map(job => job.tag)).toEqual(['recovery1', 'recovery2']);
    jobs[1].resolve(gif('recovery2'));
    await flush();
    expect(battle.completeReveal).not.toHaveBeenCalled();
    waits[1].resolve();
    await restoring;

    expect(battle.completeReveal).toHaveBeenCalledTimes(1);
    expect(edit.mock.calls.at(-1)[1].embeds[0].data.title).toBe('🏆 Kết quả Case Battle');
    expect(battle.markResultPublished).toHaveBeenCalledWith('1', 'recovery', 'message-recovery');
});

test('a failed prefetched render falls back for that round and preserves later rounds and gold playback', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const [run] = startRooms(room('A', 3, true));
    await flush();
    jobs[0].resolve(gif('A1'));
    await flush();
    expect(waits[0].ms).toBe(reel.RARE_REEL_PLAYBACK_MS);
    jobs[1].reject(new Error('FFmpeg unavailable'));
    await flush(); // Rejection is caught while the previous GIF is still playing.
    waits[0].resolve();
    await flush();
    expect(jobs.map(job => job.tag)).toEqual(['A1', 'A2', 'A3']);
    expect(titles(run.interaction).some(title => title.startsWith('⚔️ Vòng 2/3'))).toBe(true);
    jobs[2].resolve(gif('A3'));
    await flush();
    waits[1].resolve();
    await run.done;
    expect(gifRounds(run.interaction)).toEqual(['A1', 'A3']);
    expect(titles(run.interaction).at(-1)).toBe('🏆 Kết quả Case Battle');
    expect(battle.markResultPublished).toHaveBeenCalledTimes(1);
});

test('shutdown stops future rounds, publishes the saved result and safely catches pending rendering', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const [run] = startRooms(room('A', 50));
    await flush();
    jobs[0].resolve(gif('A1'));
    await flush();
    expect(jobs.map(job => job.tag)).toEqual(['A1', 'A2']);
    stopped = true;
    waits[0].resolve();
    await run.done;
    expect(jobs).toHaveLength(2);
    expect(gifRounds(run.interaction)).toEqual(['A1']);
    expect(titles(run.interaction).at(-1)).toBe('🏆 Kết quả Case Battle');
    expect(battle.markResultPublished).toHaveBeenCalledTimes(1);
    jobs[1].reject(new Error('Renderer stopped after UI shutdown'));
    await flush();
    expect(console.warn).toHaveBeenCalledWith('Lỗi tạo hoạt ảnh vòng Case Battle:', 'Renderer stopped after UI shutdown');
});
