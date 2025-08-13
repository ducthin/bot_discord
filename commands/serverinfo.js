const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('serverinfo')
        .setDescription('Hiển thị thông tin server và Guild ID'),

    async execute(interaction) {
        const guild = interaction.guild;
        
        if (!guild) {
            return interaction.reply({
                content: '❌ Command này chỉ có thể sử dụng trong server!',
                ephemeral: true
            });
        }

        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('📊 Thông tin Server')
            .setThumbnail(guild.iconURL())
            .addFields(
                { name: '🏷️ Tên Server', value: guild.name, inline: true },
                { name: '🆔 Guild ID', value: `\`${guild.id}\``, inline: true },
                { name: '👑 Owner', value: `<@${guild.ownerId}>`, inline: true },
                { name: '👥 Thành viên', value: `${guild.memberCount} người`, inline: true },
                { name: '📅 Tạo lúc', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>`, inline: true },
                { name: '🔗 Bot join lúc', value: `<t:${Math.floor(guild.joinedTimestamp / 1000)}:F>`, inline: true }
            )
            .setFooter({ text: 'Copy Guild ID để thêm vào bot config' });

        await interaction.reply({ embeds: [embed] });
    }
};
