const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createPriceSnapshot, REFRESH_MS } = require('../utils/cs2PriceSnapshot');

const runNode = promisify(execFile);
const CASE = 'Kilowatt Case';
const KNIFE = '★ StatTrak™ Kukri Knife';
const DOPPLER = '★ Karambit | Doppler (Factory New)';
const HOUR = 60 * 60_000;
const NOW = Date.parse('2026-11-13T10:00:00Z');

let directory;
let file;
let clock;
let pricePayload;
let fetcher;

const date = value => new Date(value).toISOString();
const buff = (ask, time = NOW - HOUR) => ({ buff: { ask, currency: 'USD', updated_at: date(time) } });
const instance = () => createPriceSnapshot({ file, fetcher, now: () => clock });

beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discord-cs2-price-snapshot-'));
    file = path.join(directory, 'cache.json');
    clock = NOW;
    pricePayload = {
        updated_at: date(NOW), count: 4,
        data: {
            [CASE]: buff(0.13), [KNIFE]: buff(499.21, NOW - 2 * HOUR),
            'AK-47 | Redline (Field-Tested)': { steam: { ask: 7, currency: 'USD', updated_at: date(NOW) } },
            'Unknown Case': buff(12)
        }
    };
    fetcher = jest.fn(async url => url.includes('frankfurter')
        ? Response.json({ date: '2026-11-13', base: 'USD', quote: 'VND', rate: 25744 })
        : Response.json(pricePayload));
});

afterEach(async () => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    await fs.rm(directory, { recursive: true, force: true });
});

test('refresh uses only BUFF with exact market names and per-item times', async () => {
    const snapshot = instance();
    expect(snapshot.peek(CASE)).toBeNull();
    const first = snapshot.refresh();
    expect(snapshot.refresh()).toBe(first);
    await expect(first).resolves.toEqual({ status: 'updated', count: 2, updatedAt: NOW, nextRefreshAt: NOW + REFRESH_MS });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(snapshot.peek(CASE)).toEqual({ priceVnd: 3347, observedAt: NOW - HOUR, expiresAt: NOW + 23 * HOUR,
        source: 'buff', phase: null, url: null });
    expect(snapshot.peek(KNIFE)).toMatchObject({ priceVnd: 12_851_662, observedAt: NOW - 2 * HOUR });
    expect(snapshot.peek('Unknown Case')).toBeNull();
    expect(snapshot.peek('AK-47 | Redline (Field-Tested)')).toBeNull();
    expect(snapshot.peek(CASE.toLowerCase())).toBeNull();
    expect(snapshot.nextRefreshAt()).toBe(NOW + REFRESH_MS);
    await expect(snapshot.refresh()).resolves.toMatchObject({ status: 'cooldown' });
    expect(fetcher).toHaveBeenCalledTimes(2);
});

test('persisted quotes survive restart, age out for trading first and later for display', async () => {
    await instance().refresh();
    const restarted = instance();
    await restarted.start();
    expect(restarted.peek(CASE).priceVnd).toBe(3347);
    expect(restarted.nextRefreshAt()).toBe(NOW + REFRESH_MS);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await restarted.stop();

    clock = NOW + 23 * HOUR;
    expect(restarted.peek(CASE)).toBeNull();
    expect(restarted.peek(CASE, { allowStale: true }).priceVnd).toBe(3347);
    clock = NOW + 47 * HOUR;
    expect(restarted.peek(CASE, { allowStale: true })).toBeNull();
});

test('upgrading a mixed cache immediately discards other sources and retains existing BUFF prices', async () => {
    clock = NOW + 60_000;
    const genesis = 'Sealed Genesis Terminal';
    const deadHand = 'Sealed Dead Hand Terminal';
    const redline = 'AK-47 | Redline (Field-Tested)';
    await fs.writeFile(file, JSON.stringify({ version: 2, checkedAt: clock, updatedAt: NOW, quotes: [
        [CASE, 3347, NOW - HOUR, 'steam'], [genesis, 1545, NOW - HOUR, 'buff'],
        [deadHand, 6693, NOW - HOUR, 'csfloat'], [redline, 10_000, NOW - HOUR, 'skinport']
    ] }));
    pricePayload.data[CASE] = buff(0.07, NOW - 2 * HOUR);
    pricePayload.data[deadHand] = buff(0.26);

    const expanded = instance();
    await expanded.start();
    try {
        expect(expanded.peek(CASE)).toBeNull();
        expect(expanded.peek(deadHand, { allowStale: true })).toBeNull();
        expect(expanded.peek(redline, { allowStale: true })).toBeNull();
        expect(expanded.peek(genesis)).toMatchObject({ source: 'buff', priceVnd: 1545 });
        await expect(expanded.refresh()).resolves.toMatchObject({ status: 'updated', count: 4 });
        expect(expanded.peek(CASE)).toMatchObject({ source: 'buff', priceVnd: 1802, observedAt: NOW - 2 * HOUR });
        expect(expanded.peek(deadHand).priceVnd).toBe(6693);
        const saved = JSON.parse(await fs.readFile(file, 'utf8'));
        expect(saved.version).toBe(3);
        expect(saved.quotes.find(([key]) => key === CASE)).toEqual([CASE, 1802, NOW - 2 * HOUR, null, null]);
        expect(saved.quotes.some(([key]) => key === redline)).toBe(false);
    } finally {
        await expanded.stop();
    }

    fetcher.mockClear();
    const restarted = instance();
    await restarted.start();
    try {
        expect(restarted.peek(deadHand).priceVnd).toBe(6693);
        expect(restarted.peek(CASE)).toMatchObject({ source: 'buff', priceVnd: 1802 });
        expect(fetcher).not.toHaveBeenCalled();
    } finally {
        await restarted.stop();
    }
});

test('keeps exact phase prices separate across refresh and restart', async () => {
    clock += 60_000;
    const updated_at = date(NOW);
    const url = 'https://buff.163.com/goods/43012';
    pricePayload.data[DOPPLER] = {
        links: { buff: url },
        buff: { ask: 6000, currency: 'USD', updated_at, patterns: [{ pattern: 'Ruby', ask: 6000, updated_at }] },
        csfloat: { currency: 'USD', updated_at, patterns: [{ pattern: 'Phase 1', ask: 1100, updated_at }] }
    };
    await instance().refresh();
    const restarted = instance();
    await restarted.start();
    try {
        expect(restarted.peek(DOPPLER)).toBeNull();
        expect(restarted.peek(DOPPLER, { phase: 'Ruby' })).toMatchObject({ priceVnd: 154_464_000, source: 'buff', phase: 'Ruby', url });
        expect(restarted.peek(DOPPLER, { phase: 'Phase 1' })).toBeNull();
        expect(restarted.peek(DOPPLER, { phase: 'Sapphire' })).toBeNull();
    } finally {
        await restarted.stop();
    }
});

test('automatic refresh follows :00 and :30 after a restart between the two', async () => {
    clock = NOW - 2 * 60_000;
    pricePayload.updated_at = date(clock);
    await instance().refresh();
    fetcher.mockClear();
    jest.useFakeTimers({ now: NOW + 7 * 60_000 });
    const restarted = createPriceSnapshot({ file, fetcher });
    await restarted.start();
    try {
        expect(restarted.nextRefreshAt()).toBe(NOW + REFRESH_MS);
        await jest.advanceTimersByTimeAsync(23 * 60_000 - 1);
        expect(fetcher).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(1);
        expect(fetcher).toHaveBeenCalledTimes(2);
        await restarted.refresh();
        expect(restarted.nextRefreshAt()).toBe(NOW + HOUR);
        await jest.advanceTimersByTimeAsync(REFRESH_MS);
        expect(fetcher).toHaveBeenCalledTimes(4);
        await restarted.refresh();
    } finally {
        await restarted.stop();
    }
});

test('an off-minute check does not delay the next half-hour slot', async () => {
    const snapshot = instance();
    clock = NOW + REFRESH_MS - 1;
    await snapshot.refresh();
    expect(snapshot.nextRefreshAt()).toBe(NOW + REFRESH_MS);
    clock++;
    await expect(snapshot.refresh()).resolves.toMatchObject({ status: 'unchanged', nextRefreshAt: NOW + HOUR });
    expect(fetcher).toHaveBeenCalledTimes(4);
});

test('invalid or unavailable snapshots retain the last good file and quote', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const snapshot = instance();
    await snapshot.refresh();
    const saved = await fs.readFile(file, 'utf8');
    clock += HOUR;
    pricePayload = { ...pricePayload, count: 1, data: { [CASE]: buff(null) } };
    await expect(snapshot.refresh()).resolves.toMatchObject({ status: 'unavailable', count: 2 });
    expect(snapshot.peek(CASE).priceVnd).toBe(3347);
    expect(await fs.readFile(file, 'utf8')).toBe(saved);

    clock += HOUR;
    fetcher.mockImplementation(async url => url.includes('frankfurter')
        ? Response.json({ date: '2026-11-13', base: 'USD', quote: 'VND', rate: 25744 })
        : new Response(null, { status: 503 }));
    await expect(snapshot.refresh()).resolves.toMatchObject({ status: 'unavailable', count: 2 });
    expect(snapshot.peek(KNIFE).priceVnd).toBe(12_851_662);
    expect(await fs.readFile(file, 'utf8')).toBe(saved);
});

test('stopping the sync aborts pending network work', async () => {
    let signal;
    let markStarted;
    const started = new Promise(resolve => { markStarted = resolve; });
    fetcher.mockImplementation((_url, options) => new Promise((_, reject) => {
        signal = options.signal;
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        markStarted();
    }));
    const snapshot = instance();
    const pending = snapshot.refresh();
    await started;
    await snapshot.stop();
    await expect(pending).resolves.toMatchObject({ status: 'unavailable', count: 0 });
    expect(signal.aborted).toBe(true);
});

test('the production path fetches and projects the snapshot off the main thread', async () => {
    const preload = path.join(directory, 'mock-price-network.cjs');
    await fs.writeFile(preload, `
        const { isMainThread } = require('node:worker_threads');
        global.fetch = async url => {
            if (isMainThread) throw new Error('Price fetch ran on the main thread');
            const updatedAt = new Date().toISOString();
            if (url.includes('frankfurter')) {
                return Response.json({ date: updatedAt, base: 'USD', quote: 'VND', rate: 25744 });
            }
            return Response.json({ updated_at: updatedAt, count: 2, data: {
                'Kilowatt Case': { buff: { ask: 0.13, currency: 'USD', updated_at: updatedAt } },
                'Unknown Case': { buff: { ask: 2, currency: 'USD', updated_at: updatedAt } }
            } });
        };
    `);
    const { stdout } = await runNode(process.execPath, ['--require', preload, '-e', `
        const { createPriceSnapshot } = require(process.argv[1]);
        const snapshot = createPriceSnapshot({ file: process.argv[2] });
        snapshot.refresh().then(result => {
            const quote = snapshot.peek('Kilowatt Case');
            console.log(JSON.stringify({ status: result.status, count: result.count, quote, unknown: snapshot.peek('Unknown Case') }));
        }).catch(error => { console.error(error); process.exitCode = 1; });
    `, require.resolve('../utils/cs2PriceSnapshot'), file], { timeout: 4000 });
    expect(JSON.parse(stdout)).toMatchObject({ status: 'updated', count: 1, quote: { priceVnd: 3347 }, unknown: null });
    expect(JSON.parse(await fs.readFile(file, 'utf8')).quotes[0].slice(0, 2)).toEqual([CASE, 3347]);
});
