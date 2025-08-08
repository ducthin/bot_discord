const { SlashCommandBuilder } = require('discord.js');
const { initGuildMusicData } = require('../utils/musicUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Dừng phát nhạc và xóa queue'),

    async execute(interaction) {
        const guildData = initGuildMusicData(interaction.guild.id);
        
        if (!guildData.player) {
            return interaction.reply('❌ Không có nhạc nào đang phát!');
        }
        
        guildData.queue = [];
        guildData.player.stop();
        interaction.reply('⏹️ Đã dừng phát nhạc và xóa queue!');
    }
};
