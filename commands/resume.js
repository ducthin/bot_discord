const { SlashCommandBuilder } = require('discord.js');
const { initGuildMusicData } = require('../utils/musicUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('resume')
        .setDescription('Tiếp tục phát nhạc'),

    async execute(interaction) {
        const guildData = initGuildMusicData(interaction.guild.id);
        
        if (!guildData.player) {
            return interaction.reply('❌ Không có nhạc nào đang phát!');
        }
        
        guildData.player.unpause();
        interaction.reply('▶️ Đã tiếp tục phát nhạc!');
    }
};
