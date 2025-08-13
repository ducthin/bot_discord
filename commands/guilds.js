const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getAllowedGuilds, isGuildAllowed } = require('../utils/guildUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('guilds')
        .setDescription('Xem thông tin các server bot đang hoạt động'),

    async execute(interaction) {
        try {
            const allowedGuilds = getAllowedGuilds();
            const currentGuildId = interaction.guildId;
            
            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('🏠 Server Management')
                .setDescription(`Bot đang hoạt động trên ${allowedGuilds.length} server(s)`)
                .addFields(
                    { name: '🆔 Current Guild', value: currentGuildId, inline: true },
                    { name: '✅ Allowed', value: isGuildAllowed(currentGuildId) ? 'Yes' : 'No', inline: true }
                );

            // Hiển thị danh sách all guilds
            let guildsList = '';
            for (const guildId of allowedGuilds) {
                const guild = interaction.client.guilds.cache.get(guildId);
                const status = guild ? '✅' : '❌';
                const name = guild ? guild.name : 'Unknown';
                const members = guild ? guild.memberCount : 0;
                const current = guildId === currentGuildId ? ' **(Current)**' : '';
                
                guildsList += `${status} **${name}**${current}\n`;
                guildsList += `   └─ ID: \`${guildId}\`\n`;
                if (guild) {
                    guildsList += `   └─ Members: ${members}\n`;
                }
                guildsList += '\n';
            }

            if (guildsList) {
                embed.addFields({ name: '📋 Guild List', value: guildsList || 'Không có guild nào', inline: false });
            }

            // Thêm instructions
            embed.addFields({
                name: '💡 Cách thêm guild mới',
                value: '1. Thêm Guild ID vào `.env` file:\n```\nGUILD_IDS=old_id,new_guild_id\n```\n2. Restart bot\n3. Bot sẽ tự động đăng ký commands',
                inline: false
            });

            embed.setFooter({ text: 'Bot Management System' })
                .setTimestamp();

            await interaction.reply({ embeds: [embed], ephemeral: true });

        } catch (error) {
            console.error('Lỗi guilds command:', error);
            await interaction.reply({
                content: '❌ Có lỗi khi lấy thông tin guilds!',
                ephemeral: true
            });
        }
    }
};
