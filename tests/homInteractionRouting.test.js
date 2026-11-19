const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Execute the real interaction handler without logging in or starting the bot.
function handlerFor(hom) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
    const start = source.indexOf('client.on(Events.InteractionCreate,');
    const end = source.indexOf('\nclient.on(', start + 1);
    if (start < 0 || end < 0) throw new Error('Interaction handler not found');
    let handler;
    const fallback = jest.fn();
    vm.runInNewContext(source.slice(start, end), {
        client: { on: (_event, callback) => { handler = callback; } },
        Events: { InteractionCreate: 'interactionCreate' },
        commands: new Map([['hom', hom]]),
        shuttingDown: false,
        isGuildAllowed: () => true,
        isDisabledComponent: require('../utils/features').isDisabledComponent,
        MessageFlags: { Ephemeral: 64 },
        require: () => ({ handleStringSelectMenu: fallback }),
        console
    });
    return { handler, fallback };
}

test.each([
    ['mg_hom_inventory-sort_crate-4904_0', 'float-asc'],
    ['mg_hom_tradeup-sort_session-id', 'price-desc'],
    ['mg_hom_inventory-select_crate-4904_0', 'drop_123'],
    ['mg_hom_tradeup-items_session-id', '123'],
    ['mg_hom_upgrade:items:session:0', '123'],
    ['mg_hom_upgrade:target:session:1', 'target-id'],
    ['mg_hom_battle-seat_123', '2']
])('Discord routes %s to the case command', async (customId, value) => {
    const hom = { select: jest.fn() };
    const { handler, fallback } = handlerFor(hom);
    const interaction = {
        customId, guildId: '1', values: [value],
        isRepliable: () => true, isButton: () => false,
        isChatInputCommand: () => false, isStringSelectMenu: () => true,
        reply: jest.fn()
    };
    await handler(interaction);
    expect(hom.select).toHaveBeenCalledWith(interaction);
    expect(fallback).not.toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
});

test.each([
    ['isButton', 'mg_hom_upgrade_crate-4904', 'button'],
    ['isModalSubmit', 'mg_hom_open-form_crate-4904', 'modal'],
    ['isModalSubmit', 'mg_hom_upgrade:settings-save:session:1', 'modal']
])('Discord routes Upgrade %s interactions into /hom', async (kind, customId, method) => {
    const hom = { [method]: jest.fn() };
    const { handler, fallback } = handlerFor(hom);
    const interaction = {
        customId, guildId: '1',
        isRepliable: () => true, isButton: () => kind === 'isButton', isModalSubmit: () => kind === 'isModalSubmit',
        isChatInputCommand: () => false, isStringSelectMenu: () => false,
        reply: jest.fn()
    };
    await handler(interaction);
    expect(hom[method]).toHaveBeenCalledWith(interaction);
    expect(fallback).not.toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
});
