const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const hom = require('../commands/hom');
const store = require('../utils/managementStore');
const market = require('../utils/cs2Market');
const reel = require('../utils/cs2Reel');
const battle = require('../utils/cs2Battles');
const { customCases, ICONIC_CASE_IDS, casePricing, lockCasePricing, lockedCase, rollCustomCase } = require('../utils/cs2BattleCases');
const { wearIndex } = require('../utils/cs2MarketNames');
const { cases } = require('../utils/cs2Catalogue');
const { readCoins, formatCoins } = require('../utils/coins');

const [item] = customCases;
const basePrices = item.entries.map((_, index) => (index + 1) * 100);
const ticketFor = (index, entries = casePricing(item).entries) => entries.slice(0, index).reduce((sum, entry) => sum + entry.weight, 0);
const guild = { id: '1' };
const channelId = '20';
const players = ['101', '102', '103', '104'];
let directory;
let disk;
let nextId = 1000;

beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-case-battle-'));
    disk = store.createManagementStore(directory);
    jest.spyOn(store, 'read').mockImplementation(disk.read);
    jest.spyOn(store, 'transact').mockImplementation(disk.transact);
    jest.spyOn(reel, 'warmCaseReel').mockResolvedValue();
    jest.spyOn(market, 'peekMarketQuote').mockImplementation((name, ref) => {
        const index = item.entries.findIndex(entry => entry.ref.name === name && entry.ref.phase === ref?.phase);
        const priceVnd = basePrices[index];
        return priceVnd == null ? null : { priceVnd, observedAt: Date.now() };
    });
    jest.spyOn(crypto, 'randomInt').mockImplementation((min, max) => max == null ? 0 : min);
    jest.spyOn(reel, 'renderCaseReel').mockResolvedValue(null);
    await disk.transact(guild.id, async (state, save) => {
        state.taixiu.balances = Object.fromEntries(players.map(id => [id, 500_000]));
        await save();
    });
});

afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(directory, { recursive: true, force: true });
});

const create = (mode = 'regular', format = '2', caseIds = [item.id], options = {}) => battle.createRoom(guild.id, {
    id: String(++nextId), channelId, hostId: players[0], caseIds, mode, format, expectedPrices: {
        [item.id]: lockCasePricing(casePricing(item, entry => basePrices[item.entries.indexOf(entry)] ?? 10_000))
    }, ...options
});
const act = (room, user, action, roll) => battle.actOnRoom(guild, channelId, room.id, user, action, roll);

function tickets(...values) {
    crypto.randomInt.mockImplementation((min, max) => max != null ? min : min === 10_000 ? values.shift() : 0);
}

test.each([['regular', 0], ['crazy', 1]])('%s awards all drops and settles once at the locked prices', async (mode, winnerIndex) => {
    const { room } = await create(mode, '2', [item.id, item.id]);
    expect((await disk.read(guild.id)).taixiu.balances[players[0]]).toBe(500_000);
    tickets(ticketFor(1), 0, ticketFor(2), 0);
    market.peekMarketQuote.mockReturnValue(null);
    const [first, repeated] = await Promise.all([act(room, players[1], 'join'), act(room, players[1], 'join')]);
    expect(first).toMatchObject({ started: true, room: { status: 'finished', winners: [players[winnerIndex]] } });
    expect(repeated.started).toBeUndefined();
    expect(first.room.rounds[0].entries.map(entry => entry.value)).toEqual(['20000', '10000']);
    const state = await disk.read(guild.id);
    for (const id of players.slice(0, 2)) expect(readCoins(state.taixiu.balances[id])).toBe(50_000_000n - BigInt(room.fee));
    expect(state.skinCases[players[winnerIndex]].drops).toHaveLength(4);
    expect(state.skinCases[players[1 - winnerIndex]]).toBeUndefined();
});

test('sharing splits all drop value exactly in cents', async () => {
    const { room } = await create('sharing', '3');
    await act(room, players[1], 'join');
    tickets(ticketFor(1), 0, 0);
    const { room: result } = await act(room, players[2], 'join');
    expect(result.payouts).toEqual({ [players[0]]: '13334', [players[1]]: '13333', [players[2]]: '13333' });
});

test('custom free-for-all supports ten players and rejects capacities above ten', async () => {
    const ids = Array.from({ length: 10 }, (_, index) => String(101 + index));
    await disk.transact(guild.id, async (state, save) => {
        state.taixiu.balances = Object.fromEntries(ids.map(id => [id, 500_000]));
        await save();
    });
    const { room, error } = await create('sharing', 'custom', [item.id], { playerLimit: 10 });
    expect(error).toBeUndefined();
    expect(battle.capacity(room)).toBe(10);
    for (const id of ids.slice(1, -1)) expect((await act(room, id, 'join')).room.status).toBe('waiting');
    const result = await act(room, ids.at(-1), 'join');
    expect(result).toMatchObject({ started: true, room: { status: 'finished' } });
    expect(result.room.players.map(player => player.id)).toEqual(ids);
    expect(result.room.rounds[0].entries).toHaveLength(10);
    expect(Object.keys(result.room.payouts)).toHaveLength(10);

    await expect(create('regular', 'custom', [item.id], { playerLimit: 11 }))
        .resolves.toMatchObject({ error: 'Số người tùy chỉnh phải từ 5 đến 10.' });
});

test('a custom ten-player Battle fills unused seats with bots without crediting their shares', async () => {
    const { room } = await create('sharing', 'custom', [item.id], { playerLimit: 10 });
    const { room: result } = await act(room, players[0], 'bot-start');
    expect(result.players).toHaveLength(10);
    expect(result.players.filter(player => player.isBot)).toHaveLength(9);
    expect(Object.keys(result.payouts)).toEqual([players[0]]);
    expect(BigInt(result.payouts[players[0]]) + BigInt(result.unclaimedPayout)).toBe(BigInt(result.pool));
    const state = await disk.read(guild.id);
    expect(readCoins(state.taixiu.balances[players[0]])).toBe(50_000_000n - BigInt(room.fee) + BigInt(result.payouts[players[0]]));
    for (const bot of result.players.filter(player => player.isBot)) expect(state.taixiu.balances[bot.id]).toBeUndefined();
});

test('team seats cap at two and the winning team splits the pot', async () => {
    const { room } = await create('regular', 'teams');
    await act(room, players[1], 'join-a');
    expect(await act(room, players[2], 'join-a')).toEqual({ error: 'Đội A đã đủ người.' });
    await act(room, players[2], 'join-b');
    tickets(0, ticketFor(1), ticketFor(item.entries.length - 1), 0);
    const result = await act(room, players[3], 'join-b');
    expect(result.room.winners).toEqual(players.slice(2));
    const share = ((400n + BigInt(basePrices.at(-1))) * 100n / 2n).toString();
    expect(result.room.payouts).toEqual({ [players[2]]: share, [players[3]]: share });
});

test('unpriced case variants block new rooms and an underfunded host cancels safely', async () => {
    market.peekMarketQuote.mockReturnValueOnce(null);
    expect(await create()).toMatchObject({ error: expect.stringContaining('thiếu giá BUFF') });
    const { room } = await create();
    await disk.transact(guild.id, async (state, save) => { state.taixiu.balances[players[0]] = 0; await save(); });
    expect((await act(room, players[1], 'join')).room).toMatchObject({ status: 'cancelled' });
    expect((await disk.read(guild.id)).taixiu.balances[players[1]]).toBe(500_000);
});

test('old quotes cannot publish a room and expired rooms cannot debit xu', async () => {
    market.peekMarketQuote.mockReturnValueOnce({ priceVnd: 1501 });
    expect(await create()).toMatchObject({ error: expect.stringContaining('Giá đã đổi') });
    const { room } = await create();
    jest.spyOn(Date, 'now').mockReturnValue(room.expiresAt);
    expect(await act(room, players[1], 'join')).toMatchObject({ room: { status: 'waiting' } });
    expect(await battle.readRoom(guild.id, '21', room.id)).toBeNull();
    expect((await disk.read(guild.id)).taixiu.balances[players[1]]).toBe(500_000);
});

test('custom odds use exact ticket boundaries and an explicit fee with no key', () => {
    const pricing = casePricing(item);
    const locked = lockedCase(item, lockCasePricing(pricing));
    const weighted = locked.entries.reduce((sum, entry, index) => sum + BigInt(pricing.values[index]) * BigInt(entry.weight), 0n);
    expect(pricing).toMatchObject({ values: basePrices, fee: (weighted + 94n) / 95n, expected: weighted / 100n });
    for (const [ticket, index] of locked.entries.flatMap((entry, index) => [[ticketFor(index, locked.entries), index],
        [ticketFor(index, locked.entries) + entry.weight - 1, index]])) {
        const result = rollCustomCase(locked, pricing.values, '1', 1, (min, max) => max != null ? min : min === 10_000 ? ticket : 0);
        expect(result.drop).toMatchObject({ ...locked.entries[index].drop, battleCaseId: item.id });
        expect(result.value).toBe(BigInt(basePrices[index]) * 100n);
    }
});

test('an expanded case prices and rolls each wear variant using the published tickets and float range', async () => {
    const expandedItem = customCases.find(item => item.id === 'battle-farm-knife');
    market.peekMarketQuote.mockImplementation((name, ref) => {
        const anchor = expandedItem.entries.find(entry => entry.ref.name === name && entry.ref.phase === ref?.phase);
        const gold = name.startsWith('★');
        return { priceVnd: anchor ? (gold ? 1_000_000 : 100) : (gold ? 800_000 : 60) };
    });
    const pricing = casePricing(expandedItem);
    expect(pricing.entries.length).toBeGreaterThan(expandedItem.entries.length);
    expect(new Set(pricing.entries.map(entry => entry.drop.skinId)).size).toBeGreaterThan(expandedItem.entries.length);
    expect(pricing.entries.reduce((sum, entry) => sum + entry.weight, 0)).toBe(10_000);
    const index = expandedItem.entries.length;
    const ticket = pricing.entries.slice(0, index).reduce((sum, entry) => sum + entry.weight, 0);
    const selected = pricing.entries[index];
    const draw = (min, max) => max == null ? (min === 10_000 ? ticket : 0) : max - 1;
    const outcome = rollCustomCase({ ...expandedItem, entries: pricing.entries }, pricing.values, '1', 1, draw);
    expect(outcome.drop).toMatchObject({ skinId: selected.drop.skinId, float: selected.max / 1_000_000 });
    expect(wearIndex(outcome.drop.float)).toBe(selected.exterior);
    expect(outcome.value).toBe(BigInt(pricing.values[index]) * 100n);
    const { room } = await battle.createRoom(guild.id, { id: String(++nextId), channelId, hostId: players[0], caseIds: [expandedItem.id],
        mode: 'regular', format: '2', expectedPrices: { [expandedItem.id]: pricing } });
    market.peekMarketQuote.mockReturnValue(null);
    tickets(ticket, 0);
    const { room: finished } = await act(room, players[1], 'join');
    expect(finished.rounds[0].entries[0].drop.skinId).toBe(selected.drop.skinId);
});

function interaction(userId, customId, extra = {}) {
    return { id: String(++nextId), guild, guildId: guild.id, channelId, user: { id: userId }, customId,
        reply: jest.fn(), deferReply: jest.fn(), deferUpdate: jest.fn(), editReply: jest.fn(), followUp: jest.fn(), ...extra };
}

const last = request => request.editReply.mock.calls.at(-1)[0];
const control = (payload, action) => payload.components.flatMap(row => row.toJSON().components)
    .find(item => item.custom_id?.startsWith(`mg_hom_battle-${action}_`));

test('Battle quantity modals route through /hom and reject an already replaced form', async () => {
    const builder = interaction(players[0], 'mg_hom_battle-new_crate-4904');
    await hom.button(builder);
    const quantity = interaction(players[0], control(last(builder), 'quantity').custom_id, { showModal: jest.fn() });
    await hom.button(quantity);
    const modalId = quantity.showModal.mock.calls[0][0].toJSON().custom_id;
    const form = interaction(players[0], modalId, { fields: { getTextInputValue: () => '12' } });
    await hom.modal(form);
    const add = interaction(players[0], control(last(form), 'add').custom_id);
    await hom.button(add);
    expect(last(add).embeds[0].data.fields.find(field => field.name.startsWith('Số vòng')).name).toBe('Số vòng · 12/100');
    const replaced = interaction(players[0], modalId, { fields: { getTextInputValue: () => '50' } });
    await hom.modal(replaced);
    expect(replaced.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Bảng vừa đổi') }));
    expect(replaced.editReply).not.toHaveBeenCalled();
});

test('the /hom entry creates a public room and the last player sees the persisted result', async () => {
    const open = interaction(players[0]);
    await hom.execute(open);
    const builder = interaction(players[0], control(last(open), 'new').custom_id);
    await hom.button(builder);
    const roomForm = last(builder);
    const add = interaction(players[0], control(roomForm, 'add').custom_id);
    await hom.button(add);
    const addSecond = interaction(players[0], control(last(add), 'add').custom_id);
    await hom.button(addSecond);
    const publish = interaction(players[0], control(last(addSecond), 'publish').custom_id, {
        channel: { isSendable: () => true, send: jest.fn().mockResolvedValue({ url: 'https://discord.com/channels/1/20/5' }) }
    });
    await hom.button(publish);
    expect(last(publish).content).toContain('/1/20/5');
    const post = publish.channel.send.mock.calls[0][0];
    expect(post.embeds[0].toJSON().description).toContain('Chờ người · 1/2');
    const join = interaction(players[1], control(post, 'join').custom_id, { attachmentSizeLimit: 0, message: { id: '5' } });
    await hom.button(join);
    const final = last(join).embeds[0].toJSON();
    expect(final.title).toBe('🏆 Kết quả Case Battle');
    expect(final.fields.map(field => field.name)).toEqual(expect.arrayContaining(['Bảng điểm', 'Chia thưởng bằng xu', 'Hòa điểm · Chia đều', 'Vòng 2 · Battle Cân Bằng']));
    const fee = casePricing(item).fee * 2n;
    const net = 20_000n - fee;
    expect(final.fields.find(field => field.name === 'Lãi/lỗ theo giá lúc mở').value).toContain(`${net < 0n ? 'Lỗ' : 'Lời'} ${formatCoins(net < 0n ? -net : net)}`);
    const saved = await disk.read(guild.id);
    for (const id of players.slice(0, 2)) expect(readCoins(saved.taixiu.balances[id])).toBe(50_000_000n - fee + 20_000n);
    await expect(battle.pendingResults(guild.id)).resolves.toEqual([]);
});

test('a saved Battle result can be published after the original interaction fails without settling twice', async () => {
    const { room } = await create();
    const message = { id: '5' };
    const join = interaction(players[1], `mg_hom_battle-join_${room.id}`, {
        message, attachmentSizeLimit: 0, editReply: jest.fn(async payload => {
            if (payload.embeds[0].data.title === '🏆 Kết quả Case Battle') throw new Error('Discord unavailable');
        })
    });
    await expect(hom.button(join)).rejects.toThrow('Discord unavailable');
    await expect(battle.pendingResults(guild.id)).resolves.toMatchObject([{ id: room.id, pendingResultMessageId: message.id }]);
    const settled = await disk.read(guild.id);

    const edit = jest.fn();
    const fetch = jest.fn().mockResolvedValue({ messages: { edit } });
    await hom.restoreBattleResults({ ...guild, channels: { fetch } });
    expect(fetch).toHaveBeenCalledWith(channelId);
    expect(edit).toHaveBeenCalledWith(message.id, expect.objectContaining({ attachments: [] }));
    expect(control(edit.mock.calls[0][1], 'recreate')).toBeDefined();
    expect(edit.mock.calls[0][1].embeds[0].data.title).toBe('🏆 Kết quả Case Battle');
    const restored = await disk.read(guild.id);
    expect(restored.taixiu).toEqual(settled.taixiu);
    expect(restored.skinCases).toEqual(settled.skinCases);
    await expect(battle.pendingResults(guild.id)).resolves.toEqual([]);
});

test('solo opening shows exact odds, charges one fee and saves the skin even if the GIF is unavailable', async () => {
    const builder = interaction(players[0], 'mg_hom_battle-new_crate-4904');
    await hom.button(builder);
    const panel = last(builder);
    const embed = panel.embeds[0].toJSON();
    const pricing = casePricing(item);
    expect(embed.description).toContain(`Mở lẻ **${formatCoins(pricing.fee)}**`);
    const odds = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });
    expect(embed.description).toContain(`Lời **${odds.format(pricing.profitTickets / 100)}%**`);
    expect(embed.description).toContain(`Hòa vốn **${odds.format(pricing.breakEvenTickets / 100)}%**`);
    expect(embed.description).toContain(`Lỗ **${odds.format(pricing.lossTickets / 100)}%**`);
    expect(embed.description).toContain('mỗi lượt độc lập');
    expect(control(panel, 'preview').options.every(option => !/cơ hội lời/i.test(option.description ?? ''))).toBe(true);
    const rareChance = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(pricing.goldTickets / 100);
    expect(embed.fields.find(field => field.name === 'Tỉ lệ ra dao/găng').value).toBe(`${rareChance}%`);
    const solo = interaction(players[0], control(panel, 'solo').custom_id);
    tickets(9999);
    await hom.button(solo);
    await hom.button(solo);
    const state = await disk.read(guild.id);
    expect(readCoins(state.taixiu.balances[players[0]])).toBe(50_000_000n - pricing.fee);
    expect(state.skinCases[players[0]].drops).toEqual([expect.objectContaining({ battleCaseId: item.id, tier: 4 })]);
    const [cards, selectedIndex] = reel.renderCaseReel.mock.calls[0];
    expect(cards.filter(card => card.mystery)).toEqual([cards[selectedIndex]]);
    const value = BigInt(basePrices.at(-1)) * 100n;
    const net = value - pricing.fee;
    expect(last(solo).embeds[0].toJSON().footer.text).toContain(`Phí ${formatCoins(pricing.fee)} · ${net >= 0n ? 'Lời' : 'Lỗ'} ${formatCoins(net >= 0n ? net : -net)}`);
    const back = interaction(players[0], control(last(solo), 'new').custom_id);
    await hom.button(back);
    expect(last(back).embeds[0].toJSON().title).toContain(item.name);
});

test('the jackpot group chance is distinct from the actual profit chance in the preview and odds panel', async () => {
    market.peekMarketQuote.mockReturnValue({ priceVnd: 100, observedAt: Date.now() });
    const request = interaction(players[0], 'mg_hom_battle-new_crate-4904_battle-jackpot-10');
    await hom.button(request);
    const description = last(request).embeds[0].toJSON().description;
    const pricing = casePricing(customCases.find(item => item.id === 'battle-jackpot-10'));
    const jackpotChance = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(pricing.jackpotTickets / 100);
    expect(description).toContain(`${jackpotChance}% nhóm giải lớn`);
    expect(description).toContain('Lời **0%**');
    expect(description).toContain('Hòa vốn **0%**');
    expect(description).toContain('Lỗ **100%**');
    const odds = interaction(players[0], control(last(request), 'draft-odds').custom_id);
    await hom.button(odds);
    expect(odds.reply.mock.calls.at(-1)[0].embeds[0].toJSON().description).toContain('Lời **0%**');
});

test('the catalogue shows all cases by theme and orders budget filters by their exact fee', async () => {
    market.peekMarketQuote.mockReturnValue({ priceVnd: 100, observedAt: Date.now() });
    const selected = interaction(players[0], 'mg_hom_battle-new_crate-4904');
    await hom.button(selected);
    const panel = last(selected);
    expect(control(panel, 'publish').disabled).toBe(true);
    const groupMenu = control(panel, 'group');
    const visited = new Set();
    let current = selected;
    for (const value of ['casual', 'weapon', 'rarity', 'theme', 'gold']) {
        current = interaction(players[0], control(last(current), 'group').custom_id, { values: [value] });
        await hom.select(current);
        let menu = control(last(current), 'preview');
        while (true) {
            expect(menu.options.length).toBeLessThanOrEqual(25);
            for (const option of menu.options) if (customCases.some(item => item.id === option.value)) visited.add(option.value);
            if (!menu.options.some(option => option.value === 'next')) break;
            current = interaction(players[0], menu.custom_id, { values: ['next'] });
            await hom.select(current);
            menu = control(last(current), 'preview');
        }
    }
    expect(visited).toEqual(new Set(customCases.map(item => item.id)));
    expect(groupMenu.options).toContainEqual(expect.objectContaining({ value: 'under-50k' }));
    const budget = interaction(players[0], control(last(current), 'group').custom_id, { values: ['under-50k'] });
    await hom.select(budget);
    const pageOne = control(last(budget), 'preview');
    expect(pageOne.options).toContainEqual(expect.objectContaining({ value: 'next' }));
    const allOptions = [...pageOne.options];
    let menu = pageOne;
    while (menu.options.some(option => option.value === 'next')) {
        const budgetNext = interaction(players[0], menu.custom_id, { values: ['next'] });
        await hom.select(budgetNext);
        menu = control(last(budgetNext), 'preview');
        expect(menu.options).toContainEqual(expect.objectContaining({ value: 'previous' }));
        allOptions.push(...menu.options);
    }
    const fees = allOptions.map(({ value }) => customCases.find(item => item.id === value))
        .filter(Boolean).map(item => Number(casePricing(item).fee));
    expect(fees).toHaveLength(customCases.length);
    expect(fees).toEqual(fees.toSorted((a, b) => a - b));
    expect(fees.every(fee => fee < 5_000_000)).toBe(true);
});

test('the new-case filter paginates the latest collection and preserves fee ordering and odds access', async () => {
    market.peekMarketQuote.mockReturnValue({ priceVnd: 100, observedAt: Date.now() });
    let request = interaction(players[0], 'mg_hom_battle-new_crate-4904');
    await hom.button(request);
    expect(control(last(request), 'group').options).toContainEqual(expect.objectContaining({ value: 'new', label: 'Hòm mới · 36 hòm' }));
    request = interaction(players[0], control(last(request), 'group').custom_id, { values: ['new'] });
    await hom.select(request);
    const visited = [];
    let menu = control(last(request), 'preview');
    while (true) {
        expect(menu.options.length).toBeLessThanOrEqual(25);
        visited.push(...menu.options.filter(option => customCases.some(item => item.id === option.value)).map(option => option.value));
        if (!menu.options.some(option => option.value === 'next')) break;
        request = interaction(players[0], menu.custom_id, { values: ['next'] });
        await hom.select(request);
        menu = control(last(request), 'preview');
    }
    expect(new Set(visited)).toEqual(new Set(ICONIC_CASE_IDS));
    expect(visited).toHaveLength(36);
    const fees = visited.map(id => casePricing(battle.getBattleCase(id)).fee);
    expect(fees).toEqual(fees.toSorted((a, b) => a < b ? -1 : a > b ? 1 : 0));
    const chosen = visited.at(-1);
    const preview = interaction(players[0], menu.custom_id, { values: [chosen] });
    await hom.select(preview);
    expect(last(preview).embeds[0].toJSON().title).toContain(battle.getBattleCase(chosen).name);
    const odds = interaction(players[0], control(last(preview), 'draft-odds').custom_id);
    await hom.button(odds);
    expect(odds.reply.mock.calls.at(-1)[0].embeds[0].toJSON().title).toContain(battle.getBattleCase(chosen).name);
});

test('gold-only cases animate real knives and land on the actual prize', async () => {
    market.peekMarketQuote.mockReturnValue({ priceVnd: 100, observedAt: Date.now() });
    const builder = interaction(players[0], 'mg_hom_battle-new_crate-4904_battle-knife');
    await hom.button(builder);
    const panel = last(builder);
    const solo = interaction(players[0], control(panel, 'solo').custom_id);
    tickets(0);
    await hom.button(solo);
    const [cards, selectedIndex, prize] = reel.renderCaseReel.mock.calls[0];
    expect(cards.every(card => !card.mystery && card.image && !cases.some(item => item.image === card.image))).toBe(true);
    expect(cards[selectedIndex].image).toBe(prize.image);
    expect(new Set(cards.map(card => card.image)).size).toBeGreaterThan(1);
    expect(last(solo).embeds[0].toJSON().thumbnail).toBeUndefined();
    expect((await disk.read(guild.id)).skinCases[players[0]].drops[0]).toMatchObject({ battleCaseId: 'battle-knife', tier: 4 });
});

test('the expanded case odds include float ranges and can be browsed without replacing the builder', async () => {
    market.peekMarketQuote.mockReturnValue({ priceVnd: 100 });
    const builder = interaction(players[0], 'mg_hom_battle-new_crate-4904_battle-knife');
    await hom.button(builder);
    const odds = interaction(players[0], control(last(builder), 'draft-odds').custom_id);
    await hom.button(odds);
    const first = odds.reply.mock.calls[0][0];
    expect(first.embeds[0].toJSON().description).toMatch(/Float 0\.\d{6}–0\.\d{6}/);
    const next = interaction(players[0], control(first, 'draft-odds-page').custom_id.replace(/_-1$/, '_1'), { update: jest.fn() });
    await hom.button(next);
    expect(next.update.mock.calls[0][0].embeds[0].toJSON().footer.text).toContain('Trang 2/');
});

test('rooms already posted with a standard case can still settle after the update', async () => {
    const id = String(++nextId);
    const caseId = item.entries[0].drop.caseId;
    await disk.transact(guild.id, async (state, save) => {
        state.cs2Battles = { [id]: { id, channelId, hostId: players[0], caseIds: [caseId], format: '2', mode: 'regular',
            fee: '20000', status: 'waiting', players: [{ id: players[0] }], expiresAt: Date.now() + 60_000 } };
        await save();
    });
    const legacyRoll = jest.fn((weaponCase, id) => ({ ...item.entries[0].drop, id, caseId: weaponCase.id }));
    const result = await act({ id }, players[1], 'join', legacyRoll);
    expect(legacyRoll).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ started: true, room: { status: 'finished', caseIds: [caseId] } });
    expect((await disk.read(guild.id)).taixiu.balances[players[1]]).toBe(499800);
});
