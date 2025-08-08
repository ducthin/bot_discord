const { SlashCommandBuilder } = require('discord.js');
const { initGuildMusicData } = require('../utils/musicUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('loop')
        .setDescription('Bật/tắt chế độ lặp lại')
        .addStringOption(option =>
            option.setName('mode')
                .setDescription('Chế độ lặp lại')
                .setRequired(true)
                .addChoices(
                    { name: 'Off - Tắt lặp lại', value: 'off' },
                    { name: 'Track - Lặp lại bài hiện tại', value: 'track' },
                    { name: 'Queue - Lặp lại toàn bộ queue', value: 'queue' }
                )
        ),

    async execute(interaction) {
        const { guild, member } = interaction;
        
        if (!member.voice.channel) {
            return interaction.reply('❌ Bạn cần vào voice channel để sử dụng lệnh này!');
        }

        const guildData = initGuildMusicData(guild.id);
        const mode = interaction.options.getString('mode');

        guildData.loopMode = mode;

        let message;
        switch (mode) {
            case 'off':
                message = '🔄 Đã tắt chế độ lặp lại';
                break;
            case 'track':
                message = '🔂 Đã bật lặp lại bài hiện tại';
                break;
            case 'queue':
                message = '🔁 Đã bật lặp lại toàn bộ queue';
                break;
        }

        interaction.reply(message);
    }
};
