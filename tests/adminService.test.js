const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

jest.mock('../utils/musicUtils', () => {
    const musicData = new Map();
    return { musicData, initGuildMusicData: jest.fn(id => {
        if (!musicData.has(id)) musicData.set(id, { queue: [], volume: 50, loopMode: 'off', autoplay: false });
        return musicData.get(id);
    }), getCurrentPlaybackTime: jest.fn(() => 12), skipCurrentSong: jest.fn(() => true),
    stopMusic: jest.fn(), disconnectMusic: jest.fn() };
});
jest.mock('../utils/cs2Battles', () => ({ capacity: room => Number(room.format),
    isOpen: room => room.status === 'waiting' && room.expiresAt > Date.now(), actOnRoom: jest.fn() }));
jest.mock('../commands/taixiu', () => ({
    getCoinBalance: (state, id) => state.taixiu.balances[id] == null ? 100_000n : require('../utils/coins').readCoins(state.taixiu.balances[id]),
    refreshCoinLeaderboard: jest.fn(), automaticChannel: jest.fn(() => true), syncAutomaticBoard: jest.fn()
}));
jest.mock('../utils/cs2BattleCases', () => ({
    customCases: [{ id: 'battle-test', name: 'Hòm kiểm tra', description: 'Test', group: 'theme', entries: [{}] }],
    cachedPrices: jest.fn(() => jest.fn()), casePricing: jest.fn(() => ({ fee: 123_456n, expected: 117_000n,
        maxValue: 250_000n, riskLevel: 'medium', riskLabel: 'Rủi ro vừa', entries: [{}] }))
}));
jest.mock('../utils/cs2PriceSnapshot', () => ({ nextRefreshAt: () => 2_000_000_000_000,
    refresh: jest.fn(async () => ({ status: 'cooldown', count: 20, updatedAt: 1, nextRefreshAt: 2_000_000_000_000 })) }));
jest.mock('../utils/cs2BlueGemPrices', () => ({ nextRefreshAt: () => 2_000_000_000_000,
    refresh: jest.fn(async () => ({ status: 'updated', count: 10, updatedAt: 2, nextRefreshAt: 2_000_000_000_000 })) }));

const { ChannelType } = require('discord.js');
const store = require('../utils/managementStore');
const musicTools = require('../utils/musicUtils');
const battle = require('../utils/cs2Battles');
const wallet = require('../commands/taixiu');
const { createAdminService } = require('../utils/adminService');

let directory, disk, service, guild, client, oldGuildId, oldGuildIds;
const member = { user: { id: '13', bot: false } };
beforeEach(async () => {
    oldGuildId = process.env.GUILD_ID;
    oldGuildIds = process.env.GUILD_IDS;
    process.env.GUILD_IDS = '1';
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'admin-service-'));
    disk = store.createManagementStore(directory);
    jest.spyOn(store, 'read').mockImplementation(disk.read);
    jest.spyOn(store, 'transact').mockImplementation(disk.transact);
    guild = { id: '1', name: 'Máy chủ của tôi', available: true, memberCount: 42, iconURL: () => 'https://cdn.example.com/icon.png',
        members: { cache: new Map(), fetch: jest.fn().mockResolvedValue(member), search: jest.fn().mockResolvedValue(new Map()),
            list: jest.fn().mockResolvedValue(new Map()) }, channels: { cache: new Map([
            ['20', { id: '20', name: 'phòng-nhạc', type: ChannelType.GuildText }],
            ['21', { id: '21', name: 'Voice', type: ChannelType.GuildVoice }]
        ]) } };
    client = { guilds: { cache: new Map([['1', guild], ['2', { ...guild, id: '2', name: 'forbidden-server' }]]) },
        user: { username: 'Bot', tag: 'Bot#1', displayAvatarURL: () => 'https://cdn.example.com/bot.png' },
        ws: { ping: 25 }, uptime: 100_000, isReady: jest.fn(() => true) };
    service = createAdminService({ client, commands: new Map([['hom', {}]]) });
    musicTools.musicData.clear();
    jest.clearAllMocks();
});
afterEach(async () => {
    jest.restoreAllMocks();
    if (oldGuildId === undefined) delete process.env.GUILD_ID; else process.env.GUILD_ID = oldGuildId;
    if (oldGuildIds === undefined) delete process.env.GUILD_IDS; else process.env.GUILD_IDS = oldGuildIds;
    await fs.rm(directory, { recursive: true, force: true });
});

test('overview and guild reads only expose allowed guilds and selected public fields, never future Battle rounds or inventory', async () => {
    await disk.transact('1', async (state, save) => {
        state.cs2Battles = { 300: { id: '300', status: 'revealing', hostId: '13', channelId: '20', players: [{ id: '13' }, { id: '14' }],
            caseIds: ['battle-test', 'battle-test'], format: '2', fee: '12345', createdAt: 123, expiresAt: 456,
            rounds: [{ secret: 'future-skin-and-outcome' }], winners: ['future-winner'], pricesByCase: { private: true } } };
        state.taixiu.balances = { 13: 1000, 14: 2000 };
        state.skinCases = { 13: { drops: [{ id: 'secret-owned-skin' }] } };
        state.settings = { taixiuRoom: { channelId: '20' }, unrelatedSecret: 'secret-setting' };
        await save();
    });
    const result = await service.guild('1');
    expect(result.battles[0]).toMatchObject({ id: '300', status: 'revealing', players: 2, roundCount: 2, capacity: 2 });
    expect(result.wallets).toEqual([
        { userId: '14', balance: '2,000 xu', userName: 'Không rõ tên', username: null, avatar: null, memberAvailable: false },
        { userId: '13', balance: '1,000 xu', userName: 'Không rõ tên', username: null, avatar: null, memberAvailable: true }
    ]);
    expect(result.settings).toEqual({ taixiuChannelId: '20', taixiuEnabled: true });
    expect(JSON.stringify(result)).not.toMatch(/future-|secret-owned|secret-setting|pricesByCase/);
    expect(store.read).toHaveBeenLastCalledWith('1', { sections: ['settings', 'cs2Battles', 'adminAudit'], wallets: 'all' });
    const summary = await service.overview();
    expect(summary.guilds.map(item => item.id)).toEqual(['1']);
    expect(summary.catalogue).toMatchObject({ caseCount: 1, availableCases: 1 });
    expect(summary.catalogue.cases).toBeUndefined();
    await expect(service.guild('2')).rejects.toMatchObject({ status: 404 });
    expect(store.read.mock.calls.every(([id]) => id === '1')).toBe(true);
});

test('catalogue is read-only cached metadata and no case entries or price internals escape', () => {
    const cases = require('../utils/cs2BattleCases');
    const first = service.catalogue();
    first.cases[0].name = 'changed';
    expect(service.catalogue().cases[0].name).toBe('Hòm kiểm tra');
    expect(cases.casePricing).toHaveBeenCalledTimes(1);
    expect(first.cases[0]).toMatchObject({ fee: '1,234.56 xu', available: true, image: '/admin/art/battle-test.png' });
    expect(first.cases[0].entries).toBeUndefined();
});

const namedMember = (id, options = {}) => {
    const { user = {}, ...fields } = options;
    return { id, guild: { id: '1' }, user: { id, bot: false, username: `user-${id}`, ...user }, ...fields };
};

test('wallet identities match exact guild user IDs, prefer Discord display names and safely fall back when lookups fail', async () => {
    const identities = new Map([
        ['13', namedMember('13', { displayName: 'Tên tại máy chủ', user: { globalName: 'Tên chung', email: 'private-email' },
            displayAvatarURL: () => 'https://cdn.example.com/member.png', permissions: 'private-permissions' })],
        ['14', namedMember('14', { user: { globalName: 'Tên chung', displayAvatarURL: () => 'https://cdn.example.com/user.png' } })],
        ['15', namedMember('15')],
        ['16', namedMember('16', { user: { username: '' } })],
        ['17', namedMember('17', { user: { bot: true } })],
        ['18', namedMember('18', { guild: { id: '2' } })],
        ['19', namedMember('20', { displayName: 'Tên sai ID' })]
    ]);
    for (const id of ['13', '14', '15', '16']) guild.members.cache.set(id, identities.get(id));
    guild.members.fetch.mockImplementation(async ({ user }) => {
        if (user === '21') throw new Error('Discord unavailable');
        return identities.get(user);
    });
    await disk.transact('1', async (state, save) => {
        state.taixiu.balances = Object.fromEntries(['13', '14', '15', '16', '17', '18', '19', '21'].map(id => [id, 100]));
        await save();
    });
    const result = await service.guild('1');
    const byId = Object.fromEntries(result.wallets.map(entry => [entry.userId, entry]));
    expect(byId['13']).toMatchObject({ userName: 'Tên tại máy chủ', username: 'user-13', avatar: 'https://cdn.example.com/member.png', memberAvailable: true });
    expect(byId['14']).toMatchObject({ userName: 'Tên chung', avatar: 'https://cdn.example.com/user.png', memberAvailable: true });
    expect(byId['15'].userName).toBe('user-15');
    expect(byId['16']).toMatchObject({ userName: 'Không rõ tên', username: null, memberAvailable: true });
    for (const id of ['17', '18', '19', '21']) expect(byId[id]).toMatchObject({ userName: 'Không rõ tên', username: null, avatar: null, memberAvailable: false });
    expect(JSON.stringify(result.wallets)).not.toMatch(/private-|Tên sai ID/);
    await service.guild('1');
    expect(guild.members.fetch).toHaveBeenCalledTimes(4);
    expect(guild.members.fetch.mock.calls.every(([options]) => options.force === true && options.cache === false && typeof options.user === 'string')).toBe(true);
    expect(store.transact).not.toHaveBeenCalled();
});

test('empty recipient suggestions merge cached humans, REST members without wallets and verified wallet holders with coalesced requests', async () => {
    guild.members.cache.set('13', namedMember('13', { displayName: 'An' }));
    guild.members.cache.set('14', namedMember('14', { user: { bot: true } }));
    guild.members.cache.set('15', namedMember('15', { guild: { id: '2' } }));
    guild.members.list.mockResolvedValue(new Map([['16', namedMember('16', { displayName: 'Bình' })]]));
    guild.members.fetch.mockImplementation(async ({ user }) => namedMember(user, { displayName: 'Chi' }));
    await disk.transact('1', async (state, save) => { state.taixiu.balances = { 17: 123 }; await save(); });
    const [first, second] = await Promise.all([service.members('1'), service.members('1', '')]);
    expect(first.members.map(entry => entry.userId)).toEqual(['13', '16', '17']);
    expect(first).toEqual(second);
    expect(first.hasMore).toBe(false);
    expect(first.members[1]).toEqual({ userId: '16', userName: 'Bình', username: 'user-16', avatar: null });
    expect(guild.members.list).toHaveBeenCalledTimes(1);
    expect(guild.members.list).toHaveBeenCalledWith({ limit: 100, cache: false });
    expect(guild.members.fetch).toHaveBeenCalledTimes(1);
    expect(store.read).toHaveBeenCalledWith('1', { wallets: 'all' });
    first.members[0].userName = 'mutated';
    expect((await service.members('1')).members[0].userName).toBe('An');
    expect((await service.guild('1')).wallets[0]).toMatchObject({ userName: 'Chi', memberAvailable: true });
    expect(guild.members.fetch).toHaveBeenCalledTimes(1);
});

test('recipient name search combines bounded REST search and normalized local display/global/username matching without outsiders or bots', async () => {
    guild.members.cache.set('13', namedMember('13', { displayName: 'Nguyễn Đặng', user: { globalName: 'Tên Toàn Cầu' } }));
    guild.members.cache.set('14', namedMember('14', { user: { username: 'nguyen-cache' } }));
    guild.members.search.mockResolvedValue(new Map([
        ['15', namedMember('15', { displayName: 'Nguyen REST' })],
        ['16', namedMember('16', { displayName: 'Nguyen Bot', user: { bot: true } })],
        ['17', namedMember('17', { displayName: 'Nguyen outsider', guild: { id: '2' } })],
        ['18', namedMember('18', { displayName: 'unrelated' })]
    ]));
    const result = await service.members('1', 'nguyen');
    expect(result.members.map(entry => entry.userId).sort()).toEqual(['13', '14', '15']);
    expect(guild.members.search).toHaveBeenCalledWith({ query: 'nguyen', limit: 25, cache: false });
    expect(result.members.every(entry => Object.keys(entry).sort().join(',') === 'avatar,userId,userName,username')).toBe(true);
    expect((await service.members('1', 'toan cau')).members.map(entry => entry.userId)).toEqual(['13']);
    expect((await service.members('1', 'dang')).members.map(entry => entry.userId)).toEqual(['13']);
    expect(guild.members.fetch).not.toHaveBeenCalled();
    expect(guild.members.list).not.toHaveBeenCalled();
    expect(store.read).not.toHaveBeenCalled();
});

test('numeric recipient search uses only the requested guild member ID and filters mismatched, departed and bot results', async () => {
    guild.members.fetch.mockImplementation(async ({ user }) => {
        if (user === '13') return namedMember('13', { displayName: 'Đúng người' });
        if (user === '14') return namedMember('15', { displayName: 'Sai người' });
        if (user === '16') return namedMember('16', { guild: { id: '2' } });
        if (user === '17') return namedMember('17', { user: { bot: true } });
        if (user === '18') throw Object.assign(new Error('Unknown member'), { code: 10007 });
        throw new Error('Discord unavailable');
    });
    const [first, retry] = await Promise.all([service.members('1', '13'), service.members('1', '13')]);
    expect(first.members).toEqual([{ userId: '13', userName: 'Đúng người', username: 'user-13', avatar: null }]);
    expect(retry).toEqual(first);
    for (const id of ['14', '16', '17', '18']) expect(await service.members('1', id)).toEqual({ members: [], hasMore: false });
    expect(await service.members('1', '19')).toMatchObject({ members: [], hasMore: false, notice: expect.any(String) });
    expect(guild.members.fetch).toHaveBeenCalledTimes(6);
    expect(guild.members.search).not.toHaveBeenCalled();
    expect(store.read).not.toHaveBeenCalled();
});

test('recipient search stays usable when Discord lookup fails and validates guild readiness before cached responses', async () => {
    guild.members.cache.set('13', namedMember('13', { displayName: 'Hồng' }));
    guild.members.search.mockRejectedValue(new Error('Missing member access'));
    guild.members.list.mockRejectedValue(new Error('Missing privileged member access'));
    expect(await service.members('1', 'hong')).toMatchObject({ members: [expect.objectContaining({ userId: '13' })], notice: expect.any(String) });
    expect(await service.members('1')).toMatchObject({ members: [expect.objectContaining({ userId: '13' })], notice: expect.any(String) });
    client.isReady.mockReturnValue(false);
    await expect(service.members('1', 'hong')).rejects.toMatchObject({ status: 503 });
    client.isReady.mockReturnValue(true);
    await expect(service.members('2', 'hong')).rejects.toMatchObject({ status: 404 });
    for (const query of ['x'.repeat(101), 'bad\u0000query', '0', '123456789012345678901']) {
        await expect(service.members('1', query)).rejects.toMatchObject({ status: 400 });
    }
    expect(guild.members.fetch).not.toHaveBeenCalled();
    expect(store.read.mock.calls.every(([id]) => id === '1')).toBe(true);
});

test('recipient results are capped and cached query/list/identity lookups refresh after their TTL', async () => {
    let now = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    guild.members.list.mockResolvedValue(new Map(Array.from({ length: 100 }, (_, index) => {
        const id = String(index + 100);
        return [id, namedMember(id)];
    })));
    const first = await service.members('1');
    expect(first.members).toHaveLength(25);
    expect(first.hasMore).toBe(true);
    now += 16_000;
    await service.members('1');
    expect(guild.members.list).toHaveBeenCalledTimes(1);
    now += 60_000;
    await service.members('1');
    expect(guild.members.list).toHaveBeenCalledTimes(2);
    guild.members.fetch.mockResolvedValue(namedMember('13', { displayName: 'Tên cũ' }));
    expect((await service.members('1', '13')).members[0].userName).toBe('Tên cũ');
    now += 16_000;
    guild.members.fetch.mockResolvedValue(namedMember('13', { displayName: 'Tên mới' }));
    expect((await service.members('1', '13')).members[0].userName).toBe('Tên cũ');
    now += 60_000;
    expect((await service.members('1', '13')).members[0].userName).toBe('Tên mới');
    expect(guild.members.fetch).toHaveBeenCalledTimes(2);
});

test('music validates volume, preserves the active queue head and records control audit', async () => {
    const head = { title: 'Now', url: 'https://example.com/watch?v=1', secretStreamUrl: 'private-stream' };
    const data = { currentSong: head, queue: [head, { title: 'Next' }, { title: 'Last' }], volume: 50,
        audioResource: { volume: { setVolume: jest.fn() } }, player: { state: { status: 'playing' }, pause: jest.fn(() => true) } };
    musicTools.musicData.set('1', data);
    await expect(service.music('1', { action: 'volume', volume: 101 })).rejects.toMatchObject({ status: 400 });
    await service.music('1', { action: 'volume', volume: 0 });
    expect(data.audioResource.volume.setVolume).toHaveBeenCalledWith(0);
    await service.music('1', { action: 'shuffle' });
    expect(data.queue[0]).toBe(head);
    await expect(service.music('1', { action: 'remove', position: 1 })).rejects.toMatchObject({ status: 409 });
    await service.music('1', { action: 'remove', position: 2, expectedUrl: null });
    expect(data.queue).toHaveLength(2);
    const result = await service.music('1', { action: 'pause' });
    expect(data.player.pause).toHaveBeenCalled();
    expect(JSON.stringify(result.music)).not.toContain('private-stream');
    const activities = await service.activity();
    expect(activities).toHaveLength(4);
    expect(activities.every(item => item.detail === item.message)).toBe(true);
    await expect(service.music('2', { action: 'stop' })).rejects.toMatchObject({ status: 404 });
});

test('a stale queue position cannot remove a different song after the playing head advances', async () => {
    const first = { title: 'First', url: 'https://example.com/watch?v=1' };
    const second = { title: 'Second', url: 'https://example.com/watch?v=2' };
    const third = { title: 'Third', url: 'https://example.com/watch?v=3' };
    const data = { currentSong: first, queue: [first, second, third] };
    musicTools.musicData.set('1', data);
    const initial = (await service.guild('1')).music.queue;
    expect(initial.map(song => song.current)).toEqual([true, false, false]);
    data.queue.shift();
    data.currentSong = second;
    await expect(service.music('1', { action: 'remove', position: initial[1].position, expectedUrl: initial[1].url })).rejects.toMatchObject({ status: 409 });
    expect(data.queue).toEqual([second, third]);
    expect(store.transact).not.toHaveBeenCalled();
    await service.music('1', { action: 'remove', position: 2, expectedUrl: third.url });
    expect(data.queue).toEqual([second]);
});

test('music uses shared skip and stop handlers and refuses controls during shutdown or disconnect', async () => {
    await service.music('1', { action: 'skip' });
    expect(musicTools.skipCurrentSong).toHaveBeenCalledWith(musicTools.musicData.get('1'));
    await service.music('1', { action: 'stop' });
    expect(musicTools.stopMusic).toHaveBeenCalledWith(musicTools.musicData.get('1'));
    client.isReady.mockReturnValue(false);
    await expect(service.music('1', { action: 'stop' })).rejects.toMatchObject({ status: 503 });
    const stopping = createAdminService({ client, isShuttingDown: () => true });
    await expect(stopping.guild('1')).rejects.toMatchObject({ status: 503 });
});

test('a transient automatic pause cannot be manually resumed and invalid loop/autoplay values are rejected', async () => {
    const data = { currentSong: { title: 'Voice loading' }, queue: [], player: { state: { status: 'autopaused' }, unpause: jest.fn() } };
    musicTools.musicData.set('1', data);
    await expect(service.music('1', { action: 'resume' })).rejects.toMatchObject({ status: 409 });
    await expect(service.music('1', { action: 'loop', mode: 'invalid' })).rejects.toMatchObject({ status: 400 });
    await expect(service.music('1', { action: 'autoplay', enabled: 'true' })).rejects.toMatchObject({ status: 400 });
    expect(data.player.unpause).not.toHaveBeenCalled();
    expect(store.transact).not.toHaveBeenCalled();
});

test('price refresh delegates to existing cooldown-aware services without exposing raw quote records', async () => {
    const snapshot = require('../utils/cs2PriceSnapshot');
    const blueGem = require('../utils/cs2BlueGemPrices');
    snapshot.refresh.mockResolvedValueOnce({ status: 'cooldown', count: 20, updatedAt: 1, nextRefreshAt: 2, privateRecord: 'not-public' });
    blueGem.refresh.mockResolvedValueOnce({ status: 'cooldown', count: 10, nextRefreshAt: 2, privateRecord: 'not-public' });
    const result = await service.refreshPrices();
    expect(result.message).toContain('trong chu kỳ này');
    expect(snapshot.refresh).toHaveBeenCalledTimes(1);
    expect(blueGem.refresh).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('not-public');
});

const grant = (overrides = {}) => ({ userId: '13', amount: '1,234.56', reason: 'Quà sự kiện', requestId: randomUUID(), ...overrides });

test('simultaneous duplicate coin grants commit once with exact decimals, audit and owner-scoped writes', async () => {
    await disk.transact('1', async (state, save) => {
        state.taixiu.balances = { 13: 1000, 14: 7777 };
        state.taixiu.round = { id: 'active-game', bets: { 14: '100' } };
        state.skinCases = { 14: { drops: [{ id: 'preserved' }] } };
        await save();
    });
    const body = grant();
    const [first, second] = await Promise.all([service.coins('1', body), service.coins('1', body)]);
    expect(first.balance).toBe('2,234.56 xu');
    expect([first.replayed, second.replayed].sort()).toEqual([false, true]);
    const state = await disk.read('1');
    expect(state.taixiu.balances).toEqual({ 13: '2234.56', 14: 7777 });
    expect(state.taixiu.round).toEqual({ id: 'active-game', bets: { 14: '100' } });
    expect(state.skinCases['14'].drops).toEqual([{ id: 'preserved' }]);
    expect(state.adminAudit.entries).toHaveLength(1);
    expect(state.adminAudit.entries[0]).toMatchObject({ action: 'coins.grant', requestId: body.requestId, reason: body.reason });
    expect(wallet.refreshCoinLeaderboard).toHaveBeenCalledTimes(1);
    expect(store.transact).toHaveBeenCalledWith('1', expect.any(Function), { sections: ['adminRequests', 'adminAudit'], wallets: ['13'] });
    guild.members.fetch.mockRejectedValue(new Error('Discord unavailable after the successful request'));
    expect(await service.coins('1', body)).toMatchObject({ replayed: true, balance: '2,234.56 xu' });
    await expect(service.coins('1', { ...body, amount: '5' })).rejects.toMatchObject({ status: 409 });
    expect((await disk.read('1')).taixiu.balances['13']).toBe('2234.56');
});

test.each(['-1', '0', '1.0001', '999999999999999999999999999999999'])('coin grant rejects invalid or non-positive amount %s without saving', async amount => {
    await expect(service.coins('1', grant({ amount }))).rejects.toMatchObject({ status: 400 });
    expect(store.transact).not.toHaveBeenCalled();
    expect(guild.members.fetch).not.toHaveBeenCalled();
});

test('coin grants reject bots, outsiders and missing reasons before changing funds', async () => {
    await expect(service.coins('1', grant({ reason: '' }))).rejects.toMatchObject({ status: 400 });
    guild.members.fetch.mockResolvedValueOnce({ user: { bot: true } });
    await expect(service.coins('1', grant())).rejects.toMatchObject({ status: 400 });
    guild.members.fetch.mockRejectedValueOnce(Object.assign(new Error('Unknown Member'), { code: 10007 }));
    await expect(service.coins('1', grant())).rejects.toMatchObject({ status: 400 });
    guild.members.fetch.mockResolvedValueOnce(namedMember('14', { displayName: 'Sai ID' }));
    await expect(service.coins('1', grant())).rejects.toMatchObject({ status: 400 });
    guild.members.fetch.mockResolvedValueOnce(namedMember('13', { guild: { id: '2' } }));
    await expect(service.coins('1', grant())).rejects.toMatchObject({ status: 400 });
    await expect(service.coins('2', grant())).rejects.toMatchObject({ status: 404 });
    expect(store.transact).not.toHaveBeenCalled();
});

test('coin grant confirmation and audit identify the exact recipient by sanitized display name and ID', async () => {
    guild.members.fetch.mockResolvedValue(namedMember('13', { displayName: 'Nguyễn\u0000 An', user: { globalName: 'Other name' } }));
    const body = grant();
    const result = await service.coins('1', body);
    expect(result).toMatchObject({ userId: '13', userName: 'Nguyễn An', message: 'Đã cộng 1,234.56 xu cho Nguyễn An (13).' });
    const saved = await disk.read('1');
    expect(saved.adminAudit.entries[0]).toMatchObject({ message: result.message, userId: '13' });
    guild.members.fetch.mockRejectedValue(new Error('Offline'));
    expect(await service.coins('1', body)).toEqual({ ...result, replayed: true });
});

test('settings validate bot channel access and synchronize only after a scoped commit', async () => {
    wallet.automaticChannel.mockReturnValueOnce(false);
    await expect(service.settings('1', { taixiuEnabled: true, taixiuChannelId: '20' })).rejects.toMatchObject({ status: 400 });
    expect(wallet.syncAutomaticBoard).not.toHaveBeenCalled();
    wallet.automaticChannel.mockReturnValue(true);
    wallet.syncAutomaticBoard.mockImplementationOnce(async () => {
        expect((await disk.read('1')).settings.taixiuRoom).toEqual({ channelId: '20' });
    });
    await service.settings('1', { taixiuEnabled: true, taixiuChannelId: '20' });
    await service.settings('1', { taixiuEnabled: false });
    expect((await disk.read('1')).settings.taixiuRoom).toBeUndefined();
    expect((await disk.read('1')).adminAudit.entries).toHaveLength(2);
});

test('audit retains the latest 200 records and API text strips control characters', async () => {
    await disk.transact('1', async (state, save) => {
        state.adminAudit = { entries: Array.from({ length: 200 }, (_, index) => ({ id: String(index), action: 'old', message: 'old', at: index })) };
        await save();
    });
    await service.music('1', { action: 'volume', volume: 50 });
    const saved = await disk.read('1');
    expect(saved.adminAudit.entries).toHaveLength(200);
    expect(saved.adminAudit.entries[0].action).toBe('music.volume');
    expect(saved.adminAudit.entries.at(-1).id).toBe('198');
    guild.name = 'safe\u0000name';
    expect((await service.guild('1')).guild.name).toBe('safename');
});

test('cancelling Battle reuses transactional host cancellation and never mutates a started room', async () => {
    const room = { id: '300', status: 'waiting', hostId: '13', channelId: '20', players: [{ id: '13' }], format: '2',
        caseIds: ['battle-test'], fee: '100', expiresAt: Date.now() + 60_000 };
    await disk.transact('1', async (state, save) => { state.cs2Battles = { 300: room }; await save(); });
    battle.actOnRoom.mockResolvedValueOnce({ room: { ...room, status: 'cancelled' } });
    const result = await service.cancelBattle('1', '300');
    expect(result.battle.status).toBe('cancelled');
    expect(battle.actOnRoom).toHaveBeenCalledWith(guild, '20', '300', '13', 'cancel');
    await disk.transact('1', async (state, save) => { state.cs2Battles['300'].status = 'revealing'; await save(); });
    await expect(service.cancelBattle('1', '300')).rejects.toMatchObject({ status: 409 });
    expect(battle.actOnRoom).toHaveBeenCalledTimes(1);
});
