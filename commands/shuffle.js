const { SlashCommandBuilder } = require('discord.js');
const { initGuildMusicData } = require('../utils/musicUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shuffle')
        .setDescription('Xáo trộn danh sách phát'),

    async execute(interaction) {
        const guildData = initGuildMusicData(interaction.guild.id);
        
        if (guildData.queue.length < 2) {
            return interaction.reply('❌ Cần ít nhất 2 bài hát trong queue để xáo trộn!');
        }

        // Giữ bài đầu tiên (đang phát), xáo trộn phần còn lại
        const currentSong = guildData.queue[0];
        const restOfQueue = guildData.queue.slice(1);
        
        for (let i = restOfQueue.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [restOfQueue[i], restOfQueue[j]] = [restOfQueue[j], restOfQueue[i]];
        }
        
        guildData.queue = [currentSong, ...restOfQueue];
        interaction.reply('🔀 Đã xáo trộn queue!');
    }
};
