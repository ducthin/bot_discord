const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Hiển thị danh sách lệnh và cách sử dụng'),

    async execute(interaction) {
        const helpEmbed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('🎵 Hướng dẫn sử dụng Music Bot')
            .setDescription('Danh sách tất cả lệnh có sẵn:')
            .addFields(
                {
                    name: '🎶 Lệnh phát nhạc',
                    value: '`/play` hoặc `/p` - Phát nhạc từ YouTube\n`/playlist` - Phát playlist từ YouTube',
                    inline: false
                },
                {
                    name: '⏯️ Lệnh điều khiển',
                    value: '`/pause` hoặc `/ps` - Tạm dừng nhạc\n`/resume` hoặc `/r` - Tiếp tục phát nhạc\n`/skip` hoặc `/s` - Bỏ qua bài hiện tại\n`/stop` hoặc `/st` - Dừng nhạc và xóa queue',
                    inline: false
                },
                {
                    name: '� Lệnh nâng cao',
                    value: '`/volume` hoặc `/v` - Điều chỉnh âm lượng (0-100)\n`/loop` hoặc `/lp` - Bật/tắt lặp lại\n`/autoplay` - Tự động phát nhạc liên quan',
                    inline: false
                },
                {
                    name: '�📋 Lệnh thông tin',
                    value: '`/queue` hoặc `/q` - Hiển thị danh sách phát\n`/nowplaying` hoặc `/np` - Hiển thị bài đang phát\n`/lyrics` hoặc `/l` - Hiển thị lời bài hát\n`/history` hoặc `/his` - Lịch sử nhạc đã phát',
                    inline: false
                },
                {
                    name: '� Lệnh playlist',
                    value: '`/playlist-save save` - Lưu queue thành playlist\n`/playlist-save load` - Load playlist đã lưu\n`/playlist-save list` - Xem danh sách playlist\n`/playlist-save delete` - Xóa playlist',
                    inline: false
                },
                {
                    name: '�🚪 Lệnh khác',
                    value: '`/leave` hoặc `/dc` - Bot rời khỏi voice channel\n`/shuffle` - Xáo trộn danh sách phát',
                    inline: false
                },
                {
                    name: '💡 Tính năng mới',
                    value: '• **Volume Control**: Điều chỉnh âm lượng từ 0-100%\n• **Loop Mode**: Lặp lại bài hiện tại hoặc toàn bộ queue\n• **Autoplay**: Tự động phát nhạc liên quan\n• **Save Playlist**: Lưu và quản lý playlist cá nhân\n• **Music History**: Xem lịch sử các bài đã nghe',
                    inline: false
                }
            )
            .setFooter({ text: 'Music Bot - Enhanced với Volume, Loop, Autoplay, Playlist Save, History' })
            .setTimestamp();

        await interaction.reply({ embeds: [helpEmbed] });
    }
};
