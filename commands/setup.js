const { randomUUID } = require('node:crypto');
const {
    SlashCommandBuilder, ChannelType, PermissionFlagsBits, MessageFlags, RESTJSONErrorCodes,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, LabelBuilder, ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const store = require('../utils/managementStore');
const { isFeatureEnabled } = require('../utils/features');
const { canConfigure, canModerate, respond, edit, roomResources, reportChannel, ticketResources, hasChannelPermissions } = require('../utils/managementAccess');
const taixiu = require('./taixiu');

const { ManageGuild, ManageChannels, ViewChannel, SendMessages, ReadMessageHistory } = PermissionFlagsBits;
const channelOption = (option, name, description, type) => option.setName(name).setDescription(description).addChannelTypes(type).setRequired(true);
const channelMention = id => id ? `<#${id}>` : 'Chưa thiết lập';
const GREETING_FORM = 'mg_greeting_text_';
const GAME_ACTIONS = new Set(['status', 'tiembanh', 'disable']);
const gameScope = { sections: ['settings', 'taixiu'], wallets: 'all' };
const disabled = interaction => respond(interaction, '❌ Tiện ích quản lý máy chủ đang tắt. Dùng /setup tiembanh để cấu hình bàn chơi.');

module.exports = {
    data: new SlashCommandBuilder().setName('setup').setDescription('Cấu hình quản lý cho máy chủ hiện tại')
        .setDefaultMemberPermissions(ManageGuild)
        .addSubcommand(command => command.setName('status').setDescription('Xem cấu hình đang dùng'))
        .addSubcommand(command => command.setName('rooms').setDescription('Chọn nơi tạo phòng thoại tạm')
            .addChannelOption(option => channelOption(option, 'lobby', 'Kênh thoại để thành viên vào tạo phòng', ChannelType.GuildVoice))
            .addChannelOption(option => channelOption(option, 'category', 'Danh mục chứa phòng tạm', ChannelType.GuildCategory)))
        .addSubcommand(command => command.setName('reports').setDescription('Chọn kênh riêng để nhận báo cáo')
            .addChannelOption(option => channelOption(option, 'channel', 'Kênh chữ dành cho đội quản trị', ChannelType.GuildText)))
        .addSubcommand(command => command.setName('tickets').setDescription('Thiết lập ticket và đăng bảng mở yêu cầu')
            .addChannelOption(option => channelOption(option, 'category', 'Danh mục chứa kênh ticket', ChannelType.GuildCategory))
            .addRoleOption(option => option.setName('staff').setDescription('Vai trò của đội hỗ trợ').setRequired(true))
            .addChannelOption(option => channelOption(option, 'panel', 'Kênh đăng nút mở ticket', ChannelType.GuildText)))
        .addSubcommand(command => command.setName('activity').setDescription('Bật hoặc tắt đếm lượt vào kênh thoại')
            .addBooleanOption(option => option.setName('enabled').setDescription('Có ghi thống kê lượt vào kênh thoại không?').setRequired(true)))
        .addSubcommand(command => command.setName('welcome').setDescription('Chọn kênh chào và tạm biệt thành viên')
            .addChannelOption(option => channelOption(option, 'channel', 'Kênh đón thành viên mới', ChannelType.GuildText))
            .addChannelOption(option => option.setName('goodbye').setDescription('Kênh tạm biệt, mặc định dùng kênh chào').addChannelTypes(ChannelType.GuildText)))
        .addSubcommand(command => command.setName('greeting-text').setDescription('Tùy chỉnh lời chào và tạm biệt cho máy chủ'))
        .addSubcommand(command => command.setName('greeting-preview').setDescription('Xem riêng thẻ chào và tạm biệt đang dùng'))
        .addSubcommand(command => command.setName('suggestions').setDescription('Chọn kênh đăng góp ý và bình chọn')
            .addChannelOption(option => channelOption(option, 'channel', 'Kênh dành cho góp ý', ChannelType.GuildText)))
        .addSubcommand(command => command.setName('tiembanh').setDescription('Đặt bàn Tiệm Bánh Mây tự động trong một kênh chữ')
            .addChannelOption(option => channelOption(option, 'channel', 'Kênh đặt bàn Tiệm Bánh Mây', ChannelType.GuildText)))
        .addSubcommand(command => command.setName('disable').setDescription('Tắt một tính năng quản lý đã cấu hình')
            .addStringOption(option => option.setName('module').setDescription('Chọn tính năng muốn tắt').setRequired(true)
                .addChoices({ name: 'Phòng thoại tạm', value: 'rooms' }, { name: 'Báo cáo', value: 'reports' },
                    { name: 'Ticket', value: 'tickets' }, { name: 'Chào và tạm biệt', value: 'welcome' },
                    { name: 'Góp ý', value: 'suggestions' }, { name: 'Bàn Tiệm Bánh Mây tự động', value: 'taixiuRoom' }))),

    async execute(interaction) {
        if (!canConfigure(interaction)) return respond(interaction, '❌ Bạn cần quyền Quản lý máy chủ.');
        const action = interaction.options.getSubcommand();
        const managementEnabled = isFeatureEnabled('serverManagement');
        if (!managementEnabled && (!GAME_ACTIONS.has(action) ||
            (action === 'disable' && interaction.options.getString('module') !== 'taixiuRoom'))) return disabled(interaction);
        if (action === 'greeting-text') return this.greetingTextForm(interaction);
        if (action === 'greeting-preview') return this.greetingPreview(interaction);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        let result = await store.transact(interaction.guildId, async (state, save) => {
            const { guild, member, options } = interaction;
            const settings = state.settings;
            const getChannel = name => guild.channels.cache.get(options.getChannel(name, true).id);
            const canEditChannel = channel => hasChannelPermissions(channel, member, [ViewChannel, ManageChannels]);

            if (action === 'status') {
                if (!managementEnabled) return `⚙️ **Cấu hình trò chơi**\nBàn Tiệm Bánh Mây tự động: ${channelMention(settings.taixiuRoom?.channelId)}`;
                const { memberGreetingsEnabled } = require('../utils/memberGreetings');
                return [
                    '⚙️ **Cấu hình máy chủ**',
                    `Tạo phòng: ${channelMention(settings.rooms?.lobbyId)}`,
                    `Kênh báo cáo: ${channelMention(settings.reports?.channelId)}`,
                    `Bảng ticket: ${channelMention(settings.tickets?.panelChannelId)}`,
                    `Kênh góp ý: ${channelMention(settings.suggestions?.channelId)}`,
                    `Bàn Tiệm Bánh Mây tự động: ${channelMention(settings.taixiuRoom?.channelId)}`,
                    `Thống kê lượt vào voice: ${settings.trackVoice ? 'Bật' : 'Tắt'}`,
                    `Kênh chào: ${memberGreetingsEnabled() ? channelMention(settings.welcome?.channelId) : 'Tắt trên máy chạy bot'}`,
                    `Kênh tạm biệt: ${memberGreetingsEnabled() ? channelMention(settings.welcome?.goodbyeChannelId || settings.welcome?.channelId) : 'Tắt trên máy chạy bot'}`
                ].join('\n');
            }
            if (action === 'rooms') {
                const lobby = getChannel('lobby');
                const category = getChannel('category');
                if (!canEditChannel(lobby) || !canEditChannel(category)) return '❌ Bạn cần quyền Quản lý kênh ở cả kênh tạo phòng và danh mục.';
                const next = { lobbyId: lobby.id, categoryId: category.id };
                if (state.rooms[lobby.id]) return '❌ Hãy chọn một kênh thoại cố định làm kênh tạo phòng.';
                if (!roomResources(guild, next)) return '❌ Bot cần xem kênh, Di chuyển thành viên và quyền quản lý kênh, vai trò, kết nối trong danh mục.';
                settings.rooms = next;
                await save();
                return `✅ Thành viên vào <#${lobby.id}> để tạo phòng. Dùng /room để điều khiển phòng.`;
            }
            if (action === 'reports') {
                const channel = getChannel('channel');
                if (!canModerate(interaction) || !hasChannelPermissions(channel, member, ViewChannel)) {
                    return '❌ Bạn cần quyền Timeout thành viên và quyền xem kênh này.';
                }
                if (!reportChannel(guild, channel.id)) return '❌ Chọn kênh chữ mà @everyone không xem được và bot có thể gửi tin nhắn, nhúng liên kết.';
                settings.reports = { channelId: channel.id };
                await save();
                return `✅ Báo cáo từ /report sẽ được gửi vào <#${channel.id}>.`;
            }
            if (action === 'tickets') {
                const ticket = require('./ticket');
                const category = getChannel('category');
                const panel = getChannel('panel');
                const role = options.getRole('staff', true);
                if (!canEditChannel(category) || !canEditChannel(panel)) return '❌ Bạn cần quyền Quản lý kênh ở danh mục ticket và kênh đăng bảng.';
                const next = { categoryId: category.id, roleId: role.id, panelChannelId: panel.id };
                if (!ticketResources(guild, next) ||
                    !hasChannelPermissions(panel, guild.members.me, [ViewChannel, SendMessages, ReadMessageHistory])) {
                    return '❌ Chọn vai trò hỗ trợ khác @everyone. Bot cần Quản lý kênh, Quản lý vai trò, xem và gửi tin, đọc lịch sử cùng quyền tạo và nhắn tin trong chủ đề ở danh mục ticket.';
                }

                let message;
                const previous = settings.tickets;
                if (previous?.panelChannelId === panel.id) {
                    try {
                        message = await panel.messages.edit(previous.panelMessageId, ticket.panel());
                    } catch (error) {
                        if (error.code !== RESTJSONErrorCodes.UnknownMessage) throw error;
                    }
                }
                const created = !message;
                if (created) message = await panel.send(ticket.panel());
                settings.tickets = { ...next, panelMessageId: message.id };
                try {
                    await save();
                } catch (error) {
                    if (created) await message.delete().catch(() => {});
                    throw error;
                }
                if (previous && previous.panelChannelId !== panel.id) {
                    const oldPanel = guild.channels.cache.get(previous.panelChannelId);
                    await oldPanel?.messages?.edit(previous.panelMessageId, { components: [], content: 'Bảng ticket đã được chuyển.' }).catch(() => {});
                }
                return `✅ Bảng hỗ trợ đã có ở <#${panel.id}>.`;
            }
            if (action === 'activity') {
                settings.trackVoice = options.getBoolean('enabled', true);
                await save();
                return settings.trackVoice ? '✅ Đã bật đếm lượt vào kênh thoại từ bây giờ.' : '✅ Đã tắt đếm lượt mới. Số liệu đã ghi được giữ lại.';
            }
            if (action === 'suggestions') {
                const { suggestionChannel } = require('./suggest');
                const channel = getChannel('channel');
                if (!canEditChannel(channel)) return '❌ Bạn cần quyền Quản lý kênh ở kênh góp ý.';
                if (!suggestionChannel(guild, channel.id)) return '❌ Bot cần quyền Xem kênh, Gửi tin nhắn và Nhúng liên kết.';
                settings.suggestions = { channelId: channel.id };
                await save();
                return `✅ Góp ý từ /suggest sẽ được đăng ở <#${channel.id}>.`;
            }
            if (action === 'tiembanh') {
                const channel = getChannel('channel');
                if (!canEditChannel(channel)) return '❌ Bạn cần quyền Quản lý kênh ở kênh đặt bàn.';
                if (!taixiu.automaticChannel(guild, channel.id)) return '❌ Bot cần quyền Xem kênh, Gửi tin nhắn và Nhúng liên kết.';
                settings.taixiuRoom = { channelId: channel.id };
                await save();
                return { syncTiembanh: true, channelId: channel.id,
                    message: `✅ Đã chọn <#${channel.id}> cho bàn Tiệm Bánh Mây tự động. Người chơi tự nhập số xu khi cược.` };
            }

            if (action === 'welcome') {
                const { memberGreetingsEnabled, greetingChannel } = require('../utils/memberGreetings');
                if (!memberGreetingsEnabled()) return '❌ Bật Server Members Intent, đặt ENABLE_MEMBER_GREETINGS=true trong .env rồi khởi động lại bot.';
                const channel = getChannel('channel');
                const goodbyeId = options.getChannel('goodbye')?.id;
                const goodbye = goodbyeId ? guild.channels.cache.get(goodbyeId) : channel;
                if (!canEditChannel(channel) || !canEditChannel(goodbye)) return '❌ Bạn cần quyền Quản lý kênh ở các kênh đã chọn.';
                if (!greetingChannel(guild, channel.id) || !greetingChannel(guild, goodbye.id)) {
                    return '❌ Bot cần quyền Xem kênh và Gửi tin nhắn ở các kênh đã chọn.';
                }
                settings.welcome = { channelId: channel.id, goodbyeChannelId: goodbye.id };
                await save();
                return `✅ Chào thành viên ở <#${channel.id}> và tạm biệt ở <#${goodbye.id}>.`;
            }
            const module = options.getString('module', true);
            const previous = settings[module];
            delete settings[module];
            await save();
            if (module === 'tickets' && previous) {
                const panel = guild.channels.cache.get(previous.panelChannelId);
                await panel?.messages?.edit(previous.panelMessageId, { components: [], content: 'Bảng mở ticket đã tắt.' }).catch(() => {});
            }
            if (module === 'taixiuRoom' && previous) return { syncTiembanh: true, message: '✅ Đã tắt tính năng đã chọn.' };
            return '✅ Đã tắt tính năng đã chọn.';
        }, managementEnabled ? undefined : gameScope);
        // Discord publication starts after settings have actually committed.
        if (result?.syncTiembanh) {
            const { channelId, message } = result;
            try {
                await taixiu.syncAutomaticBoard(interaction.guild);
                result = message;
            } catch (error) {
                if (!channelId) throw error;
                console.error('Lỗi đăng bàn Tiệm Bánh Mây tự động:', error.code ?? 'không có mã', error.message);
                if ([RESTJSONErrorCodes.MissingAccess, RESTJSONErrorCodes.MissingPermissions].includes(error.code)) {
                    result = `⚠️ Đã lưu <#${channelId}>. Discord từ chối đăng bàn (mã ${error.code}). Hãy kiểm tra quyền Xem kênh, Gửi tin nhắn và Nhúng liên kết của bot ngay trong kênh đó.`;
                } else {
                    const code = typeof error.code === 'number' ? ` (mã Discord ${error.code})` : '';
                    result = `⚠️ Đã lưu kênh. Bot chưa đăng được bàn${code}. Xem dòng “Lỗi đăng bàn Tiệm Bánh Mây tự động” trong log trên VPS.`;
                }
            }
        }
        return edit(interaction, result);
    },

    async greetingTextForm(interaction) {
        if (!isFeatureEnabled('serverManagement')) return disabled(interaction);
        const { GREETING_TEXT_LIMIT } = require('../utils/memberGreetings');
        const { settings } = await store.read(interaction.guildId);
        const templates = settings.greetingText;
        const modal = new ModalBuilder().setTitle('Sửa lời chào và tạm biệt')
            .setCustomId(GREETING_FORM + (templates?.revision || 'initial'));
        const instructions = 'Để trống dùng mặc định. Biến: {member}, {server}, {count}.';
        for (const [key, label] of [['welcome', 'Lời chào mừng'], ['goodbye', 'Lời tạm biệt']]) {
            const input = new TextInputBuilder().setCustomId(key).setStyle(TextInputStyle.Paragraph)
                .setRequired(false).setMaxLength(GREETING_TEXT_LIMIT);
            if (templates?.[key]) input.setValue(templates[key]);
            if (typeof modal.addLabelComponents === 'function' && LabelBuilder) {
                modal.addLabelComponents(new LabelBuilder().setLabel(label).setDescription(instructions).setTextInputComponent(input));
            } else {
                modal.addComponents(new ActionRowBuilder().addComponents(input.setLabel(label).setPlaceholder(instructions)));
            }
        }
        return interaction.showModal(modal);
    },

    async saveGreetingText(interaction) {
        if (!isFeatureEnabled('serverManagement')) return disabled(interaction);
        const { GREETING_TEXT_LIMIT } = require('../utils/memberGreetings');
        if (!canConfigure(interaction)) return respond(interaction, '❌ Bạn cần quyền Quản lý máy chủ.');
        const welcome = (interaction.fields.getTextInputValue('welcome') ?? '').trim();
        const goodbye = (interaction.fields.getTextInputValue('goodbye') ?? '').trim();
        if (welcome.length > GREETING_TEXT_LIMIT || goodbye.length > GREETING_TEXT_LIMIT) {
            return respond(interaction, `❌ Mỗi lời nhắn dài tối đa ${GREETING_TEXT_LIMIT} ký tự.`);
        }
        const revision = interaction.customId.slice(GREETING_FORM.length);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const saved = await store.transact(interaction.guildId, async (state, save) => {
            if ((state.settings.greetingText?.revision || 'initial') !== revision) {
                return false;
            }
            state.settings.greetingText = { welcome, goodbye, revision: randomUUID() };
            await save();
            return true;
        });
        if (!saved) return edit(interaction, '⌛ Lời nhắn đã thay đổi. Mở lại /setup greeting-text để xem bản mới.');
        const preview = new ButtonBuilder().setCustomId('mg_greeting_preview')
            .setLabel('Xem trước').setStyle(ButtonStyle.Primary);
        return interaction.editReply({
            content: `✅ Đã lưu. Lời chào ${welcome ? 'tùy chỉnh' : 'mặc định'} · Lời tạm biệt ${goodbye ? 'tùy chỉnh' : 'mặc định'}.`,
            components: [new ActionRowBuilder().addComponents(preview)],
            allowedMentions: { parse: [] }
        });
    },

    async greetingPreview(interaction) {
        if (!isFeatureEnabled('serverManagement')) return disabled(interaction);
        const { greetingCard } = require('../utils/memberGreetings');
        if (!canConfigure(interaction)) return respond(interaction, '❌ Bạn cần quyền Quản lý máy chủ.');
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const { settings } = await store.read(interaction.guildId);
        const { guild, user } = interaction;
        return interaction.editReply({
            content: '👁️ Xem trước lời chào và tạm biệt bằng tên của bạn.',
            embeds: [
                greetingCard(guild, user, true, settings.greetingText?.welcome),
                greetingCard(guild, user, false, settings.greetingText?.goodbye)
            ],
            allowedMentions: { parse: [] }
        });
    }
};

if (!isFeatureEnabled('serverManagement')) {
    const command = module.exports.data;
    command.setDescription('Cấu hình bàn Tiệm Bánh Mây cho máy chủ');
    command.options = command.options.filter(option => GAME_ACTIONS.has(option.name));
    const disable = command.options.find(option => option.name === 'disable');
    disable.setDescription('Tắt bàn Tiệm Bánh Mây tự động');
    disable.options[0].choices = disable.options[0].choices.filter(choice => choice.value === 'taixiuRoom');
}
