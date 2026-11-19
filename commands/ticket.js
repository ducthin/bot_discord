const {
    SlashCommandBuilder, ChannelType, OverwriteType, PermissionFlagsBits, MessageFlags,
    ActionRowBuilder, ButtonBuilder, ButtonStyle
} = require('discord.js');
const store = require('../utils/managementStore');
const { canConfigure, ticketResources, edit, hasChannelPermissions } = require('../utils/managementAccess');

const { ViewChannel, SendMessages, ReadMessageHistory, ManageRoles, CreatePublicThreads, CreatePrivateThreads, SendMessagesInThreads } = PermissionFlagsBits;
const chatAccess = [ViewChannel, SendMessages, ReadMessageHistory];

function ticketButton(action, label, style) {
    return new ActionRowBuilder().addComponents(new ButtonBuilder()
        .setCustomId('mg_ticket_' + action).setLabel(label).setStyle(style));
}

module.exports = {
    data: new SlashCommandBuilder().setName('ticket').setDescription('Mở hoặc đóng kênh hỗ trợ riêng')
        .addSubcommand(command => command.setName('open').setDescription('Mở kênh hỗ trợ của bạn'))
        .addSubcommand(command => command.setName('close').setDescription('Đóng ticket ở kênh hiện tại')),

    panel() {
        return {
            content: '🎫 **Hỗ trợ riêng**\nBấm **Mở yêu cầu** để tạo một kênh trao đổi với đội hỗ trợ.',
            components: [ticketButton('open', 'Mở yêu cầu', ButtonStyle.Primary)],
            allowedMentions: { parse: [] }
        };
    },

    execute(interaction) {
        return this.handle(interaction, interaction.options.getSubcommand());
    },

    button(interaction) {
        return this.handle(interaction, interaction.customId === 'mg_ticket_close' ? 'close' : 'open');
    },

    async handle(interaction, action) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const result = await store.transact(interaction.guildId, (state, save) => action === 'open'
                ? this.open(interaction, state, save) : this.close(interaction, state, save));
            return edit(interaction, result);
        } catch (error) {
            console.error('Lỗi xử lý ticket:', error.message);
            return edit(interaction, '❌ Chưa cập nhật được ticket. Hãy thử lại hoặc liên hệ đội hỗ trợ.');
        }
    },

    async open(interaction, state, save) {
        const { guild, user } = interaction;
        const settings = state.settings.tickets;
        if (interaction.customId && (!settings?.panelMessageId || interaction.message?.id !== settings.panelMessageId)) {
            return '⌛ Bảng này đã cũ. Hãy dùng /ticket open.';
        }
        const resources = ticketResources(guild, settings);
        if (!resources) return '❌ Quản trị viên cần cấu hình ticket và cấp quyền cho bot bằng /setup tickets.';
        const { category, role } = resources;
        for (const [id, ticket] of Object.entries(state.tickets)) {
            if (!guild.channels.cache.has(id)) delete state.tickets[id];
            else if (ticket.ownerId === user.id && !ticket.closedBy) return `ℹ️ Bạn đã có ticket đang mở ở <#${id}>.`;
        }

        const bot = guild.members.me;
        const channel = await guild.channels.create({
            name: 'ticket-' + user.id,
            type: ChannelType.GuildText,
            parent: category.id,
            permissionOverwrites: [
                { id: guild.id, type: OverwriteType.Role, deny: [ViewChannel] },
                { id: role.id, type: OverwriteType.Role, allow: chatAccess },
                { id: user.id, type: OverwriteType.Member, allow: chatAccess, deny: [CreatePublicThreads, CreatePrivateThreads, SendMessagesInThreads] },
                { id: bot.id, type: OverwriteType.Member, allow: chatAccess }
            ],
            reason: 'Mở ticket hỗ trợ riêng'
        });
        state.tickets[channel.id] = { ownerId: user.id, roleId: role.id, createdAt: Date.now() };
        try {
            await save();
        } catch (error) {
            await channel.delete('Không lưu được ticket').catch(() => {});
            throw error;
        }
        await channel.send({
            content: `🎫 <@${user.id}>, hãy mô tả điều bạn cần hỗ trợ tại đây. Bấm **Đóng ticket** khi đã xong.`,
            components: [ticketButton('close', 'Đóng ticket', ButtonStyle.Danger)],
            allowedMentions: { parse: [] }
        }).catch(error => console.error('Lỗi gửi lời chào ticket:', error.message));
        return `✅ Đã mở kênh hỗ trợ riêng <#${channel.id}>.`;
    },

    async close(interaction, state, save) {
        const { channel, channelId, member, user, guild } = interaction;
        const ticket = state.tickets[channelId];
        if (!ticket || channel?.type !== ChannelType.GuildText) return '❌ Hãy dùng lệnh này trong kênh ticket.';
        if (user.id !== ticket.ownerId && !canConfigure(interaction) && !member?.roles?.cache?.has(ticket.roleId)) {
            return '❌ Chỉ người mở ticket hoặc đội hỗ trợ mới có thể đóng.';
        }
        if (ticket.closedBy) return 'ℹ️ Ticket này đã đóng.';
        if (!hasChannelPermissions(channel, guild.members.me, ManageRoles)) return '❌ Bot thiếu quyền chỉnh quyền truy cập ticket.';

        await channel.permissionOverwrites.edit(ticket.ownerId, { SendMessages: false, SendMessagesInThreads: false }, { type: OverwriteType.Member });
        ticket.closedBy = user.id;
        ticket.closedAt = Date.now();
        await save();
        await channel.send({ content: '🔒 Ticket đã đóng. Người mở có thể đọc lại nội dung.' })
            .catch(error => console.error('Lỗi gửi trạng thái ticket:', error.message));
        return '🔒 Đã đóng ticket và giữ lại lịch sử trong kênh.';
    }
};
