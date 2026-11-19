const { Readable } = require('node:stream');
const { ChannelType, Events, PermissionFlagsBits } = require('discord.js');
const {
    AudioPlayerStatus, NoSubscriberBehavior, StreamType, VoiceConnectionStatus,
    createAudioPlayer, createAudioResource, entersState, getVoiceConnection, joinVoiceChannel
} = require('@discordjs/voice');
const { musicData } = require('./musicUtils');

const IDLE_DISCONNECT_MS = 60000;
const sessions = new Map();

function caseVoiceError(member) {
    const channel = member?.voice?.channel;
    if (channel?.type !== ChannelType.GuildVoice) return 'Vào phòng thoại rồi bấm **Mở có tiếng**.';
    const { guild } = member;
    const bot = guild.members.me;
    const connection = getVoiceConnection(guild.id);
    const botChannel = connection?.joinConfig.channelId ?? bot?.voice?.channelId;
    if (botChannel && botChannel !== channel.id) return 'Bot đang ở một phòng thoại khác.';
    if (!bot || !channel.permissionsFor(bot)?.has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) {
        return 'Bot cần quyền Kết nối và Nói trong phòng thoại này.';
    }
    const session = sessions.get(guild.id);
    const music = musicData.get(guild.id);
    const player = connection?.state.subscription?.player;
    if (music?.isPlaying ||
        (player && player !== session?.player && player.state.status !== AudioPlayerStatus.Idle) ||
        (session && !session.idle && session.memberId !== member.id)) return 'Bot đang phát âm thanh trong phòng thoại.';
    return null;
}

async function prepareCaseVoice(member) {
    if (caseVoiceError(member)) return null;
    const { guild } = member;
    const channelId = member.voice.channel.id;
    const previous = sessions.get(guild.id);
    const existing = getVoiceConnection(guild.id);
    const owned = previous?.owned ?? !existing;
    previous?.close(true);
    const connection = existing ?? joinVoiceChannel({
        channelId, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator, selfDeaf: true, selfMute: false
    });
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Stop } });
    let subscription;
    let displaced;
    let timeout;
    const session = { memberId: member.id, player, owned, idle: false, close, rest, start };
    sessions.set(guild.id, session);

    function releasePlayer() {
        const current = subscription;
        subscription = undefined;
        displaced?.off('stateChange', onPlayerState);
        if (current && connection.state.subscription === current) {
            current.unsubscribe();
            if (displaced && connection.state.status === VoiceConnectionStatus.Ready) connection.subscribe(displaced);
        }
        displaced = undefined;
        player.stop(true);
    }

    function close(keepConnection = false) {
        if (sessions.get(guild.id) !== session) return;
        sessions.delete(guild.id);
        clearTimeout(timeout);
        connection.off('stateChange', onVoiceState);
        connection.off('error', onError);
        guild.client?.off(Events.VoiceStateUpdate, onMemberVoice);
        releasePlayer();
        if (connection.state.status === VoiceConnectionStatus.Destroyed) return;
        if (!keepConnection && owned && musicData.get(guild.id)?.connection !== connection &&
            !connection.state.subscription) connection.destroy();
    }

    function rest() {
        if (sessions.get(guild.id) !== session || session.idle) return;
        if (!owned || musicData.get(guild.id)?.connection === connection ||
            connection.state.status !== VoiceConnectionStatus.Ready) return close();

        session.idle = true;
        clearTimeout(timeout);
        releasePlayer();
        if (sessions.get(guild.id) === session) {
            timeout = setTimeout(close, IDLE_DISCONNECT_MS);
            timeout.unref();
        }
    }

    function onPlayerState(_, state) {
        if (state.status !== AudioPlayerStatus.Idle) close();
    }

    function onVoiceState(_, state) {
        if (state.status === VoiceConnectionStatus.Disconnected || state.status === VoiceConnectionStatus.Destroyed ||
            (subscription && state.subscription !== subscription) || (session.idle && state.subscription)) close();
    }

    function onError() { close(); }

    function onMemberVoice(_, state) {
        if (state.guild.id === guild.id && state.id === member.id && state.channelId !== channelId) close();
    }

    function start(audio) {
        if (sessions.get(guild.id) !== session || session.idle || member.voice.channel?.id !== channelId ||
            connection.state.status !== VoiceConnectionStatus.Ready || caseVoiceError(member)) {
            close();
            return false;
        }
        try {
            const resource = createAudioResource(Readable.from([audio]), { inputType: StreamType.OggOpus });
            displaced = connection.state.subscription?.player;
            displaced?.on('stateChange', onPlayerState);
            subscription = connection.subscribe(player);
            if (!subscription) {
                close();
                return false;
            }
            player.play(resource);
            timeout = setTimeout(close, 15000);
            timeout.unref();
            return true;
        } catch {
            close();
            return false;
        }
    }

    player.on(AudioPlayerStatus.Idle, () => {
        if (subscription) rest();
    });
    player.on('error', onError);
    connection.on('stateChange', onVoiceState);
    connection.on('error', onError);
    guild.client?.on(Events.VoiceStateUpdate, onMemberVoice);
    try {
        await entersState(connection, VoiceConnectionStatus.Ready, 2500);
        return sessions.get(guild.id) === session ? session : null;
    } catch {
        close();
        return null;
    }
}

module.exports = { caseVoiceError, prepareCaseVoice };
