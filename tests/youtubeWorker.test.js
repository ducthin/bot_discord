jest.mock('worker_threads', () => ({ Worker: jest.fn() }));
jest.mock('yt-dlp-exec', () => jest.fn());

const { EventEmitter } = require('events');
const { Worker } = require('worker_threads');
const ytdlp = require('yt-dlp-exec');
const { searchYoutube, searchPlaylist, getVideoInfo, getPlaylistVideos } = require('../utils/youtubeUtils');
const metrics = require('../utils/performanceMetrics');

let workers;

beforeEach(() => {
    jest.clearAllMocks();
    workers = [];
    Worker.mockImplementation((_file, { workerData }) => {
        const worker = new EventEmitter();
        worker.workerData = workerData;
        worker.terminate = jest.fn().mockResolvedValue(0);
        workers.push(worker);
        return worker;
    });
});

afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
});

const finishEmpty = worker => worker.emit('message', { success: true, result: { videos: [] } });
const playlistLookup = id => getPlaylistVideos(`https://youtube.com/playlist?list=PL${id}`);
const flush = async () => { for (let index = 0; index < 10; index++) await Promise.resolve(); };

test('concurrent video and playlist searches share one worker and return independent song objects', async () => {
    const oneSong = searchYoutube('same query');
    const moreSongs = searchYoutube('same query', 5);
    const playlist = searchPlaylist('same query');
    expect(workers).toHaveLength(1);
    workers[0].emit('message', { success: true, result: {
        videos: [{ title: 'Track', videoId: 'dQw4w9WgXcQ', duration: { seconds: 214 } }],
        playlists: [{ title: 'Playlist' }]
    } });
    const [first, several, list] = await Promise.all([oneSong, moreSongs, playlist]);
    expect(first.duration).toBe('3:34');
    first.requester = 'alice';
    expect(several[0].requester).toBeUndefined();
    expect(list.title).toBe('Playlist');
    expect(workers[0].terminate).toHaveBeenCalledTimes(1);

    const next = searchYoutube('same query');
    expect(workers).toHaveLength(2);
    workers[1].emit('message', { success: true, result: { videos: [] } });
    await expect(next).resolves.toBeNull();
});

test.each(['shorts', 'live', 'embed'])('video info resolves YouTube /%s URLs', async route => {
    const info = getVideoInfo(`https://www.youtube.com/${route}/dQw4w9WgXcQ`);
    expect(Worker).toHaveBeenCalledWith(expect.any(String), { workerData: { options: { videoId: 'dQw4w9WgXcQ' } } });
    workers[0].emit('message', { success: true, result: { title: 'Track', seconds: 214 } });
    await expect(info).resolves.toMatchObject({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', duration: '3:34' });
});

test.each([
    'https://www.youtube.com/watch?v=dQw4w9WgXcQextra',
    'https://www.youtube.com/@channel',
    'https://example.com/watch?v=dQw4w9WgXcQ',
    'not a URL'
])('invalid video URL exits immediately without spawning or retrying: %s', async url => {
    jest.useFakeTimers();
    await expect(getVideoInfo(url)).resolves.toBeNull();
    expect(workers).toHaveLength(0);
    expect(jest.getTimerCount()).toBe(0);
});

test.each(['timeout', 'error', 'exit'])('an unsuccessful worker is terminated and released (%s)', async outcome => {
    jest.useFakeTimers();
    ytdlp.mockRejectedValue(new Error('Unavailable'));
    const pending = getPlaylistVideos('https://youtube.com/playlist?list=PL123');
    await jest.advanceTimersByTimeAsync(0);
    if (outcome === 'timeout') await jest.advanceTimersByTimeAsync(20000);
    else if (outcome === 'error') workers[0].emit('error', new Error('Search failed'));
    else workers[0].emit('exit', 1);
    await expect(pending).resolves.toBeNull();
    expect(workers[0].terminate).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);

    const next = getPlaylistVideos('https://youtube.com/playlist?list=PL123');
    await jest.advanceTimersByTimeAsync(0);
    expect(workers).toHaveLength(2);
    workers[1].emit('message', { success: true, result: { videos: [] } });
    await expect(next).resolves.toBeNull();
});

test('two active workers hold their slots until termination and drain queued requests in FIFO order', async () => {
    jest.useFakeTimers();
    const requests = ['first', 'second', 'third', 'fourth'].map(query => searchYoutube(query));
    expect(workers.map(worker => worker.workerData.query)).toEqual(['first', 'second']);
    let terminated;
    workers[0].terminate.mockImplementation(() => new Promise(resolve => { terminated = resolve; }));
    finishEmpty(workers[0]);
    await expect(requests[0]).resolves.toBeNull();
    expect(workers).toHaveLength(2);
    terminated(0);
    await flush();
    expect(workers.map(worker => worker.workerData.query)).toEqual(['first', 'second', 'third']);
    // Late signals from the stopped worker cannot free a second slot.
    expect(() => workers[0].emit('error', new Error('late error'))).not.toThrow();
    workers[0].emit('exit', 1);
    finishEmpty(workers[0]);
    await flush();
    expect(workers).toHaveLength(3);
    finishEmpty(workers[1]);
    await flush();
    expect(workers[3].workerData.query).toBe('fourth');
    finishEmpty(workers[2]);
    finishEmpty(workers[3]);
    await Promise.all(requests);
    expect(jest.getTimerCount()).toBe(0);
});

test('sixteen queued jobs stay bounded, duplicates still coalesce and admission failures never retry', async () => {
    jest.useFakeTimers();
    const increment = jest.spyOn(metrics, 'increment');
    const active = [searchYoutube('active-one'), searchYoutube('active-two')];
    const queued = Array.from({ length: 16 }, (_, index) => searchYoutube(`queued-${index}`));
    const duplicate = searchPlaylist('queued-0');
    await expect(searchYoutube('overflow')).resolves.toBeNull();
    expect(increment).toHaveBeenCalledWith('youtube.rejected');
    expect(increment).toHaveBeenCalledWith('youtube.coalesced');
    expect(workers).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(await Promise.all([...queued, duplicate])).toEqual(Array(17).fill(null));
    expect(workers).toHaveLength(2);
    expect(jest.getTimerCount()).toBe(2);
    finishEmpty(workers[0]);
    finishEmpty(workers[1]);
    await Promise.all(active);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(workers).toHaveLength(2);
    expect(jest.getTimerCount()).toBe(0);
});

test('draining rechecks the queue deadline when timer callbacks have not run yet', async () => {
    jest.useFakeTimers();
    const first = searchYoutube('deadline-first');
    const second = searchYoutube('deadline-second');
    const queued = searchYoutube('already-expired');
    jest.setSystemTime(Date.now() + 10_001);
    finishEmpty(workers[0]);
    await expect(queued).resolves.toBeNull();
    expect(workers).toHaveLength(2);
    finishEmpty(workers[1]);
    await Promise.all([first, second]);
    expect(jest.getTimerCount()).toBe(0);
});

test('a queued worker receives its full runtime only after admission', async () => {
    jest.useFakeTimers();
    ytdlp.mockRejectedValue(new Error('Unavailable'));
    const first = playlistLookup('runtime1');
    const second = playlistLookup('runtime2');
    const queued = playlistLookup('runtime3');
    let completed = false;
    queued.then(() => { completed = true; });
    await flush();
    await jest.advanceTimersByTimeAsync(9_000);
    finishEmpty(workers[0]);
    await first;
    await flush();
    expect(workers[2].workerData.options.listId).toBe('PLruntime3');
    await jest.advanceTimersByTimeAsync(11_000);
    await expect(second).resolves.toBeNull();
    expect(completed).toBe(false);
    await jest.advanceTimersByTimeAsync(8_999);
    expect(completed).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await expect(queued).resolves.toBeNull();
    expect(workers[2].terminate).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
});

test('constructor failure releases its slot and leaves later jobs and timers usable', async () => {
    jest.useFakeTimers();
    ytdlp.mockRejectedValue(new Error('Unavailable'));
    Worker.mockImplementationOnce(() => { throw new Error('Cannot create thread'); });
    await expect(playlistLookup('constructor')).resolves.toBeNull();
    expect(jest.getTimerCount()).toBe(0);
    const requests = ['healthy1', 'healthy2', 'healthy3'].map(playlistLookup);
    await flush();
    expect(workers).toHaveLength(2);
    workers[0].emit('exit', 1);
    await flush();
    expect(workers[2].workerData.options.listId).toBe('PLhealthy3');
    finishEmpty(workers[1]);
    finishEmpty(workers[2]);
    await Promise.all(requests);
    expect(jest.getTimerCount()).toBe(0);
});

test('failed termination holds a crashed worker slot until exit and ignores late events', async () => {
    jest.useFakeTimers();
    ytdlp.mockRejectedValue(new Error('Unavailable'));
    const first = playlistLookup('crash1');
    const second = playlistLookup('crash2');
    const queued = playlistLookup('crash3');
    await flush();
    workers[0].terminate.mockRejectedValue(new Error('Termination failed'));
    workers[0].emit('error', new Error('Thread crashed'));
    await expect(first).resolves.toBeNull();
    workers[0].emit('error', new Error('Another late error'));
    finishEmpty(workers[0]);
    await flush();
    expect(workers).toHaveLength(2);
    workers[0].emit('exit', 1);
    await flush();
    expect(workers).toHaveLength(3);
    expect(workers[0].terminate).toHaveBeenCalledTimes(1);
    expect(() => workers[0].emit('error', new Error('Stopped error'))).not.toThrow();
    workers[0].emit('exit', 1);
    finishEmpty(workers[1]);
    finishEmpty(workers[2]);
    await Promise.all([second, queued]);
    expect(jest.getTimerCount()).toBe(0);
});

test('network failures retain the existing delayed retry behavior', async () => {
    jest.useFakeTimers();
    const request = searchYoutube('retry-network');
    workers[0].emit('message', { success: false, error: 'ENOTFOUND temporary' });
    await jest.advanceTimersByTimeAsync(1_499);
    expect(workers).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(workers).toHaveLength(2);
    workers[1].emit('message', { success: true, result: { videos: [{ title: 'Recovered', videoId: 'dQw4w9WgXcQ' }] } });
    await expect(request).resolves.toMatchObject({ title: 'Recovered' });
    expect(jest.getTimerCount()).toBe(0);
});

test('coalesced playlists and video info return independent public objects', async () => {
    const lists = [searchPlaylist('cloned-playlists'), searchPlaylist('cloned-playlists')];
    const info = [getVideoInfo('https://youtu.be/dQw4w9WgXcQ'), getVideoInfo('https://youtube.com/watch?v=dQw4w9WgXcQ')];
    expect(workers).toHaveLength(2);
    workers[0].emit('message', { success: true, result: { playlists: [{ title: 'Original playlist' }] } });
    workers[1].emit('message', { success: true, result: { title: 'Original video', seconds: 214 } });
    const [firstList, otherList] = await Promise.all(lists);
    const [firstInfo, otherInfo] = await Promise.all(info);
    firstList.requester = 'one user';
    firstInfo.requester = 'another user';
    expect(otherList).toEqual({ title: 'Original playlist' });
    expect(otherInfo.requester).toBeUndefined();
});
