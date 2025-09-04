const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { initGuildMusicData } = require('../utils/musicUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('debug')
        .setDescription('Debug thông tin bot và voice connection'),

    async execute(interaction) {
        const guildData = initGuildMusicData(interaction.guildId);
        const member = interaction.member;

        const embed = new EmbedBuilder()
            .setColor('#ffff00')
            .setTitle('🔧 Debug Information')
            .setTimestamp();

        // Voice channel info
        const voiceChannel = member.voice.channel;
        if (voiceChannel) {
            embed.addFields({
                name: '🔊 Voice Channel',
                value: `✅ ${voiceChannel.name} (ID: ${voiceChannel.id})`,
                inline: false
            });
        } else {
            embed.addFields({
                name: '🔊 Voice Channel',
                value: '❌ Bạn không ở trong voice channel nào',
                inline: false
            });
        }

        // Bot connection info
        if (guildData.connection) {
            const connectionState = guildData.connection.state.status;
            embed.addFields({
                name: '🤖 Bot Connection',
                value: `✅ Connected (Status: ${connectionState})`,
                inline: false
            });
        } else {
            embed.addFields({
                name: '🤖 Bot Connection',
                value: '❌ Bot không kết nối voice channel',
                inline: false
            });
        }

        // Player info
        if (guildData.player) {
            const playerState = guildData.player.state.status;
            embed.addFields({
                name: '🎵 Audio Player',
                value: `Status: ${playerState}`,
                inline: true
            });
        } else {
            embed.addFields({
                name: '🎵 Audio Player',
                value: '❌ Không có player',
                inline: true
            });
        }

        // Queue info
        embed.addFields(
            {
                name: '📋 Queue Status',
                value: `${guildData.queue.length} bài trong queue`,
                inline: true
            },
            {
                name: '▶️ Playing Status',
                value: guildData.isPlaying ? '✅ Đang phát' : '❌ Không phát',
                inline: true
            }
        );

        // Current song
        if (guildData.currentSong) {
            embed.addFields({
                name: '🎵 Current Song',
                value: `**${guildData.currentSong.title}**\nURL: ${guildData.currentSong.url}`,
                inline: false
            });
        }

        // Error info
        embed.addFields(
            {
                name: '🔢 Error Count',
                value: `${guildData.errorCount || 0} lỗi`,
                inline: true
            },
            {
                name: '🔄 Retry Count',
                value: `${guildData.streamRetryCount || 0} retry`,
                inline: true
            },
            {
                name: '🔊 Volume',
                value: `${guildData.volume || 50}%`,
                inline: true
            }
        );

        // Bot permissions
        const permissions = voiceChannel?.permissionsFor(interaction.guild.members.me);
        if (permissions) {
            const hasConnect = permissions.has('Connect');
            const hasSpeak = permissions.has('Speak');
            const hasUseVAD = permissions.has('UseVAD');

            embed.addFields({
                name: '🔐 Bot Permissions',
                value: `Connect: ${hasConnect ? '✅' : '❌'}\nSpeak: ${hasSpeak ? '✅' : '❌'}\nUse VAD: ${hasUseVAD ? '✅' : '❌'}`,
                inline: false
            });
        }

        await interaction.reply({ embeds: [embed] });
    }
};