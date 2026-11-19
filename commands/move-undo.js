const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { canMoveBetween, moveVoiceMember, getLastMove, forgetMove } = require('../utils/voiceMoves');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('move-undo')
        .setDescription('Hoàn tác lần chuyển kênh thoại gần nhất của bạn')
        .setDefaultMemberPermissions(PermissionFlagsBits.MoveMembers),

    async execute(interaction) {
        const { guild, member } = interaction;
        if (!guild || !member) {
            return interaction.reply({ content: '❌ Hãy dùng lệnh này trong máy chủ.', flags: MessageFlags.Ephemeral });
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const reply = content => interaction.editReply({ content, allowedMentions: { parse: [] } });
        const move = getLastMove(guild, member.id);
        if (!move) return reply('ℹ️ Bạn chưa có lần /move nào có thể hoàn tác trong 5 phút gần đây.');

        const target = guild.members.cache.get(move.targetId);
        const current = target?.voice?.channel;
        if (current?.id !== move.destinationId) return reply('❌ Thành viên không còn ở phòng mà bạn đã chuyển họ đến.');
        const original = guild.channels.cache.get(move.sourceId);
        if (!original?.isVoiceBased()) return reply('❌ Phòng thoại ban đầu không còn khả dụng.');
        if (!canMoveBetween(member, current, original) || !canMoveBetween(guild.members.me, current, original)) {
            return reply('❌ Bạn và bot cần quyền **Di chuyển thành viên** ở cả hai kênh và **Kết nối** ở phòng ban đầu.');
        }

        const error = await moveVoiceMember(guild, target, original);
        if (error) return reply(error);
        forgetMove(guild, member.id, move);
        return reply(`✅ Đã chuyển <@${target.id}> về <#${original.id}>.`);
    }
};
