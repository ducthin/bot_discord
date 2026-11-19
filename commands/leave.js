const { SlashCommandBuilder } = require('discord.js');
const { musicData, disconnectMusic } = require('../utils/musicUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leave')
        .setDescription('Bot rời khỏi voice channel'),

    async execute(interaction) {
        const { guild } = interaction;
        const guildData = musicData.get(guild.id);
        
        if (guildData && guildData.connection) {
            await disconnectMusic(guildData);
            interaction.reply('👋 Đã rời voice channel!');
        } else {
            interaction.reply('❌ Bot không trong voice channel nào!');
        }
    }
};
