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

        const queueList = guildData.queue.slice(0, 15).map((song, index) => {
            if (index === 0) {
                return `▶️ **Đang phát:** ${song.title} - ${song.duration}`;
            } else {
                return `\`${index.toString().padStart(2, ' ')}\` **${song.title}** - ${song.duration}`;
            }
        }).join('\n');

        const queueEmbed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('🎵 Danh sách phát')
            .setDescription(queueList)
            .addFields(
                { name: 'Tổng số bài', value: `${guildData.queue.length} bài`, inline: true },
                { name: 'Đang phát', value: guildData.isPlaying ? '✅ Có' : '❌ Không', inline: true }
            )
            .setFooter({ text: 'Sử dụng /select hoặc /skipto để chọn bài' });

        // Tạo buttons điều khiển với thêm select button
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
                    .setCustomId('shuffle_music')
                    .setLabel('� Trộn bài')
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
