const voiceCommands = new Set([
    'play', 'p', 'playlist', 'pause', 'ps', 'resume', 'r', 'skip', 's', 'skipto',
    'stop', 'st', 'seek', 'leave', 'dc', 'volume', 'v', 'loop', 'lp', 'shuffle',
    'autoplay', 'trending'
]);

const voiceButtons = new Set([
    'toggle_playback', 'pause_music', 'resume_music', 'skip_music', 'stop_music', 'shuffle_music',
    'music_pause', 'music_resume', 'music_skip', 'music_stop', 'music_shuffle',
    'seek_back_30', 'seek_forward_30', 'loop_toggle', 'quick_select', 'clear_queue',
    'leave_voice'
]);

function commandNeedsVoice(interaction) {
    if (interaction.commandName === 'playlist-save') return interaction.options.getSubcommand() === 'load';
    if (['queue', 'q'].includes(interaction.commandName)) return Boolean(interaction.options.getString('action'));
    return voiceCommands.has(interaction.commandName);
}

function buttonNeedsVoice(id) {
    return voiceButtons.has(id) || /^(select_song_|volume_|trending_|autotrending_)/.test(id);
}

function getVoiceAccessError(member, guildData) {
    const memberChannel = member?.voice?.channelId ?? member?.voice?.channel?.id;
    if (!memberChannel) return '❌ Bạn cần vào kênh voice trước.';
    const botChannel = member.guild?.members?.me?.voice?.channelId ?? guildData?.connection?.joinConfig?.channelId;
    if (botChannel && memberChannel !== botChannel) return '❌ Bạn cần ở cùng kênh voice với bot để điều khiển nhạc.';
    return null;
}

module.exports = { getVoiceAccessError, commandNeedsVoice, buttonNeedsVoice };
