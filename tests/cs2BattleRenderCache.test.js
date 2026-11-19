const { createBattleRenderCache } = require('../utils/cs2BattleRenderCache');

const rounds = seed => Array.from({ length: 2 }, () => ({ landingSeed: seed, cards: [{ image: 'skin', color: '#fff' }],
    selectedIndex: 0, result: { title: 'Skin', image: 'skin' } }));
const options = { profile: 'battle' };
afterEach(() => jest.useRealTimers());

test('identical seeded retries share pending and completed media without changing seed, text or size limits', async () => {
    let finish;
    const render = jest.fn(() => new Promise(resolve => { finish = resolve; }));
    const cached = createBattleRenderCache(render);
    const first = cached(rounds(1), undefined, options);
    expect(cached(rounds(1), 7_500_000, options)).toBe(first);
    await Promise.resolve();
    const media = { gif: Buffer.from('GIF') };
    finish(media);
    await expect(first).resolves.toBe(media);
    await expect(cached(rounds(1), undefined, options)).resolves.toBe(media);
    expect(render).toHaveBeenCalledTimes(1);
    render.mockResolvedValue(media);
    await cached(rounds(2), undefined, options);
    const renamed = rounds(1); renamed[0].result.title = 'Other skin';
    await cached(renamed, undefined, options);
    await cached(rounds(1), 100, options);
    expect(render).toHaveBeenCalledTimes(4);
});

test('failed or missing renders retry, while unseeded and ordinary openings never reuse media', async () => {
    const render = jest.fn().mockRejectedValueOnce(new Error('encode')).mockResolvedValueOnce(null).mockResolvedValue({ gif: Buffer.from('GIF') });
    const cached = createBattleRenderCache(render);
    await expect(cached(rounds(3), undefined, options)).rejects.toThrow('encode');
    await expect(cached(rounds(3), undefined, options)).resolves.toBeNull();
    await cached(rounds(3), undefined, options);
    await cached(rounds(3), undefined, options);
    for (let index = 0; index < 2; index++) {
        await cached(rounds(undefined), undefined, options);
        await cached(rounds(3));
    }
    expect(render).toHaveBeenCalledTimes(7);
});

test('expiry, entry count and byte budget bound retained GIFs', async () => {
    jest.useFakeTimers();
    const render = jest.fn().mockResolvedValue({ gif: Buffer.from('GIF') });
    const cached = createBattleRenderCache(render);
    for (let seed = 0; seed < 9; seed++) await cached(rounds(seed), undefined, options);
    await cached(rounds(0), undefined, options);
    expect(render).toHaveBeenCalledTimes(10);
    await jest.advanceTimersByTimeAsync(30_000);
    await cached(rounds(0), undefined, options);
    expect(render).toHaveBeenCalledTimes(11);
    render.mockResolvedValue({ gif: Buffer.alloc(6_000_000) });
    const bounded = createBattleRenderCache(render);
    for (let seed = 0; seed < 3; seed++) await bounded(rounds(seed), undefined, options);
    await bounded(rounds(0), undefined, options);
    expect(render).toHaveBeenCalledTimes(15);
});
