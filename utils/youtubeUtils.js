const youtube = require('youtube-sr').default;
const ytdl = require('@distube/ytdl-core');
const { formatDuration } = require('./musicUtils');

// Tìm kiếm video trên YouTube
async function searchYoutube(query) {
    try {
        const results = await youtube.search(query, { limit: 1, type: 'video' });
        if (results.length > 0) {
            const video = results[0];
            return {
                title: video.title,
                url: video.url,
                duration: video.durationFormatted,
                thumbnail: video.thumbnail?.url || null
            };
        }
        return null;
    } catch (error) {
        console.error('Lỗi tìm kiếm YouTube:', error);
        return null;
    }
}

// Lấy thông tin video từ URL
async function getVideoInfo(url) {
    try {
        const info = await ytdl.getInfo(url);
        return {
            title: info.videoDetails.title,
            url: url,
            duration: formatDuration(parseInt(info.videoDetails.lengthSeconds)),
            thumbnail: info.videoDetails.thumbnails[0]?.url
        };
    } catch (error) {
        console.error('Lỗi lấy thông tin video:', error);
        return null;
    }
}

// Kiểm tra URL YouTube hợp lệ
function isValidYouTubeUrl(url) {
    const urlPattern = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
    return urlPattern.test(url);
}

// Kiểm tra xem có phải playlist URL không
function isPlaylistUrl(url) {
    const playlistPattern = /[?&]list=([a-zA-Z0-9_-]+)/;
    return playlistPattern.test(url);
}

// Lấy danh sách video từ playlist
async function getPlaylistVideos(playlistUrl, maxVideos = 50) {
    try {
        const playlist = await youtube.getPlaylist(playlistUrl, { limit: maxVideos });
        
        if (!playlist || !playlist.videos) {
            return null;
        }

        const videos = playlist.videos.map(video => ({
            title: video.title,
            url: video.url,
            duration: video.durationFormatted,
            thumbnail: video.thumbnail?.url || null
        }));

        return {
            title: playlist.title,
            videoCount: playlist.videoCount,
            videos: videos
        };
    } catch (error) {
        console.error('Lỗi lấy playlist:', error);
        return null;
    }
}

module.exports = {
    searchYoutube,
    getVideoInfo,
    isValidYouTubeUrl,
    isPlaylistUrl,
    getPlaylistVideos
};