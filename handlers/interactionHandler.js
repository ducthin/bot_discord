const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { AudioPlayerStatus } = require('@discordjs/voice');
const { buttonNeedsVoice, getVoiceAccessError } = require('../utils/voiceAccess');
const { requestSkip } = require('../utils/skipVote');

async function handleStringSelectMenu(interaction) {
    const { initGuildMusicData, seekMusic } = require('../utils/musicUtils');
    const guildData = initGuildMusicData(interaction.guild.id);
    
    try {
        if (interaction.customId === 'favorite_play' || interaction.customId === 'favorite_remove') {
            return await require('../commands/favorites').selectTrack(interaction, guildData);
        }
        if (interaction.customId.startsWith('queue_next_') || interaction.customId === 'music_seek_menu') {
            const error = getVoiceAccessError(interaction.member, guildData);
            if (error) return await interaction.reply({ content: error, flags: MessageFlags.Ephemeral });
        }
        if (interaction.customId.startsWith('queue_next_')) {
            return await require('../commands/queue').selectNext(interaction, guildData);
        }
        switch (interaction.customId) {
            case 'select_song':
                return interaction.reply({ content: '❌ Menu cũ đã hết hạn. Mở /queue để chọn bài.', flags: MessageFlags.Ephemeral });

            case 'music_seek_menu': {
                if (!guildData.currentSong || !guildData.player) {
                    return interaction.reply({ content: '❌ Không có nhạc nào đang phát!', flags: MessageFlags.Ephemeral });
                }

                const targetTime = parseInt(interaction.values[0]);
                if (isNaN(targetTime)) {
                    return interaction.reply({ content: '❌ Mốc thời gian không hợp lệ!', flags: MessageFlags.Ephemeral });
                }

                const song = guildData.currentSong;
                await interaction.deferUpdate();

                if (!await seekMusic(guildData, targetTime, song)) {
                    await interaction.followUp({ content: '❌ Không tua được bài hát.', flags: MessageFlags.Ephemeral });
                }
                break;
            }

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

async function handleButton(interaction) {
    // Kiểm tra nếu interaction đã expired hoặc invalid
    if (!interaction.isRepliable()) {
        console.log('⚠️ Button interaction đã expired, bỏ qua...');
        return;
    }
    
    if (/^(?:quiz_|recommend_|visualizer_)/.test(interaction.customId)) {
        return interaction.reply({ content: '❌ Tính năng này đã được gỡ. Dùng /help để xem các lệnh hiện tại.', flags: MessageFlags.Ephemeral });
    }

    const { initGuildMusicData, playMusic, seekMusic } = require('../utils/musicUtils');
    const guildData = initGuildMusicData(interaction.guild.id);
    
    try {
        if (interaction.customId.startsWith('voice_call_')) {
            return await require('../commands/call').respond(interaction);
        }
        if (interaction.customId.startsWith('favorite_save_')) {
            return await require('../commands/favorites').saveCurrent(interaction, guildData);
        }
        if (buttonNeedsVoice(interaction.customId)) {
            const error = getVoiceAccessError(interaction.member, guildData);
            if (error) return await interaction.reply({ content: error, flags: MessageFlags.Ephemeral });
        }
        if (interaction.customId.startsWith('queue_page_')) {
            return await require('../commands/queue').changePage(interaction, guildData);
        }
        switch (interaction.customId) {
            case 'toggle_playback': {
                const player = guildData.player;
                if (!guildData.currentSong || !player) {
                    return interaction.reply({ content: '❌ Không có bài nào đang phát.', flags: MessageFlags.Ephemeral });
                }
                if (player.state.status === AudioPlayerStatus.AutoPaused) {
                    return interaction.reply({ content: '⏳ Bot sẽ tự phát tiếp khi kết nối voice sẵn sàng.', flags: MessageFlags.Ephemeral });
                }
                const paused = player.state.status === AudioPlayerStatus.Paused;
                const changed = paused ? player.unpause() : player.pause();
                const content = changed
                    ? (paused ? '▶️ Đã tiếp tục phát nhạc.' : '⏸️ Đã tạm dừng nhạc.')
                    : '⏳ Bot chưa thể chuyển trạng thái. Thử lại khi bài đã tải xong.';
                return interaction.reply({ content, flags: MessageFlags.Ephemeral });
            }

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

            case 'stop_music':
                await require('../utils/musicUtils').stopMusic(guildData);
                await interaction.reply({ content: '⏹️ Đã dừng nhạc và xóa queue!', flags: MessageFlags.Ephemeral });
                break;

            case 'show_queue':
            case 'show_full_queue':
            case 'quick_select':
                return await require('../commands/queue').show(interaction, guildData);

            case 'show_lyrics':
                return await require('../commands/lyrics').execute(interaction);

            case 'select_song_0':
            case 'select_song_1':
            case 'select_song_2':
            case 'select_song_3':
            case 'select_song_4':
                return interaction.reply({ content: '❌ Menu cũ đã hết hạn. Mở /queue để chọn bài.', flags: MessageFlags.Ephemeral });

            // Control panel buttons
            case 'music_pause':
                if (!guildData.player) {
                    return interaction.reply({ content: '❌ Không có nhạc nào đang phát!', flags: MessageFlags.Ephemeral });
                }
                guildData.player.pause();
                
                if (interaction.message) {
                    const updatedComponents = [...interaction.message.components];
                    const updatedRow = ActionRowBuilder.from(updatedComponents[0]);
                    updatedRow.components[0] = new ButtonBuilder()
                        .setCustomId('music_resume')
                        .setLabel('▶️ Tiếp tục')
                        .setStyle(ButtonStyle.Success);
                    updatedComponents[0] = updatedRow;
                    await interaction.update({ components: updatedComponents });
                } else {
                    interaction.reply({ content: '⏸️ Đã tạm dừng nhạc!', flags: MessageFlags.Ephemeral });
                }
                break;

            case 'music_resume':
                if (!guildData.player) {
                    return interaction.reply({ content: '❌ Không có nhạc nào để tiếp tục!', flags: MessageFlags.Ephemeral });
                }
                guildData.player.unpause();
                guildData.isPlaying = true;
                
                if (interaction.message) {
                    const updatedComponents = [...interaction.message.components];
                    const updatedRow = ActionRowBuilder.from(updatedComponents[0]);
                    updatedRow.components[0] = new ButtonBuilder()
                        .setCustomId('music_pause')
                        .setLabel('⏸️ Tạm dừng')
                        .setStyle(ButtonStyle.Secondary);
                    updatedComponents[0] = updatedRow;
                    await interaction.update({ components: updatedComponents });
                } else {
                    interaction.reply({ content: '▶️ Đã tiếp tục phát nhạc!', flags: MessageFlags.Ephemeral });
                }
                break;

            case 'seek_back_30': {
                if (!guildData.currentSong || !guildData.player) {
                    return interaction.reply({ content: '❌ Không có nhạc nào đang phát!', flags: MessageFlags.Ephemeral });
                }
                const { getCurrentPlaybackTime, durationToSeconds } = require('../utils/musicUtils');
                const totalSec = durationToSeconds(guildData.currentSong.duration);
                if (totalSec <= 0) {
                    return interaction.reply({ content: '❌ Đây là livestream hoặc bài hát không có thời lượng cố định, không thể tua!', flags: MessageFlags.Ephemeral });
                }
                const currentPos = getCurrentPlaybackTime(guildData);
                const targetTime = Math.max(0, currentPos - 30);
                
                const song = guildData.currentSong;
                await interaction.deferUpdate();
                
                if (!await seekMusic(guildData, targetTime, song)) {
                    await interaction.followUp({ content: '❌ Không tua được bài hát.', flags: MessageFlags.Ephemeral });
                }
                break;
            }

            case 'seek_forward_30': {
                if (!guildData.currentSong || !guildData.player) {
                    return interaction.reply({ content: '❌ Không có nhạc nào đang phát!', flags: MessageFlags.Ephemeral });
                }
                const { getCurrentPlaybackTime, durationToSeconds } = require('../utils/musicUtils');
                const currentPos = getCurrentPlaybackTime(guildData);
                const totalSec = durationToSeconds(guildData.currentSong.duration);
                if (totalSec <= 0) {
                    return interaction.reply({ content: '❌ Đây là livestream hoặc bài hát không có thời lượng cố định, không thể tua!', flags: MessageFlags.Ephemeral });
                }
                if (currentPos >= totalSec - 2) {
                    return interaction.reply({ content: '❌ Bài hát đã sắp kết thúc, không thể tua thêm!', flags: MessageFlags.Ephemeral });
                }
                const targetTime = Math.min(totalSec - 2, currentPos + 30);

                const song = guildData.currentSong;
                await interaction.deferUpdate();
                
                if (!await seekMusic(guildData, targetTime, song)) {
                    await interaction.followUp({ content: '❌ Không tua được bài hát.', flags: MessageFlags.Ephemeral });
                }
                break;
            }

            case 'skip_music':
            case 'music_skip': {
                const result = requestSkip(interaction.member, guildData);
                return interaction.reply({ content: result.content, flags: result.private ? MessageFlags.Ephemeral : undefined });
            }

            case 'music_stop':
                await require('../utils/musicUtils').stopMusic(guildData);
                await interaction.reply({ content: '⏹️ Đã dừng nhạc và xóa queue!', flags: MessageFlags.Ephemeral });
                break;

            case 'music_shuffle':
            case 'shuffle_music': // alias for queue.js button
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
                guildData.volume = Math.max(0, (guildData.volume ?? 50) - 10);
                if (guildData.audioResource && guildData.audioResource.volume) {
                    guildData.audioResource.volume.setVolume(guildData.volume / 100);
                }
                interaction.reply({ content: `🔉 Âm lượng: ${guildData.volume}%`, flags: MessageFlags.Ephemeral });
                break;

            case 'volume_up':
                guildData.volume = Math.min(100, (guildData.volume ?? 50) + 10);
                if (guildData.audioResource && guildData.audioResource.volume) {
                    guildData.audioResource.volume.setVolume(guildData.volume / 100);
                }
                interaction.reply({ content: `🔊 Âm lượng: ${guildData.volume}%`, flags: MessageFlags.Ephemeral });
                break;

            case 'volume_mute':
                guildData.volume = 0;
                if (guildData.audioResource && guildData.audioResource.volume) {
                    guildData.audioResource.volume.setVolume(0);
                }
                interaction.reply({ content: '🔇 Đã tắt tiếng!', flags: MessageFlags.Ephemeral });
                break;

            case 'volume_max':
                guildData.volume = 100;
                if (guildData.audioResource && guildData.audioResource.volume) {
                    guildData.audioResource.volume.setVolume(1);
                }
                interaction.reply({ content: '📢 Âm lượng tối đa!', flags: MessageFlags.Ephemeral });
                break;

            case 'volume_reset':
                guildData.volume = 50;
                if (guildData.audioResource && guildData.audioResource.volume) {
                    guildData.audioResource.volume.setVolume(0.5);
                }
                interaction.reply({ content: '🔄 Đã reset âm lượng về 50%!', flags: MessageFlags.Ephemeral });
                break;

            // Queue management
            case 'show_nowplaying':
                return await require('../commands/nowplaying').show(interaction, guildData, MessageFlags.Ephemeral);

            case 'loop_toggle':
                guildData.loopMode = guildData.loopMode === 'off' ? 'queue' : 'off';
                const loopStatus = guildData.loopMode !== 'off' ? 'BẬT' : 'TẮT';
                const loopEmoji = guildData.loopMode !== 'off' ? '🔁' : '▶️';
                interaction.reply({ content: `${loopEmoji} Đã ${loopStatus} chế độ lặp!`, flags: MessageFlags.Ephemeral });
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
                if (guildData.connection) await require('../utils/musicUtils').disconnectMusic(guildData);
                interaction.reply({ content: '👋 Đã rời khỏi voice channel!', flags: MessageFlags.Ephemeral });
                break;

            // Stats buttons
            case 'stats_personal':
            case 'stats_server':
            case 'stats_top_songs':
            case 'stats_top_users': {
                const statsCommand = require('../commands/stats');
                const statsType = interaction.customId.replace('stats_', '');
                // Tạo một interaction giả để gọi execute
                if (!interaction.deferred && !interaction.replied) {
                    await interaction.deferUpdate();
                }
                await statsCommand.execute(interaction, statsType);
                break;
            }

            // Trending buttons
            default:
                if (interaction.customId.startsWith('trending_')) {
                    switch (interaction.customId) {
                        case 'trending_play_now':
                            if (!guildData.isPlaying && guildData.queue.length > 0) {
                                const { createMusicConnection } = require('../utils/musicUtils');
                                createMusicConnection(interaction.member, guildData);
                                playMusic(guildData);
                            }
                            interaction.reply({ content: '▶️ Đã bắt đầu phát nhạc trending!', flags: MessageFlags.Ephemeral });
                            break;

                        case 'trending_shuffle':
                            if (guildData.queue.length > 1) {
                                // Trộn queue (giữ bài đang phát)
                                const current = guildData.queue.shift();
                                for (let i = guildData.queue.length - 1; i > 0; i--) {
                                    const j = Math.floor(Math.random() * (i + 1));
                                    [guildData.queue[i], guildData.queue[j]] = [guildData.queue[j], guildData.queue[i]];
                                }
                                guildData.queue.unshift(current);
                                interaction.reply({ content: '🔀 Đã trộn danh sách trending!', flags: MessageFlags.Ephemeral });
                            } else {
                                interaction.reply({ content: '❌ Cần ít nhất 2 bài để trộn!', flags: MessageFlags.Ephemeral });
                            }
                            break;

                        case 'trending_more':
                            const trendingCommand = require('../commands/trending');
                            // Re-execute với 10 bài thêm
                            await trendingCommand.execute(interaction);
                            break;

                        case 'trending_refresh':
                            const refreshCommand = require('../commands/trending');
                            await refreshCommand.execute(interaction);
                            break;
                    }
                }
                // Auto-trending region buttons
                else if (interaction.customId.startsWith('autotrending_')) {
                    const region = interaction.customId.split('_')[1];
                    
                    if (region === 'off') {
                        guildData.autoTrending.enabled = false;
                        await interaction.update({ 
                            content: '❌ Đã tắt auto-trending.', 
                            embeds: [], 
                            components: [] 
                        });
                    } else {
                        const regionMap = {
                            'vn': 'VN',
                            'kr': 'KR', 
                            'us': 'US',
                            'global': 'GLOBAL',
                            'asia': 'ASIA'
                        };
                        
                        const selectedRegion = regionMap[region] || 'VN';
                        guildData.autoTrending = {
                            enabled: true,
                            region: selectedRegion,
                            lastFetch: null,
                            count: 0,
                            trendingList: [],
                            playedSongs: new Set(),
                            consecutiveFailures: 0,
                            lastSearchTime: 0
                        };
                        
                        const trendingCommand = require('../commands/trending');
                        const regionName = trendingCommand.getRegionDisplayName(selectedRegion);
                        
                        await interaction.update({ 
                            content: `✅ Đã chọn auto-trending: ${regionName}`, 
                            embeds: [], 
                            components: [] 
                        });
                    }
                }
                else {
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

module.exports = {
    handleStringSelectMenu,
    handleButton
};
