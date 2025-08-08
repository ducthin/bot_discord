const { SlashCommandBuilder } = require('discord.js');
const { initGuildMusicData, removeButtons } = require('../utils/musicUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Dừng phát nhạc và xóa queue'),

    async execute(interaction) {
        const guildData = initGuildMusicData(interaction.guild.id);
        
        if (!guildData.player) {
            return interaction.reply('❌ Không có nhạc nào đang phát!');
        }
        
        // Xóa buttons của bài hiện tại
        if (guildData.currentSong) {
            await removeButtons(guildData, guildData.currentSong.title);
        }
        
        guildData.queue = [];
        guildData.player.stop();
        interaction.reply('⏹️ Đã dừng phát nhạc và xóa queue!');
    }
};
