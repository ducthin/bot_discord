const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { initGuildMusicData, playMusic, createMusicConnection } = require('../utils/musicUtils');
const { searchYoutube } = require('../utils/youtubeUtils');
const fs = require('fs');
const path = require('path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('musicquiz')
        .setDescription('Chơi game đoán tên bài hát')
        .addStringOption(option =>
            option.setName('mode')
                .setDescription('Chế độ chơi')
                .setRequired(false)
                .addChoices(
                    { name: 'Đoán tên bài', value: 'guess_title' },
                    { name: 'Đoán ca sĩ', value: 'guess_artist' },
                    { name: 'Finish the lyrics', value: 'finish_lyrics' },
                    { name: 'Mix mode', value: 'mixed' }
                )
        )
        .addIntegerOption(option =>
            option.setName('rounds')
                .setDescription('Số câu hỏi (3-10)')
                .setRequired(false)
                .setMinValue(3)
                .setMaxValue(10)
        ),

    async execute(interaction) {
        const guildData = initGuildMusicData(interaction.guildId);

        if (!interaction.member.voice.channel) {
            return interaction.reply({
                content: '❌ Bạn cần vào voice channel để chơi music quiz!',
                ephemeral: true
            });
        }

        const mode = interaction.options.getString('mode') || 'guess_title';
        const rounds = interaction.options.getInteger('rounds') || 5;

        try {
            await interaction.deferReply();

            // Tạo quiz data
            const quizData = {
                mode: mode,
                totalRounds: rounds,
                currentRound: 0,
                score: {},
                questions: [],
                isActive: true,
                timeLimit: 30000, // 30 giây mỗi câu
                currentQuestion: null
            };

            // Tạo danh sách câu hỏi
            await this.generateQuestions(quizData);

            if (quizData.questions.length === 0) {
                return interaction.editReply({
                    content: '❌ Không thể tạo câu hỏi! Hãy thử lại sau.'
                });
            }

            // Lưu vào guildData
            guildData.musicQuiz = quizData;

            // Hiển thị màn hình khởi động
            const startEmbed = new EmbedBuilder()
                .setColor('#ff9500')
                .setTitle('🎮 Music Quiz Game')
                .setDescription('Chuẩn bị để thử thách kiến thức âm nhạc của bạn!')
                .addFields(
                    { name: '🎯 Chế độ', value: this.getModeDisplayName(mode), inline: true },
                    { name: '🔢 Số câu hỏi', value: `${rounds} câu`, inline: true },
                    { name: '⏰ Thời gian', value: '30 giây/câu', inline: true },
                    { name: '🏆 Cách chơi', value: 'Nhấn nút tương ứng với đáp án đúng!\nNhanh tay để được điểm cao!', inline: false }
                )
                .setFooter({ text: 'Nhấn "Bắt đầu" để chơi!' });

            const startRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('quiz_start')
                        .setLabel('🚀 Bắt đầu')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId('quiz_cancel')
                        .setLabel('❌ Hủy')
                        .setStyle(ButtonStyle.Danger)
                );

            await interaction.editReply({
                embeds: [startEmbed],
                components: [startRow]
            });

        } catch (error) {
            console.error('Lỗi musicquiz command:', error);
            await interaction.editReply({
                content: '❌ Có lỗi khi khởi tạo music quiz!'
            });
        }
    },

    // Tạo câu hỏi
    async generateQuestions(quizData) {
        const songLists = {
            vpop: ['Sơn Tùng MTP', 'Hòa Minzy', 'Erik', 'Jack', 'K-ICM', 'Đen Vâu'],
            kpop: ['BTS Dynamite', 'BLACKPINK How You Like That', 'TWICE What Is Love', 'Red Velvet Psycho'],
            global: ['The Weeknd Blinding Lights', 'Dua Lipa Levitating', 'Ed Sheeran Shape of You', 'Billie Eilish bad guy']
        };

        const allSongs = [...songLists.vpop, ...songLists.kpop, ...songLists.global];
        
        for (let i = 0; i < quizData.totalRounds; i++) {
            const randomSong = allSongs[Math.floor(Math.random() * allSongs.length)];
            
            try {
                const searchResults = await searchYoutube(randomSong, 4);
                
                if (searchResults && searchResults.length >= 4) {
                    const correctAnswer = searchResults[0];
                    const wrongAnswers = searchResults.slice(1, 4);
                    
                    const question = this.createQuestion(quizData.mode, correctAnswer, wrongAnswers, i + 1);
                    quizData.questions.push(question);
                }
            } catch (error) {
                console.log(`Không tạo được câu hỏi cho: ${randomSong}`);
            }
        }
    },

    // Tạo từng câu hỏi
    createQuestion(mode, correct, wrong, questionNumber) {
        const answers = [correct, ...wrong].sort(() => Math.random() - 0.5);
        const correctIndex = answers.findIndex(answer => answer.url === correct.url);

        let questionText = '';
        let questionType = mode;

        if (mode === 'mixed') {
            const modes = ['guess_title', 'guess_artist'];
            questionType = modes[Math.floor(Math.random() * modes.length)];
        }

        switch (questionType) {
            case 'guess_title':
                questionText = `🎵 **Câu ${questionNumber}:** Đây là bài hát nào?\n*Gợi ý: Ca sĩ ${this.extractArtist(correct.title)}*`;
                break;
            case 'guess_artist':
                questionText = `🎤 **Câu ${questionNumber}:** Ai là ca sĩ của bài "${this.extractTitle(correct.title)}"?`;
                break;
            case 'finish_lyrics':
                questionText = `📝 **Câu ${questionNumber}:** Hoàn thành lời bài hát này...`;
                break;
        }

        return {
            number: questionNumber,
            type: questionType,
            question: questionText,
            correctAnswer: correct,
            answers: answers,
            correctIndex: correctIndex,
            timeLimit: 30000
        };
    },

    // Trích xuất tên ca sĩ
    extractArtist(title) {
        const parts = title.split('-');
        if (parts.length > 1) {
            return parts[0].trim();
        }
        const parts2 = title.split('|');
        if (parts2.length > 1) {
            return parts2[0].trim();
        }
        return 'Unknown Artist';
    },

    // Trích xuất tên bài hát
    extractTitle(title) {
        const parts = title.split('-');
        if (parts.length > 1) {
            return parts.slice(1).join('-').trim();
        }
        return title;
    },

    // Hiển thị tên chế độ
    getModeDisplayName(mode) {
        const names = {
            'guess_title': '🎵 Đoán tên bài hát',
            'guess_artist': '🎤 Đoán ca sĩ',
            'finish_lyrics': '📝 Hoàn thành lời bài hát',
            'mixed': '🎯 Chế độ tổng hợp'
        };
        return names[mode] || mode;
    },

    // Hiển thị câu hỏi
    async showQuestion(interaction, guildData) {
        const quiz = guildData.musicQuiz;
        const question = quiz.questions[quiz.currentRound];
        
        if (!question) {
            return this.endQuiz(interaction, guildData);
        }

        quiz.currentQuestion = question;
        
        const questionEmbed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle(`🎮 Music Quiz - Câu ${question.number}/${quiz.totalRounds}`)
            .setDescription(question.question)
            .addFields(
                { name: '⏰ Thời gian', value: '30 giây', inline: true },
                { name: '🏆 Điểm hiện tại', value: this.getScoreDisplay(quiz.score), inline: true }
            )
            .setThumbnail(question.correctAnswer.thumbnail);

        // Tạo buttons cho đáp án
        const answerRow = new ActionRowBuilder();
        
        for (let i = 0; i < question.answers.length && i < 4; i++) {
            const answer = question.answers[i];
            let label = '';
            
            switch (question.type) {
                case 'guess_title':
                    label = this.extractTitle(answer.title);
                    break;
                case 'guess_artist':
                    label = this.extractArtist(answer.title);
                    break;
                default:
                    label = answer.title;
            }

            if (label.length > 50) {
                label = label.substring(0, 47) + '...';
            }

            answerRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`quiz_answer_${i}`)
                    .setLabel(`${String.fromCharCode(65 + i)}. ${label}`)
                    .setStyle(ButtonStyle.Primary)
            );
        }

        const controlRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('quiz_skip')
                    .setLabel('⏭️ Bỏ qua')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('quiz_stop')
                    .setLabel('⏹️ Dừng game')
                    .setStyle(ButtonStyle.Danger)
            );

        await interaction.editReply({
            embeds: [questionEmbed],
            components: [answerRow, controlRow]
        });

        // Set timeout cho câu hỏi
        setTimeout(() => {
            if (quiz.isActive && quiz.currentRound === question.number - 1) {
                quiz.currentRound++;
                this.showQuestion(interaction, guildData);
            }
        }, question.timeLimit);
    },

    // Kết thúc quiz
    async endQuiz(interaction, guildData) {
        const quiz = guildData.musicQuiz;
        quiz.isActive = false;

        const finalEmbed = new EmbedBuilder()
            .setColor('#gold')
            .setTitle('🏆 Music Quiz - Kết thúc!')
            .setDescription('Cảm ơn bạn đã tham gia!')
            .addFields(
                { name: '📊 Kết quả cuối cùng', value: this.getScoreDisplay(quiz.score) || 'Chưa có ai trả lời', inline: false }
            );

        await interaction.editReply({
            embeds: [finalEmbed],
            components: []
        });

        // Xóa quiz data
        delete guildData.musicQuiz;
    },

    // Hiển thị điểm số
    getScoreDisplay(scoreObj) {
        if (!scoreObj || Object.keys(scoreObj).length === 0) {
            return 'Chưa có điểm';
        }

        const scores = Object.entries(scoreObj)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        return scores.map(([userId, score]) => `<@${userId}>: ${score} điểm`).join('\n');
    }
};
