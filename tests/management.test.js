const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
// Exercise the preserved management implementation in its explicitly enabled mode.
jest.mock('../config/features.json', () => ({ ai: false, serverManagement: true }));
const { ChannelType, Collection, PermissionFlagsBits, PermissionsBitField, OverwriteType, MessageFlags, RESTJSONErrorCodes } = require('discord.js');
const store = require('../utils/managementStore');
const { onVoiceChange, reconcileRooms, toggleRoomLock } = require('../utils/tempRooms');
const { sendMemberGreeting } = require('../utils/memberGreetings');
const setup = require('../commands/setup');
const report = require('../commands/report');
const cases = require('../commands/cases');
const room = require('../commands/room');
const ticket = require('../commands/ticket');
const summary = require('../commands/server-summary');
const lfg = require('../commands/lfg');
const roomRequest = require('../commands/room-request');
const suggest = require('../commands/suggest');
const announce = require('../commands/announce');
const taixiu = require('../commands/taixiu');
const hom = require('../commands/hom');
const cs2Catalog = require('../assets/cs2-cases.json');
const cs2Reel = require('../utils/cs2Reel');
const cs2InventoryArt = require('../utils/cs2InventoryArt');
const cs2Voice = require('../utils/cs2Voice');
const cs2Market = require('../utils/cs2Market');
const { sendDueAnnouncements } = require('../utils/announcements');

const { ViewChannel, Connect, Speak, SendMessages, SendMessagesInThreads } = PermissionFlagsBits;
let root;
let disk;

function quoteFor(name, priceVnd) {
    return { priceVnd, observedAt: Date.now(), expiresAt: Date.now() + 300_000, source: 'buff', url: cs2Market.BUFF_MARKET_URL };
}

function testMarketPrice(name) {
    return name === 'Kilowatt Case' ? quoteFor(name, 1500) : null;
}

beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-management-'));
    disk = store.createManagementStore(root);
    jest.spyOn(store, 'read').mockImplementation(disk.read);
    jest.spyOn(store, 'transact').mockImplementation(disk.transact);
    jest.spyOn(cs2Reel, 'warmCaseReel').mockImplementation(() => {});
    jest.spyOn(cs2Reel, 'renderResultArtwork').mockResolvedValue(null);
    jest.spyOn(cs2Market, 'peekMarketQuote').mockImplementation(testMarketPrice);
    jest.spyOn(cs2Market, 'peekMarketDisplay').mockImplementation((name, options) => {
        const quote = cs2Market.peekMarketQuote(name, options);
        return { status: quote ? 'fresh' : 'snapshot-missing', quote };
    });
});

afterEach(async () => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    for (const file of await fs.readdir(root)) await fs.unlink(path.join(root, file));
    await fs.rmdir(root);
});

function fixture() {
    const all = () => new PermissionsBitField(PermissionsBitField.All);
    const none = () => new PermissionsBitField();
    const staff = { id: '5' };
    const admin = { id: '2', permissions: all(), roles: { highest: { comparePositionTo: () => 1 } } };
    const bot = { id: '3', user: { bot: true }, permissions: all() };
    const everyone = { id: '1' };
    const guild = {
        id: '1', ownerId: admin.id, name: 'Test server', available: true,
        channels: { cache: new Map() },
        roles: { everyone, cache: new Map([[staff.id, staff], [everyone.id, everyone]]) },
        members: { me: bot, cache: new Map(), fetch: jest.fn() }
    };
    const createChannel = (id, type, isPrivate = false) => {
        const channel = {
            id, type, guild, userLimit: 0, members: new Map(),
            permissionsFor: member => isPrivate && member === everyone ? none() : all(),
            permissionOverwrites: { cache: new Collection(), edit: jest.fn(), set: jest.fn() },
            send: jest.fn().mockResolvedValue({ id: '99' }), messages: { edit: jest.fn().mockResolvedValue({ id: '99' }) },
            delete: jest.fn(async () => guild.channels.cache.delete(id)),
            setName: jest.fn(), setUserLimit: jest.fn()
        };
        guild.channels.cache.set(id, channel);
        return channel;
    };
    const createMember = id => {
        const member = {
            id, displayName: 'User ' + id, user: { id, bot: false }, voice: {},
            permissions: none(), roles: { cache: new Map(), highest: {} }, moderatable: true,
            timeout: jest.fn(), isCommunicationDisabled: () => false, send: jest.fn()
        };
        member.voice.setChannel = jest.fn(async channel => {
            member.voice.channel?.members.delete(id);
            member.voice.channel = channel;
            member.voice.channelId = channel?.id ?? null;
            channel?.members.set(id, member);
        });
        guild.members.cache.set(id, member);
        return member;
    };
    guild.channels.create = jest.fn(async options => createChannel('66', options.type));
    const interaction = (member = admin, overrides = {}) => ({
        guild, guildId: guild.id, member, user: { id: member.id },
        reply: jest.fn(), deferReply: jest.fn(), editReply: jest.fn().mockResolvedValue(undefined), deferUpdate: jest.fn(), update: jest.fn(), followUp: jest.fn(),
        ...overrides
    });
    return { guild, staff, admin, bot, createChannel, createMember, interaction };
}

test('management settings persist and serialize writes separately per guild', async () => {
    await Promise.all(Array.from({ length: 4 }, () => disk.transact('1', async (state, save) => {
        state.activity.roomsOpened++;
        await save();
    })));
    const reopened = store.createManagementStore(root);
    expect((await reopened.read('1')).activity.roomsOpened).toBe(4);
    expect((await reopened.read('2')).activity.roomsOpened).toBe(0);
    await expect(reopened.read('../1')).rejects.toThrow('Invalid guild ID');
});

test('lobby creates one tracked room, transfers ownership and only deletes it once empty', async () => {
    jest.useFakeTimers();
    const { guild, createChannel, createMember } = fixture();
    const lobby = createChannel('10', ChannelType.GuildVoice);
    const category = createChannel('11', ChannelType.GuildCategory);
    const owner = createMember('12');
    const guest = createMember('13');
    await disk.transact('1', async (state, save) => {
        state.settings.rooms = { lobbyId: lobby.id, categoryId: category.id };
        state.settings.trackVoice = true;
        await save();
    });
    await owner.voice.setChannel(lobby);
    await onVoiceChange({ channelId: null }, { guild, member: owner, channelId: lobby.id });
    const created = guild.channels.cache.get('66');
    expect(owner.voice.channel).toBe(created);
    expect(guild.channels.create).toHaveBeenCalledWith(expect.objectContaining({ type: ChannelType.GuildVoice, parent: category.id }));
    await onVoiceChange({ channelId: lobby.id }, { guild, member: owner, channelId: created.id });
    await guest.voice.setChannel(created);
    await owner.voice.setChannel(null);
    await onVoiceChange({ channelId: created.id }, { guild, member: owner, channelId: null });
    expect((await disk.read('1')).rooms[created.id].ownerId).toBe(guest.id);
    expect(created.delete).not.toHaveBeenCalled();

    await guest.voice.setChannel(null);
    await reconcileRooms(guild);
    await jest.advanceTimersByTimeAsync(7000);
    await disk.transact('1', async () => {});
    const saved = await disk.read('1');
    expect(created.delete).toHaveBeenCalledTimes(1);
    expect(lobby.delete).not.toHaveBeenCalled();
    expect(saved.rooms).toEqual({});
    expect(saved.activity).toMatchObject({ roomsOpened: 1, roomJoins: 1, voiceJoins: {} });
});

test('room lock removes Connect grants and restores them without touching other permission bits', async () => {
    const { guild, bot, createChannel } = fixture();
    const channel = createChannel('66', ChannelType.GuildVoice);
    channel.permissionOverwrites.cache.set('17', {
        id: '17', type: OverwriteType.Role, allow: new PermissionsBitField([Connect, Speak]), deny: new PermissionsBitField()
    });
    channel.permissionOverwrites.set.mockImplementation(async overwrites => {
        channel.permissionOverwrites.cache = new Collection(overwrites.map(overwrite => [overwrite.id, overwrite]));
    });
    const record = {};
    const save = jest.fn();
    expect(await toggleRoomLock(channel, record, save)).toBe(true);
    expect(channel.permissionOverwrites.cache.get(guild.id).deny.has(Connect)).toBe(true);
    expect(channel.permissionOverwrites.cache.get('17').allow.has(Connect)).toBe(false);
    expect(channel.permissionOverwrites.cache.get('17').allow.has(Speak)).toBe(true);
    expect(channel.permissionOverwrites.cache.get(bot.id).allow.has(Connect)).toBe(true);
    expect(await toggleRoomLock(channel, record, save)).toBe(false);
    expect(channel.permissionOverwrites.cache.get('17').allow.has([Connect, Speak])).toBe(true);
    expect(channel.permissionOverwrites.cache.has(guild.id)).toBe(false);
    expect(record.lock).toBeUndefined();
});

test('recovery retains a room when a connected voice state has no cached member yet', async () => {
    jest.useFakeTimers();
    const { guild, createChannel } = fixture();
    const voice = createChannel('66', ChannelType.GuildVoice);
    guild.voiceStates = { cache: new Map([['12', { channelId: voice.id, member: null }]]) };
    await disk.transact('1', async (state, save) => {
        state.rooms[voice.id] = { ownerId: '12' };
        await save();
    });
    await reconcileRooms(guild);
    await jest.advanceTimersByTimeAsync(7000);
    expect(voice.delete).not.toHaveBeenCalled();
    expect((await disk.read('1')).rooms[voice.id].ownerId).toBe('12');
});

test('only the active owner can open a room edit dialog or change room settings', async () => {
    const { createChannel, createMember, interaction } = fixture();
    const voice = createChannel('66', ChannelType.GuildVoice);
    const owner = createMember('12');
    const guest = createMember('13');
    await owner.voice.setChannel(voice);
    await guest.voice.setChannel(voice);
    await disk.transact('1', async (state, save) => {
        state.rooms[voice.id] = { ownerId: owner.id };
        await save();
    });
    const button = interaction(owner, { customId: 'mg_room_limit_66', showModal: jest.fn() });
    await room.button(button);
    expect(button.showModal.mock.calls[0][0].toJSON().custom_id).toBe('mg_roomform_limit_66');
    const form = { customId: 'mg_roomform_limit_66', fields: { getTextInputValue: () => '8' } };
    await room.modal(interaction(guest, form));
    expect(voice.setUserLimit).not.toHaveBeenCalled();
    await room.modal(interaction(owner, form));
    expect(voice.setUserLimit).toHaveBeenCalledWith(8);
    const lock = { customId: 'mg_room_lock_66' };
    await room.button(interaction(owner, lock));
    await room.button(interaction(owner, lock));
    expect(voice.permissionOverwrites.set).toHaveBeenCalledTimes(1);
});

test('reports stay private and only moderators can act on a case', async () => {
    const { guild, admin, createChannel, createMember, interaction } = fixture();
    const publicChannel = createChannel('10', ChannelType.GuildText);
    const privateChannel = createChannel('11', ChannelType.GuildText, true);
    const author = createMember('12');
    const target = createMember('13');
    guild.members.fetch.mockResolvedValue(target);
    const settings = channel => ({ getSubcommand: () => 'reports', getChannel: () => channel });
    await setup.execute(interaction(admin, { options: settings(publicChannel) }));
    expect((await disk.read('1')).settings.reports).toBeUndefined();
    await setup.execute(interaction(admin, { options: settings(privateChannel) }));
    const command = interaction(author, { options: { getMember: () => target, getString: () => 'Nội dung riêng' } });
    await report.execute(command);
    expect(command.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(publicChannel.send).not.toHaveBeenCalled();
    expect(privateChannel.send.mock.calls[0][0].embeds[0].toJSON().description).toBe('Nội dung riêng');
    const timeout = { customId: 'mg_case_timeout_1' };
    await cases.button(interaction(author, timeout));
    expect(target.timeout).not.toHaveBeenCalled();
    await cases.button(interaction(admin, { customId: 'mg_case_claim_1' }));
    await cases.button(interaction(admin, timeout));
    await cases.button(interaction(admin, timeout));
    expect(target.timeout).toHaveBeenCalledTimes(1);
    expect(target.timeout).toHaveBeenCalledWith(600000, 'Xử lý hồ sơ #1');
    await cases.button(interaction(admin, { customId: 'mg_case_close_1' }));
    const saved = (await disk.read('1')).reports[1];
    expect(saved).toMatchObject({ claimedBy: admin.id, timeoutBy: admin.id, closedBy: admin.id });
});

test('ticket panel opens one restricted channel and only its owner or staff can close it', async () => {
    const { guild, staff, admin, createChannel, createMember, interaction } = fixture();
    const category = createChannel('10', ChannelType.GuildCategory);
    const panel = createChannel('11', ChannelType.GuildText);
    const owner = createMember('12');
    const outsider = createMember('13');
    await setup.execute(interaction(admin, { options: {
        getSubcommand: () => 'tickets', getChannel: name => name === 'category' ? category : panel, getRole: () => staff
    } }));
    const invoke = id => interaction(owner, { customId: 'mg_ticket_open', message: { id } });
    await ticket.button(invoke('old-panel'));
    expect(guild.channels.create).not.toHaveBeenCalled();
    await Promise.all([ticket.button(invoke('99')), ticket.button(invoke('99'))]);
    expect(guild.channels.create).toHaveBeenCalledTimes(1);
    const [options] = guild.channels.create.mock.calls[0];
    expect(options.permissionOverwrites).toContainEqual({ id: guild.id, type: OverwriteType.Role, deny: [ViewChannel] });
    expect(options.permissionOverwrites.find(overwrite => overwrite.id === owner.id).allow).toContain(ViewChannel);
    expect(options.permissionOverwrites.find(overwrite => overwrite.id === owner.id).deny).toContain(SendMessagesInThreads);
    expect(options.permissionOverwrites.find(overwrite => overwrite.id === staff.id).allow).toContain(SendMessages);
    const channel = guild.channels.cache.get('66');
    const close = { channel, channelId: channel.id, customId: 'mg_ticket_close' };
    await ticket.button(interaction(outsider, close));
    expect(channel.permissionOverwrites.edit).not.toHaveBeenCalled();
    await ticket.button(interaction(owner, close));
    expect(channel.permissionOverwrites.edit).toHaveBeenCalledWith(owner.id, { SendMessages: false, SendMessagesInThreads: false }, { type: OverwriteType.Member });
    expect(channel.delete).not.toHaveBeenCalled();
    expect((await disk.read('1')).tickets[channel.id].closedBy).toBe(owner.id);
});

test('summary counts joins, excludes bots, and shows only aggregate management counts', async () => {
    const { guild, bot, admin, createChannel, createMember, interaction } = fixture();
    const voice = createChannel('15', ChannelType.GuildVoice);
    const member = createMember('12');
    await setup.execute(interaction(admin, { options: { getSubcommand: () => 'activity', getBoolean: () => true } }));
    await onVoiceChange({ channelId: null }, { guild, member, channelId: voice.id });
    await onVoiceChange({ channelId: null }, { guild, member: bot, channelId: voice.id });
    await onVoiceChange({ channelId: voice.id }, { guild, member, channelId: voice.id });
    const command = interaction();
    await summary.execute(command);
    const fields = command.editReply.mock.calls[0][0].embeds[0].toJSON().fields;
    expect(fields.find(field => field.name.startsWith('Kênh thoại')).value).toBe('<#15> · 1 lượt');
    expect((await disk.read('1')).activity.voiceJoins).toEqual({ 15: 1 });
});

test('member greetings require an opt-in and keep the same channel by default', async () => {
    jest.replaceProperty(process, 'env', { ...process.env, GUILD_IDS: '1', ENABLE_MEMBER_GREETINGS: 'false' });
    const { guild, createChannel, createMember, interaction, admin } = fixture();
    const channel = createChannel('17', ChannelType.GuildText);
    guild.iconURL = () => 'https://example.com/server.png';
    guild.memberCount = 42;
    const member = {
        ...createMember('12'), guild,
        user: { id: '12', username: 'Listener', bot: false, displayAvatarURL: () => 'https://example.com/avatar.png' }
    };
    const options = { getSubcommand: () => 'welcome', getChannel: name => name === 'channel' ? channel : null };
    await setup.execute(interaction(admin, { options }));
    expect((await disk.read('1')).settings.welcome).toBeUndefined();

    process.env.ENABLE_MEMBER_GREETINGS = 'true';
    await setup.execute(interaction(admin, { options }));
    await sendMemberGreeting(member, true);
    await sendMemberGreeting(member, false);
    expect(channel.send).toHaveBeenCalledTimes(2);
    const [arrival, departure] = channel.send.mock.calls.map(([payload]) => {
        expect(payload.allowedMentions).toEqual({ parse: [] });
        return payload.embeds[0].toJSON();
    });
    expect(arrival).toMatchObject({
        title: '👋 Chào mừng bạn!',
        description: expect.stringContaining('<@12>'),
        author: { name: guild.name, icon_url: 'https://example.com/server.png' },
        thumbnail: { url: 'https://example.com/avatar.png' },
        footer: { text: '42 thành viên hiện tại' }
    });
    expect(departure).toMatchObject({
        title: '🌙 Hẹn gặp lại!',
        description: expect.stringContaining('**Listener** đã rời máy chủ')
    });
    expect(arrival.color).not.toBe(departure.color);

    await setup.execute(interaction(admin, { options: { getSubcommand: () => 'disable', getString: () => 'welcome' } }));
    await sendMemberGreeting(member, true);
    expect(channel.send).toHaveBeenCalledTimes(2);
});

test('farewells can use a separate channel and skip bots, unlisted guilds and inaccessible channels', async () => {
    jest.replaceProperty(process, 'env', { ...process.env, GUILD_IDS: '1', ENABLE_MEMBER_GREETINGS: 'true' });
    const { guild, admin, createChannel, interaction } = fixture();
    const welcome = createChannel('17', ChannelType.GuildText);
    const goodbye = createChannel('18', ChannelType.GuildText);
    goodbye.permissionsFor = () => new PermissionsBitField([ViewChannel, SendMessages, PermissionFlagsBits.ManageChannels]);
    const member = { guild, user: { id: '12', username: 'Listener', bot: false } };
    await setup.execute(interaction(admin, { options: {
        getSubcommand: () => 'welcome',
        getChannel: name => name === 'channel' ? welcome : goodbye
    } }));
    await sendMemberGreeting(member, false);
    await sendMemberGreeting({ ...member, user: { ...member.user, bot: true } }, true);
    await sendMemberGreeting({ ...member, guild: { id: '2' } }, true);
    expect(welcome.send).not.toHaveBeenCalled();
    expect(goodbye.send).toHaveBeenCalledTimes(1);
    expect(goodbye.send).toHaveBeenCalledWith({
        content: expect.stringContaining('Tạm biệt **Listener**'), allowedMentions: { parse: [] }
    });

    goodbye.permissionsFor = () => new PermissionsBitField(ViewChannel);
    await sendMemberGreeting(member, false);
    expect(goodbye.send).toHaveBeenCalledTimes(1);
});

test('greeting templates are editable per guild and apply to cards and plain text', async () => {
    jest.replaceProperty(process, 'env', { ...process.env, GUILD_IDS: '1,2', ENABLE_MEMBER_GREETINGS: 'true' });
    const { guild, admin, createChannel, createMember, interaction } = fixture();
    const original = createChannel('17', ChannelType.GuildText);
    const channel = createChannel('18', ChannelType.GuildText);
    guild.iconURL = () => null;
    guild.memberCount = 42;
    const member = { guild, user: { id: '12', username: 'Listener', displayAvatarURL: () => 'https://example.com/avatar.png' } };
    const openForm = async () => {
        const command = interaction(admin, { options: { getSubcommand: () => 'greeting-text' }, showModal: jest.fn() });
        await setup.execute(command);
        return command.showModal.mock.calls[0][0].toJSON();
    };
    const form = await openForm();
    const values = { welcome: 'Chào {member} đến {server}!\nNhà có {count} người.', goodbye: 'Tạm biệt {member}.' };
    const submitted = { customId: form.custom_id, fields: { getTextInputValue: key => values[key] } };
    await setup.saveGreetingText(interaction(createMember('13'), submitted));
    expect((await disk.read('1')).settings.greetingText).toBeUndefined();
    const submission = interaction(admin, submitted);
    await setup.saveGreetingText(submission);
    expect(submission.editReply.mock.calls[0][0].components[0].toJSON().components[0].label).toBe('Xem trước');
    expect((await disk.read('2')).settings.greetingText).toBeUndefined();

    for (const selected of [original, channel]) {
        await setup.execute(interaction(admin, { options: {
            getSubcommand: () => 'welcome', getChannel: name => name === 'channel' ? selected : null
        } }));
    }
    await sendMemberGreeting(member, true);
    expect(original.send).not.toHaveBeenCalled();
    const card = channel.send.mock.calls[0][0].embeds[0].toJSON();
    expect(card.description).toBe('Chào <@12> đến Test server!\nNhà có 42 người.');
    expect(card.title).toBe('👋 Chào mừng bạn!');
    const preview = interaction(admin, { user: member.user, options: { getSubcommand: () => 'greeting-preview' } });
    await setup.execute(preview);
    expect(preview.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(preview.editReply.mock.calls[0][0].embeds.map(embed => embed.toJSON().description))
        .toEqual([card.description, 'Tạm biệt Listener.']);
    expect(channel.send).toHaveBeenCalledTimes(1);
    channel.permissionsFor = () => new PermissionsBitField([ViewChannel, SendMessages]);
    await sendMemberGreeting(member, false);
    expect(channel.send).toHaveBeenLastCalledWith({ content: 'Tạm biệt Listener.', allowedMentions: { parse: [] } });

    const latest = await openForm();
    const welcomeInput = latest.components[0].component || latest.components[0].components[0];
    expect(welcomeInput.value).toBe(values.welcome);
    const stale = interaction(admin, { ...submitted, fields: { getTextInputValue: () => '' } });
    await setup.saveGreetingText(stale);
    expect(stale.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('đã thay đổi') }));
    await setup.saveGreetingText(interaction(admin, {
        customId: latest.custom_id,
        fields: { getTextInputValue: key => key === 'welcome' ? '' : values.goodbye }
    }));
    await sendMemberGreeting(member, true);
    expect(channel.send).toHaveBeenLastCalledWith(expect.objectContaining({ content: expect.stringContaining('Chào mừng <@12>') }));
    expect((await disk.read('1')).settings.greetingText.goodbye).toBe(values.goodbye);
});

test('LFG creates and holds a room when the author is outside voice, then moves members on join', async () => {
    jest.useFakeTimers();
    const { guild, createChannel, createMember, interaction } = fixture();
    const chat = createChannel('10', ChannelType.GuildText);
    const lobby = createChannel('11', ChannelType.GuildVoice);
    const category = createChannel('12', ChannelType.GuildCategory);
    const owner = createMember('13');
    guild.iconURL = () => 'https://example.com/server.png';
    const first = createMember('14');
    const second = createMember('15');
    const third = createMember('16');
    const source = createChannel('17', ChannelType.GuildVoice);
    await first.voice.setChannel(source);
    await disk.transact('1', async (state, save) => {
        state.settings.rooms = { lobbyId: lobby.id, categoryId: category.id };
        await save();
    });
    await lfg.execute(interaction(owner, {
        id: '100', channel: chat, user: { id: owner.id, displayAvatarURL: () => 'https://example.com/owner.png' },
        options: { getString: key => ({ game: 'Valorant', rank: 'Unrated' })[key], getInteger: () => 2 }
    }));
    const channel = guild.channels.cache.get('66');
    expect(guild.channels.create).toHaveBeenCalledTimes(1);
    expect(owner.voice.setChannel).not.toHaveBeenCalled();
    const post = chat.send.mock.calls[0][0];
    expect(post.embeds[0].toJSON()).toMatchObject({
        title: 'Valorant',
        author: { name: owner.displayName, icon_url: 'https://example.com/owner.png' },
        thumbnail: { url: 'https://example.com/server.png' },
        fields: [
            { name: 'Phòng', value: '<#66>', inline: true },
            { name: 'Chỗ', value: '1/3', inline: true },
            { name: 'Rank', value: 'Unrated', inline: true }
        ]
    });
    expect(post.components[0].toJSON().components.map(button => button.label))
        .toEqual(['Tham gia TEAM #1', 'Mở kênh thoại', 'Tùy chọn']);
    expect(post.components[0].toJSON().components[1].url).toBe(`https://discord.com/channels/${guild.id}/66`);
    await jest.advanceTimersByTimeAsync(300000);
    await disk.transact('1', async () => {});
    expect(channel.delete).not.toHaveBeenCalled();
    await owner.voice.setChannel(source);
    const button = (user, action) => interaction(user, {
        customId: `mg_lfg_${action}_100`, channelId: chat.id, message: { id: '99' }
    });
    await lfg.button(button(first, 'room'));
    expect(guild.channels.create).toHaveBeenCalledTimes(1);
    await lfg.button(button(first, 'join'));
    expect(first.voice.channel).toBe(channel);
    expect(owner.voice.channel).toBe(source);

    const withoutVoice = button(second, 'join');
    const tooLate = button(third, 'join');
    await Promise.all([lfg.button(withoutVoice), lfg.button(tooLate)]);
    expect(second.voice.setChannel).not.toHaveBeenCalled();
    const fallback = withoutVoice.followUp.mock.calls[0][0];
    expect(fallback.flags).toBe(MessageFlags.Ephemeral);
    expect(fallback.components[0].toJSON().components[0]).toMatchObject({
        label: 'Mở kênh thoại', url: `https://discord.com/channels/${guild.id}/66`
    });
    expect(withoutVoice.editReply.mock.calls[0][0].embeds[0].toJSON().fields.slice(0, 2)).toEqual([
        { name: 'Phòng', value: '<#66>', inline: true },
        { name: 'Chỗ', value: '3/3', inline: true }
    ]);
    expect(tooLate.followUp).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('đã đủ người') }));

    await lfg.button(button(owner, 'join'));
    expect(owner.voice.channel).toBe(channel);
    expect(guild.channels.create).toHaveBeenCalledTimes(1);
    expect(guild.channels.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'TEAM #1', parent: category.id, userLimit: 3 }));
    const saved = await disk.read('1');
    expect(saved.lfg['100'].members).toEqual([owner.id, first.id, second.id]);
    expect(saved.lfg['100'].roomId).toBe('66');
    expect(saved.rooms['66'].ownerId).toBe(owner.id);

    const options = button(first, 'options');
    await lfg.button(options);
    expect(options.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(options.editReply.mock.calls[0][0].components[0].toJSON().components[0].label).toBe('Rời đội');
    const panelButton = (user, action) => ({ ...button(user, action), message: { id: '900' } });
    await lfg.button(panelButton(first, 'panelclose'));
    expect(chat.messages.edit).not.toHaveBeenCalled();
    await lfg.button(panelButton(first, 'panelleave'));
    expect((await disk.read('1')).lfg['100'].members).toEqual([owner.id, second.id]);
    expect(chat.messages.edit).toHaveBeenCalledWith('99', expect.objectContaining({ embeds: expect.any(Array) }));
    await lfg.button(panelButton(owner, 'panelclose'));
    expect((await disk.read('1')).lfg['100'].closed).toBe(true);
    expect(chat.messages.edit).toHaveBeenLastCalledWith('99', expect.objectContaining({ components: [] }));
    await first.voice.setChannel(null);
    await owner.voice.setChannel(null);
    await jest.advanceTimersByTimeAsync(7000);
    await disk.transact('1', async () => {});
    expect(channel.delete).toHaveBeenCalledTimes(1);
});

test('LFG keeps the author’s original voice room without creating or managing it', async () => {
    const { guild, createChannel, createMember, interaction } = fixture();
    const chat = createChannel('10', ChannelType.GuildText);
    const original = createChannel('11', ChannelType.GuildVoice);
    original.name = 'TEAM #2';
    const other = createChannel('12', ChannelType.GuildVoice);
    const owner = createMember('13');
    const guest = createMember('14');
    await disk.transact('1', async (state, save) => {
        state.nextLfgTeam = 3;
        await save();
    });
    await owner.voice.setChannel(original);
    await guest.voice.setChannel(other);
    await lfg.execute(interaction(owner, { id: '100', channel: chat, options: {
        getString: key => key === 'game' ? 'Valorant' : null, getInteger: () => 1
    } }));
    const post = chat.send.mock.calls[0][0];
    expect(post.embeds[0].toJSON().fields[0]).toMatchObject({ value: '<#11>' });
    expect(post.components[0].toJSON().components[0].label).toBe('Tham gia TEAM #2');
    expect(post.components[0].toJSON().components[1].url).toBe(`https://discord.com/channels/${guild.id}/11`);
    expect(guild.channels.create).not.toHaveBeenCalled();
    expect((await disk.read('1')).nextLfgTeam).toBe(3);
    await disk.transact('1', async (state, save) => {
        state.lfg['100'].number = 3;
        await save();
    });

    await owner.voice.setChannel(other);
    const button = (user, action) => interaction(user, {
        customId: `mg_lfg_${action}_100`, channelId: chat.id, message: { id: '99' }
    });
    const join = button(guest, 'join');
    await lfg.button(join);
    expect(join.editReply.mock.calls[0][0].components[0].toJSON().components[0].label).toBe('Tham gia TEAM #2');
    expect(guest.voice.channel).toBe(original);
    expect(owner.voice.channel).toBe(other);
    const options = button(owner, 'options');
    await lfg.button(options);
    expect(options.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('<#11>') }));
    await lfg.button(button(owner, 'close'));
    expect(original.delete).not.toHaveBeenCalled();
    expect(original.setUserLimit).not.toHaveBeenCalled();
    expect((await disk.read('1')).rooms).toEqual({});
    expect(guild.channels.create).not.toHaveBeenCalled();
});

test('LFG lets an owner repost after their old message was deleted and cleans its empty temporary room', async () => {
    jest.useFakeTimers();
    const { guild, createChannel, createMember, interaction } = fixture();
    const chat = createChannel('10', ChannelType.GuildText);
    const lobby = createChannel('11', ChannelType.GuildVoice);
    const category = createChannel('12', ChannelType.GuildCategory);
    const voice = createChannel('14', ChannelType.GuildVoice);
    const owner = createMember('13');
    await disk.transact('1', async (state, save) => {
        state.settings.rooms = { lobbyId: lobby.id, categoryId: category.id };
        await save();
    });
    const post = id => interaction(owner, { id, channel: chat, options: {
        getString: key => key === 'game' ? 'Valorant' : null, getInteger: () => 1
    } });
    await lfg.execute(post('100'));
    const temporary = guild.channels.cache.get('66');
    chat.messages.fetch = jest.fn().mockRejectedValue({ code: RESTJSONErrorCodes.UnknownMessage });
    await owner.voice.setChannel(voice);
    await lfg.execute(post('101'));

    expect(chat.messages.fetch).toHaveBeenCalledWith({ message: '99', force: true, cache: false });
    expect(chat.send).toHaveBeenCalledTimes(2);
    expect((await disk.read('1')).lfg).toMatchObject({ '101': { roomId: voice.id, closed: false } });
    expect((await disk.read('1')).lfg['100']).toBeUndefined();
    await jest.advanceTimersByTimeAsync(7000);
    await disk.transact('1', async () => {});
    expect(temporary.delete).toHaveBeenCalledTimes(1);
    expect(voice.delete).not.toHaveBeenCalled();
});

test('LFG lets only the owner close an old post from the duplicate notice when Discord denies message lookup', async () => {
    const { createChannel, createMember, interaction } = fixture();
    const oldChat = createChannel('10', ChannelType.GuildText);
    const newChat = createChannel('11', ChannelType.GuildText);
    const voice = createChannel('12', ChannelType.GuildVoice);
    const owner = createMember('13');
    const other = createMember('14');
    await owner.voice.setChannel(voice);
    const options = { getString: key => key === 'game' ? 'Valorant' : null, getInteger: () => 1 };
    await lfg.execute(interaction(owner, { id: '100', channel: oldChat, options }));
    oldChat.messages.fetch = jest.fn().mockRejectedValue({ code: RESTJSONErrorCodes.MissingPermissions });

    const duplicate = interaction(owner, { id: '101', channel: newChat, options });
    await lfg.execute(duplicate);
    expect(newChat.send).not.toHaveBeenCalled();
    expect((await disk.read('1')).lfg['100'].closed).toBe(false);
    const button = duplicate.editReply.mock.calls[0][0].components[0].toJSON().components[0];
    expect(button.label).toBe('Đóng phiếu cũ');
    const click = { customId: button.custom_id, channelId: newChat.id, message: { id: '900' } };
    await lfg.button(interaction(other, click));
    expect((await disk.read('1')).lfg['100'].closed).toBe(false);
    await lfg.button(interaction(owner, click));
    expect((await disk.read('1')).lfg['100'].closed).toBe(true);
    expect(oldChat.messages.edit).toHaveBeenCalledWith('99', expect.objectContaining({ components: [] }));
    await lfg.execute(interaction(owner, { id: '102', channel: newChat, options }));
    expect(newChat.send).toHaveBeenCalledTimes(1);
    expect(voice.delete).not.toHaveBeenCalled();
});

test('locked room requests are accepted only by the owner and temporary access is revoked', async () => {
    jest.useFakeTimers();
    jest.replaceProperty(process, 'env', { ...process.env, GUILD_IDS: '1' });
    const { guild, createChannel, createMember, interaction } = fixture();
    const channel = createChannel('16', ChannelType.GuildVoice);
    const owner = createMember('12');
    const guest = createMember('13');
    const outsider = createMember('14');
    guest.permissions.add(Connect);
    channel.permissionsFor = member => member === guest || member === outsider
        ? new PermissionsBitField(ViewChannel) : new PermissionsBitField(PermissionsBitField.All);
    channel.permissionOverwrites.delete = jest.fn().mockResolvedValue();
    await owner.voice.setChannel(channel);
    guild.members.fetch.mockResolvedValue(guest);
    await disk.transact('1', async (state, save) => {
        state.rooms[channel.id] = { ownerId: owner.id, lock: { [guild.id]: null } };
        await save();
    });
    const input = { id: '101', options: { getChannel: () => channel } };
    await roomRequest.execute(interaction(outsider, input));
    expect(owner.send).not.toHaveBeenCalled();
    const request = interaction(guest, input);
    await roomRequest.execute(request);
    const approveId = owner.send.mock.calls[0][0].components[0].toJSON().components[0].custom_id;
    await roomRequest.button(interaction(outsider, { customId: approveId }));
    expect(channel.permissionOverwrites.edit).not.toHaveBeenCalled();
    await roomRequest.button(interaction(owner, { customId: approveId }));
    expect(channel.permissionOverwrites.edit).toHaveBeenCalledTimes(1);
    expect(channel.permissionOverwrites.edit).toHaveBeenCalledWith(guest.id, { Connect: true }, expect.any(Object));
    expect(request.editReply).toHaveBeenLastCalledWith(expect.objectContaining({ content: expect.stringContaining('trong 1 phút') }));
    await jest.advanceTimersByTimeAsync(60000);
    await disk.transact('1', async () => {});
    expect(channel.permissionOverwrites.delete).toHaveBeenCalledWith(guest.id, expect.any(String));
    expect((await disk.read('1')).rooms[channel.id].admissions).toEqual({});
    await jest.advanceTimersByTimeAsync(60000);
});

async function openBetForm(button) {
    button.showModal = jest.fn();
    await taixiu.button(button);
    const form = button.showModal.mock.calls[0][0].toJSON();
    return amount => ({
        ...button, customId: form.custom_id, fields: { getTextInputValue: () => String(amount) },
        reply: jest.fn(), deferReply: jest.fn(), editReply: jest.fn().mockResolvedValue(), followUp: jest.fn()
    });
}

test('Tiệm Bánh Mây grants starter coins once, settles different concurrent stakes and ranks wallets per guild', async () => {
    jest.useFakeTimers();
    jest.spyOn(crypto, 'randomInt').mockReturnValueOnce(4).mockReturnValueOnce(3).mockReturnValueOnce(5);
    const { createChannel, createMember, interaction } = fixture();
    const chat = createChannel('10', ChannelType.GuildText);
    const first = createMember('13');
    const second = createMember('14');
    const low = createMember('15');
    const command = (member, action) => interaction(member, {
        id: '110', channel: chat, options: { getSubcommand: () => action }
    });
    await taixiu.execute(command(first, 'wallet'));
    await taixiu.execute(command(first, 'play'));
    const controls = chat.send.mock.calls[0][0].components.flatMap(row => row.toJSON().components);
    expect(controls.map(control => control.label)).toEqual(['Bánh Bông · 11–17', 'Bánh Bơ · 4–10', 'Kết quả của tôi', 'Ví xu', 'Điểm danh', 'Xếp hạng', 'Lịch sử cược', 'Lịch sử xúc xắc']);
    const button = (member, side) => interaction(member, {
        customId: controls[side].custom_id, channelId: chat.id, message: { id: '99' }
    });
    const firstTai = await openBetForm(button(first, 0));
    const firstXiu = await openBetForm(button(first, 1));
    const secondXiu = await openBetForm(button(second, 1));
    const firstBet = firstTai(100);
    const otherSide = firstXiu(50);
    const secondBet = secondXiu(250);
    await Promise.all([taixiu.modal(firstBet), taixiu.modal(firstTai(75)), taixiu.modal(secondBet)]);
    await taixiu.modal(otherSide);
    expect(otherSide.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Bánh Bông **175 xu** · Bánh Bơ **50 xu**') }));
    await disk.transact('1', async (state, save) => {
        state.taixiu.balances[low.id] = 20;
        await save();
    });
    const lowTai = await openBetForm(button(low, 0));
    const lowXiu = await openBetForm(button(low, 1));
    await taixiu.modal(lowTai(10));
    const insufficient = lowXiu(11);
    await taixiu.modal(insufficient);
    expect(insufficient.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('10 xu') }));
    const balancedBet = lowXiu(10);
    await taixiu.modal(balancedBet);
    const waiting = (await disk.read('1')).taixiu;
    expect(waiting.round.bets).toEqual({ [first.id]: { tai: 175, xiu: 50 }, [second.id]: { tai: 0, xiu: 250 }, [low.id]: { tai: 10, xiu: 10 } });
    expect(waiting.balances).toEqual({ [first.id]: 775, [second.id]: 750, [low.id]: 0 });
    const wallet = button(first, 3);
    await taixiu.button(wallet);
    expect(wallet.editReply.mock.calls[0][0].content).toContain('Đang đặt cược **225 xu**');
    const liveTop = button(first, 5);
    await taixiu.button(liveTop);
    expect(liveTop.editReply.mock.calls[0][0].content).toContain('**1.** <@14> · **1,000 xu**');

    await jest.advanceTimersByTimeAsync(30000);
    await disk.transact('1', async () => {});
    const locked = (await disk.read('1')).taixiu;
    expect(locked.round.draw).toEqual({ dice: [4, 3, 5], total: 12, winner: 'tai' });
    expect(locked.round.result).toBeUndefined();
    expect(locked.balances).toEqual(waiting.balances);
    expect(locked.history).toBeUndefined();
    const late = lowXiu(20);
    await taixiu.modal(late);
    expect(late.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Đã hết giờ đặt cược') }));
    expect((await disk.read('1')).taixiu.balances).toEqual(waiting.balances);
    const firstFrame = chat.messages.edit.mock.calls.at(-1)[1];
    expect(firstFrame.embeds[0].toJSON()).toMatchObject({
        description: expect.stringContaining('Đã khóa cược · Đang lắc xúc xắc'),
        image: { url: 'attachment://taixiu-roll.gif' }
    });
    const gif = await fs.readFile(firstFrame.files[0].attachment);
    expect(gif.subarray(0, 6).toString('ascii')).toBe('GIF89a');
    expect(gif.readUInt16LE(6)).toBe(448);
    expect(firstFrame.components).toEqual([]);
    expect((await disk.read('2')).taixiu.balances).toEqual({});

    expect(otherSide.followUp).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(2600);
    const draw = chat.messages.edit.mock.calls.at(-1)[1];
    expect(draw.embeds[0].toJSON().description).toContain('4 + 3 + 5 = 12');
    expect(draw.embeds[0].toJSON().footer.text).toBe('Đang trả thưởng…');
    expect(draw.files[0].description).toContain('4, 3, 5');
    expect(draw.components).toEqual([]);
    expect(draw.embeds[1].toJSON().fields[0].value).toContain('sau khi ván đầu tiên hoàn tất');
    await jest.advanceTimersByTimeAsync(999);
    expect((await disk.read('1')).taixiu.balances).toEqual(waiting.balances);
    expect(otherSide.followUp).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await disk.transact('1', async () => {});
    await jest.advanceTimersByTimeAsync(0);
    const finished = (await disk.read('1')).taixiu;
    expect(finished.round.result).toEqual(locked.round.draw);
    expect(finished.balances).toEqual({ [first.id]: 1125, [second.id]: 750, [low.id]: 20 });
    expect(finished.rolls).toEqual([expect.objectContaining(locked.round.draw)]);
    const top = command(first, 'top');
    await taixiu.execute(top);
    expect(top.editReply.mock.calls[0][0].content).toContain('**1.** <@13> · **1,125 xu**\n**2.** <@14> · **750 xu**');
    const frames = chat.messages.edit.mock.calls.map(([, payload]) => payload)
        .filter(payload => payload.embeds[0].toJSON().description.includes('Đang lắc xúc xắc'));
    expect(frames).toHaveLength(1);
    expect(firstBet.followUp).not.toHaveBeenCalled();
    expect(otherSide.followUp).toHaveBeenCalledTimes(1);
    expect(otherSide.followUp).toHaveBeenCalledWith(expect.objectContaining({
        flags: MessageFlags.Ephemeral, content: expect.stringContaining('Bạn thắng +125 xu')
    }));
    expect(secondBet.followUp).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Bạn thua 250 xu') }));
    expect(balancedBet.followUp).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Bạn hòa vốn') }));
    const result = chat.messages.edit.mock.calls.at(-1)[1];
    expect(result.files[0].description).toContain('4, 3, 5');
    expect(result.embeds[0].toJSON().description).toContain('4 + 3 + 5 = 12');
    expect(result.embeds[0].toJSON()).toMatchObject({
        title: '🎲 Kết quả Tiệm Bánh Mây',
        fields: expect.arrayContaining([expect.objectContaining({ name: '🏆 Lãi sau ván', value: '<@13> · **+125 xu**' })])
    });
    const resultButtons = result.components.flatMap(row => row.toJSON().components);
    expect(resultButtons.map(control => control.label)).toEqual(['Chơi lại', 'Kết quả của tôi', 'Lịch sử cược', 'Lịch sử xúc xắc', 'Ví xu', 'Điểm danh', 'Xếp hạng']);
    expect(result.embeds[1].toJSON().description).toContain('**1.** <@13> · **1,125 xu**');
    const replay = (member, id) => interaction(member, {
        id, channel: chat, customId: resultButtons[0].custom_id, message: { id: '99' }
    });
    await Promise.all([taixiu.button(replay(first, '111')), taixiu.button(replay(second, '112'))]);
    expect(chat.send).toHaveBeenCalledTimes(2);
    expect((await disk.read('1')).taixiu.round).toMatchObject({ id: '111', bets: {} });
});

test('a stored Tiệm Bánh Mây draw survives a restart and refunds once after restoring a deleted board', async () => {
    jest.useFakeTimers();
    jest.spyOn(crypto, 'randomInt').mockReturnValue(3);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const { guild, createChannel } = fixture();
    const chat = createChannel('10', ChannelType.GuildText);
    chat.permissionsFor = () => new PermissionsBitField([ViewChannel, SendMessages, PermissionFlagsBits.EmbedLinks]);
    chat.messages.edit.mockRejectedValueOnce(Object.assign(new Error('Unknown Message'), { code: RESTJSONErrorCodes.UnknownMessage }))
        .mockRejectedValueOnce(new Error('Discord temporarily unavailable'));
    chat.send.mockResolvedValueOnce({ id: '100' });
    await disk.transact('1', async (state, save) => {
        state.taixiu = {
            balances: { 13: 900, 14: 750 },
            round: { id: '110', channelId: chat.id, messageId: '99', bet: 100, draw: { dice: [3, 3, 3], total: 9, winner: 'tie' },
                closesAt: Date.now() - 1000, bets: { 13: 'tai', 14: { tai: 100, xiu: 150 } } }
        };
        await save();
    });
    const reopened = store.createManagementStore(root);
    store.transact.mockImplementation(reopened.transact);
    await taixiu.resume(guild);
    await jest.advanceTimersByTimeAsync(0);
    await reopened.transact('1', async () => {});
    await jest.advanceTimersByTimeAsync(0);
    const awaitingPublish = await reopened.read('1');
    expect(awaitingPublish.taixiu.balances).toEqual({ 13: 900, 14: 750 });
    expect(awaitingPublish.taixiu.round).toMatchObject({ messageId: '100', draw: { winner: 'tie' } });
    await taixiu.resume(guild);
    store.read.mockResolvedValueOnce(awaitingPublish);
    await jest.advanceTimersByTimeAsync(5000);
    expect(chat.messages.edit.mock.calls.at(-1)[1].embeds[0].toJSON().footer.text).toBe('Đang trả thưởng…');
    await jest.advanceTimersByTimeAsync(1000);
    await reopened.transact('1', async () => {});
    const { taixiu: game } = await reopened.read('1');
    expect(game.round.result.winner).toBe('tie');
    expect(game.round.messageId).toBe('100');
    expect(game.balances).toEqual({ 13: 1000, 14: 1000 });
    expect(game.rolls).toEqual([expect.objectContaining({ dice: [3, 3, 3], winner: 'tie' })]);
    expect(crypto.randomInt).not.toHaveBeenCalled();
    const result = chat.messages.edit.mock.calls.at(-1)[1];
    expect(result.embeds[0].toJSON().description).toContain('⚂　⚂　⚂');
    expect(result.embeds[0].toJSON().description).toContain('Hoàn xu cược');
    expect(result.files).toBeUndefined();
    expect(chat.messages.edit.mock.calls.some(([, payload]) =>
        payload.embeds[0].toJSON().description.includes('Đang lắc xúc xắc'))).toBe(false);
});

test('Tiệm Bánh Mây check-ins pay 5,000,000 coins once per rolling eight hours and guild across button and slash requests', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-11T16:59:59Z') });
    const claimedAt = Date.now();
    const nextClaim = Math.ceil((claimedAt + 28_800_000) / 1000);
    const { guild, createChannel, createMember, interaction } = fixture();
    const chat = createChannel('10', ChannelType.GuildText);
    const player = createMember('13');
    await disk.transact(guild.id, async (state, save) => {
        state.settings.taixiuRoom = { channelId: chat.id, bet: 100 };
        state.taixiu.balances[player.id] = 0;
        state.taixiu.round = { id: '110', channelId: chat.id, messageId: '99', automatic: true, bet: 100, closesAt: null, bets: {} };
        await save();
    });
    await taixiu.resume(guild);
    expect(chat.send).not.toHaveBeenCalled();
    const controls = chat.messages.edit.mock.calls[0][1].components.flatMap(row => row.toJSON().components);
    const empty = interaction(player, { customId: controls[0].custom_id, channelId: chat.id, message: { id: '99' } });
    await taixiu.button(empty);
    expect(empty.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Bạn đã hết xu') }));
    const dailyButton = interaction(player, { customId: controls.find(control => control.label === 'Điểm danh').custom_id });
    const daily = (server = guild) => interaction(player, { guild: server, guildId: server.id, options: { getSubcommand: () => 'daily' } });
    const duplicate = daily();
    await Promise.all([taixiu.button(dailyButton), taixiu.execute(duplicate)]);
    expect(dailyButton.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('nhận **5,000,000 xu**') }));
    expect(dailyButton.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining(`<t:${nextClaim}:R>`) }));
    expect(duplicate.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining(`<t:${nextClaim}:R>`) }));
    expect((await disk.read('1')).taixiu.balances[player.id]).toBe(5_000_000);
    expect((await disk.read('1')).taixiu.dailyClaimTimes[player.id]).toBe(claimedAt);

    const reopened = store.createManagementStore(root);
    store.transact.mockImplementation(reopened.transact);
    await taixiu.execute(daily());
    expect((await reopened.read('1')).taixiu.balances[player.id]).toBe(5_000_000);
    // Crossing midnight in Vietnam must not reset the eight-hour cooldown.
    jest.setSystemTime(claimedAt + 1000);
    const afterMidnight = daily();
    await taixiu.execute(afterMidnight);
    expect(afterMidnight.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('chờ đủ 8 giờ') }));
    expect((await reopened.read('1')).taixiu.balances[player.id]).toBe(5_000_000);
    jest.setSystemTime(claimedAt + 28_800_000 - 1);
    const tooEarly = daily();
    await taixiu.execute(tooEarly);
    expect(tooEarly.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining(`<t:${nextClaim}:R>`) }));
    expect((await reopened.read('1')).taixiu.balances[player.id]).toBe(5_000_000);
    jest.setSystemTime(claimedAt + 28_800_000);
    await taixiu.execute(daily());
    await taixiu.execute(daily({ id: '2' }));
    expect((await reopened.read('1')).taixiu.balances[player.id]).toBe(10_000_000);
    expect((await reopened.read('1')).taixiu.dailyClaimTimes[player.id]).toBe(claimedAt + 28_800_000);
    expect((await reopened.read('2')).taixiu.balances[player.id]).toBe(5_001_000);
});

test('legacy calendar-day check-ins do not block the first eight-hour check-in after the update', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-12T08:23:45.123Z') });
    const { guild, createMember, interaction } = fixture();
    const player = createMember('13');
    const legacyDay = Math.floor((Date.now() + 7 * 60 * 60 * 1000) / 86_400_000);
    await disk.transact(guild.id, async (state, save) => {
        state.taixiu.balances[player.id] = '250.50';
        state.taixiu.dailyClaims = { [player.id]: legacyDay };
        await save();
    });
    const request = interaction(player);
    await taixiu.claimDaily(request);
    expect(request.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('nhận **5,000,000 xu**') }));
    const game = (await disk.read(guild.id)).taixiu;
    expect(game.balances[player.id]).toBe('5000250.50');
    expect(game.dailyClaimTimes[player.id]).toBe(Date.now());
    expect(game.dailyClaims[player.id]).toBe(legacyDay);
    const duplicate = interaction(player);
    await taixiu.claimDaily(duplicate);
    expect(duplicate.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining(`<t:${Math.ceil((Date.now() + 28_800_000) / 1000)}:R>`) }));
    expect((await disk.read(guild.id)).taixiu.balances[player.id]).toBe('5000250.50');
});

test('private Tiệm Bánh Mây credits are silent outside the configured owner DM and validate the target guild', async () => {
    const { guild, admin, createMember } = fixture();
    const other = createMember('13');
    jest.replaceProperty(process, 'env', { ...process.env, GUILD_IDS: guild.id });
    delete process.env.TAIXIU_OWNER_ID;
    const request = (overrides = {}) => ({
        id: '110', author: admin.user ?? { id: admin.id }, channel: { type: ChannelType.DM },
        content: '!addxu 1 5000', client: { guilds: { cache: new Map([[guild.id, guild], ['2', guild]]) } },
        reply: jest.fn(), ...overrides
    });
    const disabled = request();
    await taixiu.handlePrivateMessage(disabled);
    expect(disabled.reply).not.toHaveBeenCalled();
    process.env.TAIXIU_OWNER_ID = admin.id;
    const unauthorized = [request({ author: other.user }), request({ channel: { type: ChannelType.GuildText } })];
    for (const message of unauthorized) {
        await taixiu.handlePrivateMessage(message);
        expect(message.reply).not.toHaveBeenCalled();
    }

    const wrongGuild = request({ content: '!addxu 2 5000' });
    await taixiu.handlePrivateMessage(wrongGuild);
    expect(wrongGuild.reply).toHaveBeenCalledWith(expect.stringContaining('kiểm tra ID máy chủ'));
    const invalid = request({ content: '!addxu 1 -5000' });
    await taixiu.handlePrivateMessage(invalid);
    expect(invalid.reply).toHaveBeenCalledWith(expect.stringContaining('tối đa 2 chữ số thập phân'));
    expect(guild.members.fetch).not.toHaveBeenCalled();
    expect(store.transact).not.toHaveBeenCalled();
    expect(taixiu.data.toJSON().options.map(option => option.name)).toEqual(['play', 'wallet', 'daily', 'top', 'history', 'dice']);
});

test('private Tiệm Bánh Mây credits add to the selected wallet once per message and preserve a pending wager', async () => {
    const { guild, createMember } = fixture();
    const owner = createMember('12');
    const target = createMember('13');
    jest.replaceProperty(process, 'env', { ...process.env, TAIXIU_OWNER_ID: owner.id, GUILD_IDS: guild.id });
    guild.members.fetch.mockImplementation(async ({ user }) => {
        const member = guild.members.cache.get(user);
        if (!member) throw Object.assign(new Error('Unknown Member'), { code: RESTJSONErrorCodes.UnknownMember });
        return member;
    });
    await disk.transact(guild.id, async (state, save) => {
        state.taixiu.balances[target.id] = 0;
        state.taixiu.round = { bets: { [target.id]: { choice: 'tai', amount: 1000 } } };
        await save();
    });
    const request = (id, content) => ({
        id, content, author: owner.user, channel: { type: ChannelType.DM },
        client: { guilds: { cache: new Map([[guild.id, guild]]) } }, reply: jest.fn()
    });
    const credit = request('110', '!addxu 1 5.000 13');
    const ownWallet = request('111', '!addxu 1 2000.05');
    await Promise.all([taixiu.handlePrivateMessage(credit), taixiu.handlePrivateMessage(credit), taixiu.handlePrivateMessage(ownWallet)]);
    expect(credit.reply).toHaveBeenCalledWith(expect.stringContaining('Đã cộng **5,000 xu**'));
    expect(credit.reply).toHaveBeenCalledWith(expect.stringContaining('đã được cộng xu'));
    expect(ownWallet.reply).toHaveBeenCalledWith(expect.stringContaining('**3,000.05 xu**'));

    const unknown = request('112', '!addxu 1 5000 14');
    await taixiu.handlePrivateMessage(unknown);
    expect(unknown.reply).toHaveBeenCalledWith(expect.stringContaining('đang là thành viên'));
    const largeGrant = request('113', '!addxu 1 9007199254740995 13');
    await taixiu.handlePrivateMessage(largeGrant);
    expect(largeGrant.reply).toHaveBeenCalledWith(expect.stringContaining('Đã cộng **9,007,199,254,740,995 xu**'));
    const { taixiu: game } = await disk.read(guild.id);
    expect(game.balances).toEqual({ [owner.id]: '3000.05', [target.id]: '9007199254745995' });
    expect(game.round.bets[target.id]).toEqual({ choice: 'tai', amount: 1000 });
});

test('Tiệm Bánh Mây keeps a full-balance wager and its payout exact beyond the safe integer range', async () => {
    jest.useFakeTimers();
    jest.spyOn(crypto, 'randomInt').mockReturnValueOnce(4).mockReturnValueOnce(3).mockReturnValueOnce(5);
    const { createChannel, createMember, interaction } = fixture();
    const chat = createChannel('10', ChannelType.GuildText);
    const player = createMember('13');
    const balance = '9007199254740995.15';
    await disk.transact('1', async (state, save) => {
        state.taixiu.balances[player.id] = balance;
        await save();
    });
    await taixiu.execute(interaction(player, { id: '110', channel: chat, options: { getSubcommand: () => 'play' } }));
    const control = chat.send.mock.calls[0][0].components[0].toJSON().components[0];
    const bet = await openBetForm(interaction(player, { customId: control.custom_id, channelId: chat.id, message: { id: '99' } }));
    await taixiu.modal(bet('9.007.199.254.740.995,05'));
    expect((await disk.read('1')).taixiu.balances[player.id]).toBe('0.10');
    await taixiu.modal(bet('all'));
    const pending = (await disk.read('1')).taixiu;
    expect(pending.balances[player.id]).toBe(0);
    expect(pending.round.bets[player.id]).toEqual({ tai: balance, xiu: 0 });

    await jest.advanceTimersByTimeAsync(30000);
    await disk.transact('1', async () => {});
    await jest.advanceTimersByTimeAsync(3600);
    await disk.transact('1', async () => {});
    const settled = (await disk.read('1')).taixiu;
    expect(settled.balances[player.id]).toBe('18014398509481990.30');
    expect(settled.history[player.id][0]).toMatchObject({ tai: balance, xiu: 0 });
    const top = interaction(player, { options: { getSubcommand: () => 'top' } });
    await taixiu.execute(top);
    expect(top.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('18,014,398,509,481,990.30 xu') }));
});

test('the automatic Tiệm Bánh Mây room withholds payouts and private results until a slow draw is published', async () => {
    jest.useFakeTimers();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(crypto, 'randomInt').mockReturnValueOnce(4).mockReturnValueOnce(3).mockReturnValueOnce(5);
    const { guild, admin, createChannel, createMember, interaction } = fixture();
    const chat = createChannel('10', ChannelType.GuildText);
    const other = createChannel('11', ChannelType.GuildText);
    const player = createMember('13');
    const second = createMember('14');
    const earlierRolls = [
        { at: Date.now() - 60000, winner: 'xiu', dice: [1, 2, 4], total: 7 },
        { at: Date.now() - 120000, winner: 'tie', dice: [2, 2, 2], total: 6 },
        ...Array.from({ length: 18 }, (_, index) => ({ at: Date.now() - (index + 3) * 60000, winner: 'tai', dice: [6, 5, 4], total: 15 }))
    ];
    await disk.transact('1', async (state, save) => {
        state.taixiu.balances[player.id] = 6000;
        state.taixiu.rolls = earlierRolls;
        await save();
    });
    await setup.execute(interaction(admin, { options: {
        getSubcommand: () => 'tiembanh', getChannel: () => chat
    } }));
    const original = (await disk.read('1')).taixiu.round;
    expect(original).toMatchObject({ automatic: true, closesAt: null, channelId: chat.id, messageId: '99' });
    expect(chat.send).toHaveBeenCalledTimes(1);
    expect(chat.send.mock.calls[0][0].embeds[0].toJSON().description).toContain('30 giây');
    await jest.advanceTimersByTimeAsync(60000);
    expect(chat.messages.edit).not.toHaveBeenCalled();

    const play = interaction(player, { channel: other, options: { getSubcommand: () => 'play' } });
    await taixiu.execute(play);
    expect(other.send).not.toHaveBeenCalled();
    expect(play.editReply.mock.calls[0][0].content).toContain(`https://discord.com/channels/${guild.id}/${chat.id}/99`);
    const controls = chat.send.mock.calls[0][0].components[0].toJSON().components;
    const bet = await openBetForm(interaction(player, { customId: controls[0].custom_id, channelId: chat.id, message: { id: '99' } }));
    for (const invalid of ['1e2', '1,2345', 0]) {
        const submission = bet(invalid);
        await taixiu.modal(submission);
        expect(submission.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('tối đa 2 chữ số thập phân') }));
    }
    const insufficient = bet('6.001');
    await taixiu.modal(insufficient);
    expect(insufficient.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('6,000 xu') }));
    expect((await disk.read('1')).taixiu.round.closesAt).toBeNull();
    const firstBet = bet('5.000');
    await taixiu.modal(firstBet);
    expect((await disk.read('1')).taixiu.round.closesAt).toBe(Date.now() + 30000);
    const board = () => chat.messages.edit.mock.calls.at(-1)[1].embeds[0].toJSON();
    const fieldValue = name => board().fields.find(field => field.name === name)?.value;
    const countdown = () => fieldValue('⏳ Đếm ngược');
    const deadline = Math.ceil((Date.now() + 30000) / 1000);
    expect(countdown()).toContain(`<t:${deadline}:R>`);
    expect(countdown()).toContain(`<t:${deadline}:T>`);
    expect(fieldValue('👥 Người chơi')).toContain('1 người');
    const secondBet = await openBetForm(interaction(second, { customId: controls[1].custom_id, channelId: chat.id, message: { id: '99' } }));
    await taixiu.modal(secondBet('all'));
    await jest.advanceTimersByTimeAsync(5999);
    expect(chat.messages.edit).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(chat.messages.edit).toHaveBeenCalledTimes(2);
    expect(fieldValue('👥 Người chơi')).toContain('2 người');
    expect(fieldValue('👥 Người chơi')).toContain('6,000 xu đã cược');
    expect(fieldValue('🔴 Bánh Bông')).toContain('5,000 xu');
    expect(fieldValue('🔵 Bánh Bơ')).toContain('1,000 xu');
    await jest.advanceTimersByTimeAsync(13000);
    expect(chat.messages.edit).toHaveBeenCalledTimes(3);
    let finishLastEdit;
    chat.messages.edit.mockImplementationOnce(() => new Promise(resolve => { finishLastEdit = resolve; }));
    await jest.advanceTimersByTimeAsync(1000);
    expect(board().color).toBe(0xfaa61a);
    const editsAtLastTick = chat.messages.edit.mock.calls.length;
    expect(editsAtLastTick).toBe(4);
    await jest.advanceTimersByTimeAsync(10000);
    await disk.transact('1', async () => {});
    expect((await disk.read('1')).taixiu.round.draw.winner).toBe('tai');
    expect(countdown()).toContain(`<t:${deadline}:T>`);
    await jest.advanceTimersByTimeAsync(4500);
    expect(firstBet.followUp).not.toHaveBeenCalled();
    expect((await disk.read('1')).taixiu.balances[player.id]).toBe(1000);
    expect(chat.messages.edit).toHaveBeenCalledTimes(editsAtLastTick);
    finishLastEdit();
    await jest.advanceTimersByTimeAsync(0);
    expect(board().description).toContain('Đang lắc xúc xắc');
    expect(board().image.url).toBe('attachment://taixiu-roll.gif');
    expect(chat.messages.edit).toHaveBeenCalledTimes(editsAtLastTick + 1);
    let finishDraw;
    chat.messages.edit.mockImplementationOnce(() => new Promise(resolve => { finishDraw = resolve; }));
    await jest.advanceTimersByTimeAsync(2599);
    expect(board().description).toContain('Đang lắc xúc xắc');
    await jest.advanceTimersByTimeAsync(1);
    expect(board().description).toContain('4 + 3 + 5 = 12');
    expect(chat.messages.edit).toHaveBeenCalledTimes(editsAtLastTick + 2);
    await jest.advanceTimersByTimeAsync(1500);
    expect(firstBet.followUp).not.toHaveBeenCalled();
    expect((await disk.read('1')).taixiu.balances[player.id]).toBe(1000);
    finishDraw();
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(1000);
    await disk.transact('1', async () => {});
    await jest.advanceTimersByTimeAsync(0);
    expect(firstBet.followUp).toHaveBeenCalledTimes(1);
    expect(firstBet.followUp).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Bạn thắng +5,000 xu') }));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Cập nhật đếm ngược Tiệm Bánh Mây'));
    expect(board().title).toBe('🎉 Chúc mừng thắng lớn!');
    expect(fieldValue('🏆 Lãi sau ván')).toBe('🎉 <@13> · **+5,000 xu**');
    // Wait for the transaction that accepts the next round. Publication has
    // separate reservation and acceptance commits with Discord I/O in between.
    const nextBoardCommitted = new Promise(resolve => {
        store.transact.mockImplementation(async (guildId, operation, scope) => {
            let acceptedNext = false;
            const result = await disk.transact(guildId, async (state, save) => {
                const value = await operation(state, save);
                acceptedNext = Boolean(state.taixiu.round && state.taixiu.round.id !== original.id);
                return value;
            }, scope);
            if (acceptedNext) resolve();
            return result;
        });
    });
    await jest.advanceTimersByTimeAsync(6000);
    await nextBoardCommitted;

    const next = (await disk.read('1')).taixiu;
    expect(next.balances).toEqual({ [player.id]: 11000, [second.id]: 0 });
    expect(next.round).toMatchObject({ messageId: original.messageId, closesAt: null, bets: {} });
    expect(next.round.id).not.toBe(original.id);
    expect(next.rolls).toHaveLength(20);
    expect(next.rolls[0]).toMatchObject({ winner: 'tai', dice: [4, 3, 5], total: 12 });
    expect(next.rolls.at(-1)).toEqual(earlierRolls[18]);
    expect(chat.send).toHaveBeenCalledTimes(1);
    const reopenedBoard = chat.messages.edit.mock.calls.at(-1)[1];
    expect(reopenedBoard.attachments).toEqual([]);
    expect(reopenedBoard.embeds[0].toJSON().image).toBeUndefined();
    const [trail, recent] = reopenedBoard.embeds[1].toJSON().fields;
    const markers = trail.value.split('\n')[0].split(' ');
    expect(markers).toHaveLength(12);
    expect(markers.slice(-3)).toEqual(['🟡', '🔵', '🔴']);
    expect(recent.value.split('\n')).toEqual(['🔴 **Bánh Bông** · 4 + 3 + 5 = **12**', '🔵 **Bánh Bơ** · 1 + 2 + 4 = **7**', '🟡 **Hoàn cược** · 2 + 2 + 2 = **6**']);
    const diceButton = reopenedBoard.components.flatMap(row => row.toJSON().components).find(control => control.label === 'Lịch sử xúc xắc');
    const diceHistory = interaction(second, { customId: diceButton.custom_id });
    await taixiu.button(diceHistory);
    expect(diceHistory.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    const diceHistoryLines = diceHistory.editReply.mock.calls[0][0].embeds[0].toJSON().description.split('\n');
    expect(diceHistoryLines).toHaveLength(20);
    expect(diceHistoryLines[0]).toContain(recent.value.split('\n')[0]);
    const resultControl = reopenedBoard.components[0].toJSON().components.find(control => control.label === 'Kết quả của tôi');
    const personal = interaction(player, { customId: resultControl.custom_id });
    await taixiu.button(personal);
    expect(personal.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Bạn thắng +5,000 xu') }));
    await setup.execute(interaction(admin, { options: { getSubcommand: () => 'disable', getString: () => 'taixiuRoom' } }));
    expect((await disk.read('1')).taixiu).toMatchObject({ balances: { [player.id]: 11000, [second.id]: 0 }, round: null });
    expect(chat.messages.edit).toHaveBeenLastCalledWith('99', expect.objectContaining({ embeds: [], components: [] }));
});

test('CS2 bulk orders buy both quantities with one wallet deduction', async () => {
    const { createMember, interaction } = fixture();
    const player = createMember('13');
    await disk.transact('1', async (state, save) => {
        state.taixiu.balances[player.id] = 246000;
        await save();
    });
    const preview = interaction(player);
    await hom.execute(preview);
    const purchase = preview.editReply.mock.calls[0][0].components[1].toJSON().components
        .find(control => control.label === 'Mua nhiều');
    expect(purchase.disabled).toBe(false);
    const click = interaction(player, { customId: purchase.custom_id, showModal: jest.fn() });
    await hom.button(click);
    expect(click.deferUpdate).not.toHaveBeenCalled();
    const form = click.showModal.mock.calls[0][0].toJSON();
    expect(form.title).toBe('Mua · Kilowatt Case');
    expect(form.custom_id).toBe('mg_hom_order_crate-4904_1500_60000_xu1');
    expect(form.components.map(field => field.component?.custom_id ?? field.components[0].custom_id))
        .toEqual(['cases', 'keys']);
    expect(form.components[1].label ?? form.components[1].components[0].label).toBe('Số chìa · 60,000 xu/cái');
    const submit = (id, values) => interaction(player, {
        id,
        customId: form.custom_id,
        fields: { fields: new Collection(Object.entries(values).map(([name, value]) => [name, { value }])) }
    });

    const invalid = submit('108', { cases: '1.5', keys: '1' });
    await hom.modal(invalid);
    expect(invalid.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('số nguyên') }));
    expect((await disk.read('1')).skinCases).toBeUndefined();

    const oldForm = submit('107', { cases: '4', keys: '3' });
    oldForm.customId = 'mg_hom_order_crate-4904_1500_60000';
    await hom.modal(oldForm);
    expect(oldForm.editReply.mock.calls[0][0].embeds[0].toJSON().footer.text).toContain('Giá chìa đã đổi');
    expect((await disk.read('1')).taixiu.balances[player.id]).toBe(246000);
    expect((await disk.read('1')).skinCases).toBeUndefined();

    const order = submit('109', { cases: '4', keys: '3' });
    await hom.modal(order);
    expect(order.deferUpdate).toHaveBeenCalled();
    expect(order.editReply.mock.calls[0][0].embeds[0].toJSON().footer.text)
        .toBe('Đã mua 4 hòm và 3 chìa · Tổng 186,000 xu');
    await hom.modal(submit('109', { cases: '4', keys: '3' }));

    const rejected = submit('110', { cases: '1', keys: '1' });
    await hom.modal(rejected);
    expect(rejected.editReply.mock.calls[0][0].embeds[0].toJSON().footer.text).toContain('Cần 61,500 xu');
    const saved = await disk.read('1');
    expect(saved.taixiu.balances[player.id]).toBe(60000);
    expect(saved.skinCases[player.id]).toMatchObject({ cases: { 'crate-4904': 4 }, keys: { 'key-1394': 3 } });

    await hom.modal(submit('111', { keys: '1' }));
    const final = await disk.read('1');
    expect(final.taixiu.balances[player.id]).toBe(0);
    expect(final.skinCases[player.id]).toMatchObject({ cases: { 'crate-4904': 4 }, keys: { 'key-1394': 4 } });
});

test('CS2 case view shows a missing BUFF price and can display the next synchronized quote', async () => {
    const { createMember, interaction } = fixture();
    const player = createMember('13');
    await disk.transact('1', async (state, save) => {
        state.taixiu.balances[player.id] = 10_000;
        await save();
    });
    cs2Market.peekMarketQuote.mockReturnValue(null);
    const preview = interaction(player);
    await hom.execute(preview);
    const pending = preview.editReply.mock.calls[0][0];
    expect(preview.editReply).toHaveBeenCalledTimes(1);
    expect(pending.embeds[0].toJSON().fields[0].value).toContain('Chưa có giá BUFF.163');
    expect(pending.components.flatMap(row => row.toJSON().components)).toEqual(expect.arrayContaining([
        expect.objectContaining({ label: 'Kho đồ', disabled: false }),
        expect.objectContaining({ label: 'Mua hòm', disabled: true })
    ]));
    const controls = pending.components.flatMap(row => row.toJSON().components);
    const refresh = controls.find(control => control.label === 'Xem giá đã đồng bộ');
    expect(refresh.custom_id).toBe('mg_hom_case-price_crate-4904');
    cs2Market.peekMarketQuote.mockReturnValue(quoteFor('Kilowatt Case', 3701));
    const click = interaction(player, { customId: refresh.custom_id });
    await hom.button(click);
    const updated = click.editReply.mock.calls.at(-1)[0].embeds[0].toJSON();
    expect(updated.fields[0].value).toContain('3,701 xu');
    expect(updated.footer.text).toContain('Lần đồng bộ tiếp theo');

    cs2Market.peekMarketQuote.mockReturnValue(null);
    const saved = { ...quoteFor('Kilowatt Case', 3501), expiresAt: Date.now() - 240_000 };
    jest.spyOn(cs2Market, 'peekMarketDisplay').mockReturnValue({ status: 'estimate', quote: saved });
    const failed = interaction(player, { customId: refresh.custom_id });
    await hom.button(failed);
    const fallback = failed.editReply.mock.calls.at(-1)[0];
    expect(fallback.embeds[0].toJSON().fields[0].value).toContain('Giá đã lưu **3,501 xu**');
    expect(fallback.components.flatMap(row => row.toJSON().components)
        .find(control => control.label === 'Mua hòm').disabled).toBe(true);
});

test('CS2 uses the same local BUFF prices for case, inventory and purchase without a network lookup', async () => {
    const request = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Unexpected network request'));
    const { createMember, interaction } = fixture();
    const player = createMember('13');
    const caseId = 'crate-4904';
    const weaponCase = cs2Catalog.cases.find(item => item.id === caseId);
    const drop = { id: '8801', caseId, skinId: weaponCase.pools[0][0], tier: 0, float: 0.15, statTrak: false };
    const skinName = `${cs2Catalog.skins[drop.skinId].name} (Field-Tested)`;
    const snapshotQuote = (name, value) => ({ ...quoteFor(name, value), source: 'buff', url: 'https://buff.163.com/goods/12345' });
    const prices = new Map([['Kilowatt Case', snapshotQuote('Kilowatt Case', 3500)], [skinName, snapshotQuote(skinName, 12000)]]);
    cs2Market.peekMarketQuote.mockImplementation(name => prices.get(name) ?? null);
    await disk.transact('1', async (state, save) => {
        state.taixiu.balances[player.id] = 10_000;
        state.skinCases = { [player.id]: { drops: [drop] } };
        await save();
    });

    const menu = interaction(player);
    await hom.execute(menu);
    expect(menu.editReply).toHaveBeenCalledTimes(1);
    expect(menu.editReply.mock.calls[0][0].embeds[0].toJSON().fields[0].value).toMatch(/^\*\*3,500 xu\*\* mỗi hòm\n<t:\d+:R>$/);
    const inventory = interaction(player, { customId: `mg_hom_inventory_${caseId}` });
    await hom.button(inventory);
    expect(inventory.editReply.mock.calls[0][0].embeds[0].toJSON().description).toContain('12,000 xu');
    const buy = menu.editReply.mock.calls[0][0].components[1].toJSON().components[0];
    prices.set('Kilowatt Case', snapshotQuote('Kilowatt Case', 3600));
    await hom.button(interaction(player, { customId: buy.custom_id }));
    expect((await disk.read('1')).taixiu.balances[player.id]).toBe(10_000);

    prices.set('Kilowatt Case', snapshotQuote('Kilowatt Case', 3500));
    store.transact.mockImplementationOnce((guildId, operation) => disk.transact(guildId, (state, save) => {
        prices.delete('Kilowatt Case');
        return operation(state, save);
    }));
    const expiredCheckout = interaction(player, { customId: buy.custom_id });
    await hom.button(expiredCheckout);
    expect((await disk.read('1')).taixiu.balances[player.id]).toBe(10_000);
    expect(expiredCheckout.editReply.mock.calls[0][0].embeds[0].toJSON().footer.text).toContain('Giá hòm đã hết hạn');
    expect(request).not.toHaveBeenCalled();
});

test('CS2 cases charge the exact displayed BUFF price and refuse changed or unavailable prices', async () => {
    const { createMember, interaction } = fixture();
    const player = createMember('13');
    await disk.transact('1', async (state, save) => {
        state.taixiu.balances[player.id] = 63701;
        await save();
    });
    let priceVnd = 3501;
    cs2Market.peekMarketQuote.mockImplementation(name => priceVnd ? quoteFor(name, priceVnd) : null);
    const click = (id, customId) => interaction(player, { id, customId });
    const controls = payload => payload.components.flatMap(row => row.toJSON().components);
    const preview = interaction(player);
    await hom.execute(preview);
    const initial = preview.editReply.mock.calls[0][0];
    const priceField = initial.embeds[0].toJSON().fields[0];
    expect(priceField.name).toBe('Giá mua hòm');
    expect(priceField.value).toMatch(/^\*\*3,501 xu\*\* mỗi hòm\n<t:\d+:R>$/);
    expect(priceField.value).not.toMatch(/[₫]|VNĐ|VND/);
    const buy = controls(initial).find(button => button.label === 'Mua hòm · 3,501 xu');
    const bulk = controls(initial).find(button => button.label === 'Mua nhiều');
    const order = interaction(player, { customId: bulk.custom_id, showModal: jest.fn() });
    await hom.button(order);
    const [casesField] = order.showModal.mock.calls[0][0].toJSON().components;
    expect(casesField.label ?? casesField.components[0].label).toBe('Số hòm · 3,501 xu/cái');
    const previousPricing = click('204', 'mg_hom_buy_crate-4904_3501');
    await hom.button(previousPricing);
    expect(previousPricing.editReply.mock.calls[0][0].embeds[0].toJSON().footer.text).toContain('Giá hòm đã đổi');
    expect((await disk.read('1')).taixiu.balances[player.id]).toBe(63701);
    expect((await disk.read('1')).skinCases).toBeUndefined();
    priceVnd = 3701;
    const stale = click('205', buy.custom_id);
    await hom.button(stale);
    expect((await disk.read('1')).skinCases).toBeUndefined();
    const refreshed = stale.editReply.mock.calls[0][0];
    expect(refreshed.embeds[0].toJSON().footer.text).toContain('Giá hòm đã đổi');
    const newBuy = controls(refreshed).find(button => button.label === 'Mua hòm · 3,701 xu');
    await hom.button(click('206', newBuy.custom_id));
    const purchased = await disk.read('1');
    expect(purchased.taixiu.balances[player.id]).toBe(60000);
    expect(purchased.skinCases[player.id].cases['crate-4904']).toBe(1);
    priceVnd = null;
    cs2Market.peekMarketQuote.mockReturnValue(null);
    const noPrice = click('207', newBuy.custom_id);
    await hom.button(noPrice);
    const unavailable = noPrice.editReply.mock.calls[0][0];
    expect(controls(unavailable).find(button => button.label === 'Mua hòm').disabled).toBe(true);
    expect(controls(unavailable).find(button => button.label === 'Mua chìa · 60,000 xu').disabled).toBe(false);
    expect(await disk.read('1')).toEqual(purchased);
});

test('CS2 inventory shows exact item prices and a whole-inventory subtotal across pages', async () => {
    const { createMember, interaction } = fixture();
    const player = createMember('13');
    const caseId = 'crate-4904';
    const skinId = cs2Catalog.cases.find(item => item.id === caseId).pools[0][0];
    const skin = cs2Catalog.skins[skinId];
    const regular = `${skin.name} (Field-Tested)`;
    const tracked = `StatTrak™ ${skin.name} (Field-Tested)`;
    const unavailable = `${skin.name} (Minimal Wear)`;
    const prices = new Map([[regular, 12349], [tracked, 2399]]);
    cs2Market.peekMarketQuote.mockImplementation(name => prices.has(name) ? quoteFor(name, prices.get(name)) : null);
    const drops = Array.from({ length: 13 }, (_, i) => ({
        id: String(500 + i), caseId, skinId, tier: 0, float: i === 12 ? 0.1 : 0.15, statTrak: i === 10 || i === 11
    }));
    await disk.transact('1', async (state, save) => {
        state.skinCases = { [player.id]: { drops, cases: { [caseId]: 2 }, keys: { 'key-1394': 3 }, items: { 'karambit-amber': 2 } } };
        await save();
    });
    const inventory = interaction(player, { customId: `mg_hom_inventory_${caseId}` });
    await hom.button(inventory);
    expect(inventory.editReply).toHaveBeenCalledTimes(1);
    const payload = inventory.editReply.mock.calls.at(-1)[0];
    const firstPage = payload.embeds[0].toJSON();
    expect(firstPage.description).toContain('12,349 xu');
    expect(firstPage.description).toContain('Chưa có giá BUFF.163');
    expect(firstPage.fields[0]).toMatchObject({ name: 'Tổng giá trị tạm tính', value: expect.stringContaining('308,288 xu') });
    expect(firstPage.description + firstPage.fields[0].value).not.toMatch(/[₫]|VNĐ|VND/);
    expect(firstPage.fields[0].value).toContain('15/20 món');
    expect(firstPage.footer.text).toBe('Trang 1/2');
    expect(cs2Market.peekMarketQuote.mock.calls.map(([name]) => name)).toEqual(expect.arrayContaining([unavailable, tracked, regular]));
    const controls = payload.components.flatMap(row => row.toJSON().components);
    const itemMenu = controls.find(control => control.custom_id?.startsWith('mg_hom_inventory-select_'));
    expect(itemMenu.options).toHaveLength(12);
    expect(itemMenu.options.map(option => option.description)).toEqual(expect.arrayContaining([
        expect.stringMatching(/^12,349 xu · Field-Tested · 0\.150000 · .*Kilowatt Collection/),
        expect.stringMatching(/^2,399 xu · Field-Tested · 0\.150000 · .*Kilowatt Collection/),
        expect.stringMatching(/^Chưa có giá · Minimal Wear · 0\.100000 · .*Kilowatt Collection/)
    ]));
    const next = interaction(player, { customId: controls.find(control => control.label === 'Trang sau').custom_id });
    prices.set('Kilowatt Case', 3501);
    await hom.button(next);
    const lastPage = next.editReply.mock.calls.at(-1)[0].embeds[0].toJSON();
    expect(lastPage.description).toContain('Kilowatt Case · ×2');
    expect(lastPage.description).toContain('3,501 xu**/món');
    expect(lastPage.description).toContain('60,000 xu**/món');
    expect(lastPage.fields[0].value).toContain('315,290 xu');
    expect(lastPage.fields[0].value).toContain('17/20 món');
});

test('CS2 inventory displays newly refreshed prices even if its artwork upload fails', async () => {
    const { createMember, interaction } = fixture();
    const player = createMember('13');
    const caseId = 'crate-4904';
    const skinId = cs2Catalog.cases.find(item => item.id === caseId).pools[0][0];
    const drop = { id: '1000', caseId, skinId, tier: 0, float: 0.15, statTrak: false };
    await disk.transact('1', async (state, save) => {
        state.skinCases = { [player.id]: { drops: [drop] } };
        await save();
    });
    cs2Market.peekMarketQuote.mockImplementation(name => quoteFor(name, 12_349));
    jest.spyOn(cs2InventoryArt, 'renderInventoryGrid').mockResolvedValue({ png: Buffer.from('inventory-grid'), hasLabels: true });
    const inventory = interaction(player, { customId: `mg_hom_inventory_${caseId}`, attachmentSizeLimit: 10_000_000 });
    inventory.editReply.mockImplementation(async payload => {
        if (payload.files) throw new Error('Artwork upload failed');
    });
    await hom.button(inventory);
    expect(inventory.editReply.mock.calls[0][0].embeds[0].toJSON().description).toContain('12,349 xu');
    const fallback = inventory.editReply.mock.calls.at(-1)[0];
    expect(fallback.files).toBeUndefined();
    expect(fallback.embeds[0].toJSON().description).toContain('12,349 xu');
    expect(fallback.embeds[0].toJSON().footer.text).toBe('Trang 1/1');
    expect(fallback.components.flatMap(row => row.toJSON().components)
        .find(control => control.custom_id?.startsWith('mg_hom_inventory-select_')).options[0].value).toBe('drop_1000');
});

test('CS2 inventory orders rarities before paging and returns inspected weapons to their sorted page', async () => {
    const { createMember, interaction } = fixture();
    const player = createMember('13');
    const weaponCase = cs2Catalog.cases.find(item => item.id === 'crate-4904');
    const drops = [4, 0, 2, 1, 0, 3, 1, 2, 0, 1, 2, 0, 4, 0].map((tier, index) => {
        const skinId = weaponCase.pools[tier][0];
        const skin = cs2Catalog.skins[skinId];
        const float = skin.min == null ? null : Math.round((skin.min + skin.max) * 500_000) / 1_000_000;
        return { id: String(500 + index), caseId: weaponCase.id, skinId, tier, float, statTrak: false };
    });
    await disk.transact('1', async (state, save) => {
        state.skinCases = { [player.id]: { drops } };
        await save();
    });
    const controls = click => click.editReply.mock.calls.at(-1)[0].components.flatMap(row => row.toJSON().components);
    const open = interaction(player, { customId: `mg_hom_inventory_${weaponCase.id}` });
    await hom.button(open);
    expect(controls(open).find(component => component.custom_id?.startsWith('mg_hom_inventory-select_')).options.map(option => option.value)).toEqual(
        [512, 500, 505, 510, 507, 502, 509, 506, 503, 513, 511, 508].map(id => `drop_${id}`)
    );
    const next = interaction(player, { customId: controls(open).find(button => button.label === 'Trang sau').custom_id });
    await hom.button(next);
    expect(controls(next).find(component => component.custom_id?.startsWith('mg_hom_inventory-select_')).options.map(option => option.value)).toEqual(['drop_504', 'drop_501']);

    const inspect = interaction(player, { customId: `mg_hom_inspect_${weaponCase.id}_500` });
    await hom.button(inspect);
    expect(controls(inspect).find(button => button.label === 'Về kho').custom_id).toBe(`mg_hom_inventory_${weaponCase.id}_0`);
    expect((await disk.read('1')).skinCases[player.id].drops).toEqual(drops);
});

test('CS2 inventory attaches each numbered weapon card to its existing selection and retains other items', async () => {
    const { createMember, interaction } = fixture();
    const player = createMember('13');
    const weaponCase = cs2Catalog.cases.find(item => item.id === 'crate-4904');
    const [first, second] = weaponCase.pools[0];
    const drops = [first, second].map((skinId, index) => ({
        id: String(500 + index), caseId: weaponCase.id, skinId, tier: 0, float: 0.15, statTrak: false
    }));
    await disk.transact('1', async (state, save) => {
        state.skinCases = { [player.id]: { drops, cases: { [weaponCase.id]: 2 } } };
        await save();
    });
    cs2Market.peekMarketQuote.mockImplementation(name => quoteFor(name, 3501));
    const png = Buffer.from('inventory-grid');
    const render = jest.spyOn(cs2InventoryArt, 'renderInventoryGrid').mockResolvedValue({ png, hasLabels: true });
    const open = interaction(player, { customId: `mg_hom_inventory_${weaponCase.id}`, attachmentSizeLimit: 10_000_000 });
    await hom.button(open);
    expect(render).toHaveBeenCalledWith([second, first].map((skinId, index) => expect.objectContaining({
        number: index + 1, name: cs2Catalog.skins[skinId].name, fallback: cs2Catalog.skins[skinId].image,
        detail: 'Field-Tested · Float 0.150000', price: '3,501 xu'
    })), 5_000_000);
    const payload = open.editReply.mock.calls.at(-1)[0];
    const embed = payload.embeds[0].toJSON();
    expect(embed.image).toBeUndefined();
    expect(embed.description).toContain('Kilowatt Case · ×2');
    expect(payload.files).toEqual([expect.objectContaining({ name: 'cs2-inventory.png', attachment: png })]);
    const menu = payload.components.flatMap(row => row.toJSON().components)
        .find(control => control.custom_id?.startsWith('mg_hom_inventory-select_'));
    expect(menu.options.map(({ label, value }) => [label, value])).toEqual([
        [`1. ${cs2Catalog.skins[second].name}`, 'drop_501'],
        [`2. ${cs2Catalog.skins[first].name}`, 'drop_500']
    ]);
    const fallback = interaction(player, { customId: open.customId, attachmentSizeLimit: 10_000_000 });
    fallback.editReply.mockImplementation(async payload => {
        if (payload.files) throw new Error('Attachment unavailable');
    });
    await hom.button(fallback);
    const textOnly = fallback.editReply.mock.calls[0][0];
    expect(textOnly.files).toBeUndefined();
    expect(textOnly.embeds[0].toJSON().description).toContain(cs2Catalog.skins[first].name);
});

test('CS2 inventory displays twelve selectable weapons as two stacked image grids on one page', async () => {
    const { createMember, interaction } = fixture();
    const player = createMember('13');
    const weaponCase = cs2Catalog.cases.find(item => item.id === 'crate-4904');
    const drops = Array.from({ length: 12 }, (_, index) => ({
        id: String(500 + index), caseId: weaponCase.id, skinId: weaponCase.pools[0][0],
        tier: 0, float: 0.15, statTrak: false
    }));
    await disk.transact('1', async (state, save) => {
        state.skinCases = { [player.id]: { drops } };
        await save();
    });
    cs2Market.peekMarketQuote.mockImplementation(name => quoteFor(name, 3501));
    const render = jest.spyOn(cs2InventoryArt, 'renderInventoryGrid')
        .mockResolvedValue({ png: Buffer.from('inventory-grid'), hasLabels: true });
    const open = interaction(player, { customId: `mg_hom_inventory_${weaponCase.id}`, attachmentSizeLimit: 10_000_000 });
    await hom.button(open);
    expect(render.mock.calls.map(([cards]) => cards.map(card => card.number))).toEqual([
        [1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12]
    ]);
    const payload = open.editReply.mock.calls.at(-1)[0];
    expect(payload.embeds[0].toJSON().footer.text).toBe('Trang 1/1');
    expect(payload.embeds.slice(1).map(embed => embed.toJSON().image.url)).toEqual([
        'attachment://cs2-inventory.png', 'attachment://cs2-inventory-2.png'
    ]);
    expect(payload.files.map(file => file.name)).toEqual(['cs2-inventory.png', 'cs2-inventory-2.png']);
    expect(payload.components.flatMap(row => row.toJSON().components)
        .find(control => control.custom_id?.startsWith('mg_hom_inventory-select_')).options).toHaveLength(12);
});

test('CS2 inventory can inspect an exact saved gun and return to the same page', async () => {
    const { createMember, interaction } = fixture();
    const player = createMember('13');
    const caseId = 'crate-4904';
    const origin = 'crate-4880';
    const skinId = cs2Catalog.cases.find(item => item.id === caseId).pools[0][0];
    const drops = Array.from({ length: 13 }, (_, index) => ({
        id: String(500 + index), caseId, skinId, tier: 0, float: index ? 0.15 : 0.185, statTrak: !index
    }));
    await disk.transact('1', async (state, save) => {
        state.skinCases = { [player.id]: { drops } };
        await save();
    });
    const before = await disk.read('1');
    cs2Market.peekMarketQuote.mockImplementation(name => quoteFor(name, 12349));
    const controls = payload => payload.components.flatMap(row => row.toJSON().components);
    const read = click => click.editReply.mock.calls.at(-1)[0];
    const page = interaction(player, { customId: `mg_hom_inventory_${origin}_1` });
    await hom.button(page);
    const menu = controls(read(page)).find(control => control.custom_id?.startsWith('mg_hom_inventory-select_'));
    expect(menu.placeholder).toBe('Chọn súng để xem lại hoặc khóa');
    expect(menu.options.map(option => option.value)).toEqual(['drop_500']);
    const selection = interaction(player, { customId: menu.custom_id, values: ['drop_500'] });
    await hom.select(selection);
    const shown = read(selection);
    const embed = shown.embeds[0].toJSON();
    expect(embed.title).toBe(`StatTrak™ ${cs2Catalog.skins[skinId].name}`);
    expect(embed.fields).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'Tình trạng', value: 'Field-Tested' }),
        expect.objectContaining({ name: 'Float', value: '0.185000' }),
        expect.objectContaining({ name: 'Seed', value: '—' }),
        expect.objectContaining({ name: 'Giá BUFF.163', value: expect.stringContaining('12,349 xu') })
    ]));
    expect(JSON.stringify(embed)).toContain('Kilowatt Collection');
    expect(embed.fields.some(field => field.name === 'Ngày nhận')).toBe(false);
    const buttons = controls(shown);
    expect(buttons.find(control => control.label === 'Mở ảnh gốc').url).toBe(embed.image.url);
    expect(buttons.some(control => control.custom_id?.startsWith('mg_hom_replay_'))).toBe(false);
    const sale = interaction(player, { customId: buttons.find(control => control.label === 'Bán lấy xu').custom_id });
    await hom.button(sale);
    const cancel = interaction(player, { customId: controls(read(sale)).find(control => control.label === 'Hủy').custom_id });
    await hom.button(cancel);
    const back = controls(read(cancel)).find(control => control.label === 'Về kho');
    expect(back.custom_id).toBe(`mg_hom_inventory_${origin}_1`);
    const returning = interaction(player, { customId: back.custom_id });
    await hom.button(returning);
    expect(read(returning).embeds[0].toJSON().footer.text).toContain('Trang 2/2');
    expect(await disk.read('1')).toEqual(before);
});

test('CS2 inventory details attach the exact skin artwork and fall back to the same skin', async () => {
    const { createMember, interaction } = fixture();
    const player = createMember('13');
    const weaponCase = cs2Catalog.cases.find(item => item.name === 'eSports 2013 Winter Case');
    const skinId = 'skin-6747a1a6fb43';
    const drop = { id: '500', caseId: weaponCase.id, skinId, tier: 2, float: 0.125704, statTrak: false };
    await disk.transact('1', async (state, save) => {
        state.skinCases = { [player.id]: { drops: [drop] } };
        await save();
    });
    const original = cs2Catalog.skins[skinId].image;
    const png = Buffer.from('weapon image');
    const artwork = jest.spyOn(cs2Reel, 'cachedImage').mockResolvedValue(png);
    const select = () => interaction(player, {
        customId: `mg_hom_inventory-select_${weaponCase.id}_0`, values: ['drop_500'], attachmentSizeLimit: 10_000_000
    });
    const inspect = select();
    await hom.select(inspect);
    const [preferred] = artwork.mock.calls[0];
    expect(preferred).toContain('Cobalt%20Disruption%20Light.png');
    const primary = inspect.editReply.mock.calls.at(-1)[0];
    expect(primary.embeds[0].toJSON().image.url).toBe('attachment://cs2-result.png');
    expect(primary.files).toEqual([expect.objectContaining({ attachment: png, name: 'cs2-result.png' })]);
    expect(primary.components[0].toJSON().components.find(button => button.label === 'Mở ảnh gốc').url).toBe(preferred);

    artwork.mockRejectedValueOnce(new Error('Wear artwork unavailable'));
    const fallback = select();
    await hom.select(fallback);
    expect(artwork.mock.calls.slice(1)).toEqual([[preferred], [original]]);
    const result = fallback.editReply.mock.calls.at(-1)[0];
    expect(result.embeds[0].toJSON().image.url).toBe('attachment://cs2-result.png');
    expect(result.components[0].toJSON().components.find(button => button.label === 'Mở ảnh gốc').url).toBe(original);

    const failedUpload = select();
    failedUpload.editReply.mockImplementation(async payload => {
        if (payload.files) throw new Error('Attachment unavailable');
    });
    await hom.select(failedUpload);
    const remoteImage = failedUpload.editReply.mock.calls.at(-1)[0];
    expect(remoteImage.files).toBeUndefined();
    expect(remoteImage.embeds[0].toJSON().image.url).toBe(original);
});

test('CS2 inventory sells one owned exact variant after confirming the current quote', async () => {
    const { createMember, interaction } = fixture();
    const player = createMember('13');
    const caseId = 'crate-4904';
    const skinId = cs2Catalog.cases.find(item => item.id === caseId).pools[0][0];
    const drop = { id: '221', caseId, skinId, tier: 0, float: 0.15, statTrak: true };
    const unsold = { ...drop, id: '222', statTrak: false };
    await disk.transact('1', async (state, save) => {
        state.taixiu.balances[player.id] = 600;
        state.skinCases = { [player.id]: { drops: [drop, unsold] } };
        await save();
    });
    const hash = `StatTrak™ ${cs2Catalog.skins[skinId].name} (Field-Tested)`;
    let priceVnd = 12349;
    cs2Market.peekMarketQuote.mockImplementation(name => name === hash && priceVnd ? quoteFor(name, priceVnd) : null);
    const controls = payload => payload.components.flatMap(row => row.toJSON().components);
    const inventory = interaction(player, { customId: `mg_hom_inventory_${caseId}` });
    await hom.button(inventory);
    const list = inventory.editReply.mock.calls[0][0];
    expect(controls(list).find(control => control.custom_id?.startsWith('mg_hom_inventory-select_'))
        .options.map(option => option.value)).toEqual(['drop_222', 'drop_221']);
    const details = interaction(player, { values: ['drop_221'] });
    await hom.select(details);
    const item = details.editReply.mock.calls[0][0];
    expect(cs2Market.peekMarketQuote.mock.calls.some(([name]) => name === hash)).toBe(true);
    expect(item.embeds[0].toJSON().fields.at(-1).value).toContain('12,349 xu');
    const sell = controls(item).find(button => button.label === 'Bán lấy xu');
    const sale = interaction(player, { id: '227', customId: sell.custom_id });
    await hom.button(sale);
    const offer = sale.editReply.mock.calls[0][0];
    const accept = controls(offer).find(button => button.label === 'Xác nhận bán');
    expect(offer.embeds[0].toJSON().description).toContain('12,349 xu');
    const pending = await disk.read('1');
    const unauthorized = interaction(createMember('14'), { id: '228', customId: accept.custom_id });
    await hom.button(unauthorized);
    expect(unauthorized.followUp).toHaveBeenCalled();
    expect(await disk.read('1')).toEqual(pending);
    const previousPricing = interaction(player, { id: '234', customId: `mg_hom_confirm-sale_${caseId}_${drop.id}_12349` });
    await hom.button(previousPricing);
    expect(previousPricing.editReply.mock.calls[0][0].embeds[0].toJSON().footer.text).toContain('Giá đã đổi');
    expect(await disk.read('1')).toEqual(pending);
    priceVnd = 12359;
    const old = interaction(player, { id: '229', customId: accept.custom_id });
    await hom.button(old);
    expect(await disk.read('1')).toEqual(pending);
    const updated = old.editReply.mock.calls[0][0];
    expect(updated.embeds[0].toJSON().footer.text).toContain('Giá đã đổi');
    const newAccept = controls(updated).find(button => button.label === 'Xác nhận bán');
    const click = id => interaction(player, { id, customId: newAccept.custom_id });
    cs2Market.peekMarketQuote.mockReturnValueOnce({ ...quoteFor(hash, priceVnd), expiresAt: Date.now() - 1 });
    const expired = click('233');
    await hom.button(expired);
    expect(expired.editReply.mock.calls[0][0].embeds[0].toJSON().footer.text).toContain('Giá đã hết hạn');
    expect(await disk.read('1')).toEqual(pending);
    const sold = click('230');
    await Promise.all([hom.button(sold), hom.button(click('231'))]);
    await hom.button(click('232'));
    const settled = await disk.read('1');
    expect(settled.taixiu.balances[player.id]).toBe(12959);
    expect(settled.skinCases[player.id].drops).toEqual([unsold]);
    expect(sold.editReply.mock.calls[0][0].embeds[0].toJSON().footer.text).toContain('+12,359 xu');
    const savedPrice = { ...quoteFor(hash, 10019), expiresAt: Date.now() - 1 };
    jest.spyOn(cs2Market, 'peekMarketDisplay').mockReturnValue({ status: 'estimate', quote: savedPrice });
    const noPrice = interaction(player, { values: ['drop_222'] });
    await hom.select(noPrice);
    const estimate = noPrice.editReply.mock.calls[0][0];
    expect(estimate.embeds[0].toJSON().fields.at(-1).value).toContain('Giá đã lưu');
    expect(controls(estimate).some(button => button.label === 'Bán lấy xu')).toBe(false);
});

test('CS2 inventory previews a multi-item sale and credits it once only after confirming the matching total', async () => {
    const { createMember, interaction } = fixture();
    const player = createMember('13');
    const caseId = 'crate-4904';
    const skinId = cs2Catalog.cases.find(item => item.id === caseId).pools[0][0];
    const regular = { id: '310', caseId, skinId, tier: 0, float: 0.15, statTrak: false };
    const tracked = { ...regular, id: '311', statTrak: true };
    const keep = { ...regular, id: '312' };
    await disk.transact('1', async (state, save) => {
        state.taixiu.balances[player.id] = 600;
        state.skinCases = { [player.id]: { drops: [regular, tracked, keep] } };
        await save();
    });
    let normalPrice = 2009;
    const quote = name => {
        const price = name.startsWith('StatTrak™') ? 12349 : normalPrice;
        return price ? quoteFor(name, price) : null;
    };
    cs2Market.peekMarketQuote.mockImplementation(quote);
    const click = (customId, options = {}) => interaction(player, { customId, message: { id: '800' }, ...options });
    const controls = payload => payload.components.flatMap(row => row.toJSON().components);
    const accept = payload => controls(payload).find(control => control.label === 'Xác nhận bán');
    const edited = request => request.editReply.mock.calls.at(-1)[0];
    const inventory = click(`mg_hom_inventory_${caseId}`);
    await hom.button(inventory);
    const menu = controls(edited(inventory)).find(control => control.custom_id?.startsWith('mg_hom_inventory-select_'));
    expect(menu.max_values).toBe(3);
    const select = async () => {
        const request = click(menu.custom_id, { values: ['drop_310', 'drop_311'] });
        await hom.select(request);
        return edited(request);
    };
    const initial = await disk.read('1');
    normalPrice = null;
    const unavailable = await select();
    expect(accept(unavailable).disabled).toBe(true);
    expect(unavailable.embeds[0].toJSON().description).toContain('Chưa có giá bán');
    expect(await disk.read('1')).toEqual(initial);

    normalPrice = 2009;
    const preview = await select();
    expect(preview.embeds[0].toJSON().description).toContain('Tổng nhận **14,358 xu**');
    const original = accept(preview).custom_id;
    const wrongMessage = click(original, { message: { id: '801' } });
    await hom.button(wrongMessage);
    expect(wrongMessage.followUp).toHaveBeenCalled();
    expect(await disk.read('1')).toEqual(initial);

    normalPrice = 2039;
    const stale = click(original);
    await hom.button(stale);
    const refreshed = edited(stale);
    expect(refreshed.embeds[0].toJSON().footer.text).toContain('Giá đã thay đổi');
    expect(refreshed.embeds[0].toJSON().description).toContain('Tổng nhận **14,388 xu**');
    expect(await disk.read('1')).toEqual(initial);
    const confirmId = accept(refreshed).custom_id;
    const confirmation = click(confirmId);
    await Promise.all([hom.button(confirmation), hom.button(click(confirmId))]);
    await hom.button(click(confirmId));
    const receipt = edited(confirmation).embeds[0].toJSON();
    expect(receipt.footer.text).toContain('Đã bán 2 món · +14,388 xu');
    expect(receipt.fields[0]).toMatchObject({ name: 'Tổng giá trị kho', value: expect.stringContaining('2,039 xu') });
    const saved = await disk.read('1');
    expect(saved.taixiu.balances[player.id]).toBe(14988);
    expect(saved.skinCases[player.id].drops).toEqual([keep]);
});

test('CS2 bulk sale keeps the remaining items and wallet when a selected drop leaves the inventory', async () => {
    const { createMember, interaction } = fixture();
    const player = createMember('13');
    const caseId = 'crate-4904';
    const skinId = cs2Catalog.cases.find(item => item.id === caseId).pools[0][0];
    const drop = { id: '410', caseId, skinId, tier: 0, float: 0.15, statTrak: false };
    await disk.transact('1', async (state, save) => {
        state.skinCases = { [player.id]: { drops: [drop, { ...drop, id: '411' }] } };
        await save();
    });
    cs2Market.peekMarketQuote.mockImplementation(name => quoteFor(name, 1500));
    const review = interaction(player, { customId: `mg_hom_inventory-select_${caseId}_0`, values: ['drop_410', 'drop_411'] });
    await hom.select(review);
    const confirmId = review.editReply.mock.calls[0][0].components[0].toJSON().components[0].custom_id;
    await disk.transact('1', async (state, save) => {
        state.skinCases[player.id].drops.pop();
        await save();
    });
    const before = await disk.read('1');
    const confirm = interaction(player, { customId: confirmId });
    await hom.button(confirm);
    expect(confirm.editReply.mock.calls[0][0].embeds[0].toJSON().footer.text).toContain('Kho đã thay đổi');
    expect(await disk.read('1')).toEqual(before);
});

test('CS2 results let players reopen the same case while they have a matching key', async () => {
    const { createMember, interaction } = fixture();
    const player = createMember('13');
    const huntsman = cs2Catalog.cases.find(item => item.name === 'Huntsman Weapon Case');
    await disk.transact('1', async (state, save) => {
        state.skinCases = { [player.id]: {
            cases: { [huntsman.id]: 3 },
            keys: { [huntsman.key]: 2, 'key-1394': 1 }
        } };
        await save();
    });
    jest.spyOn(cs2Reel, 'renderCaseReel').mockResolvedValue(null);
    const draw = jest.spyOn(crypto, 'randomInt').mockReturnValue(0);
    let openId = `mg_hom_open_${huntsman.id}`;
    for (const [index, [float, exterior]] of [[30000, 'Factory New'], [650000, 'Battle-Scarred']].entries()) {
        draw.mockReturnValueOnce(3875).mockReturnValueOnce(0).mockReturnValueOnce(float).mockReturnValueOnce(1);
        const opening = interaction(player, { id: String(108 + index), customId: openId });
        await hom.button(opening);
        const payload = opening.editReply.mock.calls.at(-1)[0];
        const result = payload.embeds[0].toJSON();
        expect(result.title).toBe('AK-47 | Vulcan');
        expect(result.footer.text).toContain('Món đã lưu vào kho');
        expect(result.footer.text).not.toContain('Có thể xem lại');
        expect(payload.components.flatMap(row => row.toJSON().components)
            .some(control => control.custom_id?.startsWith('mg_hom_replay_'))).toBe(false);
        expect(result.fields.find(field => field.name === 'Tình trạng').value).toBe(exterior);
        expect(decodeURIComponent(result.image.url)).toContain(`/ak47/thumbnails/Vulcan ${index === 0 ? 'Light' : 'Heavy'}.png`);
        const next = payload.components[0].toJSON().components.find(control => control.label === 'Mở tiếp');
        if (index === 0) {
            expect(next?.custom_id).toBe(openId);
            openId = next.custom_id;
        } else {
            expect(next).toBeUndefined();
        }
    }
    const stash = (await disk.read('1')).skinCases[player.id];
    expect(stash.cases[huntsman.id]).toBe(1);
    expect(stash.keys).toEqual({ [huntsman.key]: 0, 'key-1394': 1 });
    expect(stash.drops).toHaveLength(2);
});

test('CS2 cases replace the finished GIF with the saved drop and exact price in a static result', async () => {
    jest.useFakeTimers();
    const art = Buffer.from('static PNG');
    cs2Reel.renderResultArtwork.mockResolvedValue(art);
    jest.spyOn(cs2Reel, 'cachedImage').mockResolvedValue(art);
    const marketName = '★ StatTrak™ Kukri Knife';
    cs2Market.peekMarketQuote.mockImplementation(name => name === marketName ? quoteFor(name, 12600500) : testMarketPrice(name));
    const draw = jest.spyOn(crypto, 'randomInt').mockReturnValueOnce(3909).mockReturnValue(0);
    let finishRender;
    const animation = jest.spyOn(cs2Reel, 'renderCaseReel').mockImplementation(() => new Promise(resolve => { finishRender = resolve; }));
    const { admin, createChannel, createMember, interaction } = fixture();
    const chat = createChannel('10', ChannelType.GuildText);
    const player = createMember('13');
    await disk.transact('1', async (state, save) => {
        state.taixiu.balances[player.id] = 62000;
        await save();
    });
    await setup.execute(interaction(admin, { options: { getSubcommand: () => 'tiembanh', getChannel: () => chat } }));
    const preview = interaction(player);
    await hom.execute(preview);
    expect(preview.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    const panel = preview.editReply.mock.calls[0][0];
    expect(panel.embeds[0].toJSON()).toMatchObject({ title: 'Kilowatt Case', description: expect.stringContaining('Kilowatt Case Key') });
    expect(panel.embeds[0].toJSON().fields.find(field => field.name === 'Giá chìa').value).toBe('**60,000 xu** mỗi chìa');
    expect(panel.embeds[0].toJSON().fields.find(field => field.name === 'Tỉ lệ rơi').value).toContain('⭐ Rare Special Item · **0,256%**');
    const [buy, key] = panel.components[1].toJSON().components;
    const [open, openWithSound] = panel.components[2].toJSON().components;
    expect(buy.label).toBe('Mua hòm · 1,500 xu');
    expect(key.label).toBe('Mua chìa · 60,000 xu');
    expect(open.disabled).toBe(true);
    expect(openWithSound.disabled).toBe(true);
    const click = (id, customId) => interaction(player, { id, customId, attachmentSizeLimit: 10_000_000 });
    await hom.button(click('108', buy.custom_id));
    const oldKey = click('107', 'mg_hom_key_crate-4904_60000');
    await hom.button(oldKey);
    expect(oldKey.editReply.mock.calls[0][0].embeds[0].toJSON().footer.text).toContain('Giá chìa đã đổi');
    expect((await disk.read('1')).taixiu.balances[player.id]).toBe(60500);
    await hom.button(click('109', key.custom_id));
    await hom.button(click('109', key.custom_id));
    expect((await disk.read('1')).taixiu.balances[player.id]).toBe(500);
    const opening = click('110', open.custom_id);
    opening.editReply.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Attachment upload rejected'));
    const receipt = hom.button(opening);
    const loading = opening.update.mock.calls[0][0];
    expect(loading.embeds[0].toJSON()).toMatchObject({ description: 'Đang chuẩn bị dải quay…' });
    expect(loading.embeds[0].toJSON().image).toBeUndefined();
    expect(loading.attachments).toEqual([]);
    expect(loading.components).toEqual([]);
    expect(opening.deferUpdate).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(0);
    await disk.transact('1', async () => {});
    await jest.advanceTimersByTimeAsync(0);
    const charged = await disk.read('1');
    const rare = cs2Catalog.cases.find(item => item.id === 'crate-4904').pools[4][0];
    const saved = charged.skinCases[player.id];
    expect(charged.taixiu.balances[player.id]).toBe(500);
    expect(saved.cases['crate-4904']).toBe(0);
    expect(saved.keys['key-1394']).toBe(0);
    expect(saved.drops).toEqual([{ id: '110', caseId: 'crate-4904', skinId: rare, tier: 4, float: null, statTrak: true,
        reelSeed: expect.any(Number), acquiredAt: expect.any(Number) }]);
    expect(draw).toHaveBeenCalledWith(3910);
    expect(opening.editReply).not.toHaveBeenCalled();
    expect(cs2Reel.renderResultArtwork).not.toHaveBeenCalled();
    const [cards, selectedIndex, animatedResult] = animation.mock.calls[0];
    expect(cards[selectedIndex]).toEqual({ color: '#e4ae39', mystery: 'crate_community_33_rare_item.png' });
    expect(cards.filter(card => card.mystery)).toEqual([cards[selectedIndex]]);
    expect(animatedResult).toMatchObject({ title: 'StatTrak™ ★ Kukri Knife', image: cs2Catalog.skins[rare].image });
    finishRender({ gif: Buffer.from('GIF89a'), audio: null });
    await jest.advanceTimersByTimeAsync(0);
    const running = opening.editReply.mock.calls[0][0];
    expect(cs2Reel.renderResultArtwork).toHaveBeenCalledWith(cs2Catalog.skins[rare].image);
    expect(opening.editReply.mock.invocationCallOrder[0]).toBeLessThan(cs2Reel.renderResultArtwork.mock.invocationCallOrder[0]);
    expect(running.embeds[0].toJSON()).toMatchObject({ title: 'Mở hòm · Kilowatt Case', image: { url: 'attachment://cs2-opening.gif' } });
    expect(running.files[0].name).toBe('cs2-opening.gif');
    expect(running.content).toBeNull();
    expect(cs2Market.peekMarketQuote.mock.calls.some(([name]) => name === marketName)).toBe(false);
    expect(running.components).toEqual([]);
    const rapidClick = click('111', open.custom_id);
    await hom.button(rapidClick);
    expect(rapidClick.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Đang xử lý hòm') }));

    expect(cs2Reel.RARE_REEL_PLAYBACK_MS).toBeGreaterThan(cs2Reel.REEL_PLAYBACK_MS);
    await jest.advanceTimersByTimeAsync(cs2Reel.REEL_PLAYBACK_MS);
    expect(opening.editReply).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(cs2Reel.RARE_REEL_PLAYBACK_MS - cs2Reel.REEL_PLAYBACK_MS - 1);
    expect(opening.editReply).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await receipt;
    expect(cs2Market.peekMarketQuote.mock.calls.some(([name]) => name === marketName)).toBe(true);
    await disk.transact('1', async () => {});
    expect(opening.editReply).toHaveBeenCalledTimes(3);
    const final = opening.editReply.mock.calls[2][0];
    expect(final.attachments).toEqual([]);
    const artFiles = [expect.objectContaining({ name: 'cs2-result.png', attachment: art })];
    expect(opening.editReply.mock.calls[1][0].files).toEqual(artFiles);
    expect(final.files).toBeUndefined();
    expect(final.embeds[0].toJSON()).toMatchObject({
        title: 'StatTrak™ ★ Kukri Knife', image: { url: cs2Catalog.skins[rare].image },
        fields: expect.arrayContaining([expect.objectContaining({ name: 'Giá BUFF.163', value: expect.stringContaining('12,600,500 xu') })])
    });
    const inspect = final.components[0].toJSON().components.find(control => control.label === 'Xem súng trong kho');
    const inspected = click('119', inspect.custom_id);
    await hom.button(inspected);
    const inspectedPayload = inspected.editReply.mock.calls.at(-1)[0];
    expect(inspectedPayload.embeds[0].toJSON().title).toBe('StatTrak™ ★ Kukri Knife');
    expect(inspectedPayload.files[0].name).toBe('cs2-result.png');
    expect(inspectedPayload.components[0].toJSON().components[0].label).toBe('Về kho');
    const other = interaction(createMember('14'), { customId: inspect.custom_id });
    await hom.button(other);
    expect(other.followUp).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }));
    expect(other.editReply).not.toHaveBeenCalled();
    const opened = click('113', inspect.custom_id);
    await hom.button(opened);
    expect(opened.editReply.mock.calls[0][0].attachments).toEqual([]);
    const result = opened.editReply.mock.calls.at(-1)[0].embeds[0].toJSON();
    expect(result.title).toBe('StatTrak™ ★ Kukri Knife');
    expect(result.image.url).toBe('attachment://cs2-result.png');
    expect(chat.messages.edit.mock.calls.at(-1)[1].embeds[1].toJSON().description).toContain('<@13> · **500 xu**');

    expect(final.components.flatMap(row => row.toJSON().components)
        .some(control => control.custom_id?.startsWith('mg_hom_replay_'))).toBe(false);
    const replay = click('118', 'mg_hom_replay_crate-4904_110');
    const beforeReplay = await disk.read('1');
    await hom.button(replay);
    expect(animation).toHaveBeenCalledTimes(1);
    expect(replay.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }));
    expect(replay.editReply).not.toHaveBeenCalled();
    expect(cs2Reel.renderResultArtwork).toHaveBeenCalledTimes(1);
    expect(await disk.read('1')).toEqual(beforeReplay);

    const reopened = store.createManagementStore(root);
    store.read.mockImplementation(reopened.read);
    const collection = click('114', 'mg_hom_inventory_crate-4904');
    await hom.button(collection);
    expect(collection.editReply.mock.calls[0][0].embeds[0].toJSON().description).toContain('StatTrak™ ★ Kukri Knife');
    expect((await reopened.read('2')).skinCases).toBeUndefined();
});

test('CS2 retired replay buttons are rejected before accessing stock or changing saved drops', async () => {
    const { createMember, interaction } = fixture();
    const player = createMember('13');
    const weaponCase = cs2Catalog.cases.find(item => item.id === 'crate-4904');
    const drop = { id: '9901', caseId: weaponCase.id, skinId: weaponCase.pools[4][0], tier: 4, float: null, reelSeed: 34 };
    await disk.transact('1', async (state, save) => {
        state.taixiu.balances[player.id] = 123456;
        state.skinCases = { [player.id]: { cases: { [weaponCase.id]: 2 }, keys: { [weaponCase.key]: 3 }, drops: [drop] } };
        await save();
    });
    const animation = jest.spyOn(cs2Reel, 'renderCaseReel').mockResolvedValue(null);
    const artwork = jest.spyOn(cs2Reel, 'cachedImage');
    const voice = jest.spyOn(cs2Voice, 'prepareCaseVoice');
    const before = await disk.read('1');
    store.read.mockClear();
    store.transact.mockClear();
    for (const [index, suffix] of ['', '_audio', '_crate-4904:2'].entries()) {
        const replay = interaction(player, { id: String(9902 + index), customId: `mg_hom_replay_${weaponCase.id}_${drop.id}${suffix}` });
        await hom.button(replay);
        expect(replay.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral,
            content: expect.stringContaining('Bảng hòm đã cũ') }));
        expect(replay.deferUpdate).not.toHaveBeenCalled();
        expect(replay.editReply).not.toHaveBeenCalled();
    }
    expect(store.read).not.toHaveBeenCalled();
    expect(store.transact).not.toHaveBeenCalled();
    expect(animation).not.toHaveBeenCalled();
    expect(artwork).not.toHaveBeenCalled();
    expect(voice).not.toHaveBeenCalled();
    expect(await disk.read('1')).toEqual(before);
});

test('CS2 sound mode posts a GIF and sends the audio only to voice', async () => {
    jest.useFakeTimers();
    jest.spyOn(crypto, 'randomInt').mockImplementation((min, max) => max === undefined ? 0 : min);
    const gif = Buffer.from('GIF89a');
    const audio = Buffer.from('OggS');
    const render = jest.spyOn(cs2Reel, 'renderCaseReel').mockImplementation(async () => ({ gif, audio }));
    const { createMember, interaction } = fixture();
    const player = createMember('13');
    await disk.transact('1', async (state, save) => {
        state.skinCases = { [player.id]: { cases: { 'crate-4904': 2 }, keys: { 'key-1394': 2 } } };
        await save();
    });
    const menu = interaction(player);
    await hom.execute(menu);
    const sound = menu.editReply.mock.calls[0][0].components[2].toJSON().components[1];
    expect(sound).toMatchObject({ label: 'Mở có tiếng', disabled: false });
    const noVoice = interaction(player, { id: '114', customId: sound.custom_id });
    await hom.button(noVoice);
    expect(noVoice.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Vào phòng thoại') }));
    expect(render).not.toHaveBeenCalled();
    jest.spyOn(cs2Voice, 'caseVoiceError').mockReturnValue(null);
    const voice = { start: jest.fn().mockReturnValue(true), close: jest.fn(), rest: jest.fn() };
    jest.spyOn(cs2Voice, 'prepareCaseVoice').mockResolvedValue(voice);
    const opening = interaction(player, { id: '115', customId: sound.custom_id });
    const receipt = hom.button(opening);
    await jest.advanceTimersByTimeAsync(0);
    await disk.transact('1', async () => {});
    await jest.advanceTimersByTimeAsync(0);
    const payload = opening.editReply.mock.calls[0][0];
    expect(payload.files).toEqual([expect.objectContaining({ name: 'cs2-opening.gif', attachment: gif })]);
    expect(payload.embeds[0].toJSON().image.url).toBe('attachment://cs2-opening.gif');
    expect(render.mock.calls[0][3]).toBe(true);
    expect(voice.start).toHaveBeenCalledWith(audio);
    expect(opening.editReply.mock.invocationCallOrder[0]).toBeLessThan(voice.start.mock.invocationCallOrder[0]);
    expect(payload.components).toEqual([]);
    await jest.advanceTimersByTimeAsync(cs2Reel.REEL_PLAYBACK_MS - 1);
    expect(opening.editReply).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await receipt;
    expect(opening.editReply).toHaveBeenCalledTimes(2);
    const result = opening.editReply.mock.calls[1][0];
    expect(result.attachments).toEqual([]);
    expect(result.files).toBeUndefined();
    const [next, detail] = result.components[0].toJSON().components;
    expect(next).toMatchObject({ label: 'Mở tiếp', custom_id: sound.custom_id });
    expect(result.embeds[0].toJSON().fields.find(field => field.name === 'Giá BUFF.163').value).toContain('Chưa có giá BUFF.163');
    expect(voice.close).not.toHaveBeenCalled();
    const saved = (await disk.read('1')).skinCases[player.id];
    expect(saved).toMatchObject({ cases: { 'crate-4904': 1 }, keys: { 'key-1394': 1 } });
    expect(saved.drops).toHaveLength(1);

    const details = interaction(player, { id: '116', customId: detail.custom_id });
    await hom.button(details);
    expect(details.editReply.mock.calls[0][0].components[0].toJSON().components[0].label).toBe('Về kho');

    let connect;
    let finishArt;
    cs2Reel.renderResultArtwork.mockImplementationOnce(() => new Promise(resolve => { finishArt = resolve; }));
    cs2Voice.prepareCaseVoice.mockImplementation(() => new Promise(resolve => { connect = resolve; }));
    const second = interaction(player, {
        id: '117', customId: next.custom_id, followUp: jest.fn().mockResolvedValue(undefined)
    });
    const slowVoice = hom.button(second);
    await jest.advanceTimersByTimeAsync(0);
    await disk.transact('1', async () => {});
    await jest.advanceTimersByTimeAsync(649);
    expect(second.editReply).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(second.editReply).toHaveBeenCalledTimes(1);
    expect(second.followUp).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('chưa sẵn sàng') }));
    connect(voice);
    await jest.advanceTimersByTimeAsync(cs2Reel.REEL_PLAYBACK_MS);
    await slowVoice;
    const secondResult = second.editReply.mock.calls[1][0];
    expect(secondResult.attachments).toEqual([]);
    expect(secondResult.files).toBeUndefined();
    finishArt(Buffer.from('late PNG'));
    await jest.advanceTimersByTimeAsync(0);
    expect(second.editReply).toHaveBeenCalledTimes(2);
    expect(voice.start).toHaveBeenCalledTimes(1);
    expect(voice.rest).toHaveBeenCalledTimes(1);
    expect(voice.close).not.toHaveBeenCalled();
});

test('CS2 cases require spendable coins and the right key, and retain a drop if the animation fails', async () => {
    const draw = jest.spyOn(crypto, 'randomInt').mockReturnValueOnce(0).mockReturnValueOnce(0)
        .mockReturnValueOnce(150000).mockReturnValueOnce(1).mockReturnValueOnce(0);
    const { createMember, interaction } = fixture();
    const player = createMember('13');
    await disk.transact('1', async (state, save) => {
        state.taixiu.balances[player.id] = 149;
        state.taixiu.round = { closesAt: Date.now() + 30000, bets: { [player.id]: { tai: 851, xiu: 0 } } };
        state.skinCases = { [player.id]: { cases: { 'crate-4904': 1 }, keys: { 'key-1393': 1 }, items: { 'karambit-amber': 2 } } };
        await save();
    });
    const click = (id, action) => interaction(player, { id, customId: 'mg_hom_' + action + '_crate-4904' });
    const deniedBuy = interaction(player, { id: '110', customId: 'mg_hom_buy_crate-4904_1500_xu1' });
    await hom.button(deniedBuy);
    expect(deniedBuy.editReply.mock.calls[0][0].embeds[0].toJSON().footer.text).toContain('Cần 1,500 xu');
    const deniedKey = click('111', 'open');
    await hom.button(deniedKey);
    expect(deniedKey.editReply.mock.calls[0][0].embeds[0].toJSON().footer.text).toContain('chìa phù hợp');
    expect(draw).not.toHaveBeenCalled();
    expect((await disk.read('1')).skinCases[player.id].cases['crate-4904']).toBe(1);

    await disk.transact('1', async (state, save) => {
        state.skinCases[player.id].keys['key-1394'] = 1;
        await save();
    });
    const lostCallback = click('112', 'open');
    lostCallback.update.mockRejectedValueOnce(new Error('Discord callback unavailable'));
    await expect(hom.button(lostCallback)).rejects.toThrow('Discord callback unavailable');
    expect((await disk.read('1')).skinCases[player.id].cases['crate-4904']).toBe(1);

    const failedSave = click('112', 'open');
    jest.spyOn(console, 'error').mockImplementation(() => {});
    store.transact.mockRejectedValueOnce(new Error('Disk temporarily unavailable'));
    await hom.button(failedSave);
    const retry = failedSave.editReply.mock.calls[0][0];
    expect(retry.embeds[0].toJSON().description).toContain('Chưa thể lưu lượt mở');
    expect(retry.components[0].toJSON().components[0].label).toBe('Về hòm');
    expect((await disk.read('1')).skinCases[player.id].cases['crate-4904']).toBe(1);

    const interrupted = click('112', 'open');
    interrupted.editReply.mockRejectedValueOnce(new Error('Discord temporarily unavailable'));
    await hom.button(interrupted);
    const result = interrupted.editReply.mock.calls.at(-1)[0].embeds[0].toJSON();
    expect(result.title).toBe('Dual Berettas | Hideout');
    expect(result.fields).toEqual(expect.arrayContaining([
        { name: 'Tình trạng', value: 'Field-Tested', inline: true },
        { name: 'Float', value: '0.150000', inline: true }
    ]));
    expect(result.fields).toContainEqual(expect.objectContaining({ name: 'Seed', value: '0' }));
    expect(result.fields).toContainEqual(expect.objectContaining({ name: 'Finish Catalog ID', value: '1169' }));
    expect(JSON.stringify(result)).toContain('Kilowatt Collection');
    const saved = await disk.read('1');
    expect(saved.skinCases[player.id].keys).toEqual({ 'key-1393': 1, 'key-1394': 0 });
    const drop = saved.skinCases[player.id].drops[0];
    expect(drop).toMatchObject({ float: 0.15, statTrak: false, paintSeed: 0, acquiredAt: expect.any(Number) });
    expect(result.fields).toContainEqual(expect.objectContaining({
        name: 'Ngày nhận', value: `<t:${Math.floor(drop.acquiredAt / 1000)}:D>`
    }));
    expect(saved.taixiu.balances[player.id]).toBe(149);
    expect(saved.taixiu.round.bets[player.id]).toEqual({ tai: 851, xiu: 0 });
    const inventory = click('113', 'inventory');
    await hom.button(inventory);
    expect(inventory.editReply.mock.calls[0][0].embeds[0].toJSON().description).toContain('Karambit | Hổ Phách · ×2');
});

test('the CS2 catalogue can browse both case pages and inspect a case-specific rare pool', async () => {
    const { createMember, interaction } = fixture();
    const player = createMember('13');
    const panel = interaction(player);
    await hom.execute(panel);
    const first = panel.editReply.mock.calls[0][0];
    const options = payload => payload.components[0].toJSON().components[0].options;
    const nextButton = first.components.flatMap(row => row.toJSON().components).find(button => button.label === 'Danh sách sau');
    const next = interaction(player, { customId: nextButton.custom_id });
    await hom.button(next);
    const second = next.editReply.mock.calls.at(-1)[0];
    const ids = [...options(first), ...options(second)].map(option => option.value);
    expect(new Set(ids).size).toBe(42);
    expect(ids).toEqual(cs2Catalog.cases.map(item => item.id));
    const select = interaction(player, { values: ['crate-4880'] });
    await hom.select(select);
    expect(select.editReply.mock.calls[0][0].embeds[0].toJSON().title).toBe('Revolution Case');
    const preview = interaction(player, { customId: 'mg_hom_contents_crate-4880' });
    await hom.button(preview);
    const list = preview.editReply.mock.calls[0][0];
    expect(list.embeds[0].toJSON().fields.at(-1).value).toContain('24 mẫu');
    const special = interaction(player, { customId: 'mg_hom_contents_crate-4880_1' });
    await hom.button(special);
    expect(special.editReply.mock.calls[0][0].embeds[0].toJSON().description).toContain('Driver Gloves | Imperial Plaid');
});

test('Tiệm Bánh Mây coalesces wallet changes into the public ranking and leaves bets responsive during a slow edit', async () => {
    jest.useFakeTimers();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { guild, admin, createChannel, createMember, interaction } = fixture();
    const chat = createChannel('10', ChannelType.GuildText);
    const player = createMember('13');
    jest.replaceProperty(process, 'env', { ...process.env, TAIXIU_OWNER_ID: admin.id, GUILD_IDS: guild.id });
    guild.members.fetch.mockResolvedValue(player);
    await setup.execute(interaction(admin, { options: { getSubcommand: () => 'tiembanh', getChannel: () => chat } }));
    await taixiu.claimDaily(interaction(player));
    await taixiu.handlePrivateMessage({
        id: '101', author: { id: admin.id }, channel: { type: ChannelType.DM }, content: '!addxu 1 5000 13',
        client: { guilds: { cache: new Map([[guild.id, guild]]) } }, reply: jest.fn()
    });
    const walletBeforeBet = (await disk.read('1')).taixiu.balances[player.id];
    const rankedBalance = require('../utils/coins').formatCoins(require('../utils/coins').readCoins(walletBeforeBet));
    expect(chat.messages.edit).not.toHaveBeenCalled();
    let finishEdit;
    chat.messages.edit.mockImplementationOnce(() => new Promise(resolve => { finishEdit = resolve; }));
    await jest.advanceTimersByTimeAsync(1000);
    await disk.transact('1', async () => {});
    expect(chat.messages.edit).toHaveBeenCalledTimes(1);
    const ranking = () => chat.messages.edit.mock.calls.at(-1)[1].embeds[1].toJSON().description;
    expect(ranking()).toContain(`<@13> · **${rankedBalance}**`);

    const [tai] = chat.send.mock.calls[0][0].components[0].toJSON().components;
    const bet = await openBetForm(interaction(player, { customId: tai.custom_id, channelId: chat.id, message: { id: '99' } }));
    await taixiu.modal(bet(2000));
    expect((await disk.read('1')).taixiu.balances[player.id]).toBe(walletBeforeBet - 2000);
    await jest.advanceTimersByTimeAsync(2000);
    expect(chat.messages.edit).toHaveBeenCalledTimes(1);
    finishEdit();
    await jest.advanceTimersByTimeAsync(1000);
    expect(chat.messages.edit).toHaveBeenCalledTimes(2);
    expect(ranking()).toContain(`<@13> · **${rankedBalance}**`);
    const deadline = Math.ceil((await disk.read('1')).taixiu.round.closesAt / 1000);
    expect(chat.messages.edit.mock.calls.at(-1)[1].embeds[0].toJSON().fields[0].value).toContain(`<t:${deadline}:R>`);
});

test('Tiệm Bánh Mây keeps the last legacy dice result when opening a new round and scopes history to its guild', async () => {
    jest.useFakeTimers();
    const { createChannel, createMember, interaction } = fixture();
    const chat = createChannel('10', ChannelType.GuildText);
    const player = createMember('13');
    const closesAt = Date.now() - 30000;
    const legacy = { dice: [1, 3, 4], total: 8, winner: 'xiu' };
    await disk.transact('1', async (state, save) => {
        state.taixiu.round = { id: '110', channelId: chat.id, messageId: '99', closesAt, result: legacy, bets: {} };
        await save();
    });
    await taixiu.execute(interaction(player, { id: '111', channel: chat, options: { getSubcommand: () => 'play' } }));
    const reopened = store.createManagementStore(root);
    expect((await reopened.read('1')).taixiu.rolls).toEqual([{ at: closesAt, ...legacy }]);
    const other = interaction(player, { guild: { id: '2' }, options: { getSubcommand: () => 'dice' } });
    await taixiu.execute(other);
    expect(other.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: 'Chưa có ván Tiệm Bánh Mây nào hoàn tất trên máy chủ này.' }));
});

test('Tiệm Bánh Mây history retains the latest twenty rounds, preserves the previous result and pages privately', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-11T10:00:00Z') });
    jest.spyOn(crypto, 'randomInt').mockReturnValueOnce(4).mockReturnValueOnce(3).mockReturnValueOnce(5);
    const { createChannel, createMember, interaction } = fixture();
    const chat = createChannel('10', ChannelType.GuildText);
    const first = createMember('13');
    const second = createMember('14');
    const outsider = createMember('15');
    const oldResults = Array.from({ length: 20 }, (_, index) => ({
        at: Date.now() - (index + 1) * 60000, winner: 'tai', tai: 10, xiu: 0
    }));
    const previous = { at: Date.now() - 60000, winner: 'tie', tai: 0, xiu: 40 };
    await disk.transact('1', async (state, save) => {
        state.taixiu.history = { [first.id]: oldResults };
        state.taixiu.lastResults = { [second.id]: previous };
        await save();
    });
    const command = (member, action) => interaction(member, { id: '110', channel: chat, options: { getSubcommand: () => action } });
    await taixiu.execute(command(first, 'play'));
    const [tai, xiu] = chat.send.mock.calls[0][0].components[0].toJSON().components;
    const form = (member, control) => openBetForm(interaction(member, { customId: control.custom_id, channelId: chat.id, message: { id: '99' } }));
    const firstBet = await form(first, xiu);
    const secondBet = await form(second, tai);
    await taixiu.modal(firstBet(70));
    await taixiu.modal(secondBet(50));
    await jest.advanceTimersByTimeAsync(30000);
    await disk.transact('1', async () => {});
    await jest.advanceTimersByTimeAsync(3600);
    await disk.transact('1', async () => {});
    const reopened = store.createManagementStore(root);
    const saved = (await reopened.read('1')).taixiu.history;
    expect(saved[first.id]).toHaveLength(20);
    expect(saved[first.id][0]).toMatchObject({ winner: 'tai', tai: 0, xiu: 70 });
    expect(saved[first.id].at(-1)).toEqual(oldResults[18]);
    expect(saved[second.id]).toEqual([expect.objectContaining({ winner: 'tai', tai: 50, xiu: 0 }), previous]);

    store.transact.mockImplementation(reopened.transact);
    const history = command(first, 'history');
    await taixiu.execute(history);
    expect(history.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    const pageOne = history.editReply.mock.calls[0][0];
    expect(pageOne.embeds[0].toJSON().description).toContain('Bạn thua 70 xu');
    expect(pageOne.embeds[0].toJSON().description).not.toContain('Bạn thắng +50 xu');
    const [, next] = pageOne.components[0].toJSON().components;
    const pageTwo = interaction(first, { customId: next.custom_id });
    await taixiu.button(pageTwo);
    expect(pageTwo.deferUpdate).toHaveBeenCalled();
    expect(pageTwo.editReply.mock.calls[0][0].embeds[0].toJSON().footer.text).toContain('Trang 2/2');
    const empty = command(outsider, 'history');
    await taixiu.execute(empty);
    expect(empty.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: 'Bạn chưa có lịch sử cược trên máy chủ này.' }));
});

test('deleting the automatic table preserves the active round and its pending bets', async () => {
    jest.useFakeTimers();
    const { guild, admin, createChannel, createMember, interaction } = fixture();
    const chat = createChannel('10', ChannelType.GuildText);
    const player = createMember('13');
    chat.send.mockResolvedValueOnce({ id: '99' }).mockResolvedValueOnce({ id: '100' });
    await setup.execute(interaction(admin, { options: {
        getSubcommand: () => 'tiembanh', getChannel: () => chat
    } }));
    const control = chat.send.mock.calls[0][0].components[0].toJSON().components[0];
    const button = () => interaction(player, { customId: control.custom_id, channelId: chat.id, message: { id: '99' } });
    const bet = await openBetForm(button());
    const secondForm = await openBetForm(button());
    await taixiu.modal(bet(50));
    const before = (await disk.read('1')).taixiu;
    await taixiu.recoverDeleted(guild, new Set(['99']));
    const after = (await disk.read('1')).taixiu;
    expect(chat.send).toHaveBeenCalledTimes(2);
    expect(after.balances).toEqual({ [player.id]: 950 });
    expect(after.round).toEqual({ ...before.round, messageId: '100' });
    await jest.advanceTimersByTimeAsync(6000);
    expect(chat.messages.edit.mock.calls.at(-1)[0]).toBe('100');
    const stale = secondForm(50);
    await taixiu.modal(stale);
    expect(stale.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Bàn này đã kết thúc') }));
    expect((await disk.read('1')).taixiu.balances).toEqual(after.balances);
});

test('setting up an automatic table creates the game state with an older management store', async () => {
    const { admin, createChannel, interaction } = fixture();
    const chat = createChannel('10', ChannelType.GuildText);
    store.transact.mockImplementationOnce((guildId, operation) => disk.transact(guildId, (state, save) => {
        delete state.taixiu;
        return operation(state, save);
    }));
    const command = interaction(admin, { options: {
        getSubcommand: () => 'tiembanh', getChannel: () => chat
    } });
    await setup.execute(command);

    expect(chat.send).toHaveBeenCalledTimes(1);
    const saved = await disk.read('1');
    expect(saved.settings.taixiuRoom).toEqual({ channelId: chat.id });
    expect(saved.taixiu).toMatchObject({ balances: {}, round: { automatic: true, messageId: '99' } });
});

test('Tiệm Bánh Mây setup reports a Discord permission error and can retry the saved room', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const { admin, createChannel, interaction } = fixture();
    const chat = createChannel('10', ChannelType.GuildText);
    const error = Object.assign(new Error('Missing Permissions'), { code: RESTJSONErrorCodes.MissingPermissions });
    chat.send.mockRejectedValueOnce(error);
    const command = () => interaction(admin, { options: {
        getSubcommand: () => 'tiembanh', getChannel: () => chat
    } });
    const failed = command();
    await setup.execute(failed);
    expect(failed.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('mã 50013')
    }));
    expect((await disk.read('1')).taixiu.round).toBeNull();
    await setup.execute(command());
    expect((await disk.read('1')).taixiu.round).toMatchObject({ automatic: true, messageId: '99' });
});

test('suggestions allow one vote per user and reserve status changes for moderators', async () => {
    const { admin, createChannel, createMember, interaction } = fixture();
    const channel = createChannel('16', ChannelType.GuildText);
    const author = createMember('12');
    await setup.execute(interaction(admin, { options: {
        getSubcommand: () => 'suggestions', getChannel: () => channel
    } }));
    await suggest.execute(interaction(author, { id: '102', options: { getString: () => 'Mở phòng chơi chung' } }));
    const button = (user, action) => interaction(user, {
        customId: `mg_suggest_${action}_102`, channelId: channel.id, message: { id: '99' }
    });
    await suggest.button(button(author, 'up'));
    await suggest.button(button(author, 'down'));
    await suggest.button(button(author, 'approved'));
    expect((await disk.read('1')).suggestions['102']).toMatchObject({ status: 'new', votes: { [author.id]: -1 } });
    await suggest.button(button(admin, 'done'));
    await suggest.button(button(author, 'up'));
    expect((await disk.read('1')).suggestions['102']).toMatchObject({ status: 'done', votes: { [author.id]: -1 } });
});

test('confirmed announcements persist across reloads and reuse their nonce when retrying', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-11T12:00:00Z'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const { guild, admin, createChannel, interaction } = fixture();
    const channel = createChannel('16', ChannelType.GuildText);
    guild.members.fetch.mockResolvedValue(admin);
    const post = jest.fn().mockRejectedValueOnce(new Error('Network timeout')).mockResolvedValueOnce({ id: '99' });
    guild.client = { rest: { post } };
    const schedule = interaction(admin, { id: '103', options: {
        getSubcommand: () => 'schedule', getChannel: () => channel,
        getString: name => name === 'time' ? '2026-11-11 19:01' : '@everyone Thông báo thử'
    } });
    await announce.execute(schedule);
    expect((await disk.read('1')).announcements).toEqual({});
    const confirmed = interaction(admin, { customId: 'mg_announce_save_103' });
    await Promise.all([announce.button(confirmed), announce.button(confirmed)]);
    expect(Object.keys((await disk.read('1')).announcements)).toEqual(['1']);
    await sendDueAnnouncements(guild);
    expect(post).not.toHaveBeenCalled();

    const reopened = store.createManagementStore(root);
    store.transact.mockImplementation(reopened.transact);
    jest.setSystemTime(new Date('2026-11-11T12:01:00Z'));
    await sendDueAnnouncements(guild);
    expect((await reopened.read('1')).announcements['1'].status).toBe('sending');
    jest.setSystemTime(new Date('2026-11-11T12:01:15Z'));
    await sendDueAnnouncements(guild);
    await sendDueAnnouncements(guild);
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1]).toEqual(post.mock.calls[0]);
    expect(post.mock.calls[0][1].body).toEqual({
        content: '@everyone Thông báo thử', allowed_mentions: { parse: [] }, nonce: '103', enforce_nonce: true
    });
    expect((await reopened.read('1')).announcements['1']).toMatchObject({ status: 'sent', messageId: '99' });
});
