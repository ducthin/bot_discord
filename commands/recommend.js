const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { initGuildMusicData, playMusic, createMusicConnection } = require('../utils/musicUtils');
const { searchYoutube } = require('../utils/youtubeUtils');
const fs = require('fs');
const path = require('path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('recommend')
        .setDescription('Gợi ý nhạc dựa trên lịch sử nghe và sở thích')
        .addStringOption(option =>
            option.setName('genre')
                .setDescription('Thể loại nhạc muốn gợi ý')
                .setRequired(false)
                .addChoices(
                    { name: 'Vpop', value: 'vpop vietnamese' },
                    { name: 'Kpop', value: 'kpop korean' },
                    { name: 'Pop', value: 'pop music' },
                    { name: 'Rock', value: 'rock music' },
                    { name: 'Rap/Hip-hop', value: 'rap hip hop' },
                    { name: 'EDM', value: 'edm electronic' },
                    { name: 'Ballad', value: 'ballad love song' },
                    { name: 'Lofi', value: 'lofi chill' }
                )
        ),

    async execute(interaction) {
        const userId = interaction.user.id;
        const guildData = initGuildMusicData(interaction.guildId);

        if (!interaction.member.voice.channel) {
            return interaction.reply({
                content: '❌ Bạn cần vào voice channel để sử dụng lệnh này!',
                ephemeral: true
            });
        }

        try {
            await interaction.deferReply();

            // Đọc lịch sử người dùng
            const historyPath = path.join(__dirname, '../data/history');
            const userHistoryFile = path.join(historyPath, `${userId}.json`);
            
            let userHistory = [];
            if (fs.existsSync(userHistoryFile)) {
                const data = fs.readFileSync(userHistoryFile, 'utf8');
                userHistory = JSON.parse(data);
            }

            // Lấy genre từ option hoặc phân tích từ lịch sử
            let searchGenre = interaction.options.getString('genre');
            
            if (!searchGenre && userHistory.length > 0) {
                // Phân tích thể loại từ lịch sử (đơn giản)
                const recentSongs = userHistory.slice(-10);
                const genres = this.analyzeGenreFromHistory(recentSongs);
                searchGenre = genres[0] || 'pop music';
            }

            if (!searchGenre) {
                searchGenre = 'trending music 2024';
            }

            // Tạo danh sách từ khóa gợi ý
            const recommendationQueries = this.generateRecommendationQueries(searchGenre, userHistory);
            
            const recommendations = [];
            
            // Tìm kiếm từng query
            for (const query of recommendationQueries.slice(0, 6)) {
                try {
                    const results = await searchYoutube(query, 1);
                    if (results && results.length > 0) {
                        recommendations.push({
                            ...results[0],
                            searchQuery: query
                        });
                    }
                } catch (error) {
                    console.log(`Không tìm thấy kết quả cho: ${query}`);
                }
            }

            if (recommendations.length === 0) {
                return interaction.editReply({
                    content: '❌ Không thể tìm thấy gợi ý phù hợp! Hãy thử lại sau.'
                });
            }

            // Tạo embed hiển thị gợi ý
            const embed = new EmbedBuilder()
                .setColor('#ff6b9d')
                .setTitle('🎯 Gợi ý nhạc cho bạn')
                .setDescription(`Dựa trên lịch sử nghe và thể loại **${this.getGenreDisplayName(searchGenre)}**`)
                .addFields(
                    { name: '📊 Phân tích', value: `${userHistory.length} bài đã nghe`, inline: true },
                    { name: '🎵 Tìm thấy', value: `${recommendations.length} gợi ý`, inline: true },
                    { name: '🎭 Thể loại', value: this.getGenreDisplayName(searchGenre), inline: true }
                );

            // Thêm danh sách gợi ý
            const songList = recommendations.map((song, index) => 
                `**${index + 1}.** ${song.title}\n*${song.duration} - ${song.views} views*`
            ).join('\n\n');

            embed.addFields({ name: '🎵 Danh sách gợi ý', value: songList });

            // Tạo buttons cho từng bài
            const rows = [];
            const buttonsPerRow = 3;
            
            for (let i = 0; i < recommendations.length; i += buttonsPerRow) {
                const row = new ActionRowBuilder();
                
                for (let j = i; j < Math.min(i + buttonsPerRow, recommendations.length); j++) {
                    row.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`recommend_play_${j}`)
                            .setLabel(`🎵 ${j + 1}`)
                            .setStyle(ButtonStyle.Primary)
                    );
                }
                rows.push(row);
            }

            // Thêm row điều khiển
            const controlRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('recommend_add_all')
                        .setLabel('➕ Thêm tất cả')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId('recommend_refresh')
                        .setLabel('🔄 Làm mới')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId('recommend_close')
                        .setLabel('❌ Đóng')
                        .setStyle(ButtonStyle.Danger)
                );

            rows.push(controlRow);

            // Lưu recommendations vào guildData để xử lý buttons
            guildData.recommendations = recommendations;

            await interaction.editReply({
                embeds: [embed],
                components: rows
            });

        } catch (error) {
            console.error('Lỗi recommend command:', error);
            await interaction.editReply({
                content: '❌ Có lỗi khi tạo gợi ý!'
            });
        }
    },

    // Phân tích thể loại từ lịch sử
    analyzeGenreFromHistory(history) {
        const genreKeywords = {
            'vpop vietnamese': ['sơn tùng', 'hòa minzy', 'erik', 'jack', 'k-icm', 'đen vâu', 'karik'],
            'kpop korean': ['bts', 'blackpink', 'twice', 'red velvet', 'aespa', 'itzy', 'ive'],
            'rap hip hop': ['rap', 'hip hop', 'eminem', 'drake', 'kendrick', 'đen vâu', 'karik'],
            'edm electronic': ['edm', 'electronic', 'dubstep', 'house', 'techno', 'remix'],
            'ballad love song': ['ballad', 'love', 'acoustic', 'piano', 'guitar'],
            'rock music': ['rock', 'metal', 'punk', 'alternative', 'indie rock']
        };

        const genreScores = {};
        
        for (const [genre, keywords] of Object.entries(genreKeywords)) {
            genreScores[genre] = 0;
            
            for (const song of history) {
                const songTitle = song.title.toLowerCase();
                for (const keyword of keywords) {
                    if (songTitle.includes(keyword.toLowerCase())) {
                        genreScores[genre]++;
                    }
                }
            }
        }

        return Object.keys(genreScores).sort((a, b) => genreScores[b] - genreScores[a]);
    },

    // Tạo queries gợi ý
    generateRecommendationQueries(genre, history) {
        const baseQueries = [
            `${genre} trending 2024`,
            `${genre} top hits`,
            `${genre} new releases`,
            `${genre} popular songs`,
            `${genre} best of`,
            `${genre} viral songs`
        ];

        // Thêm queries dựa trên lịch sử
        if (history.length > 0) {
            const recentArtists = history.slice(-5).map(song => {
                const parts = song.title.split('-');
                return parts[0].trim();
            });

            const uniqueArtists = [...new Set(recentArtists)];
            
            for (const artist of uniqueArtists.slice(0, 3)) {
                baseQueries.push(`${artist} ${genre}`);
                baseQueries.push(`similar to ${artist}`);
            }
        }

        return baseQueries;
    },

    // Hiển thị tên thể loại
    getGenreDisplayName(genre) {
        const displayNames = {
            'vpop vietnamese': 'Vpop',
            'kpop korean': 'Kpop', 
            'pop music': 'Pop',
            'rock music': 'Rock',
            'rap hip hop': 'Rap/Hip-hop',
            'edm electronic': 'EDM',
            'ballad love song': 'Ballad',
            'lofi chill': 'Lofi'
        };

        return displayNames[genre] || genre;
    }
};
