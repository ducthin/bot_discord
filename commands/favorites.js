const { SlashCommandBuilder, StringSelectMenuBuilder, ActionRowBuilder, EmbedBuilder, MessageFlags, escapeMarkdown } = require('discord.js');
const { initGuildMusicData, createMusicConnection, enqueueSongs, playMusic } = require('../utils/musicUtils');
const { getVoiceAccessError } = require('../utils/voiceAccess');
const store = require('../utils/favoritesStore');

const PAGE_SIZE = 10;
const privateReply = (interaction, content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
const edit = (interaction, content) => interaction.editReply({ content, allowedMentions: { parse: [] } });
const trackName = (track, limit = 150) => String(track.title || 'Không rõ tên').slice(0, limit);

module.exports = {
    data: new SlashCommandBuilder()
        .setName('favorites')
        .setDescription('Xem và phát lại các bài yêu thích của bạn')
        .addIntegerOption(option => option.setName('page')
            .setDescription('Trang danh sách muốn mở')
            .setMinValue(1).setMaxValue(Math.ceil(store.MAX_FAVORITES / PAGE_SIZE)))
        .addStringOption(option => option.setName('action')
            .setDescription('Chọn bài để phát lại hoặc bỏ lưu')
            .addChoices({ name: 'Phát lại', value: 'play' }, { name: 'Bỏ lưu', value: 'remove' })),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const songs = await store.list(interaction.user.id);
            if (!songs.length) return edit(interaction, '🤍 Bạn chưa lưu bài nào. Bấm **❤️ Yêu thích** trên bảng Đang phát để lưu.');

            const pages = Math.ceil(songs.length / PAGE_SIZE);
            const page = Math.min(interaction.options.getInteger('page') ?? 1, pages);
            const action = interaction.options.getString('action') === 'remove' ? 'remove' : 'play';
            const start = (page - 1) * PAGE_SIZE;
            const tracks = songs.slice(start, start + PAGE_SIZE);
            const menu = new StringSelectMenuBuilder()
                .setCustomId('favorite_' + action)
                .setPlaceholder(action === 'remove' ? 'Chọn bài muốn bỏ lưu' : 'Chọn bài muốn phát lại')
                .addOptions(tracks.map((track, index) => ({
                    label: `#${start + index + 1} · ${trackName(track, 90)}`, value: track.id
                })));
            const embed = new EmbedBuilder()
                .setColor('#eb459e')
                .setTitle('❤️ Bài hát yêu thích')
                .setDescription(tracks.map((track, index) => `**#${start + index + 1}** ${escapeMarkdown(trackName(track))}`).join('\n'))
                .setFooter({ text: `Trang ${page}/${pages} · ${songs.length}/${store.MAX_FAVORITES} bài` +
                    (pages > 1 ? ' · Dùng /favorites page để đổi trang' : '') });
            return interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] });
        } catch (error) {
            console.error('Lỗi đọc bài yêu thích:', error.message);
            return edit(interaction, '❌ Không mở được danh sách yêu thích. Hãy thử lại.');
        }
    },

    async saveCurrent(interaction, guildData) {
        const song = guildData.currentSong;
        if (store.favoriteId(song) !== interaction.customId.slice('favorite_save_'.length)) {
            return privateReply(interaction, '⌛ Bảng này đã cũ. Mở /nowplaying để lưu bài hiện tại.');
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const status = await store.save(interaction.user.id, song);
            if (status === 'exists') return edit(interaction, '❤️ Bài này đã có trong danh sách yêu thích của bạn.');
            if (status === 'full') return edit(interaction, '❌ Danh sách đã đầy. Dùng /favorites và chọn **Bỏ lưu**.');
            return edit(interaction, `❤️ Đã lưu **${escapeMarkdown(trackName(song))}**. Dùng /favorites để phát lại.`);
        } catch (error) {
            console.error('Lỗi lưu bài yêu thích:', error.message);
            return edit(interaction, '❌ Không lưu được bài yêu thích. Hãy thử lại.');
        }
    },

    async selectTrack(interaction, guildData = initGuildMusicData(interaction.guildId)) {
        const userId = interaction.user.id;
        const id = interaction.values[0];
        const queueEpoch = guildData.queueEpoch;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            if (interaction.customId === 'favorite_remove') {
                const removed = await store.remove(userId, id);
                return edit(interaction, removed ? '✅ Đã bỏ lưu bài này.' : 'ℹ️ Bài này đã được bỏ lưu.');
            }

            const track = (await store.list(userId)).find(song => song.id === id);
            if (!track) return edit(interaction, '⌛ Bài này không còn trong danh sách yêu thích của bạn.');
            if (queueEpoch !== guildData.queueEpoch) return edit(interaction, '⏹️ Hàng đợi vừa được dừng. Hãy chọn lại bài.');
            const error = getVoiceAccessError(interaction.member, guildData);
            if (error) return edit(interaction, error);

            createMusicConnection(interaction.member, guildData);
            guildData.textChannel = interaction.channel;
            const { title, url, duration, thumbnail } = track;
            const position = enqueueSongs(guildData, [{
                title, url, duration, thumbnail, requester: interaction.user.username, requesterId: userId
            }]);
            if (!guildData.isPlaying) void playMusic(guildData);
            return edit(interaction, `✅ Đã thêm **${escapeMarkdown(trackName(track))}** vào hàng đợi ở vị trí #${position}.`);
        } catch (error) {
            console.error('Lỗi xử lý bài yêu thích:', error.message);
            return edit(interaction, '❌ Không xử lý được bài yêu thích. Hãy thử lại.');
        }
    }
};
