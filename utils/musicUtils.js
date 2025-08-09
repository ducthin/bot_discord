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
            volume: 50, // Mặc định 50%
            loopMode: 'off', // 'off', 'track', 'queue'
            autoplay: false,
            audioResource: null,
            errorCount: 0, // Đếm số lỗi liên tiếp
            lastErrorTime: 0 // Thời gian lỗi cuối
        });
    }
    return musicData.get(guildId);
}

// Phát nhạc
async function playMusic(guildData) {
    if (guildData.queue.length === 0) {
        guildData.isPlaying = false;
        guildData.currentSong = null;
        return;
    }

    const song = guildData.queue[0];
    guildData.currentSong = song;
    guildData.isPlaying = true;

    try {
        // Kiểm tra URL trước khi stream
        if (!song.url || song.url === 'undefined') {
            console.error('URL không hợp lệ:', song);
            guildData.queue.shift();
            playMusic(guildData);
            return;
        }

        console.log('Đang phát:', song.title, 'URL:', song.url);
        console.log('Creating audio stream for:', song.url);
        
        // YouTube video streaming with improved DNS handling
        const stream = ytdl(song.url, {
            filter: 'audioonly',
            quality: 'highestaudio',
            highWaterMark: 1 << 25,
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                },
                timeout: 30000, // 30 second timeout
                family: 4 // Force IPv4 to avoid DNS issues
            },
            // Thêm options để giảm DNS errors
            format: 'mp4',
            begin: '0s'
        });
        
        console.log('✅ Using @distube/ytdl-core stream');

        const resource = createAudioResource(stream, {
            inputType: StreamType.Arbitrary,
            inlineVolume: true
        });
        
        // Áp dụng volume setting
        if (resource.volume) {
            resource.volume.setVolume(guildData.volume / 100);
        }
        
        guildData.audioResource = resource;
        
        // Set up error handling cho audio player
        guildData.player.on('error', (error) => {
            console.error('Lỗi audio player:', error);
            
            // Xử lý các loại lỗi khác nhau
            if (error.message.includes('ETIMEDOUT') || error.message.includes('timeout')) {
                console.log('🔄 Lỗi timeout, thử lại sau 3 giây...');
                setTimeout(() => {
                    if (guildData.queue.length > 0) {
                        handleSongEnd(guildData);
                    }
                }, 3000);
            } else if (error.message.includes('ECONNRESET') || error.message.includes('ENOTFOUND')) {
                console.log('🔄 Lỗi kết nối mạng, thử lại sau 5 giây...');
                setTimeout(() => {
                    if (guildData.queue.length > 0) {
                        handleSongEnd(guildData);
                    }
                }, 5000);
            } else {
                // Lỗi khác, chuyển bài tiếp theo
                handleSongEnd(guildData);
            }
        });
        
        guildData.player.play(resource);

        // Reset error count khi phát thành công
        guildData.errorCount = 0;

        // Lưu vào lịch sử
        const { addToHistory } = require('../commands/history');
        if (song.requester) {
            const userId = song.requester;
            await addToHistory(userId, song);
        }

        // Hiển thị thông tin bài hát
        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('🎵 Đang phát')
            .setDescription(`**${song.title}**`)
            .addFields(
                { name: 'Thời lượng', value: song.duration || 'N/A', inline: true },
                { name: 'Yêu cầu bởi', value: song.requester, inline: true },
                { name: 'Kênh', value: song.channel || 'N/A', inline: true }
            )
            .setThumbnail(song.thumbnail);

        // Tạo buttons điều khiển
        const controlButtons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('pause_music')
                    .setLabel('⏸️ Tạm dừng')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('resume_music')
                    .setLabel('▶️ Tiếp tục')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('skip_music')
                    .setLabel('⏭️ Bỏ qua')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('show_queue')
                    .setLabel('📋 danh sách')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('stop_music')
                    .setLabel('⏹️ Dừng')
                    .setStyle(ButtonStyle.Danger)
            );

        // Tạo hàng buttons thứ hai cho lyrics
        const secondRowButtons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('show_lyrics')
                    .setLabel('🎤 Lời bài hát')
                    .setStyle(ButtonStyle.Secondary)
            );

        if (guildData.textChannel) {
            const message = await guildData.textChannel.send({ 
                embeds: [embed], 
                components: [controlButtons, secondRowButtons] 
            });
            
            // Lưu message reference để có thể xóa buttons sau
            guildData.currentMessage = message;
        }
    } catch (error) {
        console.error('❌ Lỗi khi phát nhạc:', error.message);
        
        // Tăng error count
        guildData.errorCount = (guildData.errorCount || 0) + 1;
        guildData.lastErrorTime = Date.now();
        
        // Send error message to channel
        if (guildData.textChannel) {
            // Xác định loại lỗi
            let errorType = 'Lỗi không xác định';
            let shouldRetry = false;
            
            if (error.message.includes('ETIMEDOUT') || error.message.includes('timeout')) {
                errorType = 'Lỗi timeout kết nối';
                shouldRetry = true;
            } else if (error.message.includes('ECONNRESET') || error.message.includes('ENOTFOUND')) {
                errorType = 'Lỗi kết nối mạng';
                shouldRetry = true;
            } else if (error.message.includes('403') || error.message.includes('blocked')) {
                errorType = 'Video bị chặn hoặc riêng tư';
            } else if (error.message.includes('404')) {
                errorType = 'Video không tồn tại';
            }
            
            const errorEmbed = new EmbedBuilder()
                .setColor('#ff0000')
                .setTitle('❌ Lỗi phát nhạc')
                .setDescription(`Không thể phát **${song.title}**\nLý do: ${errorType}`)
                .setFooter({ text: shouldRetry && guildData.errorCount < 3 ? 'Đang thử lại...' : 'Đang chuyển sang bài tiếp theo...' });
            
            guildData.textChannel.send({ embeds: [errorEmbed] });
        }
        
        // Xóa buttons nếu có
        if (guildData.currentSong) {
            await removeButtons(guildData, guildData.currentSong.title);
        }
        
        // Kiểm tra error count
        if (guildData.errorCount >= 3) {
            console.log('❌ Quá nhiều lỗi, dừng phát nhạc');
            guildData.queue = [];
            guildData.isPlaying = false;
            guildData.currentSong = null;
            return;
        }
        
        guildData.queue.shift(); // Bỏ qua bài hát lỗi
        
        // Chờ 3 giây trước khi phát bài tiếp theo
        if (guildData.queue.length > 0) {
            setTimeout(() => {
                playMusic(guildData);
            }, 3000);
        } else {
            guildData.isPlaying = false;
            guildData.currentSong = null;
        }
    }
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

        // Xử lý sự kiện player
        guildData.player.on('idle', async () => {
            await handleSongEnd(guildData);
        });

        guildData.player.on('error', async error => {
            console.error('Lỗi audio player:', error);
            
            const currentTime = Date.now();
            
            // Kiểm tra nếu có quá nhiều lỗi liên tiếp trong thời gian ngắn
            if (currentTime - guildData.lastErrorTime < 10000) { // 10 giây
                guildData.errorCount++;
            } else {
                guildData.errorCount = 1; // Reset counter nếu đã lâu
            }
            
            guildData.lastErrorTime = currentTime;
            
            // Nếu có quá nhiều lỗi liên tiếp, dừng bot để tránh spam
            if (guildData.errorCount >= 3) {
                console.log('❌ Quá nhiều lỗi liên tiếp, dừng phát nhạc');
                
                if (guildData.textChannel) {
                    const errorEmbed = new EmbedBuilder()
                        .setColor('#ff0000')
                        .setTitle('❌ Lỗi hệ thống')
                        .setDescription('Bot gặp quá nhiều lỗi liên tiếp. Có thể do:\n• Mạng không ổn định\n• YouTube đang chặn requests\n• Server quá tải')
                        .addFields(
                            { name: '🔧 Giải pháp', value: 'Hãy thử lại sau vài phút hoặc sử dụng lệnh `/stop` rồi `/play` lại', inline: false }
                        )
                        .setFooter({ text: 'Bot sẽ tự động reset sau 5 phút' });
                    
                    guildData.textChannel.send({ embeds: [errorEmbed] });
                }
                
                // Clear queue và reset
                guildData.queue = [];
                guildData.isPlaying = false;
                guildData.currentSong = null;
                
                // Reset error count sau 5 phút
                setTimeout(() => {
                    guildData.errorCount = 0;
                    console.log('✅ Error count đã được reset cho guild:', guildData);
                }, 300000); // 5 phút
                
                return;
            }
            
            // Xóa buttons của bài hiện tại nếu có
            if (guildData.currentSong) {
                await removeButtons(guildData, guildData.currentSong.title);
            }
            
            // Skip bài hiện tại và chờ 2 giây trước khi phát tiếp
            guildData.queue.shift();
            
            if (guildData.queue.length > 0) {
                console.log('⏳ Chờ 2 giây trước khi phát bài tiếp theo...');
                setTimeout(() => {
                    playMusic(guildData);
                }, 2000);
            } else {
                guildData.isPlaying = false;
                guildData.currentSong = null;
            }
        });
    }
}

// Xóa buttons của bài hát đã phát xong
async function removeButtons(guildData, songTitle) {
    // Kiểm tra xem đã có currentMessage và chưa được xóa
    if (!guildData.currentMessage) {
        console.log('⚠️ Không có message nào để xóa buttons');
        return;
    }
    
    try {
        // Tạo embed mới với trạng thái "Đã hoàn thành" và không có buttons
        const completedEmbed = new EmbedBuilder()
            .setColor('#808080') // Màu xám cho bài đã hoàn thành
            .setTitle('✅ Đã hoàn thành')
            .setDescription(`**${songTitle}**`)
            .setFooter({ text: 'Bài hát đã phát xong' })
            .setTimestamp();

        // Cập nhật message với embed mới và không có components (buttons)
        await guildData.currentMessage.edit({ 
            embeds: [completedEmbed], 
            components: [] // Xóa tất cả buttons
        });
        
        console.log(`✅ Đã xóa buttons cho bài: ${songTitle}`);
        
    } catch (error) {
        // Xử lý các lỗi phổ biến
        if (error.code === 10008) {
            console.log('⚠️ Message đã bị xóa, không thể update buttons');
        } else if (error.code === 50001) {
            console.log('⚠️ Không có quyền edit message');
        } else if (error.code === 10062) {
            console.log('⚠️ Message interaction đã expired');
        } else {
            console.error('❌ Lỗi khi xóa buttons:', error.message);
        }
    } finally {
        // Reset currentMessage reference sau khi xử lý (thành công hoặc lỗi)
        guildData.currentMessage = null;
    }
}

// Xử lý khi bài hát kết thúc
async function handleSongEnd(guildData) {
    const currentSong = guildData.currentSong;
    
    // Xóa buttons của bài vừa phát xong (nếu chưa được xóa)
    if (currentSong && guildData.currentMessage) {
        await removeButtons(guildData, currentSong.title);
    }
    
    switch (guildData.loopMode) {
        case 'track':
            // Lặp lại bài hiện tại
            playMusic(guildData);
            return;
            
        case 'queue':
            // Chuyển bài đầu xuống cuối queue
            const song = guildData.queue.shift();
            guildData.queue.push(song);
            playMusic(guildData);
            return;
            
        case 'off':
        default:
            // Bỏ bài đã phát
            guildData.queue.shift();
            
            // Nếu hết bài và autoplay bật, tìm bài liên quan
            if (guildData.queue.length === 0 && guildData.autoplay && currentSong) {
                await handleAutoplay(guildData, currentSong);
            } else {
                playMusic(guildData);
            }
            return;
    }
}

// Xử lý autoplay
async function handleAutoplay(guildData, lastSong) {
    try {
        const { searchYoutube } = require('./youtubeUtils');
        
        // Tìm kiếm bài hát liên quan dựa trên title
        const searchQuery = lastSong.title.split(' ').slice(0, 3).join(' '); // Lấy 3 từ đầu
        const relatedSong = await searchYoutube(searchQuery + ' music');
        
        if (relatedSong && relatedSong.url !== lastSong.url) {
            relatedSong.requester = 'Autoplay';
            guildData.queue.push(relatedSong);
            
            if (guildData.textChannel) {
                guildData.textChannel.send(`🎵 **Autoplay**: Đã thêm *${relatedSong.title}*`);
            }
        }
        
        playMusic(guildData);
    } catch (error) {
        console.error('Lỗi autoplay:', error);
        playMusic(guildData);
    }
}

module.exports = {
    musicData,
    formatDuration,
    initGuildMusicData,
    playMusic,
    createMusicConnection,
    handleSongEnd,
    removeButtons
};