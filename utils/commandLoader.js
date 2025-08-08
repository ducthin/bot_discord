const fs = require('fs');
const path = require('path');

function loadCommands() {
    const commands = new Map();
    const commandsPath = path.join(__dirname, '../commands');
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        
        // Xử lý đặc biệt cho file aliases.js
        if (file === 'aliases.js') {
            // File aliases.js export một object chứa nhiều commands
            for (const [aliasName, aliasCommand] of Object.entries(command)) {
                if ('data' in aliasCommand && 'execute' in aliasCommand) {
                    commands.set(aliasCommand.data.name, aliasCommand);
                }
            }
        } else {
            // Xử lý bình thường cho các file khác
            if ('data' in command && 'execute' in command) {
                commands.set(command.data.name, command);
            } else {
                console.log(`[WARNING] Command tại ${filePath} thiếu "data" hoặc "execute" property.`);
            }
        }
    }

    return commands;
}

function getCommandsData() {
    const commands = loadCommands();
    return Array.from(commands.values()).map(command => command.data.toJSON());
}

module.exports = {
    loadCommands,
    getCommandsData
};
