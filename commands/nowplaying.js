const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { initGuildMusicData } = require('../utils/musicUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('nowplaying')
        .setDescription('Hiển thị bài hát đang phát'),

    async execute(interaction) {
        const guildData = initGuildMusicData(interaction.guild.id);
        
        if (!guildData.currentSong) {
            return interaction.reply('❌ Không có nhạc nào đang phát!');
        }

        const nowPlayingEmbed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('🎵 Đang phát')
            .setDescription(`**${guildData.currentSong.title}**`)
            .addFields(
                { name: 'Thời lượng', value: guildData.currentSong.duration, inline: true },
                { name: 'Yêu cầu bởi', value: guildData.currentSong.requester, inline: true }
            )
            .setThumbnail(guildData.currentSong.thumbnail);

        // Tạo buttons điều khiển
        const controlButtons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('pause_music')
                    .setLabel('⏸️ Tạm dừng')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('resume_music')
                    .setLabel('▶️ Tiếp tục')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('skip_music')
                    .setLabel('⏭️ Bỏ qua')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('show_queue')
                    .setLabel('📋 danh sách')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('stop_music')
                    .setLabel('⏹️ Dừng')
                    .setStyle(ButtonStyle.Danger)
            );

        interaction.reply({ 
            embeds: [nowPlayingEmbed], 
            components: [controlButtons] 
        });
    }
};
