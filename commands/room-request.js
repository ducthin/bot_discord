const {
    SlashCommandBuilder, ChannelType, PermissionFlagsBits, MessageFlags,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, escapeMarkdown
} = require('discord.js');
const store = require('../utils/managementStore');
const { isGuildAllowed } = require('../utils/guildUtils');
const { respond, edit, hasChannelPermissions } = require('../utils/managementAccess');
const { canJoinBeforeLock, grantRoomAccess } = require('../utils/tempRooms');
const { canJoinVoice } = require('../utils/voiceMoves');

const REQUEST_TTL = 2 * 60 * 1000;
const pending = new Map();

const result = content => ({ content, components: [], allowedMentions: { parse: [] } });

module.exports = {
    data: new SlashCommandBuilder().setName('room-request').setDescription('Xin chủ phòng cho vào một phòng thoại tạm đang khóa')
        .addChannelOption(option => option.setName('channel').setDescription('Phòng muốn vào').addChannelTypes(ChannelType.GuildVoice).setRequired(true)),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const { guild, member } = interaction;
        const channelId = interaction.options.getChannel('channel', true).id;
        const channel = guild.channels.cache.get(channelId);
        const { rooms } = await store.read(guild.id);
        const room = rooms[channelId];
        if (channel?.type !== ChannelType.GuildVoice || !room?.lock) return edit(interaction, '❌ Hãy chọn phòng thoại tạm đang khóa.');
        if (member.voice.channelId === channelId || canJoinVoice(member, channel)) return edit(interaction, 'ℹ️ Bạn đã có thể vào phòng này.');
        if (!canJoinBeforeLock(member, channel, room)) return edit(interaction, '❌ Quyền của phòng không cho phép bạn xin vào.');
        const owner = guild.members.cache.get(room.ownerId);
        if (owner?.voice.channelId !== channelId) return edit(interaction, '❌ Chủ phòng đang vắng.');
        if (pending.size >= 100 || [...pending.values()].some(request => request.guild === guild && request.memberId === member.id)) {
            return edit(interaction, '⏳ Hãy đợi yêu cầu đang chờ được xử lý rồi thử lại.');
        }

        const id = interaction.id;
        const request = { guild, channelId, memberId: member.id, ownerId: owner.id, expiresAt: Date.now() + REQUEST_TTL, interaction };
        pending.set(id, request);
        try {
            await owner.send({
                content: `🚪 <@${member.id}> xin vào <#${channelId}> ở máy chủ **${escapeMarkdown(guild.name)}**. Yêu cầu hết hạn sau 2 phút.`,
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('mg_roomreq_allow_' + id).setLabel('Cho vào').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('mg_roomreq_decline_' + id).setLabel('Từ chối').setStyle(ButtonStyle.Secondary)
                )],
                allowedMentions: { parse: [] }
            });
        } catch {
            pending.delete(id);
            return edit(interaction, '❌ Bot chưa gửi được tin nhắn riêng cho chủ phòng.');
        }
        // The owner may respond while Discord is returning the direct message.
        setTimeout(() => {
            pending.delete(id);
            if (!request.answered) void edit(interaction, '⌛ Yêu cầu vào phòng đã hết hạn.').catch(() => {});
        }, Math.max(0, request.expiresAt - Date.now())).unref();
        if (!request.answered) {
            await edit(interaction, '⏳ Đã gửi yêu cầu riêng cho chủ phòng.');
        }
    },

    async button(interaction) {
        const [action, id] = interaction.customId.slice('mg_roomreq_'.length).split('_');
        const request = pending.get(id);
        if (!request || request.expiresAt <= Date.now() || !isGuildAllowed(request.guild.id) || !['allow', 'decline'].includes(action)) {
            return interaction.update(result('⌛ Yêu cầu vào phòng đã hết hiệu lực.'));
        }
        if (request.ownerId !== interaction.user.id) return respond(interaction, '❌ Yêu cầu này dành cho chủ phòng.');
        if (request.answered) return respond(interaction, 'ℹ️ Yêu cầu này đã được xử lý.');
        request.answered = true;
        await interaction.deferUpdate();
        let message = 'ℹ️ Chủ phòng đã từ chối yêu cầu.';
        if (action === 'allow') {
            try {
                message = await this.approve(request);
            } catch (error) {
                console.error('Lỗi cho phép vào phòng tạm:', error.message);
                message = '❌ Discord chưa cấp được quyền vào phòng.';
            }
        }
        await Promise.allSettled([interaction.editReply(result(message)), edit(request.interaction, message)]);
    },

    async approve(request) {
        const { guild, channelId, memberId, ownerId } = request;
        return store.transact(guild.id, async (state, save) => {
            const room = state.rooms[channelId];
            const channel = guild.channels.cache.get(channelId);
            const owner = guild.members.cache.get(ownerId);
            if (!room?.lock || room.ownerId !== ownerId || channel?.type !== ChannelType.GuildVoice || owner?.voice.channelId !== channelId) {
                return '❌ Phòng đã mở khóa, đổi chủ hoặc không còn tồn tại.';
            }
            const member = await guild.members.fetch({ user: memberId, force: true }).catch(() => null);
            if (request.expiresAt <= Date.now() || owner.voice.channelId !== channelId) return '⌛ Yêu cầu đã hết hạn hoặc chủ phòng đã rời phòng.';
            if (!member || !canJoinBeforeLock(member, channel, room)) return '❌ Thành viên không còn quyền vào phòng này.';
            if (channel.userLimit && channel.members.size >= channel.userLimit) return '❌ Phòng đang đầy.';
            if (!hasChannelPermissions(channel, guild.members.me, PermissionFlagsBits.ManageRoles)) {
                return '❌ Bot thiếu quyền Quản lý vai trò trong phòng.';
            }
            if (!await grantRoomAccess(channel, room, member, save)) return 'ℹ️ Quyền vào phòng trước đó đang được xử lý.';
            return `✅ Chủ phòng đã cho phép vào <#${channelId}> trong 1 phút. Bấm vào tên kênh để tham gia.`;
        });
    }
};
