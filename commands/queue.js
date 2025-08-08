const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { initGuildMusicData } = require('../utils/musicUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('queue')
        .setDescription('Hiển thị danh sách phát'),

    async execute(interaction) {
        const guildData = initGuildMusicData(interaction.guild.id);
        
        if (guildData.queue.length === 0) {
            return interaction.reply('📭 danh sách trống!');
        }

        const queueList = guildData.queue.slice(0, 10).map((song, index) => {
            const status = index === 0 ? '🎵 ' : `${index + 1}. `;
            return `${status}**${song.title}** - ${song.duration}`;
        }).join('\n');

        const queueEmbed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('🎵 Danh sách phát')
            .setDescription(queueList)
            .setFooter({ text: `Tổng cộng ${guildData.queue.length} bài hát` });

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
            embeds: [queueEmbed], 
            components: [controlButtons] 
        });
    }
};
