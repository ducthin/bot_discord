const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { initGuildMusicData } = require('../utils/musicUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('controls')
        .setDescription('Hiển thị panel điều khiển nhạc'),

    async execute(interaction) {
        const guildData = initGuildMusicData(interaction.guildId);

        if (!interaction.member.voice.channel) {
            return interaction.reply({
                content: '❌ Bạn cần vào voice channel để sử dụng lệnh này!',
                ephemeral: true
            });
        }

        try {
            await interaction.deferReply();

            const currentSong = guildData.queue && guildData.queue[0];
            
            // Row 1: Điều khiển phát nhạc
            const playbackRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('music_pause')
                        .setLabel('⏸️ Tạm dừng')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId('music_resume')
                        .setLabel('▶️ Tiếp tục')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId('music_skip')
                        .setLabel('⏭️ Bỏ qua')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('music_stop')
                        .setLabel('⏹️ Dừng')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId('music_shuffle')
                        .setLabel('🔀 Trộn bài')
                        .setStyle(ButtonStyle.Secondary)
                );

            // Row 2: Âm lượng
            const volumeRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('volume_down')
                        .setLabel('🔉 -10%')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId('volume_up')
                        .setLabel('🔊 +10%')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId('volume_mute')
                        .setLabel('🔇 Tắt tiếng')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId('volume_max')
                        .setLabel('📢 Max')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId('volume_reset')
                        .setLabel('🔄 Reset (50%)')
                        .setStyle(ButtonStyle.Secondary)
                );

            // Row 3: Queue management
            const queueRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('show_queue')
                        .setLabel('📋 Queue')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('show_nowplaying')
                        .setLabel('🎵 Đang phát')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('loop_toggle')
                        .setLabel('🔁 Loop')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId('quick_select')
                        .setLabel('⚡ Quick Select')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId('leave_voice')
                        .setLabel('👋 Rời khỏi')
                        .setStyle(ButtonStyle.Danger)
                );

            // Tạo embed
            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('🎛️ Music Control Panel')
                .setDescription('Sử dụng các nút bên dưới để điều khiển nhạc:');

            if (currentSong) {
                embed.addFields(
                    { name: '🎵 Đang phát', value: currentSong.title, inline: false },
                    { name: '⏱️ Thời lượng', value: currentSong.duration || 'Không xác định', inline: true },
                    { name: '👤 Yêu cầu bởi', value: `<@${currentSong.requestedBy}>`, inline: true },
                    { name: '🔊 Âm lượng', value: `${guildData.volume || 50}%`, inline: true }
                );
            } else {
                embed.addFields(
                    { name: '🎵 Trạng thái', value: 'Không có bài hát nào đang phát', inline: false },
                    { name: '📊 Queue', value: `${guildData.queue?.length || 0} bài`, inline: true },
                    { name: '🔊 Âm lượng', value: `${guildData.volume || 50}%`, inline: true }
                );
            }

            embed.setFooter({ text: 'Control panel sẽ tự động cập nhật khi có thay đổi' });

            await interaction.editReply({ 
                embeds: [embed], 
                components: [playbackRow, volumeRow, queueRow] 
            });

        } catch (error) {
            console.error('Lỗi controls command:', error);
            await interaction.editReply({
                content: '❌ Có lỗi khi load control panel!'
            });
        }
    }
};
