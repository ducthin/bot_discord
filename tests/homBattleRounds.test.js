const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { MessageFlags } = require('discord.js');
const store = require('../utils/managementStore');
const market = require('../utils/cs2Market');
const reel = require('../utils/cs2Reel');
const battle = require('../utils/cs2Battles');
const { customCases, casePricing, lockCasePricing, riskMetrics } = require('../utils/cs2BattleCases');
const { createBattleUi, DRAFT_TTL } = require('../utils/cs2BattleUi');
const { readCoins, formatCoins } = require('../utils/coins');

const guild = { id: '1' };
const players = ['101', '102', '103', '104'];
const channelId = '20';
let directory;
let disk;
let nextId = 5000;
let ui;

beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-battle-rounds-'));
    disk = store.createManagementStore(directory);
    jest.spyOn(store, 'read').mockImplementation(disk.read);
    jest.spyOn(store, 'transact').mockImplementation(disk.transact);
    jest.spyOn(market, 'peekMarketQuote').mockReturnValue({ priceVnd: 100 });
    jest.spyOn(crypto, 'randomInt').mockImplementation((min, max) => max == null ? 0 : min);
    jest.spyOn(reel, 'renderCaseBatch').mockResolvedValue(null);
    ui = createBattleUi({
        rollDrop: jest.fn(), dropName: drop => 'Skin ' + drop.skinId + 'x'.repeat(100),
        dropImage: () => 'https://example.com/skin.png', showResult: jest.fn(),
        reelRound: () => ({ cards: [{ mystery: false }], selectedIndex: 0, result: {} })
    });
    await disk.transact(guild.id, async (state, save) => {
        state.taixiu.balances = Object.fromEntries(players.map(id => [id, 500_000]));
        await save();
    });
});

afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(directory, { recursive: true, force: true });
});

function interaction(userId, customId, extra = {}) {
    return { id: String(++nextId), guild, guildId: guild.id, channelId, user: { id: userId }, customId,
        reply: jest.fn(), deferReply: jest.fn(), deferUpdate: jest.fn(), editReply: jest.fn(), followUp: jest.fn(), showModal: jest.fn(), ...extra };
}

const last = request => request.editReply.mock.calls.at(-1)[0];
const controls = payload => payload.components.flatMap(row => row.toJSON().components);
const control = (payload, action) => controls(payload).find(item => item.custom_id?.startsWith(`mg_hom_battle-${action}_`));

async function create(caseIds, options = {}) {
    const expectedPrices = Object.fromEntries([...new Set(caseIds)].map(id => [id, lockCasePricing(casePricing(customCases.find(item => item.id === id)))]));
    return battle.createRoom(guild.id, { id: String(++nextId), channelId, hostId: players[0], caseIds, format: '4', mode: 'regular', expectedPrices, ...options });
}

function validPayload(payload) {
    expect(payload.components.length).toBeLessThanOrEqual(5);
    for (const row of payload.components) {
        const data = row.toJSON();
        expect(data.components.length).toBeLessThanOrEqual(5);
        for (const component of data.components) if (component.options) expect(component.options.length).toBeLessThanOrEqual(25);
    }
    let total = 0;
    for (const embed of payload.embeds) {
        const data = embed.toJSON();
        expect(data.fields?.length ?? 0).toBeLessThanOrEqual(25);
        expect(data.description?.length ?? 0).toBeLessThanOrEqual(4096);
        total += (data.title?.length ?? 0) + (data.description?.length ?? 0) + (data.footer?.text.length ?? 0);
        for (const field of data.fields ?? []) {
            expect(field.name.length).toBeLessThanOrEqual(256);
            expect(field.value.length).toBeLessThanOrEqual(1024);
            total += field.name.length + field.value.length;
        }
    }
    expect(total).toBeLessThanOrEqual(6000);
}

test('the builder derives rounds and fees from case quantities and edits the schedule', async () => {
    let request = interaction(players[0], 'mg_hom_battle-new_crate-4904');
    await ui.handle(request);
    const initial = last(request);
    const pricing = casePricing(customCases[0]);
    const quantity = interaction(players[0], control(initial, 'quantity').custom_id);
    await ui.handle(quantity);
    const modal = quantity.showModal.mock.calls[0][0].toJSON();
    expect(battle.ROUND_LIMIT).toBe(100);
    expect(modal.components[0].components[0]).toMatchObject({ label: 'Số lượng từ 1 đến 100', max_length: 3 });
    const submit = interaction(players[0], modal.custom_id, { fields: { getTextInputValue: () => '100' } });
    await ui.handle(submit);
    request = interaction(players[0], control(last(submit), 'add').custom_id);
    await ui.handle(request);
    const full = last(request);
    validPayload(full);
    expect(full.embeds[0].data.fields.find(field => field.name.startsWith('Số vòng')).name).toContain('100/100');
    expect(full.embeds[0].data.fields.find(field => field.name === 'Phí Battle mỗi người').value).toBe(formatCoins(pricing.fee * 100n));
    expect(control(full, 'add').disabled).toBe(true);
    const schedule = interaction(players[0], control(full, 'schedule').custom_id);
    await ui.handle(schedule);
    validPayload(last(schedule));
    expect(last(schedule).embeds[0].data.description).toContain('100 hòm = **100 vòng**');
    const remove = interaction(players[0], control(last(schedule), 'remove').custom_id);
    await ui.handle(remove);
    expect(last(remove).embeds[0].data.description).toContain('99 hòm = **99 vòng**');
    const clear = interaction(players[0], control(last(remove), 'clear-case').custom_id);
    await ui.handle(clear);
    expect(last(clear).embeds[0].data.fields.find(field => field.name.startsWith('Số vòng')).name).toContain('0/100');
    expect(control(last(clear), 'publish').disabled).toBe(true);
});

test('100 rounds settle once at the full locked fee, and result pages and restore remain valid', async () => {
    const ids = Array.from({ length: 100 }, (_, index) => customCases[index % customCases.length].id);
    const { room } = await create(ids);
    expect(room.caseIds).toHaveLength(100);
    ids.pop();
    expect(room.caseIds).toHaveLength(100);
    for (const user of players.slice(1, -1)) await battle.actOnRoom(guild, channelId, room.id, user, 'join');
    const finalJoin = interaction(players[3], `mg_hom_battle-join_${room.id}`, { message: { id: 'message-1' }, attachmentSizeLimit: 1_000_000 });
    await ui.handle(finalJoin);
    expect(reel.renderCaseBatch).toHaveBeenCalledTimes(100);
    const settled = await disk.read(guild.id);
    expect(settled.cs2Battles[room.id].rounds).toHaveLength(100);
    expect(settled.cs2Battles[room.id]).toMatchObject({ payoutType: 'coins', tieSplit: true, winners: players });
    expect(settled.skinCases).toBeUndefined();
    for (const player of players) expect(readCoins(settled.taixiu.balances[player])).toBe(50_000_000n - BigInt(room.fee) + 1_000_000n);
    expect(await battle.actOnRoom(guild, channelId, room.id, players[3], 'join')).not.toHaveProperty('started');
    let payload = last(finalJoin);
    for (let page = 0; page < 25; page++) {
        validPayload(payload);
        expect(payload.embeds[0].data.fields.find(field => field.name.startsWith('Vòng ')).name).toMatch(new RegExp(`^Vòng ${page * 4 + 1} ·`));
        if (page < 24) {
            const next = interaction(players[0], control(payload, 'result-page').custom_id.replace(/_-?\d+$/, `_${page + 1}`));
            await ui.handle(next);
            payload = last(next);
        }
    }
    await disk.transact(guild.id, async (state, save) => { state.cs2Battles[room.id].pendingResultMessageId = 'message-1'; await save(); });
    const edit = jest.fn();
    await ui.restoreResults({ ...guild, channels: { fetch: jest.fn().mockResolvedValue({ messages: { edit } }) } });
    validPayload(edit.mock.calls[0][1]);
    const restored = await disk.read(guild.id);
    expect(restored.skinCases).toEqual(settled.skinCases);
    expect(restored.taixiu).toEqual(settled.taixiu);
    expect(await battle.pendingResults(guild.id)).toEqual([]);
}, 30_000);

test('large room odds and ordered schedules paginate without losing cases or exceeding Discord limits', async () => {
    const ids = customCases.slice(-battle.ROUND_LIMIT).map(item => item.id);
    const { room } = await create(ids);
    const first = interaction(players[0], `mg_hom_battle-room-odds_${room.id}`);
    await ui.handle(first);
    validPayload(last(first));
    const menu = control(last(first), 'room-odds-case');
    expect(menu.options).toHaveLength(24);
    const allOptions = [...menu.options];
    let nextMenu = menu;
    while (nextMenu.options.some(option => option.label === 'Các hòm sau →')) {
        const nextOption = nextMenu.options.find(option => option.label === 'Các hòm sau →');
        const next = interaction(players[0], nextMenu.custom_id, { values: [nextOption.value] });
        await ui.handle(next);
        validPayload(last(next));
        nextMenu = control(last(next), 'room-odds-case');
        allOptions.push(...nextMenu.options);
    }
    const allIds = new Set(allOptions.filter(option => !option.label.includes('→') && !option.label.includes('←')).map(option => option.value));
    expect(allIds).toEqual(new Set(ids));
    const schedule = interaction(players[0], `mg_hom_battle-room-schedule_${room.id}_0`);
    await ui.handle(schedule);
    expect(schedule.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    let panel = last(schedule);
    const observed = [];
    for (let page = 0; page < ids.length; page++) {
        validPayload(panel);
        expect(panel.embeds[0].data.footer.text).toContain(`Trang ${page + 1}/${ids.length}`);
        expect(panel.embeds[0].data.description).toBe(`${page + 1}. ${battle.getBattleCase(ids[page]).name}`);
        observed.push(panel.embeds[0].data.description);
        const next = controls(panel).find(item => item.label === 'Trang sau');
        expect(next.disabled).toBe(page === ids.length - 1);
        if (next.disabled) break;
        const request = interaction(players[0], next.custom_id, { message: { flags: { has: () => true } } });
        await ui.handle(request);
        expect(request.deferUpdate).toHaveBeenCalled();
        panel = last(request);
    }
    expect(observed).toEqual(ids.map((id, index) => `${index + 1}. ${battle.getBattleCase(id).name}`));
}, 30_000);

test('full animation is mandatory, legacy fast input normalizes and invalid configurations cannot create rooms', async () => {
    const open = interaction(players[0], 'mg_hom_battle-new_crate-4904');
    await ui.handle(open);
    const settings = interaction(players[0], control(last(open), 'settings').custom_id);
    await ui.handle(settings);
    expect(control(last(settings), 'animation')).toBeUndefined();
    expect(last(settings).embeds[0].data.description).toContain('Đầy đủ · phát từng vòng');
    expect(JSON.stringify(last(settings).embeds[0].toJSON())).not.toContain('Nhanh');
    const before = await disk.read(guild.id);
    expect(await create(Array(101).fill(customCases[0].id))).toHaveProperty('error');
    expect(await disk.read(guild.id)).toEqual(before);
    expect(await create(null)).toHaveProperty('error');
    expect(await create([customCases[0].id], { animationMode: 'invalid' })).toHaveProperty('error');
    const { room } = await create(Array(6).fill(customCases[0].id), { format: '2', animationMode: 'fast' });
    expect(room.animationMode).toBe('full');
    await disk.transact(guild.id, async (state, save) => {
        state.cs2Battles[room.id].animationMode = 'fast';
        await save();
    });
    expect((await battle.readRoom(guild.id, channelId, room.id)).animationMode).toBe('full');
    const join = interaction(players[1], `mg_hom_battle-join_${room.id}`, { attachmentSizeLimit: 1_000_000 });
    await ui.handle(join);
    expect(reel.renderCaseBatch).toHaveBeenCalledTimes(6);
    expect((await battle.getHistoryConfig(guild.id, players[0], room.id)).animationMode).toBe('full');
});

test('clear all removes every scheduled case and disables publishing', async () => {
    const open = interaction(players[0], 'mg_hom_battle-new_crate-4904');
    await ui.handle(open);
    const first = interaction(players[0], control(last(open), 'add').custom_id);
    await ui.handle(first);
    const other = customCases.find(item => item.group === customCases[0].group && item.id !== customCases[0].id);
    const choose = interaction(players[0], control(last(first), 'preview').custom_id, { values: [other.id] });
    await ui.handle(choose);
    const second = interaction(players[0], control(last(choose), 'add').custom_id);
    await ui.handle(second);
    const schedule = interaction(players[0], control(last(second), 'schedule').custom_id);
    await ui.handle(schedule);
    const clear = interaction(players[0], control(last(schedule), 'clear-all').custom_id);
    await ui.handle(clear);
    validPayload(last(clear));
    expect(last(clear).embeds[0].data.fields.find(field => field.name.startsWith('Số vòng')).name).toContain('0/100');
    expect(control(last(clear), 'publish').disabled).toBe(true);
});

test('full 100-round animation continues through token expiry and publishes the saved result once', async () => {
    const { room } = await create(Array(100).fill(customCases[0].id), { format: '2', animationMode: 'full' });
    jest.replaceProperty(reel, 'REEL_PLAYBACK_MS', 0);
    reel.renderCaseBatch.mockResolvedValue({ gif: Buffer.from('gif') });
    const editMessage = jest.fn();
    const tokenExpired = Object.assign(new Error('Unknown Webhook'), { code: 10015 });
    const editReply = jest.fn().mockResolvedValueOnce({}).mockRejectedValue(tokenExpired);
    const join = interaction(players[1], `mg_hom_battle-join_${room.id}`, {
        message: { id: 'message-full' }, attachmentSizeLimit: 1_000_000, editReply,
        channel: { messages: { edit: editMessage } }
    });
    await ui.handle(join);
    expect(reel.renderCaseBatch).toHaveBeenCalledTimes(100);
    expect(editReply).toHaveBeenCalledTimes(2);
    expect(editMessage).toHaveBeenCalledTimes(101);
    expect(editMessage.mock.calls.every(([id]) => id === 'message-full')).toBe(true);
    expect(editMessage.mock.calls.filter(([, payload]) => payload.files)).toHaveLength(100);
    expect(editMessage.mock.calls.at(-1)[1].embeds[0].data.title).toBe('🏆 Kết quả Case Battle');
    const settled = await disk.read(guild.id);
    expect(settled.cs2Battles[room.id].rounds).toHaveLength(100);
    expect(settled.cs2Battles[room.id]).toMatchObject({ payoutType: 'coins', tieSplit: true });
    expect(settled.skinCases).toBeUndefined();
    expect(await battle.pendingResults(guild.id)).toEqual([]);
    await ui.handle(interaction(players[1], `mg_hom_battle-join_${room.id}`));
    const repeated = await disk.read(guild.id);
    expect(repeated.skinCases).toEqual(settled.skinCases);
    expect(repeated.taixiu).toEqual(settled.taixiu);
    expect(reel.renderCaseBatch).toHaveBeenCalledTimes(100);
});

test('active drafts renew expiry and a failed panel edit does not advance its state or revision', async () => {
    let now = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const open = interaction(players[0], 'mg_hom_battle-new_crate-4904');
    await ui.handle(open);
    now += 45_000;
    const first = interaction(players[0], control(last(open), 'add').custom_id);
    await ui.handle(first);
    now += 45_000;
    const id = control(last(first), 'add').custom_id;
    const failed = interaction(players[0], id, { editReply: jest.fn().mockRejectedValue(new Error('Discord unavailable')) });
    await expect(ui.handle(failed)).rejects.toThrow('Discord unavailable');
    const retry = interaction(players[0], id);
    await ui.handle(retry);
    expect(last(retry).embeds[0].data.fields.find(field => field.name.startsWith('Số vòng')).name).toContain('2/100');
    expect(retry.reply).not.toHaveBeenCalled();
    const state = await disk.read(guild.id);
    now += DRAFT_TTL + 1;
    const expired = interaction(players[0], control(last(retry), 'add').custom_id);
    await ui.handle(expired);
    expect(expired.reply).toHaveBeenCalled();
    expect(expired.editReply).not.toHaveBeenCalled();
    expect(await disk.read(guild.id)).toEqual(state);
});

test('risk filters show only matching cases and disclose risk and loss odds', async () => {
    const open = interaction(players[0], 'mg_hom_battle-new_crate-4904');
    await ui.handle(open);
    expect(last(open).embeds[0].data.description).toContain('Rủi ro: **Rất cao**');
    expect(control(last(open), 'group').options).toContainEqual(expect.objectContaining({ value: 'risk-extreme' }));
    const filter = interaction(players[0], control(last(open), 'group').custom_id, { values: ['risk-extreme'] });
    await ui.handle(filter);
    validPayload(last(filter));
    const options = control(last(filter), 'preview').options.filter(option => option.value !== 'next' && option.value !== 'previous');
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) expect(riskMetrics(casePricing(customCases.find(item => item.id === option.value))).riskLevel).toBe('extreme');
});

function largeResult({ roundCount = 12, mode = 'sharing' } = {}) {
    const ids = Array.from({ length: 10 }, (_, index) => String(1234567890123456700n + BigInt(index)));
    const caseId = customCases[0].id;
    const amount = '100000000000000000000000000000';
    return { id: 'budget-room', channelId, hostId: ids[0], format: 'custom', playerLimit: 10, mode,
        tieRule: 'split', status: 'finished', createdAt: Date.now(), finishedAt: Date.now(), fee: amount,
        players: ids.map(id => ({ id })), winners: mode === 'sharing' ? ids : [ids[0]],
        payoutType: mode === 'sharing' ? 'coins' : 'skins',
        payouts: mode === 'sharing' ? Object.fromEntries(ids.map(id => [id, amount])) : {},
        caseIds: Array(roundCount).fill(caseId), pool: amount,
        rounds: Array.from({ length: roundCount }, (_, index) => ({ caseId,
            entries: ids.map(userId => ({ userId, value: amount,
                drop: { skinId: `round-${index + 1}-${userId}`, float: 0.123456 } })) })) };
}

test('100-round ten-player results fit the total embed budget and paginate every round and seat', async () => {
    const result = largeResult({ roundCount: 100 });
    jest.spyOn(battle, 'readRoom').mockResolvedValue(result);
    let request = interaction(result.hostId, `mg_hom_battle-refresh_${result.id}`, { attachmentSizeLimit: 0 });
    await ui.handle(request);
    const observed = new Set();
    let pageCount = 0;
    for (;;) {
        const panel = last(request);
        validPayload(panel);
        for (const field of panel.embeds[0].data.fields) {
            const round = /^Vòng (\d+) ·/.exec(field.name)?.[1];
            if (!round) continue;
            for (const { id } of result.players) if (field.value.includes(`<@${id}>`)) {
                const key = `${round}/${id}`;
                expect(observed.has(key)).toBe(false);
                observed.add(key);
            }
        }
        pageCount++;
        expect(pageCount).toBeLessThanOrEqual(100);
        const next = controls(panel).find(item => item.label === 'Vòng sau');
        if (!next || next.disabled) break;
        request = interaction(result.hostId, next.custom_id, { attachmentSizeLimit: 0 });
        await ui.handle(request);
    }
    expect(pageCount).toBeGreaterThan(3);
    expect(observed.size).toBe(result.rounds.length * result.players.length);
});

test('ten-way sudden-death ties split their full bracket into valid fields in results and history', async () => {
    const result = largeResult({ roundCount: 4, mode: 'regular' });
    result.tie = true;
    result.tieRule = 'sudden-death';
    result.tieBreaks = [];
    result.tieBracket = { byes: [] };
    let remaining = result.players.map(player => player.id);
    let round = 0;
    while (remaining.length > 1) {
        round++;
        const next = [];
        for (let index = 0; index < remaining.length; index += 2) {
            const left = remaining[index];
            const right = remaining[index + 1];
            if (!right) result.tieBracket.byes.push({ round, group: left });
            else result.tieBreaks.push({ round, left, right, winner: left });
            next.push(left);
        }
        remaining = next;
    }
    jest.spyOn(battle, 'readRoom').mockResolvedValue(result);
    const refresh = interaction(result.hostId, `mg_hom_battle-refresh_${result.id}`, { attachmentSizeLimit: 0 });
    await ui.handle(refresh);
    validPayload(last(refresh));
    const tie = last(refresh).embeds[0].data.fields.filter(field => field.name.startsWith('Hòa điểm · Vòng phụ'));
    expect(tie).toHaveLength(2);
    expect(tie.map(field => field.value).join('\n').match(/\*\*50\/50\*\*/g)).toHaveLength(9);
    expect(tie.map(field => field.value).join('\n').match(/được miễn lượt/g)).toHaveLength(2);

    jest.spyOn(battle, 'getHistoryConfig').mockResolvedValue(result);
    const open = interaction(result.hostId, 'mg_hom_battle-new_crate-4904', { attachmentSizeLimit: 0 });
    await ui.handle(open);
    const settings = interaction(result.hostId, control(last(open), 'settings').custom_id);
    await ui.handle(settings);
    const history = interaction(result.hostId, control(last(settings), 'history').custom_id);
    jest.spyOn(battle, 'listHistory').mockResolvedValue({ entries: [result], total: 1, page: 0, pages: 1 });
    await ui.handle(history);
    const select = interaction(result.hostId, control(last(history), 'history-select').custom_id, { values: [result.id] });
    await ui.handle(select);
    validPayload(last(select));
    expect(last(select).embeds[0].data.fields.filter(field => field.name.startsWith('Xử lý hòa điểm'))).toHaveLength(2);
});
