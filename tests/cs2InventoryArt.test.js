const { execFile } = require('node:child_process');
const { cachedImage, reserveArtworkSlot, prepareArtworkRenderer } = require('../utils/cs2Reel');
const fs = require('node:fs/promises');
const { renderInventoryGrid } = require('../utils/cs2InventoryArt');

jest.mock('ffmpeg-static', () => 'ffmpeg-test');
jest.mock('node:child_process', () => ({ execFile: jest.fn() }));
jest.mock('node:fs/promises', () => ({
    mkdtemp: jest.fn(async prefix => prefix + 'test'), rm: jest.fn(async () => {}), writeFile: jest.fn(async () => {})
}));
jest.mock('../utils/cs2Reel', () => ({
    cachedImage: jest.fn(), prepareArtworkRenderer: jest.fn(async () => ({ encoder: 'ffmpeg-test', hasFont: false })),
    reserveArtworkSlot: jest.fn()
}));

const png = Buffer.from('rendered PNG');
const source = Buffer.from('source artwork');
const card = {
    number: 1, name: 'Skin', image: 'art', fallback: 'base', color: '#4b69ff',
    detail: 'Minimal Wear', hasPrice: true, price: '1,000 xu'
};

beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    cachedImage.mockResolvedValue(source);
    reserveArtworkSlot.mockReturnValue(jest.fn());
    execFile.mockImplementation((_file, args, _options, callback) => {
        callback(null, args.includes('image2pipe') ? { stdout: png } : { stderr: '' });
    });
});

afterEach(() => jest.useRealTimers());

test('reuses pending and cached grids for identical cards and skips oversized cached PNGs', async () => {
    const first = renderInventoryGrid([card], 1000);
    const concurrent = renderInventoryGrid([{ ...card }], 1000);
    const [rendered, shared] = await Promise.all([first, concurrent]);
    expect(rendered).toEqual({ png, hasLabels: false });
    expect(shared).toBe(rendered);
    expect(execFile).toHaveBeenCalledTimes(2);

    reserveArtworkSlot.mockReturnValue(null);
    await expect(renderInventoryGrid([card], 100)).resolves.toBe(rendered);
    await expect(renderInventoryGrid([card], png.length - 1)).resolves.toBeNull();
    expect(execFile).toHaveBeenCalledTimes(2);

    reserveArtworkSlot.mockReturnValue(jest.fn());
    await renderInventoryGrid([{ ...card, price: '2,000 xu' }], 1000);
    expect(execFile).toHaveBeenCalledTimes(3);
    await jest.advanceTimersByTimeAsync(45_001);
    await renderInventoryGrid([card], 1000);
    expect(execFile).toHaveBeenCalledTimes(4);
});

test('retries the original image after displaying a fallback grid', async () => {
    const cards = [{ ...card, image: 'slow art' }];
    cachedImage.mockRejectedValueOnce(new Error('Original image unavailable'))
        .mockResolvedValueOnce(Buffer.from('fallback image'))
        .mockResolvedValueOnce(Buffer.from('original image'));
    await expect(renderInventoryGrid(cards, 1000)).resolves.toEqual({ png, hasLabels: false });
    await expect(renderInventoryGrid(cards, 1000)).resolves.toEqual({ png, hasLabels: false });
    expect(execFile).toHaveBeenCalledTimes(4);
});

test('cached preferred artwork skips unnecessary fallback downloads', async () => {
    const cards = [{ ...card, image: 'cached-preferred', fallback: 'unused-fallback' }];
    cachedImage.mockImplementation(url => url === cards[0].image ? Promise.resolve(source) : new Promise(() => {}));
    const rendered = renderInventoryGrid(cards, 1000);
    await jest.advanceTimersByTimeAsync(0);
    await expect(rendered).resolves.toEqual({ png, hasLabels: false });
    expect(cachedImage.mock.calls.map(([url]) => url)).toEqual(['cached-preferred']);
});

test('does not wait for a slow fallback after the preferred artwork becomes ready', async () => {
    const cards = [{ ...card, image: 'pending-preferred', fallback: 'pending-fallback' }];
    let finishPreferred;
    cachedImage.mockImplementation(url => url === cards[0].image
        ? new Promise(resolve => { finishPreferred = resolve; }) : new Promise(() => {}));
    const rendered = renderInventoryGrid(cards, 1000);
    await jest.advanceTimersByTimeAsync(0);
    expect(cachedImage).toHaveBeenCalledWith(cards[0].fallback);
    finishPreferred(source);
    await jest.advanceTimersByTimeAsync(0);
    await expect(rendered).resolves.toEqual({ png, hasLabels: false });
});

test('keeps fallback artwork when the preferred request exceeds the existing timeout', async () => {
    const cards = [{ ...card, image: 'timeout-preferred', fallback: 'ready-fallback' }];
    const fallback = Buffer.from('ready fallback artwork');
    cachedImage.mockImplementation(url => url === cards[0].image ? new Promise(() => {}) : Promise.resolve(fallback));
    const rendered = renderInventoryGrid(cards, 1000);
    await jest.advanceTimersByTimeAsync(2199);
    expect(fs.writeFile).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await expect(rendered).resolves.toEqual({ png, hasLabels: false });
    expect(fs.writeFile).toHaveBeenCalledWith(expect.stringMatching(/item0\.png$/), fallback);
});

test('a lock change invalidates the cached picture and renders a readable lock badge', async () => {
    prepareArtworkRenderer.mockResolvedValue({ encoder: 'ffmpeg-test', hasFont: true });
    const unlocked = { ...card, name: 'Unique lock badge test', image: 'lock-badge-source' };
    await renderInventoryGrid([unlocked], 1000);
    const previous = execFile.mock.calls.length;
    const locked = await renderInventoryGrid([{ ...unlocked, locked: true }], 1000);
    expect(locked.hasLabels).toBe(true);
    expect(execFile.mock.calls.length).toBe(previous + 1);
    const filters = fs.writeFile.mock.calls.filter(([name]) => name.endsWith('grid.txt')).map(([, filter]) => filter);
    expect(filters.at(-2)).not.toContain('ĐÃ KHÓA');
    expect(filters.at(-1)).toContain('text=ĐÃ KHÓA');
    expect(filters.at(-1)).toContain('fontcolor=0xffd578');
    prepareArtworkRenderer.mockResolvedValue({ encoder: 'ffmpeg-test', hasFont: false });
});
