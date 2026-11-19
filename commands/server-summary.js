const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const store = require('../utils/managementStore');
const { canConfigure, respond } = require('../utils/managementAccess');

module.exports = {
    data: new SlashCommandBuilder().setName('server-summary').setDescription('Xem thống kê phòng thoại, báo cáo và ticket')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        if (!canConfigure(interaction)) return respond(interaction, '❌ Bạn cần quyền Quản lý máy chủ.');
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const { settings, activity, reports, tickets } = await store.read(interaction.guildId);
        const channels = interaction.guild.channels.cache;
        const top = Object.entries(activity.voiceJoins)
            .filter(([id]) => channels.has(id)).sort((a, b) => b[1] - a[1]).slice(0, 5);
        const pending = Object.values(reports).filter(report => !report.closedBy);
        const openTickets = Object.entries(tickets).filter(([id, ticket]) => channels.has(id) && !ticket.closedBy).length;
        const embed = new EmbedBuilder().setColor('#5865f2').setTitle('📊 Tổng kết máy chủ')
            .addFields(
                { name: 'Phòng tạm đã mở', value: String(activity.roomsOpened), inline: true },
                { name: 'Lượt vào phòng tạm', value: String(activity.roomJoins), inline: true },
                { name: 'Báo cáo chưa đóng', value: `${pending.length} · ${pending.filter(report => !report.claimedBy).length} chưa có người nhận`, inline: true },
                { name: 'Ticket đang mở', value: String(openTickets), inline: true },
                { name: 'Kênh thoại có nhiều lượt vào nhất', value: top.map(([id, visits]) => `<#${id}> · ${visits} lượt`).join('\n') || 'Chưa có số liệu.' }
            ).setFooter({ text: settings.trackVoice ? 'Số liệu cộng dồn từ khi bật thống kê.' : 'Đang tắt đếm lượt mới. Bật bằng /setup activity.' });
        return interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
    }
};
