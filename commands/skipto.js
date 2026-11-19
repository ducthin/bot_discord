const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { initGuildMusicData, createMusicConnection, jumpToSong } = require('../utils/musicUtils');
const { canSkipImmediately } = require('../utils/skipVote');

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
        const guildData = initGuildMusicData(interaction.guildId);

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

            if (!canSkipImmediately(interaction.member)) {
                return interaction.editReply('🗳️ Trong phòng có từ 3 người, chỉ DJ được dùng /skipto. Dùng /skip để bỏ phiếu.');
            }
            createMusicConnection(interaction.member, guildData);
            guildData.textChannel = interaction.channel;
            const targetSong = await jumpToSong(guildData, position);
            if (!targetSong) return interaction.editReply('❌ Queue đã thay đổi. Vui lòng xem `/queue` rồi thử lại.');
            const skippedCount = position - 1;

            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('⏭️ Đã skip đến bài hát')
                .setDescription(`**${targetSong.title}**`)
                .addFields(
                    { name: 'Vị trí cũ', value: `#${position}`, inline: true },
                    { name: 'Bài đã skip', value: `${skippedCount} bài`, inline: true },
                    { name: 'Thời lượng', value: targetSong.duration || 'N/A', inline: true }
                )
                .setThumbnail(targetSong.thumbnail || null);

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Lỗi skipto command:', error);
            await interaction.editReply({
                content: '❌ Có lỗi khi skip đến bài hát!'
            });
        }
    }
};
