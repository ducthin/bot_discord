const { SlashCommandBuilder } = require('discord.js');
const { initGuildMusicData, removeButtons } = require('../utils/musicUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Bỏ qua bài hát hiện tại'),

    async execute(interaction) {
        const guildData = initGuildMusicData(interaction.guild.id);
        
        if (!guildData.player || guildData.queue.length === 0) {
            return interaction.reply('❌ Không có nhạc nào để bỏ qua!');
        }
        
        // Xóa buttons của bài hiện tại
        if (guildData.currentSong) {
            await removeButtons(guildData, guildData.currentSong.title);
        }
        
        guildData.player.stop();
        interaction.reply('⏭️ Đã bỏ qua bài hát!');
    }
};
