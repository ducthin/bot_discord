const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { initGuildMusicData } = require('../utils/musicUtils');
const { getLyrics, parseArtistTitle } = require('../utils/lyricsUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('lyrics')
        .setDescription('Hiển thị lời bài hát')
        .addStringOption(option =>
            option.setName('song')
                .setDescription('Tên bài hát (để trống để lấy bài đang phát)')
                .setRequired(false)
        ),

    async execute(interaction) {
        const guildData = initGuildMusicData(interaction.guild.id);
        const customSong = interaction.options.getString('song');
        
        let songTitle, songArtist;
        
        if (customSong) {
            // Nếu user nhập tên bài hát
            const parsed = parseArtistTitle(customSong);
            songTitle = parsed.title;
            songArtist = parsed.artist;
        } else {
            // Lấy bài hát đang phát
            if (!guildData.currentSong) {
                return interaction.reply('❌ Không có bài hát nào đang phát! Sử dụng `/lyrics song:<tên bài hát>` để tìm lời bài hát cụ thể.');
            }
            
            const parsed = parseArtistTitle(guildData.currentSong.title);
            songTitle = parsed.title;
            songArtist = parsed.artist;
        }

        await interaction.deferReply();

        try {
            const lyricsData = await getLyrics(songTitle, songArtist);
            
            if (!lyricsData.success) {
                const errorEmbed = new EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle('❌ Không tìm thấy lời bài hát')
                    .setDescription(lyricsData.message)
                    .addFields(
                        { name: 'Tìm kiếm cho', value: `${songArtist ? songArtist + ' - ' : ''}${songTitle}`, inline: false },
                        { name: 'Gợi ý', value: '• Thử với tên bài hát chính xác hơn\n• Thêm tên nghệ sĩ: `/lyrics song:Sơn Tùng - Lạc Trôi`\n• Một số bài hát có thể không có lời', inline: false }
                    );
                
                return interaction.followUp({ embeds: [errorEmbed] });
            }

            // Tạo embed hiển thị lyrics
            const lyricsEmbed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('🎤 Lời bài hát')
                .setDescription(`**${lyricsData.title}**\n*bởi ${lyricsData.artist}*`)
                .addFields(
                    { name: 'Lời bài hát', value: lyricsData.lyrics, inline: false }
                )
                .setFooter({ text: 'Nguồn: Genius.com' });
            
            if (lyricsData.thumbnail) {
                lyricsEmbed.setThumbnail(lyricsData.thumbnail);
            }

            // Tạo button để xem đầy đủ trên Genius
            const lyricsButton = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel('🔗 Xem đầy đủ trên Genius')
                        .setStyle(ButtonStyle.Link)
                        .setURL(lyricsData.url)
                );

            interaction.followUp({ 
                embeds: [lyricsEmbed], 
                components: [lyricsButton] 
            });

        } catch (error) {
            console.error('Lỗi trong lyrics command:', error);
            
            const errorEmbed = new EmbedBuilder()
                .setColor('#ff0000')
                .setTitle('❌ Lỗi hệ thống')
                .setDescription('Đã xảy ra lỗi khi tìm kiếm lời bài hát. Vui lòng thử lại sau.')
                .addFields(
                    { name: 'Tìm kiếm cho', value: `${songArtist ? songArtist + ' - ' : ''}${songTitle}`, inline: false }
                );
            
            interaction.followUp({ embeds: [errorEmbed] });
        }
    }
};
