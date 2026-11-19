require('dotenv').config();
const { setTimeout: delay } = require('node:timers/promises');
const { Client, GatewayIntentBits, Partials, REST, Routes, Events, MessageFlags } = require('discord.js');
const { loadCommands, getCommandsData } = require('./utils/commandLoader');
const { isFeatureEnabled, isDisabledComponent } = require('./utils/features');
const { checkDNSConnection } = require('./utils/youtubeUtils');
const { isGuildAllowed, getAllowedGuilds, logGuildInfo } = require('./utils/guildUtils');
const { commandNeedsVoice, getVoiceAccessError } = require('./utils/voiceAccess');
const { musicData, disconnectMusic } = require('./utils/musicUtils');
const { createHealthServer, startHealthServer, watchLauncher } = require('./utils/runtime');
const priceSnapshot = require('./utils/cs2PriceSnapshot');
const blueGemPrices = require('./utils/cs2BlueGemPrices');
const database = require('./utils/database');
const { createAdminHandler } = require('./utils/adminWeb');
const { createPlayerHandler } = require('./utils/playerWeb');

const managementEnabled = isFeatureEnabled('serverManagement');
const greetingsEnabled = managementEnabled && require('./utils/memberGreetings').memberGreetingsEnabled();
const client = new Client({
    allowedMentions: { parse: [], repliedUser: false },
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        ...(greetingsEnabled ? [GatewayIntentBits.GuildMembers] : [])
    ],
    partials: [Partials.Message, Partials.Channel, ...(greetingsEnabled ? [Partials.GuildMember] : [])],
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

const commands = loadCommands();
let shuttingDown = false;
const httpHandlers = [
    createAdminHandler({ client, commands, isShuttingDown: () => shuttingDown }),
    createPlayerHandler({ client, isShuttingDown: () => shuttingDown, sessionStore: database })
].filter(Boolean);
const healthServer = createHealthServer(client, {
    handler: async (req, res) => { for (const handler of httpHandlers) if (await handler(req, res)) return true; return false; }
});
let stopWatching = () => {};
let stopAnnouncements = () => {};

function restoreHomBattles(guild) {
    void commands.get('hom').restoreBattleResults(guild)
        .catch(error => console.error('Lỗi khôi phục kết quả Battle:', error.message));
}

client.once(Events.ClientReady ?? 'ready', async () => {
    console.log('🎵 ' + client.user.tag + ' đã sẵn sàng phát nhạc!');
    if (managementEnabled) stopAnnouncements = require('./utils/announcements').startAnnouncementScheduler(client);
    for (const guild of client.guilds.cache.values()) {
        if (guild.available && isGuildAllowed(guild.id)) {
            if (managementEnabled) void require('./utils/tempRooms').reconcileRooms(guild).catch(error => console.error('Lỗi khôi phục phòng thoại tạm:', error.message));
            void commands.get('tiembanh').resume(guild).catch(error => console.error('Lỗi khôi phục bàn Tiệm Bánh Mây:', error.message));
            restoreHomBattles(guild);
        }
    }

    try {
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        const data = getCommandsData(commands);
        const guildIds = getAllowedGuilds();
        let registered = 0;
        for (const guildId of guildIds) {
            if (shuttingDown) return;
            try {
                await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId), { body: data });
                registered++;
                console.log('✅ Đã đăng ký commands cho guild: ' + guildId);
            } catch (error) {
                console.error('❌ Lỗi đăng ký commands cho guild ' + guildId + ':', error.message);
            }
        }
        console.log('Slash commands: ' + registered + '/' + guildIds.length + ' server đăng ký thành công.');
        logGuildInfo(client);
    } catch (error) {
        console.error('Lỗi đăng ký commands:', error.message);
    }
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isRepliable()) return;
    if (shuttingDown) {
        await interaction.reply({ content: 'Bot đang khởi động lại. Bạn thử lại sau vài giây nhé.', flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
    }
    try {
        if (isDisabledComponent(interaction.customId)) {
            return await interaction.reply({ content: '❌ Tiện ích này không còn khả dụng. Dùng /help để xem tính năng hiện tại.', flags: MessageFlags.Ephemeral });
        }
        if (interaction.isButton() && interaction.customId.startsWith('mg_roomreq_')) {
            return await commands.get('room-request').button(interaction);
        }
        if (!isGuildAllowed(interaction.guildId)) {
            return await interaction.reply({ content: '❌ Bot không được phép hoạt động trên server này!', flags: MessageFlags.Ephemeral });
        }
        if (interaction.isChatInputCommand()) {
            const command = commands.get(interaction.commandName);
            if (!command) return await interaction.reply({ content: '❌ Lệnh này không còn khả dụng. Dùng /help để xem lệnh hiện tại.', flags: MessageFlags.Ephemeral });
            if (commandNeedsVoice(interaction)) {
                const error = getVoiceAccessError(interaction.member, musicData.get(interaction.guildId));
                if (error) return await interaction.reply({ content: error, flags: MessageFlags.Ephemeral });
            }
            await command.execute(interaction);
        } else if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'mg_hom_select' || interaction.customId.startsWith('mg_hom_battle-') ||
                interaction.customId.startsWith('mg_hom_upgrade:') ||
                interaction.customId.startsWith('mg_hom_inventory-select_') ||
                interaction.customId.startsWith('mg_hom_inventory-sort_') ||
                interaction.customId.startsWith('mg_hom_market-select_') ||
                interaction.customId.startsWith('mg_hom_tradeup-sort_') ||
                interaction.customId.startsWith('mg_hom_tradeup-group_') || interaction.customId.startsWith('mg_hom_tradeup-items_')) {
                await commands.get('hom').select(interaction);
            }
            else await require('./handlers/interactionHandler').handleStringSelectMenu(interaction);
        } else if (interaction.isButton()) {
            const id = interaction.customId;
            if (id.startsWith('mg_room_')) await commands.get('room').button(interaction);
            else if (id.startsWith('mg_case_')) await commands.get('cases').button(interaction);
            else if (id === 'mg_ticket_open' || id === 'mg_ticket_close') await commands.get('ticket').button(interaction);
            else if (id.startsWith('mg_lfg_')) await commands.get('lfg').button(interaction);
            else if (id.startsWith('mg_suggest_')) await commands.get('suggest').button(interaction);
            else if (id.startsWith('mg_taixiu_')) await commands.get('tiembanh').button(interaction);
            else if (id.startsWith('mg_hom_')) await commands.get('hom').button(interaction);
            else if (id.startsWith('mg_announce_')) await commands.get('announce').button(interaction);
            else if (id === 'mg_greeting_preview') await commands.get('setup').greetingPreview(interaction);
            else await require('./handlers/interactionHandler').handleButton(interaction);
        } else if (interaction.isModalSubmit() && interaction.customId.startsWith('mg_roomform_')) {
            await commands.get('room').modal(interaction);
        } else if (interaction.isModalSubmit() && interaction.customId.startsWith('mg_greeting_text_')) {
            await commands.get('setup').saveGreetingText(interaction);
        } else if (interaction.isModalSubmit() && interaction.customId.startsWith('mg_taixiu_bet_')) {
            await commands.get('tiembanh').modal(interaction);
        } else if (interaction.isModalSubmit() && (interaction.customId.startsWith('mg_hom_order_') ||
            interaction.customId.startsWith('mg_hom_open-form_') ||
            interaction.customId.startsWith('mg_hom_upgrade:') ||
            interaction.customId.startsWith('mg_hom_battle-') ||
            interaction.customId.startsWith('mg_hom_market-price_') || interaction.customId.startsWith('mg_hom_market-filter-form_') ||
            interaction.customId.startsWith('mg_hom_terminal-cap-form_'))) {
            await commands.get('hom').modal(interaction);
        }
    } catch (error) {
        console.error('Lỗi xử lý tương tác:', error.message);
        const payload = { content: '❌ Đã xảy ra lỗi khi xử lý yêu cầu!', flags: MessageFlags.Ephemeral };
        if (interaction.deferred && (interaction.isChatInputCommand() || interaction.isModalSubmit())) {
            await interaction.editReply({ content: payload.content }).catch(() => {});
        } else {
            const method = interaction.replied || interaction.deferred ? 'followUp' : 'reply';
            await interaction[method](payload).catch(() => {});
        }
    }
});

client.on(Events.GuildAvailable, guild => {
    if (shuttingDown || !client.isReady() || !isGuildAllowed(guild.id)) return;
    if (managementEnabled) void require('./utils/tempRooms').reconcileRooms(guild).catch(error => console.error('Lỗi khôi phục phòng thoại tạm:', error.message));
    void commands.get('tiembanh').resume(guild).catch(error => console.error('Lỗi khôi phục bàn Tiệm Bánh Mây:', error.message));
    restoreHomBattles(guild);
});

function recoverTaixiuBoard(guild, ids) {
    if (shuttingDown || !guild || !isGuildAllowed(guild.id)) return;
    void commands.get('tiembanh').recoverDeleted(guild, ids)
        .catch(error => console.error('Lỗi khôi phục tin nhắn Tiệm Bánh Mây:', error.message));
}

client.on(Events.MessageDelete, message => recoverTaixiuBoard(message.guild, new Set([message.id])));
client.on(Events.MessageBulkDelete, (messages, channel) => recoverTaixiuBoard(channel.guild, new Set(messages.keys())));

if (managementEnabled) {
    client.on(Events.VoiceStateUpdate, (oldState, newState) => {
        if (shuttingDown || !isGuildAllowed(newState.guild.id)) return;
        void require('./utils/tempRooms').onVoiceChange(oldState, newState).catch(error => console.error('Lỗi quản lý kênh thoại:', error.message));
    });
}

if (greetingsEnabled) {
    const greet = (member, joined) => {
        if (!shuttingDown) {
            void require('./utils/memberGreetings').sendMemberGreeting(member, joined).catch(error => console.error('Lỗi gửi lời chào thành viên:', error.message));
        }
    };
    client.on(Events.GuildMemberAdd, member => greet(member, true));
    client.on(Events.GuildMemberRemove, member => greet(member, false));
}

// Cộng xu của chủ bot qua tin nhắn riêng.
client.on(Events.MessageCreate, async message => {
    if (shuttingDown || message.author.bot || !client.user || message.guildId) return;
    try {
        await commands.get('tiembanh').handlePrivateMessage(message);
    } catch (error) {
        console.error('Lỗi xử lý yêu cầu Tiệm Bánh Mây qua tin nhắn riêng:', error.message);
        await message.reply('❌ Chưa thể xác nhận yêu cầu. Hãy kiểm tra ví trước khi gửi lại.').catch(() => {});
    }
});

client.on(Events.Error, error => console.error('Discord client error:', error.message));
client.on(Events.ShardError, error => console.error('Discord gateway error:', error.message));
process.on('unhandledRejection', error => console.error('Unhandled rejection:', error?.message ?? String(error)));

async function shutdown(reason, code = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    stopWatching();
    stopAnnouncements();
    console.log('Dừng bot: ' + reason);
    const closeHealth = new Promise(resolve => healthServer.close(resolve));
    healthServer.closeAllConnections();
    await Promise.race([commands.get('hom')?.waitForOpenings({ finishBattles: true }), delay(20_000, undefined, { ref: false })]);
    const timeout = setTimeout(() => process.exit(code), 4000);
    await Promise.allSettled([closeHealth, priceSnapshot.stop(), blueGemPrices.stop(), ...Array.from(musicData.values(), data => disconnectMusic(data))]);
    await client.destroy();
    await database.close();
    clearTimeout(timeout);
    process.exit(code);
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
    process.on(signal, () => void shutdown(signal));
}

async function start() {
    const port = Number(process.env.PORT || 3001);
    const host = process.env.HTTP_HOST?.trim() || undefined;
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        console.error('PORT phải là số từ 0 đến 65535.');
        return shutdown('cấu hình PORT không hợp lệ', 78);
    }
    stopWatching = watchLauncher(process.env.DISCORD_BOT_LAUNCHER_PID, () => void shutdown('launcher đã dừng'));
    try {
        await database.initialize();
    } catch (error) {
        console.error('Không kết nối được PostgreSQL:', error.code ?? error.message);
        return shutdown('kiểm tra DATABASE_URL và dịch vụ PostgreSQL', 78);
    }
    try {
        await startHealthServer(healthServer, port, 3000, host);
    } catch (error) {
        if (error.code === 'EADDRINUSE') {
            console.error('Cổng ' + port + ' đang được sử dụng. Hãy kiểm tra bản bot cũ trong Task Scheduler hoặc dùng netstat -ano để xác định tiến trình giữ cổng.');
            return shutdown('trùng cổng', 78);
        }
        console.error('Không mở được health server:', error.message);
        return shutdown('lỗi health server', 78);
    }
    if (shuttingDown) return;
    healthServer.on('error', error => {
        console.error('Health server error:', error.message);
        void shutdown('lỗi health server', 1);
    });
    console.log('🌐 Health check server running on port ' + healthServer.address().port);
    if (process.env.ADMIN_ENABLED === 'true') console.log('🛠️ Trang quản trị đã bật tại ' + process.env.ADMIN_ORIGIN + '/admin/');
    if (process.env.PLAYER_ENABLED === 'true') console.log('🎁 Web mở hòm đã bật tại ' + (process.env.PLAYER_ORIGIN || process.env.ADMIN_ORIGIN) + '/play/');
    await priceSnapshot.start();
    await blueGemPrices.start();
    if (shuttingDown) return;
    void checkDNSConnection().catch(error => console.warn('DNS check:', error.message));

    for (let attempt = 1; attempt <= 3 && !shuttingDown; attempt++) {
        try {
            console.log('🔄 Đang kết nối Discord (' + attempt + '/3)...');
            await client.login(process.env.DISCORD_TOKEN);
            return;
        } catch (error) {
            console.error('Lỗi kết nối Discord:', error.message);
            if (error.code === 'TokenInvalid') return shutdown('kiểm tra DISCORD_TOKEN', 78);
            if (/used disallowed intents/i.test(error.message)) {
                const reason = greetingsEnabled ? 'kiểm tra Server Members Intent trong Discord Developer Portal'
                    : 'kiểm tra cấu hình Gateway Intents trong Discord Developer Portal';
                return shutdown(reason, 78);
            }
            if (attempt === 3) return shutdown('không kết nối được Discord', 1);
            await delay(5000);
        }
    }
}

void start().catch(error => {
    console.error('Lỗi khởi động bot:', error.message);
    void shutdown('khởi động thất bại', 1);
});
