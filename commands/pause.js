const { SlashCommandBuilder } = require('discord.js');
const { initGuildMusicData } = require('../utils/musicUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pause')
        .setDescription('Tạm dừng nhạc'),

    async execute(interaction) {
        const guildData = initGuildMusicData(interaction.guild.id);
        
        if (!guildData.player) {
            return interaction.reply('❌ Không có nhạc nào đang phát!');
        }
        
        guildData.player.pause();
        interaction.reply('⏸️ Đã tạm dừng nhạc!');
    }
};
