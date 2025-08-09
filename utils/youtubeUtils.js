const youtube = require('youtube-sr').default;
const ytdl = require('@distube/ytdl-core');
const { formatDuration } = require('./musicUtils');
const { searchFallback } = require('./fallbackPlaylist');
const dns = require('dns');

// Set DNS servers as fallback
dns.setServers([
    '8.8.8.8',      // Google DNS
    '8.8.4.4',      // Google DNS
    '1.1.1.1',      // Cloudflare DNS
    '1.0.0.1'       // Cloudflare DNS
]);

// Retry function với exponential backoff
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            if (i === maxRetries - 1) throw error;
            
            const delay = baseDelay * Math.pow(2, i);
            console.log(`🔄 Retry ${i + 1}/${maxRetries} sau ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// Tìm kiếm video trên YouTube với retry
async function searchYoutube(query) {
    try {
        return await retryWithBackoff(async () => {
            console.log(`🔍 Searching YouTube for: "${query}"`);
            const results = await youtube.search(query, { 
                limit: 1, 
                type: 'video',
                requestOptions: {
                    timeout: 15000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                }
            });
            
            if (results.length > 0) {
                const video = results[0];
                console.log(`✅ Found: ${video.title}`);
                return {
                    title: video.title,
                    url: video.url,
                    duration: video.durationFormatted,
                    thumbnail: video.thumbnail?.url || null
                };
            }
            return null;
        }, 3, 2000);
    } catch (error) {
        console.error('❌ Lỗi tìm kiếm YouTube:', error.message);
        
        // Fallback: Sử dụng playlist có sẵn khi DNS fails
        if (error.message.includes('ENOTFOUND') || error.message.includes('fetch failed')) {
            console.log('🎵 Sử dụng fallback playlist do lỗi DNS...');
            return searchFallback(query);
        }
        
        return null;
    }
}

// Lấy thông tin video từ URL với retry
async function getVideoInfo(url) {
    try {
        return await retryWithBackoff(async () => {
            console.log(`📋 Getting video info for: ${url}`);
            const info = await ytdl.getInfo(url, {
                requestOptions: {
                    timeout: 15000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                }
            });
            
            return {
                title: info.videoDetails.title,
                url: url,
                duration: formatDuration(parseInt(info.videoDetails.lengthSeconds)),
                thumbnail: info.videoDetails.thumbnails[0]?.url
            };
        }, 3, 2000);
    } catch (error) {
        console.error('❌ Lỗi lấy thông tin video:', error.message);
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

// Kiểm tra kết nối DNS
async function checkDNSConnection() {
    try {
        const { promisify } = require('util');
        const lookup = promisify(dns.lookup);
        
        // Test multiple domains
        const domains = ['youtube.com', 'www.youtube.com', 'google.com'];
        
        for (const domain of domains) {
            try {
                await lookup(domain);
                console.log(`✅ DNS OK for ${domain}`);
                return true;
            } catch (error) {
                console.log(`❌ DNS failed for ${domain}: ${error.message}`);
            }
        }
        
        return false;
    } catch (error) {
        console.error('❌ DNS check failed:', error.message);
        return false;
    }
}

module.exports = {
    searchYoutube,
    getVideoInfo,
    isValidYouTubeUrl,
    isPlaylistUrl,
    getPlaylistVideos,
    checkDNSConnection
};