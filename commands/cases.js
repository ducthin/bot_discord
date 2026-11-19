const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const store = require('../utils/managementStore');
const { canModerate, respond, edit } = require('../utils/managementAccess');
const { renderCase, applyCaseAction } = require('../utils/modCases');

module.exports = {
    data: new SlashCommandBuilder().setName('cases').setDescription('Xem và xử lý hồ sơ báo cáo của máy chủ')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addIntegerOption(option => option.setName('id').setDescription('Số hồ sơ cần mở').setMinValue(1)),

    async execute(interaction) {
        if (!canModerate(interaction)) return respond(interaction, '❌ Bạn cần quyền Timeout thành viên.');
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const id = interaction.options.getInteger('id');
        const { reports } = await store.read(interaction.guildId);
        if (id) return reports[id] ? interaction.editReply(renderCase(reports[id])) : edit(interaction, '❌ Không tìm thấy hồ sơ.');
        const recent = Object.values(reports).reverse().slice(0, 10);
        if (!recent.length) return edit(interaction, '📭 Chưa có báo cáo nào.');
        return edit(interaction, '📋 **10 hồ sơ gần nhất**\n' + recent.map(record =>
            `**#${record.id}** · <@${record.targetId}> · ${record.closedBy ? 'Đã đóng' : record.claimedBy ? 'Đang xử lý' : 'Đang chờ'}`
        ).join('\n') + '\nDùng /cases id để mở từng hồ sơ.');
    },

    async button(interaction) {
        if (!canModerate(interaction)) return respond(interaction, '❌ Bạn cần quyền Timeout thành viên.');
        const [action, id] = interaction.customId.slice('mg_case_'.length).split('_');
        if (!['claim', 'warn', 'timeout', 'close'].includes(action) || !/^\d+$/.test(id || '')) {
            return respond(interaction, '❌ Nút này không hợp lệ.');
        }
        await interaction.deferUpdate();
        const notice = content => interaction.followUp({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
        try {
            const result = await store.transact(interaction.guildId, async (state, save) => {
                const record = state.reports[id];
                if (!record) return '❌ Không tìm thấy hồ sơ.';
                const message = await applyCaseAction(interaction, record, action, save);
                await interaction.editReply(renderCase(record));
                return message;
            });
            if (result) await notice(result);
        } catch (error) {
            console.error('Lỗi xử lý hồ sơ:', error.message);
            await notice('❌ Chưa cập nhật được hồ sơ. Mở /cases để xem trạng thái mới nhất.');
        }
    }
};
