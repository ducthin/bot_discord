const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('invite')
        .setDescription('Tạo link invite bot vào server khác'),

    async execute(interaction) {
        const clientId = process.env.CLIENT_ID;
        
        if (!clientId) {
            return interaction.reply({
                content: '❌ Không tìm thấy CLIENT_ID trong config!',
                ephemeral: true
            });
        }

        // Link invite với full permissions
        const inviteLink = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=8&scope=bot%20applications.commands`;
        
        // Link invite với permissions cơ bản cho music bot
        const basicInviteLink = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=36793344&scope=bot%20applications.commands`;

        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('🔗 Invite Bot vào Server')
            .setDescription('Sử dụng link bên dưới để thêm bot vào server khác')
            .addFields(
                { 
                    name: '🔑 Client ID', 
                    value: `\`${clientId}\``, 
                    inline: true 
                },
                { 
                    name: '👑 Admin Permissions', 
                    value: '[Click để invite với quyền admin]('+inviteLink+')', 
                    inline: false 
                },
                { 
                    name: '🎵 Music Bot Permissions', 
                    value: '[Click để invite với quyền cơ bản]('+basicInviteLink+')', 
                    inline: false 
                },
                {
                    name: '📋 Permissions bao gồm:',
                    value: '• View Channels\n• Send Messages\n• Use Slash Commands\n• Connect to Voice\n• Speak in Voice\n• Use Voice Activity',
                    inline: false
                }
            )
            .setFooter({ text: 'Chọn link phù hợp với nhu cầu của bạn' });

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('🔗 Copy Admin Link')
                    .setStyle(ButtonStyle.Link)
                    .setURL(inviteLink),
                new ButtonBuilder()
                    .setLabel('🎵 Copy Music Link') 
                    .setStyle(ButtonStyle.Link)
                    .setURL(basicInviteLink)
            );

        await interaction.reply({
            embeds: [embed],
            components: [row]
        });
    }
};