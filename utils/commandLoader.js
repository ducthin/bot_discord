const fs = require('fs');
const path = require('path');
const { commandFeatureEnabled } = require('./features');

const retiredCommands = new Set([
    'controls', 'select', 'quickselect', 'debug', 'diagnostic', 'guilds', 'fallback',
    'chat', 'listen', 'speak', 'musicquiz', 'recommend', 'autotrending', 'visualizer'
]);
const optionalCommands = { role: 'ENABLE_ROLE_COMMAND' };

function isCommandEnabled(name) {
    if (retiredCommands.has(name) || !commandFeatureEnabled(name)) return false;
    return !Object.hasOwn(optionalCommands, name) || process.env[optionalCommands[name]] === 'true';
}

function loadCommands() {
    const commands = new Map();
    const commandsPath = path.join(__dirname, '../commands');
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {
        if (!isCommandEnabled(path.basename(file, '.js'))) continue;
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        
        // Xử lý đặc biệt cho file aliases.js
        if (file === 'aliases.js') {
            // File aliases.js export một object chứa nhiều commands
            for (const [aliasName, aliasCommand] of Object.entries(command)) {
                if ('data' in aliasCommand && 'execute' in aliasCommand && isCommandEnabled(aliasCommand.data.name)) {
                    commands.set(aliasCommand.data.name, aliasCommand);
                }
            }
        } else {
            // Xử lý bình thường cho các file khác
            if ('data' in command && 'execute' in command && isCommandEnabled(command.data.name)) {
                commands.set(command.data.name, command);
            } else {
                console.log(`[WARNING] Command tại ${filePath} thiếu "data" hoặc "execute" property.`);
            }
        }
    }

    return commands;
}

function getCommandsData(commands = loadCommands()) {
    return Array.from(commands.values()).map(command => command.data.toJSON());
}

module.exports = {
    loadCommands,
    getCommandsData,
    isCommandEnabled
};
