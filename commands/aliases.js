const { SlashCommandBuilder } = require('discord.js');

// Import tất cả lệnh gốc
const playCommand = require('./play.js');
const queueCommand = require('./queue.js');
const skipCommand = require('./skip.js');
const nowplayingCommand = require('./nowplaying.js');
const pauseCommand = require('./pause.js');
const resumeCommand = require('./resume.js');
const lyricsCommand = require('./lyrics.js');
const stopCommand = require('./stop.js');
const leaveCommand = require('./leave.js');
const helpCommand = require('./help.js');
const volumeCommand = require('./volume.js');
const loopCommand = require('./loop.js');
const historyCommand = require('./history.js');

// Định nghĩa tất cả lệnh viết tắt
const aliases = [
    {
        name: 'p',
        description: 'Viết tắt của /play - Phát nhạc từ YouTube',
        originalCommand: playCommand,
        options: [
            {
                name: 'query',
                description: 'Tên bài hát hoặc URL YouTube',
                type: 3, // STRING
                required: true
            }
        ]
    },
    {
        name: 'q',
        description: 'Viết tắt của /queue - Hiển thị danh sách phát',
        originalCommand: queueCommand
    },
    {
        name: 's',
        description: 'Viết tắt của /skip - Bỏ qua bài hiện tại',
        originalCommand: skipCommand
    },
    {
        name: 'np',
        description: 'Viết tắt của /nowplaying - Hiển thị bài đang phát',
        originalCommand: nowplayingCommand
    },
    {
        name: 'ps',
        description: 'Viết tắt của /pause - Tạm dừng nhạc',
        originalCommand: pauseCommand
    },
    {
        name: 'r',
        description: 'Viết tắt của /resume - Tiếp tục phát nhạc',
        originalCommand: resumeCommand
    },
    {
        name: 'l',
        description: 'Viết tắt của /lyrics - Hiển thị lời bài hát',
        originalCommand: lyricsCommand
    },
    {
        name: 'st',
        description: 'Viết tắt của /stop - Dừng nhạc và xóa queue',
        originalCommand: stopCommand
    },
    {
        name: 'dc',
        description: 'Viết tắt của /leave - Bot rời khỏi voice channel',
        originalCommand: leaveCommand
    },
    {
        name: 'h',
        description: 'Viết tắt của /help - Hiển thị hướng dẫn sử dụng',
        originalCommand: helpCommand
    },
    {
        name: 'v',
        description: 'Viết tắt của /volume - Điều chỉnh âm lượng',
        originalCommand: volumeCommand,
        options: [
            {
                name: 'level',
                description: 'Mức âm lượng (0-100)',
                type: 4, // INTEGER
                required: true
            }
        ]
    },
    {
        name: 'lp',
        description: 'Viết tắt của /loop - Bật/tắt lặp lại',
        originalCommand: loopCommand,
        options: [
            {
                name: 'mode',
                description: 'Chế độ lặp lại',
                type: 3, // STRING
                required: true
            }
        ]
    },
    {
        name: 'his',
        description: 'Viết tắt của /history - Xem lịch sử nhạc',
        originalCommand: historyCommand
    }
];

// Tạo module exports cho từng lệnh viết tắt
const aliasCommands = {};

aliases.forEach(alias => {
    const builder = new SlashCommandBuilder()
        .setName(alias.name)
        .setDescription(alias.description);
    
    // Thêm options nếu có
    if (alias.options) {
        alias.options.forEach(option => {
            if (option.type === 4) { // INTEGER
                builder.addIntegerOption(opt => 
                    opt.setName(option.name)
                       .setDescription(option.description)
                       .setRequired(option.required || false)
                );
            } else { // STRING
                builder.addStringOption(opt => 
                    opt.setName(option.name)
                       .setDescription(option.description)
                       .setRequired(option.required || false)
                );
            }
        });
    }
    
    aliasCommands[alias.name] = {
        data: builder,
        async execute(interaction) {
            return await alias.originalCommand.execute(interaction);
        }
    };
});

module.exports = aliasCommands;
