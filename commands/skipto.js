const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getMusicData } = require('../utils/musicUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('skipto')
        .setDescription('Skip đến vị trí cụ thể trong queue')
        .addIntegerOption(option =>
            option.setName('position')
                .setDescription('Vị trí bài hát cần skip đến (1, 2, 3...)')
                .setRequired(true)),

    async execute(interaction) {
        const position = interaction.options.getInteger('position');
        const guildData = getMusicData(interaction.guildId);

        if (!interaction.member.voice.channel) {
            return interaction.reply({
                content: '❌ Bạn cần vào voice channel để sử dụng lệnh này!',
                ephemeral: true
            });
        }

        if (!guildData.queue || guildData.queue.length === 0) {
            return interaction.reply({
                content: '❌ Queue hiện tại đang trống!',
                ephemeral: true
            });
        }

        if (position < 1 || position > guildData.queue.length) {
            return interaction.reply({
                content: `❌ Vị trí không hợp lệ! Queue có ${guildData.queue.length} bài hát.`,
                ephemeral: true
            });
        }

        try {
            await interaction.deferReply();

            // Lấy thông tin bài hát được chọn
            const targetSong = guildData.queue[position - 1];
            const skippedCount = position - 1;

            // Xóa tất cả bài hát trước vị trí được chọn
            guildData.queue.splice(0, skippedCount);

            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('⏭️ Đã skip đến bài hát')
                .setDescription(`**${targetSong.title}**`)
                .addFields(
                    { name: 'Vị trí cũ', value: `#${position}`, inline: true },
                    { name: 'Bài đã skip', value: `${skippedCount} bài`, inline: true },
                    { name: 'Thời lượng', value: targetSong.duration || 'N/A', inline: true }
                )
                .setThumbnail(targetSong.thumbnail);

            await interaction.editReply({ embeds: [embed] });

            // Nếu đang phát nhạc, stop và phát bài mới
            if (guildData.player && guildData.isPlaying) {
                guildData.player.stop();
            }

            // Bắt đầu phát bài được chọn
            const { createMusicConnection, playMusic } = require('../utils/musicUtils');
            
            if (!guildData.connection) {
                createMusicConnection(interaction.member, guildData);
            }
            
            playMusic(guildData);

        } catch (error) {
            console.error('Lỗi skipto command:', error);
            await interaction.editReply({
                content: '❌ Có lỗi khi skip đến bài hát!'
            });
        }
    }
};
