const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { initGuildMusicData, seekMusic } = require('../utils/musicUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('seek')
        .setDescription('Tua nhạc tới thời điểm cụ thể')
        .addStringOption(option =>
            option.setName('time')
                .setDescription('Thời gian muốn tua tới (ví dụ: 1:30 hoặc 90)')
                .setRequired(true)),

    async execute(interaction) {
        const guildData = initGuildMusicData(interaction.guild.id);

        if (!guildData.currentSong) {
            return interaction.reply({ content: '❌ Không có nhạc nào đang phát!', flags: MessageFlags.Ephemeral });
        }

        const timeStr = interaction.options.getString('time');
        let seconds = 0;

        // Parse time string
        if (timeStr.includes(':')) {
            const parts = timeStr.split(':').map(Number);
            if (parts.some(isNaN)) {
                return interaction.reply({ 
                    content: '❌ Định dạng thời gian không hợp lệ! Hãy dùng dạng `MM:SS` (ví dụ `1:30`) hoặc số giây (ví dụ `90`).', 
                    flags: MessageFlags.Ephemeral 
                });
            }
            if (parts.length === 2) {
                seconds = parts[0] * 60 + parts[1];
            } else if (parts.length === 3) {
                seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
            } else {
                return interaction.reply({ content: '❌ Định dạng thời gian không hợp lệ!', flags: MessageFlags.Ephemeral });
            }
        } else {
            seconds = parseInt(timeStr);
            if (isNaN(seconds) || seconds < 0) {
                return interaction.reply({ 
                    content: '❌ Định dạng thời gian không hợp lệ! Hãy điền số giây là số nguyên dương.', 
                    flags: MessageFlags.Ephemeral 
                });
            }
        }

        const { durationToSeconds } = require('../utils/musicUtils');
        const song = guildData.currentSong;
        const totalDuration = durationToSeconds(song.duration);
        
        if (totalDuration > 0 && seconds >= totalDuration) {
            return interaction.reply({ 
                content: `❌ Thời gian tua tới vượt quá tổng thời lượng bài hát (${guildData.currentSong.duration})!`, 
                flags: MessageFlags.Ephemeral 
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            if (!await seekMusic(guildData, seconds, song)) {
                return interaction.editReply({ content: '❌ Không tua được bài hát. Kiểm tra lại mốc thời gian hoặc thử lại.' });
            }

            const { formatDuration } = require('../utils/musicUtils');
            await interaction.editReply({ 
                content: `✅ Đã tua bài hát tới **${formatDuration(seconds)}**.` 
            });
        } catch (error) {
            console.error('Lỗi khi tua nhạc:', error);
            await interaction.editReply({ content: '❌ Đã xảy ra lỗi khi tua nhạc!' });
        }
    }
};
