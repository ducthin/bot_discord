const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { initGuildMusicData, playMusic, createMusicConnection } = require('../utils/musicUtils');
const { searchYoutube } = require('../utils/youtubeUtils');

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
        const subcommand = interaction.options.getSubcommand();
        
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

        const region = interaction.options.getString('region') || 'VN';
        const count = interaction.options.getInteger('count') || 10;

        try {
            await interaction.deferReply();

            // Tạo danh sách từ khóa trending theo khu vực
            const trendingQueries = this.getTrendingQueries(region);
            
            const trendingSongs = [];
            const maxRetries = Math.min(trendingQueries.length, count * 2); // Tìm nhiều hơn để có lựa chọn

            for (let i = 0; i < maxRetries && trendingSongs.length < count; i++) {
                try {
                    const query = trendingQueries[i % trendingQueries.length];
                    const searchResults = await searchYoutube(query, 3);
                    
                    // Chuyển về dạng array để xử lý thống nhất
                    let results = [];
                    if (Array.isArray(searchResults)) {
                        results = searchResults;
                    } else if (searchResults && searchResults.title) {
                        results = [searchResults];
                    }
                    
                    if (results.length > 0) {
                        // Lọc bài chưa có trong danh sách
                        for (const song of results) {
                            if (trendingSongs.length < count && 
                                !trendingSongs.some(existing => existing.url === song.url) &&
                                !guildData.queue.some(existing => existing.url === song.url)) {
                                
                                song.requestedBy = interaction.user.id;
                                song.trendingRank = trendingSongs.length + 1;
                                trendingSongs.push(song);
                            }
                        }
                    }
                } catch (error) {
                    console.log(`Lỗi tìm trending: ${error.message}`);
                }
            }

            if (trendingSongs.length === 0) {
                return interaction.editReply({
                    content: '❌ Không thể tìm thấy nhạc thịnh hành! Hãy thử lại sau.'
                });
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
        const action = interaction.options.getString('action');
        const region = interaction.options.getString('region') || guildData.autoTrending.region || 'VN';

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

    // Lấy queries trending theo khu vực
    getTrendingQueries(region) {
        const queries = {
            'VN': [
                'trending vietnam music 2024',
                'top vpop hits 2024',
                'nhạc việt thịnh hành',
                'sơn tùng mtp mới nhất',
                'hòa minzy trending',
                'erik vpop hits',
                'jack k-icm trending',
                'đen vâu rap trending',
                'amee vpop 2024',
                'min vpop trending',
                'nhạc trẻ việt nam hot',
                'nhạc việt viral tiktok',
                'vietnamese pop music trending',
                'bích phương vpop hits',
                'chi pu trending 2024',
                'mỹ tâm ballad mới',
                'đức phúc vpop trending',
                'orange vpop ballad',
                'karik rap trending',
                'rhymastic rap việt',
                'binz rap vpop hits',
                'tóc tiên vpop dance',
                'hieuthuhai rap trending',
                'mono vpop ballad',
                'vũ cát tường indie',
                'justatee rap vpop',
                'lime vpop trending',
                'lam trường ballad',
                'nguyên hà indie vpop',
                'phương ly vpop hits',
                'touliver edm vpop',
                'ưng hoàng phúc ballad',
                'tiên cookie vpop',
                'grey d vpop trending',
                'onlyc vpop ballad',
                'noo phước thịnh vpop',
                'lou hoàng vpop hits',
                'chillies vpop band',
                'cao bá hưng ballad',
                'thịnh suy indie vpop',
                'khói vpop indie',
                'vũ vpop trending',
                'phan mạnh quỳnh ballad',
                'lã phong lâm vpop',
                'jombie rap vpop',
                'dế choắt rap trending',
                'dat g rap vpop',
                'wxrdie rap underground',
                'young h rap trending',
                'mc mike rap vpop',
                'soobin hoàng sơn vpop',
                'isaac vpop trending',
                'rocker nguyen vpop',
                'kelvin khánh vpop',
                'ngh vpop trending',
                'masew edm vpop',
                'k391 vpop remix',
                'long nón lá vpop',
                'khắc hưng vpop hits',
                'wowy rap việt',
                'rap việt trending',
                'lil shady rap',
                'b ray rap việt',
                'tlinh rap trending',
                'ricky star rap',
                'obito rap việt',
                'lăng ld rap',
                'pjnboys rap trending',
                'andree right hand rap',
                'rich chigga rap việt',
                'bigdaddy rap trending',
                'yanbi rap vpop',
                'emily rap việt',
                'blacka rap trending',
                'kimmese rap',
                'suboi rap việt',
                'lil knight rap',
                'touliver rap trending'
            ],
            'KR': [
                'kpop trending 2024',
                'bts latest hits',
                'blackpink trending',
                'twice new songs 2024',
                'aespa trending music',
                'ive kpop hits',
                'itzy trending songs',
                'newjeans trending',
                'le sserafim hits',
                'stray kids trending',
                'seventeen kpop 2024',
                'gidle trending music',
                'red velvet latest',
                'kpop viral tiktok',
                'korean pop trending'
            ],
            'US': [
                'trending music usa 2024',
                'billboard hot 100',
                'pop music trending',
                'hip hop trending 2024',
                'taylor swift latest',
                'ariana grande trending',
                'dua lipa hits 2024',
                'the weeknd trending',
                'billie eilish new',
                'post malone trending',
                'drake hip hop 2024',
                'olivia rodrigo hits',
                'trending rap music',
                'viral music tiktok usa',
                'american pop trending'
            ],
            'GLOBAL': [
                'trending music worldwide 2024',
                'global hits 2024',
                'viral songs tiktok',
                'international pop trending',
                'world music trending',
                'global viral hits',
                'trending songs spotify',
                'youtube trending music',
                'international hits 2024',
                'global pop music',
                'trending dance music',
                'viral music videos',
                'world pop trending',
                'international viral songs',
                'global music charts'
            ],
            'ASIA': [
                'asian pop trending 2024',
                'jpop trending music',
                'thai pop trending',
                'cpop mandarin hits',
                'asian music viral',
                'bollywood trending 2024',
                'jpop hits 2024',
                'thai music trending',
                'chinese pop trending',
                'indo pop trending',
                'asian viral tiktok',
                'oriental pop music',
                'asian charts 2024',
                'trending asian songs',
                'eastern pop hits'
            ]
        };

        return queries[region] || queries['GLOBAL'];
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
            
            const { searchYoutube } = require('../utils/youtubeUtils');
            
            const queries = this.getTrendingQueries(region);
            const allSongs = [];
            
            // Nếu cần nhiều bài, dùng nhiều query khác nhau
            const queryCount = Math.min(queries.length, Math.ceil(limit / 3));
            
            // Shuffle queries để có tính ngẫu nhiên
            const shuffledQueries = [...queries].sort(() => Math.random() - 0.5);
            
            for (let i = 0; i < queryCount && allSongs.length < limit; i++) {
                const query = shuffledQueries[i];
                console.log(`🎯 Query ${i + 1}: "${query}"`);
                
                try {
                    const results = await searchYoutube(query, Math.min(5, limit - allSongs.length + 2));
                    
                    // Kiểm tra kết quả có phải là array không
                    let songsArray = [];
                    if (Array.isArray(results)) {
                        songsArray = results;
                    } else if (results && results.title) {
                        songsArray = [results];
                    }
                    
                    console.log(`📊 Query "${query}" returned ${songsArray.length} songs`);
                    
                    // Đánh dấu tất cả bài là autoTrending
                    songsArray.forEach(song => {
                        song.autoTrending = true;
                        song.region = region;
                    });
                    
                    allSongs.push(...songsArray);
                    
                } catch (queryError) {
                    console.error(`❌ Lỗi với query "${query}":`, queryError.message);
                }
                
                // Delay nhỏ giữa các query để tránh rate limit
                if (i < queryCount - 1) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }
            
            console.log(`🎵 Total songs found: ${allSongs.length}`);
            
            if (allSongs.length > 0) {
                // Shuffle kết quả để tăng tính ngẫu nhiên
                const shuffledSongs = allSongs.sort(() => Math.random() - 0.5);
                
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