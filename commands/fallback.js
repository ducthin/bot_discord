const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getMusicData } = require('../utils/musicUtils');
const { getRandomPlaylist, getAllSongs } = require('../utils/fallbackPlaylist');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('fallback')
        .setDescription('Sử dụng playlist dự phòng khi YouTube không hoạt động')
        .addStringOption(option =>
            option.setName('mode')
                .setDescription('Chế độ playlist')
                .setRequired(false)
                .addChoices(
                    { name: 'Random 5 bài', value: 'random' },
                    { name: 'Tất cả bài hát', value: 'all' }
                )),

    async execute(interaction) {
        const mode = interaction.options.getString('mode') || 'random';
        const member = interaction.member;

        if (!member.voice.channel) {
            return interaction.reply({
                content: '❌ Bạn cần vào voice channel trước!',
                ephemeral: true
            });
        }

        try {
            await interaction.deferReply();

            const guildData = getMusicData(interaction.guildId);
            
            // Lấy danh sách bài hát
            const songs = mode === 'all' ? getAllSongs() : getRandomPlaylist(5);
            
            // Thêm thông tin requester
            const songsWithRequester = songs.map(song => ({
                ...song,
                requester: interaction.user.username,
                requestedBy: interaction.user.id,
                channel: member.voice.channel.name
            }));

            // Thêm vào queue
            guildData.queue.push(...songsWithRequester);
            guildData.textChannel = interaction.channel;

            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('🎵 Fallback Playlist Loaded')
                .setDescription(`Đã thêm **${songs.length} bài hát** vào queue`)
                .addFields(
                    { name: 'Chế độ', value: mode === 'all' ? 'Tất cả bài hát' : 'Random 5 bài', inline: true },
                    { name: 'Voice Channel', value: member.voice.channel.name, inline: true }
                )
                .setFooter({ text: 'Sử dụng playlist dự phòng do YouTube không khả dụng' });

            // Hiển thị 3 bài đầu
            const preview = songs.slice(0, 3).map((song, index) => 
                `${index + 1}. ${song.title}`
            ).join('\n');
            
            if (preview) {
                embed.addFields({ name: 'Preview', value: preview, inline: false });
            }

            await interaction.editReply({ embeds: [embed] });

            // Bắt đầu phát nhạc nếu chưa phát
            if (!guildData.isPlaying) {
                const { createMusicConnection, playMusic } = require('../utils/musicUtils');
                createMusicConnection(member, guildData);
                playMusic(guildData);
            }

        } catch (error) {
            console.error('Lỗi fallback command:', error);
            await interaction.editReply({
                content: '❌ Có lỗi khi load fallback playlist!'
            });
        }
    }
};
