jest.mock('../utils/managementStore', () => ({ transact: jest.fn() }));

const { ChannelType } = require('discord.js');
const store = require('../utils/managementStore');
const { queueCleanup, reconcileRooms } = require('../utils/tempRooms');

beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.useRealTimers(); jest.clearAllMocks(); });

function fixture() {
    const state = { rooms: { 10: { ownerId: '20' } }, lfg: {} };
    const guild = { id: '1', channels: { cache: new Map() }, available: true };
    const channel = {
        id: '10', type: ChannelType.GuildVoice, members: new Map(),
        delete: jest.fn().mockResolvedValue(),
        permissionOverwrites: { cache: new Map(), delete: jest.fn().mockResolvedValue() }
    };
    guild.channels.cache.set(channel.id, channel);
    store.transact.mockImplementation(async (_guildId, operation) => operation(state, async () => {}));
    return { guild, channel, state };
}

test('repeated room cleanup requests use one timer and honor an earlier deadline', async () => {
    const { guild, channel, state } = fixture();
    queueCleanup(guild, channel.id, 7000);
    queueCleanup(guild, channel.id, 7000);
    queueCleanup(guild, channel.id, 3000);
    queueCleanup(guild, channel.id, 9000);
    expect(jest.getTimerCount()).toBe(1);
    await jest.advanceTimersByTimeAsync(3000);
    expect(channel.delete).toHaveBeenCalledTimes(1);
    expect(state.rooms).toEqual({});
    await jest.advanceTimersByTimeAsync(10000);
    expect(store.transact).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
});

test('repeated recovery schedules one expiry per temporary admission', async () => {
    const { guild, channel, state } = fixture();
    channel.members.set('20', { id: '20', user: { bot: false } });
    state.rooms['10'].admissions = { 21: { expiresAt: Date.now() + 60000, existed: false, original: 'inherit' } };
    await reconcileRooms(guild);
    await reconcileRooms(guild);
    await reconcileRooms(guild);
    expect(jest.getTimerCount()).toBe(1);
    store.transact.mockClear();
    await jest.advanceTimersByTimeAsync(60000);
    expect(store.transact).toHaveBeenCalledTimes(1);
    expect(channel.permissionOverwrites.delete).toHaveBeenCalledTimes(1);
    expect(state.rooms['10'].admissions).toEqual({});
    expect(jest.getTimerCount()).toBe(0);
});
