const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { initGuildMusicData } = require('../utils/musicUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('quickselect')
        .setDescription('Chọn nhanh bài hát từ 5 bài đầu trong queue'),

    async execute(interaction) {
        const guildData = initGuildMusicData(interaction.guildId);

        if (!guildData.queue || guildData.queue.length === 0) {
            return interaction.reply({
                content: '❌ Queue hiện tại đang trống!',
                ephemeral: true
            });
        }

        if (!interaction.member.voice.channel) {
            return interaction.reply({
                content: '❌ Bạn cần vào voice channel để sử dụng lệnh này!',
                ephemeral: true
            });
        }

        try {
            await interaction.deferReply();

            // Lấy tối đa 5 bài đầu
            const songsToShow = Math.min(5, guildData.queue.length);
            const buttons = [];

            // Tạo buttons cho mỗi bài hát
            for (let i = 0; i < songsToShow; i++) {
                const song = guildData.queue[i];
                const isCurrentSong = i === 0;
                
                buttons.push(
                    new ButtonBuilder()
                        .setCustomId(`select_song_${i}`)
                        .setLabel(`${i + 1}. ${song.title.length > 50 ? song.title.substring(0, 47) + '...' : song.title}`)
                        .setStyle(isCurrentSong ? ButtonStyle.Success : ButtonStyle.Primary)
                        .setEmoji(isCurrentSong ? '▶️' : '🎵')
                );
            }

            // Chia buttons thành rows (tối đa 5 buttons/row)
            const rows = [];
            for (let i = 0; i < buttons.length; i += 5) {
                rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
            }

            // Thêm row điều khiển
            const controlRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('show_full_queue')
                        .setLabel('📋 Xem toàn bộ queue')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId('shuffle_music')
                        .setLabel('🔀 Trộn bài')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId('clear_queue')
                        .setLabel('🗑️ Xóa queue')
                        .setStyle(ButtonStyle.Danger)
                );

            rows.push(controlRow);

            // Tạo embed hiển thị
            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('🎵 Quick Select - Chọn nhanh bài hát')
                .setDescription(`Chọn một trong ${songsToShow} bài đầu để phát ngay:`)
                .addFields(
                    { name: 'Tổng số bài', value: `${guildData.queue.length} bài`, inline: true },
                    { name: 'Đang phát', value: guildData.isPlaying ? '✅ Có' : '❌ Không', inline: true },
                    { name: 'Voice Channel', value: interaction.member.voice.channel.name, inline: true }
                )
                .setFooter({ text: 'Nhấn vào button bài hát để phát ngay lập tức' });

            await interaction.editReply({ 
                embeds: [embed], 
                components: rows 
            });

        } catch (error) {
            console.error('Lỗi quickselect command:', error);
            await interaction.editReply({
                content: '❌ Có lỗi khi load quick select!'
            });
        }
    }
};
