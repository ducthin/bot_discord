const { PermissionFlagsBits, RESTJSONErrorCodes } = require('discord.js');

const { ViewChannel, MoveMembers, Connect } = PermissionFlagsBits;
const MOVE_TTL = 5 * 60 * 1000;
const MAX_HISTORY = 100;
const states = new WeakMap();

function getState(guild) {
    if (!states.has(guild)) states.set(guild, { history: new Map(), moving: new Set() });
    return states.get(guild);
}

function canJoinVoice(member, channel) {
    return Boolean(member && channel?.permissionsFor(member)?.has([ViewChannel, Connect]));
}

function canMoveBetween(member, source, destination) {
    return canJoinVoice(member, destination) &&
        source.permissionsFor(member)?.has([ViewChannel, MoveMembers]) &&
        destination.permissionsFor(member)?.has(MoveMembers);
}

async function moveVoiceMember(guild, target, destination) {
    const moving = getState(guild).moving;
    if (moving.has(target.id)) return '⏳ Bot đang chuyển thành viên này. Hãy thử lại.';
    moving.add(target.id);
    try {
        await target.voice.setChannel(destination);
        return null;
    } catch (error) {
        if (error.code === RESTJSONErrorCodes.TargetUserIsNotConnectedToVoice) {
            return '❌ Thành viên này vừa rời kênh thoại.';
        }
        if ([RESTJSONErrorCodes.MissingAccess, RESTJSONErrorCodes.MissingPermissions].includes(error.code)) {
            return '❌ Discord từ chối thao tác. Hãy kiểm tra quyền của bot trong hai kênh thoại.';
        }
        console.error('Lỗi khi chuyển kênh thoại:', error.message);
        return '❌ Discord không chuyển được thành viên. Hãy kiểm tra kênh đích rồi thử lại.';
    } finally {
        moving.delete(target.id);
    }
}

function rememberMove(guild, actorId, targetId, sourceId, destinationId) {
    const history = getState(guild).history;
    const now = Date.now();
    for (const [id, move] of history) {
        if (move.expiresAt <= now) history.delete(id);
    }
    history.delete(actorId);
    if (history.size >= MAX_HISTORY) history.delete(history.keys().next().value);
    history.set(actorId, { targetId, sourceId, destinationId, expiresAt: now + MOVE_TTL });
}

function getLastMove(guild, actorId) {
    const history = getState(guild).history;
    const move = history.get(actorId);
    if (move && move.expiresAt > Date.now()) return move;
    history.delete(actorId);
    return null;
}

function forgetMove(guild, actorId, move) {
    const history = getState(guild).history;
    if (history.get(actorId) === move) history.delete(actorId);
}

module.exports = { canJoinVoice, canMoveBetween, moveVoiceMember, rememberMove, getLastMove, forgetMove };
