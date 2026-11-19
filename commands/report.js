const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const store = require('../utils/managementStore');
const { respond, edit, reportChannel } = require('../utils/managementAccess');
const { renderCase } = require('../utils/modCases');

const MAX_CASES = 500;

module.exports = {
    data: new SlashCommandBuilder().setName('report').setDescription('Gửi báo cáo riêng cho đội quản trị')
        .addUserOption(option => option.setName('user').setDescription('Thành viên được báo cáo').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('Lý do và thông tin liên quan').setMaxLength(600).setRequired(true)),

    async execute(interaction) {
        const target = interaction.options.getMember('user');
        const reason = interaction.options.getString('reason', true).trim();
        if (!target?.user || target.user.id === interaction.user.id || !reason) {
            return respond(interaction, '❌ Hãy chọn một thành viên khác và nhập lý do.');
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const result = await store.transact(interaction.guildId, async (state, save) => {
            const channel = reportChannel(interaction.guild, state.settings.reports?.channelId);
            if (!channel) return '❌ Quản trị viên cần cấu hình kênh báo cáo riêng bằng /setup reports.';
            const reports = Object.values(state.reports);
            const now = Date.now();
            const own = reports.filter(report => report.authorId === interaction.user.id);
            if (own.some(report => now - report.createdAt < 60000)) return '⏳ Bạn có thể gửi một báo cáo mỗi phút.';
            if (own.filter(report => !report.closedBy).length >= 3) return '⏳ Bạn đang có 3 báo cáo chưa đóng.';
            if (reports.length >= MAX_CASES) {
                const oldestClosed = reports.find(report => report.closedBy);
                if (!oldestClosed) return '❌ Danh sách báo cáo đang đầy. Hãy liên hệ đội quản trị.';
                delete state.reports[oldestClosed.id];
            }

            const record = { id: state.nextCase++, authorId: interaction.user.id, targetId: target.user.id, reason, createdAt: now };
            state.reports[record.id] = record;
            await save();
            try {
                await channel.send(renderCase(record));
                return `✅ Đã gửi báo cáo #${record.id} cho đội quản trị.`;
            } catch (error) {
                console.error('Lỗi gửi báo cáo vào kênh quản trị:', error.message);
                return `ℹ️ Đã lưu báo cáo #${record.id}. Quản trị viên có thể mở bằng /cases.`;
            }
        });
        return edit(interaction, result);
    }
};
