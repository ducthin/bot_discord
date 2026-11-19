const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { initGuildMusicData, playMusic, createMusicConnection, enqueueSongs } = require('../utils/musicUtils');
const { getPlaylistVideos, isPlaylistUrl, isValidYouTubeUrl, isYouTubeMixUrl, MAX_PLAYLIST_TRACKS } = require('../utils/youtubeUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('playlist')
        .setDescription('Thêm playlist YouTube vào hàng đợi')
        .addStringOption(option =>
            option.setName('url')
                .setDescription('URL playlist YouTube')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option.setName('limit')
                .setDescription(`Số bài tối đa (mặc định: ${MAX_PLAYLIST_TRACKS})`)
                .setMinValue(1)
                .setMaxValue(MAX_PLAYLIST_TRACKS)
                .setRequired(false)
        ),

    async execute(interaction, playlistUrl = interaction.options.getString('url'), limit = interaction.options.getInteger('limit') ?? MAX_PLAYLIST_TRACKS, playNext = false) {
        const { guild, member, channel } = interaction;
        
        if (!member.voice.channel) {
            return interaction.reply('❌ Bạn cần vào voice channel trước!');
        }

        // Kiểm tra URL hợp lệ
        if (!isValidYouTubeUrl(playlistUrl)) {
            return interaction.reply('❌ URL không hợp lệ! Vui lòng cung cấp URL YouTube.');
        }

        // Kiểm tra có phải playlist không
        if (!isPlaylistUrl(playlistUrl)) {
            return interaction.reply('❌ URL này không phải là playlist! Sử dụng `/play` cho video đơn lẻ.');
        }

        const isMix = isYouTubeMixUrl(playlistUrl);

        const guildData = initGuildMusicData(guild.id);
        const queueEpoch = guildData.queueEpoch;
        await interaction.deferReply();

        try {
            const playlistData = await getPlaylistVideos(playlistUrl, limit);
            if (queueEpoch !== guildData.queueEpoch) return interaction.editReply('⏹️ Yêu cầu đã hủy vì hàng đợi vừa được dừng.');
            
            if (!playlistData || !playlistData.videos || playlistData.videos.length === 0) {
                return interaction.editReply(isMix
                    ? '❌ Không đọc được YouTube Mix. Hãy mở một bài trong Mix rồi sao chép link có cả `v=` và `list=` để thử lại.'
                    : '❌ Không đọc được bài nào trong playlist. Kiểm tra link và mở playlist trên YouTube mà không cần đăng nhập, rồi thử lại.');
            }

            // Thêm thông tin requester cho tất cả videos
            const videosWithRequester = playlistData.videos.map(video => ({
                ...video,
                requester: member.user.username,
                requesterId: member.user.id
            }));

            // Kết nối voice channel nếu chưa kết nối
            createMusicConnection(member, guildData);
            guildData.textChannel = channel;

            // Thêm tất cả videos vào queue
            const position = enqueueSongs(guildData, videosWithRequester, playNext);

            // Bắt đầu phát nếu chưa có nhạc đang phát
            if (!guildData.isPlaying) {
                playMusic(guildData);
            }

            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle(playNext ? '⏭️ Đã đưa playlist lên phát tiếp' : '✅ Đã thêm playlist vào queue')
                .setDescription(`**${playlistData.title}**`)
                .addFields(
                    { name: 'Số bài hát', value: `${videosWithRequester.length}`, inline: true },
                    { name: 'Vị trí trong queue', value: `${position} - ${position + videosWithRequester.length - 1}`, inline: true }
                )
                .setFooter({ text: `Yêu cầu bởi ${member.user.username}` });

            if (!isMix && Number.isInteger(playlistData.videoCount)) {
                embed.addFields({ name: 'Tổng số video trên YouTube', value: `${playlistData.videoCount}`, inline: true });
                if (playlistData.videoCount > videosWithRequester.length) {
                    embed.setFooter({ text: videosWithRequester.length === limit
                        ? `Đã thêm tối đa ${limit} bài theo giới hạn của lệnh.`
                        : `Đã thêm ${videosWithRequester.length} bài đọc được. Một số video có thể không khả dụng.` });
                }
            }
            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Lỗi khi tải playlist:', error);
            await interaction.editReply('❌ Đã xảy ra lỗi khi tải playlist!');
        }
    }
};
