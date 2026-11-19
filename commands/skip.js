const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { initGuildMusicData } = require('../utils/musicUtils');
const { requestSkip } = require('../utils/skipVote');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Bỏ qua hoặc bỏ phiếu bỏ qua bài hát hiện tại'),

    async execute(interaction) {
        const guildData = initGuildMusicData(interaction.guildId);
        const result = requestSkip(interaction.member, guildData);
        return interaction.reply({ content: result.content, flags: result.private ? MessageFlags.Ephemeral : undefined });
    }
};
