const { SlashCommandBuilder } = require('discord.js');
const { initGuildMusicData } = require('../utils/musicUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('autoplay')
        .setDescription('Bật/tắt tự động phát nhạc liên quan')
        .addBooleanOption(option =>
            option.setName('enabled')
                .setDescription('Bật hoặc tắt autoplay')
                .setRequired(true)
        ),

    async execute(interaction) {
        const { guild, member } = interaction;
        
        if (!member.voice.channel) {
            return interaction.reply('❌ Bạn cần vào voice channel để sử dụng lệnh này!');
        }

        const guildData = initGuildMusicData(guild.id);
        const enabled = interaction.options.getBoolean('enabled');

        guildData.autoplay = enabled;

        const message = enabled 
            ? '🎵 Đã bật tự động phát nhạc liên quan khi hết queue'
            : '⏹️ Đã tắt tự động phát nhạc liên quan';

        interaction.reply(message);
    }
};
