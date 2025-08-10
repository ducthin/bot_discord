const { SlashCommandBuilder } = require('discord.js');
const { initGuildMusicData } = require('../utils/musicUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('volume')
        .setDescription('Điều chỉnh âm lượng nhạc (0-100)')
        .addIntegerOption(option =>
            option.setName('level')
                .setDescription('Mức âm lượng (0-100)')
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(100)
        ),

    async execute(interaction) {
        const { guild, member } = interaction;
        
        if (!member.voice.channel) {
            return interaction.reply('❌ Bạn cần vào voice channel để điều chỉnh âm lượng!');
        }

        const guildData = initGuildMusicData(guild.id);
        
        if (!guildData.isPlaying || !guildData.player) {
            return interaction.reply('❌ Không có nhạc nào đang phát!');
        }

        const volume = interaction.options.getInteger('level');
        const volumeDecimal = volume / 100;

        // Cập nhật volume cho audio resource hiện tại
        if (guildData.audioResource && guildData.audioResource.volume) {
            guildData.audioResource.volume.setVolume(volumeDecimal);
        }

        // Lưu volume setting
        guildData.volume = volume;

        interaction.reply(`🔊 Đã điều chỉnh âm lượng thành ${volume}%`);
    }
};
