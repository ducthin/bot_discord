const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { initGuildMusicData, playMusic, createMusicConnection } = require('../utils/musicUtils');
const { getPlaylistVideos, isPlaylistUrl, isValidYouTubeUrl } = require('../utils/youtubeUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('playlist')
        .setDescription('Phát toàn bộ playlist từ YouTube')
        .addStringOption(option =>
            option.setName('url')
                .setDescription('URL playlist YouTube')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option.setName('limit')
                .setDescription('Số lượng bài hát tối đa (mặc định: 20)')
                .setMinValue(1)
                .setMaxValue(100)
                .setRequired(false)
        ),

    async execute(interaction) {
        const { guild, member, channel } = interaction;
        
        if (!member.voice.channel) {
            return interaction.reply('❌ Bạn cần vào voice channel trước!');
        }

        const playlistUrl = interaction.options.getString('url');
        const limit = interaction.options.getInteger('limit') || 20;

        // Kiểm tra URL hợp lệ
        if (!isValidYouTubeUrl(playlistUrl)) {
            return interaction.reply('❌ URL không hợp lệ! Vui lòng cung cấp URL YouTube.');
        }

        // Kiểm tra có phải playlist không
        if (!isPlaylistUrl(playlistUrl)) {
            return interaction.reply('❌ URL này không phải là playlist! Sử dụng `/play` cho video đơn lẻ.');
        }

        await interaction.deferReply();

        const guildData = initGuildMusicData(guild.id);
        guildData.textChannel = channel;

        try {
            const playlistData = await getPlaylistVideos(playlistUrl, limit);
            
            if (!playlistData || !playlistData.videos || playlistData.videos.length === 0) {
                return interaction.followUp('❌ Không thể tải playlist hoặc playlist trống!');
            }

            // Thêm thông tin requester cho tất cả videos
            const videosWithRequester = playlistData.videos.map(video => ({
                ...video,
                requester: member.user.username
            }));

            // Kết nối voice channel nếu chưa kết nối
            createMusicConnection(member, guildData);

            // Thêm tất cả videos vào queue
            guildData.queue.push(...videosWithRequester);

            // Bắt đầu phát nếu chưa có nhạc đang phát
            if (!guildData.isPlaying) {
                playMusic(guildData);
            }

            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('✅ Đã thêm playlist vào queue')
                .setDescription(`**${playlistData.title}**`)
                .addFields(
                    { name: 'Số bài hát', value: `${videosWithRequester.length}`, inline: true },
                    { name: 'Tổng số video', value: `${playlistData.videoCount}`, inline: true },
                    { name: 'Vị trí trong queue', value: `${guildData.queue.length - videosWithRequester.length + 1} - ${guildData.queue.length}`, inline: true }
                )
                .setFooter({ text: `Yêu cầu bởi ${member.user.username}` });

            interaction.followUp({ embeds: [embed] });

        } catch (error) {
            console.error('Lỗi khi tải playlist:', error);
            interaction.followUp('❌ Đã xảy ra lỗi khi tải playlist!');
        }
    }
};
