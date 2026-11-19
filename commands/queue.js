const {
    SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder,
    ButtonBuilder, ButtonStyle, MessageFlags, escapeMarkdown
} = require('discord.js');
const { randomUUID } = require('crypto');
const { initGuildMusicData, createMusicConnection, playMusic } = require('../utils/musicUtils');
const { getVoiceAccessError } = require('../utils/voiceAccess');

const PAGE_SIZE = 10;
const VIEW_TTL = 5 * 60 * 1000;
const MAX_VIEWS = 25;

function getView(interaction, guildData, id) {
    const view = guildData.queueViews?.get(id);
    if (view && view.userId === interaction.user.id && view.expiresAt > Date.now()) return view;
    return null;
}

function renderQueue(interaction, guildData, requestedPage) {
    const count = guildData.queue.length;
    if (!count) return { content: '📭 Hàng đợi đang trống.', embeds: [], components: [] };

    const pageCount = Math.ceil(count / PAGE_SIZE);
    const page = Math.max(0, Math.min(pageCount - 1, requestedPage));
    const start = page * PAGE_SIZE;
    const tracks = guildData.queue.slice(start, start + PAGE_SIZE).map((song, index) => ({
        song, position: start + index + 1
    }));
    const canEdit = !getVoiceAccessError(interaction.member, guildData);
    const upcoming = tracks.filter(({ song }) => song !== guildData.currentSong);
    const description = tracks.map(({ song, position }) => (
        (song === guildData.currentSong ? '▶️ ' : '') +
        '**#' + position + '** ' + escapeMarkdown(String(song.title || 'Không rõ tên').slice(0, 150)) +
        ' · `' + String(song.duration || '—').slice(0, 12) + '`'
    )).join('\n');
    const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('📋 Hàng đợi')
        .setDescription(description)
        .setFooter({
            text: 'Trang ' + (page + 1) + '/' + pageCount + ' · ' + count + ' bài' +
                (canEdit ? '' : ' · Vào kênh voice của bot để chọn bài')
        });

    const id = randomUUID();
    const views = guildData.queueViews ??= new Map();
    const now = Date.now();
    for (const [key, view] of views) {
        if (view.expiresAt <= now) views.delete(key);
    }
    if (views.size >= MAX_VIEWS) views.delete(views.keys().next().value);
    views.set(id, { page, userId: interaction.user.id, expiresAt: now + VIEW_TTL, songs: upcoming.map(track => track.song) });

    const pageButton = (label, offset, disabled = false) => new ButtonBuilder()
        .setCustomId('queue_page_' + id + ':' + offset)
        .setLabel(label)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled);
    const components = [new ActionRowBuilder().addComponents(
        pageButton('◀ Trang trước', -1, page === 0),
        pageButton('↻ Làm mới', 0),
        pageButton('Trang sau ▶', 1, page === pageCount - 1)
    )];
    if (canEdit && upcoming.length) {
        const menu = new StringSelectMenuBuilder().setCustomId('queue_next_' + id)
            .setPlaceholder('Chọn bài ở trang này để phát kế tiếp')
            .addOptions(upcoming.map(({ song, position }, index) => ({
                label: ('#' + position + ' · ' + (song.title || 'Không rõ tên')).slice(0, 100),
                value: String(index)
            })));
        components.push(new ActionRowBuilder().addComponents(menu));
    }

    return { content: null, embeds: [embed], components };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('queue')
        .setDescription('Xem hàng đợi, chọn bài phát tiếp, xóa hoặc chuyển bài')
        .addStringOption(option => option.setName('action').setDescription('Thao tác với hàng đợi')
            .addChoices({ name: 'Phát tiếp', value: 'next' }, { name: 'Xóa bài', value: 'remove' }, { name: 'Chuyển bài', value: 'move' }))
        .addIntegerOption(option => option.setName('position').setDescription('Vị trí bài trong /queue').setMinValue(1))
        .addIntegerOption(option => option.setName('to').setDescription('Vị trí mới khi chuyển bài').setMinValue(1)),

    async execute(interaction) {
        const action = interaction.options?.getString('action');
        const guildData = initGuildMusicData(interaction.guildId);
        if (!action) return this.show(interaction, guildData);
        return this.editQueue(interaction, guildData, action, interaction.options.getInteger('position'), interaction.options.getInteger('to'));
    },

    async editQueue(interaction, guildData, action, position, destination) {
        const deny = content => interaction.reply({ content, flags: MessageFlags.Ephemeral });
        const error = getVoiceAccessError(interaction.member, guildData);
        if (error) return deny(error);
        const index = position - 1;
        const song = guildData.queue[index];
        if (!Number.isInteger(position) || !song) return deny('❌ Hãy chọn vị trí hợp lệ trong /queue.');
        const activeHead = Boolean(guildData.currentSong && guildData.queue[0] === guildData.currentSong);
        if (activeHead && index === 0) return deny('❌ Bài đang phát được giữ nguyên. Dùng /skip nếu muốn bỏ qua.');

        const target = action === 'next' ? Number(activeHead) : destination - 1;
        if (action === 'move' && (!destination || target < Number(activeHead) || target >= guildData.queue.length)) {
            return deny('❌ Vị trí mới phải nằm trong phần bài chờ của hàng đợi.');
        }
        if (action === 'next' && !guildData.isPlaying) {
            createMusicConnection(interaction.member, guildData);
            guildData.textChannel = interaction.channel;
        }
        guildData.queue.splice(index, 1);
        if (action !== 'remove') guildData.queue.splice(target, 0, song);
        if (action === 'next' && !guildData.isPlaying) void playMusic(guildData);
        const result = action === 'remove' ? 'Đã xóa' : action === 'next' ? 'Đã chọn phát tiếp' : 'Đã chuyển tới vị trí #' + destination;
        return interaction.reply({ content: '✅ ' + result + ' **' + song.title + '**.', allowedMentions: { parse: [] }, flags: MessageFlags.Ephemeral });
    },

    async selectNext(interaction, guildData) {
        const selection = getView(interaction, guildData, interaction.customId.slice('queue_next_'.length));
        if (selection) {
            const song = selection.songs[Number(interaction.values[0])];
            const index = guildData.queue.indexOf(song);
            if (index >= 0) return this.editQueue(interaction, guildData, 'next', index + 1);
        }
        return interaction.reply({ content: '❌ Bài không còn trong menu hoặc menu đã hết hạn. Mở /queue để chọn lại.', flags: MessageFlags.Ephemeral });
    },

    async changePage(interaction, guildData) {
        const [id, offset] = interaction.customId.slice('queue_page_'.length).split(':');
        const view = getView(interaction, guildData, id);
        if (!view || !['-1', '0', '1'].includes(offset)) {
            return interaction.reply({ content: '❌ Trang đã hết hạn. Mở /queue để xem lại.', flags: MessageFlags.Ephemeral });
        }
        return interaction.update(renderQueue(interaction, guildData, view.page + Number(offset)));
    },

    async show(interaction, guildData = initGuildMusicData(interaction.guildId)) {
        return interaction.reply({ ...renderQueue(interaction, guildData, 0), flags: MessageFlags.Ephemeral });
    }
};
