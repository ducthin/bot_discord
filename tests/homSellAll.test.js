const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const hom = require('../commands/hom');
const store = require('../utils/managementStore');
const market = require('../utils/cs2Market');
const playerMarket = require('../utils/cs2PlayerMarket');
const { cases, skins } = require('../assets/cs2-cases.json');

const guild = { id: '1', channels: { cache: new Map() } };
const user = { id: '13' };
const weaponCase = cases.find(item => item.id === 'crate-4904');
const skinId = weaponCase.pools[0][0];
const regularName = `${skins[skinId].name} (Field-Tested)`;
const unquotedName = `StatTrak™ ${regularName}`;
let directory;
let disk;
let prices;
let interactionId;

function quote(name) {
    const priceVnd = prices.get(name);
    if (priceVnd == null) return null;
    const observedAt = Date.now();
    return { priceVnd, observedAt, expiresAt: observedAt + 300_000, source: 'buff', url: market.BUFF_MARKET_URL };
}

beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-hom-sell-all-'));
    disk = store.createManagementStore(directory);
    prices = new Map([[regularName, 2109], [weaponCase.name, 3501]]);
    interactionId = 400;
    jest.spyOn(store, 'read').mockImplementation(disk.read);
    jest.spyOn(store, 'transact').mockImplementation(disk.transact);
    jest.spyOn(market, 'peekMarketQuote').mockImplementation(quote);
    jest.spyOn(market, 'peekMarketDisplay').mockImplementation(name => {
        const price = quote(name);
        return { status: price ? 'fresh' : 'snapshot-missing', quote: price };
    });
});

afterEach(async () => {
    jest.restoreAllMocks();
    for (const file of await fs.readdir(directory)) await fs.unlink(path.join(directory, file));
    await fs.rmdir(directory);
});

function click(customId, overrides = {}) {
    return {
        id: String(++interactionId), customId, guild, user, message: { id: '700' },
        reply: jest.fn().mockResolvedValue(undefined), followUp: jest.fn().mockResolvedValue(undefined),
        deferUpdate: jest.fn().mockResolvedValue(undefined), editReply: jest.fn().mockResolvedValue(undefined),
        ...overrides
    };
}

function payload(interaction) {
    return interaction.editReply.mock.calls.at(-1)?.[0];
}

function control(interaction, label) {
    return payload(interaction)?.components.flatMap(row => row.toJSON().components).find(item => item.label === label);
}

function confirmationId(interaction) {
    return payload(interaction)?.components.flatMap(row => row.toJSON().components)
        .find(item => item.custom_id?.startsWith('mg_hom_confirm-bulk-sale_'))?.custom_id;
}

function embed(interaction) {
    return payload(interaction)?.embeds[0].toJSON();
}

function drop(id, statTrak = false) {
    return { id: String(id), caseId: weaponCase.id, skinId, tier: 0, float: 0.15, statTrak };
}

async function setStash(stash) {
    await disk.transact(guild.id, async (state, save) => {
        state.taixiu.balances[user.id] = 600;
        state.skinCases = { [user.id]: stash };
        await save();
    });
}

async function reviewSale(page = 0) {
    const inventory = click(`mg_hom_inventory_${weaponCase.id}_${page}`);
    await hom.button(inventory);
    const button = control(inventory, 'Bán hết kho');
    expect(button?.custom_id).toBe(`mg_hom_sell-all_${weaponCase.id}_${page}`);
    expect(button.disabled).toBe(false);
    const preview = click(button.custom_id);
    await hom.button(preview);
    return preview;
}

test('sell all reviews items across pages, credits live skin/case prices and fixed keys, and keeps unpriced holdings', async () => {
    const unquoted = drop(300, true);
    const drops = [...Array.from({ length: 13 }, (_, index) => drop(310 + index)), unquoted];
    const past = Date.now() - 600_000;
    market.peekMarketDisplay.mockImplementation(name => {
        if (name === unquotedName) return { status: 'estimate', quote: { priceVnd: 10000, observedAt: past, expiresAt: past + 300_000, source: 'buff' } };
        const price = quote(name);
        return { status: price ? 'fresh' : 'snapshot-missing', quote: price };
    });
    await setStash({ drops, cases: { [weaponCase.id]: 2 }, keys: { [weaponCase.key]: 3 }, items: { 'karambit-amber': 2 } });
    const initial = await disk.read(guild.id);

    const preview = await reviewSale(1);
    const panel = embed(preview);
    expect(panel.title).toBe('Bán hết kho');
    expect(panel.description).toContain('Tổng nhận **214,419 xu**');
    expect(panel.description).toContain('**13 súng · 2 hòm · 3 chìa**');
    expect(panel.description).toContain('**3 món chưa có giá hợp lệ** sẽ ở lại kho.');
    expect(market.peekMarketQuote.mock.calls.map(([name]) => name)).toEqual(expect.arrayContaining([regularName, unquotedName, weaponCase.name]));
    expect(await disk.read(guild.id)).toEqual(initial);

    const confirmId = control(preview, 'Bán 18 món có giá')?.custom_id;
    expect(confirmId).toMatch(/^mg_hom_confirm-bulk-sale_crate-4904_[\da-f-]+$/);
    const otherMessage = click(confirmId, { message: { id: '701' } });
    const otherUser = click(confirmId, { user: { id: '14' } });
    await hom.button(otherMessage);
    await hom.button(otherUser);
    expect(otherMessage.followUp).toHaveBeenCalled();
    expect(otherUser.followUp).toHaveBeenCalled();
    expect(await disk.read(guild.id)).toEqual(initial);

    const confirmed = click(confirmId);
    await hom.button(confirmed);
    await hom.button(click(confirmId));
    const saved = await disk.read(guild.id);
    const remaining = saved.skinCases[user.id];
    expect(saved.taixiu.balances[user.id]).toBe(215019);
    expect(remaining.drops).toEqual([unquoted]);
    expect(remaining.cases?.[weaponCase.id] ?? 0).toBe(0);
    expect(remaining.keys?.[weaponCase.key] ?? 0).toBe(0);
    expect(remaining.items).toEqual({ 'karambit-amber': 2 });
    expect(embed(confirmed).footer.text).toContain('Đã bán 18 món · +214,419 xu');
    expect(embed(confirmed).footer.text).toContain('Trang 1/1');
});

test('inventory and sale checkout keep separate prices for Doppler phases of the same knife', async () => {
    const fever = cases.find(item => item.name === 'Fever Case');
    const doppler = phase => ({ id: phase === 'Ruby' ? '315' : '316', caseId: fever.id, tier: 4, float: 0.03,
        skinId: fever.pools[4].find(id => skins[id].name === '★ Survival Knife | Doppler' && skins[id].phase === phase) });
    const ruby = doppler('Ruby');
    const sapphire = doppler('Sapphire');
    const name = market.getDropMarketQuoteRef(ruby).name;
    const phasePrices = new Map([['Ruby', 125_000], ['Sapphire', 140_000]]);
    const phaseQuote = (item, phase) => {
        if (item !== name || !phasePrices.has(phase)) return null;
        return { priceVnd: phasePrices.get(phase), observedAt: Date.now(), expiresAt: Date.now() + 300_000,
            phase, source: 'buff' };
    };
    market.peekMarketQuote.mockImplementation((item, options) => phaseQuote(item, options?.phase));
    market.peekMarketDisplay.mockImplementation((item, options) => ({ status: 'fresh', quote: phaseQuote(item, options?.phase) }));
    await setStash({ drops: [ruby, sapphire] });

    const inventory = click(`mg_hom_inventory_${fever.id}_0`);
    await hom.button(inventory);
    expect(embed(inventory).description).toMatch(/Sapphire[^\n]*\n↳ \*\*140,000 xu\*\*\n/);
    expect(embed(inventory).description).toMatch(/Ruby[^\n]*\n↳ \*\*125,000 xu\*\*$/);

    const preview = click(control(inventory, 'Bán hết kho').custom_id);
    await hom.button(preview);
    expect(market.peekMarketQuote).toHaveBeenCalledWith(name, { name, phase: 'Ruby' });
    expect(market.peekMarketQuote).toHaveBeenCalledWith(name, { name, phase: 'Sapphire' });
    expect(embed(preview).description).toContain('265,000 xu');
    const confirmed = click(confirmationId(preview));
    await hom.button(confirmed);
    const saved = await disk.read(guild.id);
    expect(saved.taixiu.balances[user.id]).toBe(265_600);
    expect(saved.skinCases[user.id].drops).toEqual([]);
});

test.each([null, 4701])('sell all leaves wallet and items intact when a confirmed case quote changes to %s', async replacement => {
    await setStash({ drops: [drop(310)], cases: { [weaponCase.id]: 2 }, keys: { [weaponCase.key]: 1 } });
    const preview = await reviewSale();
    const oldConfirm = control(preview, 'Xác nhận bán hết')?.custom_id;
    expect(oldConfirm).toBeDefined();
    const before = await disk.read(guild.id);
    prices.set(weaponCase.name, replacement);

    const confirm = click(oldConfirm);
    await hom.button(confirm);

    expect(await disk.read(guild.id)).toEqual(before);
    if (replacement === null) {
        expect(confirm.followUp).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('BUFF.163 chưa có giá hợp lệ') }));
        expect(confirm.editReply).not.toHaveBeenCalled();
        return;
    }
    expect(embed(confirm).footer.text).toContain('Giá đã thay đổi');
    expect(embed(confirm).description).toContain('71,511 xu');
    expect(confirmationId(confirm)).not.toBe(oldConfirm);
});

test.each([['cases', weaponCase.id], ['keys', weaponCase.key]])('sell all validates current %s before crediting any part of the offer', async (kind, id) => {
    await setStash({ drops: [drop(310)], cases: { [weaponCase.id]: 2 }, keys: { [weaponCase.key]: 1 } });
    const preview = await reviewSale();
    const confirmId = control(preview, 'Xác nhận bán hết')?.custom_id;
    expect(confirmId).toBeDefined();
    await disk.transact(guild.id, async (state, save) => {
        state.skinCases[user.id][kind][id]--;
        await save();
    });
    const before = await disk.read(guild.id);

    const confirm = click(confirmId);
    await hom.button(confirm);

    expect(await disk.read(guild.id)).toEqual(before);
    expect(embed(confirm).footer.text).toContain('Kho đã thay đổi');
});

test('another user\'s malformed wallet cannot prevent a completed sale', async () => {
    await setStash({ drops: [drop(310)] });
    await disk.transact(guild.id, async (state, save) => {
        state.taixiu.balances['14'] = 'invalid';
        await save();
    });
    const preview = await reviewSale();
    const confirm = click(confirmationId(preview));
    await hom.button(confirm);
    const saved = await disk.read(guild.id);
    expect(saved.taixiu.balances[user.id]).toBe(2709);
    expect(saved.taixiu.balances['14']).toBe('invalid');
    expect(saved.skinCases[user.id].drops).toEqual([]);
    expect(embed(confirm).footer.text).toContain('Đã bán 1 món');
});

test('sell all requires a new confirmation if an item left and returned to the inventory', async () => {
    await setStash({ drops: [{ ...drop(310), acquiredAt: Date.now() - 60_000 }] });
    const preview = await reviewSale();
    await disk.transact(guild.id, async (state, save) => {
        state.skinCases[user.id].drops[0].acquiredAt = Date.now();
        await save();
    });
    const before = await disk.read(guild.id);
    const confirm = click(confirmationId(preview));
    await hom.button(confirm);
    expect(await disk.read(guild.id)).toEqual(before);
    expect(embed(confirm).footer.text).toContain('Kho đã thay đổi');
});

test('sell all rejects an old confirmation after a skin is listed and returned by cancelling escrow', async () => {
    const item = { ...drop(310), acquiredAt: Date.now() - 60_000 };
    await setStash({ drops: [item] });
    const preview = await reviewSale();
    await expect(playerMarket.listSkin(guild.id, user.id, item.id, 100n, '9001')).resolves.toHaveProperty('status', 'listed');
    await expect(playerMarket.cancelListing(guild.id, user.id, '9001')).resolves.toHaveProperty('status', 'cancelled');
    const before = await disk.read(guild.id);
    expect(before.skinCases[user.id].drops[0].acquiredAt).toBe(item.acquiredAt);

    const confirm = click(confirmationId(preview));
    await hom.button(confirm);

    expect(await disk.read(guild.id)).toEqual(before);
    expect(embed(confirm).footer.text).toContain('Kho đã thay đổi');
});

test('canceling a whole-inventory sale returns to its original page without changing inventory', async () => {
    await setStash({ drops: Array.from({ length: 13 }, (_, index) => drop(310 + index)) });
    const before = await disk.read(guild.id);
    const preview = await reviewSale(1);
    const cancelId = control(preview, 'Hủy')?.custom_id;
    expect(cancelId).toMatch(/^mg_hom_cancel-bulk-sale_crate-4904_[\da-f-]+$/);

    const canceled = click(cancelId);
    await hom.button(canceled);

    expect(embed(canceled)).toMatchObject({ title: 'Kho đồ của bạn', footer: { text: expect.stringContaining('Trang 2/2') } });
    expect(await disk.read(guild.id)).toEqual(before);
});
