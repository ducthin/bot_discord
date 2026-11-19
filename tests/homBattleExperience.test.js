const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { MessageFlags } = require('discord.js');

jest.mock('../utils/cs2BattleArt', () => ({
    getBattleCaseArt: jest.fn((item, limit = Infinity) => limit >= 4 ? {
        buffer: Buffer.from('case'), name: `cs2-${item.id}.png`, url: `attachment://cs2-${item.id}.png`
    } : null),
    getBattleTieArt: jest.fn((limit = Infinity) => limit >= 4 ? {
        buffer: Buffer.from('ties'), name: 'cs2-tie.png', url: 'attachment://cs2-tie.png'
    } : null),
    getBattleTieAnimation: jest.fn((side, limit = Infinity) => limit >= 4 ? {
        buffer: Buffer.from('spin'), name: `cs2-tie-${side}.gif`, url: `attachment://cs2-tie-${side}.gif`, durationMs: 0
    } : null)
}));

const store = require('../utils/managementStore');
const market = require('../utils/cs2Market');
const battle = require('../utils/cs2Battles');
const art = require('../utils/cs2BattleArt');
const reel = require('../utils/cs2Reel');
const { customCases, casePricing, lockCasePricing } = require('../utils/cs2BattleCases');
const { createBattleUi } = require('../utils/cs2BattleUi');
const { formatCoins, readCoins } = require('../utils/coins');

const guild = { id: '1' };
const channelId = '20';
const users = ['101', '102', '103', '104'];
let directory;
let disk;
let ui;
let nextId = 80_000;

beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-battle-experience-'));
    disk = store.createManagementStore(directory);
    jest.spyOn(store, 'read').mockImplementation(disk.read);
    jest.spyOn(store, 'transact').mockImplementation(disk.transact);
    jest.spyOn(market, 'peekMarketQuote').mockReturnValue({ priceVnd: 100 });
    jest.spyOn(crypto, 'randomInt').mockImplementation((min, max) => max == null ? 0 : min);
    ui = createBattleUi({ rollDrop: jest.fn(), dropName: drop => `Skin ${drop.skinId}`,
        dropImage: () => 'https://example.com/skin.png', showResult: jest.fn(), reelRound: jest.fn() });
    await disk.transact(guild.id, async (state, save) => {
        state.taixiu.balances = Object.fromEntries(users.map(id => [id, 500_000]));
        await save();
    });
});

afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(directory, { recursive: true, force: true });
});

function interaction(userId, customId, extra = {}) {
    return { id: String(++nextId), guild, guildId: guild.id, channelId, user: { id: userId }, customId,
        attachmentSizeLimit: 0, reply: jest.fn(), deferReply: jest.fn(), deferUpdate: jest.fn(),
        editReply: jest.fn(), followUp: jest.fn(), showModal: jest.fn(), ...extra };
}
const payload = request => request.editReply.mock.calls.at(-1)[0];
const controls = panel => panel.components.flatMap(row => row.toJSON().components);
const control = (panel, action) => controls(panel).find(item => item.custom_id?.startsWith(`mg_hom_battle-${action}_`));
const textOf = panel => JSON.stringify(panel.embeds.map(embed => embed.toJSON()));

async function click(panel, action, values, extra = {}, userId = users[0]) {
    const request = interaction(userId, control(panel, action).custom_id, { values, ...extra });
    await ui.handle(request);
    return request;
}

async function builder(extra = {}) {
    const request = interaction(users[0], 'mg_hom_battle-new_crate-4904', extra);
    await ui.handle(request);
    return payload(request);
}

async function createRoom(options = {}) {
    const item = customCases[0];
    const { room, error } = await battle.createRoom(guild.id, { id: String(++nextId), channelId, hostId: users[0],
        caseIds: [item.id], format: '2', mode: 'regular',
        expectedPrices: { [item.id]: lockCasePricing(casePricing(item)) }, ...options });
    expect(error).toBeUndefined();
    return room;
}

function validPanel(panel) {
    expect(panel.components.length).toBeLessThanOrEqual(5);
    let characters = 0;
    for (const row of panel.components) {
        const components = row.toJSON().components;
        expect(components.length).toBeLessThanOrEqual(5);
        for (const component of components) {
            expect(component.custom_id.length).toBeLessThanOrEqual(100);
            if (component.options) expect(component.options.length).toBeLessThanOrEqual(25);
        }
    }
    for (const embed of panel.embeds) {
        const data = embed.toJSON();
        expect(data.description?.length ?? 0).toBeLessThanOrEqual(4096);
        expect(data.fields?.length ?? 0).toBeLessThanOrEqual(25);
        characters += (data.title?.length ?? 0) + (data.description?.length ?? 0) + (data.footer?.text.length ?? 0);
        for (const field of data.fields ?? []) {
            expect(field.value.length).toBeLessThanOrEqual(1024);
            characters += field.name.length + field.value.length;
        }
    }
    expect(characters).toBeLessThanOrEqual(6000);
}

test.each(['split', 'sudden-death'])('builder publishes persisted %s tie rules and always uses full animation', async tieRule => {
    let panel = await builder({ attachmentSizeLimit: 8 });
    expect(panel.files[0].name).toBe(`cs2-${customCases[0].id}.png`);
    panel = payload(await click(panel, 'add'));
    panel = payload(await click(panel, 'settings'));
    validPanel(panel);
    expect(panel.attachments).toEqual([]);
    expect(panel.files).toBeUndefined();
    expect(control(panel, 'tie-rule').options.find(option => option.default).value).toBe('split');
    panel = payload(await click(panel, 'tie-rule', [tieRule]));
    expect(control(panel, 'animation')).toBeUndefined();
    panel = payload(await click(panel, 'catalogue'));
    const send = jest.fn().mockResolvedValue({ url: 'https://example.com/room' });
    await click(panel, 'publish', undefined, { attachmentSizeLimit: 8, channel: { isSendable: () => true, send } });
    const rooms = Object.values((await disk.read(guild.id)).cs2Battles);
    expect(rooms).toHaveLength(1);
    expect(rooms[0].tieRule).toBe(tieRule);
    expect(rooms[0].animationMode).toBe('full');
    const published = send.mock.calls[0][0];
    validPanel(published);
    expect(published.files[0].attachment.length).toBeLessThanOrEqual(8);
    expect(published.embeds[0].data.image.url).toContain('attachment://');
});

test('builder configures a ten-player Battle and enforces the custom limit', async () => {
    let panel = await builder();
    expect(control(panel, 'rules').options.length).toBeLessThanOrEqual(25);
    panel = payload(await click(panel, 'rules', ['custom:regular']));
    panel = payload(await click(panel, 'settings'));

    const openLimit = await click(panel, 'player-limit');
    const modal = openLimit.showModal.mock.calls[0][0].toJSON();
    expect(modal.title).toBe('Số người Battle tùy chỉnh');
    expect(modal.components[0].components[0].value).toBe('5');
    const invalid = interaction(users[0], modal.custom_id, { fields: { getTextInputValue: () => '11' } });
    await ui.handle(invalid);
    panel = payload(invalid);
    expect(textOf(panel)).toContain('5 người tùy chỉnh');
    expect(panel.embeds[0].data.footer.text).toContain('Nhập số người từ 5 đến 10');

    const retry = await click(panel, 'player-limit');
    const retryModal = retry.showModal.mock.calls[0][0].toJSON();
    const submit = interaction(users[0], retryModal.custom_id, { fields: { getTextInputValue: () => '10' } });
    await ui.handle(submit);
    panel = payload(submit);
    expect(textOf(panel)).toContain('10 người tùy chỉnh');
    panel = payload(await click(panel, 'catalogue'));
    panel = payload(await click(panel, 'add'));
    const send = jest.fn().mockResolvedValue({ url: 'https://example.com/room' });
    await click(panel, 'publish', undefined, { channel: { isSendable: () => true, send } });

    const room = Object.values((await disk.read(guild.id)).cs2Battles)[0];
    expect(room).toMatchObject({ format: 'custom', playerLimit: 10 });
    expect(send.mock.calls[0][0].embeds[0].data.description).toContain('Chờ người · 1/10');
});

test('ten-player round details are split into Discord-sized fields', async () => {
    const room = await createRoom({ format: 'custom', playerLimit: 10, mode: 'sharing' });
    const players = Array.from({ length: 10 }, (_, index) => ({ id: String(201 + index) }));
    const entries = players.map((player, index) => ({ userId: player.id,
        drop: { skinId: `skin-${index}`, float: 0.123456 }, value: '100000000000000000000000000000000000' }));
    const result = { ...room, status: 'finished', finishedAt: Date.now(), players,
        rounds: [{ caseId: room.caseIds[0], entries }], winners: players.map(player => player.id),
        payouts: Object.fromEntries(players.map(player => [player.id, '10'])), payoutType: 'coins',
        pool: '100', totals: Object.fromEntries(players.map(player => [player.id, '10'])) };
    jest.spyOn(battle, 'readRoom').mockResolvedValue(result);
    const refresh = interaction(users[0], `mg_hom_battle-refresh_${room.id}`);
    await ui.handle(refresh);
    const panel = payload(refresh);
    validPanel(panel);
    const rounds = panel.embeds[0].data.fields.filter(field => field.name.startsWith('Vòng 1 ·'));
    expect(rounds).toHaveLength(2);
    for (const entry of entries.slice(0, 5)) expect(rounds[0].value).toContain(`<@${entry.userId}>`);
    for (const entry of entries.slice(5)) expect(rounds[1].value).toContain(`<@${entry.userId}>`);
    expect(rounds.every(field => field.value.length <= 1024)).toBe(true);
});

test('Battle rewards remain uncredited while the reel is still playing', async () => {
    const room = await createRoom();
    let finishRender;
    let startRender;
    const rendering = new Promise(resolve => { startRender = resolve; });
    const renderPromise = new Promise(resolve => { finishRender = () => resolve(null); });
    jest.spyOn(reel, 'renderCaseBatch').mockImplementation(() => {
        startRender();
        return renderPromise;
    });
    const join = interaction(users[1], `mg_hom_battle-join_${room.id}`, {
        message: { id: 'message-reveal' }, attachmentSizeLimit: 4
    });
    const animation = ui.handle(join);
    await rendering;
    expect(reel.renderCaseBatch).toHaveBeenCalled();

    const pending = await disk.read(guild.id);
    expect(pending.cs2Battles[room.id].status).toBe('revealing');
    for (const userId of users.slice(0, 2)) {
        expect(readCoins(pending.taixiu.balances[userId])).toBe(50_000_000n - BigInt(room.fee));
    }
    expect(pending.skinCases).toBeUndefined();

    finishRender();
    await animation;
    const completed = await disk.read(guild.id);
    expect(completed.cs2Battles[room.id].status).toBe('finished');
    expect(readCoins(completed.taixiu.balances[users[0]])).toBeGreaterThan(readCoins(pending.taixiu.balances[users[0]]));
});

test('a public room exposes a bot-start action and renders bot winners without fake Discord mentions', async () => {
    const room = await createRoom({ animationMode: 'full' });
    const refresh = interaction(users[0], `mg_hom_battle-refresh_${room.id}`);
    await ui.handle(refresh);
    const lobby = payload(refresh);
    validPanel(lobby);
    expect(control(lobby, 'bot-start').label).toBe('Đấu với bot');

    const botId = `${battle.BOT_ID}:${room.id}:1`;
    const resultRoom = { ...room, status: 'finished', finishedAt: Date.now(),
        players: [{ id: users[0] }, { id: botId, isBot: true, name: 'Bot' }],
        rounds: [{ caseId: room.caseIds[0], entries: [
            { userId: users[0], drop: { skinId: 'human-skin' }, value: '10000' },
            { userId: botId, drop: { skinId: 'bot-skin' }, value: '20000' }
        ] }], winners: [botId], payouts: {}, payoutType: 'skins', discardedSkins: 2,
        totals: { [users[0]]: '10000', [botId]: '20000' }, pool: '30000', tie: false, tieSplit: false };
    const settle = jest.spyOn(battle, 'actOnRoom').mockResolvedValue({ room: resultRoom, started: true });
    const start = interaction(users[0], control(lobby, 'bot-start').custom_id);
    await ui.handle(start);
    expect(settle.mock.calls[0].slice(1, 5)).toEqual([channelId, room.id, users[0], 'bot-start']);
    const final = payload(start);
    validPanel(final);
    const text = textOf(final);
    expect(text).toContain('🤖 Bot');
    expect(text).not.toContain(`<@${battle.BOT_ID}`);
    expect(text).toContain('2 skin');
    expect(text).toContain('không vào kho');
    expect(final.embeds[0].data.fields.find(field => field.name === 'Lãi/lỗ theo giá lúc mở').value)
        .toContain(`<@${users[0]}>`);
    expect(final.embeds[0].data.fields.find(field => field.name === 'Lãi/lỗ theo giá lúc mở').value)
        .not.toContain('🤖 Bot');
});

test('team rooms keep the bot-start control within Discord row limits', async () => {
    const room = await createRoom({ format: 'teams' });
    const refresh = interaction(users[0], `mg_hom_battle-refresh_${room.id}`);
    await ui.handle(refresh);
    const lobby = payload(refresh);
    validPanel(lobby);
    expect(control(lobby, 'bot-start')).toBeDefined();
    expect(lobby.components.every(row => row.toJSON().components.length <= 5)).toBe(true);
});

test('the host can fill an empty room with bots; bots do not pay or create wallet/history entries', async () => {
    const room = await createRoom({ format: '3' });
    const refresh = interaction(users[0], `mg_hom_battle-refresh_${room.id}`);
    await ui.handle(refresh);
    const lobby = payload(refresh);
    const botStart = control(lobby, 'bot-start');
    expect(botStart).toBeDefined();

    const unauthorized = interaction(users[1], botStart.custom_id);
    await ui.handle(unauthorized);
    expect(unauthorized.followUp).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Chỉ chủ phòng') }));
    expect((await disk.read(guild.id)).cs2Battles[room.id].status).toBe('waiting');

    const before = await disk.read(guild.id);
    const start = interaction(users[0], botStart.custom_id);
    await ui.handle(start);
    const after = await disk.read(guild.id);
    const saved = after.cs2Battles[room.id];
    expect(saved.status).toBe('finished');
    expect(saved.players).toHaveLength(3);
    expect(saved.players.filter(player => player.isBot)).toHaveLength(2);
    expect(saved.payoutType).toBe('coins');
    expect(saved.payouts).toHaveProperty(users[0]);
    expect(Object.keys(after.taixiu.balances).some(id => id.startsWith(`${battle.BOT_ID}:`))).toBe(false);
    expect(Object.keys(after.cs2BattleHistory).some(id => id.startsWith(`${battle.BOT_ID}:`))).toBe(false);
    expect(after.taixiu.balances[users[1]]).toEqual(before.taixiu.balances[users[1]]);
    expect(textOf(payload(start))).toContain('🤖 Bot');
    for (const player of saved.players.filter(player => player.isBot)) {
        expect(textOf(payload(start))).not.toContain(`<@${player.id}>`);
    }
});

test('a bot-created team win with no real payout recipient is explained in the result', async () => {
    const room = await createRoom({ format: 'teams' });
    const botA = `${battle.BOT_ID}:${room.id}:1`;
    const botB = `${battle.BOT_ID}:${room.id}:2`;
    const botC = `${battle.BOT_ID}:${room.id}:3`;
    const resultRoom = { ...room, status: 'finished', finishedAt: Date.now(),
        players: [{ id: users[0], team: 'A' }, { id: botA, isBot: true, name: 'Bot', team: 'B' },
            { id: botB, isBot: true, name: 'Bot', team: 'B' }, { id: botC, isBot: true, name: 'Bot', team: 'A' }],
        rounds: [{ caseId: room.caseIds[0], entries: [
            { userId: users[0], drop: { skinId: 'human-skin' }, value: '10000' },
            { userId: botA, drop: { skinId: 'bot-a' }, value: '20000' },
            { userId: botB, drop: { skinId: 'bot-b' }, value: '20000' },
            { userId: botC, drop: { skinId: 'bot-c' }, value: '10000' }
        ] }], winners: [botA, botB], payouts: {}, payoutType: 'coins',
        unclaimedPayout: '60000', totals: { [users[0]]: '10000', [botA]: '20000', [botB]: '20000', [botC]: '10000' },
        pool: '60000', tie: false, tieSplit: false };
    jest.spyOn(battle, 'actOnRoom').mockResolvedValue({ room: resultRoom, started: true });
    const refresh = interaction(users[0], `mg_hom_battle-refresh_${room.id}`);
    await ui.handle(refresh);
    const start = interaction(users[0], control(payload(refresh), 'bot-start').custom_id);
    await ui.handle(start);
    const final = payload(start);
    const payout = final.embeds[0].data.fields.find(field => field.name === 'Thưởng đội bằng xu').value;
    expect(payout).toContain('Không có người chơi thật nhận xu.');
    expect(payout).toContain(formatCoins(60000n));
    expect(payout).toContain('Phần của Bot');
    expect(payout).toContain('không cộng cho người chơi');
    expect(payout).not.toContain('chưa được nhận');
    expect(final.embeds[0].data.fields.find(field => field.name === 'Lãi/lỗ theo giá lúc mở').value)
        .not.toContain('🤖 Bot');
});

test.each([
    ['sharing', false],
    ['regular', true]
])('a %s result shows both the human payout and the reserved bot share', async (mode, tieSplit) => {
    const room = await createRoom({ mode });
    const botId = `${battle.BOT_ID}:${room.id}:1`;
    const saved = { ...room, status: 'finished', finishedAt: Date.now(), mode, tie: tieSplit, tieSplit,
        players: [{ id: users[0] }, { id: botId, isBot: true, name: 'Bot' }],
        rounds: [{ caseId: room.caseIds[0], entries: [
            { userId: users[0], drop: { skinId: 'human-skin' }, value: '10000' },
            { userId: botId, drop: { skinId: 'bot-skin' }, value: '20000' }
        ] }], winners: [users[0], botId], payouts: { [users[0]]: '15000' }, payoutType: 'coins',
        unclaimedPayout: '15000', pool: '30000' };
    jest.spyOn(battle, 'readRoom').mockResolvedValue(saved);
    const refresh = interaction(users[0], `mg_hom_battle-refresh_${room.id}`);
    await ui.handle(refresh);
    const panel = payload(refresh);
    validPanel(panel);
    const payout = panel.embeds[0].data.fields.find(field => field.name === 'Chia thưởng bằng xu').value;
    expect(payout).toContain(`<@${users[0]}> · **${formatCoins(15000n)}**`);
    expect(payout).toContain(`Phần của Bot · **${formatCoins(15000n)}** · không cộng cho người chơi.`);
    expect(panel.embeds[0].data.description).toContain('Phần chia của Bot không cộng vào ví người chơi.');
    expect(panel.embeds[0].data.fields.find(field => field.name === 'Lãi/lỗ theo giá lúc mở').value)
        .toBe(`<@${users[0]}> · **Lời ${formatCoins(15000n - BigInt(saved.fee))}**`);
    expect(textOf(panel)).not.toContain(`<@${botId}>`);
});

test.each(['regular', 'crazy'])('a non-tied %s team win shows only the human share and its actual profit', async mode => {
    const room = await createRoom({ format: 'teams', mode });
    const teammate = `${battle.BOT_ID}:${room.id}:1`;
    const opponent = `${battle.BOT_ID}:${room.id}:2`;
    const values = mode === 'crazy' ? ['10000', '30000', '20000', '40000'] : ['30000', '10000', '40000', '20000'];
    const players = [{ id: users[0], team: 'A' }, { id: users[1], team: 'B' },
        { id: teammate, isBot: true, name: 'Bot', team: 'A' },
        { id: opponent, isBot: true, name: 'Bot', team: 'B' }];
    const saved = { ...room, status: 'finished', finishedAt: Date.now(), players,
        rounds: [{ caseId: room.caseIds[0], entries: players.map((player, index) => ({
            userId: player.id, drop: { skinId: `skin-${index}` }, value: values[index]
        })) }], winners: [users[0], teammate], payouts: { [users[0]]: '50000' }, payoutType: 'coins',
        unclaimedPayout: '50000', pool: '100000', tie: false, tieSplit: false };
    jest.spyOn(battle, 'readRoom').mockResolvedValue(saved);
    const refresh = interaction(users[0], `mg_hom_battle-refresh_${room.id}`);
    await ui.handle(refresh);
    const panel = payload(refresh);
    validPanel(panel);
    const fields = panel.embeds[0].data.fields;
    const payout = fields.find(field => field.name === 'Thưởng đội bằng xu').value;
    expect(payout).toBe(`<@${users[0]}> · Đội A · **${formatCoins(50000n)}**\n` +
        `🤖 Phần của Bot · **${formatCoins(50000n)}** · không cộng cho người chơi.`);
    expect(payout).not.toContain(`<@${users[0]}> · Đội A · **${formatCoins(100000n)}**`);
    expect(fields.find(field => field.name === 'Lãi/lỗ theo giá lúc mở').value)
        .toBe(`<@${users[0]}> · **Lời ${formatCoins(50000n - BigInt(saved.fee))}**\n` +
            `<@${users[1]}> · **Lỗ ${formatCoins(BigInt(saved.fee))}**`);
    expect(fields.find(field => field.name === 'Điểm theo đội').value).toBe(mode === 'crazy'
        ? `Đội A · **${formatCoins(30000n)}**\nĐội B · **${formatCoins(70000n)}**`
        : `Đội A · **${formatCoins(70000n)}**\nĐội B · **${formatCoins(30000n)}**`);
    expect(textOf(panel)).not.toContain(`<@${battle.BOT_ID}`);
});

test('saved results from before the bot-share fix keep their actual payout without inventing a bot deduction', async () => {
    const room = await createRoom({ mode: 'sharing' });
    const botId = `${battle.BOT_ID}:${room.id}:1`;
    const saved = { ...room, status: 'finished', finishedAt: Date.now(),
        players: [{ id: users[0] }, { id: botId, isBot: true, name: 'Bot' }],
        rounds: [{ caseId: room.caseIds[0], entries: [
            { userId: users[0], drop: { skinId: 'human-skin' }, value: '10000' },
            { userId: botId, drop: { skinId: 'bot-skin' }, value: '20000' }
        ] }], winners: [users[0], botId], payouts: { [users[0]]: '30000' }, payoutType: 'coins', pool: '30000' };
    const snapshot = JSON.stringify(saved);
    jest.spyOn(battle, 'readRoom').mockResolvedValue(saved);
    const refresh = interaction(users[0], `mg_hom_battle-refresh_${room.id}`);
    await ui.handle(refresh);
    const text = textOf(payload(refresh));
    expect(text).toContain(`<@${users[0]}> · **${formatCoins(30000n)}**`);
    expect(text).not.toContain('Phần của Bot');
    expect(text).not.toContain('Phần chia của Bot');
    expect(JSON.stringify(saved)).toBe(snapshot);
});

test('split ties show actual coin payouts and no claim that tied players received all skins', async () => {
    const room = await createRoom();
    const join = interaction(users[1], `mg_hom_battle-join_${room.id}`);
    await ui.handle(join);
    const panel = payload(join);
    validPanel(panel);
    const saved = (await disk.read(guild.id)).cs2Battles[room.id];
    expect(saved.tieSplit).toBe(true);
    expect(saved.payoutType).toBe('coins');
    const payouts = panel.embeds[0].data.fields.find(field => field.name === 'Chia thưởng bằng xu');
    for (const userId of users.slice(0, 2)) expect(payouts.value).toContain(`<@${userId}> · **${formatCoins(BigInt(saved.payouts[userId]))}**`);
    expect(textOf(panel)).not.toContain('skin vào kho');
    expect(textOf(panel)).toContain('Hòa điểm · Chia đều');
    expect(control(panel, 'recreate')).toBeDefined();
    expect(panel.attachments).toEqual([]);
});

test('a four-way tie lists pairwise 50/50 results with bounded controls and tie artwork', async () => {
    const room = await createRoom({ format: '4', tieRule: 'sudden-death' });
    for (const id of users.slice(1, 3)) await battle.actOnRoom(guild, channelId, room.id, id, 'join');
    const join = interaction(users[3], `mg_hom_battle-join_${room.id}`, { attachmentSizeLimit: 0 });
    await ui.handle(join);
    let panel = payload(join);
    validPanel(panel);
    const saved = (await disk.read(guild.id)).cs2Battles[room.id];
    expect(saved.tieBreaks).toHaveLength(3);
    const tieField = panel.embeds[0].data.fields.find(field => field.name === 'Hòa điểm · Vòng phụ');
    expect(tieField.value.match(/50\/50/g)).toHaveLength(3);
    for (const match of saved.tieBreaks) expect(tieField.value).toContain(`<@${match.left}> ↔ <@${match.right}>`);
    expect(panel.files).toBeUndefined();
    const refresh = interaction(users[0], `mg_hom_battle-refresh_${room.id}`, { attachmentSizeLimit: 4 });
    await ui.handle(refresh);
    panel = payload(refresh);
    expect(panel.files[0].name).toBe('cs2-tie.png');
    expect(panel.embeds[0].data.image.url).toBe('attachment://cs2-tie.png');
});

test('history pages remain private and recreation refreshes prices without posting or charging', async () => {
    const rooms = [];
    for (let index = 0; index < 6; index++) {
        const room = await createRoom({ mode: index % 2 ? 'crazy' : 'regular', tieRule: 'sudden-death' });
        rooms.push(room);
        await battle.actOnRoom(guild, channelId, room.id, users[0], 'cancel');
    }
    let panel = payload(await click(await builder(), 'settings'));
    panel = payload(await click(panel, 'history'));
    validPanel(panel);
    expect(control(panel, 'history-select').options).toHaveLength(5);
    expect(panel.embeds[0].data.footer.text).toContain('Trang 1/2');
    const stale = control(panel, 'history-select').custom_id;
    const next = controls(panel).filter(item => item.custom_id?.startsWith('mg_hom_battle-history-page_')).at(-1);
    const request = interaction(users[0], next.custom_id);
    await ui.handle(request);
    panel = payload(request);
    validPanel(panel);
    expect(control(panel, 'history-select').options).toHaveLength(1);
    expect(panel.embeds[0].data.footer.text).toContain('Trang 2/2');
    const staleRequest = interaction(users[0], stale, { values: [rooms[0].id] });
    await ui.handle(staleRequest);
    expect(staleRequest.editReply).not.toHaveBeenCalled();
    expect(staleRequest.reply).toHaveBeenCalled();
    panel = payload(await click(panel, 'history-select', [rooms[0].id]));
    validPanel(panel);
    expect(control(panel, 'history-use')).toBeDefined();
    const before = await disk.read(guild.id);
    market.peekMarketQuote.mockReturnValue({ priceVnd: 200 });
    panel = payload(await click(panel, 'history-use'));
    validPanel(panel);
    expect(panel.embeds[0].data.fields.find(field => field.name === 'Phí Battle mỗi người').value)
        .toBe(formatCoins(casePricing(customCases[0]).fee));
    expect(panel.embeds[0].data.footer.text).toContain('chưa trừ xu');
    const after = await disk.read(guild.id);
    expect(after.cs2Battles).toEqual(before.cs2Battles);
    expect(after.taixiu).toEqual(before.taixiu);
    const ownBuilder = interaction(users[1], 'mg_hom_battle-new_crate-4904');
    await ui.handle(ownBuilder);
    const settings = payload(await click(payload(ownBuilder), 'settings', undefined, {}, users[1]));
    const history = payload(await click(settings, 'history', undefined, {}, users[1]));
    expect(control(history, 'history-select')).toBeUndefined();
    expect(textOf(history)).not.toContain(rooms[0].id);
    const forged = interaction(users[1], `mg_hom_battle-history-select_${ownBuilder.id}_3`, { values: [rooms[0].id] });
    await ui.handle(forged);
    expect(control(payload(forged), 'history-use')).toBeUndefined();
});

test('the public recreate control accepts participants and converts legacy fast history to full without changing the original result', async () => {
    const room = await createRoom({ animationMode: 'full', tieRule: 'sudden-death' });
    const join = interaction(users[1], `mg_hom_battle-join_${room.id}`);
    await ui.handle(join);
    await disk.transact(guild.id, async (state, save) => {
        state.cs2Battles[room.id].animationMode = 'fast';
        for (const entries of Object.values(state.cs2BattleHistory)) {
            const entry = entries.find(record => record.id === room.id);
            if (entry) entry.animationMode = 'fast';
        }
        await save();
    });
    const before = await disk.read(guild.id);
    const outsider = await click(payload(join), 'recreate', undefined, {}, users[2]);
    expect(outsider.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(payload(outsider).content).toContain('Chỉ người tham gia');
    const remake = await click(payload(join), 'recreate', undefined, {}, users[1]);
    expect(remake.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    const panel = payload(remake);
    validPanel(panel);
    expect(control(panel, 'publish')).toBeDefined();
    expect(textOf(panel)).toContain('50/50');
    expect(textOf(panel)).toContain('Đầy đủ');
    expect(textOf(panel)).not.toContain('Nhanh');
    expect((await disk.read(guild.id))).toEqual(before);
});

test('history does not report a loss for a user who left before others started the match', async () => {
    const room = await createRoom({ format: '3' });
    await battle.actOnRoom(guild, channelId, room.id, users[1], 'join');
    await battle.actOnRoom(guild, channelId, room.id, users[1], 'leave');
    const before = await disk.read(guild.id);
    await battle.actOnRoom(guild, channelId, room.id, users[2], 'join');
    await battle.actOnRoom(guild, channelId, room.id, users[3], 'join');
    const after = await disk.read(guild.id);
    expect(after.cs2Battles[room.id].status).toBe('finished');
    expect(after.taixiu.balances[users[1]]).toBe(before.taixiu.balances[users[1]]);
    const open = interaction(users[1], 'mg_hom_battle-new_crate-4904');
    await ui.handle(open);
    let panel = payload(await click(payload(open), 'settings', undefined, {}, users[1]));
    panel = payload(await click(panel, 'history', undefined, {}, users[1]));
    panel = payload(await click(panel, 'history-select', [room.id], {}, users[1]));
    validPanel(panel);
    expect(panel.embeds[0].data.fields.find(field => field.name === 'Kết quả của bạn theo giá lúc mở').value)
        .toBe('Bạn đã rời phòng trước khi trận bắt đầu; không bị trừ phí.');
});

test('case pictures respect zero attachment limits and switching to settings clears the previous image', async () => {
    const fallback = await builder();
    expect(fallback.files).toBeUndefined();
    expect(fallback.embeds[0].data.thumbnail.url).toMatch(/^https:/);
    const picture = await builder({ attachmentSizeLimit: 4 });
    expect(picture.files).toHaveLength(1);
    expect(picture.attachments).toEqual([]);
    const settings = payload(await click(picture, 'settings'));
    expect(settings.files).toBeUndefined();
    expect(settings.attachments).toEqual([]);
    expect(settings.embeds[0].data.image).toBeUndefined();
});

const attachedMessage = (name, id = '9001', messageId = 'builder-message') => ({
    id: messageId, attachments: new Map([[id, { id, name }]])
});

test('builder edits retain the same immutable cover and upload a changed cover', async () => {
    const first = await builder({ attachmentSizeLimit: 4 });
    const originalName = first.files[0].name;
    const message = attachedMessage(originalName);
    const same = payload(await click(first, 'add', undefined, { attachmentSizeLimit: 4, message }));
    expect(same.files).toBeUndefined();
    expect(same.attachments).toEqual([{ id: '9001', filename: originalName }]);
    expect(same.embeds[0].data.image.url).toBe(`attachment://${originalName}`);

    const nextCase = control(same, 'preview').options.find(option => !option.default && !['previous', 'next'].includes(option.value));
    const changed = payload(await click(same, 'preview', [nextCase.value], { attachmentSizeLimit: 4, message }));
    expect(changed.files[0].name).toBe(`cs2-${nextCase.value}.png`);
    expect(changed.attachments).toEqual([]);
});

test('opening the builder can retain its current cover but a zero budget clears it', async () => {
    const name = `cs2-${customCases[0].id}.png`;
    const message = attachedMessage(name);
    const existing = await builder({ attachmentSizeLimit: 4, message });
    expect(existing.files).toBeUndefined();
    expect(existing.attachments).toEqual([{ id: '9001', filename: name }]);
    const noFiles = await builder({ attachmentSizeLimit: 0, message });
    expect(noFiles.files).toBeUndefined();
    expect(noFiles.attachments).toEqual([]);
    expect(noFiles.embeds[0].data.image).toBeUndefined();
});

test.each([false, true])('a rejected retained cover retries its file before remote fallback=%s', async rejectUpload => {
    const panel = await builder({ attachmentSizeLimit: 4 });
    const invalid = Object.assign(new Error('Invalid attachment'), { code: 50035 });
    const editReply = jest.fn().mockRejectedValueOnce(invalid);
    if (rejectUpload) editReply.mockRejectedValueOnce(Object.assign(new Error('File too large'), { code: 40005 }));
    editReply.mockResolvedValue({});
    const request = await click(panel, 'add', undefined, {
        attachmentSizeLimit: 4, message: attachedMessage(panel.files[0].name), editReply
    });
    expect(editReply.mock.calls[0][0].files).toBeUndefined();
    expect(editReply.mock.calls[0][0].attachments[0].id).toBe('9001');
    expect(editReply.mock.calls[1][0].files[0].name).toBe(panel.files[0].name);
    expect(editReply.mock.calls[1][0].attachments).toEqual([]);
    expect(editReply).toHaveBeenCalledTimes(rejectUpload ? 3 : 2);
    if (rejectUpload) {
        expect(payload(request).files).toBeUndefined();
        expect(payload(request).embeds[0].data.image).toBeUndefined();
        expect(payload(request).embeds[0].data.thumbnail.url).toBe(customCases[0].image);
    }
});

test('an unrelated retained-cover failure propagates without retrying an upload', async () => {
    const panel = await builder({ attachmentSizeLimit: 4 });
    const failure = Object.assign(new Error('Missing permissions'), { code: 50013 });
    const editReply = jest.fn().mockRejectedValue(failure);
    await expect(click(panel, 'add', undefined, {
        attachmentSizeLimit: 4, message: attachedMessage(panel.files[0].name), editReply
    })).rejects.toBe(failure);
    expect(editReply).toHaveBeenCalledTimes(1);
});

test('publishing a room uploads its cover independently of the builder attachment', async () => {
    let panel = await builder({ attachmentSizeLimit: 4 });
    const message = attachedMessage(panel.files[0].name);
    panel = payload(await click(panel, 'add', undefined, { attachmentSizeLimit: 4, message }));
    const send = jest.fn().mockResolvedValue({ id: 'public-room', url: 'https://example.com/room' });
    await click(panel, 'publish', undefined, { attachmentSizeLimit: 4, message, channel: { isSendable: () => true, send } });
    expect(send.mock.calls[0][0].files[0].name).toBe(`cs2-${customCases[0].id}.png`);
    expect(send.mock.calls[0][0].attachments).toEqual([]);
});

test('recreating a room uploads into the new reply instead of retaining the source cover', async () => {
    const room = await createRoom();
    jest.spyOn(battle, 'getRecreateConfig').mockResolvedValue({ ...room, status: 'finished' });
    const name = `cs2-${customCases[0].id}.png`;
    const request = interaction(users[0], `mg_hom_battle-recreate_${room.id}`, {
        attachmentSizeLimit: 4, message: attachedMessage(name, 'source-cover', 'source-room')
    });
    await ui.handle(request);
    expect(request.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(payload(request).files[0].name).toBe(name);
    expect(payload(request).attachments).toEqual([]);
});

test('solo loading uses the remote thumbnail without uploading a cover', async () => {
    const showResult = jest.fn();
    const soloUi = createBattleUi({ rollDrop: jest.fn(), dropName: () => 'Skin', dropImage: () => '', showResult,
        reelRound: () => ({ cards: [{}], selectedIndex: 0, result: {} }) });
    const request = interaction(users[0], 'mg_hom_battle-new_crate-4904', { attachmentSizeLimit: 4 });
    await soloUi.handle(request);
    const drop = customCases[0].entries[0].drop;
    jest.spyOn(battle, 'openSolo').mockResolvedValue({ status: 'opened', drop, entries: customCases[0].entries, fee: 1n, value: 1n });
    jest.spyOn(reel, 'renderCaseReel').mockResolvedValue(null);
    const open = interaction(users[0], control(payload(request), 'solo').custom_id, { attachmentSizeLimit: 4 });
    await soloUi.handle(open);
    expect(open.editReply).toHaveBeenCalledTimes(1);
    expect(payload(open).files).toBeUndefined();
    expect(payload(open).attachments).toEqual([]);
    expect(payload(open).embeds[0].data.thumbnail.url).toBe(customCases[0].image);
    expect(showResult).toHaveBeenCalledWith(open, drop, expect.any(String));
});

test('refreshing a waiting room retains the cover already on that room message', async () => {
    const room = await createRoom();
    const name = `cs2-${customCases[0].id}.png`;
    const refresh = interaction(users[0], `mg_hom_battle-refresh_${room.id}`, {
        attachmentSizeLimit: 4, message: attachedMessage(name, 'room-cover', 'public-room')
    });
    await ui.handle(refresh);
    expect(payload(refresh).files).toBeUndefined();
    expect(payload(refresh).attachments).toEqual([{ id: 'room-cover', filename: name }]);
});

test.each(['same-message', 'different-message', 'expired-webhook'])('result pages use attachment IDs only from their target: %s', async route => {
    const room = await createRoom({ tieRule: 'sudden-death' });
    await battle.actOnRoom(guild, channelId, room.id, users[1], 'join');
    const finished = await battle.readRoom(guild.id, channelId, room.id);
    expect(finished.tieBreaks).not.toHaveLength(0);
    jest.spyOn(battle, 'readRoom').mockResolvedValue({ ...finished, pendingResultMessageId: 'saved-result' });
    const edit = jest.fn().mockResolvedValue({});
    const refresh = interaction(users[0], `mg_hom_battle-result-page_${room.id}_0`, {
        attachmentSizeLimit: 4,
        message: attachedMessage('cs2-tie.png', 'tie-cover', route === 'different-message' ? 'another-result' : 'saved-result'),
        channel: { messages: { edit } }
    });
    if (route === 'expired-webhook') refresh.editReply.mockRejectedValue(Object.assign(new Error('Unknown webhook'), { code: 10015 }));
    await ui.handle(refresh);
    const view = route === 'expired-webhook' ? edit.mock.calls[0][1] : payload(refresh);
    if (route === 'different-message') {
        expect(view.files[0].name).toBe('cs2-tie.png');
        expect(view.attachments).toEqual([]);
    } else {
        expect(view.files).toBeUndefined();
        expect(view.attachments).toEqual([{ id: 'tie-cover', filename: 'cs2-tie.png' }]);
    }
    if (route === 'expired-webhook') expect(edit.mock.calls[0][0]).toBe('saved-result');
});

test('a changed solo price refreshes the displayed fee immediately inside the catalogue cache window', async () => {
    let panel = await builder();
    panel = payload(await click(panel, 'add'));
    const before = await disk.read(guild.id);
    market.peekMarketQuote.mockReturnValue({ priceVnd: 200 });
    const request = await click(panel, 'solo');
    const repriced = payload(request);
    expect(repriced.embeds[0].data.footer.text).toContain('Giá đã đổi');
    expect(repriced.embeds[0].data.fields.find(field => field.name === 'Phí Battle mỗi người').value)
        .toBe(formatCoins(casePricing(customCases[0]).fee));
    expect((await disk.read(guild.id)).taixiu).toEqual(before.taixiu);
    expect((await disk.read(guild.id)).skinCases).toEqual(before.skinCases);
});

test('a rejected case attachment retries the builder and public room with the remote image', async () => {
    const fileTooLarge = Object.assign(new Error('Request entity too large'), { code: 40005, status: 413 });
    const editReply = jest.fn().mockRejectedValueOnce(fileTooLarge).mockResolvedValue({});
    const open = interaction(users[0], 'mg_hom_battle-new_crate-4904', { attachmentSizeLimit: 4, editReply });
    await ui.handle(open);
    expect(editReply).toHaveBeenCalledTimes(2);
    const fallback = payload(open);
    expect(fallback.files).toBeUndefined();
    expect(fallback.attachments).toEqual([]);
    expect(fallback.embeds[0].data.image).toBeUndefined();
    expect(fallback.embeds[0].data.thumbnail.url).toBe(customCases[0].image);
    const panel = payload(await click(fallback, 'add', undefined, { attachmentSizeLimit: 4 }));
    const send = jest.fn().mockRejectedValueOnce(fileTooLarge).mockResolvedValue({ url: 'https://example.com/room' });
    await click(panel, 'publish', undefined, { attachmentSizeLimit: 4, channel: { isSendable: () => true, send } });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].files).toBeUndefined();
    expect(send.mock.calls[1][0].embeds[0].data.thumbnail.url).toBe(customCases[0].image);
    const rooms = Object.values((await disk.read(guild.id)).cs2Battles);
    expect(rooms).toHaveLength(1);
    expect(rooms[0].status).toBe('waiting');
});

test('saved sudden-death matchups animate the matching side once and do not charge on refresh', async () => {
    const room = await createRoom({ format: '3', tieRule: 'sudden-death' });
    await battle.actOnRoom(guild, channelId, room.id, users[1], 'join');
    const views = [];
    const editReply = jest.fn(async panel => { views.push({ ...panel, embeds: panel.embeds.map(embed => embed.toJSON()) }); });
    const renderUi = createBattleUi({ rollDrop: jest.fn(), dropName: drop => `Skin ${drop.skinId}`,
        dropImage: () => 'https://example.com/skin.png', showResult: jest.fn(), reelRound: jest.fn(), shuttingDown: () => false });
    // Skip normal case rendering while allowing the saved tie GIFs to use the attachment budget.
    const reel = require('../utils/cs2Reel');
    jest.spyOn(reel, 'renderCaseBatch').mockResolvedValue(null);
    const join = interaction(users[2], `mg_hom_battle-join_${room.id}`, { attachmentSizeLimit: 4, editReply,
        message: { id: 'tie-room', attachments: new Map(['left', 'right'].map((side, index) => [String(index), {
            id: String(index), name: `cs2-tie-${side}.gif`
        }])) } });
    await renderUi.handle(join);
    const before = await disk.read(guild.id);
    const settled = before.cs2Battles[room.id];
    expect(settled.tieBreaks).toHaveLength(2);
    const spins = views.filter(view => view.files?.[0].name.endsWith('.gif'));
    expect(spins).toHaveLength(2);
    for (const [index, match] of settled.tieBreaks.entries()) {
        const side = match.winner === match.left ? 'left' : 'right';
        expect(spins[index].files[0].name).toBe(`cs2-tie-${side}.gif`);
        expect(spins[index].embeds[0].description).toContain(`🔵 **<@${match.left}>**`);
        expect(spins[index].embeds[0].description).toContain(`🔴 **<@${match.right}>**`);
        expect(spins[index].embeds[0].description).toContain('Không thu thêm xu');
    }
    expect(views.filter(view => view.embeds[0].fields?.some(field => field.name === 'Qua vòng phụ'))).toHaveLength(2);
    expect(views.at(-1).embeds[0].title).toBe('🏆 Kết quả Case Battle');
    const calls = art.getBattleTieAnimation.mock.calls.length;
    await renderUi.handle(interaction(users[0], `mg_hom_battle-refresh_${room.id}`, { attachmentSizeLimit: 4 }));
    expect(art.getBattleTieAnimation).toHaveBeenCalledTimes(calls);
    expect((await disk.read(guild.id)).taixiu).toEqual(before.taixiu);
    expect((await disk.read(guild.id)).skinCases).toEqual(before.skinCases);
});
