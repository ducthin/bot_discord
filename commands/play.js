const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { initGuildMusicData, playMusic, createMusicConnection, enqueueSongs } = require('../utils/musicUtils');
const { searchYoutube, getVideoInfo, isValidYouTubeUrl, isPlaylistUrl, MAX_PLAYLIST_TRACKS } = require('../utils/youtubeUtils');
const playlistCommand = require('./playlist');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('Phát bài hát, playlist hoặc Mix từ YouTube')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('Tên bài hát, link video, playlist hoặc YouTube Mix')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option.setName('limit')
                .setDescription(`Số bài tối đa khi phát playlist (mặc định: ${MAX_PLAYLIST_TRACKS})`)
                .setMinValue(1)
                .setMaxValue(MAX_PLAYLIST_TRACKS)
        )
        .addBooleanOption(option =>
            option.setName('next')
                .setDescription('Đưa bài hoặc playlist lên ngay sau bài đang phát')
        ),

    async execute(interaction) {
        const { guild, member, channel } = interaction;
        
        if (!member.voice.channel) {
            return interaction.reply('❌ Bạn cần vào voice channel trước!');
        }

        const query = interaction.options.getString('query');
        const playNext = interaction.options.getBoolean('next') ?? false;

        // Validate query
        if (query.length > 500) {
            return interaction.reply('❌ Từ khóa quá dài! Tối đa 500 ký tự.');
        }

        if (isPlaylistUrl(query)) {
            const limit = interaction.options.getInteger('limit') ?? MAX_PLAYLIST_TRACKS;
            return playlistCommand.execute(interaction, query, limit, playNext);
        }

        const guildData = initGuildMusicData(guild.id);
        const queueEpoch = guildData.queueEpoch;
        await interaction.deferReply();

        let songInfo;

        // Kiểm tra xem có phải YouTube URL hay không
        if (isValidYouTubeUrl(query)) {
            songInfo = await getVideoInfo(query);
            if (!songInfo) {
                return interaction.editReply('❌ Không thể lấy thông tin video!');
            }
        } else {
            songInfo = await searchYoutube(query);
            if (!songInfo) {
                return interaction.editReply('❌ Không tìm thấy bài hát nào!');
            }
        }

        if (queueEpoch !== guildData.queueEpoch) return interaction.editReply('⏹️ Yêu cầu đã hủy vì hàng đợi vừa được dừng.');

        // Thêm thông tin requester
        songInfo.requester = member.user.username;
        songInfo.requesterId = member.user.id;

        // Kết nối voice channel nếu chưa kết nối
        createMusicConnection(member, guildData);
        guildData.textChannel = channel;

        const position = enqueueSongs(guildData, [songInfo], playNext);

        if (!guildData.isPlaying) {
            playMusic(guildData);
        }

        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle(playNext ? '⏭️ Đã đưa bài lên phát tiếp' : '✅ Đã thêm vào queue')
            .setDescription(`**${songInfo.title}**`)
            .addFields(
                { name: 'Vị trí trong queue', value: `${position}`, inline: true },
                { name: 'Thời lượng', value: songInfo.duration || 'Không xác định', inline: true },
                { name: 'Người yêu cầu', value: member.user.username, inline: true }
            )
            .setThumbnail(songInfo.thumbnail || null);

        await interaction.editReply({ embeds: [embed] });
    }
};
