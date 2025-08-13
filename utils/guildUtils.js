// Utility functions để quản lý nhiều guild
function getAllowedGuilds() {
    const guildIds = process.env.GUILD_IDS 
        ? process.env.GUILD_IDS.split(',').map(id => id.trim())
        : [process.env.GUILD_ID];
    
    return guildIds.filter(id => id && id.length > 0);
}

function isGuildAllowed(guildId) {
    const allowedGuilds = getAllowedGuilds();
    return allowedGuilds.includes(guildId);
}

function logGuildInfo(client) {
    const allowedGuilds = getAllowedGuilds();
    console.log(`🏠 Bot được phép hoạt động trên ${allowedGuilds.length} guild(s):`);
    
    allowedGuilds.forEach(guildId => {
        const guild = client.guilds.cache.get(guildId);
        if (guild) {
            console.log(`   ✅ ${guild.name} (${guildId}) - ${guild.memberCount} members`);
        } else {
            console.log(`   ❌ Guild ${guildId} - Bot chưa join hoặc không tồn tại`);
        }
    });
}

module.exports = {
    getAllowedGuilds,
    isGuildAllowed,
    logGuildInfo
};
