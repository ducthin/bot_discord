const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const hom = require('../commands/hom');
const store = require('../utils/managementStore');
const market = require('../utils/cs2Market');
const reel = require('../utils/cs2Reel');
const { customCasesById, casePricing } = require('../utils/cs2BattleCases');
const { containersById } = require('../utils/cs2Catalogue');
const { readCoins } = require('../utils/coins');

const userId = '101';
const guild = { id: '1' };
let directory, disk, nextId;

beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-battle-collection-return-'));
    disk = store.createManagementStore(directory);
    nextId = 1_799_999_999_999_900_000n;
    jest.spyOn(store, 'read').mockImplementation(disk.read);
    jest.spyOn(store, 'transact').mockImplementation(disk.transact);
    jest.spyOn(reel, 'warmCaseReel').mockResolvedValue();
    jest.spyOn(market, 'peekMarketQuote').mockReturnValue({ priceVnd: 100, observedAt: Date.now() });
    jest.spyOn(market, 'peekMarketDisplay').mockReturnValue({ status: 'snapshot-missing', quote: null });
    jest.spyOn(crypto, 'randomInt').mockImplementation((min, max) => max == null ? min === 10_000 ? 9999 : 0 : min);
    await disk.transact(guild.id, async (state, save) => {
        state.taixiu.balances[userId] = 500_000;
        await save();
    });
});

afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(directory, { recursive: true, force: true });
});

function request(customId) {
    return { id: String(++nextId), customId, guild, guildId: guild.id, channelId: '20',
        user: { id: userId }, attachmentSizeLimit: 0, message: { id: 'private-builder' },
        reply: jest.fn(), deferReply: jest.fn(), deferUpdate: jest.fn(), editReply: jest.fn(), followUp: jest.fn() };
}
const payload = interaction => interaction.editReply.mock.calls.at(-1)?.[0];
const control = (panel, label) => panel.components.flatMap(row => row.toJSON().components)
    .find(component => component.label === label);
async function click(customId) {
    const interaction = request(customId);
    await hom.button(interaction);
    return interaction;
}

function validComponents(panel) {
    for (const row of panel.components) for (const component of row.toJSON().components) {
        if (component.custom_id) expect(component.custom_id.length).toBeLessThanOrEqual(100);
    }
}

test.each([
    ['battle-howl', 'special-contraband'],
    ['battle-archive-cobblestone', 'collection-set-cobblestone'],
    ['battle-balance', null]
])('%s returns from its actual solo prize to the same Battle case and opens again', async (caseId, expectedSource) => {
    const item = customCasesById.get(caseId);
    const pricing = casePricing(item);
    const builder = await click(`mg_hom_battle-new_crate-4904_${caseId}`);
    const solo = await click(control(payload(builder), 'Mở lẻ').custom_id);
    const state = await disk.read(guild.id);
    validComponents(payload(solo));
    const [drop] = state.skinCases[userId].drops;
    if (expectedSource) expect(drop.caseId).toBe(expectedSource);
    const source = containersById.get(drop.caseId);
    const backId = control(payload(solo), 'Về hòm Battle').custom_id;
    expect(backId).toBe(`mg_hom_battle-new_${source.key ? source.id : 'crate-4904'}_${caseId}`);

    const returned = await click(backId);
    expect(returned.reply).not.toHaveBeenCalled();
    expect(payload(returned).embeds[0].data.title).toContain(item.name);
    const select = payload(returned).components.flatMap(row => row.toJSON().components)
        .find(component => component.custom_id?.startsWith('mg_hom_battle-preview_'));
    expect(select.options.find(option => option.default).value).toBe(caseId);
    expect(await disk.read(guild.id)).toEqual(state);

    // Editing the returned draft never purchases an extra opening.
    const added = await click(control(payload(returned), 'Thêm ×1').custom_id);
    expect(payload(added).embeds[0].data.fields.find(field => field.name.startsWith('Số vòng')).name).toContain('1/100');
    expect(await disk.read(guild.id)).toEqual(state);
    const reopened = await click(control(payload(added), 'Mở lẻ').custom_id);
    expect(payload(reopened).embeds[0].data.title).toBeTruthy();
    const final = await disk.read(guild.id);
    expect(final.skinCases[userId].drops).toHaveLength(2);
    expect(final.skinCases[userId].drops.every(drop => drop.battleCaseId === caseId)).toBe(true);
    expect(readCoins(final.taixiu.balances[userId])).toBe(50_000_000n - 2n * pricing.fee);
});

test.each(['1799999999999900000-30-10', '7d4523ac-ec27-4dd3-93f5-414db9d2fc3e-upgrade'])(
    'collection prize %s has valid controls through inspect, sale, lock and market navigation', async dropId => {
        const item = customCasesById.get('battle-archive-gods-and-monsters');
        const entry = item.entries.at(-1);
        const drop = { ...entry.drop, id: dropId, float: entry.min / 1_000_000,
            battleCaseId: item.id, acquiredAt: Date.now() };
        await disk.transact(guild.id, async (state, save) => {
            (state.skinCases ??= {})[userId] = { drops: [drop] };
            await save();
        });
        const quote = { priceVnd: 1_234_567_890, observedAt: Date.now() - 1000,
            expiresAt: Date.now() + 60_000, source: 'buff', phase: null };
        market.peekMarketQuote.mockReturnValue(quote);
        market.peekMarketDisplay.mockReturnValue({ status: 'fresh', quote });
        const inspect = request('mg_hom_inventory-select_crate-4904_0');
        inspect.values = [`drop_${dropId}`];
        await hom.select(inspect);
        validComponents(payload(inspect));
        expect(payload(inspect).embeds[0].data.title).toContain('AWP | Medusa');

        const selling = await click(control(payload(inspect), 'Bán lấy xu').custom_id);
        validComponents(payload(selling));
        expect(control(payload(selling), 'Xác nhận bán')).toBeDefined();
        const cancelled = await click(control(payload(selling), 'Hủy').custom_id);
        validComponents(payload(cancelled));
        const locked = await click(control(payload(cancelled), '🔒 Khóa món').custom_id);
        validComponents(payload(locked));
        expect((await disk.read(guild.id)).skinCases[userId].drops[0]).toMatchObject({ id: dropId, locked: true, caseId: drop.caseId });
        const unlocked = await click(control(payload(locked), '🔓 Mở khóa món').custom_id);
        validComponents(payload(unlocked));
        const listing = request(control(payload(unlocked), 'Đăng bán ở chợ').custom_id);
        listing.showModal = jest.fn();
        await hom.button(listing);
        const form = listing.showModal.mock.calls[0][0].toJSON();
        expect(form.custom_id.length).toBeLessThanOrEqual(100);
        expect(form.title).toContain('Đăng bán');
        const sale = await click(control(payload(unlocked), 'Bán lấy xu').custom_id);
        const confirmed = await click(control(payload(sale), 'Xác nhận bán').custom_id);
        validComponents(payload(confirmed));
        expect((await disk.read(guild.id)).skinCases[userId].drops).toHaveLength(0);
    });
