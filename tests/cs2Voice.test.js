const { EventEmitter } = require('node:events');
const { ChannelType } = require('discord.js');
const voice = require('@discordjs/voice');
const { musicData } = require('../utils/musicUtils');
const { prepareCaseVoice } = require('../utils/cs2Voice');

jest.mock('@discordjs/voice', () => ({
    AudioPlayerStatus: { Idle: 'idle' },
    NoSubscriberBehavior: { Stop: 'stop' },
    StreamType: { OggOpus: 'ogg/opus' },
    VoiceConnectionStatus: { Ready: 'ready', Disconnected: 'disconnected', Destroyed: 'destroyed' },
    createAudioPlayer: jest.fn(),
    createAudioResource: jest.fn(),
    entersState: jest.fn(),
    getVoiceConnection: jest.fn(),
    joinVoiceChannel: jest.fn()
}));
jest.mock('../utils/musicUtils', () => ({ musicData: new Map() }));

function player() {
    const audio = new EventEmitter();
    audio.state = { status: 'idle' };
    audio.play = () => { audio.state = { status: 'playing' }; };
    audio.stop = () => {
        if (audio.state.status === 'idle') return;
        audio.state = { status: 'idle' };
        audio.emit('idle');
    };
    return audio;
}

function fixture() {
    const channel = { id: '10', type: ChannelType.GuildVoice, permissionsFor: () => ({ has: () => true }) };
    const guild = { id: '1', members: { me: { voice: {} } } };
    const member = { id: '13', voice: { channel }, guild };
    const connection = new EventEmitter();
    connection.joinConfig = { channelId: channel.id };
    connection.state = { status: 'ready' };
    function setState(state) {
        const previous = connection.state;
        connection.state = state;
        connection.emit('stateChange', previous, state);
    }
    connection.subscribe = audio => {
        const subscription = {
            player: audio,
            unsubscribe() {
                if (connection.state.subscription === subscription) {
                    setState({ ...connection.state, subscription: undefined });
                }
            }
        };
        setState({ ...connection.state, subscription });
        return subscription;
    };
    connection.destroy = jest.fn(() => setState({ status: 'destroyed' }));
    voice.getVoiceConnection.mockReturnValue(undefined);
    voice.joinVoiceChannel.mockImplementation(() => {
        voice.getVoiceConnection.mockReturnValue(connection);
        return connection;
    });
    return { member, connection };
}

beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    musicData.clear();
    voice.createAudioPlayer.mockImplementation(player);
    voice.entersState.mockResolvedValue(undefined);
});

afterEach(() => jest.useRealTimers());

test('a second case reuses the same voice connection and restarts the one-minute idle timer', async () => {
    const { member, connection } = fixture();
    const first = await prepareCaseVoice(member);
    expect(first.start(Buffer.from('OggS'))).toBe(true);
    first.player.stop();
    await jest.advanceTimersByTimeAsync(50000);
    expect(connection.destroy).not.toHaveBeenCalled();

    const second = await prepareCaseVoice(member);
    expect(second.start(Buffer.from('OggS'))).toBe(true);
    await jest.advanceTimersByTimeAsync(11000);
    expect(voice.joinVoiceChannel).toHaveBeenCalledTimes(1);
    expect(connection.destroy).not.toHaveBeenCalled();
    second.player.stop();
    await jest.advanceTimersByTimeAsync(59999);
    expect(connection.destroy).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(connection.destroy).toHaveBeenCalledTimes(1);
});

test('a late connection stays ready for the next case and hands the room to music', async () => {
    const { member, connection } = fixture();
    const session = await prepareCaseVoice(member);
    session.rest();
    await jest.advanceTimersByTimeAsync(1000);
    const musicPlayer = player();
    musicData.set(member.guild.id, { connection });
    connection.subscribe(musicPlayer);
    await jest.advanceTimersByTimeAsync(60000);
    expect(connection.destroy).not.toHaveBeenCalled();
    expect(connection.state.subscription.player).toBe(musicPlayer);
});
