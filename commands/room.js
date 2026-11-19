const {
    SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
    ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits
} = require('discord.js');
const store = require('../utils/managementStore');
const { respond, edit, hasChannelPermissions } = require('../utils/managementAccess');
const { toggleRoomLock } = require('../utils/tempRooms');

function ownedRoom(interaction, state, channelId) {
    const channel = interaction.member?.voice?.channel;
    if (!channel || channel.id !== channelId) return null;
    const room = state.rooms[channelId];
    return room?.ownerId === interaction.user.id ? { channel, room } : null;
}

module.exports = {
    data: new SlashCommandBuilder().setName('room').setDescription('Mở bảng điều khiển phòng thoại tạm của bạn'),

    async execute(interaction) {
        const channelId = interaction.member?.voice?.channelId;
        if (!channelId) return respond(interaction, '❌ Hãy vào phòng thoại tạm trước.');
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const state = await store.read(interaction.guildId);
        const owned = ownedRoom(interaction, state, channelId);
        if (!owned) return edit(interaction, '❌ Bảng điều khiển dành cho chủ phòng thoại tạm.');
        const { room, channel } = owned;
        const button = (action, label, style = ButtonStyle.Secondary) => new ButtonBuilder()
            .setCustomId(`mg_room_${action}_${channelId}`).setLabel(label).setStyle(style);
        return interaction.editReply({
            content: `🎙️ <#${channelId}> · ${room.lock ? 'Đang khóa' : 'Đang mở'} · ${channel.userLimit || 'Không giới hạn'} chỗ\n` +
                (room.lock ? 'Bạn bè có thể dùng /room-request để xin vào.' : 'Dùng /call để mời bạn vào.'),
            components: [new ActionRowBuilder().addComponents(
                button('rename', 'Đổi tên'), button('limit', 'Giới hạn người'),
                button(room.lock ? 'unlock' : 'lock', room.lock ? 'Mở khóa' : 'Khóa phòng', ButtonStyle.Primary)
            )],
            allowedMentions: { parse: [] }
        });
    },

    async button(interaction) {
        const [action, channelId] = interaction.customId.slice('mg_room_'.length).split('_');
        if (action === 'lock' || action === 'unlock') {
            return this.change(interaction, action, channelId);
        }
        if (!['rename', 'limit'].includes(action)) return respond(interaction, '❌ Nút này không hợp lệ.');
        const owned = ownedRoom(interaction, await store.read(interaction.guildId), channelId);
        if (!owned) return respond(interaction, '❌ Chỉ chủ phòng đang ở trong phòng mới có thể chỉnh.');

        const rename = action === 'rename';
        const input = new TextInputBuilder().setCustomId('value')
            .setLabel(rename ? 'Tên mới' : 'Số người từ 0 đến 99 (0 là không giới hạn)')
            .setStyle(TextInputStyle.Short)
            .setMaxLength(rename ? 100 : 2);
        const modal = new ModalBuilder().setCustomId(`mg_roomform_${action}_${channelId}`)
            .setTitle(rename ? 'Đổi tên phòng' : 'Giới hạn người')
            .addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
    },

    async modal(interaction) {
        const [action, channelId] = interaction.customId.slice('mg_roomform_'.length).split('_');
        const value = interaction.fields.getTextInputValue('value').trim();
        if (action === 'limit' && !/^\d{1,2}$/.test(value)) return respond(interaction, '❌ Hãy nhập một số từ 0 đến 99.');
        if (action === 'rename' && !value) return respond(interaction, '❌ Tên phòng không được để trống.');
        if (!['rename', 'limit'].includes(action)) return respond(interaction, '❌ Thao tác không hợp lệ.');
        return this.change(interaction, action, channelId, value);
    },

    async change(interaction, action, channelId, value) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const result = await store.transact(interaction.guildId, async (state, save) => {
                const owned = ownedRoom(interaction, state, channelId);
                if (!owned) return '❌ Chỉ chủ phòng đang ở trong phòng mới có thể chỉnh.';
                const { room, channel } = owned;
                const lockAction = action === 'lock' || action === 'unlock';
                const required = lockAction ? [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles] : PermissionFlagsBits.ManageChannels;
                if (!hasChannelPermissions(channel, interaction.guild.members.me, required)) return '❌ Bot thiếu quyền chỉnh phòng này.';
                if (lockAction) {
                    if (Boolean(room.lock) === (action === 'lock')) {
                        return room.lock ? 'ℹ️ Phòng đã khóa.' : 'ℹ️ Phòng đang mở.';
                    }
                    const locked = await toggleRoomLock(channel, room, save);
                    return locked ? '🔒 Đã khóa phòng với thành viên thường. Mở lại bằng /room.' : '🔓 Đã mở khóa phòng.';
                }
                if (action === 'rename') {
                    await channel.setName(value);
                    return '✅ Đã đổi tên phòng.';
                }
                await channel.setUserLimit(Number(value));
                return Number(value) ? `✅ Đã giới hạn phòng ở ${Number(value)} người.` : '✅ Đã bỏ giới hạn số người.';
            });
            return edit(interaction, result);
        } catch (error) {
            console.error('Lỗi cập nhật phòng thoại:', error.message);
            return edit(interaction, '❌ Discord chưa cập nhật được phòng. Hãy thử lại sau.');
        }
    }
};
