const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const discord = require('discord.js');
const features = require('../utils/features');
const loader = require('../utils/commandLoader');

afterEach(() => jest.restoreAllMocks());

test('stale removed command files and old enabling flags cannot register removed commands', () => {
    const removed = ['chat', 'listen', 'speak', 'musicquiz', 'recommend', 'autotrending', 'visualizer'];
    const configuration = require('../config/features.json');
    const previous = { ...configuration };
    Object.assign(configuration, { ai: true, serverManagement: true });
    jest.replaceProperty(process, 'env', { ...process.env, ENABLE_VOICE_LISTEN: 'true', ENABLE_VISUALIZER: 'true' });
    // These files can remain on a VPS after copying newer source over an old install.
    jest.spyOn(fs, 'readdirSync').mockReturnValue(['play.js', ...removed.map(name => `${name}.js`)]);
    try {
        const commands = loader.loadCommands();
        expect([...commands.keys()]).toEqual(['play']);
        for (const name of removed) expect(loader.isCommandEnabled(name)).toBe(false);
    } finally {
        for (const key of Object.keys(configuration)) delete configuration[key];
        Object.assign(configuration, previous);
    }
});

test('retired controls are rejected while the retained trending region buttons remain available', () => {
    for (const id of ['quiz_start', 'recommend_add_all', 'visualizer_pause']) {
        expect(features.isDisabledComponent(id)).toBe(true);
    }
    expect(features.isDisabledComponent('autotrending_VN')).toBe(false);
});

function isolatedBoot() {
    const handlers = new Map();
    const handlePrivateMessage = jest.fn().mockResolvedValue();
    let options;
    const modules = {
        dotenv: { config: jest.fn() },
        'node:timers/promises': { setTimeout: jest.fn() },
        'discord.js': {
            ...discord,
            Client: class {
                constructor(value) { options = value; this.user = { id: 'bot' }; }
                on(event, handler) { handlers.set(event, handler); }
                once() {}
            }
        },
        './utils/commandLoader': { loadCommands: () => new Map([['tiembanh', { handlePrivateMessage }]]) },
        './utils/features': { isFeatureEnabled: () => false, isDisabledComponent: features.isDisabledComponent },
        './utils/youtubeUtils': { checkDNSConnection: jest.fn() },
        './utils/guildUtils': { isGuildAllowed: () => true },
        './utils/voiceAccess': {},
        './utils/musicUtils': { musicData: new Map(), disconnectMusic: jest.fn() },
        './utils/runtime': { createHealthServer: () => ({}), watchLauncher: () => () => {} },
        './utils/adminWeb': { createAdminHandler: () => null },
        './utils/playerWeb': { createPlayerHandler: () => null },
        './utils/cs2PriceSnapshot': {},
        './utils/cs2BlueGemPrices': {},
        // Stop startup before any database, HTTP or Discord connection.
        './utils/database': { initialize: () => new Promise(() => {}) }
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8'), {
        require: name => {
            if (!Object.hasOwn(modules, name)) throw new Error(`Unexpected module: ${name}`);
            return modules[name];
        },
        process: { env: {}, on: jest.fn() }, console, setTimeout, clearTimeout
    });
    return { handler: handlers.get(discord.Events.MessageCreate), handlePrivateMessage, options };
}

test('Discord boot keeps owner coin DMs and board events without requesting message content', async () => {
    const { handler, handlePrivateMessage, options } = isolatedBoot();
    expect(options.intents).toEqual(expect.arrayContaining([
        discord.GatewayIntentBits.GuildMessages, discord.GatewayIntentBits.DirectMessages,
        discord.GatewayIntentBits.GuildVoiceStates
    ]));
    expect(options.intents).not.toContain(discord.GatewayIntentBits.MessageContent);
    const dm = { author: { id: 'owner', bot: false }, content: '!addxu 1 100', reply: jest.fn() };
    await handler(dm);
    expect(handlePrivateMessage).toHaveBeenCalledWith(dm);
    handlePrivateMessage.mockClear();
    await handler({ ...dm, guildId: '1' });
    await handler({ ...dm, author: { id: 'other-bot', bot: true } });
    expect(handlePrivateMessage).not.toHaveBeenCalled();
});
