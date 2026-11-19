const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const reel = require('../utils/cs2Reel');

jest.mock('ffmpeg-static', () => 'ffmpeg-test');
jest.mock('node:child_process', () => ({ execFile: jest.fn() }));
jest.mock('node:fs/promises', () => ({
    copyFile: jest.fn(), mkdtemp: jest.fn(), readFile: jest.fn(), rmdir: jest.fn(), unlink: jest.fn(), writeFile: jest.fn()
}));

const image = 'https://community.akamai.steamstatic.com/economy/image/reel-test';
const card = { image, color: '#4b69ff' };
const cards = Array(28).fill(card);
const selectedIndex = 24;
const result = { image, color: card.color, title: 'Test skin', detail: 'Mil-Spec', tier: 0 };
const round = { cards, selectedIndex, result, landingSeed: 54 };
const gif = Buffer.from('GIF89a');
let encodes;

beforeEach(() => {
    jest.useFakeTimers();
    encodes = [];
    jest.spyOn(global, 'fetch').mockImplementation(async () => new Response(Buffer.from('test image'), {
        headers: { 'content-type': 'image/png' }
    }));
    for (const operation of Object.values(fs)) operation.mockResolvedValue(undefined);
    fs.mkdtemp.mockImplementation(async prefix => prefix + 'test');
    execFile.mockImplementation((_file, args, options, callback) => {
        if (args.includes('-filters')) callback(null, { stdout: '' });
        else encodes.push({ args, directory: options.cwd, finish: () => callback(null, { stdout: gif }) });
    });
});

afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
});

test('selects and reuses a system encoder when the bundled FFmpeg cannot draw text', async () => {
    let freshReel;
    jest.isolateModules(() => { freshReel = require('../utils/cs2Reel'); });
    execFile.mockImplementation((file, _args, _options, callback) => {
        callback(null, { stdout: file === 'ffmpeg' ? ' T.C drawtext          V->V' : '' });
    });
    await expect(freshReel.prepareArtworkRenderer('first.ttf')).resolves.toEqual({ encoder: 'ffmpeg', hasFont: true });
    await expect(freshReel.prepareArtworkRenderer('second.ttf')).resolves.toEqual({ encoder: 'ffmpeg', hasFont: true });
    expect(execFile.mock.calls.map(([file]) => file)).toEqual(['ffmpeg-test', 'ffmpeg']);
});

test('queued single and batch openings are admitted in order before artwork', async () => {
    const firstArtwork = reel.reserveArtworkSlot();
    const secondArtwork = reel.reserveArtworkSlot();
    const first = reel.renderCaseReel(cards, selectedIndex, result, false, 54);
    const batch = reel.renderCaseBatch(Array(3).fill(round));
    const last = reel.renderCaseReel(cards, selectedIndex, result, false, 54);
    expect(reel.reserveArtworkSlot()).toBeNull();

    firstArtwork();
    await jest.advanceTimersByTimeAsync(0);
    expect(encodes).toHaveLength(1);
    secondArtwork();
    expect(reel.reserveArtworkSlot()).toBeNull();
    await jest.advanceTimersByTimeAsync(0);
    expect(encodes).toHaveLength(1);

    encodes[0].finish();
    await expect(first).resolves.toMatchObject({ gif });
    await jest.advanceTimersByTimeAsync(0);
    expect(encodes).toHaveLength(2);
    expect(encodes[1].directory).toContain('discord-cs2-batch-');

    encodes[1].finish();
    await expect(batch).resolves.toMatchObject({ gif });
    await jest.advanceTimersByTimeAsync(0);
    expect(encodes).toHaveLength(3);
    expect(encodes[2].args).toEqual(encodes[0].args);
    encodes[2].finish();
    await expect(last).resolves.toMatchObject({ gif });
});

test('an opening that waits too long falls back without occupying a render slot', async () => {
    const firstArtwork = reel.reserveArtworkSlot();
    const secondArtwork = reel.reserveArtworkSlot();
    const timedOut = reel.renderCaseReel(cards, selectedIndex, result);
    await jest.advanceTimersByTimeAsync(4000);
    await expect(timedOut).resolves.toBeNull();
    expect(encodes).toHaveLength(0);

    firstArtwork();
    secondArtwork();
    const next = reel.renderCaseReel(cards, selectedIndex, result, false, 0);
    await jest.advanceTimersByTimeAsync(0);
    expect(encodes).toHaveLength(1);
    encodes[0].finish();
    await expect(next).resolves.toMatchObject({ gif });
});

test('two battle rounds encode together in bounded lanes with lower frame count and explicit CPU limits', async () => {
    const first = reel.renderCaseBatch(Array(4).fill(round), undefined, { profile: 'battle' });
    const second = reel.renderCaseBatch(Array(4).fill({ ...round, landingSeed: 55 }), undefined, { profile: 'battle' });
    const third = reel.renderCaseBatch(Array(4).fill({ ...round, landingSeed: 56 }), undefined, { profile: 'battle' });
    await jest.advanceTimersByTimeAsync(0);
    expect(encodes).toHaveLength(2);
    expect(reel.reserveArtworkSlot()).toBeNull();
    const [, filter] = fs.writeFile.mock.calls.findLast(([name]) => name.endsWith('batch.txt'));
    expect(filter).toContain('loop=loop=150:size=1:start=0,settb=1/100,setpts=N*4');
    expect(filter).toContain('if(eq(N,151),660,');
    expect(encodes[0].args).toContain('25');
    for (const args of encodes.map(encode => encode.args)) {
        expect(args[args.indexOf('-filter_threads') + 1]).toBe('1');
        expect(args[args.indexOf('-filter_complex_threads') + 1]).toBe('1');
        for (const [index, value] of args.entries()) if (value === '-threads') expect(args[index + 1]).toBe('1');
    }
    encodes[0].finish();
    await expect(first).resolves.toMatchObject({ gif });
    await jest.advanceTimersByTimeAsync(0);
    expect(encodes).toHaveLength(3);
    encodes[1].finish();
    encodes[2].finish();
    await expect(second).resolves.toMatchObject({ gif });
    await expect(third).resolves.toMatchObject({ gif });
});

test('battle queue remains capped and waits beyond the ordinary timeout before bounded fallback', async () => {
    const releaseFirst = reel.reserveArtworkSlot();
    const releaseSecond = reel.reserveArtworkSlot();
    const queued = Array.from({ length: 12 }, (_, index) => reel.renderCaseBatch(Array(2).fill({ ...round, landingSeed: 100 + index }), undefined, { profile: 'battle' }));
    await expect(reel.renderCaseBatch(Array(2).fill({ ...round, landingSeed: 200 }), undefined, { profile: 'battle' })).resolves.toBeNull();
    const completed = jest.fn();
    queued[0].then(completed);
    await jest.advanceTimersByTimeAsync(11_999);
    expect(completed).not.toHaveBeenCalled();
    expect(encodes).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(1);
    await expect(Promise.all(queued)).resolves.toEqual(Array(12).fill(null));
    releaseFirst();
    releaseSecond();
    const probeRelease = reel.reserveArtworkSlot();
    expect(probeRelease).toEqual(expect.any(Function));
    probeRelease();
});

test.each([6, 7, 8, 9, 10])('%s-player battles render larger item cards for every seat in two columns', async players => {
    const rounds = Array(players).fill(round);
    if (players < 10) await expect(reel.renderCaseBatch(rounds)).resolves.toBeNull();
    const battle = reel.renderCaseBatch(rounds, 7_500_000, { profile: 'battle' });
    await jest.advanceTimersByTimeAsync(0);
    expect(encodes).toHaveLength(1);
    const [, filter] = fs.writeFile.mock.calls.findLast(([name]) => name.endsWith('batch.txt'));
    const positions = Array.from({ length: players }, (_, index) => `${index % 2 * 284}_${Math.floor(index / 2) * 88}`);
    expect(filter).toContain(`[track${players - 1}]xstack=inputs=${players}:layout=${positions.join('|')}`);
    expect(filter).toContain('crop=280:82:');
    expect(filter).toContain(`scale=110:74:force_original_aspect_ratio=decrease:flags=lanczos[prizeArt${players - 1}]`);
    expect(filter).toContain('loop=loop=150:size=1:start=0,settb=1/100,setpts=N*4');
    encodes[0].finish();
    await expect(battle).resolves.toMatchObject({ gif });
});

test('ten reels share one GIF and keep the tenth rare reveal in its own column', async () => {
    fs.readFile.mockResolvedValue(Buffer.from('mystery image'));
    const rareCards = cards.map((item, index) => index === selectedIndex
        ? { mystery: 'default_rare_item.png', color: '#e8c77b' } : item);
    const batch = reel.renderCaseBatch([...Array(9).fill(round), { ...round, cards: rareCards }]);
    await jest.advanceTimersByTimeAsync(0);
    expect(encodes).toHaveLength(1);
    const [, filter] = fs.writeFile.mock.calls.findLast(([name]) => name.endsWith('batch.txt'));
    expect(filter).toContain('[track9]xstack=inputs=10:layout=0_0|284_0|0_60|284_60|0_120|284_120|0_180|284_180|0_240|284_240');
    expect(filter).toContain(',split[strip9][still9];[strip9]loop');
    expect(filter).not.toContain('strip9Tile');
    expect(filter).toContain('[still9]crop=280:56:');
    expect(filter).toContain('drawbox=x=405:y=241:w=53:h=54:color=0xffbe36');
    expect(filter).toContain('[reel][gold0][gold1][gold2][landed]concat=n=5');
    encodes[0].finish();
    await expect(batch).resolves.toMatchObject({ gif });
});

test('a single gold win keeps the mystery tile while scrolling and stopping before the gold reveal', async () => {
    fs.readFile.mockResolvedValue(Buffer.from('mystery image'));
    const rareCards = cards.map((item, index) => index === selectedIndex
        ? { mystery: 'default_rare_item.png', color: '#e4ae39' } : item);
    const opening = reel.renderCaseReel(rareCards, selectedIndex, { ...result, tier: 4, color: '#e4ae39' }, false, 54);
    await jest.advanceTimersByTimeAsync(0);
    expect(encodes).toHaveLength(1);
    const { args } = encodes[0];
    const filter = args[args.indexOf('-filter_complex') + 1];
    expect(filter).toContain('split=3[strip][colors][still];[strip]loop');
    expect(filter).not.toContain('stripTile');
    expect(filter).not.toContain('goldStrip');
    expect(filter).toContain('[still]crop=460:96:');
    expect(filter).toContain('if(eq(N,301),660,');
    encodes[0].finish();
    await expect(opening).resolves.toMatchObject({ gif });
});

test('missing case-specific and default mystery images retain a visible local gold symbol', async () => {
    let freshReel;
    jest.isolateModules(() => { freshReel = require('../utils/cs2Reel'); });
    fs.readFile.mockRejectedValue(Object.assign(new Error('Missing image'), { code: 'ENOENT' }));
    const rareCards = cards.map((item, index) => index === selectedIndex
        ? { mystery: 'missing-case-icon.png', color: '#e4ae39' } : item);
    const opening = freshReel.renderCaseReel(rareCards, selectedIndex, { ...result, tier: 4 }, false, 54);
    await jest.advanceTimersByTimeAsync(0);
    expect(encodes).toHaveLength(1);
    const fallback = fs.writeFile.mock.calls.map(([, data]) => data)
        .find(data => Buffer.isBuffer(data) && data.length > 100 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
    expect(fallback.readUInt32BE(16)).toBe(64);
    expect(fallback.readUInt32BE(20)).toBe(64);
    encodes[0].finish();
    await expect(opening).resolves.toMatchObject({ gif });
});

test('missing prize art skips the GIF and direct catalogue artwork is fetched without a Steam suffix', async () => {
    const directUrl = 'https://esm.sh/gh/isaac-goldberg/cs2-images@abc/skins/finish.png';
    global.fetch.mockImplementation(async () => new Response(null, { status: 404 }));
    const rareCards = Array.from({ length: 28 }, (_, index) => index === selectedIndex
        ? { mystery: 'default_rare_item.png', color: '#e4ae39' } : { image: directUrl, color: card.color });
    const prizeUrl = `${image}-unavailable`;
    const opening = reel.renderCaseReel(rareCards, selectedIndex, { ...result, image: prizeUrl, tier: 4 });
    await expect(opening).resolves.toBeNull();
    expect(encodes).toHaveLength(0);
    expect(global.fetch.mock.calls.map(([url]) => url.href)).toContain(directUrl);
});
