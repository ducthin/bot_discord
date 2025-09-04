const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { initGuildMusicData } = require('../utils/musicUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('autotrending')
        .setDescription('Tự động phát nhạc thịnh hành khi hết queue')
        .addBooleanOption(option =>
            option.setName('enabled')
                .setDescription('Bật/tắt auto trending')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('region')
                .setDescription('Khu vực trending mặc định')
                .setRequired(false)
                .addChoices(
                    { name: 'Việt Nam', value: 'VN' },
                    { name: 'Hàn Quốc (K-pop)', value: 'KR' },
                    { name: 'Mỹ (US)', value: 'US' },
                    { name: 'Toàn cầu', value: 'GLOBAL' },
                    { name: 'Châu Á', value: 'ASIA' }
                )
        ),

    async execute(interaction) {
        const guildData = initGuildMusicData(interaction.guildId);
        const enabled = interaction.options.getBoolean('enabled');
        const region = interaction.options.getString('region') || 'VN';

        try {
            guildData.autoTrending = {
                enabled: enabled,
                region: region,
                lastFetch: null,
                count: 0
            };

            const statusText = enabled ? 'BẬT' : 'TẮT';
            const statusEmoji = enabled ? '✅' : '❌';

            const embed = new EmbedBuilder()
                .setColor(enabled ? '#00ff00' : '#ff0000')
                .setTitle('🔥 Auto Trending Music')
                .setDescription(`Đã **${statusText}** tự động phát nhạc thịnh hành`)
                .addFields(
                    { name: '🎯 Trạng thái', value: `${statusEmoji} ${statusText}`, inline: true },
                    { name: '📊 Khu vực', value: this.getRegionDisplayName(region), inline: true },
                    { name: '🎵 Hoạt động', value: enabled ? 'Khi queue trống' : 'Đã tắt', inline: true }
                );

            if (enabled) {
                embed.addFields(
                    { name: '⚙️ Cách hoạt động', value: '• Tự động thêm nhạc trending khi queue trống\n• Ưu tiên nhạc theo khu vực đã chọn\n• Cập nhật realtime từ YouTube', inline: false },
                    { name: '🔧 Điều khiển', value: 'Dùng buttons bên dưới để thay đổi cài đặt', inline: false }
                );

                // Control buttons
                const controlRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('autotrending_vn')
                            .setLabel('🇻🇳 Việt Nam')
                            .setStyle(region === 'VN' ? ButtonStyle.Success : ButtonStyle.Secondary),
                        new ButtonBuilder()
                            .setCustomId('autotrending_kr')
                            .setLabel('🇰🇷 K-pop')
                            .setStyle(region === 'KR' ? ButtonStyle.Success : ButtonStyle.Secondary),
                        new ButtonBuilder()
                            .setCustomId('autotrending_us')
                            .setLabel('🇺🇸 US')
                            .setStyle(region === 'US' ? ButtonStyle.Success : ButtonStyle.Secondary),
                        new ButtonBuilder()
                            .setCustomId('autotrending_global')
                            .setLabel('🌍 Global')
                            .setStyle(region === 'GLOBAL' ? ButtonStyle.Success : ButtonStyle.Secondary),
                        new ButtonBuilder()
                            .setCustomId('autotrending_off')
                            .setLabel('❌ Tắt')
                            .setStyle(ButtonStyle.Danger)
                    );

                await interaction.reply({
                    embeds: [embed],
                    components: [controlRow]
                });
            } else {
                await interaction.reply({ embeds: [embed] });
            }

        } catch (error) {
            console.error('Lỗi autotrending command:', error);
            await interaction.reply({
                content: '❌ Có lỗi khi cài đặt auto trending!',
                ephemeral: true
            });
        }
    },

    // Hiển thị tên khu vực
    getRegionDisplayName(region) {
        const names = {
            'VN': '🇻🇳 Việt Nam',
            'KR': '🇰🇷 Hàn Quốc (K-pop)',
            'US': '🇺🇸 Mỹ (US)',
            'GLOBAL': '🌍 Toàn cầu',
            'ASIA': '🌏 Châu Á'
        };
        return names[region] || '🌍 Toàn cầu';
    }
};