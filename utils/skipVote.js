const { skipCurrentSong } = require('./musicUtils');
const { getVoiceAccessError } = require('./voiceAccess');

function listenersInVoice(member) {
    const members = member?.voice?.channel?.members?.values() ?? [];
    return new Set([...members].filter(listener => !listener.user.bot).map(listener => listener.id));
}

function canSkipImmediately(member, listeners = listenersInVoice(member)) {
    if (listeners.size < 3) return true;
    const configuredRoles = (process.env.DJ_ROLE_IDS ?? '').split(',').map(id => id.trim());
    const serverRoles = configuredRoles.filter(id => member.guild?.roles?.cache?.has(id));
    const roles = member.roles?.cache;
    return serverRoles.length
        ? serverRoles.some(id => roles?.has(id))
        : [...(roles?.values() ?? [])].some(role => role.name.trim().toLowerCase() === 'dj');
}

function requestSkip(member, guildData) {
    const denied = content => ({ content, private: true });
    const error = getVoiceAccessError(member, guildData);
    if (error) return denied(error);
    const song = guildData.currentSong;
    if (!song || !guildData.player) return denied('❌ Không có nhạc nào để bỏ qua.');

    const listeners = listenersInVoice(member);
    if (!listeners.has(member.id)) return denied('❌ Chỉ thành viên đang nghe trong phòng voice mới được bỏ phiếu.');

    const channelId = member.voice.channel.id;
    let vote = guildData.skipVote;
    if (vote?.song !== song || vote.channelId !== channelId) {
        vote = { song, channelId, voters: new Set(), resolved: false };
        guildData.skipVote = vote;
    }
    if (vote.resolved) return denied('⏳ Tèo đang chuyển bài.');

    const skip = content => {
        vote.resolved = true;
        skipCurrentSong(guildData);
        return { content };
    };
    if (canSkipImmediately(member, listeners)) return skip('⏭️ Đã bỏ qua bài hát!');

    for (const id of vote.voters) if (!listeners.has(id)) vote.voters.delete(id);
    const alreadyVoted = vote.voters.has(member.id);
    vote.voters.add(member.id);
    const required = Math.floor(listeners.size / 2) + 1;
    const tally = `${vote.voters.size}/${required}`;
    if (vote.voters.size >= required) return skip(`⏭️ Đủ phiếu (${tally}). Đã bỏ qua bài hát!`);
    return alreadyVoted
        ? denied(`🗳️ Bạn đã bỏ phiếu cho bài này. Hiện có ${tally} phiếu cần thiết.`)
        : { content: `🗳️ Đã bỏ phiếu skip. Hiện có **${tally}** phiếu cần thiết.` };
}

module.exports = { requestSkip, canSkipImmediately };
