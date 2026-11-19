const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { skins } = require('../utils/cs2Catalogue');
const { items: blueGems } = require('../assets/cs2-blue-gems/manifest.json');
const { createPlayerAssetHandler, getPlayerSkinImage, getPlayerTargetImage } = require('../utils/playerAssets');

const PRINT = 'skin-be37abed2b4d';
const HOWL = 'skin-8aacf99e7f2f';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0l8AAAAASUVORK5CYII=', 'base64');
const imagePath = (id = PRINT, variant = 'base') => `/play/art/skins/${id}/${variant}.png`;
const imageResponse = (body = PNG, status = 200, type = 'image/png') => new Response(body, { status, headers: { 'Content-Type': type } });
const memoryHandler = fetchImpl => createPlayerAssetHandler({ fetchImpl, cacheDir: false });
let temporary;
beforeAll(async () => { temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'player-assets-test-')); });
afterAll(async () => {
    const resolved = path.resolve(temporary);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('player-assets-test-')) throw new Error('Unexpected test cache path');
    await fs.rm(resolved, { recursive: true, force: true });
});

test('skin and target URLs preserve known identity, exterior and verified Blue Gem seed', () => {
    expect(getPlayerSkinImage({ skinId: PRINT, float: 0.15 })).toBe(imagePath(PRINT, 'wear-2'));
    expect(getPlayerSkinImage({ skinId: HOWL, float: null })).toBe(imagePath(HOWL));
    expect(getPlayerSkinImage({ skinId: PRINT, float: -1 })).toBe(imagePath(PRINT));
    expect(getPlayerTargetImage({ skinId: PRINT, exterior: 4, drop: { skinId: PRINT, float: 0.1 } })).toBe(imagePath(PRINT, 'wear-4'));
    expect(getPlayerTargetImage({ drop: { skinId: PRINT, float: 0.1 } })).toBe(imagePath(PRINT, 'wear-1'));
    expect(getPlayerSkinImage(blueGems[0])).toBe(imagePath(blueGems[0].skinId, `seed-${blueGems[0].paintSeed}`));
    for (const input of [null, {}, { skinId: 'https://evil.example/image.png' }, { skinId: 'skin-000000000000' }]) {
        expect(getPlayerSkinImage(input)).toBeNull();
        expect(getPlayerTargetImage(input)).toBeNull();
    }
});

test.each([
    ['404', () => imageResponse('missing', 404, 'text/plain')],
    ['HTML response', () => imageResponse('<html>blocked</html>', 200, 'text/html')],
    ['HTML mislabeled as PNG', () => imageResponse('<html>blocked</html>')],
    ['truncated PNG', () => imageResponse(PNG.subarray(0, -12))],
    ['oversized declared length', () => new Response(PNG, { headers: { 'Content-Type': 'image/png', 'Content-Length': 3 * 1024 * 1024 } })],
    ['oversized streamed body', () => imageResponse(Buffer.alloc(2 * 1024 * 1024 + 1))],
    ['oversized dimensions', () => { const buffer = Buffer.from(PNG); buffer.writeUInt32BE(2049, 16); return imageResponse(buffer); }],
    ['network failure', () => { throw new Error('temporary upstream failure'); }]
])('wear image falls back to the same skin main image after %s', async (_label, broken) => {
    const fetchImpl = jest.fn().mockImplementationOnce(broken).mockImplementationOnce(() => imageResponse());
    const handler = memoryHandler(fetchImpl);
    expect(await handler.load(imagePath(PRINT, 'wear-2'))).toEqual(PNG);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toMatch(/^https:\/\/esm\.sh\/gh\/isaac-goldberg\/cs2-images@/);
    expect(fetchImpl.mock.calls[1][0]).toBe(skins[PRINT].image);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ redirect: 'error', headers: { Accept: 'image/png' } });
    expect(fetchImpl.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
});

test('known Blue Gem images are served from verified local PNGs without external requests', async () => {
    const fetchImpl = jest.fn();
    const handler = memoryHandler(fetchImpl);
    const buffer = await handler.load(getPlayerSkinImage(blueGems[0]));
    expect(createHash('sha256').update(buffer).digest('hex')).toBe(blueGems[0].pngSha256);
    expect(fetchImpl).not.toHaveBeenCalled();
});

test('untrusted paths, unknown skins and unverified paint seeds never trigger network requests', async () => {
    const fetchImpl = jest.fn();
    const handler = memoryHandler(fetchImpl);
    for (const route of [imagePath('skin-000000000000'), imagePath(PRINT, 'seed-1001'), imagePath(PRINT, 'wear-9'),
        '/play/art/skins/../../.env', '/play/art/skins/https://127.0.0.1/image.png', imagePath(PRINT) + '?url=https://evil.example']) {
        await expect(handler.load(route)).rejects.toMatchObject({ status: 404 });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
});

test('parallel requests for the same source share one fetch and successful responses are cached', async () => {
    const fetchImpl = jest.fn(async () => imageResponse());
    const handler = memoryHandler(fetchImpl);
    const images = await Promise.all(Array.from({ length: 12 }, (_, i) => handler.load(imagePath(PRINT, `wear-${i % 2}`))));
    expect(images.every(buffer => buffer.equals(PNG))).toBe(true);
    await handler.load(imagePath(PRINT, 'wear-0'));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test('failed sources use a short retry delay without substituting an unrelated gun', async () => {
    let now = 100;
    const fetchImpl = jest.fn(async () => imageResponse('unavailable', 503, 'text/plain'));
    const handler = createPlayerAssetHandler({ fetchImpl, cacheDir: false, now: () => now });
    await expect(handler.load(imagePath(PRINT, 'wear-2'))).rejects.toMatchObject({ status: 503 });
    await expect(handler.load(imagePath(PRINT, 'wear-2'))).rejects.toMatchObject({ status: 503 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    now += 30_001;
    await expect(handler.load(imagePath(PRINT, 'wear-2'))).rejects.toMatchObject({ status: 503 });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
});

test('memory image cache evicts old entries at its configured bound', async () => {
    const fetchImpl = jest.fn(async () => imageResponse());
    const handler = createPlayerAssetHandler({ fetchImpl, cacheDir: false, maxMemoryEntries: 1 });
    await handler.load(imagePath(PRINT)); await handler.load(imagePath(HOWL)); await handler.load(imagePath(PRINT));
    expect(fetchImpl).toHaveBeenCalledTimes(3);
});

test('validated disk cache survives restart and corrupt cache entries are fetched again', async () => {
    const cacheDir = path.join(temporary, 'persistent');
    const firstFetch = jest.fn(async () => imageResponse());
    await createPlayerAssetHandler({ fetchImpl: firstFetch, cacheDir }).load(imagePath(PRINT));
    expect(firstFetch).toHaveBeenCalledTimes(1);
    const secondFetch = jest.fn();
    await expect(createPlayerAssetHandler({ fetchImpl: secondFetch, cacheDir }).load(imagePath(PRINT))).resolves.toEqual(PNG);
    expect(secondFetch).not.toHaveBeenCalled();
    const cacheFile = path.join(cacheDir, createHash('sha256').update(skins[PRINT].image).digest('hex') + '.png');
    await fs.writeFile(cacheFile, 'corrupt cached image');
    const repairFetch = jest.fn(async () => imageResponse());
    await expect(createPlayerAssetHandler({ fetchImpl: repairFetch, cacheDir }).load(imagePath(PRINT))).resolves.toEqual(PNG);
    expect(repairFetch).toHaveBeenCalledTimes(1);
    expect(await fs.readFile(cacheFile)).toEqual(PNG);
});

test('disk cache pruning removes old images after a bounded write batch', async () => {
    const cacheDir = path.join(temporary, 'bounded');
    const handler = createPlayerAssetHandler({ fetchImpl: async () => imageResponse(), cacheDir, maxDiskEntries: 2 });
    for (const id of Object.keys(skins).slice(0, 8)) await handler.load(imagePath(id));
    expect((await fs.readdir(cacheDir)).filter(name => name.endsWith('.png'))).toHaveLength(2);
    expect((await fs.readdir(cacheDir)).some(name => name.endsWith('.tmp'))).toBe(false);
});

test('network concurrency stays bounded across distinct skins', async () => {
    let active = 0, peak = 0;
    const fetchImpl = jest.fn(async () => {
        peak = Math.max(peak, ++active);
        await new Promise(resolve => setTimeout(resolve, 5));
        active--; return imageResponse();
    });
    const handler = createPlayerAssetHandler({ fetchImpl, cacheDir: false, concurrency: 2 });
    await Promise.all(Object.keys(skins).slice(0, 12).map(id => handler.load(imagePath(id))));
    expect(peak).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(12);
});

test('HTTP handler supports HEAD and conditional requests without exposing upstream URLs', async () => {
    const fetchImpl = jest.fn(async () => imageResponse());
    const handler = memoryHandler(fetchImpl);
    const res = () => ({ writeHead: jest.fn(), end: jest.fn() });
    const first = res();
    expect(await handler({ method: 'GET', headers: {} }, first, imagePath(HOWL))).toBe(true);
    expect(first.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'Content-Type': 'image/png', 'Content-Length': PNG.length, 'X-Content-Type-Options': 'nosniff' }));
    expect(first.end).toHaveBeenCalledWith(PNG);
    const etag = first.writeHead.mock.calls[0][1].ETag;
    const head = res();
    await handler({ method: 'HEAD', headers: {} }, head, imagePath(HOWL));
    expect(head.end).toHaveBeenCalledWith(undefined);
    const cached = res();
    await handler({ method: 'GET', headers: { 'if-none-match': etag } }, cached, imagePath(HOWL));
    expect(cached.writeHead).toHaveBeenCalledWith(304, expect.not.objectContaining({ 'Content-Length': expect.anything() }));
    expect(await handler({ method: 'GET' }, res(), '/play/api/me')).toBe(false);
    await expect(handler({ method: 'POST' }, res(), imagePath(HOWL))).rejects.toMatchObject({ status: 405 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
});
