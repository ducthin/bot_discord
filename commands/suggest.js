const {
    SlashCommandBuilder, ChannelType, PermissionFlagsBits, MessageFlags, EmbedBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, escapeMarkdown
} = require('discord.js');
const store = require('../utils/managementStore');
const { canConfigure, canModerate, hasChannelPermissions, respond, edit } = require('../utils/managementAccess');

const { ViewChannel, SendMessages, EmbedLinks } = PermissionFlagsBits;
const labels = { new: 'Mới', review: 'Đang xem xét', approved: 'Đã duyệt', done: 'Đã thực hiện' };

function suggestionChannel(guild, id) {
    const channel = guild.channels.cache.get(id);
    return channel?.type === ChannelType.GuildText &&
        hasChannelPermissions(channel, guild.members.me, [ViewChannel, SendMessages, EmbedLinks]) ? channel : null;
}

function render(record) {
    const votes = Object.values(record.votes);
    const score = votes.filter(vote => vote === 1).length;
    const embed = new EmbedBuilder().setTitle('💡 Góp ý cho máy chủ')
        .setColor(record.status === 'done' ? '#57f287' : '#5865f2')
        .setDescription(escapeMarkdown(record.idea))
        .addFields(
            { name: 'Trạng thái', value: labels[record.status], inline: true },
            { name: 'Bình chọn', value: `👍 ${score} · 👎 ${votes.length - score}`, inline: true },
            { name: 'Người gửi', value: `<@${record.authorId}>`, inline: true }
        ).setTimestamp(record.createdAt);
    const button = (action, label, style, disabled) => new ButtonBuilder()
        .setCustomId(`mg_suggest_${action}_${record.id}`).setLabel(label).setStyle(style).setDisabled(disabled);
    return {
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(
            button('up', '👍 Ủng hộ', ButtonStyle.Primary, record.status === 'done'),
            button('down', '👎 Không ủng hộ', ButtonStyle.Secondary, record.status === 'done'),
            ...['review', 'approved', 'done'].map(status => button(status, labels[status], ButtonStyle.Secondary, record.status === status))
        )],
        allowedMentions: { parse: [] }
    };
}

module.exports = {
    suggestionChannel,
    data: new SlashCommandBuilder().setName('suggest').setDescription('Gửi góp ý để thành viên bình chọn')
        .addStringOption(option => option.setName('idea').setDescription('Ý tưởng của bạn').setMaxLength(800).setRequired(true)),

    async execute(interaction) {
        const idea = interaction.options.getString('idea', true).trim();
        if (!idea) return respond(interaction, '❌ Hãy nhập nội dung góp ý.');
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const message = await store.transact(interaction.guildId, async (state, save) => {
            const channel = suggestionChannel(interaction.guild, state.settings.suggestions?.channelId);
            if (!channel) return '❌ Quản trị viên cần chọn kênh bằng /setup suggestions.';
            if (!hasChannelPermissions(channel, interaction.member, ViewChannel)) return '❌ Bạn cần quyền xem kênh góp ý.';
            const now = Date.now();
            const existing = Object.values(state.suggestions);
            if (existing.some(item => item.authorId === interaction.user.id && now - item.createdAt < 60000)) {
                return '⏳ Bạn có thể gửi một góp ý mỗi phút.';
            }
            if (existing.length >= 300) {
                const archived = existing.find(item => item.status === 'done');
                if (!archived) return '❌ Kênh đang có quá nhiều góp ý chưa xử lý.';
                delete state.suggestions[archived.id];
            }
            const record = { id: interaction.id, channelId: channel.id, authorId: interaction.user.id,
                idea, createdAt: now, status: 'new', votes: {} };
            const posted = await channel.send(render(record));
            record.messageId = posted.id;
            state.suggestions[record.id] = record;
            try {
                await save();
            } catch (error) {
                await posted.delete().catch(() => {});
                throw error;
            }
            return `✅ Đã gửi góp ý ở <#${channel.id}>.`;
        });
        return edit(interaction, message);
    },

    async button(interaction) {
        const [action, id] = interaction.customId.slice('mg_suggest_'.length).split('_');
        const voting = action === 'up' || action === 'down';
        if (!voting && !['review', 'approved', 'done'].includes(action)) return respond(interaction, '❌ Nút này không hợp lệ.');
        if (!voting && !canModerate(interaction) && !canConfigure(interaction)) {
            return respond(interaction, '❌ Chỉ đội quản trị mới có thể đổi trạng thái góp ý.');
        }
        await interaction.deferUpdate();
        const notice = await store.transact(interaction.guildId, async (state, save) => {
            const record = state.suggestions[id];
            if (!record || record.messageId !== interaction.message.id || record.channelId !== interaction.channelId) {
                return '⌛ Góp ý này đã hết hiệu lực.';
            }
            if (voting) {
                if (record.status === 'done') return 'ℹ️ Góp ý này đã kết thúc bình chọn.';
                const vote = action === 'up' ? 1 : -1;
                if (record.votes[interaction.user.id] === vote) delete record.votes[interaction.user.id];
                else record.votes[interaction.user.id] = vote;
            } else {
                record.status = action;
            }
            await save();
            await interaction.editReply(render(record));
            return null;
        });
        if (notice) await interaction.followUp({ content: notice, flags: MessageFlags.Ephemeral });
    }
};
