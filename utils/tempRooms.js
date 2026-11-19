const { ChannelType, PermissionFlagsBits, PermissionsBitField, OverwriteType, RESTJSONErrorCodes } = require('discord.js');
const store = require('./managementStore');
const { roomResources } = require('./managementAccess');
const { canJoinVoice, canMoveBetween, moveVoiceMember } = require('./voiceMoves');

const MAX_ROOMS = 50;
const ROOM_ACCESS_MS = 60000;
const Connect = PermissionFlagsBits.Connect;
const people = channel => [...channel.members.values()].filter(member => !member.user.bot);
const cleanupTimers = new WeakMap();
const accessTimers = new WeakMap();

function queueCleanup(guild, id, delay = 7000) {
    const timers = cleanupTimers.get(guild) || new Map();
    cleanupTimers.set(guild, timers);
    const due = Date.now() + Math.max(0, delay);
    const existing = timers.get(id);
    if (existing && existing.due <= due) return;
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
        if (timers.get(id)?.timer === timer) timers.delete(id);
        void store.transact(guild.id, async (state, save) => {
            if (guild.available === false || !state.rooms[id]) return;
            if (await reconcileRoom(guild, state, id, true)) await save();
        }).catch(error => console.error('Lỗi dọn phòng thoại tạm:', error.message));
    }, Math.max(0, delay));
    timer.unref();
    timers.set(id, { timer, due });
}

async function reconcileRoom(guild, state, id, deleteEmpty = false) {
    const channel = guild.channels.cache.get(id);
    if (channel?.type !== ChannelType.GuildVoice) {
        delete state.rooms[id];
        return true;
    }
    const room = state.rooms[id];
    const members = people(channel);
    const ownerPresent = members.some(member => member.id === room.ownerId) ||
        guild.voiceStates?.cache.get(room.ownerId)?.channelId === id;
    if (room.reservedUntil > Date.now() && !ownerPresent) {
        queueCleanup(guild, id, Math.max(0, room.reservedUntil - Date.now()));
        return false;
    }
    const hadReservation = Boolean(room.reservedUntil);
    delete room.reservedUntil;
    if (!members.length) {
        const unknownOccupant = [...(guild.voiceStates?.cache.values() || [])]
            .some(voice => voice.channelId === id && !voice.member);
        if (unknownOccupant) return hadReservation;
        const team = state.lfg[room.lfgTeamId];
        if (team?.roomId === id && !team.closed && team.expiresAt > Date.now()) {
            queueCleanup(guild, id, team.expiresAt - Date.now());
            return hadReservation;
        }
        if (!deleteEmpty) {
            queueCleanup(guild, id);
            return hadReservation;
        }
        try {
            await channel.delete('Phòng thoại tạm đã trống');
        } catch (error) {
            if (error.code !== RESTJSONErrorCodes.UnknownChannel) throw error;
        }
        delete state.rooms[id];
        return true;
    }
    if (ownerPresent) return hadReservation;
    room.ownerId = members[0].id;
    return true;
}

async function reconcileRooms(guild) {
    return store.transact(guild.id, async (state, save) => {
        let changed = false;
        for (const id of Object.keys(state.rooms)) {
            if (await reconcileRoom(guild, state, id)) changed = true;
            for (const [memberId, admission] of Object.entries(state.rooms[id]?.admissions || {})) {
                queueAccessRemoval(guild, id, memberId, admission.expiresAt);
            }
        }
        if (changed) await save();
    });
}

async function onVoiceChange(oldState, newState) {
    const { guild, member, channelId } = newState;
    if (oldState.channelId === channelId) return;

    await store.transact(guild.id, async (state, save) => {
        let changed = false;
        if (state.rooms[oldState.channelId]) changed = await reconcileRoom(guild, state, oldState.channelId);
        if (!member || member.user.bot || !channelId) {
            if (changed) await save();
            return;
        }

        const settings = state.settings.rooms;
        const joinedRoom = state.rooms[channelId];
        if (joinedRoom?.reservedUntil && joinedRoom.ownerId === member.id) {
            delete joinedRoom.reservedUntil;
            changed = true;
        }
        if (state.settings.trackVoice && channelId !== settings?.lobbyId) {
            const activity = state.activity;
            if (state.rooms[channelId]) {
                activity.roomJoins++;
            } else {
                for (const id of Object.keys(activity.voiceJoins)) {
                    if (!guild.channels.cache.has(id)) delete activity.voiceJoins[id];
                }
                activity.voiceJoins[channelId] = (activity.voiceJoins[channelId] || 0) + 1;
            }
            changed = true;
        }
        if (changed) await save();

        if (channelId !== settings?.lobbyId || member.voice.channelId !== channelId) return;
        const resources = roomResources(guild, settings);
        if (!resources) return;
        const { lobby, category } = resources;
        const owned = Object.keys(state.rooms).find(id => state.rooms[id].ownerId === member.id && guild.channels.cache.has(id));
        if (owned) {
            const existing = guild.channels.cache.get(owned);
            if (canJoinVoice(member, existing) && canMoveBetween(guild.members.me, lobby, existing)) {
                await moveVoiceMember(guild, member, existing);
            }
            return;
        }
        if (Object.keys(state.rooms).length >= MAX_ROOMS) return;

        const channel = await createTemporaryChannel(guild, category, '🎙️ ' + member.displayName);
        state.rooms[channel.id] = { ownerId: member.id };
        try {
            await save();
        } catch (error) {
            await channel.delete('Không lưu được phòng thoại tạm').catch(() => {});
            throw error;
        }
        if (member.voice.channelId !== lobby.id || !canJoinVoice(member, channel) || !canMoveBetween(guild.members.me, lobby, channel)) {
            queueCleanup(guild, channel.id);
            return;
        }
        const error = await moveVoiceMember(guild, member, channel);
        if (error) {
            queueCleanup(guild, channel.id);
            return;
        }
        state.activity.roomsOpened++;
        await save();
    });
}

function copyOverwrites(channel) {
    return new Map(channel.permissionOverwrites.cache.map(overwrite => [
        overwrite.id, { id: overwrite.id, type: overwrite.type, allow: new PermissionsBitField(overwrite.allow), deny: new PermissionsBitField(overwrite.deny) }
    ]));
}

function createTemporaryChannel(guild, category, name, userLimit) {
    return guild.channels.create({
        name: name.slice(0, 100).toWellFormed(),
        type: ChannelType.GuildVoice,
        parent: category.id,
        userLimit,
        permissionOverwrites: [...copyOverwrites(category).values()],
        reason: 'Tạo phòng thoại tạm'
    });
}

function setConnect(overwrite, value) {
    overwrite.allow.remove(Connect);
    overwrite.deny.remove(Connect);
    if (value === 'allow') overwrite.allow.add(Connect);
    if (value === 'deny') overwrite.deny.add(Connect);
}

function connectValue(overwrite) {
    if (overwrite?.allow.has(Connect, false)) return 'allow';
    return overwrite?.deny.has(Connect, false) ? 'deny' : 'inherit';
}

function canJoinBeforeLock(member, channel, room) {
    if (!channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel)) return false;
    // Restore the original Connect calculation: @everyone, combined roles, then the member.
    const original = id => Object.hasOwn(room.lock, id)
        ? room.lock[id]?.value || 'inherit'
        : connectValue(channel.permissionOverwrites.cache.get(id));
    const everyone = original(channel.guild.id);
    let allowed = everyone === 'inherit' ? member.permissions.has(Connect, false) : everyone === 'allow';
    const roles = [...member.roles.cache.keys()].filter(id => id !== channel.guild.id).map(original);
    if (roles.includes('deny')) allowed = false;
    if (roles.includes('allow')) allowed = true;
    const memberOverride = original(member.id);
    return memberOverride === 'inherit' ? allowed : memberOverride === 'allow';
}

function queueAccessRemoval(guild, id, memberId, expiresAt, delay = Math.max(0, expiresAt - Date.now())) {
    const timers = accessTimers.get(guild) || new Map();
    accessTimers.set(guild, timers);
    const key = `${id}:${memberId}:${expiresAt}`;
    const existing = timers.get(key);
    if (existing) return;
    const timer = setTimeout(() => {
        if (timers.get(key)?.timer === timer) timers.delete(key);
        void store.transact(guild.id, async (state, save) => {
            const room = state.rooms[id];
            const admission = room?.admissions?.[memberId];
            if (admission?.expiresAt !== expiresAt) return;
            if (Date.now() < expiresAt) {
                queueAccessRemoval(guild, id, memberId, expiresAt);
                return;
            }
            if (guild.available === false) throw new Error('Máy chủ chưa sẵn sàng.');
            const channel = guild.channels.cache.get(id);
            if (channel) {
                const overwrite = channel.permissionOverwrites.cache.get(memberId);
                const otherBits = overwrite && ((overwrite.allow.bitfield | overwrite.deny.bitfield) & ~Connect);
                if (!admission.existed && !otherBits) {
                    await channel.permissionOverwrites.delete(memberId, 'Hết giờ vào phòng tạm').catch(error => {
                        if (![RESTJSONErrorCodes.UnknownPermissionOverwrite, RESTJSONErrorCodes.UnknownChannel].includes(error.code)) throw error;
                    });
                } else {
                    const value = admission.original === 'inherit' ? null : admission.original === 'allow';
                    await channel.permissionOverwrites.edit(memberId, { Connect: value }, { type: OverwriteType.Member, reason: 'Hết giờ vào phòng tạm' })
                        .catch(error => {
                            if (error.code !== RESTJSONErrorCodes.UnknownChannel) throw error;
                        });
                }
            }
            if (admission.addedToLock && room.lock) delete room.lock[memberId];
            delete room.admissions[memberId];
            await save();
        }).catch(error => {
            console.error('Lỗi thu hồi quyền vào phòng tạm:', error.message);
            queueAccessRemoval(guild, id, memberId, expiresAt, ROOM_ACCESS_MS);
        });
    }, Math.max(0, delay));
    timer.unref();
    timers.set(key, { timer });
}

async function grantRoomAccess(channel, room, member, save) {
    if (room.admissions?.[member.id]) return false;
    const overwrite = channel.permissionOverwrites.cache.get(member.id);
    const original = connectValue(overwrite);
    const addedToLock = !Object.hasOwn(room.lock, member.id);
    if (addedToLock) room.lock[member.id] = overwrite ? { value: original } : null;
    room.admissions ??= {};
    const expiresAt = Date.now() + ROOM_ACCESS_MS;
    room.admissions[member.id] = { existed: Boolean(overwrite), original, addedToLock, expiresAt };
    await save();
    queueAccessRemoval(channel.guild, channel.id, member.id, expiresAt);
    try {
        await channel.permissionOverwrites.edit(member.id, { Connect: true }, {
            type: OverwriteType.Member, reason: 'Chủ phòng đồng ý cho vào'
        });
    } catch (error) {
        if ([400, 401, 403, 404].includes(error.status)) {
            if (addedToLock) delete room.lock[member.id];
            delete room.admissions[member.id];
            await save();
        }
        throw error;
    }
    return true;
}

async function toggleRoomLock(channel, room, save) {
    const overwrites = copyOverwrites(channel);
    if (room.lock) {
        for (const [id, original] of Object.entries(room.lock)) {
            const overwrite = overwrites.get(id);
            if (!overwrite) continue;
            setConnect(overwrite, original?.value);
            if (!original && !overwrite.allow.bitfield && !overwrite.deny.bitfield) overwrites.delete(id);
        }
        await channel.permissionOverwrites.set([...overwrites.values()], 'Mở phòng thoại tạm');
        delete room.lock;
        delete room.admissions;
        await save();
        return false;
    }

    const lock = {};
    const change = (id, type, value) => {
        const overwrite = overwrites.get(id);
        lock[id] = overwrite ? { value: connectValue(overwrite) } : null;
        const updated = overwrite || { id, type, allow: new PermissionsBitField(), deny: new PermissionsBitField() };
        setConnect(updated, value);
        overwrites.set(id, updated);
    };
    const { guild } = channel;
    const bot = guild.members.me;
    for (const overwrite of overwrites.values()) {
        if (overwrite.id !== guild.id && overwrite.id !== bot.id && overwrite.allow.has(Connect, false)) {
            change(overwrite.id, overwrite.type, 'deny');
        }
    }
    change(guild.id, OverwriteType.Role, 'deny');
    if (canJoinVoice(bot, channel)) change(bot.id, OverwriteType.Member, 'allow');

    room.lock = lock;
    await save();
    try {
        await channel.permissionOverwrites.set([...overwrites.values()], 'Khóa phòng thoại tạm');
    } catch (error) {
        delete room.lock;
        await save();
        throw error;
    }
    return true;
}

module.exports = {
    onVoiceChange, reconcileRooms, toggleRoomLock, createTemporaryChannel, queueCleanup, MAX_ROOMS,
    canJoinBeforeLock, grantRoomAccess
};
