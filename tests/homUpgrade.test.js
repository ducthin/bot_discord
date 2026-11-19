const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const hom = require('../commands/hom');
const store = require('../utils/managementStore');
const engine = require('../utils/cs2Upgrade');
const art = require('../utils/cs2UpgradeArt');
const market = require('../utils/cs2Market');
const wallet = require('../commands/taixiu');
const { parseCoins } = require('../utils/coins');

const guild = { id: '1' };
const user = { id: '13' };
const source = engine.targetCatalogue()[0];
const targets = engine.targetCatalogue().filter(target => target.skinId !== source.skinId).slice(0, 45);
let directory, disk, prices, sequence;

beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-upgrade-ui-'));
    disk = store.createManagementStore(directory);
    prices = new Map(); sequence = 900;
    jest.spyOn(store, 'read').mockImplementation(disk.read);
    jest.spyOn(store, 'transact').mockImplementation(disk.transact);
    jest.spyOn(art, 'renderUpgrade').mockResolvedValue(null);
    jest.spyOn(market, 'peekMarketQuote').mockImplementation((name, { phase = null } = {}) => prices.get(market.marketQuoteKey(name, phase)) ?? null);
    jest.spyOn(market, 'peekMarketDisplay').mockImplementation((name, { phase = null } = {}) => ({ status: 'fresh', quote: prices.get(market.marketQuoteKey(name, phase)) ?? null }));
    for (const target of targets) setPrice(target, 1000);
    setPrice(source, 100);
    await disk.transact(guild.id, async (state, save) => {
        state.taixiu.balances[user.id] = 50000;
        state.skinCases = { [user.id]: { drops: Array.from({ length: 15 }, (_, index) => ({ ...source.drop, id: `input-${index}`, acquiredAt: index + 1 })) } };
        await save();
    });
});

afterEach(async () => {
    jest.restoreAllMocks();
    for (const file of await fs.readdir(directory)) await fs.unlink(path.join(directory, file));
    await fs.rmdir(directory);
});

function setPrice(target, priceVnd) {
    prices.set(market.marketQuoteKey(target.marketRef.name, target.marketRef.phase), { priceVnd, source: 'buff',
        phase: target.marketRef.phase, observedAt: Date.now() - 1000, expiresAt: Date.now() + 60000 });
}
function interaction(customId, extra = {}) {
    return { id: String(++sequence), guild, user, guildId: guild.id, customId, message: { id: '700' },
        deferUpdate: jest.fn(), editReply: jest.fn(), reply: jest.fn(), followUp: jest.fn(), showModal: jest.fn(), ...extra };
}
function payload(panel) { return panel.editReply.mock.calls.at(-1)?.[0]; }
function controls(panel) { return payload(panel)?.components.flatMap(row => row.toJSON().components) ?? []; }
function control(panel, action) { return controls(panel).find(item => item.custom_id?.startsWith(`mg_hom_upgrade:${action}:`)); }
async function clickId(customId, extra) { const panel = interaction(customId, extra); await hom.button(panel); return panel; }
async function click(panel, action, extra) {
    const item = control(panel, action); expect(item).toBeDefined();
    return clickId(item.custom_id, extra);
}
async function select(panel, action, values, extra) {
    const menu = control(panel, action); expect(menu).toBeDefined();
    const result = interaction(menu.custom_id, { values, ...extra }); await hom.select(result); return result;
}
async function start() { return clickId(`mg_hom_upgrade_${source.caseId}`); }
async function modal(panel, action, fields) {
    const opened = await click(panel, action);
    const customId = opened.showModal.mock.calls[0][0].toJSON().custom_id;
    const result = interaction(customId, { fields: { getTextInputValue: key => fields[key] ?? '' } });
    await hom.modal(result); return result;
}
function modalInputs(opened) {
    const fields = opened.showModal.mock.calls[0][0].toJSON().components
        .flatMap(row => row.components ?? (row.component ? [row.component] : []));
    return Object.fromEntries(fields.map(field => [field.custom_id, field]));
}
async function targetPanel() {
    let panel = await start();
    panel = await select(panel, 'items', [control(panel, 'items').options[0].value]);
    return click(panel, 'targets');
}
async function confirmation() {
    let panel = await targetPanel();
    panel = await select(panel, 'target', [control(panel, 'target').options[0].value]);
    return click(panel, 'review');
}

function assertDiscordBounds(panel) {
    const data = payload(panel);
    expect(data.components.length).toBeLessThanOrEqual(5);
    for (const row of data.components) {
        const components = row.toJSON().components;
        expect(components.length).toBeLessThanOrEqual(5);
        for (const item of components) {
            if (item.custom_id) expect(item.custom_id.length).toBeLessThanOrEqual(100);
            if (item.options) {
                expect(item.options.length).toBeLessThanOrEqual(25);
                for (const option of item.options) {
                    expect(option.label.length).toBeLessThanOrEqual(100);
                    expect(option.description?.length ?? 0).toBeLessThanOrEqual(100);
                }
            }
        }
    }
    for (const embed of data.embeds) {
        const json = embed.toJSON();
        expect(json.description?.length ?? 0).toBeLessThanOrEqual(4096);
        for (const field of json.fields ?? []) expect(field.value.length).toBeLessThanOrEqual(1024);
        expect(embed.length).toBeLessThanOrEqual(6000);
    }
}

test('web whole-inventory pending retains its wrapped region in bounded Discord confirmation and receipt', async () => {
    const items = Array.from({ length: 525 }, (_, index) => ({ ...source.drop, id: `web-input-${index}` }));
    await disk.transact(guild.id, async (state, save) => { state.skinCases[user.id].drops = items; await save(); });
    setPrice(targets[0], 100000);
    const prepared = await engine.prepare(guild.id, user.id, { inputIds: items.map(item => item.id),
        targetId: targets[0].id, startTicket: 99999, clientSeed: 'web-pending' });
    expect(prepared.status).toBe('prepared');
    const last = prepared.attempt.winTickets - 1;
    let panel = await click(await start(), 'pending');
    assertDiscordBounds(panel);
    let embed = payload(panel).embeds[0].toJSON();
    expect(embed.description).toContain('**525 skin**');
    expect(embed.description).toContain('và 515 skin khác.');
    expect(embed.fields.find(field => field.name === 'Tỷ lệ thắng').value).toContain(`100000–100000 ∪ 1–${last}`);
    panel = await click(panel, 'roll');
    assertDiscordBounds(panel);
    embed = payload(panel).embeds[0].toJSON();
    expect(embed.fields.find(field => field.name === 'Tỷ lệ / Kết quả').value).toContain(`Vùng 100000–100000 ∪ 1–${last}`);
    expect((await engine.history(guild.id, user.id))[0]).toMatchObject({ startTicket: 99999, inputIds: items.map(item => item.id) });
});

test('Upgrade is reachable from /hom and inventory without changing the slash schema', async () => {
    const opened = interaction(undefined, { deferReply: jest.fn() });
    await hom.execute(opened);
    expect(controls(opened).some(item => item.custom_id === `mg_hom_upgrade_${source.caseId}` || /^mg_hom_upgrade_crate-/.test(item.custom_id))).toBe(true);
    const inventory = await clickId(`mg_hom_inventory_${source.caseId}_0`);
    expect(controls(inventory).some(item => item.label === 'Upgrade')).toBe(true);
    assertDiscordBounds(opened); assertDiscordBounds(inventory);
});

test('full flow commits exactly once, conceals future seeds and provides a verifiable downloadable receipt', async () => {
    const before = await disk.read(guild.id);
    const panel = await confirmation();
    expect(control(panel, 'roll')?.disabled).toBe(false);
    expect((await disk.read(guild.id)).skinCases[user.id].drops).toEqual(before.skinCases[user.id].drops);
    const pending = await engine.pending(guild.id, user.id);
    expect(pending.serverSeed).toBeUndefined(); expect(pending.salt).toBeUndefined();
    const serialized = JSON.stringify(payload(panel));
    expect(serialized).toContain(pending.hash); expect(serialized).not.toContain('serverSeed');
    assertDiscordBounds(panel);
    const oldRoll = control(panel, 'roll').custom_id;
    const result = await clickId(oldRoll);
    assertDiscordBounds(result);
    const [receipt] = await engine.history(guild.id, user.id);
    expect(engine.verify(receipt)).toBe(true);
    const saved = await disk.read(guild.id);
    expect(saved.skinCases[user.id].drops.some(drop => drop.id === pending.inputIds[0])).toBe(false);
    const repeated = await clickId(oldRoll);
    expect(repeated.reply).toHaveBeenCalled();
    expect(await disk.read(guild.id)).toEqual(saved);
    const proof = await click(result, 'proof');
    expect(JSON.parse(payload(proof).files[0].attachment.toString())).toEqual(receipt);
    assertDiscordBounds(proof);
});

test('selection persists across pages and accepts at most 10 unique inputs', async () => {
    let panel = await start();
    const selected = control(panel, 'items').options.slice(0, 8).map(item => item.value);
    panel = await select(panel, 'items', selected);
    const next = controls(panel).find(item => item.custom_id?.startsWith('mg_hom_upgrade:ipage:') && item.label === 'Trang sau');
    panel = await clickId(next.custom_id);
    expect(control(panel, 'items').max_values).toBe(2);
    const invalid = await select(panel, 'items', control(panel, 'items').options.map(item => item.value));
    expect(invalid.reply).toHaveBeenCalled();
    panel = await select(panel, 'items', control(panel, 'items').options.slice(0, 2).map(item => item.value));
    expect(control(panel, 'items').placeholder).toContain('10/10');
    assertDiscordBounds(panel);
});

test('failed message edits preserve the previously visible control revision', async () => {
    const panel = await start();
    const values = [control(panel, 'items').options[0].value];
    await expect(select(panel, 'items', values, { editReply: jest.fn().mockRejectedValue(new Error('Discord down')) })).rejects.toThrow('Discord down');
    const retry = await select(panel, 'items', values);
    expect(control(retry, 'items').placeholder).toContain('1/10');
});

test('controls are bound to the current user, message and revision', async () => {
    const panel = await start();
    const clear = control(panel, 'clear').custom_id;
    for (const override of [{ user: { id: '14' } }, { message: { id: '701' } }]) {
        const invalid = await clickId(clear, override); expect(invalid.reply).toHaveBeenCalled();
    }
    await clickId(clear);
    expect((await clickId(clear)).reply).toHaveBeenCalled();
});

test('coin-only flow uses exact decimals and debits the common wallet once', async () => {
    let panel = await start();
    panel = await modal(panel, 'settings', { coins: '100.25', seed: 'client_test' });
    expect(payload(panel).embeds[0].toJSON().fields[0].value).toContain('100.25 xu');
    panel = await click(panel, 'targets');
    panel = await select(panel, 'target', [control(panel, 'target').options[0].value]);
    panel = await click(panel, 'review');
    const pending = await engine.pending(guild.id, user.id);
    expect(pending.coinStake).toBe('10025'); expect(pending.inputIds).toEqual([]);
    await click(panel, 'roll');
    expect(wallet.getCoinBalance(await disk.read(guild.id), user.id)).toBe(4989975n);
});

test('price changes and locked inputs invalidate confirmation without consuming assets', async () => {
    let panel = await confirmation();
    const before = await disk.read(guild.id);
    const pending = await engine.pending(guild.id, user.id);
    setPrice(engine.getTarget(pending.targetId), 1100);
    const failed = await click(panel, 'roll');
    expect(payload(failed).embeds[0].toJSON().footer.text).toContain('Giá đã thay đổi');
    expect((await disk.read(guild.id)).skinCases[user.id].drops).toEqual(before.skinCases[user.id].drops);
    setPrice(engine.getTarget(pending.targetId), 1000);
    panel = await confirmation();
    const second = await engine.pending(guild.id, user.id);
    await disk.transact(guild.id, async (state, save) => { state.skinCases[user.id].drops.find(drop => drop.id === second.inputIds[0]).locked = true; await save(); });
    await click(panel, 'roll');
    expect(await engine.history(guild.id, user.id)).toHaveLength(0);
});

test('pending confirmations and history can be recovered from a new panel', async () => {
    const panel = await confirmation();
    const pending = await engine.pending(guild.id, user.id);
    const fresh = await start();
    const resumed = await click(fresh, 'pending');
    expect(payload(resumed).embeds[0].toJSON().fields.find(field => field.name.startsWith('Cam kết')).value).toContain(pending.hash);
    const edit = await click(resumed, 'targets');
    expect(payload(edit).embeds[0].toJSON().fields.find(field => field.name === 'Mục tiêu đã chọn')).toBeDefined();
    const reviewed = await click(edit, 'review');
    expect((await engine.pending(guild.id, user.id)).hash).toBe(pending.hash);
    const result = await click(reviewed, 'roll');
    const history = await click(await start(), 'history');
    expect(control(history, 'receipt').options).toHaveLength(1);
    assertDiscordBounds(history);
    const receipt = await select(history, 'receipt', [control(history, 'receipt').options[0].value]);
    expect(payload(receipt).embeds[0].toJSON().title).toBe(payload(result).embeds[0].toJSON().title);
    expect((await clickId(control(panel, 'roll').custom_id)).reply).toHaveBeenCalled();
});

test('a client seed chosen after seeing the hash keeps the original commitment and verifies', async () => {
    let panel = await confirmation();
    const before = await engine.pending(guild.id, user.id);
    panel = await modal(panel, 'seed', { seed: 'after_commitment_2026' });
    const after = await engine.pending(guild.id, user.id);
    expect(after).toMatchObject({ id: before.id, nonce: before.nonce, hash: before.hash, clientSeed: 'after_commitment_2026' });
    expect(payload(panel).embeds[0].toJSON().fields.find(field => field.name === 'Client seed').value).toContain('after_commitment_2026');
    assertDiscordBounds(panel);
    await click(panel, 'roll');
    const [receipt] = await engine.history(guild.id, user.id);
    expect(receipt.clientSeed).toBe('after_commitment_2026');
    expect(engine.verify(receipt)).toBe(true);
});

test('a failed seed update message leaves old roll controls unable to spend an unseen configuration', async () => {
    const panel = await confirmation();
    const modalPanel = await click(panel, 'seed');
    const customId = modalPanel.showModal.mock.calls[0][0].toJSON().custom_id;
    const failed = interaction(customId, { fields: { getTextInputValue: () => 'new_hidden_seed' },
        editReply: jest.fn().mockRejectedValue(new Error('Discord down')) });
    await expect(hom.modal(failed)).rejects.toThrow('Discord down');
    const before = await disk.read(guild.id);
    const refused = await click(panel, 'roll');
    expect(payload(refused).embeds[0].toJSON().footer.text).toContain('Client seed');
    expect((await disk.read(guild.id)).skinCases[user.id].drops).toEqual(before.skinCases[user.id].drops);
    expect(await engine.history(guild.id, user.id)).toHaveLength(0);
    const resumed = await click(refused, 'pending');
    const success = await click(resumed, 'roll');
    expect(control(success, 'proof')).toBeDefined();
    expect(await engine.history(guild.id, user.id)).toHaveLength(1);
});

test('animation/render/upload failure still displays the durable result', async () => {
    art.renderUpgrade.mockRejectedValueOnce(new Error('ffmpeg failed'));
    const result = await click(await confirmation(), 'roll');
    expect(control(result, 'proof')).toBeDefined();
    expect(await engine.history(guild.id, user.id)).toHaveLength(1);
    art.renderUpgrade.mockResolvedValueOnce({ gif: Buffer.from('gif'), png: Buffer.from('png'), durationMs: 0 });
    const panel = await confirmation();
    const editReply = jest.fn().mockImplementation(async data => { if (data.files) throw new Error('attachment rejected'); });
    const fallback = await click(panel, 'roll', { editReply });
    expect(payload(fallback).files).toBeUndefined();
    expect(control(fallback, 'proof')).toBeDefined();
    expect(await engine.history(guild.id, user.id)).toHaveLength(2);
});

test('filters, multiplier shortcuts and region switch retain valid Discord controls', async () => {
    let panel = await targetPanel();
    const multi = controls(panel).find(item => item.label === '5x');
    panel = await clickId(multi.custom_id);
    expect(payload(panel).embeds[0].toJSON().footer.text).toContain('≥5x');
    panel = await modal(panel, 'filter', { query: 'no-such-skin', wear: 'FT', stattrak: 'no', min: '900', max: '1200' });
    expect(control(panel, 'target')).toBeUndefined();
    panel = await click(panel, 'unfilter');
    expect(control(panel, 'target')).toBeDefined();
    panel = await select(panel, 'target', [control(panel, 'target').options[0].value]);
    panel = await click(panel, 'direction');
    panel = await click(panel, 'review');
    expect((await engine.pending(guild.id, user.id)).direction).toBe('over');
    assertDiscordBounds(panel);
});

test.each([
    ['8'.repeat(45), '9'.repeat(45)],
    [`${'8'.repeat(42)}.50`, `${'9'.repeat(42)}.75`]
])('large filter values reopen within Discord limits without losing precision (%s)', async (min, max) => {
    let panel = await targetPanel();
    const before = await disk.read(guild.id);
    panel = await modal(panel, 'filter', { min, max });
    const fields = modalInputs(await click(panel, 'filter'));
    for (const [name, raw] of [['min', min], ['max', max]]) {
        expect(fields[name].value.length).toBeLessThanOrEqual(fields[name].max_length);
        expect(parseCoins(fields[name].value)).toBe(parseCoins(raw));
    }
    expect(await disk.read(guild.id)).toEqual(before);
});

test('numeric modal values retain ordinary grouping and decimals without changing assets', async () => {
    let panel = await start();
    const before = await disk.read(guild.id);
    panel = await modal(panel, 'settings', { coins: '1,000.50' });
    const settings = modalInputs(await click(panel, 'settings'));
    expect(settings.coins.value).toBe('1,000.50');
    panel = await click(panel, 'targets');
    panel = await modal(panel, 'filter', { min: '1,000.50', max: '2,000.75' });
    const fields = modalInputs(await click(panel, 'filter'));
    expect(fields.min.value).toBe('1,000.50');
    expect(fields.max.value).toBe('2,000.75');
    expect(await disk.read(guild.id)).toEqual(before);
});
