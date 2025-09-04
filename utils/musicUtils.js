const { joinVoiceChannel, createAudioPlayer, createAudioResource, StreamType } = require('@discordjs/voice');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const ytdl = require('@distube/ytdl-core');

// Lưu trữ thông tin music cho mỗi guild
const musicData = new Map();

// Format duration từ seconds thành HH:MM:SS
function formatDuration(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hrs > 0) {
        return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
}

// Khởi tạo dữ liệu music cho guild
function initGuildMusicData(guildId) {
    if (!musicData.has(guildId)) {
        musicData.set(guildId, {
            queue: [],
            isPlaying: false,
            currentSong: null,
            player: null,
            connection: null,
            textChannel: null,
            volume: 50,
            loopMode: 'off',
            autoplay: false,
            audioResource: null,
            errorCount: 0,
            lastErrorTime: 0,
            retryingCurrentSong: false,
            autoTrending: {
                enabled: false,
                region: 'VN',
                count: 0,
                lastFetch: null,
                trendingList: [],
                playedSongs: new Set(),
                consecutiveFailures: 0,
                lastSearchTime: 0
            }
        });
    }
    return musicData.get(guildId);
}

// Phát nhạc
async function playMusic(guildData) {
    try {
        if (guildData.queue.length === 0) {
            guildData.isPlaying = false;
            guildData.currentSong = null;
            
            console.log('📭 Queue rỗng, đang kiểm tra auto-trending...');
            
            if (!guildData.retryingCurrentSong && guildData.autoTrending && guildData.autoTrending.enabled) {
                await handleAutoTrending(guildData);
            }
            return;
        }

        const song = guildData.queue[0];
        guildData.currentSong = song;
        guildData.isPlaying = true;

        console.log(`🎵 Đang phát: ${song.title}`);

        try {
            const stream = ytdl(song.url, {
                filter: 'audioonly',
                quality: 'highestaudio',
                highWaterMark: 1 << 25,
            });

            guildData.audioResource = createAudioResource(stream, {
                inputType: StreamType.Arbitrary,
            });

            if (!guildData.connection || !guildData.player) {
                throw new Error('Connection hoặc player không tồn tại');
            }

            guildData.player.play(guildData.audioResource);
            guildData.errorCount = 0;
            guildData.retryingCurrentSong = false;
            guildData.autoTrending.consecutiveFailures = 0;

            console.log('✅ Đã bắt đầu phát nhạc');

            // Gửi embed hiện tại đang phát
            if (guildData.textChannel) {
                const embed = new EmbedBuilder()
                    .setColor('#00ff00')
                    .setTitle('🎵 Đang phát')
                    .setDescription(`**${song.title}**`)
                    .addFields(
                        { name: '👤 Yêu cầu bởi', value: song.requestedBy || 'Không rõ', inline: true },
                        { name: '⏱️ Thời lượng', value: song.duration || 'Không rõ', inline: true }
                    )
                    .setThumbnail(song.thumbnail || null)
                    .setTimestamp();

                // Tạo các nút điều khiển
                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('music_pause')
                            .setLabel('⏸️ Tạm dừng')
                            .setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder()
                            .setCustomId('music_skip')
                            .setLabel('⏭️ Skip')
                            .setStyle(ButtonStyle.Primary),
                        new ButtonBuilder()
                            .setCustomId('music_stop')
                            .setLabel('⏹️ Dừng')
                            .setStyle(ButtonStyle.Danger),
                        new ButtonBuilder()
                            .setCustomId('music_queue')
                            .setLabel('📝 Queue')
                            .setStyle(ButtonStyle.Success)
                    );

                try {
                    const message = await guildData.textChannel.send({
                        embeds: [embed],
                        components: [row]
                    });

                    // Xóa các nút sau 5 phút
                    setTimeout(() => {
                        removeButtons(message);
                    }, 300000);
                    
                } catch (sendError) {
                    console.error('Lỗi khi gửi embed:', sendError);
                }
            }

        } catch (error) {
            console.error('❌ Lỗi khi phát nhạc:', error.message);
            await handlePlaybackError(guildData, song, error);
        }

    } catch (error) {
        console.error('❌ Lỗi tổng quát trong playMusic:', error);
        guildData.isPlaying = false;
    }
}

// Xử lý lỗi phát nhạc
async function handlePlaybackError(guildData, song, error) {
    console.log(`❌ Lỗi khi phát bài: ${song.title}`);
    
    const currentTime = Date.now();
    
    if (currentTime - guildData.lastErrorTime < 10000) {
        guildData.errorCount++;
    } else {
        guildData.errorCount = 1;
    }
    
    guildData.lastErrorTime = currentTime;
    
    const shouldRetry = (
        error.message.includes('Status code: 410') ||
        error.message.includes('network') ||
        error.message.includes('timeout') ||
        error.message.includes('ECONNRESET')
    );
    
    if (shouldRetry && guildData.errorCount < 3 && !guildData.retryingCurrentSong) {
        console.log(`🔄 Thử lại sau 2 giây... (lần ${guildData.errorCount}/3)`);
        guildData.retryingCurrentSong = true;
        
        setTimeout(() => {
            playMusic(guildData);
        }, 2000);
        return;
    }
    
    console.log('❌ Không thể phát bài hát, skip sang bài tiếp theo');
    guildData.queue.shift();
    guildData.errorCount = 0;
    guildData.currentSong = null;
    guildData.retryingCurrentSong = false;
    
    if (song.autoTrending) {
        guildData.autoTrending.consecutiveFailures++;
        
        if (guildData.autoTrending.consecutiveFailures >= 10) {
            console.log('🚫 Tắt auto-trending do quá nhiều lần thất bại');
            guildData.autoTrending.enabled = false;
            
            if (guildData.textChannel) {
                guildData.textChannel.send('⚠️ **Auto-trending đã bị tắt** do quá nhiều lỗi liên tiếp.');
            }
        }
    }
    
    setTimeout(() => {
        if (guildData.queue.length > 0) {
            playMusic(guildData);
        } else {
            guildData.isPlaying = false;
            if (guildData.autoTrending && guildData.autoTrending.enabled) {
                handleAutoTrending(guildData);
            }
        }
    }, 1000);
}

// Tạo kết nối voice và player
function createMusicConnection(member, guildData) {
    if (!guildData.connection) {
        guildData.connection = joinVoiceChannel({
            channelId: member.voice.channel.id,
            guildId: member.guild.id,
            adapterCreator: member.guild.voiceAdapterCreator,
        });

        guildData.player = createAudioPlayer();
        guildData.connection.subscribe(guildData.player);

        guildData.player.on('idle', async () => {
            await handleSongEnd(guildData);
        });

        guildData.player.on('error', async error => {
            console.error('❌ Audio player error:', error.message);
            
            if (guildData.currentSong) {
                await handlePlaybackError(guildData, guildData.currentSong, error);
            }
        });

        console.log('✅ Đã tạo kết nối voice và player');
    }
}

// Xử lý khi bài hát kết thúc
async function handleSongEnd(guildData) {
    console.log('🎵 Bài hát đã kết thúc');

    // Đảm bảo guildData có cấu trúc đầy đủ
    if (!guildData.autoTrending) {
        guildData.autoTrending = {
            enabled: false,
            region: 'VN', 
            count: 0,
            lastFetch: null,
            trendingList: [],
            playedSongs: new Set(),
            consecutiveFailures: 0,
            lastSearchTime: 0
        };
    }

    const completedSong = guildData.currentSong;
    
    // Đánh dấu bài đã phát để tránh trùng lặp (kiểm tra an toàn)
    if (completedSong && completedSong.url && guildData.autoTrending && guildData.autoTrending.playedSongs) {
        // Đảm bảo playedSongs là Set hợp lệ
        if (typeof guildData.autoTrending.playedSongs.add !== 'function') {
            guildData.autoTrending.playedSongs = new Set();
        }
        
        guildData.autoTrending.playedSongs.add(completedSong.url);
        console.log(`✅ Đã đánh dấu bài: ${completedSong.title}`);
        
        // Reset khi quá 100 bài để tránh memory leak
        if (guildData.autoTrending.playedSongs.size > 100) {
            console.log('🔄 Reset danh sách bài đã phát (>100 bài)');
            guildData.autoTrending.playedSongs.clear();
        }
    }

    if (guildData.loopMode === 'track' && completedSong) {
        console.log('🔂 Lặp lại bài hiện tại');
        await playMusic(guildData);
        return;
    }

    if (guildData.loopMode === 'queue' && completedSong) {
        console.log('🔁 Lặp lại queue');
        const currentSong = guildData.queue.shift();
        guildData.queue.push(currentSong);
        await playMusic(guildData);
        return;
    }

    guildData.queue.shift();
    guildData.currentSong = null;

    if (guildData.queue.length > 0) {
        console.log('⏭️ Chuyển sang bài tiếp theo');
        await playMusic(guildData);
    } else {
        console.log('📭 Hết bài trong queue');
        guildData.isPlaying = false;
        
        if (guildData.autoTrending && guildData.autoTrending.enabled) {
            await handleAutoTrending(guildData);
        }
    }
}

// Lọc bài hát (loại bỏ video dài, podcast, v.v.)
function filterSongs(songs) {
    return songs.filter(song => {
        const durationSeconds = parseDuration(song.duration);
        if (durationSeconds > 480) {
            console.log(`🚫 Bỏ qua bài dài: ${song.title} (${song.duration})`);
            return false;
        }
        
        const title = song.title.toLowerCase();
        const blacklistKeywords = [
            'podcast', 'interview', 'full album', 'compilation', 
            'mix', 'playlist', 'hour', 'hours', 'live stream',
            'documentary', 'reaction', 'review', 'analysis'
        ];
        
        for (const keyword of blacklistKeywords) {
            if (title.includes(keyword)) {
                console.log(`🚫 Bỏ qua video: ${song.title} (chứa "${keyword}")`);
                return false;
            }
        }
        
        return true;
    });
}

// Parse duration string thành seconds
function parseDuration(duration) {
    if (!duration) return 0;
    
    const parts = duration.split(':').map(Number);
    if (parts.length === 2) {
        return parts[0] * 60 + parts[1];
    } else if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return 0;
}

// Xử lý auto-trending với batch system
async function handleAutoTrending(guildData) {
    try {
        // Đảm bảo autoTrending object được khởi tạo đầy đủ
        if (!guildData.autoTrending) {
            console.log('🔧 Initializing autoTrending object...');
            guildData.autoTrending = {
                enabled: false,
                region: 'VN',
                count: 0,
                lastFetch: null,
                trendingList: [],
                playedSongs: new Set(),
                consecutiveFailures: 0,
                lastSearchTime: 0
            };
        }
        
        // Đảm bảo playedSongs được khởi tạo (backward compatibility)
        if (!guildData.autoTrending.playedSongs) {
            guildData.autoTrending.playedSongs = new Set();
        }
        
        // Đảm bảo trendingList được khởi tạo
        if (!guildData.autoTrending.trendingList) {
            guildData.autoTrending.trendingList = [];
        }
        
        // Đảm bảo các thuộc tính khác được khởi tạo
        if (typeof guildData.autoTrending.consecutiveFailures !== 'number') {
            guildData.autoTrending.consecutiveFailures = 0;
        }
        
        if (typeof guildData.autoTrending.lastSearchTime !== 'number') {
            guildData.autoTrending.lastSearchTime = 0;
        }
        
        if (typeof guildData.autoTrending.count !== 'number') {
            guildData.autoTrending.count = 0;
        }
        
        if (!guildData.autoTrending.region) {
            guildData.autoTrending.region = 'VN';
        }
        
        if (!guildData.autoTrending.enabled) {
            console.log('🚫 Auto-trending đã tắt - thoát function');
            return;
        }
        
        console.log('✅ Auto-trending enabled, tiếp tục...');
        
        if (guildData.autoTrending.consecutiveFailures >= 10) {
            console.log('🚫 Bỏ qua auto-trending do quá nhiều lỗi');
            return;
        }
        
        // Kiểm tra xem có còn bài trong trending list không
        if (guildData.autoTrending.trendingList.length > 0) {
            console.log(`📝 Còn ${guildData.autoTrending.trendingList.length} bài trong trending list`);
            
            const nextSong = guildData.autoTrending.trendingList.shift();
            
            if (guildData.autoTrending.playedSongs.has(nextSong.url)) {
                console.log(`🔄 Bài đã phát rồi, lấy bài khác: ${nextSong.title}`);
                return await handleAutoTrending(guildData);
            }
            
            nextSong.requestedBy = 'Auto-Trending';
            nextSong.autoTrending = true;
            
            guildData.queue.push(nextSong);
            guildData.autoTrending.count++;
            
            console.log(`✅ Thêm bài từ trending list: ${nextSong.title}`);
            
            // Đã bỏ thông báo auto-trending để tránh spam
            // if (guildData.textChannel) {
            //     const regionName = getRegionDisplayName(guildData.autoTrending.region);
            //     guildData.textChannel.send({
            //         content: `🔥 **Auto-Trending ${regionName}**: *${nextSong.title}*`,
            //         allowedMentions: { parse: [] }
            //     });
            // }
            
            if (!guildData.isPlaying) {
                await playMusic(guildData);
            }
            return;
        }
        
        // Nếu hết bài trong list, search batch mới
        const now = Date.now();
        const cooldown = 30000;
        
        if (now - guildData.autoTrending.lastSearchTime < cooldown) {
            const remaining = Math.ceil((cooldown - (now - guildData.autoTrending.lastSearchTime)) / 1000);
            console.log(`⏰ Auto-trending search cooldown: ${remaining}s còn lại`);
            return;
        }
        
        guildData.autoTrending.lastSearchTime = now;
        console.log('🔍 Đang search batch trending mới...');
        
        const trendingCommand = require('../commands/trending');
        const region = guildData.autoTrending.region || 'VN';
        
        const trendingSongs = await trendingCommand.getAutoTrendingSong(region, 20);
        
        if (trendingSongs && trendingSongs.length > 0) {
            console.log(`🎵 Tìm thấy ${trendingSongs.length} bài trending`);
            
            const filteredSongs = filterSongs(trendingSongs);
            console.log(`✅ Sau khi lọc còn ${filteredSongs.length} bài hợp lệ`);
            
            // Đảm bảo playedSongs luôn là Set
            if (!guildData.autoTrending.playedSongs || typeof guildData.autoTrending.playedSongs.has !== 'function') {
                console.log('🔧 Khởi tạo lại playedSongs');
                guildData.autoTrending.playedSongs = new Set();
            }
            
            const newSongs = filteredSongs.filter(song => {
                // Kiểm tra an toàn trước khi dùng has()
                if (!guildData.autoTrending || !guildData.autoTrending.playedSongs || typeof guildData.autoTrending.playedSongs.has !== 'function') {
                    console.log('⚠️ playedSongs không hợp lệ trong filter, bỏ qua bài:', song.title);
                    return false;
                }
                return !guildData.autoTrending.playedSongs.has(song.url);
            });
            console.log(`🆕 Có ${newSongs.length} bài chưa phát`);
            
            if (newSongs.length > 0) {
                // Shuffle danh sách
                for (let i = newSongs.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [newSongs[i], newSongs[j]] = [newSongs[j], newSongs[i]];
                }
                
                guildData.autoTrending.trendingList = newSongs;
                guildData.autoTrending.lastFetch = new Date().toISOString();
                
                console.log(`📦 Đã lưu ${newSongs.length} bài vào trending list`);
                
                // Đã bỏ thông báo batch load để tránh spam
                // if (guildData.textChannel) {
                //     const regionName = getRegionDisplayName(region);
                //     guildData.textChannel.send({
                //         content: `🔥 **Auto-Trending ${regionName}**: Đã tải ${newSongs.length} bài mới!`,
                //         allowedMentions: { parse: [] }
                //     });
                // }
                
                return await handleAutoTrending(guildData);
            } else {
                console.log('❌ Tất cả bài đều đã phát rồi');
                
                if (guildData.autoTrending.playedSongs.size > 100) {
                    console.log('🔄 Reset danh sách bài đã phát');
                    guildData.autoTrending.playedSongs.clear();
                }
                
                guildData.autoTrending.consecutiveFailures++;
            }
        } else {
            console.log('❌ Không tìm thấy bài trending nào');
            guildData.autoTrending.consecutiveFailures++;
        }
        
    } catch (error) {
        console.error('❌ Lỗi auto-trending:', error);
        guildData.autoTrending.consecutiveFailures++;
    }
}

// Lấy tên hiển thị của region
function getRegionDisplayName(region) {
    const regionNames = {
        'VN': 'Việt Nam',
        'KR': 'Hàn Quốc', 
        'US': 'Hoa Kỳ',
        'GLOBAL': 'Toàn Cầu',
        'ASIA': 'Châu Á'
    };
    return regionNames[region] || region;
}

// Xóa các nút điều khiển
async function removeButtons(message) {
    try {
        await message.edit({ components: [] });
    } catch (error) {
        console.error('Lỗi khi xóa buttons:', error);
    }
}

module.exports = {
    musicData,
    formatDuration,
    initGuildMusicData,
    playMusic,
    createMusicConnection,
    handleSongEnd,
    handleAutoTrending,
    removeButtons
};