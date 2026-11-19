const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { initGuildMusicData } = require('../utils/musicUtils');
const { readUserHistory, readServerHistory } = require('../utils/historyStore');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Xem thống kê sử dụng bot')
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Loại thống kê')
                .setRequired(false)
                .addChoices(
                    { name: 'Cá nhân', value: 'personal' },
                    { name: 'Server', value: 'server' },
                    { name: 'Top bài hát', value: 'top_songs' },
                    { name: 'Top người dùng', value: 'top_users' },
                    { name: 'Tổng quan', value: 'overview' }
                )
        ),

    async execute(interaction, requestedType) {
        const statsType = requestedType || interaction.options.getString('type') || 'personal';
        const userId = interaction.user?.id || interaction.member?.user?.id;
        const guildId = interaction.guildId;

        try {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferReply();
            }

            switch (statsType) {
                case 'personal':
                    await this.showPersonalStats(interaction, userId);
                    break;
                case 'server':
                    await this.showServerStats(interaction, guildId);
                    break;
                case 'top_songs':
                    await this.showTopSongs(interaction);
                    break;
                case 'top_users':
                    await this.showTopUsers(interaction);
                    break;
                case 'overview':
                    await this.showOverview(interaction, userId, guildId);
                    break;
                default:
                    await this.showPersonalStats(interaction, userId);
            }

        } catch (error) {
            console.error('Lỗi stats command:', error);
            const reply = { content: '❌ Có lỗi khi tải thống kê!' };
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply(reply);
            } else {
                await interaction.reply({ ...reply, ephemeral: true });
            }
        }
    },

    // Thống kê cá nhân
    async showPersonalStats(interaction, userId) {
        const userHistory = await readUserHistory(userId);
        const stats = this.calculatePersonalStats(userHistory);

        const embed = new EmbedBuilder()
            .setColor('#4285f4')
            .setTitle('📊 Thống kê cá nhân')
            .setDescription(`Thống kê sử dụng của <@${userId}>`)
            .addFields(
                { name: '🎵 Tổng bài đã nghe', value: `${stats.totalSongs} bài`, inline: true },
                { name: '⏰ Tổng thời gian', value: stats.totalTime, inline: true },
                { name: '📈 Trung bình/ngày', value: `${stats.avgPerDay} bài`, inline: true },
                { name: '🔥 Streak hiện tại', value: `${stats.currentStreak} ngày`, inline: true },
                { name: '🏆 Streak cao nhất', value: `${stats.maxStreak} ngày`, inline: true },
                { name: '🎯 Thể loại yêu thích', value: stats.favoriteGenre, inline: true }
            );

        if (stats.topSongs.length > 0) {
            const topSongsList = stats.topSongs.slice(0, 5).map((song, index) =>
                `**${index + 1}.** ${song.title.substring(0, 50)} *(${song.count} lần)*`
            ).join('\n');
            embed.addFields({ name: '🎵 Top bài hát', value: topSongsList });
        } else {
            embed.addFields({ name: '🎵 Top bài hát', value: 'Chưa có dữ liệu. Hãy nghe nhạc để bắt đầu!' });
        }

        if (stats.recentActivity.length > 0) {
            const activityList = stats.recentActivity.slice(0, 3).map(day =>
                `**${day.date}:** ${day.count} bài`
            ).join('\n');
            embed.addFields({ name: '📅 Hoạt động gần đây', value: activityList });
        }

        const controlRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('stats_server')
                    .setLabel('🏠 Server Stats')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('stats_top_songs')
                    .setLabel('🎵 Top Songs')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('stats_top_users')
                    .setLabel('👥 Top Users')
                    .setStyle(ButtonStyle.Primary)
            );

        const replyFn = interaction.deferred || interaction.replied ? 'editReply' : 'reply';
        await interaction[replyFn]({ embeds: [embed], components: [controlRow] });
    },

    // Thống kê server
    async showServerStats(interaction, guildId) {
        const guildData = initGuildMusicData(guildId);
        const serverStats = this.calculateServerStats(await readServerHistory(guildId));

        const embed = new EmbedBuilder()
            .setColor('#34a853')
            .setTitle('📊 Thống kê Server')
            .setDescription('Thống kê tổng thể của server')
            .addFields(
                { name: '👥 Tổng người dùng', value: `${serverStats.totalUsers} người`, inline: true },
                { name: '🎵 Tổng bài đã phát', value: `${serverStats.totalSongs} bài`, inline: true },
                { name: '⏰ Tổng thời gian', value: serverStats.totalTime, inline: true },
                { name: '🔥 Người dùng tích cực (7 ngày)', value: `${serverStats.activeUsers} người`, inline: true },
                { name: '📈 Bài/ngày (TB)', value: `${serverStats.avgSongsPerDay} bài`, inline: true },
                { name: '🎯 Thể loại phổ biến', value: serverStats.popularGenre, inline: true }
            );

        if (guildData.queue && guildData.queue.length > 0) {
            embed.addFields(
                { name: '🎵 Queue hiện tại', value: `${guildData.queue.length} bài`, inline: true },
                { name: '▶️ Đang phát', value: guildData.isPlaying ? '✅ Có' : '❌ Không', inline: true }
            );
        }

        const replyFn = interaction.deferred || interaction.replied ? 'editReply' : 'reply';
        await interaction[replyFn]({ embeds: [embed] });
    },

    // Top bài hát
    async showTopSongs(interaction) {
        const topSongs = this.calculateTopSongs(await readServerHistory(interaction.guildId));

        const embed = new EmbedBuilder()
            .setColor('#ea4335')
            .setTitle('🏆 Top bài hát phổ biến')
            .setDescription('Những bài hát được nghe nhiều nhất');

        if (topSongs.length > 0) {
            const songList = topSongs.slice(0, 10).map((song, index) => {
                const medal = index < 3 ? ['🥇', '🥈', '🥉'][index] : `**${index + 1}.**`;
                const title = song.title.length > 45 ? song.title.substring(0, 42) + '...' : song.title;
                return `${medal} ${title}\n*${song.count} lượt phát - ${song.uniqueUsers} người nghe*`;
            }).join('\n\n');

            embed.setDescription(songList);
        } else {
            embed.setDescription('Chưa có dữ liệu bài hát nào.\n*Hãy nghe nhạc để thống kê bắt đầu!*');
        }

        const replyFn = interaction.deferred || interaction.replied ? 'editReply' : 'reply';
        await interaction[replyFn]({ embeds: [embed] });
    },

    // Top người dùng
    async showTopUsers(interaction) {
        const topUsers = this.calculateTopUsers(await readServerHistory(interaction.guildId));

        const embed = new EmbedBuilder()
            .setColor('#fbbc05')
            .setTitle('🏆 Top người dùng tích cực')
            .setDescription('Những người dùng nghe nhạc nhiều nhất');

        if (topUsers.length > 0) {
            const userList = topUsers.slice(0, 10).map((user, index) => {
                const medal = index < 3 ? ['🥇', '🥈', '🥉'][index] : `**${index + 1}.**`;
                return `${medal} <@${user.userId}>\n*${user.totalSongs} bài - ${this.formatDuration(user.totalMinutes)}*`;
            }).join('\n\n');

            embed.setDescription(userList);
        } else {
            embed.setDescription('Chưa có dữ liệu người dùng nào.\n*Hãy nghe nhạc để thống kê bắt đầu!*');
        }

        const replyFn = interaction.deferred || interaction.replied ? 'editReply' : 'reply';
        await interaction[replyFn]({ embeds: [embed] });
    },

    // Tổng quan
    async showOverview(interaction, userId, guildId) {
        const embed = new EmbedBuilder()
            .setColor('#9c27b0')
            .setTitle('📊 Tổng quan thống kê')
            .setDescription('Dashboard tổng hợp các thông tin');

        const navRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('stats_personal')
                    .setLabel('👤 Cá nhân')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('stats_server')
                    .setLabel('🏠 Server')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('stats_top_songs')
                    .setLabel('🎵 Top Songs')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('stats_top_users')
                    .setLabel('👥 Top Users')
                    .setStyle(ButtonStyle.Primary)
            );

        const replyFn = interaction.deferred || interaction.replied ? 'editReply' : 'reply';
        await interaction[replyFn]({ embeds: [embed], components: [navRow] });
    },

    // ── CALCULATION FUNCTIONS ──────────────────────────────────────────────────

    calculatePersonalStats(history) {
        if (history.length === 0) {
            return {
                totalSongs: 0,
                totalTime: '0 phút',
                avgPerDay: 0,
                currentStreak: 0,
                maxStreak: 0,
                favoriteGenre: 'Chưa xác định',
                topSongs: [],
                recentActivity: []
            };
        }

        const totalSongs = history.length;
        const totalMinutes = history.reduce((sum, song) => sum + this.parseDuration(song.duration), 0);
        const { currentStreak, maxStreak } = this.calculateStreaks(history);

        // Tìm bài hát phổ biến
        const songCounts = {};
        history.forEach(song => {
            if (song.title) {
                songCounts[song.title] = (songCounts[song.title] || 0) + 1;
            }
        });
        const topSongs = Object.entries(songCounts)
            .map(([title, count]) => ({ title, count }))
            .sort((a, b) => b.count - a.count);

        return {
            totalSongs,
            totalTime: this.formatDuration(totalMinutes),
            avgPerDay: Math.round(totalSongs / Math.max(1, this.getDaysSinceFirst(history))),
            currentStreak,
            maxStreak,
            favoriteGenre: this.detectFavoriteGenre(history),
            topSongs,
            recentActivity: this.calculateRecentActivity(history)
        };
    },

    calculateServerStats(serverHistory) {
        const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const histories = [...serverHistory.values()];
        const songs = histories.flat();
        const isRecent = song => new Date(song.playedAt || song.timestamp).getTime() >= weekAgo;
        return {
            totalUsers: serverHistory.size,
            totalSongs: songs.length,
            totalTime: this.formatDuration(songs.reduce((sum, song) => sum + this.parseDuration(song.duration), 0)),
            activeUsers: histories.filter(history => history.some(isRecent)).length,
            avgSongsPerDay: Math.round(songs.filter(isRecent).length / 7),
            popularGenre: this.detectFavoriteGenre(songs)
        };
    },

    calculateTopSongs(serverHistory) {
        const songs = new Map();
        for (const [userId, history] of serverHistory) {
            for (const song of history) {
                if (!song.url || !song.title) continue;
                if (!songs.has(song.url)) songs.set(song.url, { title: song.title, count: 0, users: new Set() });
                const entry = songs.get(song.url);
                entry.count++;
                entry.users.add(userId);
            }
        }
        return [...songs.values()]
            .map(song => ({ title: song.title, count: song.count, uniqueUsers: song.users.size }))
            .sort((a, b) => b.count - a.count);
    },

    calculateTopUsers(serverHistory) {
        return [...serverHistory.entries()].map(([userId, history]) => ({
            userId,
            totalSongs: history.length,
            totalMinutes: history.reduce((sum, song) => sum + this.parseDuration(song.duration), 0)
        })).sort((a, b) => b.totalSongs - a.totalSongs);
    },

    parseDuration(duration) {
        if (!duration || duration === 'Không xác định' || duration === 'N/A') return 0;
        const parts = String(duration).split(':').map(Number);
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        return 0;
    },

    formatDuration(seconds) {
        if (seconds < 60) return `${seconds} giây`;
        const mins = Math.floor(seconds / 60);
        if (mins < 60) return `${mins} phút`;
        const hours = Math.floor(mins / 60);
        const remainMins = mins % 60;
        return `${hours}h ${remainMins}m`;
    },

    calculateStreaks(history) {
        if (history.length === 0) return { currentStreak: 0, maxStreak: 0 };

        // Lấy danh sách ngày duy nhất đã nghe
        const daysSet = new Set(history.map(song => {
            const ts = song.playedAt || song.timestamp;
            return ts ? new Date(ts).toDateString() : null;
        }).filter(Boolean));

        const days = Array.from(daysSet).map(d => new Date(d)).sort((a, b) => b - a);

        let currentStreak = 0;
        let maxStreak = 0;
        let streak = 0;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (let i = 0; i < days.length; i++) {
            const dayDiff = Math.round((today - days[i]) / (24 * 60 * 60 * 1000));
            if (dayDiff === i) {
                streak++;
                maxStreak = Math.max(maxStreak, streak);
                if (i === 0) currentStreak = streak;
            } else {
                break;
            }
        }

        return { currentStreak, maxStreak };
    },

    calculateRecentActivity(history) {
        const last7Days = [];
        for (let i = 0; i < 7; i++) {
            const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
            const dateStr = date.toLocaleDateString('vi-VN');
            const count = history.filter(song => {
                const ts = song.playedAt || song.timestamp;
                if (!ts) return false;
                return new Date(ts).toDateString() === date.toDateString();
            }).length;
            if (count > 0) {
                last7Days.push({ date: dateStr, count });
            }
        }
        return last7Days;
    },

    // Phân tích thể loại yêu thích thực sự từ title
    detectFavoriteGenre(history) {
        const genreKeywords = {
            '🎤 Vpop': ['sơn tùng', 'hòa minzy', 'erik', 'jack', 'k-icm', 'đen vâu', 'karik', 'amee', 'min', 'orange', 'mono', 'tlinh', 'binz', 'wowy', 'grey d', 'obito'],
            '🇰🇷 Kpop': ['bts', 'blackpink', 'twice', 'red velvet', 'aespa', 'itzy', 'ive', 'stray kids', 'seventeen', 'newjeans', 'le sserafim'],
            '🎸 Rock': ['rock', 'metal', 'punk', 'alternative', 'linkin park', 'coldplay', 'nirvana', 'metallica'],
            '🎤 Rap': ['rap', 'hip hop', 'eminem', 'drake', 'kendrick', 'travis scott', 'post malone', 'juice wrld'],
            '💿 EDM': ['edm', 'electronic', 'dubstep', 'house', 'techno', 'remix', 'dj', 'marshmello', 'alan walker'],
            '🎹 Ballad': ['ballad', 'love song', 'acoustic', 'piano', 'gentle', 'slow']
        };

        const scores = {};
        for (const genre of Object.keys(genreKeywords)) scores[genre] = 0;

        history.forEach(song => {
            const title = (song.title || '').toLowerCase();
            for (const [genre, keywords] of Object.entries(genreKeywords)) {
                for (const kw of keywords) {
                    if (title.includes(kw)) scores[genre]++;
                }
            }
        });

        const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
        return sorted[0][1] > 0 ? sorted[0][0] : '🎵 Mixed';
    },

    getDaysSinceFirst(history) {
        if (history.length === 0) return 1;
        const timestamps = history.map(s => s.playedAt || s.timestamp).filter(Boolean);
        if (timestamps.length === 0) return 1;
        const first = new Date(timestamps.sort()[0]);
        return Math.max(1, Math.ceil((Date.now() - first) / (24 * 60 * 60 * 1000)));
    }
};
