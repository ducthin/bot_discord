const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { musicData } = require('../utils/musicUtils');
const { getAllowedGuilds } = require('../utils/guildUtils');

module.exports = {
    data: new SlashCommandBuilder().setName('botstatus').setDescription('Kiểm tra trạng thái bot và quyền phát nhạc của server')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply({ content: '❌ Lệnh này dành cho người có quyền Quản lý máy chủ.', flags: MessageFlags.Ephemeral });
        }
        const data = musicData.get(interaction.guildId);
        const voice = interaction.guild.members.me?.voice.channel ?? interaction.member.voice.channel;
        const permissions = voice?.permissionsFor(interaction.guild.members.me);
        const voicePermissions = permissions ? ['Connect', 'Speak'].map(name => `${permissions.has(name) ? '✅' : '❌'} ${name}`).join(' · ') : 'Chưa chọn kênh voice';
        const embed = new EmbedBuilder().setColor('#0099ff').setTitle('🔧 Trạng thái bot').addFields(
            { name: 'Discord', value: interaction.client.isReady() ? '✅ Đã kết nối' : '⚠️ Chưa sẵn sàng', inline: true },
            { name: 'Server được cấu hình', value: String(getAllowedGuilds().length), inline: true },
            { name: 'Kênh voice', value: voice?.name ?? 'Chưa kết nối', inline: true },
            { name: 'Quyền trong kênh', value: voicePermissions, inline: true },
            { name: 'Bộ phát', value: data?.player?.state.status ?? 'idle', inline: true },
            { name: 'Hàng đợi', value: `${data?.queue.length ?? 0} bài`, inline: true }
        );
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
};
