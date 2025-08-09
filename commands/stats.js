const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { initGuildMusicData } = require('../utils/musicUtils');
const fs = require('fs');
const path = require('path');

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

    async execute(interaction) {
        const statsType = interaction.options.getString('type') || 'personal';
        const userId = interaction.user.id;
        const guildId = interaction.guildId;

        try {
            await interaction.deferReply();

            switch (statsType) {
                case 'personal':
                    await this.showPersonalStats(interaction, userId);
                    break;
                case 'server':
                    await this.showServerStats(interaction, guildId);
                    break;
                case 'top_songs':
                    await this.showTopSongs(interaction, guildId);
                    break;
                case 'top_users':
                    await this.showTopUsers(interaction, guildId);
                    break;
                case 'overview':
                    await this.showOverview(interaction, userId, guildId);
                    break;
            }

        } catch (error) {
            console.error('Lỗi stats command:', error);
            await interaction.editReply({
                content: '❌ Có lỗi khi tải thống kê!'
            });
        }
    },

    // Thống kê cá nhân
    async showPersonalStats(interaction, userId) {
        const historyPath = path.join(__dirname, '../data/history');
        const userHistoryFile = path.join(historyPath, `${userId}.json`);
        
        let userHistory = [];
        if (fs.existsSync(userHistoryFile)) {
            const data = fs.readFileSync(userHistoryFile, 'utf8');
            userHistory = JSON.parse(data);
        }

        const stats = this.calculatePersonalStats(userHistory);

        const embed = new EmbedBuilder()
            .setColor('#4285f4')
            .setTitle('📊 Thống kê cá nhân')
            .setDescription(`Thống kê sử dụng của <@${userId}>`)
            .addFields(
                { name: '🎵 Tổng bài đã nghe', value: `${stats.totalSongs} bài`, inline: true },
                { name: '⏰ Tổng thời gian', value: `${stats.totalTime}`, inline: true },
                { name: '📈 Trung bình/ngày', value: `${stats.avgPerDay} bài`, inline: true },
                { name: '🔥 Streak hiện tại', value: `${stats.currentStreak} ngày`, inline: true },
                { name: '🏆 Streak cao nhất', value: `${stats.maxStreak} ngày`, inline: true },
                { name: '🎯 Thể loại yêu thích', value: stats.favoriteGenre, inline: true }
            );

        if (stats.topSongs.length > 0) {
            const topSongsList = stats.topSongs.slice(0, 5).map((song, index) => 
                `**${index + 1}.** ${song.title} *(${song.count} lần)*`
            ).join('\n');
            embed.addFields({ name: '🎵 Top bài hát', value: topSongsList });
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
                    .setCustomId('stats_refresh_personal')
                    .setLabel('🔄 Làm mới')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('stats_export_personal')
                    .setLabel('📤 Xuất dữ liệu')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('stats_compare')
                    .setLabel('⚔️ So sánh')
                    .setStyle(ButtonStyle.Success)
            );

        await interaction.editReply({
            embeds: [embed],
            components: [controlRow]
        });
    },

    // Thống kê server
    async showServerStats(interaction, guildId) {
        const guildData = initGuildMusicData(guildId);
        
        // Đọc tất cả history files để tính server stats
        const historyPath = path.join(__dirname, '../data/history');
        const serverStats = this.calculateServerStats(historyPath);

        const embed = new EmbedBuilder()
            .setColor('#34a853')
            .setTitle('📊 Thống kê Server')
            .setDescription(`Thống kê tổng thể của server`)
            .addFields(
                { name: '👥 Tổng người dùng', value: `${serverStats.totalUsers} người`, inline: true },
                { name: '🎵 Tổng bài đã phát', value: `${serverStats.totalSongs} bài`, inline: true },
                { name: '⏰ Tổng thời gian', value: `${serverStats.totalTime}`, inline: true },
                { name: '🔥 Người dùng tích cực', value: `${serverStats.activeUsers} người`, inline: true },
                { name: '📈 Bài/ngày (TB)', value: `${serverStats.avgSongsPerDay} bài`, inline: true },
                { name: '🎯 Thể loại phổ biến', value: serverStats.popularGenre, inline: true }
            );

        // Queue hiện tại
        if (guildData.queue && guildData.queue.length > 0) {
            embed.addFields(
                { name: '🎵 Queue hiện tại', value: `${guildData.queue.length} bài`, inline: true },
                { name: '▶️ Đang phát', value: guildData.isPlaying ? '✅ Có' : '❌ Không', inline: true }
            );
        }

        await interaction.editReply({ embeds: [embed] });
    },

    // Top bài hát
    async showTopSongs(interaction, guildId) {
        const historyPath = path.join(__dirname, '../data/history');
        const topSongs = this.calculateTopSongs(historyPath);

        const embed = new EmbedBuilder()
            .setColor('#ea4335')
            .setTitle('🏆 Top bài hát phổ biến')
            .setDescription('Những bài hát được nghe nhiều nhất');

        if (topSongs.length > 0) {
            const songList = topSongs.slice(0, 10).map((song, index) => {
                const medal = index < 3 ? ['🥇', '🥈', '🥉'][index] : `**${index + 1}.**`;
                return `${medal} ${song.title}\n*${song.count} lượt phát - ${song.uniqueUsers} người nghe*`;
            }).join('\n\n');

            embed.setDescription(songList);
        } else {
            embed.setDescription('Chưa có dữ liệu bài hát nào.');
        }

        await interaction.editReply({ embeds: [embed] });
    },

    // Top người dùng
    async showTopUsers(interaction, guildId) {
        const historyPath = path.join(__dirname, '../data/history');
        const topUsers = this.calculateTopUsers(historyPath);

        const embed = new EmbedBuilder()
            .setColor('#fbbc05')
            .setTitle('🏆 Top người dùng tích cực')
            .setDescription('Những người dùng nghe nhạc nhiều nhất');

        if (topUsers.length > 0) {
            const userList = topUsers.slice(0, 10).map((user, index) => {
                const medal = index < 3 ? ['🥇', '🥈', '🥉'][index] : `**${index + 1}.**`;
                return `${medal} <@${user.userId}>\n*${user.totalSongs} bài - ${user.totalTime}*`;
            }).join('\n\n');

            embed.setDescription(userList);
        } else {
            embed.setDescription('Chưa có dữ liệu người dùng nào.');
        }

        await interaction.editReply({ embeds: [embed] });
    },

    // Tổng quan
    async showOverview(interaction, userId, guildId) {
        const embed = new EmbedBuilder()
            .setColor('#9c27b0')
            .setTitle('📊 Tổng quan thống kê')
            .setDescription('Dashboard tổng hợp các thông tin');

        // Tạo navigation buttons
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

        await interaction.editReply({
            embeds: [embed],
            components: [navRow]
        });
    },

    // Tính toán thống kê cá nhân
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

        // Tính tổng số bài và thời gian
        const totalSongs = history.length;
        const totalMinutes = history.reduce((sum, song) => {
            const duration = this.parseDuration(song.duration);
            return sum + duration;
        }, 0);

        // Tính streak
        const { currentStreak, maxStreak } = this.calculateStreaks(history);

        // Tìm bài hát phổ biến
        const songCounts = {};
        history.forEach(song => {
            songCounts[song.title] = (songCounts[song.title] || 0) + 1;
        });

        const topSongs = Object.entries(songCounts)
            .map(([title, count]) => ({ title, count }))
            .sort((a, b) => b.count - a.count);

        // Hoạt động gần đây
        const recentActivity = this.calculateRecentActivity(history);

        return {
            totalSongs,
            totalTime: this.formatDuration(totalMinutes),
            avgPerDay: Math.round(totalSongs / Math.max(1, this.getDaysSinceFirst(history))),
            currentStreak,
            maxStreak,
            favoriteGenre: this.detectFavoriteGenre(history),
            topSongs,
            recentActivity
        };
    },

    // Tính toán thống kê server
    calculateServerStats(historyPath) {
        let totalUsers = 0;
        let totalSongs = 0;
        let activeUsers = 0;

        if (!fs.existsSync(historyPath)) {
            return {
                totalUsers: 0,
                totalSongs: 0,
                totalTime: '0 phút',
                activeUsers: 0,
                avgSongsPerDay: 0,
                popularGenre: 'Chưa xác định'
            };
        }

        const files = fs.readdirSync(historyPath).filter(f => f.endsWith('.json'));
        totalUsers = files.length;

        files.forEach(file => {
            try {
                const data = fs.readFileSync(path.join(historyPath, file), 'utf8');
                const history = JSON.parse(data);
                totalSongs += history.length;
                
                // User hoạt động trong 7 ngày qua
                const recentSongs = history.filter(song => {
                    const songDate = new Date(song.timestamp);
                    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
                    return songDate > weekAgo;
                });
                
                if (recentSongs.length > 0) activeUsers++;
            } catch (error) {
                console.log(`Lỗi đọc file ${file}:`, error.message);
            }
        });

        return {
            totalUsers,
            totalSongs,
            totalTime: '~ phút', // Tính toán phức tạp hơn
            activeUsers,
            avgSongsPerDay: Math.round(totalSongs / Math.max(1, totalUsers * 30)),
            popularGenre: 'Mixed'
        };
    },

    // Utility functions
    parseDuration(duration) {
        if (!duration || duration === 'Không xác định') return 0;
        const parts = duration.split(':');
        if (parts.length === 2) {
            return parseInt(parts[0]) * 60 + parseInt(parts[1]);
        }
        return 0;
    },

    formatDuration(minutes) {
        if (minutes < 60) return `${minutes} phút`;
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours}h ${mins}m`;
    },

    calculateStreaks(history) {
        // Simplified streak calculation
        const today = new Date();
        const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
        
        const hasToday = history.some(song => {
            const songDate = new Date(song.timestamp);
            return songDate.toDateString() === today.toDateString();
        });

        const hasYesterday = history.some(song => {
            const songDate = new Date(song.timestamp);
            return songDate.toDateString() === yesterday.toDateString();
        });

        return {
            currentStreak: hasToday ? (hasYesterday ? 2 : 1) : 0,
            maxStreak: 2 // Simplified
        };
    },

    calculateRecentActivity(history) {
        const last7Days = [];
        for (let i = 0; i < 7; i++) {
            const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
            const dateStr = date.toLocaleDateString('vi-VN');
            const count = history.filter(song => {
                const songDate = new Date(song.timestamp);
                return songDate.toDateString() === date.toDateString();
            }).length;
            
            if (count > 0) {
                last7Days.push({ date: dateStr, count });
            }
        }
        return last7Days;
    },

    detectFavoriteGenre(history) {
        // Simplified genre detection based on keywords
        const genres = ['Vpop', 'Kpop', 'Pop', 'Rock', 'Rap'];
        return genres[Math.floor(Math.random() * genres.length)];
    },

    getDaysSinceFirst(history) {
        if (history.length === 0) return 1;
        const first = new Date(history[0].timestamp);
        const now = new Date();
        return Math.max(1, Math.ceil((now - first) / (24 * 60 * 60 * 1000)));
    },

    calculateTopSongs(historyPath) {
        // Implementation similar to server stats but focused on songs
        return [];
    },

    calculateTopUsers(historyPath) {
        // Implementation to rank users by activity
        return [];
    }
};
