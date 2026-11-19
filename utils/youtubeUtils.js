// Strategy:
//  - yt-search    → Search & Video Info (stable, no Innertube API bug)
//  - yt-dlp-exec  → Audio Stream (most reliable, constantly updated to bypass YouTube bot detection)

const { Worker } = require('worker_threads');
const path = require('path');
const { PassThrough } = require('stream');
const { StreamType } = require('@discordjs/voice');
const dns = require('dns');
const metrics = require('./performanceMetrics');
const MAX_PLAYLIST_TRACKS = 100;
const SEARCH_WORKERS = 2;
const SEARCH_QUEUE_LIMIT = 16;
const SEARCH_QUEUE_WAIT_MS = 10_000;
const SEARCH_RUNTIME_MS = 20_000;
const pendingSearches = new Map();
const searchQueue = [];
let activeSearchWorkers = 0;
let drainingSearchQueue = false;

// ── DNS Fallback ───────────────────────────────────────────────────────────────
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1', '1.0.0.1']);

// ── Retry với exponential backoff ─────────────────────────────────────────────
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1500) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            if (error.retryable === false || attempt === maxRetries - 1) throw error;
            const delay = baseDelay * Math.pow(2, attempt);
            console.log(`🔄 Retry ${attempt + 1}/${maxRetries} sau ${delay}ms... (${error.message})`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// ── Format giây → MM:SS hoặc HH:MM:SS ────────────────────────────────────────
function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

// ── Normalize YouTube URL ──────────────────────────────────────────────────────
function normalizeYouTubeUrl(url) {
    const videoId = getVideoId(url);
    return videoId ? `https://www.youtube.com/watch?v=${videoId}` : url;
}

function getVideoId(input) {
    const url = parseYouTubeUrl(input);
    if (!url) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const id = url.hostname.endsWith('youtu.be') ? parts[0]
        : parts[0] === 'watch' ? url.searchParams.get('v')
            : ['shorts', 'live', 'embed'].includes(parts[0]) ? parts[1] : null;
    return id && /^[\w-]{11}$/.test(id) ? id : null;
}

// ── Map yt-search result → format chuẩn của bot ───────────────────────────────
function mapYtsVideo(video) {
    // Luôn dùng videoId để tạo URL chuẩn
    const url = video.videoId
        ? `https://www.youtube.com/watch?v=${video.videoId}`
        : normalizeYouTubeUrl(video.url || '');

    let durationStr = '0:00';
    if (video.duration) {
        if (typeof video.duration === 'string') {
            durationStr = video.duration;
        } else if (typeof video.duration === 'object') {
            durationStr = video.duration.timestamp || formatDuration(video.duration.seconds || 0);
        }
    } else if (video.timestamp) {
        durationStr = video.timestamp;
    } else if (video.seconds) {
        durationStr = formatDuration(video.seconds);
    }

    return {
        title: video.title || 'Unknown',
        url,
        duration: durationStr,
        thumbnail: video.thumbnail || video.image || null
    };
}

const ignoreWorkerError = () => {};

function queueError(message, code) {
    return Object.assign(new Error(message), { code, retryable: false });
}

function expireSearch(job) {
    const index = searchQueue.indexOf(job);
    if (index < 0) return;
    searchQueue.splice(index, 1);
    clearTimeout(job.queueTimer);
    job.admitted(false);
    metrics.increment('youtube.timeout');
    job.reject(queueError('YouTube search queue timeout', 'YOUTUBE_QUEUE_TIMEOUT'));
}

function startSearch(job) {
    clearTimeout(job.queueTimer);
    job.admitted(true);
    activeSearchWorkers++;
    const running = metrics.measure('youtube.worker', () => new Promise((resolve, reject) => {
        let worker;
        let timer;
        let settled = false;
        let released = false;
        let terminationStarted = false;
        let exited = false;
        const terminate = () => {
            if (!worker || terminationStarted) return;
            terminationStarted = true;
            try { Promise.resolve(worker.terminate()).then(release, () => {}); } catch {}
        };
        const release = () => {
            if (released) return;
            released = true;
            clearTimeout(timer);
            if (worker) {
                worker.removeListener('message', onMessage);
                worker.removeListener('error', onError);
                worker.removeListener('exit', onExit);
                // Late errors must remain handled without retaining this job.
                worker.on('error', ignoreWorkerError);
            }
            activeSearchWorkers--;
            drainSearchQueue();
        };
        const finish = (error, result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (error) reject(error);
            else resolve(result);
            if (!worker || exited) return release();
            worker.removeListener('message', onMessage);
            // A reply does not prove the thread stopped. Hold its slot until
            // terminate completes or exit confirms there is no live worker.
            terminate();
        };
        const onMessage = message => finish(message?.success ? null : new Error(message?.error || 'YouTube worker failed'), message?.result);
        const onError = error => finish(error);
        const onExit = code => {
            exited = true;
            finish(new Error(`Worker stopped before replying (exit code ${code})`));
            // Run termination cleanup once even when exit arrives first.
            terminate();
            release();
        };
        try {
            worker = new Worker(path.join(__dirname, 'searchWorker.js'), { workerData: job.workerData });
            worker.once('message', onMessage);
            worker.on('error', onError);
            worker.once('exit', onExit);
            timer = setTimeout(() => {
                metrics.increment('youtube.timeout');
                finish(new Error('YouTube search timeout'));
            }, SEARCH_RUNTIME_MS);
        } catch (error) { finish(error); }
    }));
    running.then(job.resolve, job.reject);
}

function drainSearchQueue() {
    if (drainingSearchQueue) return;
    drainingSearchQueue = true;
    try {
        while (searchQueue.length && activeSearchWorkers < SEARCH_WORKERS) {
            const job = searchQueue[0];
            // Timers can run late while the event loop is busy.
            if (job.deadline <= Date.now()) { expireSearch(job); continue; }
            searchQueue.shift();
            startSearch(job);
        }
    } finally { drainingSearchQueue = false; }
}

// Search and video/playlist info share a bounded FIFO pool, including queued work.
function runSearchWorker(workerData) {
    return metrics.measure('youtube.search', () => {
        const key = JSON.stringify(workerData);
        if (pendingSearches.has(key)) {
            metrics.increment('youtube.coalesced');
            return pendingSearches.get(key);
        }
        if (searchQueue.length >= SEARCH_QUEUE_LIMIT) {
            metrics.increment('youtube.rejected');
            return Promise.reject(queueError('YouTube search queue is full', 'YOUTUBE_QUEUE_FULL'));
        }
        const job = { workerData, deadline: Date.now() + SEARCH_QUEUE_WAIT_MS };
        const pending = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; })
            .finally(() => { if (pendingSearches.get(key) === pending) pendingSearches.delete(key); });
        pendingSearches.set(key, pending);
        // This promise only resolves; rejection belongs to the public job above.
        metrics.measure('youtube.queue', () => new Promise(resolve => { job.admitted = resolve; }));
        job.queueTimer = setTimeout(() => { expireSearch(job); drainSearchQueue(); }, SEARCH_QUEUE_WAIT_MS);
        searchQueue.push(job);
        drainSearchQueue();
        return pending;
    });
}

// ── Tìm kiếm YouTube (dùng yt-search chạy trong Worker Thread) ────────────────
async function searchYoutube(query, limit = 1) {
    try {
        return await retryWithBackoff(async () => {
            console.log(`🔍 Tìm kiếm: "${query}"`);

            const result = await runSearchWorker({ query });
            const videos = result.videos;

            if (!videos || videos.length === 0) {
                console.log('⚠️ Không tìm thấy kết quả');
                return null;
            }

            console.log(`✅ Tìm thấy: ${videos[0].title}`);

            const limited = videos.slice(0, Math.min(limit, 10));
            if (limit === 1) return mapYtsVideo(limited[0]);
            return limited.map(mapYtsVideo);
        }, 3, 1500);

    } catch (error) {
        console.error('❌ Lỗi tìm kiếm YouTube:', error.message);

        if (error.message?.includes('ENOTFOUND') || error.message?.includes('fetch failed') || error.message?.includes('ECONNRESET')) {
            console.log('🎵 DNS lỗi → dùng fallback playlist');
            try {
                const { searchFallback } = require('./fallbackPlaylist');
                return searchFallback(query);
            } catch {
                return null;
            }
        }
        return null;
    }
}

// ── Lấy thông tin video từ URL (dùng yt-search chạy trong Worker Thread) ───────
async function getVideoInfo(url) {
    const videoId = getVideoId(url);
    if (!videoId) return null;
    try {
        return await retryWithBackoff(async () => {
            console.log(`📋 Lấy thông tin: ${url}`);

            const result = await runSearchWorker({ options: { videoId } });
            if (!result || !result.title) throw new Error('Không tìm thấy video');

            return {
                title: result.title,
                url: `https://www.youtube.com/watch?v=${videoId}`,
                duration: result.timestamp || formatDuration(result.seconds || 0),
                thumbnail: result.thumbnail || result.image || null
            };
        }, 3, 2000);

    } catch (error) {
        console.error('❌ Lỗi lấy thông tin video:', error.message);
        return null;
    }
}

// ── Lấy audio stream dùng yt-dlp + ffmpeg (RELIABLE) ────────────────────────
async function getAudioStream(url, startTime = 0) {
    const ytdlp = require('yt-dlp-exec');
    const ffmpegPath = require('ffmpeg-static');
    const { spawn } = require('child_process');
    const normalizedUrl = normalizeYouTubeUrl(url);

    console.log(`🎵 Lấy stream URL từ yt-dlp: ${normalizedUrl}`);

    // Bước 1: yt-dlp lấy URL trực tiếp (bypass YouTube bot detection)
    const rawOutput = await ytdlp(normalizedUrl, {
        format: 'bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio/best',
        getUrl: true,
        noPlaylist: true,
        quiet: true,
        noWarnings: true,
        noCheckCertificates: true
    }, { timeout: 35000 });

    const streamUrl = rawOutput.trim().split('\n')[0].trim();
    if (!streamUrl || !streamUrl.startsWith('http')) {
        throw new Error(`URL không hợp lệ từ yt-dlp: "${streamUrl?.substring(0, 80)}"`);
    }

    if (!ffmpegPath) {
        throw new Error('ffmpeg-static không tìm thấy, hãy chạy: npm install ffmpeg-static');
    }

    console.log(`✅ Stream URL đã lấy, đang mở ffmpeg... (Tua: ${startTime}s)`);

    // Bước 2: ffmpeg tải và convert sang raw PCM s16le 48kHz stereo
    const ffmpegArgs = [
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5'
    ];

    if (startTime > 0) {
        ffmpegArgs.push('-ss', String(startTime));
    }

    ffmpegArgs.push(
        '-i', streamUrl,
        '-analyzeduration', '0',
        '-loglevel', 'error',
        '-f', 's16le',         // raw PCM
        '-ar', '48000',        // 48kHz (Discord format)
        '-ac', '2',            // stereo
        '-vn',                 // no video
        'pipe:1'               // output to stdout
    );

    const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const pcm = new PassThrough();
    let stderr = '';
    let started = false;
    ffmpegProcess.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2048); });
    ffmpegProcess.once('error', error => pcm.destroy(error));
    ffmpegProcess.stdout.once('error', error => pcm.destroy(error));
    ffmpegProcess.once('close', code => {
        if (pcm.destroyed) return;
        if (code === 0 && started) return pcm.end();
        const detail = stderr.trim().replace(/https?:\/\/[^\s]+/g, '[URL]').slice(-800);
        pcm.destroy(new Error('FFmpeg không đọc được âm thanh' + (detail ? ': ' + detail : '.')));
    });
    pcm.once('close', () => {
        if (ffmpegProcess.exitCode === null && ffmpegProcess.signalCode === null) ffmpegProcess.kill();
    });
    // Leave an error listener until the player's pipeline attaches.
    pcm.on('error', () => {});
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => pcm.destroy(new Error('FFmpeg audio startup timeout')), 25000);
        pcm.once('error', error => { clearTimeout(timer); reject(error); });
        pcm.once('readable', () => {
            if (!pcm.readableLength) return;
            started = true;
            clearTimeout(timer);
            resolve();
        });
        ffmpegProcess.stdout.pipe(pcm, { end: false });
    });
    return { stream: pcm, type: StreamType.Raw };
}

function isUsablePlaylistEntry(id, title) {
    return typeof id === 'string' && /^[\w-]{11}$/.test(id) && typeof title === 'string'
        && title.trim() && !/^\[?(private|deleted) video\]?$/i.test(title.trim());
}

async function readFlatPlaylist(url, maxVideos) {
    const ytdlp = require('yt-dlp-exec');
    const result = await ytdlp(url, {
        dumpSingleJson: true,
        flatPlaylist: true,
        yesPlaylist: true,
        playlistEnd: maxVideos,
        skipDownload: true,
        socketTimeout: 10
    }, { timeout: 45000 });

    const unavailable = new Set(['private', 'premium_only', 'subscriber_only', 'needs_auth']);
    const videos = (result?.entries || [])
        .filter(entry => isUsablePlaylistEntry(entry?.id, entry?.title) && !unavailable.has(entry.availability))
        .slice(0, maxVideos)
        .map(entry => mapYtsVideo({
            videoId: entry.id,
            title: entry.title,
            seconds: entry.duration,
            thumbnail: 'https://i.ytimg.com/vi/' + entry.id + '/hqdefault.jpg'
        }));
    return videos.length ? { title: result.title || 'YouTube', videoCount: result.playlist_count ?? null, videos } : null;
}

// ── Lấy danh sách playlist ─────────────────────────────────────────────────
async function getPlaylistVideos(playlistUrl, maxVideos = MAX_PLAYLIST_TRACKS) {
    const url = parseYouTubeUrl(playlistUrl);
    const listId = getPlaylistId(url);
    if (!listId || !Number.isInteger(maxVideos) || maxVideos < 1) return null;
    const limit = Math.min(maxVideos, MAX_PLAYLIST_TRACKS);
    const isMix = listId.startsWith('RD');
    let source = 'https://www.youtube.com/playlist?' + new URLSearchParams({ list: listId });
    if (isMix) {
        // Mix entries are available from the watch page of a seed video.
        const shortId = url.hostname.endsWith('youtu.be') ? url.pathname.slice(1) : null;
        const seedId = url.searchParams.get('v') || shortId || /^RD(?:MM)?([\w-]{11})$/.exec(listId)?.[1];
        if (!seedId || !/^[\w-]{11}$/.test(seedId)) return null;
        source = 'https://www.youtube.com/watch?' + new URLSearchParams({ v: seedId, list: listId });
    }

    try {
        const playlist = await readFlatPlaylist(source, limit);
        if (playlist || isMix) return playlist;
    } catch (error) {
        const reason = error.stderr?.trim().split('\n').at(-1) || error.shortMessage || error.message;
        console.error('❌ yt-dlp không đọc được playlist:', reason);
        if (isMix) return null;
    }

    try {
        const result = await runSearchWorker({ options: { listId } });
        const videos = (result?.videos || []).filter(video => isUsablePlaylistEntry(video?.videoId, video?.title))
            .slice(0, limit).map(mapYtsVideo);
        return videos.length ? { title: result.title || 'Playlist', videoCount: result.size ?? null, videos } : null;
    } catch (error) {
        console.error('❌ Lỗi lấy playlist:', error.message);
        return null;
    }
}

// ── Tải trực tiếp danh sách YouTube Trending Music (dùng Search Worker) ───────────
async function fetchYoutubeTrending(region = 'VN', limit = 10) {
    try {
        console.log(`🌍 Đang lấy danh sách Hot Trending cho khu vực: ${region} bằng Search Worker`);
        const queryMap = {
            'VN': 'vpop trending music mới nhất',
            'KR': 'kpop music charts trending',
            'US': 'us uk pop billboard charts trending',
            'GLOBAL': 'global pop hits charts trending',
            'ASIA': 'jpop cpop asian music trending'
        };
        const query = queryMap[region] || queryMap['VN'];

        const results = await searchYoutube(query, limit);
        if (!results) {
            console.log('⚠️ Không tìm thấy bài trending nào qua tìm kiếm');
            return [];
        }

        const songs = Array.isArray(results) ? results : [results];
        console.log(`✅ Đã lấy thành công ${songs.length} bài trending từ YouTube Search`);

        return songs.map((song, index) => ({
            ...song,
            trendingRank: index + 1
        }));
    } catch (error) {
        console.error('❌ Lỗi khi tải Youtube Trending qua Search:', error.message);
        return [];
    }
}

// ── Validate URL ───────────────────────────────────────────────────────────────
function parseYouTubeUrl(input) {
    if (typeof input !== 'string') return null;
    try {
        const value = input.trim();
        const url = new URL(/^[a-z]+:\/\//i.test(value) ? value : 'https://' + value);
        const hosts = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be'];
        if (!['http:', 'https:'].includes(url.protocol) || !hosts.includes(url.hostname) || url.username || url.password || url.port || url.pathname === '/') return null;
        return url;
    } catch {
        return null;
    }
}

function getPlaylistId(url) {
    const id = url?.searchParams.get('list');
    return id && /^[\w-]+$/.test(id) ? id : null;
}

function isValidYouTubeUrl(url) {
    return parseYouTubeUrl(url) !== null;
}

function isPlaylistUrl(url) {
    return getPlaylistId(parseYouTubeUrl(url)) !== null;
}

function isYouTubeMixUrl(url) {
    return getPlaylistId(parseYouTubeUrl(url))?.startsWith('RD') ?? false;
}

// ── Kiểm tra DNS ──────────────────────────────────────────────────────────────
async function checkDNSConnection() {
    const { promisify } = require('util');
    const lookup = promisify(dns.lookup);

    for (const domain of ['youtube.com', 'google.com']) {
        try {
            await lookup(domain);
            console.log(`✅ DNS OK: ${domain}`);
            return true;
        } catch {
            console.log(`❌ DNS fail: ${domain}`);
        }
    }
    return false;
}

// ── Tìm kiếm Playlist YouTube ────────────────────────────────────────────────
async function searchPlaylist(query, limit = 1) {
    try {
        return await retryWithBackoff(async () => {
            console.log(`🔍 Tìm kiếm Playlist: "${query}"`);

            const result = await runSearchWorker({ query });
            const playlists = result.playlists;

            if (!playlists || playlists.length === 0) {
                console.log('⚠️ Không tìm thấy playlist nào');
                return null;
            }

            console.log(`✅ Tìm thấy playlist: ${playlists[0].title}`);

            const limited = playlists.slice(0, Math.min(limit, 10)).map(playlist => ({ ...playlist }));
            if (limit === 1) return limited[0];
            return limited;
        }, 3, 1500);
    } catch (error) {
        console.error('❌ Lỗi tìm kiếm Playlist YouTube:', error.message);
        return null;
    }
}

module.exports = {
    searchYoutube,
    getVideoInfo,
    getAudioStream,
    getPlaylistVideos,
    MAX_PLAYLIST_TRACKS,
    fetchYoutubeTrending,
    isValidYouTubeUrl,
    isPlaylistUrl,
    isYouTubeMixUrl,
    checkDNSConnection,
    formatDuration,
    searchPlaylist
};
