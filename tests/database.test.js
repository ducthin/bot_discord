jest.mock('pg', () => ({ Pool: jest.fn() }));

const { Pool } = require('pg');
const { createDatabase } = require('../utils/database');

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

function pooledDatabase() {
    let active = 0;
    const waiters = [];
    const pool = {
        on: jest.fn(), end: jest.fn(),
        connect: jest.fn(async () => {
            if (active === 2) await new Promise(resolve => waiters.push(resolve));
            else active++;
            return {
                query: jest.fn(async sql => ({ command: sql === 'COMMIT' ? 'COMMIT' : 'OK' })),
                release: jest.fn(() => {
                    const next = waiters.shift();
                    if (next) next();
                    else active--;
                })
            };
        })
    };
    Pool.mockImplementation(() => pool);
    return { db: createDatabase({ connectionString: 'postgresql://localhost/test', max: 2 }), pool };
}

afterEach(() => jest.clearAllMocks());

test('a busy guild cannot exhaust the connection pool and block other owners', async () => {
    const { db, pool } = pooledDatabase();
    const entered = deferred();
    const finish = deferred();
    const busy = db.transaction('guild:1', async () => {
        entered.resolve();
        await finish.promise;
    });
    await entered.promise;
    const queued = Array.from({ length: 5 }, () => db.transaction('guild:1', async () => 'same guild'));
    const independent = jest.fn(async () => 'other guild');
    const other = db.transaction('guild:2', independent);
    try {
        await new Promise(resolve => setImmediate(resolve));
        expect(independent).toHaveBeenCalledTimes(1);
        expect(pool.connect).toHaveBeenCalledTimes(3); // Schema setup and two active owners.
        expect(await other).toBe('other guild');
    } finally {
        finish.resolve();
        await Promise.allSettled([busy, ...queued, other]);
        await db.close();
    }
});

test('a failed transaction releases its connection and does not poison the owner queue', async () => {
    const { db } = pooledDatabase();
    const order = [];
    const failed = db.transaction('guild:1', async client => {
        order.push('failed');
        await client.query('UPDATE wallets');
        throw new Error('rollback this operation');
    });
    const recovered = db.transaction('guild:1', async () => { order.push('recovered'); return 42; });
    try {
        await expect(failed).rejects.toThrow('rollback this operation');
        expect(await recovered).toBe(42);
        expect(order).toEqual(['failed', 'recovered']);
        expect(await db.transaction('guild:1', async () => 99)).toBe(99);
    } finally { await db.close(); }
});

test('closing drains accepted transactions without admitting new work', async () => {
    const { db, pool } = pooledDatabase();
    const entered = deferred();
    const finish = deferred();
    const first = db.transaction('guild:1', async () => {
        entered.resolve();
        await finish.promise;
        return 1;
    });
    await entered.promise;
    const second = db.transaction('guild:1', async () => 2);
    const closing = db.close();
    try {
        await expect(db.transaction('guild:2', async () => 3)).rejects.toThrow('Database is closing');
        await expect(db.query('SELECT 1')).rejects.toThrow('Database is closing');
        expect(pool.end).not.toHaveBeenCalled();
    } finally { finish.resolve(); }
    expect(await Promise.all([first, second])).toEqual([1, 2]);
    await closing;
    expect(pool.end).toHaveBeenCalledTimes(1);
});
