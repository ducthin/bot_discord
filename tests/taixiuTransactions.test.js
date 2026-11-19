const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ChannelType, PermissionsBitField } = require('discord.js');
const store = require('../utils/managementStore');
const taixiu = require('../commands/taixiu');
const { COIN_SCALE } = require('../utils/coins');

let directory;
let disk;
let guild;
let channel;

beforeEach(async () => {
    jest.useFakeTimers();
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-taixiu-'));
    disk = store.createManagementStore(directory);
    jest.spyOn(store, 'read').mockImplementation(disk.read);
    jest.spyOn(store, 'transact').mockImplementation(disk.transact);
    guild = { id: '1', members: { me: {} }, channels: { cache: new Map() } };
    channel = {
        id: '10', type: ChannelType.GuildText,
        permissionsFor: () => new PermissionsBitField(PermissionsBitField.All),
        messages: { edit: jest.fn().mockResolvedValue({ id: '99' }) },
        send: jest.fn().mockResolvedValue({ id: '99' })
    };
    guild.channels.cache.set(channel.id, channel);
    await disk.transact(guild.id, async (state, save) => {
        state.settings.taixiuRoom = { channelId: channel.id };
        state.taixiu.balances = { 13: 1000, 14: 5000 };
        state.taixiu.round = { id: 'round', automatic: true, channelId: channel.id, messageId: '99', closesAt: null, bets: {} };
        state.skinCases = { 13: { drops: [] }, 14: { drops: [{ id: 'keep', skinId: 'old' }] } };
        await save();
    });
});

afterEach(async () => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    for (const file of await fs.readdir(directory)) await fs.unlink(path.join(directory, file));
    await fs.rmdir(directory);
});

function bet(id = '101', amount = '100') {
    return {
        id, guild, guildId: guild.id, user: { id: '13' }, channelId: channel.id, message: { id: '99' },
        customId: 'mg_taixiu_bet_tai_round', fields: { getTextInputValue: () => amount },
        deferReply: jest.fn(), editReply: jest.fn().mockResolvedValue(), followUp: jest.fn().mockResolvedValue()
    };
}

test('duplicate bet delivery deducts once across simultaneous requests and a store restart', async () => {
    const first = bet();
    const duplicate = bet();
    await Promise.all([taixiu.modal(first), taixiu.modal(duplicate)]);
    let state = await disk.read(guild.id);
    expect(state.taixiu.balances['13']).toBe(900);
    expect(state.taixiu.round.bets['13']).toEqual({ tai: 100, xiu: 0 });
    expect(duplicate.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('đã được ghi nhận') }));
    expect(store.transact).toHaveBeenCalledWith(guild.id, expect.any(Function), { sections: ['taixiu', 'settings'], wallets: 'all' });

    const reopened = store.createManagementStore(directory);
    store.transact.mockImplementation(reopened.transact);
    await taixiu.modal(bet());
    await taixiu.modal(bet('102'));
    state = await reopened.read(guild.id);
    expect(state.taixiu.balances['13']).toBe(800);
    expect(state.taixiu.round.bets['13']).toEqual({ tai: 200, xiu: 0 });
    expect(state.skinCases['14'].drops).toEqual([{ id: 'keep', skinId: 'old' }]);
});

test('a failed database commit cannot publish a bet receipt or start a round timer', async () => {
    store.transact.mockImplementationOnce(async (guildId, operation) => {
        const draft = await disk.read(guildId);
        await operation(draft, async () => {});
        throw new Error('Commit failed');
    });
    const request = bet();
    await expect(taixiu.modal(request)).rejects.toThrow('Commit failed');
    expect(request.editReply).not.toHaveBeenCalled();
    expect(channel.messages.edit).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    const state = await disk.read(guild.id);
    expect(state.taixiu.balances['13']).toBe(1000);
    expect(state.taixiu.round.closesAt).toBeNull();
});

test('scoped purchases coalesce a full ranking reload and preserve other inventories', async () => {
    await taixiu.resume(guild);
    channel.messages.edit.mockClear();
    store.read.mockClear();
    const scope = { wallets: ['13'], inventory: ['13'] };
    await taixiu.purchaseWithCoins(guild, '13', 100n * COIN_SCALE, state => {
        state.skinCases['13'].drops.push({ id: 'first' });
        return true;
    }, scope);
    await taixiu.purchaseWithCoins(guild, '13', 100n * COIN_SCALE, state => {
        state.skinCases['13'].drops.push({ id: 'second' });
        return true;
    }, scope);
    expect(store.read).not.toHaveBeenCalled();
    store.transact.mockClear();
    await jest.advanceTimersByTimeAsync(1000);
    await disk.transact(guild.id, async () => {});
    expect(store.transact).toHaveBeenCalledTimes(1);
    expect(store.transact).toHaveBeenCalledWith(guild.id, expect.any(Function), { sections: ['taixiu', 'settings'], wallets: 'all' });
    const ranking = channel.messages.edit.mock.calls.at(-1)[1].embeds[1].toJSON().description;
    expect(ranking).toContain('<@14> · **5,000 xu**');
    expect(ranking).toContain('<@13> · **800 xu**');
    const state = await disk.read(guild.id);
    expect(state.skinCases['14'].drops).toEqual([{ id: 'keep', skinId: 'old' }]);
    expect(state.skinCases['13'].drops.map(drop => drop.id)).toEqual(['first', 'second']);
});

test('top ten includes held bets and preserves tied ranks without sorting every wallet', async () => {
    await disk.transact(guild.id, async (state, save) => {
        state.taixiu.balances = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [String(index + 100), index]));
        state.taixiu.balances['13'] = 1;
        state.taixiu.balances['14'] = 2000;
        state.taixiu.round.bets['13'] = { tai: 1999, xiu: 0 };
        await save();
    });
    const request = bet();
    await taixiu.showStats(request, 'top');
    const content = request.editReply.mock.calls[0][0].content;
    expect(content.split('\n')).toHaveLength(11);
    expect(content).toContain('**1.** <@13> · **2,000 xu**\n**1.** <@14> · **2,000 xu**\n**3.** <@199>');
    expect(content).not.toContain('<@191>');
});

test('a ranking refresh failure after a scoped sale cannot undo its committed coins or items', async () => {
    await taixiu.resume(guild);
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const scope = { wallets: ['14'], inventory: ['14'] };
    await expect(taixiu.sellForCoins(guild, '14', 250n * COIN_SCALE, state => {
        state.skinCases['14'].drops = [];
        return true;
    }, scope)).resolves.toEqual({ balance: 5250n * COIN_SCALE, reward: true });
    store.transact.mockRejectedValueOnce(new Error('Leaderboard unavailable'));
    await jest.advanceTimersByTimeAsync(1000);
    expect(error).toHaveBeenCalledWith('Lỗi cập nhật xếp hạng Tiệm Bánh Mây:', 'Leaderboard unavailable');
    const state = await disk.read(guild.id);
    expect(state.taixiu.balances['14']).toBe(5250);
    expect(state.skinCases['14'].drops).toEqual([]);
});
