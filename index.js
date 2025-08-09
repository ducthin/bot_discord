const { Client, GatewayIntentBits, REST, Routes, EmbedBuilder, MessageFlags } = require('discord.js');
const { loadCommands, getCommandsData } = require('./utils/commandLoader');
const { checkDNSConnection } = require('./utils/youtubeUtils');
require('dotenv').config();

// Kiểm tra DNS ngay khi khởi động
async function initializeDNS() {
    console.log('🔍 Checking DNS connection...');
    const dnsOk = await checkDNSConnection();
    if (!dnsOk) {
        console.log('⚠️ DNS issues detected, but continuing...');
    }
}

// Gọi DNS check
initializeDNS();

// Health check server để tránh sleep trên Render
const express = require('express');
const app = express();

app.get('/', (req, res) => {
    res.json({
        status: 'online',
        bot: client.user ? client.user.tag : 'Starting...',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        guilds: client.guilds ? client.guilds.cache.size : 0,
        uptime: process.uptime()
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🌐 Health check server running on port ${PORT}`);
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates
    ],
    // Thêm timeout và retry options
    ws: {
        version: 10,
        compress: true,
    },
    // Thêm DNS fallback
    rest: {
        timeout: 30000,
        retries: 3
    }
});

// Load tất cả commands
const commands = loadCommands();

client.once('ready', async () => {
    console.log(`🎵 ${client.user.tag} đã sẵn sàng phát nhạc!`);
    
    // Đăng ký slash commands
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    
    try {
        console.log('Đang đăng ký slash commands...');
        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: getCommandsData() }
        );
        console.log('Đã đăng ký slash commands thành công!');
    } catch (error) {
        console.error('Lỗi đăng ký commands:', error);
    }
});

client.on('interactionCreate', async interaction => {
    // Xử lý slash commands
    if (interaction.isChatInputCommand()) {
        const command = commands.get(interaction.commandName);

        if (!command) {
            console.error(`Không tìm thấy command ${interaction.commandName}.`);
            return;
        }

        try {
            await command.execute(interaction);
        } catch (error) {
            console.error('Lỗi khi thực thi command:', error);
            
            const errorMessage = '❌ Đã xảy ra lỗi khi thực thi command!';
            
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: errorMessage, flags: MessageFlags.Ephemeral });
            } else {
                await interaction.reply({ content: errorMessage, flags: MessageFlags.Ephemeral });
            }
        }
    }
    
    // Xử lý button interactions
    if (interaction.isButton()) {
        // Kiểm tra nếu interaction đã expired hoặc invalid
        if (!interaction.isRepliable()) {
            console.log('⚠️ Button interaction đã expired, bỏ qua...');
            return;
        }
        
        const { initGuildMusicData, playMusic, removeButtons } = require('./utils/musicUtils');
        const guildData = initGuildMusicData(interaction.guild.id);
        
        try {
            switch (interaction.customId) {
                case 'pause_music':
                    if (!guildData.player) {
                        return interaction.reply({ content: '❌ Không có nhạc nào đang phát!', flags: MessageFlags.Ephemeral });
                    }
                    guildData.player.pause();
                    interaction.reply({ content: '⏸️ Đã tạm dừng nhạc!', flags: MessageFlags.Ephemeral });
                    break;

                case 'resume_music':
                    if (!guildData.player) {
                        return interaction.reply({ content: '❌ Không có nhạc nào đang phát!', flags: MessageFlags.Ephemeral });
                    }
                    guildData.player.unpause();
                    interaction.reply({ content: '▶️ Đã tiếp tục phát nhạc!', flags: MessageFlags.Ephemeral });
                    break;

                case 'skip_music':
                    if (!guildData.player || guildData.queue.length === 0) {
                        return interaction.reply({ content: '❌ Không có nhạc nào để bỏ qua!', flags: MessageFlags.Ephemeral });
                    }
                    
                    // Lưu thông tin bài hiện tại trước khi skip
                    const currentSongTitle = guildData.currentSong ? guildData.currentSong.title : 'Unknown';
                    
                    // Xóa buttons ngay lập tức
                    if (guildData.currentSong && guildData.currentMessage) {
                        await removeButtons(guildData, currentSongTitle);
                    }
                    
                    // Dừng player (sẽ trigger handleSongEnd)
                    guildData.player.stop();
                    
                    interaction.reply({ content: '⏭️ Đã bỏ qua bài hát!', flags: MessageFlags.Ephemeral });
                    break;

                case 'stop_music':
                    if (!guildData.player) {
                        return interaction.reply({ content: '❌ Không có nhạc nào đang phát!', flags: MessageFlags.Ephemeral });
                    }
                    // Xóa buttons của bài hiện tại
                    if (guildData.currentSong) {
                        await removeButtons(guildData, guildData.currentSong.title);
                    }
                    guildData.queue = [];
                    guildData.player.stop();
                    interaction.reply({ content: '⏹️ Đã dừng phát nhạc và xóa danh sách!', flags: MessageFlags.Ephemeral });
                    break;

                case 'show_queue':
                    if (guildData.queue.length === 0) {
                        return interaction.reply({ content: '📭 danh sách trống!', flags: MessageFlags.Ephemeral });
                    }

                    const queueList = guildData.queue.slice(0, 10).map((song, index) => {
                        const status = index === 0 ? '🎵 ' : `${index + 1}. `;
                        return `${status}**${song.title}** - ${song.duration}`;
                    }).join('\n');

                    const queueEmbed = new EmbedBuilder()
                        .setColor('#0099ff')
                        .setTitle('🎵 Danh sách phát')
                        .setDescription(queueList)
                        .setFooter({ text: `Tổng cộng ${guildData.queue.length} bài hát` });

                    interaction.reply({ embeds: [queueEmbed], flags: MessageFlags.Ephemeral });
                    break;

                case 'show_lyrics':
                    if (guildData.queue.length === 0 || !guildData.currentSong) {
                        return interaction.reply({ content: '❌ Không có bài hát nào đang phát!', flags: MessageFlags.Ephemeral });
                    }

                    const { getLyrics } = require('./utils/lyricsUtils');
                    
                    // Defer reply vì lyrics có thể mất thời gian fetch
                    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                    
                    try {
                        const lyrics = await getLyrics(guildData.currentSong.title);
                        
                        if (!lyrics) {
                            return interaction.editReply({ content: '❌ Không tìm thấy lời bài hát!' });
                        }

                        const lyricsEmbed = new EmbedBuilder()
                            .setColor('#ff9900')
                            .setTitle(`🎤 ${guildData.currentSong.title}`)
                            .setDescription(lyrics.length > 4000 ? lyrics.substring(0, 4000) + '...' : lyrics)
                            .setFooter({ text: 'Lời bài hát từ Genius' });

                        interaction.editReply({ embeds: [lyricsEmbed] });
                    } catch (error) {
                        console.error('Lỗi khi lấy lyrics:', error);
                        interaction.editReply({ content: '❌ Đã xảy ra lỗi khi tìm lời bài hát!' });
                    }
                    break;

                default:
                    interaction.reply({ content: '❌ Button không hợp lệ!', flags: MessageFlags.Ephemeral });
            }
        } catch (error) {
            console.error('Lỗi khi xử lý button:', error);
            
            // Kiểm tra nếu interaction vẫn có thể reply
            if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
                try {
                    await interaction.reply({ content: '❌ Đã xảy ra lỗi!', flags: MessageFlags.Ephemeral });
                } catch (replyError) {
                    console.log('⚠️ Không thể reply interaction (có thể đã expired):', replyError.message);
                }
            }
        }
    }
});

// Error handling cho connection issues
client.on('error', (error) => {
    console.error('Discord client error:', error);
    if (error.code === 'ENOTFOUND') {
        console.log('🔄 Trying to reconnect in 5 seconds...');
        setTimeout(() => {
            client.login(process.env.DISCORD_TOKEN).catch(console.error);
        }, 5000);
    }
});

client.on('shardError', (error) => {
    console.error('A websocket connection encountered an error:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.log('Unhandled Rejection at:', promise, 'reason:', reason);
});

// DNS fallback function
async function connectWithRetry() {
    const maxRetries = 3;
    for (let i = 0; i < maxRetries; i++) {
        try {
            console.log(`🔄 Attempting to connect to Discord... (${i + 1}/${maxRetries})`);
            await client.login(process.env.DISCORD_TOKEN);
            console.log('✅ Successfully connected to Discord!');
            break;
        } catch (error) {
            console.error(`❌ Connection attempt ${i + 1} failed:`, error.message);
            if (i === maxRetries - 1) {
                console.error('🚫 All connection attempts failed. Please check your internet connection and Discord token.');
                process.exit(1);
            }
            console.log(`⏳ Waiting 5 seconds before retry...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

// Start connection with retry
connectWithRetry();
