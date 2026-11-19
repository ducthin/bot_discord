let now;

function metricsEnabled(enabled = true) {
    jest.replaceProperty(process, 'env', { ...process.env, HOM_PERF_METRICS: String(enabled) });
    jest.resetModules();
    jest.doMock('node:perf_hooks', () => ({ performance: { now: () => now } }));
    return require('../utils/performanceMetrics');
}

beforeEach(() => {
    now = 0;
    jest.useFakeTimers();
});

afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
    jest.dontMock('node:perf_hooks');
});

test('disabled measurement preserves sync values, errors and the original promise without a timer', () => {
    const metrics = metricsEnabled(false);
    const promise = Promise.resolve('value');
    const bytes = jest.fn();
    expect(metrics.measure('hom.upload', () => promise, bytes)).toBe(promise);
    expect(metrics.measure('hom.upload', () => 42)).toBe(42);
    const failure = new Error('failure');
    expect(() => metrics.measure('hom.upload', () => { throw failure; })).toThrow(failure);
    metrics.increment('hom.render.batch.cacheHit');
    expect(metrics.snapshot()).toMatchObject({ enabled: false, metrics: {} });
    expect(bytes).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
});

test('aggregates duration buckets, async errors, null fallback and output bytes without retaining input data', async () => {
    const metrics = metricsEnabled();
    const privateText = 'guild-123 user-456 https://private.example/query';
    expect(await metrics.measure('hom.render.single', async () => {
        now = 23;
        return { gif: Buffer.alloc(20), audio: new Uint8Array(5), query: privateText };
    }, metrics.mediaBytes)).toHaveProperty('query', privateText);
    const failure = new Error(privateText);
    await expect(metrics.measure('hom.render.single', async () => {
        now = 103;
        throw failure;
    })).rejects.toBe(failure);
    expect(metrics.measure('hom.render.single', () => {
        now = 110;
        return null;
    })).toBeNull();
    const snapshot = metrics.snapshot();
    expect(snapshot.rssBytes).toBeGreaterThan(0);
    expect(snapshot.metrics['hom.render.single']).toEqual({ count: 3, error: 1, null: 1, bytes: 25,
        meanMs: 36.67, maxMs: 80, p95UpperMs: 100 });
    expect(JSON.stringify(snapshot)).not.toContain(privateText);
    expect(metrics.snapshot(true).metrics).toEqual(snapshot.metrics);
    expect(metrics.snapshot().metrics).toEqual({});
});

test('unknown labels cannot grow the aggregate and percentile uses a bounded upper bucket', () => {
    const metrics = metricsEnabled();
    for (let index = 0; index < 5000; index++) {
        expect(metrics.measure(`guild/user/query/${index}`, () => index)).toBe(index);
        metrics.increment(`query-${index}`);
    }
    for (let index = 0; index < 100; index++) metrics.measure('store.read', () => { now += index < 95 ? 10 : 2000; });
    expect(Object.keys(metrics.snapshot().metrics)).toEqual(['store.read']);
    expect(metrics.snapshot().metrics['store.read']).toMatchObject({ count: 100, meanMs: 109.5, maxMs: 2000, p95UpperMs: 10 });
    metrics.measure('store.locked', () => { now += 70_000; });
    expect(metrics.snapshot().metrics['store.locked'].p95UpperMs).toBe('>60000');
});

test('byte helpers count only in-memory buffers and metric callbacks cannot break an operation', () => {
    const metrics = metricsEnabled();
    expect(metrics.payloadBytes({ files: [Buffer.alloc(2), { attachment: Buffer.alloc(3) },
        { attachment: new Uint8Array(4) }, { attachment: '/private/path' }, { attachment: 'https://private.example' }] })).toBe(9);
    expect(metrics.payloadBytes({ files: ['private-path'] })).toBe(0);
    expect(metrics.payloadBytes(null)).toBe(0);
    expect(metrics.mediaBytes({ gif: Buffer.alloc(2), png: new Uint8Array(3), audio: Buffer.alloc(4) })).toBe(9);
    for (const bytesOf of [() => { throw new Error('sensitive'); }, () => NaN, () => -1]) {
        expect(metrics.measure('hom.upload', () => 'success', bytesOf)).toBe('success');
    }
    expect(metrics.snapshot().metrics['hom.upload']).toMatchObject({ count: 3, error: 0, bytes: 0 });
});

test('emits one aggregate per minute and clears samples between reports', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const metrics = metricsEnabled();
    expect(jest.getTimerCount()).toBe(1);
    metrics.increment('hom.render.batch.cacheHit');
    await jest.advanceTimersByTimeAsync(60_000);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toBe('[performance]');
    expect(JSON.parse(log.mock.calls[0][1])).toMatchObject({ enabled: true,
        metrics: { 'hom.render.batch.cacheHit': { count: 1 } } });
    expect(metrics.snapshot().metrics).toEqual({});
    await jest.advanceTimersByTimeAsync(60_000);
    expect(log).toHaveBeenCalledTimes(1);
});

test('PostgreSQL metrics separate lock callback time from total transaction time and retain scope validation', async () => {
    const metrics = metricsEnabled();
    const db = {
        query: jest.fn(async () => { now += 5; return { rows: [] }; }),
        transaction: jest.fn(async (_key, operation) => {
            now += 10;
            const result = await operation(db);
            now += 20;
            return result;
        })
    };
    const store = require('../utils/managementStore').createPostgresManagementStore(db);
    await store.read('1', { inventory: ['13'] });
    await expect(store.transact('1', () => { now += 7; return 'done'; }, { inventory: ['13'] })).resolves.toBe('done');
    await expect(store.read('1', { wallet: ['13'] })).rejects.toThrow('Invalid management scope');
    expect(metrics.snapshot().metrics).toMatchObject({
        'store.read': { count: 2, error: 1, meanMs: 2.5 },
        'store.transaction': { count: 1, meanMs: 42 },
        'store.locked': { count: 1, meanMs: 12 }
    });
    expect(db.query.mock.calls.every(([, params]) => params[0] === '1')).toBe(true);
});
