const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { initGuildMusicData, buildNowPlayingEmbed } = require('../utils/musicUtils');
const { buildPlaybackRows } = require('../utils/playbackControls');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('nowplaying')
        .setDescription('Hiển thị bài hát đang phát'),

    async execute(interaction) {
        const guildData = initGuildMusicData(interaction.guild.id);
        return this.show(interaction, guildData);
    },

    async show(interaction, guildData, flags) {
        if (!guildData.currentSong) {
            return interaction.reply({ content: '❌ Không có bài nào đang phát.', flags: MessageFlags.Ephemeral });
        }
        return interaction.reply({
            embeds: [buildNowPlayingEmbed(guildData)],
            components: buildPlaybackRows(guildData.currentSong),
            flags
        });
    }
};
