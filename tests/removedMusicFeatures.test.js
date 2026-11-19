const { MessageFlags } = require('discord.js');
const music = require('../utils/musicUtils');
const { handleButton } = require('../handlers/interactionHandler');
const trending = require('../commands/trending');

beforeEach(() => {
    music.musicData.clear();
    jest.clearAllMocks();
});

test.each(['quiz_start', 'quiz_skip', 'quiz_cancel', 'recommend_add_all', 'recommend_play_0', 'recommend_refresh', 'visualizer_stop'])
('removed control %s responds without requiring voice or creating player state', async customId => {
    const interaction = { customId, isRepliable: () => true, reply: jest.fn() };
    await handleButton(interaction);
    expect(interaction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining('đã được gỡ'), flags: MessageFlags.Ephemeral
    });
    expect(music.musicData.size).toBe(0);
});

test('old auto-trending region controls preserve a usable status after the separate command is removed', async () => {
    const interaction = {
        customId: 'autotrending_kr', guild: { id: 'test' }, member: { voice: { channelId: 'voice' } },
        isRepliable: () => true, update: jest.fn(), reply: jest.fn()
    };
    await handleButton(interaction);
    expect(interaction.update).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Hàn Quốc') }));
    const data = music.musicData.get('test');
    expect(data.autoTrending).toMatchObject({ enabled: true, region: 'KR' });

    const status = {
        guildId: 'test', options: { getString: name => name === 'action' ? 'status' : null }, reply: jest.fn()
    };
    await trending.executeAuto(status);
    expect(status.reply.mock.calls[0][0].embeds[0].toJSON().fields).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: '📦 Còn trong list', value: '0 bài' }),
        expect.objectContaining({ name: '🔄 Đã đánh dấu', value: '0 bài' })
    ]));

    await handleButton({ ...interaction, customId: 'autotrending_off' });
    expect(data.autoTrending.enabled).toBe(false);
    status.reply.mockClear();
    await trending.executeAuto(status);
    expect(status.reply.mock.calls[0][0].embeds[0].toJSON().fields[0].value).toContain('Đã tắt');
});

test('trending auto remains available to enable and disable automatic playback', async () => {
    const data = music.initGuildMusicData('test');
    data.isPlaying = true;
    const interaction = {
        guildId: 'test', options: { getString: name => name === 'action' ? 'enable' : 'US' }, reply: jest.fn()
    };
    await trending.executeAuto(interaction);
    expect(data.autoTrending).toMatchObject({ enabled: true, region: 'US' });
    interaction.options.getString = name => name === 'action' ? 'disable' : null;
    await trending.executeAuto(interaction);
    expect(data.autoTrending.enabled).toBe(false);
});
