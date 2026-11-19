(function (root, factory) {
    'use strict';
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.MaySkinsAudio = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';
    const CLIPS = Object.freeze({
        unlock: ['case_unlock_01', .5], scroll: ['crate_item_scroll', .2],
        rare: ['case_reveal_rare_01', .3], mythical: ['case_reveal_mythical_01', .2],
        legendary: ['case_reveal_legendary_01', .3], ancient: ['case_reveal_ancient_01', .3]
    });
    const DEFAULT_EASING = [.12, .7, .1, 1];
    const cubic = (a, b, t) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
    // The sound occurs when a card crosses the marker, using the same curve as
    // the CSS transform. This keeps the late clicks in sync with deceleration.
    function tickTimes(duration, steps = 30, easing = DEFAULT_EASING) {
        if (!Number.isFinite(duration) || duration <= 0) return [];
        duration = Math.min(duration, 60_000);
        steps = Math.max(1, Math.min(80, Math.round(steps) || 30));
        if (!Array.isArray(easing) || easing.length !== 4 || easing.some(n => !Number.isFinite(n) || n < 0 || n > 1)) easing = DEFAULT_EASING;
        return Array.from({ length: steps }, (_, index) => {
            const progress = (index + 1) / steps;
            let low = 0, high = 1;
            for (let i = 0; i < 24; i++) {
                const t = (low + high) / 2;
                if (cubic(easing[1], easing[3], t) < progress) low = t; else high = t;
            }
            return Math.round(duration * cubic(easing[0], easing[2], (low + high) / 2));
        });
    }
    function amount(value) { try { return BigInt(value ?? 0); } catch { return 0n; } }
    function highestValueItem(items = []) {
        return items.reduce((best, item) => amount(item?.value) > amount(best?.value) ? item : best, null);
    }
    function revealKind(item = {}, caseFee = 0) {
        const tier = Number.isInteger(item.tier) ? Math.max(0, Math.min(4, item.tier)) : 0;
        const fee = amount(caseFee), value = amount(item.value);
        const special = tier === 4 || item.rarity === 'Contraband';
        const major = special || (fee > 0n && value >= fee * 5n);
        return { cue: ['rare', 'mythical', 'legendary', 'ancient', 'ancient'][tier],
            tier, major, spectacular: fee > 0n && value >= fee * 20n };
    }
    function create(options = {}) {
        const environment = options.environment ?? root;
        const doc = options.document ?? environment.document;
        const button = options.button ?? doc?.getElementById?.('sound-toggle');
        const read = options.safeRead ?? (() => false), write = options.safeWrite ?? (() => {});
        const later = environment.setTimeout.bind(environment), cancel = environment.clearTimeout.bind(environment);
        const time = () => environment.performance?.now?.() ?? Date.now();
        const fetchClip = options.fetch ?? environment.fetch?.bind(environment);
        let muted = read('muted', false) === true, context, master, compressor, noise;
        let assetsReady, disposed = false, cueCount = 0, lastCue = '', contextState = 'locked';
        const buffers = new Map(), loading = new Map(), sources = new Set(), groups = new Set();
        const callbacks = [];
        function update() {
            if (!button) return;
            button.setAttribute('aria-pressed', String(!muted));
            button.setAttribute('aria-label', muted ? 'Bật âm thanh' : 'Tắt âm thanh');
            button.innerHTML = `${muted ? '♩' : '♫'} <span>Âm thanh ${muted ? 'tắt' : 'bật'}</span>`;
            button.dataset.audioState = muted ? 'muted' : context?.state ?? contextState;
            button.dataset.audioCues = String(cueCount);
            button.dataset.audioAssets = String(buffers.size);
            button.dataset.audioLastCue = lastCue;
        }
        function volume() {
            if (!master || !context) return;
            master.gain.cancelScheduledValues(context.currentTime);
            master.gain.setValueAtTime(muted ? 0 : .82, context.currentTime);
        }
        function track(source, group) {
            sources.add(source); group?.sources.add(source);
            source.onended = () => {
                sources.delete(source); group?.sources.delete(source);
                try { source.disconnect(); } catch { /* Already detached. */ }
            };
            return source;
        }
        function available() { return !disposed && !muted && !doc?.hidden && context?.state === 'running'; }
        function mark(cue) { cueCount++; lastCue = cue; update(); }
        async function load(cue) {
            if (buffers.has(cue)) return buffers.get(cue);
            if (loading.has(cue)) return loading.get(cue);
            if (!context || !fetchClip) return null;
            const pending = (async () => {
                try {
                    const response = await fetchClip(`/play/audio/${CLIPS[cue][0]}.wav`, { cache: 'force-cache', credentials: 'same-origin' });
                    if (!response.ok || !/^audio\/wav(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) return null;
                    const data = await response.arrayBuffer();
                    if (data.byteLength < 44 || data.byteLength > 2_000_000) return null;
                    const decoded = await context.decodeAudioData(data);
                    if (!decoded || decoded.duration > 8 || decoded.duration <= 0) return null;
                    buffers.set(cue, decoded); update();
                    return decoded;
                } catch { return null; }
            })().finally(() => loading.delete(cue));
            loading.set(cue, pending);
            return pending;
        }
        async function unlock() {
            if (disposed || muted) return false;
            try {
                if (!context) {
                    const AudioContext = environment.AudioContext ?? environment.webkitAudioContext;
                    if (!AudioContext) { contextState = 'unavailable'; update(); return false; }
                    context = new AudioContext();
                    master = context.createGain();
                    compressor = context.createDynamicsCompressor();
                    compressor.threshold.setValueAtTime(-8, context.currentTime);
                    compressor.knee.setValueAtTime(15, context.currentTime);
                    compressor.ratio.setValueAtTime(5, context.currentTime);
                    compressor.attack.setValueAtTime(.003, context.currentTime);
                    compressor.release.setValueAtTime(.12, context.currentTime);
                    master.connect(compressor); compressor.connect(context.destination);
                    context.addEventListener?.('statechange', update);
                    noise = context.createBuffer(1, Math.round(context.sampleRate * .13), context.sampleRate);
                    const samples = noise.getChannelData(0);
                    let seed = 0x41c64e6d;
                    for (let i = 0; i < samples.length; i++) {
                        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
                        samples[i] = seed / 2147483648 - 1;
                    }
                    volume();
                }
                if (context.state === 'suspended' || context.state === 'interrupted') await context.resume();
                update();
                assetsReady ??= Promise.allSettled(Object.keys(CLIPS).map(load));
                await assetsReady;
                return context.state === 'running';
            } catch { contextState = 'blocked'; update(); return false; }
        }
        function clip(cue, group, gainMultiplier = 1) {
            if (!available() || group?.stopped) return false;
            const buffer = buffers.get(cue);
            if (!buffer) { void load(cue); return false; }
            const source = track(context.createBufferSource(), group), gain = context.createGain();
            source.buffer = buffer;
            gain.gain.setValueAtTime(CLIPS[cue][1] * gainMultiplier, context.currentTime);
            source.connect(gain); gain.connect(master);
            source.start(); mark(cue); return true;
        }
        function synth({ frequency = 900, duration = .04, gain: level = .025, type = 'triangle', endFrequency, noiseGain = 0 } = {}, group) {
            if (!available() || group?.stopped) return;
            const start = context.currentTime, oscillator = track(context.createOscillator(), group), gain = context.createGain();
            oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, start);
            if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
            gain.gain.setValueAtTime(0, start);
            gain.gain.linearRampToValueAtTime(level, start + .003);
            gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
            oscillator.connect(gain); gain.connect(master); oscillator.start(start); oscillator.stop(start + duration + .01);
            if (noiseGain && noise) {
                const source = track(context.createBufferSource(), group), filter = context.createBiquadFilter(), envelope = context.createGain();
                source.buffer = noise; filter.type = 'highpass'; filter.frequency.setValueAtTime(1700, start);
                envelope.gain.setValueAtTime(noiseGain, start); envelope.gain.exponentialRampToValueAtTime(.0001, start + Math.min(duration, .1));
                source.connect(filter); filter.connect(envelope); envelope.connect(master);
                source.start(start); source.stop(start + Math.min(duration, .1));
            }
        }
        function makeGroup() {
            const group = { timers: new Set(), sources: new Set(), stopped: false };
            group.stop = () => {
                if (group.stopped) return;
                group.stopped = true;
                for (const timer of group.timers) cancel(timer);
                group.timers.clear();
                for (const source of [...group.sources]) {
                    try { source.stop(); } catch { /* Already finished. */ }
                    sources.delete(source);
                    try { source.disconnect(); } catch { /* Already detached. */ }
                }
                group.sources.clear(); groups.delete(group);
            };
            group.after = (ms, action) => {
                const timer = later(() => { group.timers.delete(timer); if (!group.stopped) action(); }, ms);
                group.timers.add(timer);
            };
            groups.add(group); return group;
        }
        function tick(group) {
            if (clip('scroll', group)) return;
            if (available()) { synth({ frequency: 1450, endFrequency: 420, duration: .025, gain: .035, noiseGain: .065 }, group); mark('scroll-fallback'); }
        }
        function spin(duration, options = {}) {
            if (!Number.isFinite(duration) || duration <= 0 || disposed) return () => {};
            const elapsed = Math.max(0, Math.min(duration, Number(options.elapsed) || 0));
            if (elapsed >= duration) return () => {};
            const group = makeGroup(), started = time();
            void unlock();
            if (!elapsed) {
                if (!clip('unlock', group)) void load('unlock').then(() => { if (!group.stopped && time() - started < 350) clip('unlock', group); });
                tick(group);
            }
            for (const at of tickTimes(duration, options.steps, options.easing)) if (at > elapsed) group.after(at - elapsed, () => tick(group));
            group.after(Math.max(0, Math.min(duration, 60_000) - elapsed) + 1500, group.stop);
            return group.stop;
        }
        function reveal(item, options = {}) {
            const kind = revealKind(item, options.caseFee);
            if (!available()) return kind;
            if (!clip(kind.cue)) synth({ frequency: kind.tier >= 3 ? 155 : 360, endFrequency: 80, duration: .24, gain: .075, type: 'sine', noiseGain: .025 });
            if (kind.major) {
                const group = makeGroup();
                synth({ frequency: 100, endFrequency: 42, duration: .48, gain: .11, noiseGain: .035 }, group);
                group.after(90, () => synth({ frequency: 880, endFrequency: 1320, duration: .45, gain: .02, type: 'sine' }, group));
                group.after(175, () => synth({ frequency: 1320, endFrequency: 1760, duration: .55, gain: .016, type: 'sine' }, group));
                group.after(1200, group.stop); mark(kind.spectacular ? 'spectacular' : 'major');
            }
            return kind;
        }
        function result(won = true) {
            if (!available()) return;
            synth({ frequency: won ? 220 : 140, endFrequency: won ? 440 : 70, duration: won ? .38 : .24, gain: .045, type: 'sine' });
            mark(won ? 'win' : 'finish');
        }
        function count(duration = 1000) {
            if (!Number.isFinite(duration) || duration <= 0 || disposed) return () => {};
            const group = makeGroup();
            for (let at = 0; at < Math.min(duration, 5000); at += 65) group.after(at, () => {
                if (!available()) return;
                synth({ frequency: 1350 + 150 * at / duration, endFrequency: 900, duration: .018, gain: .012, noiseGain: .008 }, group); mark('count');
            });
            group.after(Math.min(duration, 5000) + 100, group.stop);
            return group.stop;
        }
        // Original musical cues: Upgrade uses a synth bed and an arpeggio,
        // while the Battle tally uses short pitched additions. Neither plays
        // the case-unlock or reel-scroll samples.
        function musicalGroup(play, initialElapsed = 0) {
            const group = makeGroup(), started = time() - Math.max(0, Number(initialElapsed) || 0);
            if (available()) play(group, Math.max(0, Number(initialElapsed) || 0));
            else void unlock().then(() => {
                const elapsed = Math.max(0, time() - started);
                if (!group.stopped && available() && elapsed < 300) play(group, elapsed);
                else group.stop();
            });
            return group;
        }
        function battleTally({ index = 0, count: itemCount = 1, duration = 420, final = false, elapsed: elapsedTime = 0 } = {}) {
            if (!Number.isFinite(duration) || duration <= 0 || disposed) return () => {};
            duration = Math.max(80, Math.min(1000, duration));
            const elapsed = Math.max(0, Math.min(duration, Number(elapsedTime) || 0));
            const progress = Math.max(0, Math.min(1, Number(index) / Math.max(1, Number(itemCount) - 1) || 0));
            const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
            const note = 440 * 2 ** (scale[Math.round(progress * (scale.length - 1))] / 12);
            const group = musicalGroup((sequence, elapsed) => {
                const hit = () => {
                    synth({ frequency: note, endFrequency: note * .995, duration: Math.min(.17, duration / 1500), gain: .028, type: 'triangle', noiseGain: .009 }, sequence);
                    synth({ frequency: note * 2, duration: .08, gain: .008, type: 'sine' }, sequence);
                    mark('battle-add');
                };
                if (elapsed < Math.min(duration, 100)) hit();
                for (let at = 48; at < duration - 35; at += 62) if (at > elapsed) sequence.after(at - elapsed, () => {
                    if (!available()) return;
                    const pitch = note * (1 + .18 * at / duration);
                    synth({ frequency: pitch, endFrequency: pitch * .94, duration: .025, gain: .009, type: 'sine' }, sequence);
                    mark('battle-count');
                });
                if (final && duration - elapsed > 70) sequence.after(duration - elapsed - 60, () => {
                    synth({ frequency: note * 1.5, duration: .08, gain: .01, type: 'sine' }, sequence);
                });
                sequence.after(Math.max(0, duration - elapsed) + 180, sequence.stop);
            }, elapsed);
            return group.stop;
        }
        function battleFinish() {
            if (disposed) return () => {};
            const group = musicalGroup((sequence, elapsed) => {
                const notes = [523.251, 659.255, 783.991, 1046.502];
                notes.forEach((frequency, index) => {
                    const at = index * 75;
                    if (at >= elapsed) sequence.after(at - elapsed, () => {
                        synth({ frequency, duration: .58, gain: .019, type: 'triangle' }, sequence);
                        synth({ frequency: frequency * 2, duration: .3, gain: .006, type: 'sine' }, sequence);
                    });
                });
                mark('battle-finish'); sequence.after(Math.max(0, 1100 - elapsed), sequence.stop);
            });
            return group.stop;
        }
        function battleLead() {
            if (disposed) return () => {};
            const group = musicalGroup((sequence, elapsed) => {
                [659.255, 987.767].forEach((frequency, index) => {
                    const at = index * 75;
                    if (at >= elapsed) sequence.after(at - elapsed, () => synth({ frequency, duration: .25, gain: .015, type: 'sine' }, sequence));
                });
                mark('battle-lead'); sequence.after(Math.max(0, 500 - elapsed), sequence.stop);
            });
            return group.stop;
        }
        function upgradeSpin(duration = 6000) {
            if (!Number.isFinite(duration) || duration <= 0 || disposed) return () => {};
            duration = Math.min(duration, 60_000);
            const group = musicalGroup((sequence, elapsed) => {
                const remaining = Math.max(0, duration - elapsed);
                if (!remaining) { sequence.stop(); return; }
                // A quiet air sweep supplies tension underneath the melody.
                if (noise) {
                    const source = track(context.createBufferSource(), sequence), filter = context.createBiquadFilter(), envelope = context.createGain();
                    source.buffer = noise; source.loop = true; filter.type = 'bandpass';
                    filter.frequency.setValueAtTime(350 + 900 * elapsed / duration, context.currentTime);
                    filter.frequency.exponentialRampToValueAtTime(2400, context.currentTime + remaining / 1000);
                    envelope.gain.setValueAtTime(.0001, context.currentTime);
                    envelope.gain.linearRampToValueAtTime(.018, context.currentTime + Math.min(.4, remaining / 3000));
                    envelope.gain.exponentialRampToValueAtTime(.0001, context.currentTime + remaining / 1000);
                    source.connect(filter); filter.connect(envelope); envelope.connect(master);
                    source.start(); source.stop(context.currentTime + remaining / 1000);
                }
                const motif = [220, 261.626, 329.628, 391.995, 329.628, 261.626, 293.665, 329.628];
                let step = 0;
                for (let at = 0; at < duration - 90; ) {
                    const current = at, noteIndex = step++, progress = current / duration;
                    if (current >= elapsed) sequence.after(current - elapsed, () => {
                        if (!available()) return;
                        const frequency = motif[noteIndex % motif.length] * (progress > .55 ? 2 : 1);
                        synth({ frequency, endFrequency: frequency * 1.003, duration: .24 + .13 * progress, gain: .024, type: 'triangle' }, sequence);
                        synth({ frequency: frequency * 1.5, duration: .16, gain: .006, type: 'sine' }, sequence);
                        if (noteIndex % 4 === 0) synth({ frequency: progress > .55 ? 110 : 55, duration: .32, gain: .025, type: 'sine' }, sequence);
                        mark('upgrade-music');
                    });
                    at += 100 + Math.round(260 * progress ** 3);
                }
                mark('upgrade-start'); sequence.after(remaining + 80, sequence.stop);
            });
            return group.stop;
        }
        function upgradeResult(won = true) {
            if (disposed) return () => {};
            const group = musicalGroup((sequence, elapsed) => {
                const notes = won ? [523.251, 659.255, 783.991, 1046.502] : [293.665, 261.626, 220];
                notes.forEach((frequency, index) => {
                    const at = index * (won ? 95 : 120);
                    if (at >= elapsed) sequence.after(at - elapsed, () => {
                        synth({ frequency, endFrequency: won ? frequency : frequency * .91, duration: won ? .65 : .34, gain: .028, type: won ? 'triangle' : 'sine' }, sequence);
                        if (won) synth({ frequency: frequency * 2, duration: .38, gain: .008, type: 'sine' }, sequence);
                    });
                });
                mark(won ? 'upgrade-win' : 'upgrade-lose');
                sequence.after(Math.max(0, (won ? 1400 : 900) - elapsed), sequence.stop);
            });
            return group.stop;
        }
        function stopAll() {
            for (const group of [...groups]) group.stop();
            for (const source of [...sources]) { try { source.stop(); } catch { /* Already finished. */ } }
            sources.clear();
        }
        function listen(target, event, callback, settings) {
            target?.addEventListener?.(event, callback, settings);
            callbacks.push(() => target?.removeEventListener?.(event, callback, settings));
        }
        function toggle() { muted = !muted; write('muted', muted); volume(); update(); if (!muted) void unlock(); return !muted; }
        listen(button, 'click', toggle);
        listen(doc, 'pointerdown', () => { void unlock(); }, { passive: true });
        listen(doc, 'keydown', () => { void unlock(); }, { passive: true });
        listen(doc, 'visibilitychange', () => { if (doc.hidden) stopAll(); });
        listen(environment, 'pagehide', stopAll);
        update();
        return { unlock, toggle, tick: () => tick(), result, spin, reveal, count,
            battleTally, battleFinish, battleLead, upgradeSpin, upgradeResult, stopAll,
            status: () => ({ state: muted ? 'muted' : context?.state ?? contextState, muted, assets: buffers.size, cues: cueCount, lastCue, active: sources.size, sequences: groups.size }),
            destroy: () => { disposed = true; stopAll(); callbacks.forEach(remove => remove()); void context?.close?.(); } };
    }
    return { create, tickTimes, revealKind, highestValueItem, CLIPS };
});
