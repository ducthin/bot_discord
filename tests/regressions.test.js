const { PassThrough } = require('stream');
jest.mock('../utils/youtubeUtils', () => ({ getAudioStream: jest.fn() }));
const youtube = require('../utils/youtubeUtils');
const music = require('../utils/musicUtils');
const { playlistPath } = require('../utils/playlistPath');

beforeEach(() => { music.musicData.clear(); jest.clearAllMocks(); });
afterEach(() => { jest.useRealTimers(); });

test.each(['../other/list', '../../../package', '..\\other\\list', 'C:\\config', '/tmp/file', ''])('rejects unsafe playlist name %s', name => {
    expect(() => playlistPath('data/playlists/user', name)).toThrow();
});

test('preserves Vietnamese playlist names', () => {
    expect(playlistPath('data/playlists/user', 'Nhạc buổi tối')).toMatch(/Nhạc buổi tối.json$/);
});

function queuedGuild() {
    const g = music.initGuildMusicData('test');
    g.queue = ['A', 'B', 'C'].map(title => ({ title, url: title }));
    g.currentSong = g.queue[0];
    g.isPlaying = true;
    g.player = { play: jest.fn(), stop: jest.fn() };
    g.connection = { state: { status: 'ready' }, destroy: jest.fn() };
    youtube.getAudioStream.mockImplementation(async () => ({ stream: new PassThrough(), type: 'raw' }));
    return g;
}

test('queue next keeps the playing song at index zero, then plays selected song', async () => {
    const g = queuedGuild();
    await require('../commands/queue').execute({
        guildId: 'test', options: { getString: () => 'next', getInteger: name => name === 'position' ? 3 : null },
        member: { voice: { channel: { id: 'music' } } }, reply: jest.fn()
    });
    expect(g.queue.map(s => s.title)).toEqual(['A', 'C', 'B']);
    await music.handleSongEnd(g);
    expect(g.currentSong.title).toBe('C');
});

test('manual skip bypasses track loop', async () => {
    const g = queuedGuild(); g.loopMode = 'track'; g.isManualSkip = true;
    await music.handleSongEnd(g);
    expect(g.currentSong.title).toBe('B');
});

test.each(['off', 'track', 'queue'])('stop suppresses loop and automatic playback (%s)', async mode => {
    const g = queuedGuild(); g.loopMode = mode; g.autoplay = true; g.autoTrending.enabled = true;
    await music.stopMusic(g);
    await music.handleSongEnd(g);
    expect(g.queue).toEqual([]);
    expect(g.currentSong).toBeNull();
    expect(g.isPlaying).toBe(false);
    expect(youtube.getAudioStream).not.toHaveBeenCalled();
});

test('stop cancels an in-flight audio stream', async () => {
    const g = queuedGuild(); let finish;
    youtube.getAudioStream.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = music.playMusic(g);
    await music.stopMusic(g);
    const stream = new PassThrough(); finish({ stream, type: 'raw' });
    await pending;
    expect(stream.destroyed).toBe(true);
    expect(g.player.play).not.toHaveBeenCalled();
});

test('playback does not open the source before the voice connection is ready', async () => {
    const g = queuedGuild();
    const connection = new (require('events').EventEmitter)();
    connection.state = { status: 'connecting' };
    g.connection = connection;
    const playback = music.playMusic(g);
    expect(youtube.getAudioStream).not.toHaveBeenCalled();
    connection.state = { status: 'ready' };
    connection.emit('ready');
    await expect(playback).resolves.toBe(true);
    expect(youtube.getAudioStream).toHaveBeenCalledWith('A', 0);
    expect(g.player.play).toHaveBeenCalledTimes(1);
});

test('destroyed voice connection preserves the queue and does not start audio', async () => {
    const g = queuedGuild();
    g.connection.state.status = 'destroyed';
    g.textChannel = { send: jest.fn().mockResolvedValue() };
    await expect(music.playMusic(g)).resolves.toBe(false);
    expect(g.queue.map(song => song.title)).toEqual(['A', 'B', 'C']);
    expect(g.connection).toBeNull();
    expect(g.isPlaying).toBe(false);
    expect(youtube.getAudioStream).not.toHaveBeenCalled();
    expect(g.textChannel.send).toHaveBeenCalledWith(expect.stringContaining('Hàng đợi vẫn còn'));
});

test('stop invalidates a scheduled retry', async () => {
    jest.useFakeTimers(); const g = queuedGuild();
    youtube.getAudioStream.mockRejectedValue(new Error('network timeout'));
    await music.playMusic(g);
    await music.stopMusic(g);
    await jest.advanceTimersByTimeAsync(2500);
    expect(youtube.getAudioStream).toHaveBeenCalledTimes(1);
});

test('stats button retains interaction prototype methods', async () => {
    class Interaction {
        async deferUpdate() { this.deferred = true; }
        async editReply(payload) { this.output = payload; }
        isRepliable() { return true; }
    }
    const i = new Interaction(); Object.assign(i, { customId: 'stats_personal', guild: { id: 'test' }, guildId: 'test', user: { id: 'review-test' } });
    await require('../handlers/interactionHandler').handleButton(i);
    expect(i.output.embeds).toHaveLength(1);
});

test('loading a playlist creates the voice connection before playback', async () => {
    const read = jest.spyOn(require('../utils/playlistStore'), 'load').mockResolvedValue({ name: 'demo', songs: [{ title: 'A', url: 'A' }], totalSongs: 1, createdAt: new Date().toISOString() });
    const connect = jest.spyOn(music, 'createMusicConnection').mockImplementation((member, data) => { data.connection = {}; data.player = {}; });
    const play = jest.spyOn(music, 'playMusic').mockImplementation(async data => {
        expect(data.connection).toBeDefined(); expect(data.player).toBeDefined();
    });
    try {
        await require('../commands/playlist-save').loadPlaylist({ options: { getString: () => 'demo' }, guild: { id: 'test' }, member: {}, channel: {}, reply: jest.fn() }, '123');
        expect(connect).toHaveBeenCalledTimes(1);
        expect(play).toHaveBeenCalledTimes(1);
    } finally { read.mockRestore(); connect.mockRestore(); play.mockRestore(); }
});

test('trending more forwards the original button interaction', async () => {
    const command = require('../commands/trending');
    const execute = jest.spyOn(command, 'execute').mockResolvedValue();
    const i = { customId: 'trending_more', guild: { id: 'test' }, member: { voice: { channelId: 'voice' } }, isRepliable: () => true };
    try {
        await require('../handlers/interactionHandler').handleButton(i);
        expect(execute).toHaveBeenCalledWith(i);
    } finally { execute.mockRestore(); }
});

test('outside voice channel cannot stop music using an old button', async () => {
    const g = queuedGuild();
    g.connection.joinConfig = { channelId: 'music' };
    const interaction = { customId: 'music_stop', guild: { id: 'test' }, member: { voice: { channelId: 'other' } }, isRepliable: () => true, reply: jest.fn() };
    await require('../handlers/interactionHandler').handleButton(interaction);
    expect(g.player.stop).not.toHaveBeenCalled();
    expect(g.queue).toHaveLength(3);
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('cùng kênh') }));
});

test('skipto opens the selected song once even when stopping the old song emits Idle', async () => {
    const g = queuedGuild();
    g.player.stop.mockImplementation(() => { void music.handleSongEnd(g); });
    await require('../commands/skipto').execute({ guildId: 'test', options: { getInteger: () => 2 }, member: { voice: { channel: { id: 'voice' } } }, deferReply: jest.fn(), editReply: jest.fn() });
    expect(g.currentSong.title).toBe('B');
    expect(g.queue.map(song => song.title)).toEqual(['B', 'C']);
    expect(youtube.getAudioStream).toHaveBeenCalledTimes(1);
    expect(youtube.getAudioStream).toHaveBeenCalledWith('B', 0);
});

test('server statistics exclude legacy plays without a guild and plays from other guilds', async () => {
    const fs = require('fs').promises;
    const root = await fs.mkdtemp(require('path').join(require('os').tmpdir(), 'discord-history-'));
    const store = require('../utils/historyStore').createHistoryStore(root);
    try {
        await fs.writeFile(require('path').join(root, '123.json'), JSON.stringify([{ title: 'Legacy' }]));
        await Promise.all([
            store.addToHistory('123', { title: 'Local', url: 'A' }, 'local'),
            store.addToHistory('123', { title: 'Other', url: 'B' }, 'other')
        ]);
        expect((await store.readUserHistory('123')).map(song => song.title)).toEqual(['Legacy', 'Local', 'Other']);
        const server = await store.readServerHistory('local');
        expect(require('../commands/stats').calculateTopSongs(server)).toEqual([{ title: 'Local', count: 1, uniqueUsers: 1 }]);
        expect(await store.clearUserHistory('123')).toBe(true);
        expect(await store.readUserHistory('123')).toEqual([]);
    } finally { await fs.rmdir(require('path').join(root, '123')).catch(() => {}); await fs.rmdir(root).catch(() => {}); }
});

test('queue move and remove preserve the active song', async () => {
    const g = queuedGuild();
    g.queue.push({ title: 'D' });
    const command = require('../commands/queue');
    const interaction = { member: { voice: { channelId: 'voice' } }, reply: jest.fn() };
    await command.editQueue(interaction, g, 'move', 4, 2);
    await command.editQueue(interaction, g, 'remove', 3);
    await command.editQueue(interaction, g, 'remove', 1);
    expect(g.queue.map(song => song.title)).toEqual(['A', 'D', 'C']);
    expect(g.player.stop).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenLastCalledWith(expect.objectContaining({ content: expect.stringContaining('Bài đang phát') }));
});

test('queue select uses the displayed song rather than a stale position', async () => {
    const g = queuedGuild();
    const [a, b, c] = g.queue;
    const queue = require('../commands/queue');
    const viewer = { guild: { id: 'test' }, user: { id: 'viewer' }, member: { voice: { channelId: 'voice' } }, reply: jest.fn() };
    await queue.show(viewer, g);
    const menu = viewer.reply.mock.calls[0][0].components[1].toJSON().components[0];
    await queue.show({ ...viewer, user: { id: 'other' }, reply: jest.fn() }, g);

    g.queue = [a, c, b];
    await require('../handlers/interactionHandler').handleStringSelectMenu({
        ...viewer, customId: menu.custom_id, values: [menu.options[0].value]
    });
    expect(g.queue.map(song => song.title)).toEqual(['A', 'B', 'C']);
});

test('queue buttons browse a long playlist and select a song on the last page', async () => {
    const g = queuedGuild();
    g.queue.push(...Array.from({ length: 20 }, (_, i) => ({ title: 'Bài ' + (i + 4) })));
    const { handleButton, handleStringSelectMenu } = require('../handlers/interactionHandler');
    const viewer = {
        guild: { id: 'test' }, user: { id: 'viewer' }, member: { voice: {} },
        reply: jest.fn(), update: jest.fn(), isRepliable: () => true
    };
    await handleButton({ ...viewer, customId: 'show_queue' });
    const firstPage = viewer.reply.mock.calls[0][0];
    expect(firstPage.components).toHaveLength(1);
    expect(firstPage.embeds[0].toJSON().footer.text).toContain('Trang 1/3 · 23 bài');

    const pageTwoId = firstPage.components[0].toJSON().components[2].custom_id;
    await handleButton({ ...viewer, customId: pageTwoId });
    const secondPage = viewer.update.mock.calls[0][0];
    expect(secondPage.embeds[0].toJSON().description).toContain('**#11** Bài 11');
    const pageThreeId = secondPage.components[0].toJSON().components[2].custom_id;

    const listener = { ...viewer, member: { voice: { channelId: 'voice' } } };
    await handleButton({ ...listener, customId: pageThreeId });
    const lastPage = viewer.update.mock.calls[1][0];
    expect(lastPage.components[0].toJSON().components[2].disabled).toBe(true);
    const menu = lastPage.components[1].toJSON().components[0];
    expect(menu.options.map(option => option.label)).toEqual(['#21 · Bài 21', '#22 · Bài 22', '#23 · Bài 23']);
    await handleStringSelectMenu({ ...listener, customId: menu.custom_id, values: [menu.options[2].value] });
    expect(g.queue.slice(0, 3).map(song => song.title)).toEqual(['A', 'Bài 23', 'B']);
});

test('the playback card shows current settings and the toggle requires the same voice room', async () => {
    const g = queuedGuild();
    g.volume = 0;
    g.loopMode = 'track';
    g.currentSong.duration = '10:00';
    g.connection.joinConfig = { channelId: 'voice' };
    g.player.state = { status: 'paused' };
    g.player.unpause = jest.fn(() => true);
    const { handleButton } = require('../handlers/interactionHandler');
    const viewer = { guild: { id: 'test' }, reply: jest.fn(), isRepliable: () => true };
    await require('../commands/nowplaying').execute(viewer);
    const payload = viewer.reply.mock.calls[0][0];
    const card = payload.embeds[0].toJSON();
    expect(card.author.name).toContain('Đang tạm dừng');
    expect(card.fields.map(field => field.value)).toEqual(['0%', 'Một bài', 'Không rõ', 'B']);
    const toggle = payload.components[0].toJSON().components[0].custom_id;
    await handleButton({ ...viewer, customId: toggle, member: { voice: { channelId: 'other' } } });
    expect(g.player.unpause).not.toHaveBeenCalled();
    const listener = { ...viewer, member: { voice: { channelId: 'voice' } } };
    await handleButton({ ...listener, customId: toggle });
    expect(g.player.unpause).toHaveBeenCalledTimes(1);
    await handleButton({ ...listener, customId: 'volume_up' });
    expect(g.volume).toBe(10);
});

test('the automatic playback card keeps updating after five minutes and stops updating on stop', async () => {
    jest.useFakeTimers();
    const g = queuedGuild();
    g.currentSong.duration = '10:00';
    g.player.state = { status: 'playing' };
    const message = { edit: jest.fn().mockResolvedValue(), delete: jest.fn().mockResolvedValue() };
    g.textChannel = { send: jest.fn().mockResolvedValue(message) };
    await music.playMusic(g);
    await jest.advanceTimersByTimeAsync(300000);
    expect(message.edit).not.toHaveBeenCalled();

    g.audioResource.playbackDuration = 301000;
    await jest.advanceTimersByTimeAsync(12000);
    expect(message.edit.mock.calls[0][0].embeds[0].toJSON().description).toContain('05:01 / 10:00');
    await music.stopMusic(g);
    await jest.advanceTimersByTimeAsync(12000);
    expect(message.edit).toHaveBeenCalledTimes(1);
    expect(message.delete).toHaveBeenCalledTimes(1);
});

test('finishing a track deletes its playback card, including the last track in the queue', async () => {
    const g = queuedGuild();
    g.queue.pop();
    const first = { delete: jest.fn().mockResolvedValue() };
    const second = { delete: jest.fn().mockResolvedValue() };
    g.textChannel = { send: jest.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second) };

    await music.playMusic(g);
    await music.handleSongEnd(g);
    expect(first.delete).toHaveBeenCalledTimes(1);
    expect(second.delete).not.toHaveBeenCalled();
    expect(g.currentMessage).toBe(second);

    await music.handleSongEnd(g);
    expect(second.delete).toHaveBeenCalledTimes(1);
    expect(g.currentMessage).toBeNull();
    expect(g.progressInterval).toBeNull();
});

test('seeking updates the current playback card in place', async () => {
    const g = queuedGuild();
    const message = { edit: jest.fn(), delete: jest.fn().mockResolvedValue() };
    message.edit.mockResolvedValue(message);
    g.textChannel = { send: jest.fn().mockResolvedValue(message) };

    await music.playMusic(g);
    await expect(music.seekMusic(g, 30)).resolves.toBe(true);
    expect(g.textChannel.send).toHaveBeenCalledTimes(1);
    expect(message.edit).toHaveBeenCalledTimes(1);
    expect(message.delete).not.toHaveBeenCalled();
    await music.stopMusic(g);
});

test('stop deletes a playback card whose send finishes after playback stops', async () => {
    jest.useFakeTimers();
    const g = queuedGuild();
    const message = { delete: jest.fn().mockResolvedValue() };
    let finishSend;
    const sent = new Promise(resolve => { finishSend = resolve; });
    g.textChannel = { send: jest.fn().mockReturnValue(sent) };

    const playing = music.playMusic(g);
    await jest.advanceTimersByTimeAsync(0);
    expect(g.textChannel.send).toHaveBeenCalledTimes(1);
    await music.stopMusic(g);
    finishSend(message);
    await playing;

    expect(message.delete).toHaveBeenCalledTimes(1);
    expect(g.currentMessage).toBeNull();
});

function skipRoom(guildData, numberOfListeners) {
    const channel = { id: 'music', members: new Map() };
    const guild = { id: 'test', roles: { cache: new Map() } };
    guildData.connection.joinConfig = { channelId: channel.id };
    guildData.player.stop.mockReturnValue(true);
    const listeners = Array.from({ length: numberOfListeners }, (_, i) => ({
        id: String(i), user: { bot: false }, guild, voice: { channel, channelId: channel.id }, roles: { cache: new Map() }
    }));
    for (const listener of listeners) channel.members.set(listener.id, listener);
    channel.members.set('bot', { id: 'bot', user: { bot: true } });
    return { channel, guild, listeners };
}

test('skip button and slash command share a vote, ignore bots and reject duplicates', async () => {
    const g = queuedGuild();
    const { guild, listeners } = skipRoom(g, 3);
    const reply = jest.fn();
    const { handleButton } = require('../handlers/interactionHandler');
    const skip = require('../commands/skip');
    await handleButton({ customId: 'music_skip', guild, member: listeners[0], isRepliable: () => true, reply });
    expect(reply).toHaveBeenLastCalledWith(expect.objectContaining({ content: expect.stringContaining('1/2') }));
    await skip.execute({ guildId: 'test', member: listeners[0], reply });
    expect(reply).toHaveBeenLastCalledWith(expect.objectContaining({ content: expect.stringContaining('đã bỏ phiếu') }));
    expect(g.player.stop).not.toHaveBeenCalled();
    await skip.execute({ guildId: 'test', member: listeners[1], reply });
    expect(reply).toHaveBeenLastCalledWith(expect.objectContaining({ content: expect.stringContaining('2/2') }));
    expect(g.player.stop).toHaveBeenCalledTimes(1);

    // A pending click cannot skip the same song again during the transition.
    await skip.execute({ guildId: 'test', member: listeners[2], reply });
    expect(g.player.stop).toHaveBeenCalledTimes(1);
    await music.handleSongEnd(g);
    await skip.execute({ guildId: 'test', member: listeners[2], reply });
    expect(reply).toHaveBeenLastCalledWith(expect.objectContaining({ content: expect.stringContaining('1/2') }));
});

test('a departed listener vote stops counting and the majority uses the current room size', () => {
    const g = queuedGuild();
    const { channel, listeners } = skipRoom(g, 4);
    const { requestSkip } = require('../utils/skipVote');
    expect(requestSkip(listeners[0], g).content).toContain('1/3');
    channel.members.delete(listeners[0].id);
    expect(requestSkip(listeners[1], g).content).toContain('1/2');
    expect(g.player.stop).not.toHaveBeenCalled();
    expect(requestSkip(listeners[2], g).content).toContain('2/2');
    expect(g.player.stop).toHaveBeenCalledTimes(1);
});

test('a configured DJ can skip immediately in a crowded room', () => {
    const g = queuedGuild();
    const { guild, listeners } = skipRoom(g, 5);
    const env = process.env.DJ_ROLE_IDS;
    process.env.DJ_ROLE_IDS = '1234, 5678';
    try {
        const role = { id: '5678', name: 'DJ phòng nhạc' };
        guild.roles.cache.set(role.id, role);
        listeners[0].roles.cache.set(role.id, role);
        const { requestSkip } = require('../utils/skipVote');
        expect(requestSkip(listeners[0], g).content).toMatch(/Đã bỏ qua/);
        expect(g.player.stop).toHaveBeenCalledTimes(1);
    } finally {
        if (env === undefined) delete process.env.DJ_ROLE_IDS;
        else process.env.DJ_ROLE_IDS = env;
    }
});
