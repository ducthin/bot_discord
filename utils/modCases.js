const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, escapeMarkdown, PermissionFlagsBits } = require('discord.js');

const TIMEOUT_MS = 10 * 60 * 1000;

function renderCase(record) {
    const status = record.closedBy ? 'Đã đóng' : record.claimedBy ? 'Đang xử lý' : 'Đang chờ';
    const embed = new EmbedBuilder().setColor('#5865f2').setTitle(`📋 Báo cáo #${record.id} · ${status}`)
        .setDescription(escapeMarkdown(record.reason))
        .addFields(
            { name: 'Người báo cáo', value: `<@${record.authorId}>`, inline: true },
            { name: 'Người được báo cáo', value: `<@${record.targetId}>`, inline: true },
            { name: 'Phụ trách', value: record.claimedBy ? `<@${record.claimedBy}>` : 'Chưa có', inline: true }
        )
        .setTimestamp(record.createdAt);
    if (record.warnedBy) embed.addFields({ name: 'Cảnh cáo', value: `<@${record.warnedBy}>`, inline: true });
    if (record.timeoutBy) embed.addFields({ name: 'Timeout 10 phút', value: `<@${record.timeoutBy}>`, inline: true });
    if (record.closedBy) embed.addFields({ name: 'Đóng bởi', value: `<@${record.closedBy}>`, inline: true });

    const button = (action, label, style, disabled = false) => new ButtonBuilder()
        .setCustomId(`mg_case_${action}_${record.id}`).setLabel(label).setStyle(style).setDisabled(disabled);
    const components = record.closedBy ? [] : [new ActionRowBuilder().addComponents(
        button('claim', 'Nhận xử lý', ButtonStyle.Primary, Boolean(record.claimedBy)),
        button('warn', 'Cảnh cáo', ButtonStyle.Secondary, Boolean(record.warnedBy)),
        button('timeout', 'Timeout 10 phút', ButtonStyle.Danger, Boolean(record.timeoutBy)),
        button('close', 'Đóng', ButtonStyle.Secondary)
    )];
    return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

async function applyCaseAction(interaction, record, action, save) {
    const { guild, member, user } = interaction;
    if (record.closedBy) return 'ℹ️ Hồ sơ đã được đóng.';
    if (action === 'claim') {
        if (record.claimedBy) return 'ℹ️ Hồ sơ đã có người nhận.';
        record.claimedBy = user.id;
        await save();
        return null;
    }
    if (action === 'close') {
        record.closedBy = user.id;
        await save();
        return null;
    }
    if (action === 'warn' && record.warnedBy) return 'ℹ️ Hồ sơ đã ghi một cảnh cáo.';
    if (action === 'timeout' && record.timeoutBy) return 'ℹ️ Hồ sơ đã ghi một lần timeout.';

    const target = await guild.members.fetch({ user: record.targetId, force: true }).catch(() => null);
    if (!target) return '❌ Thành viên không còn trong máy chủ hoặc chưa tra được.';
    if (!member.permissions.has(PermissionFlagsBits.ModerateMembers) ||
        target.id === user.id || target.id === guild.ownerId || target.permissions.has(PermissionFlagsBits.Administrator) ||
        (member.id !== guild.ownerId && member.roles.highest.comparePositionTo(target.roles.highest) <= 0)) {
        return '❌ Bạn không có quyền xử lý thành viên này.';
    }

    if (action === 'timeout') {
        if (!target.moderatable) return '❌ Bot cần quyền Timeout và vai trò cao hơn thành viên.';
        if (target.isCommunicationDisabled()) return 'ℹ️ Thành viên đang bị timeout.';
        await target.timeout(TIMEOUT_MS, `Xử lý hồ sơ #${record.id}`);
        record.timeoutBy = user.id;
        await save();
        return null;
    }

    record.warnedBy = user.id;
    await save();
    try {
        await target.send({ content: `Bạn nhận một cảnh cáo từ quản trị viên của **${escapeMarkdown(guild.name)}** (hồ sơ #${record.id}).`, allowedMentions: { parse: [] } });
    } catch {
        return 'ℹ️ Đã ghi cảnh cáo. Thành viên không nhận được tin nhắn riêng.';
    }
    return null;
}

module.exports = { renderCase, applyCaseAction };
