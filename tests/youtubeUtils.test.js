jest.mock('yt-dlp-exec', () => jest.fn());
jest.mock('worker_threads', () => ({ Worker: jest.fn() }));
jest.mock('../utils/musicUtils', () => ({
  enqueueSongs: jest.requireActual('../utils/musicUtils').enqueueSongs,
  initGuildMusicData: jest.fn(),
  createMusicConnection: jest.fn(),
  playMusic: jest.fn()
}));

const ytdlp = require('yt-dlp-exec');
const { Worker } = require('worker_threads');
const { EventEmitter } = require('events');
const music = require('../utils/musicUtils');
const { getPlaylistVideos, isPlaylistUrl, isValidYouTubeUrl } = require('../utils/youtubeUtils');

describe('isValidYouTubeUrl', () => {
  test('returns true for typical video URLs', () => {
    expect(isValidYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
    expect(isValidYouTubeUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
  });

  test('returns true for playlist URLs', () => {
    expect(isValidYouTubeUrl('https://www.youtube.com/playlist?list=PL1234567890')).toBe(true);
    expect(isValidYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890')).toBe(true);
  });

  test('returns false for invalid URLs', () => {
    expect(isValidYouTubeUrl('https://www.google.com')).toBe(false);
    expect(isValidYouTubeUrl('not a url')).toBe(false);
  });
});

describe('YouTube Mix', () => {
  const videoId = 'dQw4w9WgXcQ';
  const listId = 'RD' + videoId;
  const watchUrl = 'https://www.youtube.com/watch?v=' + videoId + '&list=' + listId;

  beforeEach(() => {
    jest.clearAllMocks();
    ytdlp.mockResolvedValue({
      title: 'Sample Mix',
      entries: [
        { id: videoId, title: 'First', duration: 214 },
        { id: '6NXnxTNIWkc', title: 'Second', duration: 293 }
      ]
    });
  });

  test.each([watchUrl, 'https://youtu.be/' + videoId + '?list=' + listId, 'https://www.youtube.com/playlist?list=' + listId])(
    'loads the Mix with a seed video from %s', async url => {
      const data = await getPlaylistVideos(url, 1);
      expect(ytdlp).toHaveBeenCalledWith(watchUrl, expect.objectContaining({ flatPlaylist: true, playlistEnd: 1 }), expect.any(Object));
      expect(data.videos).toEqual([expect.objectContaining({ url: 'https://www.youtube.com/watch?v=' + videoId, duration: '3:34' })]);
    }
  );

  test.each(['play', 'playlist'])('/%s queues the Mix and starts playback', async command => {
    const guildData = { queue: [], isPlaying: false };
    music.initGuildMusicData.mockReturnValue(guildData);
    const interaction = {
      guild: { id: 'test' },
      member: { voice: { channel: {} }, user: { id: 'member', username: 'listener' } },
      options: { getString: () => watchUrl, getInteger: () => 2, getBoolean: () => false },
      deferReply: jest.fn(),
      editReply: jest.fn(),
      reply: jest.fn()
    };
    await require('../commands/' + command).execute(interaction);
    expect(guildData.queue.map(song => song.title)).toEqual(['First', 'Second']);
    expect(music.playMusic).toHaveBeenCalledWith(guildData);
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
  });
});

describe('isPlaylistUrl', () => {
  test('returns true for playlist URLs', () => {
    expect(isPlaylistUrl('https://www.youtube.com/playlist?list=PL1234567890')).toBe(true);
    expect(isPlaylistUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890')).toBe(true);
  });

  test('returns false for video URLs without playlist', () => {
    expect(isPlaylistUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(false);
    expect(isPlaylistUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(false);
  });

  test('returns false for invalid URLs', () => {
    expect(isPlaylistUrl('https://www.google.com')).toBe(false);
    expect(isPlaylistUrl('not a url')).toBe(false);
  });
});

test.each([
  ['play', null, 100, false],
  ['p', 35, 35, true]
])('/%s queues a regular YouTube playlist up to the chosen limit', async (name, limit, expected, next) => {
  const currentSong = { title: 'Already playing' };
  const guildData = { queue: [currentSong, { title: 'Waiting' }], currentSong, isPlaying: true };
  music.initGuildMusicData.mockReturnValue(guildData);
  music.playMusic.mockClear();
  const entries = Array.from({ length: 120 }, (_, index) => ({
    id: String(index).padStart(11, 'A'),
    title: 'Song ' + (index + 1),
    duration: 214
  }));
  ytdlp.mockResolvedValueOnce({ title: 'Playlist', playlist_count: 120, entries });

  const command = name === 'p' ? require('../commands/aliases').p : require('../commands/play');
  const interaction = {
    guild: { id: 'test' },
    member: { voice: { channel: {} }, user: { id: 'member', username: 'listener' } },
    options: {
      getString: () => 'https://www.youtube.com/playlist?list=PL1234567890',
      getInteger: () => limit,
      getBoolean: option => option === 'next' && next
    },
    deferReply: jest.fn(),
    editReply: jest.fn(),
    reply: jest.fn()
  };
  await command.execute(interaction);
  expect(ytdlp).toHaveBeenLastCalledWith('https://www.youtube.com/playlist?list=PL1234567890',
    expect.objectContaining({ flatPlaylist: true, playlistEnd: expected }), expect.any(Object));
  const queuedSongs = Array.from({ length: expected }, (_, i) => 'Song ' + (i + 1));
  expect(guildData.queue.map(song => song.title)).toEqual(next
    ? ['Already playing', ...queuedSongs, 'Waiting']
    : ['Already playing', 'Waiting', ...queuedSongs]);
  expect(music.playMusic).not.toHaveBeenCalled();
  expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
});

test('normal playlist still loads through yt-search if yt-dlp fails', async () => {
  ytdlp.mockRejectedValueOnce(new Error('Extractor unavailable'));
  Worker.mockImplementationOnce(() => {
    const worker = new EventEmitter();
    worker.terminate = jest.fn().mockResolvedValue(0);
    queueMicrotask(() => worker.emit('message', { success: true, result: { title: 'Playlist', size: 30, videos: [
      { videoId: 'dQw4w9WgXcQ', title: 'Available' },
      { videoId: '6NXnxTNIWkc', title: '[Private video]' }
    ] } }));
    return worker;
  });
  const result = await getPlaylistVideos('https://www.youtube.com/playlist?list=PL1234567890', 30);
  expect(result.videoCount).toBe(30);
  expect(result.videos.map(song => song.title)).toEqual(['Available']);
});

test('play next inserts a single video after the active song without interrupting playback', async () => {
  const currentSong = { title: 'Playing' };
  const guildData = { queue: [currentSong, { title: 'Waiting' }], currentSong, isPlaying: true };
  music.initGuildMusicData.mockReturnValue(guildData);
  music.playMusic.mockClear();
  Worker.mockImplementationOnce(() => {
    const worker = new EventEmitter();
    worker.terminate = jest.fn().mockResolvedValue(0);
    queueMicrotask(() => worker.emit('message', { success: true, result: { title: 'Requested', timestamp: '3:34' } }));
    return worker;
  });
  const interaction = {
    guild: { id: 'test' },
    member: { voice: { channel: {} }, user: { id: 'member', username: 'listener' } },
    options: { getString: () => 'https://youtu.be/dQw4w9WgXcQ', getBoolean: () => true },
    deferReply: jest.fn(), editReply: jest.fn()
  };
  await require('../commands/play').execute(interaction);
  expect(guildData.queue.map(song => song.title)).toEqual(['Playing', 'Requested', 'Waiting']);
  expect(music.playMusic).not.toHaveBeenCalled();
  expect(interaction.editReply.mock.calls[0][0].embeds[0].data.fields[0].value).toBe('2');
});

test('a playlist lookup finishing after stop does not restart playback', async () => {
  const guildData = { queue: [], queueEpoch: 0, isPlaying: false };
  music.initGuildMusicData.mockReturnValue(guildData);
  music.createMusicConnection.mockClear();
  let finish;
  ytdlp.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const interaction = {
    guild: { id: 'test' },
    member: { voice: { channel: {} }, user: { id: 'member', username: 'listener' } },
    options: { getString: () => 'https://www.youtube.com/playlist?list=PL1234567890', getInteger: () => null },
    deferReply: jest.fn(), editReply: jest.fn()
  };
  const pending = require('../commands/playlist').execute(interaction);
  await Promise.resolve();
  await jest.requireActual('../utils/musicUtils').stopMusic(guildData);
  finish({ title: 'Playlist', entries: [{ id: 'dQw4w9WgXcQ', title: 'Canceled track' }] });
  await pending;
  expect(music.createMusicConnection).not.toHaveBeenCalled();
  expect(guildData.queue).toEqual([]);
  expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Yêu cầu đã hủy'));
});
