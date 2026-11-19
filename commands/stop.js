const { SlashCommandBuilder } = require('discord.js');
const { initGuildMusicData, stopMusic } = require('../utils/musicUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Dừng phát nhạc và xóa queue'),

    async execute(interaction) {
        const guildData = initGuildMusicData(interaction.guildId);
        const stopped = stopMusic(guildData);
        await interaction.reply('⏹️ Đã dừng hàng đợi và hủy yêu cầu nhạc đang tải.');
        await stopped;
    }
};
