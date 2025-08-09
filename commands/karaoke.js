const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { initGuildMusicData } = require('../utils/musicUtils');
const { getLyrics } = require('../utils/lyricsUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('karaoke')
        .setDescription('Chế độ karaoke với lời bài hát scrolling')
        .addBooleanOption(option =>
            option.setName('enabled')
                .setDescription('Bật/tắt chế độ karaoke')
                .setRequired(true)
        ),

    async execute(interaction) {
        const guildData = initGuildMusicData(interaction.guildId);

        if (!guildData.currentSong) {
            return interaction.reply({
                content: '❌ Không có bài hát nào đang phát!',
                ephemeral: true
            });
        }

        const enabled = interaction.options.getBoolean('enabled');

        try {
            await interaction.deferReply();

            if (enabled) {
                // Bật karaoke mode
                guildData.karaokeMode = true;
                
                // Lấy lyrics
                const lyrics = await getLyrics(guildData.currentSong.title);
                
                if (!lyrics) {
                    return interaction.editReply({
                        content: '❌ Không tìm thấy lời bài hát cho chế độ karaoke!'
                    });
                }

                // Chia lyrics thành từng dòng
                const lyricsLines = lyrics.split('\n').filter(line => line.trim());
                guildData.karaokeData = {
                    lyrics: lyricsLines,
                    currentLine: 0,
                    interval: null
                };

                // Tạo karaoke control panel
                const karaokeEmbed = new EmbedBuilder()
                    .setColor('#ff1493')
                    .setTitle('🎤 Chế độ Karaoke')
                    .setDescription(`**${guildData.currentSong.title}**\n\n🎵 Lời bài hát sẽ hiển thị theo thời gian thực!`)
                    .addFields(
                        { name: '🎯 Trạng thái', value: 'Đang chuẩn bị...', inline: true },
                        { name: '📝 Tổng số dòng', value: `${lyricsLines.length} dòng`, inline: true }
                    )
                    .setThumbnail(guildData.currentSong.thumbnail);

                const controlRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('karaoke_start')
                            .setLabel('▶️ Bắt đầu')
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId('karaoke_pause')
                            .setLabel('⏸️ Tạm dừng')
                            .setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder()
                            .setCustomId('karaoke_next_line')
                            .setLabel('⏭️ Dòng tiếp')
                            .setStyle(ButtonStyle.Primary),
                        new ButtonBuilder()
                            .setCustomId('karaoke_prev_line')
                            .setLabel('⏮️ Dòng trước')
                            .setStyle(ButtonStyle.Primary),
                        new ButtonBuilder()
                            .setCustomId('karaoke_stop')
                            .setLabel('⏹️ Tắt Karaoke')
                            .setStyle(ButtonStyle.Danger)
                    );

                await interaction.editReply({
                    embeds: [karaokeEmbed],
                    components: [controlRow]
                });

                // Lưu reference để update message
                guildData.karaokeMessage = await interaction.fetchReply();

            } else {
                // Tắt karaoke mode
                guildData.karaokeMode = false;
                if (guildData.karaokeData?.interval) {
                    clearInterval(guildData.karaokeData.interval);
                }
                guildData.karaokeData = null;
                guildData.karaokeMessage = null;

                const offEmbed = new EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle('🎤 Karaoke đã tắt')
                    .setDescription('Chế độ karaoke đã được tắt!');

                await interaction.editReply({
                    embeds: [offEmbed],
                    components: []
                });
            }

        } catch (error) {
            console.error('Lỗi karaoke command:', error);
            await interaction.editReply({
                content: '❌ Có lỗi khi thiết lập chế độ karaoke!'
            });
        }
    }
};
