const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const favorites = require('../commands/favorites');
const nowPlaying = require('../commands/nowplaying');
const store = require('../utils/favoritesStore');
const { initGuildMusicData, musicData } = require('../utils/musicUtils');
const { handleButton, handleStringSelectMenu } = require('../handlers/interactionHandler');
const { MessageFlags } = require('discord.js');

const first = { title: 'Bài A', url: 'https://www.youtube.com/watch?v=abcdefghijk', duration: '3:40' };
const second = { title: 'Bài B', url: 'https://www.youtube.com/watch?v=lmnopqrstuv', duration: '4:00' };
let root;
let disk;

beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-favorites-'));
    disk = store.createFavoritesStore(root);
});

afterEach(async () => {
    jest.restoreAllMocks();
    musicData.clear();
    await fs.rm(root, { recursive: true, force: true });
});

test('favorites persist across store instances and serialize concurrent saves without duplicates', async () => {
    await expect(Promise.all([disk.save('123', first), disk.save('123', first), disk.save('123', second)]))
        .resolves.toEqual(['saved', 'exists', 'saved']);
    const reopened = store.createFavoritesStore(root);
    expect((await reopened.list('123')).map(track => track.title)).toEqual(['Bài B', 'Bài A']);
    expect(await reopened.list('456')).toEqual([]);
    expect(await reopened.remove('123', store.favoriteId(first))).toBe(true);
    expect((await disk.list('123')).map(track => track.title)).toEqual(['Bài B']);
});

test('favorite button saves the displayed track and cannot save the next track from an old panel', async () => {
    jest.spyOn(store, 'save').mockImplementation(disk.save);
    const guildData = initGuildMusicData('music');
    guildData.currentSong = first;
    guildData.queue = [first];
    const listener = {
        guild: { id: 'music' }, guildId: 'music', user: { id: '123' }, isRepliable: () => true,
        reply: jest.fn(), deferReply: jest.fn(), editReply: jest.fn()
    };
    await nowPlaying.execute(listener);
    const buttons = listener.reply.mock.calls[0][0].components[0].toJSON().components;
    const customId = buttons.find(button => button.label.includes('Yêu thích')).custom_id;
    await handleButton({ ...listener, customId });
    guildData.currentSong = second;
    await handleButton({ ...listener, customId });
    expect(store.save).toHaveBeenCalledTimes(1);
    expect((await disk.list('123')).map(track => track.title)).toEqual(['Bài A']);
});

test('the private favorites menu queues only the selected user’s saved track in the same voice room', async () => {
    await disk.save('123', first);
    jest.spyOn(store, 'list').mockImplementation(disk.list);
    const guildData = initGuildMusicData('music');
    guildData.queue = [second];
    guildData.currentSong = second;
    guildData.isPlaying = true;
    guildData.connection = { state: { status: 'ready' }, joinConfig: { channelId: 'voice' } };
    const listener = {
        guild: { id: 'music' }, guildId: 'music', channel: {},
        user: { id: '123', username: 'Listener' }, member: { voice: { channelId: 'voice' } },
        options: { getInteger: () => null, getString: () => null },
        deferReply: jest.fn(), editReply: jest.fn()
    };
    await favorites.execute(listener);
    expect(listener.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    const menu = listener.editReply.mock.calls[0][0].components[0].toJSON().components[0];
    const selection = { ...listener, customId: menu.custom_id, values: [menu.options[0].value] };
    await handleStringSelectMenu({ ...selection, user: { id: '456' } });
    await handleStringSelectMenu({ ...selection, member: { voice: { channelId: 'other' } } });
    expect(guildData.queue).toEqual([second]);
    await handleStringSelectMenu(selection);
    expect(guildData.queue[1]).toEqual(expect.objectContaining({ url: first.url, requesterId: '123' }));
});
