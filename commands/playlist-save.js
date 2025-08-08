const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');

const PLAYLISTS_DIR = path.join(__dirname, '../data/playlists');

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
        const userPlaylistsDir = path.join(PLAYLISTS_DIR, userId);

        // Tạo thư mục nếu chưa có
        try {
            await fs.mkdir(userPlaylistsDir, { recursive: true });
        } catch (error) {
            // Thư mục đã tồn tại
        }

        switch (subcommand) {
            case 'save':
                await this.savePlaylist(interaction, userPlaylistsDir);
                break;
            case 'load':
                await this.loadPlaylist(interaction, userPlaylistsDir);
                break;
            case 'list':
                await this.listPlaylists(interaction, userPlaylistsDir);
                break;
            case 'delete':
                await this.deletePlaylist(interaction, userPlaylistsDir);
                break;
        }
    },

    async savePlaylist(interaction, userPlaylistsDir) {
        const { initGuildMusicData } = require('../utils/musicUtils');
        const guildData = initGuildMusicData(interaction.guild.id);
        
        if (guildData.queue.length === 0) {
            return interaction.reply('❌ Queue trống! Không có gì để lưu.');
        }

        const playlistName = interaction.options.getString('name');
        const playlistPath = path.join(userPlaylistsDir, `${playlistName}.json`);

        const playlistData = {
            name: playlistName,
            songs: guildData.queue,
            createdAt: new Date().toISOString(),
            totalSongs: guildData.queue.length
        };

        try {
            await fs.writeFile(playlistPath, JSON.stringify(playlistData, null, 2));
            interaction.reply(`💾 Đã lưu playlist "${playlistName}" với ${guildData.queue.length} bài hát!`);
        } catch (error) {
            console.error('Lỗi khi lưu playlist:', error);
            interaction.reply('❌ Lỗi khi lưu playlist!');
        }
    },

    async loadPlaylist(interaction, userPlaylistsDir) {
        const playlistName = interaction.options.getString('name');
        const playlistPath = path.join(userPlaylistsDir, `${playlistName}.json`);

        try {
            const data = await fs.readFile(playlistPath, 'utf8');
            const playlistData = JSON.parse(data);

            const { initGuildMusicData, playMusic } = require('../utils/musicUtils');
            const guildData = initGuildMusicData(interaction.guild.id);

            // Thêm các bài hát vào queue
            guildData.queue.push(...playlistData.songs);

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

    async listPlaylists(interaction, userPlaylistsDir) {
        try {
            const files = await fs.readdir(userPlaylistsDir);
            const playlists = files.filter(file => file.endsWith('.json'));

            if (playlists.length === 0) {
                return interaction.reply('📂 Bạn chưa có playlist nào được lưu!');
            }

            const playlistInfo = [];
            for (const file of playlists) {
                try {
                    const data = await fs.readFile(path.join(userPlaylistsDir, file), 'utf8');
                    const playlist = JSON.parse(data);
                    playlistInfo.push(`**${playlist.name}** - ${playlist.totalSongs} bài hát`);
                } catch (error) {
                    // Skip invalid files
                }
            }

            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('📂 Playlist đã lưu')
                .setDescription(playlistInfo.join('\n') || 'Không có playlist hợp lệ')
                .setFooter({ text: 'Sử dụng /playlist-save load <tên> để phát playlist' });

            interaction.reply({ embeds: [embed] });

        } catch (error) {
            interaction.reply('📂 Bạn chưa có playlist nào được lưu!');
        }
    },

    async deletePlaylist(interaction, userPlaylistsDir) {
        const playlistName = interaction.options.getString('name');
        const playlistPath = path.join(userPlaylistsDir, `${playlistName}.json`);

        try {
            await fs.unlink(playlistPath);
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
