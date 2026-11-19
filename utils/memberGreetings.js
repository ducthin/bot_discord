const { ChannelType, EmbedBuilder, PermissionFlagsBits, escapeMarkdown } = require('discord.js');
const { hasChannelPermissions } = require('./managementAccess');
const { isGuildAllowed } = require('./guildUtils');
const store = require('./managementStore');
const GREETING_TEXT_LIMIT = 500;

function memberGreetingsEnabled() {
    return process.env.ENABLE_MEMBER_GREETINGS === 'true';
}

function greetingChannel(guild, channelId) {
    const channel = guild.channels.cache.get(channelId);
    if (channel?.type !== ChannelType.GuildText) return null;
    const permissions = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages];
    return hasChannelPermissions(channel, guild.members.me, permissions) ? channel : null;
}

function renderGreetingText(template, guild, user, joined) {
    if (!template) return null;
    const variables = {
        member: joined ? `<@${user.id}>` : escapeMarkdown(user.globalName || user.username),
        server: escapeMarkdown(guild.name),
        count: Number.isInteger(guild.memberCount) ? guild.memberCount.toLocaleString('vi-VN') : '—'
    };
    const text = template.replace(/\{(member|server|count)\}/g, (_match, key) => variables[key]);
    return text.length > 2000 ? text.slice(0, 1999).toWellFormed() + '…' : text;
}

function greetingCard(guild, user, joined, template) {
    const customText = renderGreetingText(template, guild, user, joined);
    const card = new EmbedBuilder()
        .setAuthor({ name: guild.name, iconURL: guild.iconURL({ size: 64 }) || undefined })
        .setColor(joined ? '#57f287' : '#7d8ca3')
        .setTitle(joined ? '👋 Chào mừng bạn!' : '🌙 Hẹn gặp lại!')
        .setDescription(customText || (joined
            ? `<@${user.id}> vừa gia nhập máy chủ. Chúc bạn chơi vui cùng mọi người!`
            : `**${escapeMarkdown(user.globalName || user.username)}** đã rời máy chủ.`))
        .setThumbnail(user.displayAvatarURL({ size: 128 }))
        .setTimestamp();
    if (Number.isInteger(guild.memberCount)) {
        card.setFooter({ text: `${guild.memberCount.toLocaleString('vi-VN')} thành viên hiện tại` });
    }
    return card;
}

async function sendMemberGreeting(member, joined) {
    const { guild, user } = member;
    if (!memberGreetingsEnabled() || !user || user.bot || !isGuildAllowed(guild.id)) return;
    const { settings } = await store.read(guild.id);
    const welcome = settings.welcome;
    if (!welcome) return;
    const channelId = joined ? welcome.channelId : (welcome.goodbyeChannelId || welcome.channelId);
    const channel = greetingChannel(guild, channelId);
    if (!channel) return;

    const template = joined ? settings.greetingText?.welcome : settings.greetingText?.goodbye;
    const allowedMentions = { parse: [] };
    if (hasChannelPermissions(channel, guild.members.me, PermissionFlagsBits.EmbedLinks)) {
        await channel.send({ embeds: [greetingCard(guild, user, joined, template)], allowedMentions });
        return;
    }
    const customText = renderGreetingText(template, guild, user, joined);
    const content = customText || (joined
        ? `👋 Chào mừng <@${user.id}> đến với **${escapeMarkdown(guild.name)}**! Chúc bạn chơi vui cùng mọi người.`
        : `👋 Tạm biệt **${escapeMarkdown(user.username)}**. Hẹn gặp lại bạn!`);
    await channel.send({ content, allowedMentions });
}

module.exports = { memberGreetingsEnabled, greetingChannel, greetingCard, sendMemberGreeting, GREETING_TEXT_LIMIT };
