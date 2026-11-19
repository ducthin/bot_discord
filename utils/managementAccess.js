const { ChannelType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const {
    ViewChannel, SendMessages, ReadMessageHistory, ManageChannels, ManageRoles,
    MoveMembers, Connect, EmbedLinks, CreatePublicThreads, CreatePrivateThreads, SendMessagesInThreads
} = PermissionFlagsBits;

const respond = (interaction, content) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
const edit = (interaction, content) => interaction.editReply({ content, allowedMentions: { parse: [] } });

function canConfigure(interaction) {
    return interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild);
}

function canModerate(interaction) {
    return interaction.member?.permissions?.has(PermissionFlagsBits.ModerateMembers);
}

function hasChannelPermissions(channel, member, permissions) {
    return Boolean(member && channel?.permissionsFor(member)?.has(permissions));
}

function reportChannel(guild, id) {
    const channel = guild.channels.cache.get(id);
    if (channel?.type !== ChannelType.GuildText) return null;
    const everyone = channel.permissionsFor(guild.roles.everyone);
    if (!everyone || everyone.has(ViewChannel)) return null;
    return hasChannelPermissions(channel, guild.members.me, [ViewChannel, SendMessages, EmbedLinks]) ? channel : null;
}

function roomResources(guild, settings) {
    const lobby = guild.channels.cache.get(settings?.lobbyId);
    const category = guild.channels.cache.get(settings?.categoryId);
    const bot = guild.members.me;
    if (lobby?.type !== ChannelType.GuildVoice || category?.type !== ChannelType.GuildCategory) return null;
    if (!hasChannelPermissions(lobby, bot, [ViewChannel, MoveMembers]) ||
        !hasChannelPermissions(category, bot, [ViewChannel, ManageChannels, ManageRoles, MoveMembers, Connect])) return null;
    return { lobby, category };
}

function ticketResources(guild, settings) {
    const category = guild.channels.cache.get(settings?.categoryId);
    const role = guild.roles.cache.get(settings?.roleId);
    if (category?.type !== ChannelType.GuildCategory || !role || role.id === guild.id) return null;
    if (!hasChannelPermissions(category, guild.members.me, [
        ViewChannel, ManageChannels, ManageRoles, SendMessages, ReadMessageHistory,
        CreatePublicThreads, CreatePrivateThreads, SendMessagesInThreads
    ])) return null;
    return { category, role };
}

module.exports = { respond, edit, canConfigure, canModerate, hasChannelPermissions, reportChannel, roomResources, ticketResources };
