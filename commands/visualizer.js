const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { initGuildMusicData } = require('../utils/musicUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('visualizer')
        .setDescription('Hiển thị music visualizer với ASCII art')
        .addStringOption(option =>
            option.setName('style')
                .setDescription('Kiểu visualizer')
                .setRequired(false)
                .addChoices(
                    { name: 'Bars', value: 'bars' },
                    { name: 'Wave', value: 'wave' },
                    { name: 'Circle', value: 'circle' },
                    { name: 'Spectrum', value: 'spectrum' },
                    { name: 'Dancing', value: 'dancing' }
                )
        ),

    async execute(interaction) {
        const guildData = initGuildMusicData(interaction.guildId);

        if (!guildData.currentSong) {
            return interaction.reply({
                content: '❌ Không có bài hát nào đang phát để visualize!',
                ephemeral: true
            });
        }

        const style = interaction.options.getString('style') || 'bars';

        try {
            await interaction.deferReply();

            // Bật visualizer
            guildData.visualizer = {
                enabled: true,
                style: style,
                frame: 0,
                interval: null,
                message: null
            };

            // Tạo embed ban đầu
            const embed = this.createVisualizerEmbed(guildData, style);
            
            const controlRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('visualizer_pause')
                        .setLabel('⏸️ Pause')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId('visualizer_style')
                        .setLabel('🎨 Change Style')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('visualizer_speed')
                        .setLabel('⚡ Speed')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('visualizer_stop')
                        .setLabel('⏹️ Stop')
                        .setStyle(ButtonStyle.Danger)
                );

            const message = await interaction.editReply({
                embeds: [embed],
                components: [controlRow]
            });

            guildData.visualizer.message = message;

            // Bắt đầu animation
            this.startVisualizerAnimation(guildData);

        } catch (error) {
            console.error('Lỗi visualizer command:', error);
            await interaction.editReply({
                content: '❌ Có lỗi khi khởi động visualizer!'
            });
        }
    },

    // Tạo embed visualizer
    createVisualizerEmbed(guildData, style) {
        const song = guildData.currentSong;
        const frame = guildData.visualizer?.frame || 0;

        const embed = new EmbedBuilder()
            .setColor(this.getVisualizerColor(frame))
            .setTitle('🎵 Music Visualizer')
            .setDescription(`**${song.title}**\n\n${this.generateVisualizerArt(style, frame)}`)
            .addFields(
                { name: '🎨 Style', value: this.getStyleDisplayName(style), inline: true },
                { name: '⏱️ Frame', value: `${frame}`, inline: true },
                { name: '🔊 Status', value: guildData.isPlaying ? '▶️ Playing' : '⏸️ Paused', inline: true }
            )
            .setThumbnail(song.thumbnail)
            .setFooter({ text: 'Visualizer đang chạy...' })
            .setTimestamp();

        return embed;
    },

    // Tạo ASCII art theo style
    generateVisualizerArt(style, frame) {
        switch (style) {
            case 'bars':
                return this.generateBarsArt(frame);
            case 'wave':
                return this.generateWaveArt(frame);
            case 'circle':
                return this.generateCircleArt(frame);
            case 'spectrum':
                return this.generateSpectrumArt(frame);
            case 'dancing':
                return this.generateDancingArt(frame);
            default:
                return this.generateBarsArt(frame);
        }
    },

    // Bars style
    generateBarsArt(frame) {
        const bars = [];
        const barCount = 15;
        
        for (let i = 0; i < barCount; i++) {
            const height = Math.floor(Math.sin((frame + i) * 0.3) * 8) + 10;
            const bar = '█'.repeat(Math.max(1, height));
            bars.push(bar);
        }

        // Chia thành 3 dòng
        const line1 = bars.slice(0, 5).join(' ');
        const line2 = bars.slice(5, 10).join(' ');
        const line3 = bars.slice(10, 15).join(' ');

        return `\`\`\`\n${line1}\n${line2}\n${line3}\n\`\`\``;
    },

    // Wave style
    generateWaveArt(frame) {
        const width = 40;
        const lines = [];
        
        for (let y = 0; y < 8; y++) {
            let line = '';
            for (let x = 0; x < width; x++) {
                const wave = Math.sin((x + frame) * 0.2) * 3 + 4;
                if (Math.abs(y - wave) < 0.5) {
                    line += '~';
                } else {
                    line += ' ';
                }
            }
            lines.push(line);
        }

        return `\`\`\`\n${lines.join('\n')}\n\`\`\``;
    },

    // Circle style
    generateCircleArt(frame) {
        const size = 15;
        const center = size / 2;
        const radius = 5 + Math.sin(frame * 0.1) * 2;
        
        const lines = [];
        for (let y = 0; y < size; y++) {
            let line = '';
            for (let x = 0; x < size; x++) {
                const distance = Math.sqrt((x - center) ** 2 + (y - center) ** 2);
                if (Math.abs(distance - radius) < 1) {
                    line += '●';
                } else {
                    line += ' ';
                }
            }
            lines.push(line);
        }

        return `\`\`\`\n${lines.join('\n')}\n\`\`\``;
    },

    // Spectrum style
    generateSpectrumArt(frame) {
        const frequencies = [];
        for (let i = 0; i < 20; i++) {
            const freq = Math.floor(Math.sin((frame + i) * 0.25) * 5) + 5;
            frequencies.push('▌'.repeat(freq));
        }

        const line1 = frequencies.slice(0, 10).join('');
        const line2 = frequencies.slice(10, 20).join('');

        return `\`\`\`\n${line1}\n${line2}\n\`\`\``;
    },

    // Dancing style
    generateDancingArt(frame) {
        const dancers = ['(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧', '✧ﾟ･: *ヽ(◕ヮ◕ヽ)', '♪┏(・o･)┛♪', '♪┗(・o･)┓♪'];
        const notes = ['♪', '♫', '♬', '♩', '♭', '♮', '♯'];
        
        let art = '';
        
        // Dancer animation
        const dancer = dancers[frame % dancers.length];
        art += `     ${dancer}\n`;
        
        // Musical notes floating
        for (let i = 0; i < 3; i++) {
            let line = '';
            for (let j = 0; j < 25; j++) {
                if (Math.random() < 0.1) {
                    line += notes[Math.floor(Math.random() * notes.length)];
                } else {
                    line += ' ';
                }
            }
            art += line + '\n';
        }

        return `\`\`\`\n${art}\`\`\``;
    },

    // Bắt đầu animation
    startVisualizerAnimation(guildData) {
        if (guildData.visualizer.interval) {
            clearInterval(guildData.visualizer.interval);
        }

        guildData.visualizer.interval = setInterval(async () => {
            if (!guildData.visualizer.enabled || !guildData.visualizer.message) {
                this.stopVisualizerAnimation(guildData);
                return;
            }

            guildData.visualizer.frame++;
            
            try {
                const embed = this.createVisualizerEmbed(guildData, guildData.visualizer.style);
                await guildData.visualizer.message.edit({ embeds: [embed] });
            } catch (error) {
                console.log('Lỗi cập nhật visualizer:', error.message);
                this.stopVisualizerAnimation(guildData);
            }
        }, 500); // Update every 500ms
    },

    // Dừng animation
    stopVisualizerAnimation(guildData) {
        if (guildData.visualizer?.interval) {
            clearInterval(guildData.visualizer.interval);
            guildData.visualizer.interval = null;
        }
        
        if (guildData.visualizer) {
            guildData.visualizer.enabled = false;
        }
    },

    // Màu sắc theo frame
    getVisualizerColor(frame) {
        const colors = ['#ff0000', '#ff8800', '#ffff00', '#88ff00', '#00ff00', '#00ff88', '#00ffff', '#0088ff', '#0000ff', '#8800ff', '#ff00ff', '#ff0088'];
        return colors[Math.floor(frame / 2) % colors.length];
    },

    // Hiển thị tên style
    getStyleDisplayName(style) {
        const names = {
            'bars': '📊 Bars',
            'wave': '🌊 Wave',
            'circle': '⭕ Circle',
            'spectrum': '📈 Spectrum',
            'dancing': '💃 Dancing'
        };
        return names[style] || style;
    },

    // Xử lý button interactions (thêm vào index.js)
    async handleVisualizerButton(interaction, customId, guildData) {
        switch (customId) {
            case 'visualizer_pause':
                guildData.visualizer.enabled = !guildData.visualizer.enabled;
                const status = guildData.visualizer.enabled ? 'resumed' : 'paused';
                interaction.reply({ content: `🎵 Visualizer ${status}!`, ephemeral: true });
                
                if (guildData.visualizer.enabled) {
                    this.startVisualizerAnimation(guildData);
                } else {
                    this.stopVisualizerAnimation(guildData);
                }
                break;

            case 'visualizer_style':
                const styles = ['bars', 'wave', 'circle', 'spectrum', 'dancing'];
                const currentIndex = styles.indexOf(guildData.visualizer.style);
                const nextStyle = styles[(currentIndex + 1) % styles.length];
                
                guildData.visualizer.style = nextStyle;
                interaction.reply({ 
                    content: `🎨 Changed to ${this.getStyleDisplayName(nextStyle)}!`, 
                    ephemeral: true 
                });
                break;

            case 'visualizer_stop':
                this.stopVisualizerAnimation(guildData);
                guildData.visualizer = null;
                
                const stopEmbed = new EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle('⏹️ Visualizer Stopped')
                    .setDescription('Music visualizer đã được tắt.');

                await interaction.update({ 
                    embeds: [stopEmbed], 
                    components: [] 
                });
                break;
        }
    }
};
