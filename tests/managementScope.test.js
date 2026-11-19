const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createManagementStore } = require('../utils/managementStore');

let directory;
let store;
beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-scoped-store-'));
    store = createManagementStore(directory);
    await store.transact('1', async (state, save) => {
        state.settings.taixiuRoom = '10';
        state.taixiu.balances = { 11: 1000, 12: 2500 };
        state.taixiu.round = { id: 'round', bets: {} };
        state.skinCases = {
            11: { cases: { a: 2 }, drops: [{ id: 'first', locked: true }] },
            12: { cases: { b: 4 }, drops: [{ id: 'other', locked: false }] }
        };
        state.cs2Battles = { room: { status: 'waiting' } };
        await save();
    });
});
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

test('economy scope excludes inventory and unrelated state while preserving them on save', async () => {
    const scope = { sections: ['settings', 'taixiu'], wallets: 'all' };
    const before = await store.read('1');
    const partial = await store.read('1', scope);
    expect(partial.settings).toEqual(before.settings);
    expect(partial.taixiu).toEqual(before.taixiu);
    expect(partial.skinCases).toBeUndefined();
    expect(partial.cs2Battles).toBeUndefined();
    await store.transact('1', async (state, save) => {
        state.taixiu.balances['11'] = 975;
        state.taixiu.round.bets['11'] = { tai: 25 };
        await save();
        delete state.settings.taixiuRoom;
        await save();
    }, scope);
    const after = await store.read('1');
    expect(after.taixiu.balances).toEqual({ 11: 975, 12: 2500 });
    expect(after.settings).toEqual({});
    expect(after.skinCases).toEqual(before.skinCases);
    expect(after.cs2Battles).toEqual(before.cs2Battles);
});

test('one user inventory scope supports addition and deletion without losing other users', async () => {
    const scope = { wallets: ['11'], inventory: ['11'] };
    const before = await store.read('1');
    await store.transact('1', async (state, save) => {
        expect(state.taixiu.balances).toEqual({ 11: 1000 });
        expect(Object.keys(state.skinCases)).toEqual(['11']);
        state.skinCases['11'].drops = [{ id: 'new' }];
        state.taixiu.balances['11'] = 900;
        await save();
    }, scope);
    expect((await store.read('1')).skinCases).toEqual({
        11: { cases: { a: 2 }, drops: [{ id: 'new' }] }, 12: before.skinCases['12']
    });
    await store.transact('1', async (state, save) => {
        delete state.skinCases;
        delete state.taixiu.balances['11'];
        await save();
    }, scope);
    const after = await store.read('1');
    expect(after.skinCases).toEqual({ 12: before.skinCases['12'] });
    expect(after.taixiu).toEqual({ ...before.taixiu, balances: { 12: 2500 } });
});

test('partial scope can create a first stash and rejects writes to unloaded owners or sections', async () => {
    const scope = { wallets: ['13'], inventory: ['13'] };
    await store.transact('1', async (state, save) => {
        state.skinCases = { 13: { drops: [{ id: 'initial' }] } };
        state.taixiu.balances['13'] = 123;
        await save();
    }, scope);
    for (const mutate of [
        state => { state.taixiu.balances['12'] = 0; },
        state => { state.settings.changed = true; },
        state => { state.skinCases['12'] = { drops: [] }; }
    ]) await expect(store.transact('1', async (state, save) => { mutate(state); await save(); }, scope))
        .rejects.toThrow('outside management scope');
    const after = await store.read('1');
    expect(after.taixiu.balances).toEqual({ 11: 1000, 12: 2500, 13: 123 });
    expect(after.skinCases['12'].drops).toEqual([{ id: 'other', locked: false }]);
    expect(after.skinCases['13'].drops).toEqual([{ id: 'initial' }]);
    expect(after.settings).toEqual({ taixiuRoom: '10' });
});

test('invalid or misspelled scopes cannot silently fall back to loading all data', async () => {
    await expect(store.read('1', { wallet: ['11'] })).rejects.toThrow('Invalid management scope');
    await expect(store.read('1', { sections: ['skinCases'] })).rejects.toThrow('inventory scope');
    await expect(store.read('1', null)).rejects.toThrow('Invalid management scope');
});

test('unloaded malformed wallets and inventories neither block scoped actions nor get rewritten', async () => {
    await store.transact('1', async (state, save) => {
        state.taixiu.balances['12'] = 'malformed';
        state.skinCases['12'].drops = [{ legacyItemWithoutId: true }];
        await save();
    });
    const scope = { wallets: ['11'], inventory: ['11'] };
    expect((await store.read('1', scope)).taixiu.balances).toEqual({ 11: 1000 });
    await store.transact('1', async (state, save) => {
        state.taixiu.balances['11'] = 1250;
        state.skinCases['11'].drops = [];
        await save();
    }, scope);
    const saved = await store.read('1');
    expect(saved.taixiu.balances).toEqual({ 11: 1250, 12: 'malformed' });
    expect(saved.skinCases['12'].drops).toEqual([{ legacyItemWithoutId: true }]);
    expect(saved.skinCases['11'].drops).toEqual([]);
});
