const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { initGuildMusicData } = require('../utils/musicUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('select')
        .setDescription('Chọn bài hát từ queue để phát ngay lập tức')
        .addIntegerOption(option =>
            option.setName('position')
                .setDescription('Vị trí bài hát trong queue (1, 2, 3...)')
                .setRequired(false)),

    async execute(interaction) {
        const guildData = initGuildMusicData(interaction.guildId);
        const position = interaction.options.getInteger('position');

        if (!guildData.queue || guildData.queue.length === 0) {
            return interaction.reply({
                content: '❌ Queue hiện tại đang trống!',
                ephemeral: true
            });
        }

        if (!interaction.member.voice.channel) {
            return interaction.reply({
                content: '❌ Bạn cần vào voice channel để sử dụng lệnh này!',
                ephemeral: true
            });
        }

        try {
            await interaction.deferReply();

            // Nếu có position, chọn trực tiếp
            if (position) {
                if (position < 1 || position > guildData.queue.length) {
                    return interaction.editReply({
                        content: `❌ Vị trí không hợp lệ! Queue có ${guildData.queue.length} bài hát.`
                    });
                }

                const selectedSong = guildData.queue[position - 1];
                
                // Di chuyển bài được chọn lên đầu queue
                guildData.queue.splice(position - 1, 1);
                guildData.queue.unshift(selectedSong);

                const embed = new EmbedBuilder()
                    .setColor('#00ff00')
                    .setTitle('🎵 Đã chọn bài để phát tiếp theo')
                    .setDescription(`**${selectedSong.title}**`)
                    .addFields(
                        { name: 'Vị trí cũ', value: `#${position}`, inline: true },
                        { name: 'Vị trí mới', value: '#1 (Tiếp theo)', inline: true }
                    )
                    .setThumbnail(selectedSong.thumbnail);

                await interaction.editReply({ embeds: [embed] });

                // Nếu không đang phát, bắt đầu phát ngay
                if (!guildData.isPlaying) {
                    const { createMusicConnection, playMusic } = require('../utils/musicUtils');
                    createMusicConnection(interaction.member, guildData);
                    playMusic(guildData);
                }

                return;
            }

            // Nếu không có position, hiển thị select menu
            if (guildData.queue.length > 25) {
                return interaction.editReply({
                    content: '❌ Queue quá dài (>25 bài). Vui lòng sử dụng `/select position:<số>` để chọn trực tiếp.'
                });
            }

            // Tạo select menu với danh sách bài hát
            const options = guildData.queue.map((song, index) => ({
                label: song.title.length > 100 ? song.title.substring(0, 97) + '...' : song.title,
                description: `Vị trí #${index + 1} - ${song.duration || 'N/A'}`,
                value: index.toString(),
                emoji: index === 0 ? '▶️' : '🎵'
            }));

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('select_song')
                .setPlaceholder('Chọn bài hát để phát tiếp theo...')
                .addOptions(options);

            const row = new ActionRowBuilder().addComponents(selectMenu);

            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('🎵 Chọn bài hát từ Queue')
                .setDescription(`Queue hiện tại có **${guildData.queue.length}** bài hát.\nChọn bài bạn muốn phát tiếp theo:`)
                .setFooter({ text: 'Bài được chọn sẽ được di chuyển lên đầu queue' });

            await interaction.editReply({ 
                embeds: [embed], 
                components: [row] 
            });

        } catch (error) {
            console.error('Lỗi select command:', error);
            await interaction.editReply({
                content: '❌ Có lỗi khi xử lý lệnh select!'
            });
        }
    }
};
