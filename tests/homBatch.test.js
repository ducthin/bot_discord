const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const hom = require('../commands/hom');
const store = require('../utils/managementStore');
const reel = require('../utils/cs2Reel');
const market = require('../utils/cs2Market');
const { getDropMarketHashName } = require('../utils/cs2MarketNames');
const { cases, skins } = require('../assets/cs2-cases.json');

const weaponCase = cases.find(item => item.id === 'crate-4904');
const guild = { id: '1' };
const user = { id: '13' };
const GIF = Buffer.from('GIF89a');
const RARITY_ROLLS = [0, 3125, 3750, 3875, 3900];
let root;
let disk;
let render;

beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-hom-batch-'));
    disk = store.createManagementStore(root);
    jest.spyOn(store, 'read').mockImplementation(disk.read);
    jest.spyOn(store, 'transact').mockImplementation(disk.transact);
    jest.spyOn(reel, 'warmCaseReel').mockImplementation(() => {});
    jest.spyOn(reel, 'renderResultArtwork').mockResolvedValue(null);
    jest.spyOn(market, 'peekMarketQuote').mockReturnValue(null);
    render = jest.spyOn(reel, 'renderCaseBatch').mockResolvedValue(null);
});

afterEach(async () => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    for (const file of await fs.readdir(root)) await fs.unlink(path.join(root, file));
    await fs.rmdir(root);
});

function click(id, count, selectedCase = weaponCase) {
    return {
        id, guild, guildId: guild.id, user,
        customId: `mg_hom_open-batch_${selectedCase.id}_${count}`,
        reply: jest.fn(), deferReply: jest.fn(), deferUpdate: jest.fn(), update: jest.fn(),
        editReply: jest.fn(), followUp: jest.fn()
    };
}

function customOpening(id, quantity, selectedCase = weaponCase) {
    return {
        ...click(id, quantity, selectedCase), customId: `mg_hom_open-form_${selectedCase.id}`,
        fields: { fields: new Map([['quantity', { value: quantity }]]) }
    };
}

async function stock(caseCount, keyCount, selectedCase = weaponCase) {
    await disk.transact(guild.id, async (state, save) => {
        state.taixiu.balances[user.id] = 275;
        state.skinCases = { [user.id]: {
            cases: { 'crate-4880': 7, [selectedCase.id]: caseCount },
            keys: { 'key-1393': 2, [selectedCase.key]: keyCount }
        } };
        await save();
    });
    return disk.read(guild.id);
}

function embeds(payload) {
    return payload.embeds?.map(embed => embed.toJSON()) ?? [];
}

function controls(payload) {
    return payload.components.flatMap(row => row.toJSON().components);
}

test('batch buttons use the smaller of case and matching key stock', async () => {
    await stock(5, 3);
    const menu = click('90', 0);
    await hom.execute(menu);
    expect(controls(menu.editReply.mock.calls.at(-1)[0])).toEqual(expect.arrayContaining([
        expect.objectContaining({ label: 'Mở 3 hòm', custom_id: `mg_hom_open-batch_${weaponCase.id}_3`, disabled: false }),
        expect.objectContaining({ label: 'Mở 5 hòm', custom_id: `mg_hom_open-batch_${weaponCase.id}_5`, disabled: true }),
        expect.objectContaining({ label: 'Mở 10 hòm', custom_id: `mg_hom_open-batch_${weaponCase.id}_10`, disabled: true })
    ]));
});

test.each([[10, 9, true], [9, 10, true], [10, 10, false], [12, 11, false]])(
    'the 10-case button uses matching stock (%i cases, %i keys)', async (casesOwned, keysOwned, disabled) => {
        await stock(casesOwned, keysOwned);
        const menu = click('91', 0);
        await hom.execute(menu);
        expect(controls(menu.editReply.mock.calls.at(-1)[0])).toContainEqual(expect.objectContaining({
            label: 'Mở 10 hòm', custom_id: `mg_hom_open-batch_${weaponCase.id}_10`, disabled
        }));
    }
);

test.each([[67, 41, 41], [500, 500, 100]])('the custom opening modal caps matching stock at 100 (%i cases, %i keys)', async (casesOwned, keysOwned, available) => {
    await stock(casesOwned, keysOwned);
    const menu = click('92', 0);
    await hom.execute(menu);
    const payload = menu.editReply.mock.calls.at(-1)[0];
    const custom = controls(payload).find(component => component.label === 'Mở tùy chọn');
    expect(custom).toMatchObject({ custom_id: `mg_hom_open-custom_${weaponCase.id}`, disabled: false });
    expect(payload.components).toHaveLength(5);
    expect(payload.components.every(row => row.toJSON().components.length <= 5)).toBe(true);
    const prompt = { ...click('93', 0), customId: custom.custom_id, showModal: jest.fn() };
    await hom.button(prompt);
    const modal = prompt.showModal.mock.calls[0][0].toJSON();
    expect(modal.custom_id).toBe(`mg_hom_open-form_${weaponCase.id}`);
    expect(JSON.stringify(modal.components)).toContain(`Số hòm (1–100) · Có thể mở ${available}`);
    const input = modal.components.flatMap(row => row.components ?? (row.component ? [row.component] : []))
        .find(field => field.custom_id === 'quantity');
    expect(input).toMatchObject({ required: true, max_length: 3, placeholder: 'Nhập từ 1 đến 100' });
    expect(prompt.update).not.toHaveBeenCalled();
});

test.each(['0', '-1', '2.5', '1e2', 'abc', '', '9007199254740992'])(
    'custom opening rejects an invalid quantity (%s) without changing stock', async quantity => {
        const before = await stock(100, 100);
        const opening = customOpening('94', quantity);
        await hom.modal(opening);
        expect(opening.reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'Số lượng mở phải là số nguyên dương hợp lệ.' }));
        expect(opening.update).not.toHaveBeenCalled();
        expect(render).not.toHaveBeenCalled();
        expect(await disk.read(guild.id)).toEqual(before);
    }
);

test.each([6, 27, 100])('custom opening persists all %i drops and bounds the Discord result', async count => {
    await stock(count + 1, count + 1);
    const opening = customOpening('95', String(count));
    await hom.modal(opening);
    const saved = await disk.read(guild.id);
    const stash = saved.skinCases[user.id];
    expect(saved.taixiu.balances[user.id]).toBe(275);
    expect(stash.cases[weaponCase.id]).toBe(1);
    expect(stash.keys[weaponCase.key]).toBe(1);
    expect(stash.drops).toHaveLength(count);
    expect(new Set(stash.drops.map(drop => drop.id)).size).toBe(count);
    expect(render).not.toHaveBeenCalled();
    const result = opening.editReply.mock.calls.at(-1)[0];
    expect(result.embeds.length).toBeLessThanOrEqual(10);
    expect(result.components.length).toBeLessThanOrEqual(5);
    expect(result.components.every(row => row.toJSON().components.length <= 5)).toBe(true);
    const select = controls(result).find(component => component.options);
    expect(select.options.length).toBe(Math.min(10, count));
    expect(select.options.length).toBeLessThanOrEqual(25);
    const shownSummary = result.content ?? embeds(result)[0].description;
    expect(shownSummary).toContain(`Đã lưu **${count} món**`);
    expect(shownSummary).not.toContain('không tải được');
    if (count > 10) expect(shownSummary).toContain(`Đang hiện 10/${count} món đầu`);
});

test('a direct batch accepts the 100-case Discord boundary', async () => {
    await stock(100, 100);
    await hom.button(click('96', 100));
    expect((await disk.read(guild.id)).skinCases[user.id].drops).toHaveLength(100);
    expect(render).not.toHaveBeenCalled();
});

test.each([[100, 99, 100], [100, 100, 99]])('a custom %i-case opening checks both stock counts again (%i cases, %i keys)', async (count, casesOwned, keysOwned) => {
    const before = await stock(casesOwned, keysOwned);
    const opening = customOpening('97', String(count));
    await hom.modal(opening);
    expect(render).not.toHaveBeenCalled();
    expect(await disk.read(guild.id)).toEqual(before);
    expect(embeds(opening.editReply.mock.calls[0][0])[0].footer.text).toBe(`Cần ${count} hòm và ${count} chìa phù hợp để mở cùng lúc.`);
});

test('a valid 100-case opening that exceeds available heap asks for smaller batches without mutation', async () => {
    const count = 100;
    const before = await stock(count, count);
    const random = jest.spyOn(crypto, 'randomInt');
    jest.spyOn(require('node:v8'), 'getHeapStatistics').mockReturnValue({ heap_size_limit: 1024 * 1024, used_heap_size: 900 * 1024 });
    const opening = customOpening('98', String(count));
    await hom.modal(opening);
    expect(random).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
    expect(await disk.read(guild.id)).toEqual(before);
    expect(embeds(opening.editReply.mock.calls[0][0])[0].footer.text)
        .toBe('Lượt mở quá lớn so với bộ nhớ máy chủ hiện có. Hãy chia thành các lượt nhỏ hơn.');
});

test.each([['modal', 101], ['button', 101], ['modal', 0x100000000], ['button', 0x100000000]])(
    'Discord %s rejects %i cases before update, transaction, heap inspection or randomness', async (method, count) => {
    const before = await stock(count, count);
    const random = jest.spyOn(crypto, 'randomInt');
    const heap = jest.spyOn(require('node:v8'), 'getHeapStatistics');
    const opening = method === 'modal' ? customOpening('99', String(count)) : click('99', count);
    await hom[method](opening);
    expect(opening.reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'Discord chỉ mở tối đa 100 hòm mỗi lượt.' }));
    expect(opening.update).not.toHaveBeenCalled();
    expect(opening.deferUpdate).not.toHaveBeenCalled();
    expect(opening.editReply).not.toHaveBeenCalled();
    expect(store.transact).not.toHaveBeenCalled();
    expect(heap).not.toHaveBeenCalled();
    expect(random).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
    expect(await disk.read(guild.id)).toEqual(before);
});

test.each([3, 5, 10])('opening %i cases persists independent drops before one GIF and the static result', async count => {
    jest.useFakeTimers();
    jest.spyOn(crypto, 'randomBytes').mockReturnValue(Buffer.from([0, 0, 0, 34]));
    await stock(count + 1, count + 1);
    let rarityRoll = 0;
    jest.spyOn(crypto, 'randomInt').mockImplementation((min, max) => {
        if (max !== undefined) return min;
        if (min === 3910) return rarityRoll < count ? RARITY_ROLLS[rarityRoll++ % RARITY_ROLLS.length] : 3900;
        return 0;
    });
    const includesRare = count >= 5;
    const playbackMs = includesRare ? reel.RARE_REEL_PLAYBACK_MS : reel.REEL_PLAYBACK_MS;
    render.mockResolvedValue({ gif: GIF });
    const opening = click('100', count);
    let uploaded;
    const gifSent = new Promise(resolve => { uploaded = resolve; });
    opening.editReply.mockImplementation(async payload => {
        if (payload.files?.some(file => file.attachment === GIF)) uploaded(payload);
    });

    const finished = hom.button(opening);
    const first = await Promise.race([gifSent, finished]);
    expect(first?.files).toEqual([expect.objectContaining({ attachment: GIF, name: 'cs2-batch-opening.gif' })]);
    expect(opening.update).toHaveBeenCalledTimes(1);
    const loading = opening.update.mock.calls[0][0];
    expect(loading).toMatchObject({ attachments: [], components: [] });
    expect(embeds(loading)[0].title).toBe(`Mở ${count} hòm · ${weaponCase.name}`);
    expect(opening.update.mock.invocationCallOrder[0]).toBeLessThan(render.mock.invocationCallOrder[0]);
    expect(opening.editReply).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(1);
    let readyToRestart = false;
    const restart = hom.waitForOpenings().then(() => { readyToRestart = true; });

    const saved = await disk.read(guild.id);
    const stash = saved.skinCases[user.id];
    expect(saved.taixiu.balances[user.id]).toBe(275);
    expect(stash.cases).toEqual({ [weaponCase.id]: 1, 'crate-4880': 7 });
    expect(stash.keys).toEqual({ [weaponCase.key]: 1, 'key-1393': 2 });
    expect(stash.drops.map(drop => drop.tier)).toEqual(Array.from({ length: count }, (_, index) => index % RARITY_ROLLS.length));
    expect(stash.drops.map(drop => drop.id)).toEqual(Array.from({ length: count }, (_, index) => `100-${index + 1}`));
    expect(stash.drops.map(drop => drop.acquiredAt)).toEqual(Array(count).fill(Date.now()));
    const [reels] = render.mock.calls[0];
    expect(reels).toHaveLength(count);
    for (const [index, drop] of stash.drops.entries()) {
        const { cards, selectedIndex, result, landingSeed } = reels[index];
        expect(selectedIndex).toBe(24);
        expect(landingSeed).toBe(drop.reelSeed);
        expect(cards.flatMap((card, position) => card.mystery ? [position] : []))
            .toEqual(drop.tier === 4 ? [selectedIndex] : []);
        if (drop.tier === 4) {
            expect(cards[selectedIndex]).toEqual({ color: '#e4ae39', mystery: 'crate_community_33_rare_item.png' });
        } else {
            expect(cards[selectedIndex].image).toBe(skins[drop.skinId].image);
        }
        expect(result).toMatchObject({ title: expect.stringContaining(skins[drop.skinId].name), tier: drop.tier });
    }

    const beforeGoldReveal = includesRare ? reel.REEL_PLAYBACK_MS : 0;
    if (beforeGoldReveal) {
        expect(playbackMs).toBeGreaterThan(beforeGoldReveal);
        await jest.advanceTimersByTimeAsync(beforeGoldReveal);
        expect(opening.editReply).toHaveBeenCalledTimes(1);
    }
    await jest.advanceTimersByTimeAsync(playbackMs - beforeGoldReveal - 1);
    expect(opening.editReply).toHaveBeenCalledTimes(1);
    expect(readyToRestart).toBe(false);
    const lateName = getDropMarketHashName(stash.drops[0]);
    const lateQuote = { priceVnd: 25030, observedAt: Date.now(), expiresAt: Date.now() + 300_000, source: 'buff' };
    jest.spyOn(market, 'peekMarketDisplay').mockImplementation(name => name === lateName
        ? { status: 'fresh', quote: lateQuote } : { status: 'snapshot-missing', quote: null });
    await jest.advanceTimersByTimeAsync(1);
    await finished;
    await restart;
    expect(readyToRestart).toBe(true);
    expect(opening.editReply).toHaveBeenCalledTimes(2);
    const result = opening.editReply.mock.calls[1][0];
    expect(result.attachments).toEqual([]);
    expect(result.files).toBeUndefined();
    const resultEmbeds = embeds(result);
    const items = count === 10 ? resultEmbeds : resultEmbeds.slice(1);
    const summary = `Kết quả ${count} hòm · ${weaponCase.name}`;
    if (count === 10) {
        expect(result.content).toContain(summary);
        expect(result.content).toContain('Đã lưu **10 món**');
    } else {
        expect(resultEmbeds[0].title).toBe(summary);
    }
    expect(resultEmbeds.length).toBeLessThanOrEqual(10);
    expect(result.components.every(row => row.toJSON().components.length <= 5)).toBe(true);
    expect(items).toHaveLength(count);
    expect(items[0].description).toContain('25,030 xu');
    for (const [index, drop] of stash.drops.entries()) {
        expect(items[index].title.startsWith(`${index + 1}. `)).toBe(true);
        expect(items[index].title).toContain(skins[drop.skinId].name);
    }
    const resultControls = controls(result);
    expect(resultControls.filter(component => component.label).map(component => [component.label, component.disabled])).toEqual(expect.arrayContaining([
        ['Mở lẻ', false], ['Mở 3 hòm', true], ['Mở 5 hòm', true], ['Mở 10 hòm', true], ['Về hòm', false], ['Kho đồ', false]
    ]));
    const selection = resultControls.find(component => component.options);
    expect(selection.options.map(option => option.value)).toEqual(stash.drops.map(drop => `drop_${drop.id}`));

    const details = { ...click('101', 0), customId: selection.custom_id, values: [selection.options.at(-1).value] };
    await hom.select(details);
    expect(embeds(details.editReply.mock.calls[0][0])[0].title).toContain(skins[stash.drops.at(-1).skinId].name);
});

test('only the winning card uses the mystery art for its case', async () => {
    const gloveCase = cases.find(item => item.name === 'Glove Case');
    const mysteryCards = [
        [weaponCase, 'crate_community_33_rare_item.png'],
        [gloveCase, 'default_rare_item.png']
    ];
    jest.spyOn(crypto, 'randomInt').mockImplementation((min, max) => max !== undefined ? min : min === 3910 ? 3900 : 0);
    jest.spyOn(crypto, 'randomBytes').mockReturnValue(Buffer.from([0, 0, 0, 34]));
    for (const [index, [selectedCase]] of mysteryCards.entries()) {
        await stock(3, 3, selectedCase);
        await hom.button(click(`20${index}`, 3, selectedCase));
    }

    expect(render).toHaveBeenCalledTimes(2);
    for (const [index, [selectedCase, mystery]] of mysteryCards.entries()) {
        const [rounds] = render.mock.calls[index];
        expect(rounds).toHaveLength(3);
        for (const { cards, selectedIndex, result } of rounds) {
            expect(cards.length).toBeGreaterThan(1);
            expect(cards[selectedIndex]).toEqual({ mystery, color: '#e4ae39' });
            expect(cards.filter(card => card.color === '#e4ae39')).toEqual([cards[selectedIndex]]);
            expect(result).toMatchObject({ title: expect.stringContaining(skins[selectedCase.pools[4][0]].name), tier: 4 });
        }
    }
});

test.each([[3, 2, 5], [3, 5, 2], [10, 9, 10], [10, 10, 9]])('opening %i cases with insufficient stock (%i cases, %i keys) leaves the wallet and inventory intact', async (count, casesOwned, keysOwned) => {
    const before = await stock(casesOwned, keysOwned);
    const opening = click('200', count);
    await hom.button(opening);
    expect(render).not.toHaveBeenCalled();
    expect(await disk.read(guild.id)).toEqual(before);
    expect(embeds(opening.editReply.mock.calls[0][0])[0].footer.text).toBe(`Cần ${count} hòm và ${count} chìa phù hợp để mở cùng lúc.`);
});

test.each([3, 10])('a %i-case batch with unavailable media shows the saved result and cannot be charged twice', async count => {
    await stock(count * 2 + 1, count * 2 + 1);
    const opening = click('300', count);
    await hom.button(opening);
    const saved = await disk.read(guild.id);
    const stash = saved.skinCases[user.id];
    expect(saved.taixiu.balances[user.id]).toBe(275);
    expect(stash.cases[weaponCase.id]).toBe(count + 1);
    expect(stash.keys[weaponCase.key]).toBe(count + 1);
    expect(stash.drops).toHaveLength(count);
    expect(render).toHaveBeenCalledTimes(1);
    expect(opening.editReply).toHaveBeenCalledTimes(1);
    const result = opening.editReply.mock.calls[0][0];
    expect(result.files?.some(file => file.attachment === GIF)).toBeFalsy();
    const resultControls = controls(result);
    const selection = resultControls.find(component => component.options);
    expect(selection.options.map(option => option.value)).toEqual(stash.drops.map(drop => `drop_${drop.id}`));
    expect(resultControls).toContainEqual(expect.objectContaining({ label: `Mở ${count} hòm`, disabled: false }));
    for (const drop of stash.drops) expect(JSON.stringify(resultControls)).toContain(skins[drop.skinId].name);

    await hom.button(click('300', count));
    expect(render).toHaveBeenCalledTimes(1);
    expect(await disk.read(guild.id)).toEqual(saved);
});

test('a GIF above the attachment limit is skipped and a rejected result update is retried', async () => {
    await stock(3, 3);
    render.mockResolvedValue({ gif: GIF });
    const opening = { ...click('301', 3), attachmentSizeLimit: GIF.length - 1 };
    opening.editReply.mockRejectedValueOnce(new Error('Discord temporarily unavailable'));
    await hom.button(opening);
    expect(render).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ selectedIndex: 24 })]), GIF.length - 1);
    const [first, retry] = opening.editReply.mock.calls.map(([payload]) => payload);
    expect(first.files).toBeUndefined();
    expect(retry).toBe(first);
    expect(embeds(retry)[0].title).toBe(`Kết quả 3 hòm · ${weaponCase.name}`);
    const saved = (await disk.read(guild.id)).skinCases[user.id];
    expect(saved.drops).toHaveLength(3);
    expect(saved.cases[weaponCase.id]).toBe(0);
    expect(saved.keys[weaponCase.key]).toBe(0);
});

test('a 10-case set buys the missing matching stock, including a double-digit quantity', async () => {
    await stock(0, 7);
    await disk.transact(guild.id, async (state, save) => {
        state.taixiu.balances[user.id] = 500_000;
        await save();
    });
    const quote = { priceVnd: 3501, observedAt: Date.now(), expiresAt: Date.now() + 300_000, source: 'buff' };
    market.peekMarketQuote.mockReturnValue(quote);
    jest.spyOn(market, 'peekMarketDisplay').mockReturnValue({ status: 'fresh', quote });
    const menu = click('400', 0);
    await hom.execute(menu);
    const buySet = controls(menu.editReply.mock.calls.at(-1)[0]).find(component => component.label === 'Mua theo bộ');
    expect(buySet.disabled).toBe(false);
    const setMenu = { ...click('401', 0), customId: buySet.custom_id };
    await hom.button(setMenu);
    const sets = setMenu.editReply.mock.calls.at(-1)[0];
    const purchase = controls(sets).find(component => component.label === 'Xác nhận mua bộ 10');
    expect(purchase.disabled).toBe(false);
    expect(embeds(sets)[0].fields).toContainEqual(expect.objectContaining({
        name: 'Đủ mở 10 hòm', value: '10 hòm · 3 chìa\nTổng **215,010 xu**'
    }));
    const order = { ...click('402', 0), customId: purchase.custom_id };
    await hom.button(order);
    const saved = await disk.read(guild.id);
    expect(saved.taixiu.balances[user.id]).toBe(284_990);
    expect(saved.skinCases[user.id]).toMatchObject({
        cases: { [weaponCase.id]: 10, 'crate-4880': 7 }, keys: { [weaponCase.key]: 10, 'key-1393': 2 }
    });
    expect(controls(order.editReply.mock.calls.at(-1)[0])).toContainEqual(expect.objectContaining({ label: 'Mở 10 hòm', disabled: false }));
});
