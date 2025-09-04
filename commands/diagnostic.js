const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('diagnostic')
        .setDescription('Kiểm tra trạng thái bot và các guild'),

    async execute(interaction) {
        try {
            const client = interaction.client;
            const guilds = client.guilds.cache;
            
            const embed = new EmbedBuilder()
                .setColor('#ff9900')
                .setTitle('🔍 Diagnostic - Trạng thái Bot')
                .setDescription('Thông tin chi tiết về bot và các server')
                .addFields(
                    { name: '🤖 Bot Status', value: client.user ? '✅ Online' : '❌ Offline', inline: true },
                    { name: '🏠 Total Guilds', value: `${guilds.size} server(s)`, inline: true },
                    { name: '👥 Total Users', value: `${client.users.cache.size} người`, inline: true }
                );

            // Liệt kê tất cả guilds
            if (guilds.size > 0) {
                let guildList = '';
                guilds.forEach(guild => {
                    const status = guild.available ? '✅' : '❌';
                    guildList += `${status} **${guild.name}**\n`;
                    guildList += `   └ ID: \`${guild.id}\`\n`;
                    guildList += `   └ Members: ${guild.memberCount}\n`;
                    guildList += `   └ Owner: <@${guild.ownerId}>\n\n`;
                });

                embed.addFields({ name: '📋 Guild List', value: guildList || 'Không có guild nào' });
            }

            // Thông tin config
            const configGuildIds = process.env.GUILD_IDS?.split(',') || [];
            embed.addFields(
                { name: '⚙️ Config Guild IDs', value: configGuildIds.join('\n') || 'Không có config', inline: false }
            );

            // Thông tin bot permissions
            const botMember = interaction.guild?.members.cache.get(client.user.id);
            if (botMember) {
                const perms = botMember.permissions.toArray();
                embed.addFields(
                    { name: '🔑 Bot Permissions (Server này)', value: perms.slice(0, 10).join(', '), inline: false }
                );
            }

            await interaction.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Diagnostic error:', error);
            await interaction.reply({
                content: '❌ Lỗi khi chạy diagnostic: ' + error.message,
                ephemeral: true
            });
        }
    }
};