const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { initGuildMusicData, playMusic, createMusicConnection } = require('../utils/musicUtils');
const { searchYoutube, getVideoInfo, isValidYouTubeUrl, isPlaylistUrl, getPlaylistVideos } = require('../utils/youtubeUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('Phát nhạc từ YouTube')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('Tên bài hát hoặc URL YouTube')
                .setRequired(true)
        ),

    async execute(interaction) {
        // Temporary maintenance mode message
        const maintenanceEmbed = new EmbedBuilder()
            .setColor('#FF6B35')
            .setTitle('🚧 Tính năng đang bảo trì')
            .setDescription(`**Bot music hiện đang tạm thời ngừng hoạt động**`)
            .addFields(
                { name: '❌ Vấn đề', value: 'YouTube đang chặn tất cả bot music', inline: false },
                { name: '⏰ Thời gian', value: 'Có thể kéo dài vài ngày', inline: true },
                { name: '🔧 Nguyên nhân', value: 'YouTube cập nhật chống bot', inline: true },
                { name: '💡 Giải pháp tạm thời', value: '• Sử dụng bot music khác\n• Phát nhạc trực tiếp từ YouTube\n• Đợi cập nhật từ developer', inline: false }
            )
            .setFooter({ text: 'Xin lỗi vì sự bất tiện! Bot sẽ hoạt động trở lại khi YouTube cho phép.' })
            .setTimestamp();

        return interaction.reply({ embeds: [maintenanceEmbed] });

        // Original code (commented out during maintenance)
        /*
        const { guild, member, channel } = interaction;
        
        if (!member.voice.channel) {
            return interaction.reply('❌ Bạn cần vào voice channel trước!');
        }

        await interaction.deferReply();

        const guildData = initGuildMusicData(guild.id);
        guildData.textChannel = channel;

        const query = interaction.options.getString('query');
        let songInfo;

        // Kiểm tra xem có phải YouTube URL hay không
        if (isValidYouTubeUrl(query)) {
            // Kiểm tra có phải playlist không
            if (isPlaylistUrl(query)) {
                return interaction.editReply('🎵 Phát hiện playlist! Sử dụng lệnh `/playlist` để phát toàn bộ playlist, hoặc copy URL video cụ thể để phát 1 bài.');
            }
            
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

        if (!songInfo.requester) {
            songInfo.requester = member.user.username;
        }

        console.log('Song info:', songInfo); // Debug log

        // Thêm thông tin requester
        songInfo.requester = member.user.id;

        // Kết nối voice channel nếu chưa kết nối
        createMusicConnection(member, guildData);

        guildData.queue.push(songInfo);

        if (!guildData.isPlaying) {
            playMusic(guildData);
        }

        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('✅ Đã thêm vào queue')
            .setDescription(`**${songInfo.title}**`)
            .addFields(
                { name: 'Vị trí trong queue', value: `${guildData.queue.length}`, inline: true },
                { name: 'Thời lượng', value: songInfo.duration, inline: true },
                { name: 'Người yêu cầu', value: member.user.username, inline: true }
            )
            .setThumbnail(songInfo.thumbnail);

        interaction.followUp({ embeds: [embed] });
        */
    }
};
