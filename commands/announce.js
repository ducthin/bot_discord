const {
    SlashCommandBuilder, ChannelType, PermissionFlagsBits, MessageFlags,
    ActionRowBuilder, ButtonBuilder, ButtonStyle
} = require('discord.js');
const store = require('../utils/managementStore');
const { canConfigure, respond, edit, hasChannelPermissions } = require('../utils/managementAccess');
const { announcementChannel } = require('../utils/announcements');

const DRAFT_TTL = 5 * 60 * 1000;
const MONTH = 30 * 24 * 60 * 60 * 1000;
const drafts = new Map();
const statuses = {
    pending: 'Chờ gửi', sending: 'Đang gửi', sent: 'Đã gửi',
    canceled: 'Đã hủy', failed: 'Không gửi được', unknown: 'Cần kiểm tra kênh'
};

function parseTime(input) {
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(input)) return NaN;
    const utc = Date.parse(input.replace(' ', 'T') + ':00+07:00');
    if (!Number.isFinite(utc)) return NaN;
    const local = new Date(utc + 7 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ');
    return local === input ? utc : NaN;
}

const stamp = ms => `<t:${Math.floor(ms / 1000)}:F>`;

function canSee(interaction, post) {
    return post.authorId === interaction.user.id ||
        hasChannelPermissions(interaction.guild.channels.cache.get(post.channelId), interaction.member, PermissionFlagsBits.ViewChannel);
}

module.exports = {
    data: new SlashCommandBuilder().setName('announce').setDescription('Xem trước và hẹn giờ gửi thông báo')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(command => command.setName('schedule').setDescription('Soạn thông báo và chọn giờ gửi')
            .addChannelOption(option => option.setName('channel').setDescription('Kênh đăng thông báo').addChannelTypes(ChannelType.GuildText).setRequired(true))
            .addStringOption(option => option.setName('time').setDescription('Giờ Việt Nam UTC+7, dạng YYYY-MM-DD HH:mm').setRequired(true))
            .addStringOption(option => option.setName('text').setDescription('Nội dung thông báo').setMaxLength(1600).setRequired(true)))
        .addSubcommand(command => command.setName('list').setDescription('Xem lịch và kết quả gửi'))
        .addSubcommand(command => command.setName('cancel').setDescription('Hủy một thông báo đang chờ gửi')
            .addIntegerOption(option => option.setName('id').setDescription('Mã trong /announce list').setMinValue(1).setRequired(true))),

    async execute(interaction) {
        if (!canConfigure(interaction)) return respond(interaction, '❌ Bạn cần quyền Quản lý máy chủ.');
        const action = interaction.options.getSubcommand();
        if (action === 'schedule') return this.preview(interaction);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (action === 'list') {
            const { announcements } = await store.read(interaction.guildId);
            const posts = Object.values(announcements).filter(post => canSee(interaction, post))
                .sort((first, second) => Number(second.status === 'pending') - Number(first.status === 'pending') || second.id - first.id)
                .slice(0, 12);
            if (!posts.length) return edit(interaction, '📭 Chưa có thông báo đã hẹn.');
            return edit(interaction, '**📣 Lịch thông báo**\n' + posts.map(post =>
                `#${post.id} · ${statuses[post.status]} · <#${post.channelId}> · ${stamp(post.sendAt)}`).join('\n'));
        }
        const id = interaction.options.getInteger('id', true);
        const message = await store.transact(interaction.guildId, async (state, save) => {
            const post = state.announcements[id];
            if (!post || !canSee(interaction, post)) return '❌ Không tìm thấy thông báo.';
            if (post.status !== 'pending') return 'ℹ️ Chỉ có thể hủy thông báo đang chờ gửi.';
            post.status = 'canceled';
            await save();
            return `✅ Đã hủy thông báo #${id}.`;
        });
        return edit(interaction, message);
    },

    async preview(interaction) {
        const { guild, member, options } = interaction;
        const channelId = options.getChannel('channel', true).id;
        const sendAt = parseTime(options.getString('time', true).trim());
        const text = options.getString('text', true).trim();
        const now = Date.now();
        if (!text || !Number.isFinite(sendAt) || sendAt <= now || sendAt > now + MONTH) {
            return respond(interaction, '❌ Nhập nội dung và giờ trong 30 ngày tới theo dạng YYYY-MM-DD HH:mm, giờ Việt Nam.');
        }
        if (!announcementChannel(guild, channelId, member)) return respond(interaction, '❌ Bạn và bot cần quyền xem và gửi tin ở kênh đích.');
        for (const [id, draft] of drafts) if (draft.expiresAt <= now) drafts.delete(id);
        if (drafts.size >= 100) return respond(interaction, '⏳ Đang có quá nhiều bản xem trước. Hãy thử lại sau.');
        const id = interaction.id;
        drafts.set(id, { guildId: guild.id, authorId: interaction.user.id, channelId, sendAt, text, expiresAt: now + DRAFT_TTL });
        try {
            await interaction.reply({
                content: `👁️ **Xem trước thông báo** · <#${channelId}> · ${stamp(sendAt)}\n\n${text}`,
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('mg_announce_save_' + id).setLabel('Xác nhận lịch').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('mg_announce_discard_' + id).setLabel('Hủy').setStyle(ButtonStyle.Secondary)
                )],
                flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] }
            });
        } catch (error) {
            drafts.delete(id);
            throw error;
        }
    },

    async button(interaction) {
        if (!canConfigure(interaction)) return respond(interaction, '❌ Bạn cần quyền Quản lý máy chủ.');
        const [action, id] = interaction.customId.slice('mg_announce_'.length).split('_');
        const draft = drafts.get(id);
        if (!draft || draft.guildId !== interaction.guildId || draft.authorId !== interaction.user.id || !['save', 'discard'].includes(action)) {
            return respond(interaction, '⌛ Bản xem trước không còn hiệu lực hoặc thuộc về người khác.');
        }
        drafts.delete(id);
        const done = content => ({ content, components: [], allowedMentions: { parse: [] } });
        if (action === 'discard') return interaction.update(done('✅ Đã bỏ bản xem trước.'));
        if (draft.expiresAt <= Date.now() || draft.sendAt <= Date.now()) return interaction.update(done('⌛ Bản xem trước hoặc giờ gửi đã hết hạn.'));
        await interaction.deferUpdate();
        const message = await store.transact(interaction.guildId, async (state, save) => {
            if (draft.sendAt <= Date.now()) return '⌛ Giờ gửi đã qua. Hãy chọn một giờ mới.';
            if (!announcementChannel(interaction.guild, draft.channelId, interaction.member)) return '❌ Quyền gửi ở kênh đích đã thay đổi.';
            const existing = Object.values(state.announcements);
            if (existing.filter(post => post.status === 'pending' || post.status === 'sending').length >= 50) {
                return '❌ Máy chủ đã có 50 thông báo đang chờ hoặc đang gửi.';
            }
            if (existing.length >= 200) {
                const oldest = existing.find(post => post.status !== 'pending' && post.status !== 'sending');
                if (oldest) delete state.announcements[oldest.id];
            }
            const postId = state.nextAnnouncement++;
            state.announcements[postId] = { id: postId, status: 'pending', nonce: id,
                authorId: draft.authorId, channelId: draft.channelId, sendAt: draft.sendAt, text: draft.text };
            await save();
            return `✅ Đã hẹn thông báo #${postId} ở <#${draft.channelId}> lúc ${stamp(draft.sendAt)}.`;
        });
        return interaction.editReply(done(message));
    }
};
