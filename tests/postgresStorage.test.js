const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { readCoins, serializeCoins } = require('../utils/coins');

const execute = promisify(execFile);
// Integration tests must use a disposable database, never the bot's DATABASE_URL.
const connectionString = process.env.TEST_DATABASE_URL;
const integration = connectionString ? describe : describe.skip;

integration('PostgreSQL persistence against a disposable database', () => {
    let first;
    let second;
    let store;
    let otherStore;

    beforeAll(async () => {
        const { createDatabase } = require('../utils/database');
        const { createPostgresManagementStore } = require('../utils/managementStore');
        first = createDatabase({ connectionString, max: 4 });
        second = createDatabase({ connectionString, max: 4 });
        await first.initialize();
        await second.initialize();
        store = createPostgresManagementStore(first);
        otherStore = createPostgresManagementStore(second);
    });

    beforeEach(async () => { await first.reset(); });
    afterEach(() => { jest.restoreAllMocks(); });
    afterAll(async () => {
        await Promise.allSettled([first?.close(), second?.close()]);
    });

    test('starts with empty PostgreSQL state and rejects invalid guild IDs', async () => {
        const state = await store.read('1');
        expect(state.taixiu).toEqual({ balances: {}, round: null });
        expect(state.settings).toEqual({});
        expect(state.skinCases).toBeUndefined();
        expect(state.cs2Battles).toBeUndefined();
        await expect(store.read('../1')).rejects.toThrow('Invalid guild ID');
    });

    test('scoped queries transfer no inventory rows for Tiệm Bánh and only one owner for a case action', async () => {
        await store.transact('1', async (state, save) => {
            state.settings.taixiuRoom = '20';
            state.taixiu.balances = { 11: 1000, 12: 2000 };
            state.skinCases = {
                11: { drops: [{ id: 'mine' }] },
                12: { drops: Array.from({ length: 1000 }, (_, index) => ({ id: `other-${index}` })) }
            };
            state.cs2Battles = { preserve: { status: 'waiting' } };
            await save();
        });
        const counts = [];
        const { createPostgresManagementStore } = require('../utils/managementStore');
        const measured = createPostgresManagementStore({ ...first, query: async (...args) => {
            const result = await first.query(...args);
            counts.push({ total: result.rows.length, inventory: result.rows.filter(row => row.kind === 'inventory').length });
            return result;
        } });
        await measured.read('1');
        const gameScope = { sections: ['settings', 'taixiu'], wallets: 'all' };
        const game = await measured.read('1', gameScope);
        const personalScope = { wallets: ['11'], inventory: ['11'] };
        const personal = await measured.read('1', personalScope);
        expect(counts[0].inventory).toBe(1001);
        expect(counts[1].inventory).toBe(0);
        expect(counts[1].total).toBeLessThan(10);
        expect(counts[2]).toEqual({ total: 3, inventory: 1 });
        expect(game.skinCases).toBeUndefined();
        expect(personal.taixiu.balances).toEqual({ 11: 1000 });
        expect(personal.skinCases).toEqual({ 11: { drops: [{ id: 'mine' }] } });

        await store.transact('1', async (state, save) => {
            state.taixiu.balances['11'] = 900;
            state.skinCases['11'].drops = [{ id: 'new' }];
            await save();
        }, personalScope);
        await otherStore.transact('1', async (state, save) => {
            state.taixiu.balances['12'] = 1950;
            state.taixiu.round = { id: 'round', bets: { 12: { tai: 50 } } };
            await save();
        }, gameScope);
        const saved = await store.read('1');
        expect(saved.taixiu.balances).toEqual({ 11: 900, 12: 1950 });
        expect(saved.skinCases['11'].drops).toEqual([{ id: 'new' }]);
        expect(saved.skinCases['12'].drops).toHaveLength(1000);
        expect(saved.cs2Battles.preserve).toEqual({ status: 'waiting' });
    });

    test('scoped and full transactions keep a shared lock and scoped deletion preserves unloaded data', async () => {
        await store.transact('1', async (state, save) => {
            state.taixiu.balances = { 11: 1000, 12: 2000 };
            state.skinCases = { 11: { drops: [{ id: 'mine' }] }, 12: { drops: [{ id: 'other' }] } };
            await save();
        });
        const scope = { wallets: ['11'], inventory: ['11'] };
        await Promise.all(Array.from({ length: 10 }, (_, index) => (index % 2 ? store : otherStore).transact('1', async (state, save) => {
            state.taixiu.balances['11'] += 1;
            await save();
        }, index % 2 ? scope : undefined)));
        expect((await store.read('1')).taixiu.balances['11']).toBe(1010);
        await expect(store.transact('1', async (state, save) => {
            state.taixiu.balances['12'] = 0;
            await save();
        }, scope)).rejects.toThrow('outside management scope');
        await store.transact('1', async (state, save) => {
            delete state.skinCases;
            delete state.taixiu.balances['11'];
            await save();
        }, scope);
        const saved = await otherStore.read('1');
        expect(saved.taixiu.balances).toEqual({ 12: 2000 });
        expect(saved.skinCases).toEqual({ 12: { drops: [{ id: 'other' }] } });
        await store.transact('1', async (state, save) => {
            state.skinCases = { 13: { drops: [{ id: 'new-owner' }] } };
            await save();
        }, { inventory: ['13'] });
        expect((await store.read('1')).skinCases['13'].drops).toEqual([{ id: 'new-owner' }]);
    });

    test('serializes the same guild across independent connection pools', async () => {
        await Promise.all(Array.from({ length: 20 }, (_, index) =>
            (index % 2 ? store : otherStore).transact('1', async (state, save) => {
                state.taixiu.balances['13'] = serializeCoins(readCoins(state.taixiu.balances['13'] ?? 0) + 1n);
                await save();
            })));
        expect(readCoins((await store.read('1')).taixiu.balances['13'])).toBe(20n);
        expect((await store.read('2')).taixiu.balances).toEqual({});
    });

    test('rolls back a failed wallet and inventory operation together', async () => {
        await store.transact('1', async (state, save) => {
            state.taixiu.balances['13'] = 1000;
            state.skinCases = { 13: { drops: [{ id: 'original', locked: true }] } };
            await save();
        });
        await expect(otherStore.transact('1', async (state, save) => {
            state.taixiu.balances['13'] = 0;
            state.skinCases['13'].drops = [];
            await save();
            throw new Error('simulated settlement failure');
        })).rejects.toThrow('simulated settlement failure');
        const state = await store.read('1');
        expect(state.taixiu.balances['13']).toBe(1000);
        expect(state.skinCases['13'].drops).toEqual([{ id: 'original', locked: true }]);
    });

    test('rejects a swallowed SQL error instead of reporting an aborted transaction as success', async () => {
        await store.transact('1', async (state, save) => {
            state.taixiu.balances['13'] = 1000;
            await save();
        });
        let transactionClient;
        const { createPostgresManagementStore } = require('../utils/managementStore');
        const failingStore = createPostgresManagementStore({ ...first, transaction: (scope, operation) => first.transaction(scope, client => {
            transactionClient = client;
            return operation(client);
        }) });
        await expect(failingStore.transact('1', async (state, save) => {
            state.taixiu.balances['13'] = 0;
            await save();
            try { await transactionClient.query('SELECT 1 / 0'); } catch { /* The caller accidentally ignores the SQL failure. */ }
            return 'incorrect success';
        })).rejects.toThrow();
        expect((await otherStore.read('1')).taixiu.balances['13']).toBe(1000);
    });

    test('a busy guild does not hold transactions for another guild', async () => {
        let release;
        let entered;
        const gate = new Promise(resolve => { release = resolve; });
        const ready = new Promise(resolve => { entered = resolve; });
        const busy = store.transact('1', async (state, save) => {
            entered();
            await gate;
            state.activity.roomsOpened++;
            await save();
        });
        await ready;
        let timeout;
        const independent = otherStore.transact('2', async (state, save) => {
            state.activity.roomsOpened = 8;
            await save();
        });
        try {
            await Promise.race([independent, new Promise((_, reject) => {
                timeout = setTimeout(() => reject(new Error('unrelated guild was blocked')), 2000);
            })]);
            expect((await otherStore.read('2')).activity.roomsOpened).toBe(8);
        } finally {
            clearTimeout(timeout);
            release();
            await Promise.allSettled([busy, independent]);
        }
        expect((await store.read('1')).activity.roomsOpened).toBe(1);
    });

    test('only persists saved changes and preserves deletions', async () => {
        await store.transact('1', async state => { state.settings.unsaved = true; });
        expect((await store.read('1')).settings).toEqual({});
        await store.transact('1', async (state, save) => {
            state.settings.rooms = { lobbyId: '10' };
            state.cs2Battles = { first: { status: 'waiting' }, second: { status: 'finished' } };
            await save();
        });
        await otherStore.transact('1', async (state, save) => {
            delete state.settings.rooms;
            delete state.cs2Battles.first;
            await save();
        });
        const state = await store.read('1');
        expect(state.settings).toEqual({});
        expect(state.cs2Battles).toEqual({ second: { status: 'finished' } });
    });

    test('persists an active game round being replaced by JSON null', async () => {
        await store.transact('1', async (state, save) => {
            state.taixiu.round = { id: '110', channelId: '20', bets: { 13: { tai: 100, xiu: 0 } } };
            await save();
        });
        expect((await otherStore.read('1')).taixiu.round.id).toBe('110');
        await otherStore.transact('1', async (state, save) => { state.taixiu.round = null; await save(); });
        expect((await store.read('1')).taixiu.round).toBeNull();
        const stored = await first.query('SELECT data FROM discord_bot.guild_records WHERE guild_id=$1 AND section=$2 AND entry_key=$3',
            ['1', 'taixiu', 'round']);
        expect(stored.rows).toEqual([{ data: null }]);
    });

    test('persists inventory order and locks and removes sold items', async () => {
        await store.transact('1', async (state, save) => {
            state.skinCases = { 13: { selectedSort: 'price-desc', drops: [
                { id: 'later', locked: true, float: 0.123 }, { id: 'earlier', locked: false, float: 0.001 }
            ] } };
            await save();
        });
        const initial = (await otherStore.read('1')).skinCases['13'];
        expect(initial.selectedSort).toBe('price-desc');
        expect(initial.drops.map(drop => drop.id)).toEqual(['later', 'earlier']);
        expect(initial.drops[0].locked).toBe(true);
        await otherStore.transact('1', async (state, save) => {
            state.skinCases['13'].drops = state.skinCases['13'].drops.filter(drop => drop.id !== 'earlier');
            await save();
        });
        expect((await store.read('1')).skinCases['13'].drops).toEqual([{ id: 'later', locked: true, float: 0.123 }]);
    });

    test('preserves exact large coins, hourly claims and Battle result data across initialization', async () => {
        const balance = '100000000000000000000000.99';
        const record = { status: 'finished', pool: '80000', payouts: { 13: '40000' }, unclaimedPayout: '40000' };
        await store.transact('1', async (state, save) => {
            state.taixiu.balances['13'] = balance;
            state.taixiu.dailyClaimTimes = { 13: 1794729600000 };
            state.cs2Battles = { room: record };
            state.cs2BattleResultMessages = { room: { channelId: '20', messageId: '30', deleteAt: 1794730200000 } };
            await save();
        });
        const { createDatabase } = require('../utils/database');
        const { createPostgresManagementStore } = require('../utils/managementStore');
        const restarted = createDatabase({ connectionString, max: 1 });
        let state;
        try {
            await restarted.initialize();
            state = await createPostgresManagementStore(restarted).read('1');
        } finally { await restarted.close(); }
        expect(state.taixiu.balances['13']).toBe(balance);
        expect(readCoins(state.taixiu.balances['13'])).toBe(10000000000000000000000099n);
        expect(state.taixiu.dailyClaimTimes).toEqual({ 13: 1794729600000 });
        expect(state.cs2Battles.room).toEqual(record);
        expect(state.cs2BattleResultMessages.room.deleteAt).toBe(1794730200000);
        const wallet = await first.query('SELECT amount_units::text AS amount FROM discord_bot.wallets WHERE guild_id=$1 AND user_id=$2', ['1', '13']);
        expect(wallet.rows[0].amount).toBe('10000000000000000000000099');
    });

    test('coordinates wallet updates from another Node process', async () => {
        const childCode = `
            const { createDatabase } = require('./utils/database');
            const { createPostgresManagementStore } = require('./utils/managementStore');
            const { readCoins, serializeCoins } = require('./utils/coins');
            (async () => {
                const database = createDatabase({ connectionString: process.env.TEST_DATABASE_URL, max: 2 });
                try {
                    await database.initialize();
                    const store = createPostgresManagementStore(database);
                    for (let index = 0; index < 10; index++) await store.transact('1', async (state, save) => {
                        state.taixiu.balances['13'] = serializeCoins(readCoins(state.taixiu.balances['13'] ?? 0) + 1n);
                        await save();
                    });
                } finally { await database.close(); }
            })().catch(error => { console.error(error.message); process.exitCode = 1; });
        `;
        await Promise.all([
            execute(process.execPath, ['-e', childCode], { cwd: require('node:path').join(__dirname, '..'), windowsHide: true,
                env: { ...process.env, TEST_DATABASE_URL: connectionString }, timeout: 30000 }),
            ...Array.from({ length: 10 }, () => store.transact('1', async (state, save) => {
                state.taixiu.balances['13'] = serializeCoins(readCoins(state.taixiu.balances['13'] ?? 0) + 1n);
                await save();
            }))
        ]);
        expect(readCoins((await store.read('1')).taixiu.balances['13'])).toBe(20n);
    }, 35000);

    test('eight-hour check-in requests award 5,000,000 coins only once through PostgreSQL', async () => {
        const management = require('../utils/managementStore');
        const wallet = require('../commands/taixiu');
        jest.spyOn(management, 'transact').mockImplementation(store.transact);
        const clock = jest.spyOn(Date, 'now').mockReturnValue(1794729600000);
        await store.transact('1', async (state, save) => { state.taixiu.balances['13'] = 0; await save(); });
        const guild = { id: '1' };
        const request = () => ({ guild, user: { id: '13' }, deferReply: jest.fn(), editReply: jest.fn() });
        await Promise.all([wallet.claimDaily(request()), wallet.claimDaily(request()), wallet.claimDaily(request())]);
        expect((await otherStore.read('1')).taixiu.balances['13']).toBe(5000000);
        clock.mockReturnValue(1794729600000 + 28_800_000 - 1);
        await wallet.claimDaily(request());
        expect((await otherStore.read('1')).taixiu.balances['13']).toBe(5000000);
        clock.mockReturnValue(1794729600000 + 28_800_000);
        await wallet.claimDaily(request());
        expect((await otherStore.read('1')).taixiu.balances['13']).toBe(10000000);
    });

    test.each(['regular', 'crazy'])('%s team Battle pays the human half once through PostgreSQL', async mode => {
        const crypto = require('node:crypto');
        const management = require('../utils/managementStore');
        const market = require('../utils/cs2Market');
        const battle = require('../utils/cs2Battles');
        const { customCases, casePricing, lockCasePricing } = require('../utils/cs2BattleCases');
        jest.spyOn(management, 'read').mockImplementation(store.read);
        jest.spyOn(management, 'transact').mockImplementation(store.transact);
        const item = customCases[0];
        const highPriceName = item.entries[0].ref.name;
        jest.spyOn(market, 'peekMarketQuote').mockImplementation(name => ({ priceVnd: name === highPriceName ? 300 : 100 }));
        const pricing = casePricing(item, entry => entry.ref.name === highPriceName ? 300 : 100);
        const ticketFor = value => {
            const index = pricing.values.indexOf(value);
            expect(index).toBeGreaterThanOrEqual(0);
            return pricing.entries.slice(0, index).reduce((sum, entry) => sum + entry.weight, 0);
        };
        const low = ticketFor(100);
        const high = ticketFor(300);
        // New rooms roll A1, A2, B1, B2, so the two A positions share the winning draws.
        const tickets = mode === 'regular' ? [high, high, low, low] : [low, low, high, high];
        let draws = 0;
        jest.spyOn(crypto, 'randomInt').mockImplementation((max, upper) => {
            if (upper != null) return max;
            return max === 10000 ? tickets[draws++] : 0;
        });
        await store.transact('1', async (state, save) => { state.taixiu.balances['13'] = 1000; await save(); });
        const guild = { id: '1' };
        const created = await battle.createRoom('1', { id: `pg-${mode}`, channelId: '20', hostId: '13', caseIds: [item.id],
            format: 'teams', mode, tieRule: 'split', expectedPrices: { [item.id]: lockCasePricing(pricing) } });
        expect(created.error).toBeUndefined();
        const act = () => battle.actOnRoom(guild, '20', created.room.id, '13', 'bot-start');
        const attempts = await Promise.all([act(), act()]);
        expect(attempts.filter(attempt => attempt.started)).toHaveLength(1);
        const result = attempts.find(attempt => attempt.started).room;
        expect(result).toMatchObject({ status: 'finished', tie: false, pool: '80000', payouts: { 13: '40000' }, unclaimedPayout: '40000' });
        const state = await otherStore.read('1');
        expect(readCoins(state.taixiu.balances['13'])).toBe(100000n - BigInt(created.room.fee) + 40000n);
        expect(state.skinCases).toBeUndefined();
        for (const bot of result.players.filter(player => player.isBot)) {
            expect(state.taixiu.balances[bot.id]).toBeUndefined();
            expect(state.cs2BattleHistory[bot.id]).toBeUndefined();
        }
        await act();
        expect((await otherStore.read('1')).taixiu).toEqual(state.taixiu);
        expect(draws).toBe(4);
    });

    test('explicit reset empties bot records while preserving other database schemas', async () => {
        const sentinel = 'discord_bot_reset_test';
        await first.query(`CREATE TABLE IF NOT EXISTS public.${sentinel} (id integer PRIMARY KEY)`);
        try {
            await first.query(`INSERT INTO public.${sentinel} (id) VALUES (1) ON CONFLICT DO NOTHING`);
            await store.transact('1', async (state, save) => {
                state.taixiu.balances['13'] = 500000;
                state.skinCases = { 13: { drops: [{ id: 'reset-me' }] } };
                state.cs2Battles = { room: { status: 'waiting' } };
                await save();
            });
            await first.reset();
            const state = await otherStore.read('1');
            expect(state.taixiu.balances).toEqual({});
            expect(state.skinCases).toBeUndefined();
            expect(state.cs2Battles).toBeUndefined();
            expect((await first.query(`SELECT id FROM public.${sentinel}`)).rows).toEqual([{ id: 1 }]);
        } finally { await first.query(`DROP TABLE IF EXISTS public.${sentinel}`); }
    });
});
