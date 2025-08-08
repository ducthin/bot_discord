const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');

const HISTORY_DIR = path.join(__dirname, '../data/history');

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
        const { guild, member } = interaction;
        const subcommand = interaction.options.getSubcommand();
        const userId = member.user.id;
        const userHistoryDir = path.join(HISTORY_DIR, userId);

        // Tạo thư mục nếu chưa có
        try {
            await fs.mkdir(userHistoryDir, { recursive: true });
        } catch (error) {
            // Thư mục đã tồn tại
        }

        switch (subcommand) {
            case 'show':
                await this.showHistory(interaction, userHistoryDir);
                break;
            case 'clear':
                await this.clearHistory(interaction, userHistoryDir);
                break;
        }
    },

    async showHistory(interaction, userHistoryDir) {
        const historyPath = path.join(userHistoryDir, 'songs.json');
        const limit = interaction.options.getInteger('limit') || 10;

        try {
            const data = await fs.readFile(historyPath, 'utf8');
            const history = JSON.parse(data);

            if (!history.songs || history.songs.length === 0) {
                return interaction.reply('📜 Lịch sử nhạc trống!');
            }

            const recentSongs = history.songs.slice(-limit).reverse();
            const songList = recentSongs.map((song, index) => {
                const playedDate = new Date(song.playedAt).toLocaleDateString('vi-VN');
                return `${index + 1}. **${song.title}**\n   ⏱️ ${song.duration} | 📅 ${playedDate}`;
            }).join('\n\n');

            const embed = new EmbedBuilder()
                .setColor('#9932cc')
                .setTitle('📜 Lịch sử nhạc')
                .setDescription(songList)
                .setFooter({ text: `Hiển thị ${recentSongs.length}/${history.songs.length} bài gần nhất` });

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

    async clearHistory(interaction, userHistoryDir) {
        const historyPath = path.join(userHistoryDir, 'songs.json');

        try {
            await fs.unlink(historyPath);
            interaction.reply('🗑️ Đã xóa lịch sử nhạc!');
        } catch (error) {
            if (error.code === 'ENOENT') {
                interaction.reply('📜 Lịch sử nhạc đã trống!');
            } else {
                console.error('Lỗi khi xóa lịch sử:', error);
                interaction.reply('❌ Lỗi khi xóa lịch sử nhạc!');
            }
        }
    }
};

// Utility function để thêm bài hát vào lịch sử
async function addToHistory(userId, songInfo) {
    const userHistoryDir = path.join(HISTORY_DIR, userId);
    const historyPath = path.join(userHistoryDir, 'songs.json');

    try {
        await fs.mkdir(userHistoryDir, { recursive: true });

        let history = { songs: [] };
        try {
            const data = await fs.readFile(historyPath, 'utf8');
            history = JSON.parse(data);
        } catch (error) {
            // File không tồn tại, sử dụng history trống
        }

        // Thêm bài hát mới
        history.songs.push({
            title: songInfo.title,
            url: songInfo.url,
            duration: songInfo.duration,
            thumbnail: songInfo.thumbnail,
            playedAt: new Date().toISOString(),
            requester: songInfo.requester
        });

        // Giữ tối đa 100 bài hát gần nhất
        if (history.songs.length > 100) {
            history.songs = history.songs.slice(-100);
        }

        await fs.writeFile(historyPath, JSON.stringify(history, null, 2));
    } catch (error) {
        console.error('Lỗi khi lưu lịch sử:', error);
    }
}

module.exports.addToHistory = addToHistory;
