const {
    SlashCommandBuilder, ChannelType, PermissionFlagsBits, MessageFlags, EmbedBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, RESTJSONErrorCodes, escapeMarkdown
} = require('discord.js');
const store = require('../utils/managementStore');
const { respond, edit, hasChannelPermissions, roomResources } = require('../utils/managementAccess');
const { createTemporaryChannel, queueCleanup, MAX_ROOMS } = require('../utils/tempRooms');
const { canJoinVoice, canMoveBetween, moveVoiceMember } = require('../utils/voiceMoves');

const RECRUITMENT_TTL = 6 * 60 * 60 * 1000;
const ROOM_RESERVATION = 5 * 60 * 1000;
const { ViewChannel, SendMessages, EmbedLinks } = PermissionFlagsBits;

function isRecruiting(team) {
    // Older teams finished recruiting as soon as a room was created.
    return !(team.closed ?? Boolean(team.roomId)) && team.expiresAt > Date.now();
}

function teamLabel(team) {
    return `TEAM #${team.number ?? team.id.slice(-6)}`;
}

function teamButton(team, action, label, style = ButtonStyle.Secondary) {
    return new ButtonBuilder().setCustomId(`mg_lfg_${action}_${team.id}`).setLabel(label).setStyle(style);
}

function isVoiceRoom(channel) {
    return channel?.type === ChannelType.GuildVoice || channel?.type === ChannelType.GuildStageVoice;
}

function roomReference(team, voice) {
    if (isVoiceRoom(voice)) return `<#${voice.id}>`;
    return team.usesHostRoom ? 'Phòng thoại đã mất' : teamLabel(team);
}

function render(team, guild) {
    const open = isRecruiting(team);
    const owner = guild.members.cache.get(team.ownerId);
    const ownerName = owner?.displayName || team.ownerName || 'Chủ nhóm';
    const ownerAvatar = owner?.user?.displayAvatarURL?.({ size: 64 }) || team.ownerAvatar;
    const voice = guild.channels.cache.get(team.roomId);
    const embed = new EmbedBuilder()
        .setAuthor({ name: ownerName, iconURL: ownerAvatar })
        .setTitle(escapeMarkdown(team.game))
        .setColor('#4e5058')
        .addFields(
            { name: 'Phòng', value: roomReference(team, voice), inline: true },
            { name: 'Chỗ', value: `${team.members.length}/${team.capacity}`, inline: true },
            { name: 'Rank', value: escapeMarkdown(team.rank || 'Bất kỳ'), inline: true }
        );
    if (team.note) embed.setDescription(escapeMarkdown(team.note));
    if (!open) embed.setFooter({ text: 'Đã đóng tuyển' });
    const thumbnail = guild.iconURL?.({ size: 128 }) || guild.members.me?.user?.displayAvatarURL?.({ size: 128 });
    if (thumbnail) embed.setThumbnail(thumbnail);

    const components = [];
    if (open) {
        const roomName = (isVoiceRoom(voice) && voice.name) || (team.usesHostRoom ? '' : teamLabel(team));
        const label = roomName ? 'Tham gia ' + roomName : 'Tham gia';
        const shortLabel = label.length > 80 ? label.slice(0, 79).replace(/[\uD800-\uDBFF]$/, '') + '…' : label;
        const row = new ActionRowBuilder().addComponents(teamButton(team, 'join', shortLabel).setEmoji('🔊'));
        if (isVoiceRoom(voice)) row.addComponents(voiceLinkButton(guild.id, voice.id));
        row.addComponents(teamButton(team, 'options', 'Tùy chọn'));
        components.push(row);
    }
    return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

function voiceLinkButton(guildId, channelId) {
    return new ButtonBuilder()
        .setLabel('Mở kênh thoại')
        .setStyle(ButtonStyle.Link)
        .setURL(`https://discord.com/channels/${guildId}/${channelId}`);
}

function voiceLinkNotice(content, guildId, channelId) {
    return { content, components: [new ActionRowBuilder().addComponents(voiceLinkButton(guildId, channelId))] };
}

function postWasDeleted(error) {
    return error.code === RESTJSONErrorCodes.UnknownMessage || error.code === RESTJSONErrorCodes.UnknownChannel;
}

async function isPostMissing(channel, team) {
    if (!channel || !team.messageId) return true;
    try {
        await channel.messages.fetch({ message: team.messageId, force: true, cache: false });
        return false;
    } catch (error) {
        return postWasDeleted(error);
    }
}

async function closeRecruitment(guild, state, team, save) {
    team.closed = true;
    const room = state.rooms[team.roomId];
    const managesRoom = room?.lfgTeamId === team.id;
    if (managesRoom) delete room.reservedUntil;
    await save();
    if (managesRoom) queueCleanup(guild, team.roomId);
}

module.exports = {
    data: new SlashCommandBuilder().setName('lfg').setDescription('Tìm người chơi và vào phòng thoại của đội')
        .addStringOption(option => option.setName('game').setDescription('Game hoặc hoạt động').setMaxLength(80).setRequired(true))
        .addIntegerOption(option => option.setName('slots').setDescription('Số chỗ cần tuyển thêm').setMinValue(1).setMaxValue(19).setRequired(true))
        .addStringOption(option => option.setName('note').setDescription('Giờ chơi, chế độ hoặc yêu cầu').setMaxLength(300))
        .addStringOption(option => option.setName('rank').setDescription('Rank muốn tuyển, ví dụ Gold hoặc Unrated').setMaxLength(32)),

    async execute(interaction) {
        const { channel, guild, member, options } = interaction;
        const game = options.getString('game', true).trim();
        if (!game) return respond(interaction, '❌ Hãy nhập tên game hoặc hoạt động.');
        if (channel?.type !== ChannelType.GuildText ||
            !hasChannelPermissions(channel, member, [ViewChannel, SendMessages]) ||
            !hasChannelPermissions(channel, guild.members.me, [ViewChannel, SendMessages, EmbedLinks])) {
            return respond(interaction, '❌ Hãy dùng /lfg trong kênh chữ mà bạn và bot có thể gửi tin, bot có quyền Nhúng liên kết.');
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const response = await store.transact(interaction.guildId, async (state, save) => {
            const now = Date.now();
            for (const team of Object.values(state.lfg)) {
                const previousChannel = guild.channels.cache.get(team.channelId);
                if (!isRecruiting(team)) {
                    delete state.lfg[team.id];
                } else if (team.ownerId === interaction.user.id) {
                    if (!await isPostMissing(previousChannel, team)) {
                        return {
                            content: `ℹ️ Bạn đang có phiếu tuyển ở <#${team.channelId}>. Nếu muốn đăng lại, hãy đóng phiếu cũ trước.`,
                            components: [new ActionRowBuilder().addComponents(teamButton(team, 'recoverclose', 'Đóng phiếu cũ', ButtonStyle.Danger))]
                        };
                    }
                    await closeRecruitment(guild, state, team, save);
                    delete state.lfg[team.id];
                } else if (!previousChannel) {
                    delete state.lfg[team.id];
                }
            }
            if (Object.keys(state.lfg).length >= 50) return '⏳ Máy chủ đang có quá nhiều nhóm tuyển người.';
            const { user } = interaction;
            const team = {
                id: interaction.id, ownerId: user.id,
                ownerName: member.displayName || user.globalName || user.username,
                ownerAvatar: user.displayAvatarURL?.({ size: 64 }),
                game, note: options.getString('note')?.trim(), rank: options.getString('rank')?.trim(),
                capacity: options.getInteger('slots', true) + 1, members: [user.id],
                channelId: channel.id, expiresAt: now + RECRUITMENT_TTL, closed: false
            };
            const current = member.voice?.channel;
            if (isVoiceRoom(current)) {
                team.roomId = current.id;
                team.usesHostRoom = true;
            }
            const { channel: voice, created, error } = await this.ensureRoom(interaction, state, team);
            if (error) return '❌ ' + error;
            let posted;
            try {
                posted = await channel.send(render(team, guild));
                team.messageId = posted.id;
                state.lfg[team.id] = team;
                await save();
            } catch (error) {
                if (posted) await posted.delete().catch(() => {});
                if (created) await voice.delete('Không đăng được phiếu tìm đội').catch(() => {});
                throw error;
            }
            if (created) {
                queueCleanup(guild, voice.id, ROOM_RESERVATION);
                return voiceLinkNotice(`✅ Đã đăng phiếu và tạo phòng <#${voice.id}>.`, guild.id, voice.id);
            }
            return `✅ Đã đăng phiếu cho phòng bạn đang ở <#${voice.id}>.`;
        });
        if (typeof response === 'string') return edit(interaction, response);
        return interaction.editReply({ ...response, allowedMentions: { parse: [] } });
    },

    async showOptions(interaction, id) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const { lfg } = await store.read(interaction.guildId);
        const team = lfg[id];
        if (!team || team.messageId !== interaction.message.id || team.channelId !== interaction.channelId || !isRecruiting(team)) {
            return edit(interaction, '⌛ Bài tìm người chơi đã hết hiệu lực.');
        }
        if (!team.members.includes(interaction.user.id)) return edit(interaction, 'ℹ️ Bạn chưa ở trong đội.');
        const owner = team.ownerId === interaction.user.id;
        const button = owner
            ? teamButton(team, 'panelclose', 'Đóng tuyển', ButtonStyle.Danger)
            : teamButton(team, 'panelleave', 'Rời đội');
        const voice = interaction.guild.channels.cache.get(team.roomId);
        return interaction.editReply({
            content: `**${roomReference(team, voice)}**\n${team.members.map(userId => `<@${userId}>`).join(' · ')}`,
            components: [new ActionRowBuilder().addComponents(button)],
            allowedMentions: { parse: [] }
        });
    },

    async button(interaction) {
        const [clicked, id] = interaction.customId.slice('mg_lfg_'.length).split('_');
        if (clicked === 'options') return this.showOptions(interaction, id);
        const recovery = clicked === 'recoverclose';
        const fromPanel = recovery || clicked === 'panelleave' || clicked === 'panelclose';
        const action = recovery ? 'close' : (fromPanel ? clicked.slice('panel'.length) : clicked);
        if (!['join', 'leave', 'room', 'close'].includes(action)) return respond(interaction, '❌ Nút này không hợp lệ.');
        const sourceId = interaction.member?.voice?.channelId;
        const { guild } = interaction;
        await interaction.deferUpdate();
        const notice = await store.transact(interaction.guildId, async (state, save) => {
            const team = state.lfg[id];
            if (!team || (!recovery && team.channelId !== interaction.channelId) || (!fromPanel && team.messageId !== interaction.message.id)) {
                return '⌛ Bài tìm người chơi đã hết hiệu lực.';
            }
            if (!isRecruiting(team)) {
                if (!fromPanel) await interaction.editReply(render(team, guild));
                return '⌛ Đội đã ngừng tuyển người.';
            }
            const userId = interaction.user.id;
            const owner = userId === team.ownerId;
            if (action === 'join' || action === 'room') {
                if (action === 'room' && !owner) return '❌ Chỉ chủ nhóm mới có thể dùng nút Mở phòng thoại.';
                if (!team.members.includes(userId)) {
                    if (team.members.length >= team.capacity) return '❌ Đội đã đủ người.';
                    team.members.push(userId);
                    await save();
                }
                const message = await this.joinRoom(interaction, state, team, save, sourceId);
                await interaction.editReply(render(team, guild));
                return message;
            }
            if (action === 'leave') {
                if (owner) return 'ℹ️ Chủ nhóm có thể dùng nút Đóng tuyển.';
                if (!team.members.includes(userId)) return 'ℹ️ Bạn chưa ở trong đội.';
                team.members = team.members.filter(memberId => memberId !== userId);
                await save();
            } else if (!owner) {
                return '❌ Chỉ chủ nhóm mới có thể đóng tuyển.';
            } else {
                await closeRecruitment(guild, state, team, save);
            }
            const message = recovery ? '✅ Đã đóng phiếu cũ. Bạn có thể dùng /lfg để đăng lại.'
                : action === 'leave' ? '✅ Bạn đã rời đội.' : '✅ Đã đóng tuyển.';
            if (fromPanel) {
                const channel = guild.channels.cache.get(team.channelId);
                await channel?.messages.edit(team.messageId, render(team, guild))
                    .catch(error => {
                        if (!postWasDeleted(error)) console.error('Lỗi cập nhật bảng LFG:', error.message);
                    });
                await interaction.editReply({ content: message, components: [] });
                return null;
            }
            await interaction.editReply(render(team, guild));
            return message;
        });
        if (notice) {
            const payload = typeof notice === 'string' ? { content: notice } : notice;
            await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
        }
    },

    async joinRoom(interaction, state, team, save, sourceId) {
        const { guild, member } = interaction;
        const { channel, created, error } = await this.ensureRoom(interaction, state, team);
        if (error) return '✅ Bạn đã có tên trong đội. ' + error;
        if (created) {
            try {
                await save();
            } catch (error) {
                await channel.delete('Không lưu được phòng đội').catch(() => {});
                throw error;
            }
            queueCleanup(guild, channel.id, ROOM_RESERVATION);
        }
        const link = `<#${channel.id}>`;
        if (!canJoinVoice(member, channel)) return `❌ Bạn đã có tên trong đội. Bạn chưa có quyền vào ${link}.`;

        const source = member.voice?.channel;
        if (source?.id === channel.id) return `✅ Bạn đang ở phòng thoại của đội ${link}.`;
        if (!source || source.id !== sourceId) {
            return voiceLinkNotice('✅ Bạn đã có tên trong đội. Mở kênh thoại để tham gia.', guild.id, channel.id);
        }
        if (channel.userLimit && channel.members.size >= channel.userLimit) return `ℹ️ Phòng ${link} đang đầy.`;
        if (!canMoveBetween(guild.members.me, source, channel)) {
            return voiceLinkNotice('ℹ️ Bot thiếu quyền Di chuyển thành viên giữa hai kênh. Bạn có thể tự vào phòng.', guild.id, channel.id);
        }
        const moveError = await moveVoiceMember(guild, member, channel);
        return moveError ? voiceLinkNotice(moveError, guild.id, channel.id) : `✅ Đã chuyển bạn vào ${link}.`;
    },

    async ensureRoom(interaction, state, team) {
        const { guild, member } = interaction;
        const existing = guild.channels.cache.get(team.roomId);
        if (isVoiceRoom(existing) && (team.usesHostRoom || state.rooms[existing.id])) return { channel: existing };
        if (team.usesHostRoom) return { error: 'Phòng thoại gốc đã mất. Chủ nhóm có thể đóng phiếu và đăng lại.' };
        delete team.roomId;

        const resources = roomResources(guild, state.settings.rooms);
        if (!resources) return { error: 'Hãy vào voice trước khi đăng, hoặc nhờ quản trị viên cấu hình /setup rooms để bot tạo phòng.' };
        if (!canJoinVoice(member, resources.category)) return { error: 'Bạn cần quyền vào danh mục phòng tạm.' };
        if (Object.keys(state.rooms).length >= MAX_ROOMS) return { error: 'Máy chủ đã đạt giới hạn số phòng thoại tạm.' };

        const host = team.ownerId === member.id ? member :
            guild.members.cache.get(team.ownerId) || await guild.members.fetch(team.ownerId).catch(() => null);
        if (!canJoinVoice(host, resources.category)) return { error: 'Chủ nhóm cần quyền vào danh mục phòng tạm.' };

        const number = team.number ?? state.nextLfgTeam;
        let channel;
        try {
            channel = await createTemporaryChannel(guild, resources.category, `TEAM #${number}`, team.capacity);
        } catch (error) {
            console.error('Lỗi mở phòng LFG:', error.message);
            return { error: 'Discord chưa tạo được phòng. Hãy thử lại.' };
        }
        if (team.number == null) state.nextLfgTeam++;
        team.number = number;
        team.roomId = channel.id;
        team.closed = false;
        state.rooms[channel.id] = { ownerId: team.ownerId, lfgTeamId: team.id, reservedUntil: Date.now() + ROOM_RESERVATION };
        state.activity.roomsOpened++;
        return { channel, created: true };
    }
};
