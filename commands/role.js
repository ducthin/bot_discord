const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('role')
        .setDescription('Cấp hoặc thu hồi role của một thành viên')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addUserOption(option => 
            option.setName('user')
                .setDescription('Thành viên cần chỉnh sửa role')
                .setRequired(true))
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('Role cần cấp hoặc thu hồi')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('action')
                .setDescription('Hành động cấp (Add) hoặc thu hồi (Remove)')
                .setRequired(true)
                .addChoices(
                    { name: 'Cấp (Add)', value: 'add' },
                    { name: 'Thu hồi (Remove)', value: 'remove' }
                )),

    async execute(interaction) {
        const { guild, member } = interaction;
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
            return interaction.reply({ content: '❌ Bạn cần quyền Quản lý vai trò.', flags: MessageFlags.Ephemeral });
        }
        
        const targetMember = interaction.options.getMember('user');
        const role = interaction.options.getRole('role');
        const action = interaction.options.getString('action');

        if (!targetMember) {
            return interaction.reply({ content: '❌ Không tìm thấy thành viên này trong server!', flags: MessageFlags.Ephemeral });
        }

        const botMember = guild.members.me;
        
        // 1. Kiểm tra quyền của Bot
        if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return interaction.reply({ 
                content: '❌ Bot không có quyền **Quản lý vai trò (Manage Roles)** trên server này!', 
                flags: MessageFlags.Ephemeral 
            });
        }

        // 2. Kiểm tra phân cấp vai trò (Role Hierarchy) của Bot
        if (role.position >= botMember.roles.highest.position) {
            return interaction.reply({ 
                content: `❌ Bot không thể quản lý vai trò này!\n👉 Vui lòng vào **Cài đặt Máy chủ ➡️ Vai trò**, sau đó kéo vai trò của Bot (**${botMember.roles.highest.name}**) nằm **TRÊN** vai trò **${role.name}** và nhấn lưu.`, 
                flags: MessageFlags.Ephemeral 
            });
        }

        // 3. Kiểm tra vai trò đặc biệt (như role của bot khác hoặc booster)
        if (role.managed) {
            return interaction.reply({ 
                content: `❌ Vai trò **${role.name}** được quản lý tự động bởi một tích hợp hoặc ứng dụng khác, không thể cấp thủ công!`, 
                flags: MessageFlags.Ephemeral 
            });
        }

        // 4. Kiểm tra phân cấp vai trò của người thực hiện lệnh (tránh lạm dụng quyền)
        if (role.position >= member.roles.highest.position && guild.ownerId !== member.id) {
            return interaction.reply({ 
                content: `❌ Bạn không thể quản lý vai trò này vì nó nằm ngang hàng hoặc cao hơn vai trò cao nhất của bạn!`, 
                flags: MessageFlags.Ephemeral 
            });
        }

        await interaction.deferReply();

        try {
            const embed = new EmbedBuilder().setTimestamp();

            if (action === 'add') {
                // Kiểm tra xem đã có role chưa
                if (targetMember.roles.cache.has(role.id)) {
                    return interaction.followUp({ content: `⚠️ Thành viên **${targetMember.user.username}** đã có vai trò **${role.name}** từ trước!` });
                }

                await targetMember.roles.add(role);
                
                embed.setColor('#00ff00')
                    .setTitle('✅ Cấp vai trò thành công')
                    .setDescription(`Đã cấp vai trò **${role.name}** cho thành viên **${targetMember}**`)
                    .addFields(
                        { name: '👤 Người nhận', value: `${targetMember.user.tag}`, inline: true },
                        { name: '🛡️ Vai trò', value: `${role}`, inline: true },
                        { name: '✍️ Thực hiện bởi', value: `${member.user.tag}`, inline: true }
                    );
            } else {
                // Kiểm tra xem có role để thu hồi không
                if (!targetMember.roles.cache.has(role.id)) {
                    return interaction.followUp({ content: `⚠️ Thành viên **${targetMember.user.username}** không có vai trò **${role.name}** để thu hồi!` });
                }

                await targetMember.roles.remove(role);

                embed.setColor('#ff0000')
                    .setTitle('🗑️ Thu hồi vai trò thành công')
                    .setDescription(`Đã thu hồi vai trò **${role.name}** từ thành viên **${targetMember}**`)
                    .addFields(
                        { name: '👤 Người bị thu hồi', value: `${targetMember.user.tag}`, inline: true },
                        { name: '🛡️ Vai trò', value: `${role}`, inline: true },
                        { name: '✍️ Thực hiện bởi', value: `${member.user.tag}`, inline: true }
                    );
            }

            await interaction.followUp({ embeds: [embed] });

        } catch (error) {
            console.error('❌ Lỗi khi thay đổi role:', error);
            await interaction.followUp({ content: `❌ Đã xảy ra lỗi khi thực hiện thay đổi vai trò: ${error.message}` });
        }
    }
};
