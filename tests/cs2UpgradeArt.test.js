const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { inflateSync } = require('node:zlib');
const { execFile } = require('node:child_process');
const realExecFile = jest.requireActual('node:child_process').execFile;
const ffmpeg = require('ffmpeg-static');
const reel = require('../utils/cs2Reel');
const { renderUpgrade } = require('../utils/cs2UpgradeArt');

jest.mock('node:child_process', () => ({ execFile: jest.fn() }));
jest.mock('../utils/cs2Reel', () => ({ reserveArtworkSlot: jest.fn() }));

const gif = Buffer.from('GIF89a-rendered-upgrade');
const round = { ticket: 21752, winTickets: 25000, direction: 'under', won: true };
let release;

beforeEach(() => {
    release = jest.fn();
    reel.reserveArtworkSlot.mockReturnValue(release);
    execFile.mockImplementation((_file, _args, options, callback) => {
        void fs.writeFile(path.join(options.cwd, 'upgrade.gif'), gif)
            .then(() => callback(null, { stdout: Buffer.alloc(0), stderr: '' }), callback);
    });
});

afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
});

function pngPixels(png) {
    const chunks = [];
    for (let offset = 8; offset < png.length;) {
        const length = png.readUInt32BE(offset);
        if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + length));
        offset += 12 + length;
    }
    const width = png.readUInt32BE(16);
    const pixels = inflateSync(Buffer.concat(chunks));
    return (x, y) => [...pixels.subarray(y * (width * 3 + 1) + 1 + x * 3, y * (width * 3 + 1) + 4 + x * 3)];
}

test.each([
    null, {}, { ...round, ticket: 0 }, { ...round, ticket: 100001 }, { ...round, ticket: 1.5 },
    { ...round, ticket: NaN }, { ...round, winTickets: 0 }, { ...round, winTickets: 100001 },
    { ...round, winTickets: 1000.5 }, { ...round, direction: 'sideways' }, { ...round, won: false },
    ...[-1, 100000, 1.5, NaN, Infinity, '0', null].map(startTicket => ({ ...round, startTicket })),
    { ...round, startTicket: 50_000, won: true }
])('rejects invalid or contradictory committed results before reserving artwork: %j', async invalid => {
    await expect(renderUpgrade(invalid)).resolves.toBeNull();
    expect(reel.reserveArtworkSlot).not.toHaveBeenCalled();
    expect(execFile).not.toHaveBeenCalled();
});

test.each([0, -1, NaN, Infinity, 1.5])('rejects an invalid attachment limit %s', async limit => {
    await expect(renderUpgrade(round, limit)).resolves.toBeNull();
    expect(reel.reserveArtworkSlot).not.toHaveBeenCalled();
});

test('busy artwork lanes skip the animation without creating temporary files', async () => {
    reel.reserveArtworkSlot.mockReturnValue(null);
    const create = jest.spyOn(fs, 'mkdtemp');
    await expect(renderUpgrade(round)).resolves.toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(execFile).not.toHaveBeenCalled();
});

test.each([
    { ticket: 25000, winTickets: 25000, direction: 'under', won: true },
    { ticket: 25001, winTickets: 25000, direction: 'under', won: false },
    { ticket: 75000, winTickets: 25000, direction: 'over', won: false },
    { ticket: 75001, winTickets: 25000, direction: 'over', won: true }
])('the final marker matches the exact boundary and direction: %j', async result => {
    const rendered = await renderUpgrade(result);
    expect(rendered).toMatchObject({ gif, durationMs: 3000, width: 400, height: 360 });
    const pixel = pngPixels(rendered.png);
    const angle = (result.ticket - 0.5) / 100000 * Math.PI * 2;
    const marker = pixel(Math.floor(200 + Math.sin(angle) * 110), Math.floor(184 - Math.cos(angle) * 110));
    expect(marker).toEqual(result.won ? [141, 237, 191] : [255, 148, 167]);
    // The success arc is clockwise from the top for under, anticlockwise for over.
    const right = pixel(275, 108);
    const left = pixel(124, 108);
    expect(result.direction === 'under' ? right : left).toEqual([149, 92, 246]);
    expect(result.direction === 'under' ? left : right).toEqual([53, 51, 70]);
    const options = execFile.mock.calls[0][2];
    expect(options).toMatchObject({ windowsHide: true, timeout: 8000, maxBuffer: 128 * 1024 });
    expect(path.dirname(options.cwd)).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(options.cwd)).toMatch(/^discord-cs2-upgrade-/);
    await expect(fs.access(options.cwd)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(release).toHaveBeenCalledTimes(1);
});

test.each([
    { ticket: 95000, winTickets: 25000, direction: 'under', startTicket: 87500, won: true },
    { ticket: 5000, winTickets: 25000, direction: 'over', startTicket: 87500, won: true },
    { ticket: 40000, winTickets: 25000, direction: 'under', startTicket: 87500, won: false }
])('custom wrapped ranges paint both sides of zero and agree with the committed result: %j', async result => {
    const rendered = await renderUpgrade(result);
    expect(rendered).toMatchObject({ gif, durationMs: 3000, width: 400, height: 360 });
    const pixel = pngPixels(rendered.png);
    const angle = (result.ticket - 0.5) / 100000 * Math.PI * 2;
    const marker = pixel(Math.floor(200 + Math.sin(angle) * 110), Math.floor(184 - Math.cos(angle) * 110));
    expect(marker).toEqual(result.won ? [141, 237, 191] : [255, 148, 167]);
    expect(pixel(200, 78)).toEqual([149, 92, 246]);
    expect(pixel(200, 290)).toEqual([53, 51, 70]);
    expect(pixel(306, 184)).toEqual([53, 51, 70]);
    expect(pixel(94, 184)).toEqual([53, 51, 70]);
    expect(release).toHaveBeenCalledTimes(1);
});

test('encoding errors clean temporary files and release the shared slot for a retry', async () => {
    execFile.mockImplementationOnce((_file, _args, _options, callback) => callback(Object.assign(new Error('Timed out'), { killed: true })));
    await expect(renderUpgrade(round)).resolves.toBeNull();
    await expect(fs.access(execFile.mock.calls[0][2].cwd)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(release).toHaveBeenCalledTimes(1);
    await expect(renderUpgrade(round)).resolves.toMatchObject({ gif });
    expect(release).toHaveBeenCalledTimes(2);
});

test('temporary file failures still release the reserved slot', async () => {
    jest.spyOn(fs, 'mkdtemp').mockRejectedValueOnce(new Error('Disk unavailable'));
    await expect(renderUpgrade(round)).resolves.toBeNull();
    expect(release).toHaveBeenCalledTimes(1);
    expect(execFile).not.toHaveBeenCalled();
});

test('the attachment limit and hard two-megabyte cap discard oversized GIFs', async () => {
    await expect(renderUpgrade(round, gif.length - 1)).resolves.toBeNull();
    execFile.mockImplementationOnce((_file, _args, options, callback) => {
        const oversized = Buffer.alloc(2_000_001);
        gif.copy(oversized);
        void fs.writeFile(path.join(options.cwd, 'upgrade.gif'), oversized)
            .then(() => callback(null, { stdout: Buffer.alloc(0), stderr: '' }), callback);
    });
    await expect(renderUpgrade(round, 10_000_000)).resolves.toBeNull();
    expect(release).toHaveBeenCalledTimes(2);
});

test('invalid encoder output falls back cleanly', async () => {
    execFile.mockImplementationOnce((_file, _args, options, callback) => {
        void fs.writeFile(path.join(options.cwd, 'upgrade.gif'), 'not a gif')
            .then(() => callback(null, { stdout: Buffer.alloc(0), stderr: '' }), callback);
    });
    await expect(renderUpgrade(round)).resolves.toBeNull();
    expect(release).toHaveBeenCalledTimes(1);
});

(ffmpeg ? test : test.skip)('the bundled encoder produces a bounded animated GIF without network access', async () => {
    execFile.mockImplementation(realExecFile);
    const network = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Network is forbidden'));
    const result = await renderUpgrade({ ticket: 99999, winTickets: 1000, direction: 'over', won: true });
    expect(result).toMatchObject({ durationMs: 3000, width: 400, height: 360 });
    expect(result.gif.subarray(0, 6).toString('ascii')).toBe('GIF89a');
    expect(result.gif.readUInt16LE(6)).toBe(400);
    expect(result.gif.readUInt16LE(8)).toBe(360);
    expect(result.gif.length).toBeLessThanOrEqual(2_000_000);
    expect(result.png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(network).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
}, 12_000);
