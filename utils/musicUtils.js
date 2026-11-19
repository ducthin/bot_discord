const { joinVoiceChannel, createAudioPlayer, createAudioResource, VoiceConnectionStatus, AudioPlayerStatus, entersState, NoSubscriberBehavior } = require('@discordjs/voice');
const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, escapeMarkdown } = require('discord.js');
const { getVoiceAccessError } = require('./voiceAccess');
const { buildPlaybackRows } = require('./playbackControls');

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

// Chuyển MM:SS hoặc HH:MM:SS thành giây
function durationToSeconds(durationStr) {
    if (!durationStr) return 0;
    if (typeof durationStr === 'number') return durationStr;
    const parts = durationStr.split(':').map(Number);
    if (parts.some(isNaN)) return 0;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return parseInt(durationStr) || 0;
}

// Tạo thanh progress bar
function createProgressBar(currentTime, totalTime, barSize = 25) {
    if (isNaN(currentTime) || isNaN(totalTime) || totalTime <= 0) {
        const emptyBar = '▬'.repeat(barSize - 1);
        return `🔘${emptyBar} [00:00 / 00:00]`;
    }

    const progress = Math.min(1, currentTime / totalTime);
    const totalSegments = barSize - 1;
    const progressSegments = Math.round(totalSegments * progress);

    const left = '▬'.repeat(progressSegments);
    const right = '▬'.repeat(totalSegments - progressSegments);
    const progressText = left + '🔘' + right;

    return `${progressText} [${formatDuration(currentTime)} / ${formatDuration(totalTime)}]`;
}

// Lấy thời gian phát hiện tại
function getCurrentPlaybackTime(guildData) {
    if (!guildData.currentSong) return 0;
    const offset = guildData.currentSong.seekOffset || 0;
    const playbackMs = guildData.audioResource?.playbackDuration || 0;
    return offset + Math.floor(playbackMs / 1000);
}

function buildNowPlayingEmbed(guildData) {
    const song = guildData.currentSong;
    const status = guildData.player?.state?.status;
    const paused = status === AudioPlayerStatus.Paused || status === AudioPlayerStatus.AutoPaused;
    const state = paused ? '⏸️ Đang tạm dừng' :
        status === AudioPlayerStatus.Playing ? '▶️ Đang phát' : '⏳ Đang tải nhạc';
    const firstUpcoming = Number(guildData.queue[0] === song);
    const nextSong = guildData.queue[firstUpcoming];
    const waitingCount = guildData.queue.length - firstUpcoming;
    const loopMode = { off: 'Tắt', track: 'Một bài', queue: 'Hàng đợi' }[guildData.loopMode] || 'Tắt';
    const duration = durationToSeconds(song.duration);
    const currentTime = getCurrentPlaybackTime(guildData);
    const progress = duration > 0
        ? createProgressBar(Math.min(currentTime, duration), duration, 14)
        : formatDuration(currentTime) + ' / —';

    const embed = new EmbedBuilder()
        .setColor(paused ? '#f0b232' : '#57f287')
        .setAuthor({ name: state })
        .setTitle(String(song.title || 'Không rõ tên').slice(0, 256))
        .setDescription(progress)
        .addFields(
            { name: '🔊 Âm lượng', value: `${guildData.volume ?? 50}%`, inline: true },
            { name: '🔁 Lặp', value: loopMode, inline: true },
            { name: '👤 Người yêu cầu', value: escapeMarkdown(String(song.requester || song.requestedBy || 'Không rõ').slice(0, 150)), inline: true },
            {
                name: `📋 Hàng đợi · ${waitingCount} bài chờ`,
                value: nextSong ? escapeMarkdown(String(nextSong.title || 'Không rõ tên').slice(0, 180)) : 'Chưa có bài tiếp theo'
            }
        )
        .setThumbnail(song.thumbnail || null);
    if (typeof song.url === 'string' && /^https?:\/\//i.test(song.url) && URL.canParse(song.url)) {
        embed.setURL(song.url);
    }
    return embed;
}

// Xóa interval cập nhật thanh tiến trình
function clearProgressInterval(guildData) {
    clearInterval(guildData.progressInterval);
    guildData.progressInterval = null;
}

function clearPlaybackMessage(guildData) {
    clearProgressInterval(guildData);
    const message = guildData.currentMessage;
    guildData.currentMessage = null;
    return deletePlaybackMessage(message);
}

// Khởi tạo dữ liệu music cho guild
function initGuildMusicData(guildId) {
    if (!musicData.has(guildId)) {
        musicData.set(guildId, {
            guildId,
            queue: [],
            queueEpoch: 0,
            isPlaying: false,
            currentSong: null,
            skipVote: null,
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
            consecutivePlaybackErrors: 0,
            isManualSkip: false,
            songPlayStartTime: 0,
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

async function resetPlayback(guildData) {
    guildData.playbackGeneration = (guildData.playbackGeneration || 0) + 1;
    guildData.currentSong = null;
    guildData.skipVote = null;
    guildData.isPlaying = false;
    guildData.isSeeking = false;
    guildData.isManualSkip = false;
    guildData.retryingCurrentSong = false;
    guildData.player?.stop(true);
    guildData.audioResource = null;
    await clearPlaybackMessage(guildData);
}

function stopMusic(guildData) {
    guildData.queueEpoch = (guildData.queueEpoch || 0) + 1;
    guildData.queue = [];
    guildData.autoplay = false;
    if (guildData.autoTrending) guildData.autoTrending.enabled = false;
    return resetPlayback(guildData);
}

function enqueueSongs(guildData, songs, playNext = false) {
    const { queue, currentSong } = guildData;
    const index = playNext ? Number(Boolean(currentSong && queue[0] === currentSong)) : queue.length;
    queue.splice(index, 0, ...songs);
    return index + 1;
}

async function disconnectMusic(guildData, { preserveQueue = false } = {}) {
    const connection = guildData.connection;
    guildData.connection = null;
    if (preserveQueue) guildData.queueEpoch = (guildData.queueEpoch || 0) + 1;
    const stopped = preserveQueue ? resetPlayback(guildData) : stopMusic(guildData);
    guildData.player = null;
    if (connection && connection.state?.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
    await stopped;
}

function handleVoiceUnavailable(guildData, connection) {
    if (guildData.connection !== connection) return;
    void disconnectMusic(guildData, { preserveQueue: true }).catch(console.error);
    if (guildData.queue.length) {
        void guildData.textChannel?.send('⚠️ Bot mất kết nối voice. Hàng đợi vẫn còn. Vào lại phòng rồi dùng `/queue action:next position:1` để phát tiếp.').catch(() => {});
    }
}

async function waitForVoice(guildData, connection, generation) {
    try {
        if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) throw new Error('Voice connection unavailable');
        await entersState(connection, VoiceConnectionStatus.Ready, 15000);
        return generation === guildData.playbackGeneration && connection === guildData.connection;
    } catch {
        if (generation === guildData.playbackGeneration) handleVoiceUnavailable(guildData, connection);
        return false;
    }
}

async function jumpToSong(guildData, position) {
    const target = guildData.queue[position - 1];
    if (!target) return null;
    if (position === 1 && guildData.isPlaying && guildData.currentSong === target) return target;

    guildData.playbackGeneration = (guildData.playbackGeneration || 0) + 1;
    guildData.currentSong = null;
    guildData.isSeeking = false;
    guildData.isManualSkip = false;
    guildData.retryingCurrentSong = false;
    guildData.audioResource = null;
    void clearPlaybackMessage(guildData);
    guildData.queue.splice(0, position - 1);
    // Idle from the old resource must not remove the new head of the queue.
    guildData.player?.stop(true);
    void playMusic(guildData);
    return target;
}

function skipCurrentSong(guildData) {
    if (!guildData.currentSong || !guildData.player) return false;
    guildData.playbackGeneration = (guildData.playbackGeneration || 0) + 1;
    guildData.retryingCurrentSong = false;
    guildData.isManualSkip = true;
    if (!guildData.player.stop(true)) void handleSongEnd(guildData).catch(console.error);
    return true;
}

async function seekMusic(guildData, seconds, song = guildData.currentSong) {
    const duration = durationToSeconds(song?.duration);
    if (!song || song !== guildData.currentSong || !guildData.player || !Number.isInteger(seconds) || seconds < 0 || (duration > 0 && seconds >= duration)) return false;
    song.seekOffset = seconds;
    guildData.isSeeking = true;
    guildData.player.stop(true);
    guildData.isSeeking = false;
    return await playMusic(guildData, { seeking: true });
}

// Phát nhạc
async function playMusic(guildData, { seeking = false } = {}) {
    const generation = (guildData.playbackGeneration || 0) + 1;
    guildData.playbackGeneration = generation;
    if (seeking) clearProgressInterval(guildData);
    else void clearPlaybackMessage(guildData);
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
        if (guildData.currentSong !== song || (!seeking && !guildData.retryingCurrentSong)) {
            guildData.skipVote = null;
        }
        guildData.currentSong = song;
        guildData.isPlaying = true;
        const connection = guildData.connection;
        if (connection?.state?.status !== VoiceConnectionStatus.Ready && !await waitForVoice(guildData, connection, generation)) return false;

        console.log(`🎵 Đang mở âm thanh: ${song.title}`);

        try {
            const { getAudioStream } = require('./youtubeUtils');
            const { stream: audioStream, type } = await getAudioStream(song.url, song.seekOffset || 0);

            if (generation !== guildData.playbackGeneration || connection !== guildData.connection
                || (connection.state.status !== VoiceConnectionStatus.Ready && !await waitForVoice(guildData, connection, generation))) {
                audioStream.destroy();
                return;
            }

            guildData.audioResource = createAudioResource(audioStream, {
                inputType: type,
                inlineVolume: true
            });

            if (guildData.audioResource.volume) {
                const volDecimal = (guildData.volume !== undefined ? guildData.volume : 50) / 100;
                guildData.audioResource.volume.setVolume(volDecimal);
                console.log(`🔊 Đã thiết lập âm lượng ban đầu: ${volDecimal * 100}%`);
            }

            if (!guildData.connection || !guildData.player) {
                throw new Error('Connection hoặc player không tồn tại');
            }

            guildData.player.play(guildData.audioResource);
            guildData.songPlayStartTime = Date.now();
            guildData.errorCount = 0;
            guildData.retryingCurrentSong = false;
            guildData.consecutivePlaybackErrors = 0;
            if (guildData.autoTrending) guildData.autoTrending.consecutiveFailures = 0;

            console.log('✅ Đã bắt đầu phát nhạc');

            // Gửi embed hiện tại đang phát
            if (guildData.textChannel) {
                try {
                    const totalSec = durationToSeconds(song.duration);
                    const embed = buildNowPlayingEmbed(guildData);
                    const components = buildPlaybackRows(song);

                    const seekOptions = new Map();
                    for (const percent of [10, 20, 30, 40, 50, 60, 70, 80, 90]) {
                        const seconds = Math.floor(totalSec * percent / 100);
                        if (seconds > 0 && !seekOptions.has(seconds)) {
                            seekOptions.set(seconds, { label: formatDuration(seconds), value: String(seconds) });
                        }
                    }
                    if (seekOptions.size) {
                        const selectMenu = new StringSelectMenuBuilder()
                            .setCustomId('music_seek_menu')
                            .setPlaceholder('⏩ Tua đến một mốc trong bài')
                            .addOptions([...seekOptions.values()]);
                        components.push(new ActionRowBuilder().addComponents(selectMenu));
                    }

                    // Kiểm tra quyền gửi message trước khi send
                    const botMember = guildData.textChannel.guild?.members?.me;
                    const permissions = botMember ? guildData.textChannel.permissionsFor(botMember) : null;
                    const canSend = !permissions || (permissions.has('SendMessages') && permissions.has('ViewChannel'));

                    if (!canSend) {
                        console.log('⚠️ Bot không có quyền gửi message - bỏ qua embed');
                        void clearPlaybackMessage(guildData);
                    } else {
                        const isCurrentTrack = () => generation === guildData.playbackGeneration && guildData.currentSong === song;
                        let message = guildData.currentMessage;
                        if (message) {
                            try {
                                message = await message.edit({ embeds: [embed], components });
                            } catch (e) {
                                console.log('Không thể edit message cũ khi seek, gửi message mới:', e.message);
                                message = null;
                            }
                        }

                        if (!isCurrentTrack()) return;
                        if (!message) {
                            void clearPlaybackMessage(guildData);
                            message = await guildData.textChannel.send({ embeds: [embed], components });
                            if (!isCurrentTrack()) {
                                void deletePlaybackMessage(message);
                                return;
                            }
                        }

                        guildData.currentMessage = message;

                        let editing = false;
                        let lastEmbed = JSON.stringify(embed.toJSON());
                        const isCurrent = () => isCurrentTrack() && guildData.currentMessage === message;
                        guildData.progressInterval = setInterval(async () => {
                            if (!isCurrent() || editing || !guildData.isPlaying) return;
                            editing = true;
                            try {
                                const updatedEmbed = buildNowPlayingEmbed(guildData);
                                const payload = JSON.stringify(updatedEmbed.toJSON());
                                if (payload === lastEmbed) return;
                                await message.edit({ embeds: [updatedEmbed] });
                                lastEmbed = payload;
                            } catch (error) {
                                if (isCurrent() && [10008, 50001, 50013].includes(error.code)) clearProgressInterval(guildData);
                            } finally {
                                editing = false;
                            }
                        }, 12000).unref();
                    }
                } catch (sendError) {
                    // Chỉ log lỗi quan trọng, bỏ qua lỗi permissions
                    if (sendError.code !== 50001 && sendError.code !== 50013) {
                        console.error('Lỗi khi gửi embed:', sendError.message);
                    } else {
                        console.log(`⚠️ Không thể gửi embed (lỗi quyền ${sendError.code}) - nhạc vẫn phát bình thường`);
                    }
                }
            }
            return true;
        } catch (error) {
            console.error('❌ Lỗi khi phát nhạc:', error.message);
            if (generation === (guildData.playbackGeneration || 0)) {
                await handlePlaybackError(guildData, song, error);
            }
        }

    } catch (error) {
        console.error('❌ Lỗi tổng quát trong playMusic:', error);
        guildData.isPlaying = false;
    }
}

// Xử lý lỗi phát nhạc
async function handlePlaybackError(guildData, song, error) {
    if (guildData.currentSong !== song) return;
    const generation = guildData.playbackGeneration || 0;
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
            if (generation !== (guildData.playbackGeneration || 0)) return;
            playMusic(guildData);
        }, 2000);
        return;
    }

    console.log('❌ Không thể phát bài hát, skip sang bài tiếp theo');
    if (guildData.queue[0] === song) guildData.queue.shift();
    guildData.errorCount = 0;
    guildData.currentSong = null;
    guildData.retryingCurrentSong = false;
    void clearPlaybackMessage(guildData);

    // Tăng số lỗi liên tiếp trên các bài hát khác nhau
    if (!guildData.consecutivePlaybackErrors) {
        guildData.consecutivePlaybackErrors = 0;
    }
    guildData.consecutivePlaybackErrors++;

    if (guildData.consecutivePlaybackErrors >= 3) {
        console.log('🚫 Dừng phát nhạc do gặp 3 lỗi liên tiếp từ YouTube');
        guildData.consecutivePlaybackErrors = 0;
        guildData.isPlaying = false;

        if (guildData.textChannel) {
            guildData.textChannel.send('❌ **Lỗi phát nhạc liên tiếp!** Tèo gặp sự cố kết nối với YouTube 3 lần liên tục. Để tránh làm mất sạch danh sách nhạc của bạn, Tèo đã tạm dừng phát. Hãy kiểm tra lại hoặc thử lại sau nhé!');
        }
        return;
    }

    const reason = /403|forbidden/i.test(error.message)
        ? 'YouTube từ chối tải âm thanh (403).'
        : 'Không đọc được luồng âm thanh.';
    guildData.textChannel?.send({
        content: `⚠️ Không phát được **${song.title}**. ${reason} Tèo bỏ qua bài này.`,
        allowedMentions: { parse: [] }
    }).catch(() => {});

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
        if (generation !== (guildData.playbackGeneration || 0)) return;
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
    if (guildData.connection?.state?.status === VoiceConnectionStatus.Destroyed) {
        void disconnectMusic(guildData, { preserveQueue: true }).catch(console.error);
    }
    const accessError = getVoiceAccessError(member, guildData);
    if (accessError) throw new Error(accessError);
    if (!guildData.connection) {
        guildData.connection = joinVoiceChannel({
            channelId: member.voice.channel.id,
            guildId: member.guild.id,
            adapterCreator: member.guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false
        });

        guildData.player = createAudioPlayer({
            behaviors: {
                noSubscriber: NoSubscriberBehavior.Pause
            }
        });
        const subscription = guildData.connection.subscribe(guildData.player);
        console.log('🔗 Subscription:', subscription ? '✅ OK' : '❌ FAIL');

        // Debug: log player state changes
        guildData.player.on('stateChange', (oldState, newState) => {
            console.log(`🎮 Player state: ${oldState.status} → ${newState.status}`);
        });

        // Debug: log connection state
        const connection = guildData.connection;
        connection.on('stateChange', (oldState, newState) => {
            console.log(`🔌 Connection state: ${oldState.status} → ${newState.status}`);
            if (guildData.connection !== connection) return;
            if (newState.status === VoiceConnectionStatus.Destroyed) handleVoiceUnavailable(guildData, connection);
            if (newState.status === VoiceConnectionStatus.Disconnected) {
                void entersState(connection, VoiceConnectionStatus.Ready, 15000).catch(() => handleVoiceUnavailable(guildData, connection));
            }
        });
        connection.on('error', error => console.error('Voice connection error:', error.message));
        guildData.player.on('idle', async () => {
            await handleSongEnd(guildData);
        });

        guildData.player.on('error', async error => {
            console.error('❌ Audio player error:', error.message);

            if (guildData.currentSong && (!error.resource || error.resource === guildData.audioResource)) {
                await handlePlaybackError(guildData, guildData.currentSong, error);
            }
        });

        console.log('✅ Đã tạo kết nối voice và player');
    }
}

// Xử lý khi bài hát kết thúc
async function handleSongEnd(guildData) {
    if (!guildData.currentSong || guildData.retryingCurrentSong) return;
    if (guildData.isSeeking) {
        guildData.isSeeking = false;
        console.log('🔄 Đang thực hiện seek, bỏ qua kết thúc bài.');
        return;
    }
    console.log('🎵 Bài hát đã kết thúc');

    const completedSong = guildData.currentSong;
    void clearPlaybackMessage(guildData);
    const wasManualSkip = guildData.isManualSkip;
    guildData.isManualSkip = false; // Reset ngay lập tức
    if (!wasManualSkip && completedSong.requesterId) {
        const { addToHistory } = require('./historyStore');
        void addToHistory(completedSong.requesterId, completedSong, guildData.guildId).catch(error => {
            console.error('⚠️ Không thể lưu lịch sử:', error.message);
        });
    }

    const playDuration = Date.now() - (guildData.songPlayStartTime || 0);
    console.log(`⏱️ Bài đã phát được ${playDuration}ms (Manual Skip: ${wasManualSkip})`);

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

    if (guildData.loopMode === 'track' && completedSong && !wasManualSkip) {
        console.log('🔂 Lặp lại bài hiện tại');
        await playMusic(guildData);
        return;
    }

    if (guildData.loopMode === 'queue' && completedSong && guildData.queue.length > 0 && (!wasManualSkip || guildData.queue.length > 1)) {
        console.log('🔁 Lặp lại queue');
        const currentSong = guildData.queue.shift();
        guildData.queue.push(currentSong);
        await playMusic(guildData);
        return;
    }

    if (guildData.queue[0] === completedSong) guildData.queue.shift();
    guildData.currentSong = null;

    if (guildData.queue.length > 0) {
        console.log('⏭️ Chuyển sang bài tiếp theo');
        await playMusic(guildData);
    } else {
        console.log('📭 Hết bài trong queue');
        guildData.isPlaying = false;

        if (guildData.autoplay) {
            await handleAutoplay(guildData, completedSong);
        } else if (guildData.autoTrending && guildData.autoTrending.enabled) {
            await handleAutoTrending(guildData);
        }
    }
}

// Xử lý tự động phát nhạc liên quan (Autoplay)
async function handleAutoplay(guildData, completedSong) {
    if (!completedSong) return;
    const generation = guildData.playbackGeneration;

    console.log(`🤖 [Autoplay] Đang tìm bài hát liên quan cho: "${completedSong.title}"`);

    try {
        const { searchYoutube } = require('./youtubeUtils');
        // Tìm 5 kết quả cho tên bài hát vừa kết thúc
        const searchResults = await searchYoutube(completedSong.title, 5);
        if (generation !== guildData.playbackGeneration || !guildData.autoplay || guildData.queue.length) return;
        if (!searchResults) {
            console.log('⚠️ [Autoplay] Không tìm thấy kết quả nào.');
            return;
        }

        const songs = Array.isArray(searchResults) ? searchResults : [searchResults];

        // Lọc trùng lặp
        const filteredSongs = songs.filter(song => {
            if (song.url === completedSong.url) return false;

            const title1 = song.title.toLowerCase();
            const title2 = completedSong.title.toLowerCase();
            if (title1 === title2) return false;

            const durationSeconds = durationToSeconds(song.duration);
            if (durationSeconds > 480) return false; // Không dài quá 8 phút

            return true;
        });

        if (filteredSongs.length === 0) {
            console.log('⚠️ [Autoplay] Các bài hát gợi ý đều bị trùng.');
            return;
        }

        const nextSong = filteredSongs[0];
        nextSong.requester = 'Autoplay';
        nextSong.requestedBy = 'Autoplay';
        nextSong.autoplay = true;

        guildData.queue.push(nextSong);

        console.log(`✅ [Autoplay] Thêm bài hát tiếp theo: ${nextSong.title}`);

        if (guildData.textChannel) {
            guildData.textChannel.send({
                content: `🎵 **Autoplay**: Tiếp theo là bài *${nextSong.title}* (tự động phát nhạc liên quan)`,
                allowedMentions: { parse: [] }
            });
        }

        if (!guildData.isPlaying) {
            await playMusic(guildData);
        }
    } catch (error) {
        console.error('❌ Lỗi xử lý Autoplay:', error);
    }
}

// Lọc bài hát (loại bỏ video dài, podcast, v.v.)
function filterSongs(songs) {
    return songs.filter(song => {
        const durationSeconds = durationToSeconds(song.duration);
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

// Xử lý auto-trending với batch system
async function handleAutoTrending(guildData) {
    const generation = guildData.playbackGeneration;
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

            nextSong.requester = 'Auto-Trending';
            nextSong.requestedBy = 'Auto-Trending';
            nextSong.autoTrending = true;

            guildData.queue.push(nextSong);
            guildData.autoTrending.count++;

            console.log(`✅ Thêm bài từ trending list: ${nextSong.title}`);

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
        const config = guildData.autoTrending;
        const region = guildData.autoTrending.region || 'VN';

        const trendingSongs = await trendingCommand.getAutoTrendingSong(region, 20);
        if (generation !== guildData.playbackGeneration || guildData.autoTrending !== config || !config.enabled || guildData.queue.length) return;

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

async function deletePlaybackMessage(message) {
    if (!message) return;
    try {
        await message.delete();
    } catch (error) {
        if (error.code !== 10008) {
            console.error('Lỗi khi xóa bảng Đang phát:', error.message);
        }
    }
}

module.exports = {
    musicData,
    formatDuration,
    durationToSeconds,
    createProgressBar,
    getCurrentPlaybackTime,
    buildNowPlayingEmbed,
    clearProgressInterval,
    initGuildMusicData,
    playMusic,
    createMusicConnection,
    handleSongEnd,
    stopMusic,
    disconnectMusic,
    jumpToSong,
    enqueueSongs,
    skipCurrentSong,
    seekMusic,
    handleAutoTrending
};
