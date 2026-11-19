const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const store = require('../utils/managementStore');
const market = require('../utils/cs2PlayerMarket');
const wallet = require('../commands/taixiu');

const guild = { id: '1', channels: { cache: new Map() } };
const sellerId = '13';
const buyerId = '14';
const otherId = '15';
const drop = { id: '100-1', caseId: 'crate-4904', skinId: 'skin-8d6879f0a2bc', tier: 0, float: 0.15, statTrak: true };
const listingId = '200';
const price = 12575n;
const purchasedAt = Date.UTC(2026, 10, 13, 5, 30);
let root;
let disk;

beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-cs2-market-'));
    disk = store.createManagementStore(root);
    jest.spyOn(store, 'read').mockImplementation(disk.read);
    jest.spyOn(store, 'transact').mockImplementation(disk.transact);
    jest.spyOn(wallet, 'refreshCoinLeaderboard').mockImplementation(() => {});
    await disk.transact(guild.id, async (state, save) => {
        state.taixiu.balances = { [sellerId]: 400, [buyerId]: 200, [otherId]: 300 };
        state.skinCases = { [sellerId]: { drops: [drop], cases: { 'crate-4904': 3 } } };
        await save();
    });
});

afterEach(async () => {
    jest.restoreAllMocks();
    for (const file of await fs.readdir(root)) await fs.unlink(path.join(root, file));
    await fs.rmdir(root);
});

const list = () => market.listSkin(guild.id, sellerId, drop.id, price, listingId);

test('listing prices use the wallet precision and require a positive amount', () => {
    expect(market.parseListingPrice(' 1.234,56 ')).toBe(123456n);
    expect(market.parseListingPrice('1,234.56')).toBe(123456n);
    expect(market.parseListingPrice('0,01')).toBe(1n);
    expect(market.parseListingPrice('12,345,678,901,234,567,890,123,456,789,012')).toBe(1234567890123456789012345678901200n);
    expect(market.parseListingPrice('123456789012345678901234567890123')).toBeNull();
    for (const invalid of ['', '0', '0.00', '-1', '1e3', '0.001', '1,00.2', 12575, null]) {
        expect(market.parseListingPrice(invalid)).toBeNull();
    }
});

test('locking a skin blocks an old listing request without changing the inventory or wallet', async () => {
    await disk.transact(guild.id, async (state, save) => {
        state.skinCases[sellerId].drops[0].locked = true;
        await save();
    });
    const before = await disk.read(guild.id);
    await expect(list()).resolves.toEqual({ status: 'locked' });
    expect(await disk.read(guild.id)).toEqual(before);
    await disk.transact(guild.id, async (state, save) => {
        delete state.skinCases[sellerId].drops[0].locked;
        await save();
    });
    await expect(list()).resolves.toHaveProperty('status', 'listed');
});

test('a persisted listing containing a locked skin cannot be bought and can still be cancelled', async () => {
    await list();
    await disk.transact(guild.id, async (state, save) => {
        state.cs2PlayerMarket[listingId].drop.locked = true;
        await save();
    });
    const before = await disk.read(guild.id);
    expect(market.getListings(before)).toEqual([]);
    await expect(market.buySkin(guild, buyerId, listingId)).resolves.toEqual({ status: 'invalid-listing' });
    expect(await disk.read(guild.id)).toEqual(before);
    await expect(market.cancelListing(guild.id, sellerId, listingId)).resolves.toHaveProperty('status', 'cancelled');
    expect((await disk.read(guild.id)).skinCases[sellerId].drops[0].locked).toBe(true);
});

test('listing escrows an owned drop without changing balances and cancellation returns it once', async () => {
    const before = await disk.read(guild.id);
    await expect(market.listSkin(guild.id, sellerId, drop.id, -1n, listingId)).resolves.toEqual({ status: 'invalid-price' });
    await expect(market.listSkin(guild.id, buyerId, drop.id, price, listingId)).resolves.toEqual({ status: 'not-owned' });
    expect(await disk.read(guild.id)).toEqual(before);

    const result = await list();
    expect(result).toMatchObject({ status: 'listed', listing: { id: listingId, sellerId, price: '12575', drop } });
    const listed = await disk.read(guild.id);
    expect(listed.skinCases[sellerId]).toMatchObject({ drops: [], cases: before.skinCases[sellerId].cases });
    expect(listed.taixiu.balances).toEqual(before.taixiu.balances);
    expect(market.getListings(listed)).toEqual([result.listing]);
    expect(market.getListing(listed, listingId)).toEqual(result.listing);
    await expect(list()).resolves.toEqual({ status: 'duplicate' });
    await expect(market.cancelListing(guild.id, buyerId, listingId)).resolves.toEqual({ status: 'forbidden' });
    expect(await disk.read(guild.id)).toEqual(listed);

    await expect(market.cancelListing(guild.id, sellerId, listingId)).resolves.toEqual({ status: 'cancelled', listing: result.listing });
    const cancelled = await disk.read(guild.id);
    expect(cancelled.skinCases[sellerId].drops).toEqual([{ ...drop, inventoryRevision: listingId }]);
    expect(cancelled.taixiu.balances).toEqual(before.taixiu.balances);
    expect(market.getListings(cancelled)).toEqual([]);
    await expect(list()).resolves.toEqual({ status: 'duplicate' });
    await expect(market.cancelListing(guild.id, sellerId, listingId)).resolves.toEqual({ status: 'not-found' });
    expect(await disk.read(guild.id)).toEqual(cancelled);
});

test('one concurrent buyer wins and both wallet changes and the same drop persist atomically', async () => {
    const ranking = jest.spyOn(wallet, 'refreshCoinLeaderboard');
    await list();
    jest.spyOn(Date, 'now').mockReturnValue(purchasedAt);
    const [purchase, late] = await Promise.all([
        market.buySkin(guild, buyerId, listingId), market.buySkin(guild, otherId, listingId)
    ]);
    const acquired = { ...drop, acquiredAt: purchasedAt, inventoryRevision: listingId };
    expect(purchase).toMatchObject({ status: 'bought', balance: 7425n, listing: { sellerId, drop }, drop: acquired });
    expect(purchase.listing.drop).toEqual(drop);
    expect(late).toEqual({ status: 'not-found' });
    const bought = await disk.read(guild.id);
    expect(bought.taixiu.balances).toEqual({ [sellerId]: '525.75', [buyerId]: '74.25', [otherId]: 300 });
    expect(bought.skinCases[sellerId].drops).toEqual([]);
    expect(bought.skinCases[buyerId].drops).toEqual([acquired]);
    expect(bought.skinCases[otherId]).toBeUndefined();
    expect(market.getListing(bought, listingId)).toBeNull();
    expect(ranking).toHaveBeenCalledTimes(1);
    expect(ranking).toHaveBeenCalledWith(guild, expect.objectContaining({ taixiu: expect.objectContaining({
        balances: { [sellerId]: '525.75', [buyerId]: '74.25' }
    }) }), { sections: ['cs2PlayerMarket'], wallets: [buyerId, sellerId], inventory: [buyerId, sellerId] });
    await expect(market.cancelListing(guild.id, sellerId, listingId)).resolves.toEqual({ status: 'not-found' });
    expect(await disk.read(guild.id)).toEqual(bought);
});

test('escrow cancellation keeps the original acquisition date while purchase sets the new owner date', async () => {
    const sellerDrop = { ...drop, paintSeed: 0, acquiredAt: purchasedAt - 86_400_000 };
    await disk.transact(guild.id, async (state, save) => {
        state.skinCases[sellerId].drops = [sellerDrop];
        await save();
    });
    jest.spyOn(Date, 'now').mockReturnValue(purchasedAt);
    const listed = await list();
    expect(listed.listing.drop).toEqual(sellerDrop);
    await market.cancelListing(guild.id, sellerId, listingId);
    const returnedDrop = { ...sellerDrop, inventoryRevision: listingId };
    expect((await disk.read(guild.id)).skinCases[sellerId].drops).toEqual([returnedDrop]);

    const relistedId = '201';
    await market.listSkin(guild.id, sellerId, drop.id, price, relistedId);
    const bought = await market.buySkin(guild, buyerId, relistedId);
    expect(bought.drop).toEqual({ ...sellerDrop, acquiredAt: purchasedAt, inventoryRevision: relistedId });
    expect(bought.listing.drop).toEqual(returnedDrop);
    expect((await disk.read(guild.id)).skinCases[buyerId].drops).toEqual([bought.drop]);
});

test('uses only spendable guild funds and rejects self purchases and corrupt prices', async () => {
    await list();
    await disk.transact(guild.id, async (state, save) => {
        state.taixiu.balances[buyerId] = '50.25';
        state.taixiu.round = { bets: { [buyerId]: { tai: 250, xiu: 0 } } };
        await save();
    });
    const before = await disk.read(guild.id);
    await expect(market.buySkin(guild, buyerId, listingId)).resolves.toEqual({ status: 'insufficient-funds', balance: 5025n });
    await expect(market.buySkin(guild, sellerId, listingId)).resolves.toEqual({ status: 'self-purchase' });
    await expect(market.buySkin('2', buyerId, listingId)).resolves.toEqual({ status: 'not-found' });
    expect(await disk.read(guild.id)).toEqual(before);

    await disk.transact(guild.id, async (state, save) => {
        state.cs2PlayerMarket[listingId].price = '-12575';
        await save();
    });
    const corrupt = await disk.read(guild.id);
    expect(market.getListing(corrupt, listingId)).toBeNull();
    await expect(market.buySkin(guild, buyerId, listingId)).resolves.toEqual({ status: 'invalid-listing' });
    expect(await disk.read(guild.id)).toEqual(corrupt);
    await expect(market.cancelListing(guild.id, sellerId, listingId)).resolves.toMatchObject({ status: 'cancelled' });
    expect((await disk.read(guild.id)).skinCases[sellerId].drops).toEqual([{ ...drop, inventoryRevision: listingId }]);
});

test('a failed write leaves escrow and wallets intact, and a post-save ranking failure does not undo a purchase', async () => {
    await list();
    const before = await disk.read(guild.id);
    store.transact.mockImplementationOnce((guildId, operation) => disk.transact(guildId, state =>
        operation(state, async () => { throw new Error('disk full'); })));
    await expect(market.buySkin(guild, buyerId, listingId)).rejects.toThrow('disk full');
    expect(await disk.read(guild.id)).toEqual(before);

    jest.spyOn(wallet, 'refreshCoinLeaderboard').mockImplementationOnce(() => { throw new Error('ranking unavailable'); });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(Date, 'now').mockReturnValue(purchasedAt);
    await expect(market.buySkin(guild, buyerId, listingId)).resolves.toMatchObject({ status: 'bought', balance: 7425n });
    const saved = await disk.read(guild.id);
    expect(saved.skinCases[buyerId].drops).toEqual([{ ...drop, acquiredAt: purchasedAt, inventoryRevision: listingId }]);
    expect(market.getListing(saved, listingId)).toBeNull();
});

test('scoped trading preserves other inventories, game metadata and server settings', async () => {
    await disk.transact(guild.id, async (state, save) => {
        state.settings = { privateChannel: '77' };
        state.taixiu.round = { id: 'round', bets: { [otherId]: { tai: 10, xiu: 0 } } };
        state.skinCases[otherId] = { drops: [{ ...drop, id: 'unrelated' }], cases: { 'crate-4904': 12 }, inventorySort: 'newest' };
        await save();
    });
    const initial = await disk.read(guild.id);
    await list();
    await market.buySkin(guild, buyerId, listingId);
    const saved = await disk.read(guild.id);
    expect(saved.settings).toEqual(initial.settings);
    expect(saved.taixiu.round).toEqual(initial.taixiu.round);
    expect(saved.taixiu.balances[otherId]).toBe(initial.taixiu.balances[otherId]);
    expect(saved.skinCases[otherId]).toEqual(initial.skinCases[otherId]);
    for (const [, , scope] of store.transact.mock.calls) {
        expect(scope.inventory).not.toContain(otherId);
        expect(scope.inventory).not.toBe('all');
        expect(scope.wallets).not.toBe('all');
    }
});

test('checkout revalidates the seller after resolving the scoped participants', async () => {
    await list();
    store.read.mockImplementationOnce(async (guildId, scope) => {
        const original = await disk.read(guildId, scope);
        await disk.transact(guildId, async (state, save) => {
            state.cs2PlayerMarket[listingId].sellerId = otherId;
            await save();
        });
        return original;
    });
    const balances = (await disk.read(guild.id)).taixiu.balances;
    await expect(market.buySkin(guild, buyerId, listingId)).resolves.toEqual({ status: 'invalid-listing' });
    const state = await disk.read(guild.id);
    expect(state.taixiu.balances).toEqual(balances);
    expect(state.skinCases[buyerId]).toBeUndefined();
    expect(state.cs2PlayerMarket[listingId].sellerId).toBe(otherId);
});
