const { randomUUID } = require('crypto');
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { canJoinVoice, canMoveBetween, moveVoiceMember } = require('../utils/voiceMoves');

const CALL_TTL = 60000;
const MAX_CALLS = 50;
const guildCalls = new WeakMap();
const privateReply = (interaction, content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
const closedInvite = content => ({ content, components: [], allowedMentions: { parse: [] } });

module.exports = {
    data: new SlashCommandBuilder()
        .setName('call')
        .setDescription('Mời một người sang kênh thoại của bạn')
        .addUserOption(option => option.setName('user')
            .setDescription('Người đang ở một kênh thoại khác')
            .setRequired(true)),

    async execute(interaction) {
        const { guild, member } = interaction;
        const destination = member?.voice?.channel;
        if (!guild || !destination) return privateReply(interaction, '❌ Hãy vào một kênh thoại trước khi mời.');

        const target = interaction.options.getMember('user');
        if (!target?.user || target.user.bot || target.id === member.id) {
            return privateReply(interaction, '❌ Hãy chọn một thành viên khác trong máy chủ.');
        }
        const source = target.voice?.channel;
        if (!source) return privateReply(interaction, '❌ Thành viên này hiện không ở kênh thoại.');
        if (source.id === destination.id) return privateReply(interaction, 'ℹ️ Hai bạn đang ở cùng kênh thoại.');
        if (!canJoinVoice(target, destination)) {
            return privateReply(interaction, '❌ Thành viên này cần quyền xem và kết nối vào kênh thoại của bạn.');
        }
        if (!interaction.channel?.permissionsFor?.(target)?.has(PermissionFlagsBits.ViewChannel)) {
            return privateReply(interaction, '❌ Hãy gửi lời mời ở kênh chat mà cả hai người đều xem được.');
        }
        if (!canMoveBetween(guild.members.me, source, destination)) {
            return privateReply(interaction, '❌ Bot cần quyền **Di chuyển thành viên** ở cả hai kênh và **Kết nối** ở kênh của bạn.');
        }

        if (!guildCalls.has(guild)) guildCalls.set(guild, new Map());
        const calls = guildCalls.get(guild);
        const now = Date.now();
        for (const invite of calls.values()) {
            if (invite.expiresAt > now && invite.senderId === member.id) {
                return privateReply(interaction, '⏳ Bạn có thể gửi một lời mời mỗi phút.');
            }
            if (invite.expiresAt > now && invite.targetId === target.id && !invite.closed) {
                return privateReply(interaction, '⏳ Thành viên này đang có một lời mời chờ trả lời.');
            }
        }
        if (calls.size >= MAX_CALLS) return privateReply(interaction, '⏳ Đang có nhiều lời mời. Hãy thử lại sau.');

        const id = randomUUID();
        const invite = { senderId: member.id, targetId: target.id, sourceId: source.id,
            destinationId: destination.id, expiresAt: now + CALL_TTL, closed: false };
        calls.set(id, invite);
        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('voice_call_accept_' + id).setLabel('Đồng ý').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('voice_call_decline_' + id).setLabel('Từ chối').setStyle(ButtonStyle.Secondary)
        );

        try {
            await interaction.reply({
                content: `<@${target.id}>, <@${member.id}> mời bạn sang <#${destination.id}>. Lời mời có hiệu lực trong 1 phút.`,
                components: [buttons],
                allowedMentions: { parse: [], users: [target.id] }
            });
        } catch (error) {
            calls.delete(id);
            throw error;
        }

        setTimeout(() => {
            calls.delete(id);
            if (!invite.closed) void interaction.editReply(closedInvite('⌛ Lời mời vào kênh thoại đã hết hạn.')).catch(() => {});
        }, Math.max(0, invite.expiresAt - Date.now())).unref();
    },

    async respond(interaction) {
        const [action, id] = interaction.customId.slice('voice_call_'.length).split('_');
        const { guild } = interaction;
        const invite = guildCalls.get(guild)?.get(id);
        if (!invite || invite.closed || invite.expiresAt <= Date.now() || !['accept', 'decline'].includes(action)) {
            return privateReply(interaction, '⌛ Lời mời đã hết hạn hoặc đã được xử lý.');
        }
        if (interaction.user.id !== invite.targetId) return privateReply(interaction, '❌ Lời mời này dành cho người được nhắc tên.');

        invite.closed = true;
        if (action === 'decline') return interaction.update(closedInvite('🚫 Người được mời đã từ chối.'));
        await interaction.deferUpdate();

        const target = interaction.member;
        const source = target?.voice?.channel;
        const destination = guild.members.cache.get(invite.senderId)?.voice?.channel;
        if (source?.id !== invite.sourceId || destination?.id !== invite.destinationId || !canJoinVoice(target, destination)) {
            return interaction.editReply(closedInvite('❌ Vị trí hoặc quyền vào kênh thoại đã thay đổi. Hãy gửi lời mời mới.'));
        }
        if (!canMoveBetween(guild.members.me, source, destination)) {
            return interaction.editReply(closedInvite('❌ Bot không đủ quyền chuyển thành viên giữa hai kênh.'));
        }

        const error = await moveVoiceMember(guild, target, destination);
        return interaction.editReply(closedInvite(error || `✅ <@${target.id}> đã đồng ý và được chuyển sang <#${destination.id}>.`));
    }
};
