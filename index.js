const { Client, GatewayIntentBits, REST, Routes, EmbedBuilder, MessageFlags } = require('discord.js');
const { loadCommands, getCommandsData } = require('./utils/commandLoader');
const { checkDNSConnection } = require('./utils/youtubeUtils');
require('dotenv').config();

// Kiểm tra DNS ngay khi khởi động
async function initializeDNS() {
    console.log('🔍 Checking DNS connection...');
    const dnsOk = await checkDNSConnection();
    if (!dnsOk) {
        console.log('⚠️ DNS issues detected, but continuing...');
    }
}

// Gọi DNS check
initializeDNS();

// Health check server để tránh sleep trên Render
const express = require('express');
const app = express();

app.get('/', (req, res) => {
    res.json({
        status: 'online',
        bot: client.user ? client.user.tag : 'Starting...',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        guilds: client.guilds ? client.guilds.cache.size : 0,
        uptime: process.uptime()
    });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`🌐 Health check server running on port ${PORT}`);
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates
    ],
    // Thêm timeout và retry options
    ws: {
        version: 10,
        compress: true,
    },
    // Thêm DNS fallback
    rest: {
        timeout: 30000,
        retries: 3
    }
});

// Load tất cả commands
const commands = loadCommands();

client.once('ready', async () => {
    console.log(`🎵 ${client.user.tag} đã sẵn sàng phát nhạc!`);
    
    // Đăng ký slash commands
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    
    try {
        console.log('Đang đăng ký slash commands...');
        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: getCommandsData() }
        );
        console.log('Đã đăng ký slash commands thành công!');
    } catch (error) {
        console.error('Lỗi đăng ký commands:', error);
    }
});

client.on('interactionCreate', async interaction => {
    // Xử lý slash commands
    if (interaction.isChatInputCommand()) {
        const command = commands.get(interaction.commandName);

        if (!command) {
            console.error(`Không tìm thấy command ${interaction.commandName}.`);
            return;
        }

        try {
            await command.execute(interaction);
        } catch (error) {
            console.error('Lỗi khi thực thi command:', error);
            
            const errorMessage = '❌ Đã xảy ra lỗi khi thực thi command!';
            
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: errorMessage, flags: MessageFlags.Ephemeral });
            } else {
                await interaction.reply({ content: errorMessage, flags: MessageFlags.Ephemeral });
            }
        }
    }
    
    // Xử lý String Select Menu interactions
    if (interaction.isStringSelectMenu()) {
        const { initGuildMusicData, playMusic } = require('./utils/musicUtils');
        const guildData = initGuildMusicData(interaction.guild.id);
        
        try {
            switch (interaction.customId) {
                case 'select_song':
                    if (!guildData.queue || guildData.queue.length === 0) {
                        return interaction.reply({ content: '❌ Queue hiện tại đang trống!', flags: MessageFlags.Ephemeral });
                    }

                    const selectedIndex = parseInt(interaction.values[0]);
                    const selectedSong = guildData.queue[selectedIndex];
                    
                    if (!selectedSong) {
                        return interaction.reply({ content: '❌ Bài hát không tồn tại!', flags: MessageFlags.Ephemeral });
                    }

                    // Di chuyển bài được chọn lên đầu queue
                    guildData.queue.splice(selectedIndex, 1);
                    guildData.queue.unshift(selectedSong);

                    const embed = new EmbedBuilder()
                        .setColor('#00ff00')
                        .setTitle('🎵 Đã chọn bài để phát tiếp theo')
                        .setDescription(`**${selectedSong.title}**`)
                        .addFields(
                            { name: 'Vị trí cũ', value: `#${selectedIndex + 1}`, inline: true },
                            { name: 'Vị trí mới', value: '#1 (Tiếp theo)', inline: true }
                        )
                        .setThumbnail(selectedSong.thumbnail);

                    await interaction.update({ 
                        embeds: [embed], 
                        components: [] // Xóa select menu
                    });

                    // Nếu không đang phát, bắt đầu phát ngay
                    if (!guildData.isPlaying) {
                        const { createMusicConnection } = require('./utils/musicUtils');
                        createMusicConnection(interaction.member, guildData);
                        playMusic(guildData);
                    }
                    break;

                default:
                    interaction.reply({ content: '❌ Select menu không hợp lệ!', flags: MessageFlags.Ephemeral });
            }
        } catch (error) {
            console.error('Lỗi khi xử lý select menu:', error);
            
            if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
                try {
                    await interaction.reply({ content: '❌ Đã xảy ra lỗi!', flags: MessageFlags.Ephemeral });
                } catch (replyError) {
                    console.log('⚠️ Không thể reply interaction:', replyError.message);
                }
            }
        }
    }
    
    // Xử lý button interactions
    if (interaction.isButton()) {
        // Kiểm tra nếu interaction đã expired hoặc invalid
        if (!interaction.isRepliable()) {
            console.log('⚠️ Button interaction đã expired, bỏ qua...');
            return;
        }
        
        const { initGuildMusicData, playMusic, removeButtons } = require('./utils/musicUtils');
        const guildData = initGuildMusicData(interaction.guild.id);
        
        try {
            switch (interaction.customId) {
                case 'pause_music':
                    if (!guildData.player) {
                        return interaction.reply({ content: '❌ Không có nhạc nào đang phát!', flags: MessageFlags.Ephemeral });
                    }
                    guildData.player.pause();
                    interaction.reply({ content: '⏸️ Đã tạm dừng nhạc!', flags: MessageFlags.Ephemeral });
                    break;

                case 'resume_music':
                    if (!guildData.player) {
                        return interaction.reply({ content: '❌ Không có nhạc nào đang phát!', flags: MessageFlags.Ephemeral });
                    }
                    guildData.player.unpause();
                    interaction.reply({ content: '▶️ Đã tiếp tục phát nhạc!', flags: MessageFlags.Ephemeral });
                    break;

                case 'skip_music':
                    if (!guildData.player || guildData.queue.length === 0) {
                        return interaction.reply({ content: '❌ Không có nhạc nào để bỏ qua!', flags: MessageFlags.Ephemeral });
                    }
                    
                    // Lưu thông tin bài hiện tại trước khi skip
                    const currentSongTitle = guildData.currentSong ? guildData.currentSong.title : 'Unknown';
                    
                    // Xóa buttons ngay lập tức
                    if (guildData.currentSong && guildData.currentMessage) {
                        await removeButtons(guildData, currentSongTitle);
                    }
                    
                    // Dừng player (sẽ trigger handleSongEnd)
                    guildData.player.stop();
                    
                    interaction.reply({ content: '⏭️ Đã bỏ qua bài hát!', flags: MessageFlags.Ephemeral });
                    break;

                case 'stop_music':
                    if (!guildData.player) {
                        return interaction.reply({ content: '❌ Không có nhạc nào đang phát!', flags: MessageFlags.Ephemeral });
                    }
                    // Xóa buttons của bài hiện tại
                    if (guildData.currentSong) {
                        await removeButtons(guildData, guildData.currentSong.title);
                    }
                    guildData.queue = [];
                    guildData.player.stop();
                    interaction.reply({ content: '⏹️ Đã dừng phát nhạc và xóa danh sách!', flags: MessageFlags.Ephemeral });
                    break;

                case 'show_queue':
                    if (guildData.queue.length === 0) {
                        return interaction.reply({ content: '📭 danh sách trống!', flags: MessageFlags.Ephemeral });
                    }

                    const queueList = guildData.queue.slice(0, 10).map((song, index) => {
                        const status = index === 0 ? '🎵 ' : `${index + 1}. `;
                        return `${status}**${song.title}** - ${song.duration}`;
                    }).join('\n');

                    const queueEmbed = new EmbedBuilder()
                        .setColor('#0099ff')
                        .setTitle('🎵 Danh sách phát')
                        .setDescription(queueList)
                        .setFooter({ text: `Tổng cộng ${guildData.queue.length} bài hát` });

                    interaction.reply({ embeds: [queueEmbed], flags: MessageFlags.Ephemeral });
                    break;

                case 'show_lyrics':
                    if (guildData.queue.length === 0 || !guildData.currentSong) {
                        return interaction.reply({ content: '❌ Không có bài hát nào đang phát!', flags: MessageFlags.Ephemeral });
                    }

                    const { getLyrics } = require('./utils/lyricsUtils');
                    
                    // Defer reply vì lyrics có thể mất thời gian fetch
                    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                    
                    try {
                        const lyrics = await getLyrics(guildData.currentSong.title);
                        
                        if (!lyrics) {
                            return interaction.editReply({ content: '❌ Không tìm thấy lời bài hát!' });
                        }

                        const lyricsEmbed = new EmbedBuilder()
                            .setColor('#ff9900')
                            .setTitle(`🎤 ${guildData.currentSong.title}`)
                            .setDescription(lyrics.length > 4000 ? lyrics.substring(0, 4000) + '...' : lyrics)
                            .setFooter({ text: 'Lời bài hát từ Genius' });

                        interaction.editReply({ embeds: [lyricsEmbed] });
                    } catch (error) {
                        console.error('Lỗi khi lấy lyrics:', error);
                        interaction.editReply({ content: '❌ Đã xảy ra lỗi khi tìm lời bài hát!' });
                    }
                    break;

                // Quick Select buttons
                case 'select_song_0':
                case 'select_song_1':
                case 'select_song_2':
                case 'select_song_3':
                case 'select_song_4':
                    const songIndex = parseInt(interaction.customId.split('_')[2]);
                    
                    if (!guildData.queue || guildData.queue.length <= songIndex) {
                        return interaction.reply({ content: '❌ Bài hát không tồn tại!', flags: MessageFlags.Ephemeral });
                    }

                    if (songIndex === 0) {
                        return interaction.reply({ content: '❌ Bài này đang được phát!', flags: MessageFlags.Ephemeral });
                    }

                    const selectedSong = guildData.queue[songIndex];
                    // Di chuyển bài được chọn lên đầu queue (sau bài đang phát)
                    guildData.queue.splice(songIndex, 1);
                    guildData.queue.splice(1, 0, selectedSong);

                    const selectEmbed = new EmbedBuilder()
                        .setColor('#00ff00')
                        .setTitle('✅ Đã chọn bài tiếp theo')
                        .setDescription(`**${selectedSong.title}** sẽ phát sau bài hiện tại`)
                        .setThumbnail(selectedSong.thumbnail);

                    await interaction.reply({ embeds: [selectEmbed], flags: MessageFlags.Ephemeral });
                    break;

                // Control panel buttons
                case 'music_pause':
                    if (!guildData.player) {
                        return interaction.reply({ content: '❌ Không có nhạc nào đang phát!', flags: MessageFlags.Ephemeral });
                    }
                    guildData.player.pause();
                    guildData.isPlaying = false;
                    interaction.reply({ content: '⏸️ Đã tạm dừng nhạc!', flags: MessageFlags.Ephemeral });
                    break;

                case 'music_resume':
                    if (!guildData.player) {
                        return interaction.reply({ content: '❌ Không có nhạc nào để tiếp tục!', flags: MessageFlags.Ephemeral });
                    }
                    guildData.player.unpause();
                    guildData.isPlaying = true;
                    interaction.reply({ content: '▶️ Đã tiếp tục phát nhạc!', flags: MessageFlags.Ephemeral });
                    break;

                case 'music_skip':
                    if (!guildData.player || guildData.queue.length === 0) {
                        return interaction.reply({ content: '❌ Không có nhạc nào để bỏ qua!', flags: MessageFlags.Ephemeral });
                    }
                    guildData.player.stop();
                    interaction.reply({ content: '⏭️ Đã bỏ qua bài hát!', flags: MessageFlags.Ephemeral });
                    break;

                case 'music_stop':
                    if (!guildData.player) {
                        return interaction.reply({ content: '❌ Không có nhạc nào đang phát!', flags: MessageFlags.Ephemeral });
                    }
                    guildData.queue = [];
                    guildData.player.stop();
                    guildData.isPlaying = false;
                    interaction.reply({ content: '⏹️ Đã dừng nhạc và xóa queue!', flags: MessageFlags.Ephemeral });
                    break;

                case 'music_shuffle':
                    if (!guildData.queue || guildData.queue.length <= 2) {
                        return interaction.reply({ content: '❌ Cần ít nhất 3 bài để trộn!', flags: MessageFlags.Ephemeral });
                    }
                    
                    // Giữ bài đang phát, trộn phần còn lại
                    const currentSong = guildData.queue.shift();
                    for (let i = guildData.queue.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [guildData.queue[i], guildData.queue[j]] = [guildData.queue[j], guildData.queue[i]];
                    }
                    guildData.queue.unshift(currentSong);
                    
                    interaction.reply({ content: '🔀 Đã trộn danh sách phát!', flags: MessageFlags.Ephemeral });
                    break;

                // Volume controls
                case 'volume_down':
                    guildData.volume = Math.max(0, (guildData.volume || 50) - 10);
                    if (guildData.resource) {
                        guildData.resource.volume.setVolume(guildData.volume / 100);
                    }
                    interaction.reply({ content: `🔉 Âm lượng: ${guildData.volume}%`, flags: MessageFlags.Ephemeral });
                    break;

                case 'volume_up':
                    guildData.volume = Math.min(100, (guildData.volume || 50) + 10);
                    if (guildData.resource) {
                        guildData.resource.volume.setVolume(guildData.volume / 100);
                    }
                    interaction.reply({ content: `🔊 Âm lượng: ${guildData.volume}%`, flags: MessageFlags.Ephemeral });
                    break;

                case 'volume_mute':
                    guildData.volume = 0;
                    if (guildData.resource) {
                        guildData.resource.volume.setVolume(0);
                    }
                    interaction.reply({ content: '🔇 Đã tắt tiếng!', flags: MessageFlags.Ephemeral });
                    break;

                case 'volume_max':
                    guildData.volume = 100;
                    if (guildData.resource) {
                        guildData.resource.volume.setVolume(1);
                    }
                    interaction.reply({ content: '📢 Âm lượng tối đa!', flags: MessageFlags.Ephemeral });
                    break;

                case 'volume_reset':
                    guildData.volume = 50;
                    if (guildData.resource) {
                        guildData.resource.volume.setVolume(0.5);
                    }
                    interaction.reply({ content: '🔄 Đã reset âm lượng về 50%!', flags: MessageFlags.Ephemeral });
                    break;

                // Queue management
                case 'show_full_queue':
                    if (guildData.queue.length === 0) {
                        return interaction.reply({ content: '📭 Queue đang trống!', flags: MessageFlags.Ephemeral });
                    }

                    const fullQueueList = guildData.queue.slice(0, 25).map((song, index) => {
                        const status = index === 0 ? '🎵 ' : `${index + 1}. `;
                        return `${status}**${song.title}**`;
                    }).join('\n');

                    const fullQueueEmbed = new EmbedBuilder()
                        .setColor('#0099ff')
                        .setTitle('📋 Toàn bộ Queue')
                        .setDescription(fullQueueList)
                        .setFooter({ text: `Hiển thị ${Math.min(25, guildData.queue.length)}/${guildData.queue.length} bài` });

                    interaction.reply({ embeds: [fullQueueEmbed], flags: MessageFlags.Ephemeral });
                    break;

                case 'show_nowplaying':
                    if (!guildData.currentSong) {
                        return interaction.reply({ content: '❌ Không có bài nào đang phát!', flags: MessageFlags.Ephemeral });
                    }

                    const nowPlayingEmbed = new EmbedBuilder()
                        .setColor('#ff6600')
                        .setTitle('🎵 Đang phát')
                        .setDescription(`**${guildData.currentSong.title}**`)
                        .addFields(
                            { name: '⏱️ Thời lượng', value: guildData.currentSong.duration || 'Không xác định', inline: true },
                            { name: '👤 Yêu cầu bởi', value: `<@${guildData.currentSong.requestedBy}>`, inline: true },
                            { name: '🔊 Âm lượng', value: `${guildData.volume || 50}%`, inline: true }
                        )
                        .setThumbnail(guildData.currentSong.thumbnail);

                    interaction.reply({ embeds: [nowPlayingEmbed], flags: MessageFlags.Ephemeral });
                    break;

                case 'loop_toggle':
                    guildData.loop = !guildData.loop;
                    const loopStatus = guildData.loop ? 'BẬT' : 'TẮT';
                    const loopEmoji = guildData.loop ? '🔁' : '▶️';
                    interaction.reply({ content: `${loopEmoji} Đã ${loopStatus} chế độ lặp!`, flags: MessageFlags.Ephemeral });
                    break;

                case 'quick_select':
                    // Gọi lại quick select command
                    const quickSelectCommand = require('./commands/quickselect');
                    await quickSelectCommand.execute(interaction);
                    break;

                case 'clear_queue':
                    if (guildData.queue.length <= 1) {
                        return interaction.reply({ content: '❌ Queue đã trống hoặc chỉ có bài đang phát!', flags: MessageFlags.Ephemeral });
                    }
                    
                    const removedCount = guildData.queue.length - 1;
                    guildData.queue = guildData.queue.slice(0, 1); // Giữ lại bài đang phát
                    interaction.reply({ content: `🗑️ Đã xóa ${removedCount} bài khỏi queue!`, flags: MessageFlags.Ephemeral });
                    break;

                case 'leave_voice':
                    if (guildData.connection) {
                        guildData.connection.destroy();
                        guildData.connection = null;
                        guildData.player = null;
                        guildData.isPlaying = false;
                    }
                    interaction.reply({ content: '👋 Đã rời khỏi voice channel!', flags: MessageFlags.Ephemeral });
                    break;

                // Recommendation buttons
                case 'recommend_add_all':
                    if (!guildData.recommendations || guildData.recommendations.length === 0) {
                        return interaction.reply({ content: '❌ Không có gợi ý nào để thêm!', flags: MessageFlags.Ephemeral });
                    }
                    
                    // Thêm tất cả gợi ý vào queue
                    for (const song of guildData.recommendations) {
                        song.requestedBy = interaction.user.id;
                        guildData.queue.push(song);
                    }
                    
                    interaction.reply({ 
                        content: `✅ Đã thêm ${guildData.recommendations.length} bài gợi ý vào queue!`, 
                        flags: MessageFlags.Ephemeral 
                    });
                    
                    // Bắt đầu phát nếu chưa phát
                    if (!guildData.isPlaying) {
                        const { createMusicConnection } = require('./utils/musicUtils');
                        createMusicConnection(interaction.member, guildData);
                        playMusic(guildData);
                    }
                    break;

                case 'recommend_refresh':
                    const recommendCommand = require('./commands/recommend');
                    await recommendCommand.execute(interaction);
                    break;

                case 'recommend_close':
                    guildData.recommendations = null;
                    await interaction.update({ content: '❌ Đã đóng gợi ý nhạc.', embeds: [], components: [] });
                    break;

                // Music Quiz buttons
                case 'quiz_start':
                    if (!guildData.musicQuiz) {
                        return interaction.reply({ content: '❌ Quiz đã kết thúc!', flags: MessageFlags.Ephemeral });
                    }
                    
                    const quizCommand = require('./commands/musicquiz');
                    await quizCommand.showQuestion(interaction, guildData);
                    break;

                case 'quiz_answer_0':
                case 'quiz_answer_1':
                case 'quiz_answer_2':
                case 'quiz_answer_3':
                    if (!guildData.musicQuiz || !guildData.musicQuiz.isActive) {
                        return interaction.reply({ content: '❌ Quiz đã kết thúc!', flags: MessageFlags.Ephemeral });
                    }

                    const answerIndex = parseInt(interaction.customId.split('_')[2]);
                    const quiz = guildData.musicQuiz;
                    const question = quiz.currentQuestion;
                    
                    if (!question) {
                        return interaction.reply({ content: '❌ Không có câu hỏi nào!', flags: MessageFlags.Ephemeral });
                    }

                    const isCorrect = answerIndex === question.correctIndex;
                    const userId = interaction.user.id;
                    
                    if (!quiz.score[userId]) {
                        quiz.score[userId] = 0;
                    }
                    
                    if (isCorrect) {
                        quiz.score[userId] += 10;
                        await interaction.reply({ 
                            content: `✅ Đúng rồi! +10 điểm! Tổng: ${quiz.score[userId]} điểm`, 
                            flags: MessageFlags.Ephemeral 
                        });
                    } else {
                        await interaction.reply({ 
                            content: `❌ Sai rồi! Đáp án đúng là: ${question.answers[question.correctIndex].title}`, 
                            flags: MessageFlags.Ephemeral 
                        });
                    }

                    // Chuyển câu tiếp theo
                    setTimeout(() => {
                        quiz.currentRound++;
                        const quizCmd = require('./commands/musicquiz');
                        quizCmd.showQuestion(interaction, guildData);
                    }, 2000);
                    break;

                case 'quiz_skip':
                    if (guildData.musicQuiz) {
                        guildData.musicQuiz.currentRound++;
                        const quizCmd = require('./commands/musicquiz');
                        await quizCmd.showQuestion(interaction, guildData);
                    }
                    break;

                case 'quiz_stop':
                    if (guildData.musicQuiz) {
                        const quizCmd = require('./commands/musicquiz');
                        await quizCmd.endQuiz(interaction, guildData);
                    }
                    break;

                case 'quiz_cancel':
                    delete guildData.musicQuiz;
                    await interaction.update({ content: '❌ Đã hủy music quiz.', embeds: [], components: [] });
                    break;

                // Karaoke buttons
                case 'karaoke_start':
                    if (!guildData.karaokeData) {
                        return interaction.reply({ content: '❌ Karaoke chưa được khởi tạo!', flags: MessageFlags.Ephemeral });
                    }
                    
                    // Bắt đầu hiển thị lyrics
                    guildData.karaokeData.interval = setInterval(async () => {
                        if (guildData.karaokeData.currentLine < guildData.karaokeData.lyrics.length) {
                            const currentLine = guildData.karaokeData.lyrics[guildData.karaokeData.currentLine];
                            
                            try {
                                await interaction.followUp({ 
                                    content: `🎤 ${currentLine}`, 
                                    flags: MessageFlags.Ephemeral 
                                });
                            } catch (error) {
                                console.log('Karaoke error:', error.message);
                            }
                            
                            guildData.karaokeData.currentLine++;
                        } else {
                            clearInterval(guildData.karaokeData.interval);
                        }
                    }, 3000); // Mỗi 3 giây 1 dòng
                    
                    interaction.reply({ content: '🎤 Karaoke đã bắt đầu!', flags: MessageFlags.Ephemeral });
                    break;

                case 'karaoke_pause':
                    if (guildData.karaokeData?.interval) {
                        clearInterval(guildData.karaokeData.interval);
                        guildData.karaokeData.interval = null;
                        interaction.reply({ content: '⏸️ Karaoke đã tạm dừng!', flags: MessageFlags.Ephemeral });
                    }
                    break;

                case 'karaoke_next_line':
                    if (guildData.karaokeData) {
                        guildData.karaokeData.currentLine++;
                        const line = guildData.karaokeData.lyrics[guildData.karaokeData.currentLine];
                        interaction.reply({ 
                            content: line ? `🎤 ${line}` : '🎵 Kết thúc!', 
                            flags: MessageFlags.Ephemeral 
                        });
                    }
                    break;

                case 'karaoke_prev_line':
                    if (guildData.karaokeData) {
                        guildData.karaokeData.currentLine = Math.max(0, guildData.karaokeData.currentLine - 1);
                        const line = guildData.karaokeData.lyrics[guildData.karaokeData.currentLine];
                        interaction.reply({ 
                            content: line ? `🎤 ${line}` : '🎵 Đầu bài!', 
                            flags: MessageFlags.Ephemeral 
                        });
                    }
                    break;

                case 'karaoke_stop':
                    if (guildData.karaokeData?.interval) {
                        clearInterval(guildData.karaokeData.interval);
                    }
                    guildData.karaokeMode = false;
                    guildData.karaokeData = null;
                    await interaction.update({ content: '⏹️ Karaoke đã dừng.', embeds: [], components: [] });
                    break;

                // Visualizer buttons
                case 'visualizer_pause':
                case 'visualizer_style':
                case 'visualizer_speed':
                case 'visualizer_stop':
                    const visualizerCommand = require('./commands/visualizer');
                    await visualizerCommand.handleVisualizerButton(interaction, interaction.customId, guildData);
                    break;

                // Stats buttons
                case 'stats_personal':
                case 'stats_server':
                case 'stats_top_songs':
                case 'stats_top_users':
                    const statsCommand = require('./commands/stats');
                    const statsType = interaction.customId.split('_')[1];
                    await statsCommand.execute({
                        ...interaction,
                        options: {
                            getString: () => statsType
                        }
                    });
                    break;

                // Recommend play buttons
                default:
                    if (interaction.customId.startsWith('recommend_play_')) {
                        const songIndex = parseInt(interaction.customId.split('_')[2]);
                        
                        if (guildData.recommendations && guildData.recommendations[songIndex]) {
                            const song = guildData.recommendations[songIndex];
                            song.requestedBy = interaction.user.id;
                            guildData.queue.push(song);
                            
                            interaction.reply({ 
                                content: `✅ Đã thêm "${song.title}" vào queue!`, 
                                flags: MessageFlags.Ephemeral 
                            });
                            
                            if (!guildData.isPlaying) {
                                const { createMusicConnection } = require('./utils/musicUtils');
                                createMusicConnection(interaction.member, guildData);
                                playMusic(guildData);
                            }
                        }
                    } else {
                        interaction.reply({ content: '❌ Button không hợp lệ!', flags: MessageFlags.Ephemeral });
                    }
            }
        } catch (error) {
            console.error('Lỗi khi xử lý button:', error);
            
            // Kiểm tra nếu interaction vẫn có thể reply
            if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
                try {
                    await interaction.reply({ content: '❌ Đã xảy ra lỗi!', flags: MessageFlags.Ephemeral });
                } catch (replyError) {
                    console.log('⚠️ Không thể reply interaction (có thể đã expired):', replyError.message);
                }
            }
        }
    }
});

// Error handling cho connection issues
client.on('error', (error) => {
    console.error('Discord client error:', error);
    if (error.code === 'ENOTFOUND') {
        console.log('🔄 Trying to reconnect in 5 seconds...');
        setTimeout(() => {
            client.login(process.env.DISCORD_TOKEN).catch(console.error);
        }, 5000);
    }
});

client.on('shardError', (error) => {
    console.error('A websocket connection encountered an error:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.log('Unhandled Rejection at:', promise, 'reason:', reason);
});

// DNS fallback function
async function connectWithRetry() {
    const maxRetries = 3;
    for (let i = 0; i < maxRetries; i++) {
        try {
            console.log(`🔄 Attempting to connect to Discord... (${i + 1}/${maxRetries})`);
            await client.login(process.env.DISCORD_TOKEN);
            console.log('✅ Successfully connected to Discord!');
            break;
        } catch (error) {
            console.error(`❌ Connection attempt ${i + 1} failed:`, error.message);
            if (i === maxRetries - 1) {
                console.error('🚫 All connection attempts failed. Please check your internet connection and Discord token.');
                process.exit(1);
            }
            console.log(`⏳ Waiting 5 seconds before retry...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

// Start connection with retry
connectWithRetry();
