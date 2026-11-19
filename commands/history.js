const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { readUserHistory, clearUserHistory } = require('../utils/historyStore');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('history')
        .setDescription('Xem lịch sử nhạc đã phát')
        .addSubcommand(subcommand =>
            subcommand
                .setName('show')
                .setDescription('Hiển thị lịch sử nhạc')
                .addIntegerOption(option =>
                    option.setName('limit')
                        .setDescription('Số bài hiển thị (mặc định 10)')
                        .setMinValue(1)
                        .setMaxValue(20)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('clear')
                .setDescription('Xóa lịch sử nhạc')
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const userId = interaction.user.id;
        if (subcommand === 'clear') return this.clearHistory(interaction, userId);
        return this.showHistory(interaction, userId);
    },

    async showHistory(interaction, userId) {
        const limit = interaction.options.getInteger('limit') || 10;
        try {
            const songs = await readUserHistory(userId);
            if (!songs.length) return interaction.reply('📜 Lịch sử nhạc trống!');

            const recentSongs = songs.slice(-limit).reverse();
            const songList = recentSongs.map((song, index) => {
                const playedDate = new Date(song.playedAt).toLocaleDateString('vi-VN');
                return `${index + 1}. **${song.title}**\n   ⏱️ ${song.duration} | 📅 ${playedDate}`;
            }).join('\n\n');

            const embed = new EmbedBuilder()
                .setColor('#9932cc')
                .setTitle('📜 Lịch sử nhạc')
                .setDescription(songList)
                .setFooter({ text: `Hiển thị ${recentSongs.length}/${songs.length} bài gần nhất` });

            interaction.reply({ embeds: [embed] });

        } catch (error) {
            if (error.code === 'ENOENT') {
                interaction.reply('📜 Lịch sử nhạc trống!');
            } else {
                console.error('Lỗi khi đọc lịch sử:', error);
                interaction.reply('❌ Lỗi khi đọc lịch sử nhạc!');
            }
        }
    },

    async clearHistory(interaction, userId) {
        try {
            const removed = await clearUserHistory(userId);
            return interaction.reply(removed ? '🗑️ Đã xóa lịch sử nhạc!' : '📜 Lịch sử nhạc đã trống!');
        } catch (error) {
            console.error('Lỗi khi xóa lịch sử:', error);
            return interaction.reply('❌ Lỗi khi xóa lịch sử nhạc!');
        }
    }
};
