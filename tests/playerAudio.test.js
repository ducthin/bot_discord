const { create, tickTimes, revealKind, highestValueItem, CLIPS } = require('../web/play/audio');

function emitter() {
    const events = new Map();
    return { events, addEventListener: (event, fn) => { const all = events.get(event) ?? new Set(); all.add(fn); events.set(event, all); },
        removeEventListener: (event, fn) => events.get(event)?.delete(fn),
        emit: event => { for (const fn of events.get(event) ?? []) fn(); } };
}
function fixture({ muted = false, fail = false } = {}) {
    const contexts = [], sources = [], gains = [], params = () => ({ value: 0, setValueAtTime: jest.fn(function (value) { this.value = value; }),
        cancelScheduledValues: jest.fn(), linearRampToValueAtTime: jest.fn(), exponentialRampToValueAtTime: jest.fn() });
    const node = () => ({ connect: jest.fn(), disconnect: jest.fn() });
    class Context {
        constructor() { this.state = 'suspended'; this.currentTime = 0; this.sampleRate = 44100; this.destination = {}; contexts.push(this); }
        resume = jest.fn(async () => { this.state = 'running'; });
        createGain() { const result = { ...node(), gain: params() }; gains.push(result); return result; }
        createDynamicsCompressor() { return { ...node(), threshold: params(), knee: params(), ratio: params(), attack: params(), release: params() }; }
        createBuffer(_channels, frames) { return { getChannelData: () => new Float32Array(frames) }; }
        createBufferSource() { const result = { ...node(), start: jest.fn(), stop: jest.fn(() => result.onended?.()) }; sources.push(result); return result; }
        createOscillator() { const result = { ...node(), frequency: params(), start: jest.fn(), stop: jest.fn() }; sources.push(result); return result; }
        createBiquadFilter() { return { ...node(), frequency: params() }; }
        decodeAudioData = jest.fn(async () => ({ duration: 2 }));
        close = jest.fn(async () => { this.state = 'closed'; });
    }
    const document = { ...emitter(), hidden: false }, button = { ...emitter(), dataset: {}, setAttribute: jest.fn() };
    const fetch = jest.fn(async () => ({ ok: !fail, headers: new Headers({ 'content-type': 'audio/wav' }), arrayBuffer: async () => new ArrayBuffer(100) }));
    const environment = { ...emitter(), AudioContext: Context, setTimeout, clearTimeout, performance: { now: () => Date.now() }, fetch, document };
    const write = jest.fn(), audio = create({ environment, button, safeRead: () => muted, safeWrite: write });
    return { audio, document, button, contexts, sources, gains, fetch, write, environment };
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('card marker crossing times follow the CSS easing and slow toward the final item', () => {
    const times = tickTimes(5200, 32);
    expect(times).toHaveLength(32); expect(times.at(-1)).toBe(5200);
    expect(times.every((value, index) => index === 0 || value > times[index - 1])).toBe(true);
    expect(times.at(-1) - times.at(-2)).toBeGreaterThan(times[1] - times[0]);
    expect(tickTimes(1000, 4, [0, 0, 1, 1])).toEqual([250, 500, 750, 1000]);
    expect(tickTimes(0)).toEqual([]); expect(tickTimes(Infinity)).toEqual([]);
    expect(tickTimes(120000, 999)).toHaveLength(80);
    expect(tickTimes(120000, 999).at(-1)).toBe(60000);
});

test('reveals use the exact Discord tier clips, while extra accents require special or high-value drops', () => {
    expect(revealKind({ tier: 0, value: '100' }, '100')).toEqual({ cue: 'rare', tier: 0, major: false, spectacular: false });
    expect(revealKind({ tier: 1 }).cue).toBe('mythical'); expect(revealKind({ tier: 2 }).cue).toBe('legendary');
    expect(revealKind({ tier: 3, value: '100' }, '100')).toMatchObject({ cue: 'ancient', major: false });
    expect(revealKind({ tier: 4, value: '1' }, '100')).toMatchObject({ major: true });
    expect(revealKind({ tier: 3, rarity: 'Contraband' }, '100').major).toBe(true);
    expect(revealKind({ tier: 0, value: '500' }, '100').major).toBe(true);
    expect(revealKind({ value: '200000000000000000000000' }, '10000000000000000000000')).toMatchObject({ major: true, spectacular: true });
    expect(revealKind({ value: '10000000' }, 0).major).toBe(false);
});

test('multi-open reveals one highest-value item without losing precision on large values', () => {
    const items = [{ name: 'low', value: '9999999999999999999' }, { name: 'high', value: '10000000000000000000' }, { name: 'bad', value: 'invalid' }];
    expect(highestValueItem(items)).toBe(items[1]);
    expect(highestValueItem([])).toBeNull();
});

test('user gesture initializes one context, loads only the six local WAV clips once, and reports readiness', async () => {
    const f = fixture();
    expect(f.contexts).toHaveLength(0); expect(f.button.dataset.audioState).toBe('locked');
    expect(await f.audio.unlock()).toBe(true); await f.audio.unlock();
    expect(f.contexts).toHaveLength(1); expect(f.contexts[0].resume).toHaveBeenCalledTimes(1);
    expect(f.fetch).toHaveBeenCalledTimes(6);
    expect(f.fetch.mock.calls.map(([url]) => url).sort()).toEqual(Object.values(CLIPS).map(([name]) => `/play/audio/${name}.wav`).sort());
    expect(f.audio.status()).toMatchObject({ state: 'running', assets: 6 });
    f.audio.tick(); expect(f.button.dataset.audioLastCue).toBe('scroll');
    expect(f.sources.at(-1).buffer.duration).toBe(2);
    f.audio.destroy(); expect(f.contexts[0].close).toHaveBeenCalledTimes(1);
});

test('mute changes the shared gain immediately so an already playing clip becomes silent, then persists and restores', async () => {
    const f = fixture(); await f.audio.unlock(); f.audio.reveal({ tier: 3 });
    expect(f.sources.some(source => source.start.mock.calls.length)).toBe(true);
    f.button.emit('click');
    expect(f.gains[0].gain.value).toBe(0); expect(f.write).toHaveBeenLastCalledWith('muted', true);
    expect(f.audio.status().state).toBe('muted');
    const count = f.audio.status().cues; f.audio.tick(); f.audio.result();
    expect(f.audio.status().cues).toBe(count);
    f.button.emit('click'); expect(f.gains[0].gain.value).toBe(.82);
    expect(f.write).toHaveBeenLastCalledWith('muted', false); f.audio.destroy();
});

test('spin clicks follow card crossings and stopping cancels pending clicks and their live clips', async () => {
    const f = fixture(); await f.audio.unlock(); const stop = f.audio.spin(1000, { steps: 10, easing: [0, 0, 1, 1] });
    expect(f.audio.status().cues).toBe(2); // unlock plus first scroll
    await jest.advanceTimersByTimeAsync(399); expect(f.audio.status().cues).toBe(5);
    stop(); const count = f.audio.status().cues;
    await jest.advanceTimersByTimeAsync(5000); expect(f.audio.status().cues).toBe(count);
    expect(f.audio.status().sequences).toBe(0); expect(f.sources.slice(0, 5).every(source => source.stop.mock.calls.length)).toBe(true);
    f.audio.destroy();
});

test('hidden pages stop pending spins, tally sounds and rare-item accents rather than playing stale sounds later', async () => {
    const f = fixture(); await f.audio.unlock();
    f.audio.spin(5200); f.audio.count(2000); f.audio.reveal({ tier: 4 });
    f.document.hidden = true; f.document.emit('visibilitychange');
    const cues = f.audio.status().cues; await jest.advanceTimersByTimeAsync(10000);
    expect(f.audio.status()).toMatchObject({ cues, active: 0, sequences: 0 });
    f.document.hidden = false; await jest.advanceTimersByTimeAsync(1000); expect(f.audio.status().cues).toBe(cues);
    f.audio.destroy();
});

test('a persisted mute creates no context and failed audio fetches retain safe mechanical fallbacks', async () => {
    const muted = fixture({ muted: true }); expect(await muted.audio.unlock()).toBe(false); expect(muted.contexts).toHaveLength(0);
    muted.audio.destroy();
    const fallback = fixture({ fail: true }); expect(await fallback.audio.unlock()).toBe(true);
    expect(fallback.audio.status().assets).toBe(0); fallback.audio.tick();
    expect(fallback.audio.status()).toMatchObject({ cues: 1, lastCue: 'scroll-fallback' });
    expect(() => fallback.audio.reveal({ tier: 4 }, { caseFee: 100 })).not.toThrow();
    fallback.audio.destroy();
});

test('each Battle addition has its own rising note and counter ticks, and the next step can cancel its tail', async () => {
    const f = fixture(); await f.audio.unlock();
    const stopFirst = f.audio.battleTally({ index: 0, count: 8, duration: 750 });
    const firstPitch = f.sources.find(source => source.frequency).frequency.setValueAtTime.mock.calls[0][0];
    expect(f.audio.status().lastCue).toBe('battle-add');
    await jest.advanceTimersByTimeAsync(200);
    expect(f.audio.status().lastCue).toBe('battle-count');
    stopFirst(); const stoppedCount = f.audio.status().cues;
    await jest.advanceTimersByTimeAsync(1000);
    expect(f.audio.status().cues).toBe(stoppedCount);
    const before = f.sources.length;
    const stopLast = f.audio.battleTally({ index: 7, count: 8, duration: 750, final: true });
    const lastPitch = f.sources.slice(before).find(source => source.frequency).frequency.setValueAtTime.mock.calls[0][0];
    expect(lastPitch).toBeGreaterThan(firstPitch);
    expect(f.sources.some(source => source.buffer?.duration === 2)).toBe(false);
    stopLast(); expect(f.audio.status()).toMatchObject({ active: 0, sequences: 0 });
    f.audio.destroy();
});

test('resuming a Battle addition skips sound ticks that belong to an earlier shared-clock interval', async () => {
    const f = fixture(); await f.audio.unlock();
    f.audio.battleTally({ index: 4, count: 8, duration: 750, elapsed: 220 });
    expect(f.audio.status().lastCue).not.toBe('battle-add');
    await jest.advanceTimersByTimeAsync(20);
    expect(f.audio.status().lastCue).toBe('battle-count');
    expect(f.audio.status().lastCue).not.toBe('battle-add');
    f.audio.destroy();
});

test('Upgrade plays dedicated music with a sustained sweep instead of case unlock or reel scroll samples', async () => {
    const f = fixture(); await f.audio.unlock();
    const stop = f.audio.upgradeSpin(1200);
    expect(f.audio.status().lastCue).toBe('upgrade-start');
    expect(f.sources.some(source => source.loop === true)).toBe(true);
    await jest.advanceTimersByTimeAsync(800);
    expect(f.audio.status().lastCue).toBe('upgrade-music');
    expect(f.sources.filter(source => source.frequency).length).toBeGreaterThan(6);
    expect(f.sources.some(source => source.buffer?.duration === 2)).toBe(false);
    stop(); const cues = f.audio.status().cues;
    await jest.advanceTimersByTimeAsync(5000);
    expect(f.audio.status()).toMatchObject({ cues, active: 0, sequences: 0 });
    expect(f.fetch).toHaveBeenCalledTimes(6);
    f.audio.destroy();
});

test.each([true, false])('Upgrade outcome %s has its own bounded ending and respects cancellation', async won => {
    const f = fixture(); await f.audio.unlock();
    const stop = f.audio.upgradeResult(won);
    expect(f.audio.status().lastCue).toBe(won ? 'upgrade-win' : 'upgrade-lose');
    await jest.advanceTimersByTimeAsync(100);
    const count = f.sources.length;
    expect(count).toBeGreaterThan(0);
    stop(); await jest.advanceTimersByTimeAsync(2000);
    expect(f.sources).toHaveLength(count);
    expect(f.audio.status()).toMatchObject({ active: 0, sequences: 0 });
    f.audio.destroy();
});

test('new Battle and Upgrade sequences stop on hidden tabs, while persisted mute starts no sound', async () => {
    const muted = fixture({ muted: true });
    muted.audio.upgradeSpin(6000); muted.audio.battleTally({ duration: 750 }); muted.audio.battleFinish(); muted.audio.upgradeResult(true);
    await Promise.resolve(); await Promise.resolve();
    expect(muted.contexts).toHaveLength(0); expect(muted.audio.status().cues).toBe(0);
    muted.audio.destroy();
    const f = fixture(); await f.audio.unlock();
    f.audio.upgradeSpin(6000); f.audio.battleTally({ duration: 750 }); f.audio.battleFinish();
    f.document.hidden = true; f.document.emit('visibilitychange');
    const cues = f.audio.status().cues;
    await jest.advanceTimersByTimeAsync(10000);
    expect(f.audio.status()).toMatchObject({ cues, active: 0, sequences: 0 });
    f.document.hidden = false; await jest.advanceTimersByTimeAsync(1000);
    expect(f.audio.status().cues).toBe(cues); f.audio.destroy();
});

test('invalid musical durations create no sequence and Battle finish expires by itself', async () => {
    const f = fixture(); await f.audio.unlock();
    for (const duration of [0, -1, Infinity, NaN]) { f.audio.upgradeSpin(duration); f.audio.battleTally({ duration }); }
    expect(f.audio.status()).toMatchObject({ cues: 0, sequences: 0 });
    f.audio.battleFinish(); expect(f.audio.status().lastCue).toBe('battle-finish');
    await jest.advanceTimersByTimeAsync(1500);
    expect(f.audio.status()).toMatchObject({ active: 0, sequences: 0 }); f.audio.destroy();
});

test('a Battle lead change plays a brief separate cue and cancels with the shared audio controller', async () => {
    const f = fixture(); await f.audio.unlock();
    f.audio.battleLead(); expect(f.audio.status().lastCue).toBe('battle-lead');
    await jest.advanceTimersByTimeAsync(80);
    expect(f.sources.filter(source => source.frequency)).toHaveLength(2);
    f.audio.stopAll(); const cues = f.audio.status().cues;
    await jest.advanceTimersByTimeAsync(1000);
    expect(f.audio.status()).toMatchObject({ cues, active: 0, sequences: 0 }); f.audio.destroy();
});
