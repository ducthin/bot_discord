const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const playlists = require('../utils/playlistStore');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('playlist-save')
        .setDescription('Lưu hoặc load playlist cá nhân')
        .addSubcommand(subcommand =>
            subcommand
                .setName('save')
                .setDescription('Lưu queue hiện tại thành playlist')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Tên playlist')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('load')
                .setDescription('Load playlist đã lưu')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Tên playlist')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('Hiển thị danh sách playlist đã lưu')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('delete')
                .setDescription('Xóa playlist đã lưu')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Tên playlist')
                        .setRequired(true)
                )
        ),

    async execute(interaction) {
        const { guild, member } = interaction;
        const subcommand = interaction.options.getSubcommand();
        
        if (!member.voice.channel && subcommand !== 'list') {
            return interaction.reply('❌ Bạn cần vào voice channel để sử dụng lệnh này!');
        }

        const userId = member.user.id;

        if (subcommand !== 'list') {
            try {
                playlists.validatePlaylistName(interaction.options.getString('name'));
            } catch (error) {
                return interaction.reply({ content: error.message, ephemeral: true });
            }
        }

        switch (subcommand) {
            case 'save':
                await this.savePlaylist(interaction, userId);
                break;
            case 'load':
                await this.loadPlaylist(interaction, userId);
                break;
            case 'list':
                await this.listPlaylists(interaction, userId);
                break;
            case 'delete':
                await this.deletePlaylist(interaction, userId);
                break;
        }
    },

    async savePlaylist(interaction, userId) {
        const { initGuildMusicData } = require('../utils/musicUtils');
        const guildData = initGuildMusicData(interaction.guild.id);
        
        if (guildData.queue.length === 0) {
            return interaction.reply('❌ Queue trống! Không có gì để lưu.');
        }

        const playlistName = interaction.options.getString('name');

        const playlistData = {
            name: playlistName,
            songs: guildData.queue.map(song => ({
                title: song.title,
                url: song.url,
                duration: song.duration,
                thumbnail: song.thumbnail
            })),
            createdAt: new Date().toISOString(),
            totalSongs: guildData.queue.length
        };

        try {
            await playlists.save(userId, playlistName, playlistData);
            interaction.reply(`💾 Đã lưu playlist **"${playlistName}"** với ${guildData.queue.length} bài hát!`);
        } catch (error) {
            console.error('Lỗi khi lưu playlist:', error);
            interaction.reply('❌ Lỗi khi lưu playlist!');
        }
    },

    async loadPlaylist(interaction, userId) {
        const playlistName = interaction.options.getString('name');

        try {
            const playlistData = await playlists.load(userId, playlistName);
            if (!playlistData) return interaction.reply(`❌ Không tìm thấy playlist "${playlistName}"!`);

            const { initGuildMusicData, playMusic, createMusicConnection } = require('../utils/musicUtils');
            const guildData = initGuildMusicData(interaction.guild.id);

            createMusicConnection(interaction.member, guildData);
            guildData.textChannel = interaction.channel;

            // Thêm các bài hát vào queue
            guildData.queue.push(...playlistData.songs.map(song => ({
                ...song, requester: interaction.member.user?.username, requesterId: interaction.member.user?.id
            })));

            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('📂 Đã load playlist!')
                .setDescription(`**${playlistData.name}**`)
                .addFields(
                    { name: 'Số bài hát', value: `${playlistData.totalSongs}`, inline: true },
                    { name: 'Được tạo', value: new Date(playlistData.createdAt).toLocaleDateString('vi-VN'), inline: true }
                );

            await interaction.reply({ embeds: [embed] });

            // Phát nhạc nếu chưa có gì đang phát
            if (!guildData.isPlaying && guildData.queue.length > 0) {
                playMusic(guildData);
            }

        } catch (error) {
            if (error.code === 'ENOENT') {
                interaction.reply(`❌ Không tìm thấy playlist "${playlistName}"!`);
            } else {
                console.error('Lỗi khi load playlist:', error);
                interaction.reply('❌ Lỗi khi load playlist!');
            }
        }
    },

    async listPlaylists(interaction, userId) {
        try {
            const saved = await playlists.list(userId);

            if (saved.length === 0) {
                return interaction.reply('📂 Bạn chưa có playlist nào được lưu!');
            }

            const playlistInfo = saved.map(playlist => `**${playlist.name}** - ${playlist.totalSongs} bài hát`);

            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('📂 Playlist đã lưu')
                .setDescription(playlistInfo.join('\n') || 'Không có playlist hợp lệ')
                .setFooter({ text: 'Sử dụng /playlist-save load <tên> để phát playlist' });

            interaction.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Lỗi khi đọc danh sách playlist:', error.message);
            return interaction.reply('❌ Lỗi khi đọc danh sách playlist!');
        }
    },

    async deletePlaylist(interaction, userId) {
        const playlistName = interaction.options.getString('name');

        try {
            const removed = await playlists.remove(userId, playlistName);
            if (!removed) return interaction.reply(`❌ Không tìm thấy playlist "${playlistName}"!`);
            interaction.reply(`🗑️ Đã xóa playlist "${playlistName}"!`);
        } catch (error) {
            if (error.code === 'ENOENT') {
                interaction.reply(`❌ Không tìm thấy playlist "${playlistName}"!`);
            } else {
                console.error('Lỗi khi xóa playlist:', error);
                interaction.reply('❌ Lỗi khi xóa playlist!');
            }
        }
    }
};
