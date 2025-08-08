const { joinVoiceChannel, createAudioPlayer, createAudioResource } = require('@discordjs/voice');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const ytdl = require('ytdl-core');

// Temporary maintenance mode for YouTube streaming issues
async function createAudioStream(url) {
    console.log('🚧 Bot đang trong chế độ bảo trì streaming');
    
    // Thông báo cho user biết tình trạng hiện tại
    throw new Error(`🚧 **Tính năng phát nhạc đang tạm thời bảo trì**

❌ **Vấn đề:** YouTube đang chặn tất cả bot music
⏰ **Thời gian:** Có thể kéo dài vài ngày  
🔧 **Nguyên nhân:** YouTube cập nhật chống bot

**Giải pháp tạm thời:**
1. Sử dụng bot music khác
2. Phát nhạc trực tiếp từ YouTube
3. Đợi cập nhật từ developer

Xin lỗi vì sự bất tiện! 🙏`);
}

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
            audioResource: null
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
        
        // Use the new fallback streaming function
        const { stream, inputType } = await createAudioStream(song.url);

        const resource = createAudioResource(stream, {
            inputType: inputType,
            inlineVolume: true
        });
        
        // Áp dụng volume setting
        if (resource.volume) {
            resource.volume.setVolume(guildData.volume / 100);
        }
        
        guildData.audioResource = resource;
        guildData.player.play(resource);

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
            // Lưu message để có thể update buttons sau
            guildData.currentMessage = message;
        }
    } catch (error) {
        console.error('Lỗi khi phát nhạc:', error);
        guildData.queue.shift(); // Bỏ qua bài hát lỗi
        playMusic(guildData); // Phát bài tiếp theo
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

        guildData.player.on('error', error => {
            console.error('Lỗi audio player:', error);
            guildData.queue.shift();
            playMusic(guildData);
        });
    }
}

// Xóa buttons của bài hát đã phát xong
async function removeButtons(guildData, songTitle) {
    if (guildData.currentMessage) {
        try {
            // Tạo embed mới với trạng thái "Đã hoàn thành" và không có buttons
            const completedEmbed = new EmbedBuilder()
                .setColor('#808080') // Màu xám cho bài đã hoàn thành
                .setTitle('✅ Đã hoàn thành')
                .setDescription(`**${songTitle}**`)
                .setFooter({ text: 'Bài hát đã phát xong' });

            // Cập nhật message với embed mới và không có components (buttons)
            await guildData.currentMessage.edit({ 
                embeds: [completedEmbed], 
                components: [] // Xóa tất cả buttons
            });
        } catch (error) {
            console.error('Lỗi khi xóa buttons:', error);
        }
    }
}

// Xử lý khi bài hát kết thúc
async function handleSongEnd(guildData) {
    const currentSong = guildData.currentSong;
    
    // Xóa buttons của bài vừa phát xong
    if (currentSong) {
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
