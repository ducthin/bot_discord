const { SlashCommandBuilder, ChannelType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { canMoveBetween, moveVoiceMember, rememberMove } = require('../utils/voiceMoves');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('move')
        .setDescription('Chuyển một thành viên sang kênh thoại khác')
        .setDefaultMemberPermissions(PermissionFlagsBits.MoveMembers)
        .addUserOption(option => option.setName('user')
            .setDescription('Thành viên đang ở kênh thoại')
            .setRequired(true))
        .addChannelOption(option => option.setName('channel')
            .setDescription('Kênh thoại muốn chuyển đến')
            .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
            .setRequired(true)),

    async execute(interaction) {
        const { guild, member } = interaction;
        if (!guild || !member) {
            return interaction.reply({ content: '❌ Hãy dùng lệnh này trong máy chủ.', flags: MessageFlags.Ephemeral });
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const reply = content => interaction.editReply({ content, allowedMentions: { parse: [] } });
        const target = interaction.options.getMember('user');
        const source = target?.voice?.channel;
        const destination = guild.channels.cache.get(interaction.options.getChannel('channel', true).id);

        if (!source) return reply('❌ Thành viên này hiện không ở kênh thoại.');
        if (!destination?.isVoiceBased()) return reply('❌ Hãy chọn một kênh thoại trong máy chủ.');
        if (!canMoveBetween(member, source, destination)) {
            return reply('❌ Bạn cần quyền **Di chuyển thành viên** ở cả hai kênh và quyền **Kết nối** ở kênh đích.');
        }
        if (source.id === destination.id) return reply('ℹ️ Thành viên này đã ở kênh đích.');
        if (!canMoveBetween(guild.members.me, source, destination)) {
            return reply('❌ Bot cần quyền **Di chuyển thành viên** ở cả hai kênh và quyền **Kết nối** ở kênh đích.');
        }

        const error = await moveVoiceMember(guild, target, destination);
        if (error) return reply(error);
        rememberMove(guild, member.id, target.id, source.id, destination.id);
        return reply(`✅ Đã chuyển <@${target.id}> sang <#${destination.id}>. Dùng /move-undo trong 5 phút để hoàn tác.`);
    }
};
