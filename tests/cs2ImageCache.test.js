let reel;
const imageUrl = id => `https://community.akamai.steamstatic.com/economy/image/cache-budget-${id}`;
const png = bytes => new Response(Buffer.alloc(bytes), { headers: { 'content-type': 'image/png' } });

beforeEach(() => {
    jest.isolateModules(() => { reel = require('../utils/cs2Reel'); });
    jest.spyOn(global, 'fetch').mockImplementation(async () => png(16));
});

afterEach(() => { jest.restoreAllMocks(); });

test('in-flight images remain deduplicated when a batch exceeds the completed-image entry budget', async () => {
    const finish = [];
    global.fetch.mockImplementation(() => new Promise(resolve => { finish.push(resolve); }));
    const first = reel.cachedImage(imageUrl(0));
    const others = Array.from({ length: 100 }, (_, index) => reel.cachedImage(imageUrl(index + 1)));
    expect(reel.cachedImage(imageUrl(0))).toBe(first);
    expect(global.fetch).toHaveBeenCalledTimes(101);
    finish.forEach(resolve => resolve(png(16)));
    await Promise.all([first, ...others]);
});

test('completed image cache evicts oldest bytes and retains recently accessed artwork', async () => {
    global.fetch.mockImplementation(async () => png(8 * 1024 * 1024));
    for (const id of [0, 1, 2, 3]) await reel.cachedImage(imageUrl(id));
    await reel.cachedImage(imageUrl(0));
    await reel.cachedImage(imageUrl(4));
    expect(global.fetch).toHaveBeenCalledTimes(5);
    await reel.cachedImage(imageUrl(0));
    expect(global.fetch).toHaveBeenCalledTimes(5);
    await reel.cachedImage(imageUrl(1));
    expect(global.fetch).toHaveBeenCalledTimes(6);
});

test('oversized declared downloads cancel their body before buffering', async () => {
    const cancel = jest.fn();
    global.fetch.mockResolvedValue(new Response(new ReadableStream({ cancel }), {
        headers: { 'content-type': 'image/png', 'content-length': String(8 * 1024 * 1024 + 1) }
    }));
    await expect(reel.cachedImage(imageUrl(0))).rejects.toThrow('download limit');
    expect(cancel).toHaveBeenCalledTimes(1);
});

test('oversized streamed downloads cancel promptly and can be retried later', async () => {
    let pulls = 0;
    const cancel = jest.fn();
    global.fetch.mockResolvedValueOnce(new Response(new ReadableStream({
        pull(controller) {
            pulls++;
            controller.enqueue(new Uint8Array(1024 * 1024));
        }, cancel
    }), { headers: { 'content-type': 'image/png' } }));
    await expect(reel.cachedImage(imageUrl(0))).rejects.toThrow('download limit');
    expect(pulls).toBeLessThanOrEqual(10);
    expect(cancel).toHaveBeenCalledTimes(1);
    await expect(reel.cachedImage(imageUrl(0))).resolves.toHaveLength(16);
    expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('invalid and empty responses are discarded instead of cached', async () => {
    const cancel = jest.fn();
    global.fetch.mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), {
        status: 500, headers: { 'content-type': 'text/plain' }
    })).mockResolvedValueOnce(png(0));
    await expect(reel.cachedImage(imageUrl(0))).rejects.toThrow('Could not load');
    expect(cancel).toHaveBeenCalledTimes(1);
    await expect(reel.cachedImage(imageUrl(0))).rejects.toThrow('Empty CS2 image');
    await expect(reel.cachedImage(imageUrl(0))).resolves.toHaveLength(16);
    expect(global.fetch).toHaveBeenCalledTimes(3);
});
