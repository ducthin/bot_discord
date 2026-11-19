const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { favoriteId } = require('./favoritesStore');

function buildPlaybackRows(song) {
    const button = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder()
        .setCustomId(id).setLabel(label).setStyle(style);
    const primary = new ActionRowBuilder().addComponents(
        button('toggle_playback', '⏯️ Phát / Tạm dừng', ButtonStyle.Primary),
        button('skip_music', '⏭️ Bỏ qua'), button('show_queue', '📋 Hàng đợi'),
        button('stop_music', '⏹️ Dừng', ButtonStyle.Danger)
    );
    const id = favoriteId(song);
    if (id) primary.addComponents(button('favorite_save_' + id, '❤️ Yêu thích'));
    return [
        primary,
        new ActionRowBuilder().addComponents(
            button('seek_back_30', '⏪ -30s'), button('seek_forward_30', '⏩ +30s'),
            button('volume_down', '🔉 -10%'), button('volume_up', '🔊 +10%'), button('loop_toggle', '🔁 Lặp hàng đợi')
        ),
        new ActionRowBuilder().addComponents(
            button('shuffle_music', '🔀 Trộn bài'), button('show_lyrics', '🎤 Lời bài hát'),
            button('leave_voice', '👋 Rời phòng', ButtonStyle.Danger)
        )
    ];
}

module.exports = { buildPlaybackRows };
