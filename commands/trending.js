const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { initGuildMusicData, playMusic, createMusicConnection } = require('../utils/musicUtils');
const { fetchYoutubeTrending } = require('../utils/youtubeUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('trending')
        .setDescription('Phát nhạc thịnh hành từ YouTube')
        .addSubcommand(subcommand =>
            subcommand
                .setName('play')
                .setDescription('Phát nhạc trending ngay')
                .addStringOption(option =>
                    option.setName('region')
                        .setDescription('Khu vực')
                        .setRequired(false)
                        .addChoices(
                            { name: 'Việt Nam', value: 'VN' },
                            { name: 'Hàn Quốc (K-pop)', value: 'KR' },
                            { name: 'Mỹ (US)', value: 'US' },
                            { name: 'Toàn cầu', value: 'GLOBAL' },
                            { name: 'Châu Á', value: 'ASIA' }
                        )
                )
                .addIntegerOption(option =>
                    option.setName('count')
                        .setDescription('Số bài hát muốn thêm (1-20)')
                        .setRequired(false)
                        .setMinValue(1)
                        .setMaxValue(20)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('auto')
                .setDescription('Quản lý auto-trending')
                .addStringOption(option =>
                    option.setName('action')
                        .setDescription('Hành động')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Bật', value: 'enable' },
                            { name: 'Tắt', value: 'disable' },
                            { name: 'Trạng thái', value: 'status' }
                        )
                )
                .addStringOption(option =>
                    option.setName('region')
                        .setDescription('Khu vực cho auto-trending')
                        .setRequired(false)
                        .addChoices(
                            { name: 'Việt Nam', value: 'VN' },
                            { name: 'Hàn Quốc (K-pop)', value: 'KR' },
                            { name: 'Mỹ (US)', value: 'US' },
                            { name: 'Toàn cầu', value: 'GLOBAL' },
                            { name: 'Châu Á', value: 'ASIA' }
                        )
                )
        ),

    async execute(interaction) {
        let subcommand = 'play';
        if (interaction.options && typeof interaction.options.getSubcommand === 'function') {
            subcommand = interaction.options.getSubcommand();
        }
        
        if (subcommand === 'play') {
            return this.executePlay(interaction);
        } else if (subcommand === 'auto') {
            return this.executeAuto(interaction);
        }
    },

    async executePlay(interaction) {
        const guildData = initGuildMusicData(interaction.guildId);

        if (!interaction.member.voice.channel) {
            return interaction.reply({
                content: '❌ Bạn cần vào voice channel để phát nhạc thịnh hành!',
                ephemeral: true
            });
        }

        const region = (interaction.options && typeof interaction.options.getString === 'function')
            ? (interaction.options.getString('region') || 'VN')
            : 'VN';
        const count = (interaction.options && typeof interaction.options.getInteger === 'function')
            ? (interaction.options.getInteger('count') || 10)
            : 10;

        try {
            await interaction.deferReply();

            // Tải danh sách bài hát trending trực tiếp từ YouTube
            const trendingSongs = await fetchYoutubeTrending(region, count);

            if (trendingSongs.length === 0) {
                return interaction.editReply({
                    content: '❌ Không thể tìm thấy nhạc thịnh hành! Hãy thử lại sau.'
                });
            }

            for (const song of trendingSongs) {
                song.requester = interaction.user.username;
                song.requesterId = interaction.user.id;
            }

            // Thêm vào queue
            guildData.queue.push(...trendingSongs);

            // Tạo embed hiển thị
            const embed = new EmbedBuilder()
                .setColor('#ff6b6b')
                .setTitle('🔥 Nhạc Thịnh Hành YouTube')
                .setDescription(`**${this.getRegionDisplayName(region)}** - ${trendingSongs.length} bài hát`)
                .addFields(
                    { name: '📊 Khu vực', value: this.getRegionDisplayName(region), inline: true },
                    { name: '🎵 Số bài', value: `${trendingSongs.length} bài`, inline: true },
                    { name: '📈 Cập nhật', value: 'Real-time', inline: true }
                );

            // Hiển thị danh sách trending (rút ngắn để tránh vượt quá 1024 ký tự)
            const songList = trendingSongs.slice(0, 5).map((song, index) => {
                // Cắt ngắn tên bài nếu quá dài
                const truncatedTitle = song.title.length > 50 
                    ? song.title.substring(0, 47) + '...' 
                    : song.title;
                
                return `**${index + 1}.** ${truncatedTitle}\n*⏱️ ${song.duration || 'N/A'}*`;
            }).join('\n\n');

            if (songList) {
                embed.addFields({ name: '🎵 Top Trending', value: songList });
            }

            // Tạo control buttons
            const controlRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('trending_play_now')
                        .setLabel('▶️ Phát ngay')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId('trending_shuffle')
                        .setLabel('🔀 Trộn bài')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('trending_more')
                        .setLabel('➕ Thêm 10 bài')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId('trending_refresh')
                        .setLabel('🔄 Làm mới')
                        .setStyle(ButtonStyle.Secondary)
                );

            await interaction.editReply({
                embeds: [embed],
                components: [controlRow]
            });

            // Tự động phát nếu không có nhạc đang phát
            if (!guildData.isPlaying && guildData.queue.length > 0) {
                createMusicConnection(interaction.member, guildData);
                playMusic(guildData);
                
                await interaction.followUp({
                    content: '🎵 Đã bắt đầu phát nhạc thịnh hành!',
                    ephemeral: true
                });
            }

        } catch (error) {
            console.error('Lỗi trending command:', error);
            await interaction.editReply({
                content: '❌ Có lỗi khi tải nhạc thịnh hành!'
            });
        }
    },

    async executeAuto(interaction) {
        const guildData = initGuildMusicData(interaction.guildId);
        const action = (interaction.options && typeof interaction.options.getString === 'function')
            ? interaction.options.getString('action')
            : null;
        const region = (interaction.options && typeof interaction.options.getString === 'function')
            ? (interaction.options.getString('region') || guildData.autoTrending.region || 'VN')
            : (guildData.autoTrending.region || 'VN');

        if (action === 'enable') {
            guildData.autoTrending.enabled = true;
            guildData.autoTrending.region = region;
            guildData.autoTrending.consecutiveFailures = 0;
            
            const regionName = this.getRegionDisplayName(region);
            
            await interaction.reply({
                content: `✅ **Auto-trending đã được bật** cho khu vực **${regionName}**!\n` +
                        `🎵 Bot sẽ tự động phát nhạc thịnh hành khi hết bài trong queue.\n` +
                        `📦 Hệ thống sẽ tải 20 bài một lần và phát dần dần.`,
                ephemeral: true
            });
            
            // Nếu queue rỗng và không đang phát, bắt đầu auto-trending ngay
            if (guildData.queue.length === 0 && !guildData.isPlaying) {
                guildData.textChannel = interaction.channel;
                
                if (interaction.member.voice.channel) {
                    createMusicConnection(interaction.member, guildData);
                    const { handleAutoTrending } = require('../utils/musicUtils');
                    await handleAutoTrending(guildData);
                }
            }

        } else if (action === 'disable') {
            guildData.autoTrending.enabled = false;
            
            await interaction.reply({
                content: `🚫 **Auto-trending đã được tắt**.\n` +
                        `📊 Đã phát ${guildData.autoTrending.count} bài auto-trending.`,
                ephemeral: true
            });

        } else if (action === 'status') {
            const regionName = this.getRegionDisplayName(guildData.autoTrending.region);
            const status = guildData.autoTrending.enabled ? '✅ Đang bật' : '🚫 Đã tắt';
            const listCount = guildData.autoTrending.trendingList.length;
            const playedCount = guildData.autoTrending.playedSongs.size;
            
            const embed = new EmbedBuilder()
                .setColor(guildData.autoTrending.enabled ? '#00ff00' : '#ff0000')
                .setTitle('🔥 Trạng thái Auto-Trending')
                .addFields(
                    { name: '📊 Trạng thái', value: status, inline: true },
                    { name: '🌍 Khu vực', value: regionName, inline: true },
                    { name: '🎵 Đã phát', value: `${guildData.autoTrending.count} bài`, inline: true },
                    { name: '📦 Còn trong list', value: `${listCount} bài`, inline: true },
                    { name: '🔄 Đã đánh dấu', value: `${playedCount} bài`, inline: true },
                    { name: '❌ Lỗi liên tiếp', value: `${guildData.autoTrending.consecutiveFailures}/10`, inline: true }
                );

            if (guildData.autoTrending.lastFetch) {
                const lastFetch = new Date(guildData.autoTrending.lastFetch);
                embed.addFields({
                    name: '🕒 Lần tải cuối',
                    value: `<t:${Math.floor(lastFetch.getTime() / 1000)}:R>`,
                    inline: false
                });
            }

            await interaction.reply({ embeds: [embed], ephemeral: true });
        }
    },

    // Hiển thị tên khu vực
    getRegionDisplayName(region) {
        const names = {
            'VN': '🇻🇳 Việt Nam',
            'KR': '🇰🇷 Hàn Quốc (K-pop)',
            'US': '🇺🇸 Mỹ (US)',
            'GLOBAL': '🌍 Toàn cầu',
            'ASIA': '🌏 Châu Á'
        };
        return names[region] || '🌍 Toàn cầu';
    },

    // Tự động trending (gọi từ autoplay)
    async getAutoTrendingSong(region = 'VN', limit = 1) {
        try {
            console.log(`🔍 Getting auto trending songs for region: ${region}, limit: ${limit}`);
            
            const { fetchYoutubeTrending } = require('../utils/youtubeUtils');
            const songs = await fetchYoutubeTrending(region, limit + 10); // Lấy dư ra 10 bài để trộn ngẫu nhiên
            
            if (songs && songs.length > 0) {
                // Đánh dấu tất cả bài là autoTrending
                songs.forEach(song => {
                    song.autoTrending = true;
                    song.region = region;
                });
                
                // Shuffle kết quả để tăng tính ngẫu nhiên
                const shuffledSongs = songs.sort(() => Math.random() - 0.5);
                
                // Trả về 1 bài nếu limit = 1, array nếu limit > 1
                if (limit === 1) {
                    const selectedSong = shuffledSongs[0];
                    console.log(`🎵 Selected song: ${selectedSong.title}`);
                    return selectedSong;
                } else {
                    const selectedSongs = shuffledSongs.slice(0, limit);
                    console.log(`🎵 Selected ${selectedSongs.length} songs`);
                    return selectedSongs;
                }
            } else {
                console.log('❌ No search results found');
            }
        } catch (error) {
            console.error('❌ Lỗi auto trending:', error);
        }
        return null;
    }
};
