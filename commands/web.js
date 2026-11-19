const { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { parsePlayerConfig, codeBroker } = require('../utils/playerAuth');
const { isGuildAllowed } = require('../utils/guildUtils');

module.exports = {
    data: new SlashCommandBuilder().setName('web').setDescription('Lấy mã đăng nhập web mở hòm và Upgrade bằng xu, skin của bạn').setDMPermission(false),
    async execute(interaction) {
        const config = parsePlayerConfig();
        if (!config.enabled || !interaction.guildId || !isGuildAllowed(interaction.guildId) || interaction.user.bot) {
            await interaction.reply({ content: 'Trang người chơi chưa được bật cho máy chủ này.', flags: MessageFlags.Ephemeral });
            return;
        }
        const { code, expiresAt } = codeBroker.issue({ guildId: interaction.guildId, userId: interaction.user.id,
            displayName: (interaction.member?.displayName || interaction.user.globalName || interaction.user.username).slice(0, 100),
            avatar: interaction.user.displayAvatarURL({ extension: 'png', size: 128 }) });
        const loginButton = new ActionRowBuilder().addComponents(new ButtonBuilder()
            .setLabel('Đăng nhập web').setStyle(ButtonStyle.Link).setURL(`${config.origin}/play/#login=${code}`));
        await interaction.reply({ content: `**Happy house Scam Club · Đăng nhập tài khoản của bạn**\n\nBấm **Đăng nhập web** bên dưới để điền sẵn mã, không cần sao chép trên điện thoại. Trên trang web, bấm **Vào kho của tôi** để xác nhận.\n\nNếu muốn nhập mã thủ công, mở ${config.origin}/play/ và dùng mã:\n\`\`\`\n${code}\n\`\`\`\nMã dùng một lần, hết hạn <t:${Math.floor(expiresAt / 1000)}:R>. Không gửi mã hoặc liên kết đăng nhập cho người khác.\nXu và kho skin dùng chung với tài khoản của bạn tại **${interaction.guild.name}**.`,
            components: [loginButton], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    }
};
