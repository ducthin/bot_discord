(function (root, factory) {
    'use strict';
    if (typeof module === 'object' && module.exports) module.exports = factory(require('../../utils/playerBattleModes'));
    else root.MaySkinsBattlePresentation = factory(root.MaySkinsBattleModes);
})(typeof window === 'object' ? window : this, function (rules) {
    'use strict';
    const amount = value => { try { return BigInt(value ?? 0); } catch { return 0n; } };
    function totals(players, rounds, count = rounds.length) {
        const result = Object.fromEntries(players.map(player => [player.userId, 0n]));
        for (const round of rounds.slice(0, Math.max(0, count))) {
            for (const entry of round.entries ?? []) if (Object.hasOwn(result, entry.userId)) result[entry.userId] += amount(entry.value);
        }
        return result;
    }
    function standings(values, mode, settled = false) {
        const entries = Object.entries(values).map(([id, value]) => [id, amount(value)]);
        if (!entries.length) return {};
        const configuration = rules?.MODES?.[mode];
        if (mode === 'sharing' || configuration?.base === 'sharing') return Object.fromEntries(entries.map(([id]) => [id, 'sharing']));
        if (configuration?.base === 'jackpot') return Object.fromEntries(entries.map(([id]) => [id, 'tied']));
        const inverse = configuration?.inverse ?? mode === 'crazy';
        const best = entries.reduce((value, [, next]) => inverse ? (value < next ? value : next) : (value > next ? value : next), entries[0][1]);
        const counts = new Map();
        for (const [, value] of entries) counts.set(value.toString(), (counts.get(value.toString()) ?? 0) + 1);
        return Object.fromEntries(entries.map(([id, value]) => [id,
            counts.get(value.toString()) > 1 && value === best && !settled ? 'tied' : value === best ? 'leading' : 'trailing']));
    }
    function modeScores(room, count = room.rounds?.length ?? 0) {
        if (rules?.scoreBattle) return rules.scoreBattle(room, count);
        const playerScores = totals(room.players ?? [], room.rounds ?? [], count);
        const groups = (room.players ?? []).map(player => ({ id: player.userId, label: player.displayName ?? player.userId,
            userIds: [player.userId], score: playerScores[player.userId] }));
        return { groups, playerScores, groupScores: { ...playerScores } };
    }
    function rankings(room, count = room.rounds?.length ?? 0, settled = false) {
        const players = room.players ?? [], configuration = rules?.MODES?.[room.mode];
        if (room.mode === 'sharing' || configuration?.base === 'sharing') return Object.fromEntries(players.map(player => [player.userId, 'sharing']));
        if (settled && Array.isArray(room.winners)) {
            const winners = new Set(room.winners);
            return Object.fromEntries(players.map(player => [player.userId, winners.has(player.userId) ? 'leading' : 'trailing']));
        }
        const scores = modeScores(room, count), states = standings(scores.groupScores, room.mode);
        return Object.fromEntries(scores.groups.flatMap(group => group.userIds.map(id => [id, states[group.id] ?? 'tied'])));
    }
    function uniqueGroupLeader(room, count = room.rounds?.length ?? 0) {
        const scores = modeScores(room, count), states = standings(scores.groupScores, room.mode);
        const leaders = scores.groups.filter(group => states[group.id] === 'leading');
        return leaders.length === 1 ? leaders[0].id : null;
    }
    function interpolate(from, to, units) {
        const progress = BigInt(Math.max(0, Math.min(1000, Math.round(units))));
        const start = amount(from), end = amount(to);
        return start + (end - start) * progress / 1000n;
    }
    function indices(length, count, seed) {
        if (!Number.isInteger(length) || length < 1 || !Number.isInteger(count) || count < 0 || count > 100) return [];
        let value = 2166136261;
        for (const char of String(seed)) value = Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0;
        return Array.from({ length: count }, () => {
            value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
            return (value >>> 0) % length;
        });
    }
    function center(windowHeight, cardHeight, gap, index) {
        return windowHeight / 2 - cardHeight / 2 - index * (cardHeight + gap);
    }
    function exclusiveRound(room, roundIndex) {
        const round = room?.rounds?.[roundIndex];
        const entries = Array.isArray(round?.entries) ? round.entries : [];
        const caseInfo = room?.cases?.find(item => item.id === round?.caseId);
        const enabled = room?.exclusiveDrop === true;
        const validItem = item => item && typeof item === 'object' && !item.isExclusiveTrigger;
        const hits = enabled ? entries.filter(entry => entry.exclusive?.triggered === true && validItem(entry.item)) : [];
        const variants = new Set(hits.map(entry => [entry.item.skinId ?? entry.item.name, entry.item.wear,
            entry.item.statTrak === true, entry.item.phase, entry.item.paintSeed].join(':')));
        const isHiddenOutcome = item => item.exclusiveEligible === true || variants.has([item.skinId ?? item.name,
            item.wear, item.statTrak === true, item.phase, item.paintSeed].join(':'));
        const trigger = {
            ...(caseInfo?.exclusive?.trigger ?? {}),
            id: caseInfo?.exclusive?.trigger?.id ?? 'exclusive-drop', name: 'Exclusive Drop',
            isExclusiveTrigger: true, tier: 4, rarity: 'Exclusive Drop', color: '#e4ae39',
            chance: caseInfo?.exclusive?.chance ?? hits[0]?.exclusive?.chance ?? 0
        };
        const fallback = (room?.rounds ?? []).flatMap(item => item.entries ?? [])
            .filter(entry => !enabled || entry.exclusive?.triggered !== true)
            .map(entry => entry.item).filter(validItem);
        const ordinary = (Array.isArray(caseInfo?.reelEntries) && caseInfo.reelEntries.length
            ? caseInfo.reelEntries : fallback).filter(validItem);
        const normalPool = enabled ? ordinary.filter(item => !isHiddenOutcome(item)) : ordinary;
        if (enabled && (caseInfo?.exclusive?.available === true || hits.length)) normalPool.push(trigger);
        const selected = Array.isArray(caseInfo?.exclusive?.items) ? caseInfo.exclusive.items.filter(validItem) : [];
        const exclusivePool = enabled ? selected.length ? selected : hits.map(entry => entry.item) : [];
        return { enabled, hasExclusive: hits.length > 0, hitUserIds: hits.map(entry => entry.userId), trigger,
            normalPool, exclusivePool, entriesByUser: Object.fromEntries(entries.map(entry => [entry.userId, entry])) };
    }
    function payoutTargets(room) {
        const winners = new Set(room.winners ?? []);
        return Object.fromEntries((room.players ?? []).map(player => [player.userId,
            !winners.has(player.userId) ? 0n : room.payoutType === 'skins' ? amount(room.pool)
                : amount(room.payouts?.[player.userId] ?? room.botPayouts?.[player.userId])]));
    }
    function payoutsAt(room, countedPool) {
        const pool = amount(room.pool), counted = amount(countedPool);
        const progress = counted < 0n ? 0n : counted > pool ? pool : counted;
        return Object.fromEntries(Object.entries(payoutTargets(room)).map(([id, target]) => [id,
            pool > 0n ? (progress === pool ? target : target * progress / pool) : 0n]));
    }
    function uniqueLeader(values, mode) {
        const leading = Object.entries(standings(values, mode)).filter(([, state]) => state === 'leading');
        return leading.length === 1 ? leading[0][0] : null;
    }
    function tallyPlan(room) {
        const seats = new Map((room.players ?? []).map((player, index) => [player.userId,
            Number.isInteger(player.seat) ? player.seat : index + 1]));
        const entries = (room.rounds ?? []).flatMap((round, roundIndex) => (round.entries ?? [])
            .filter(entry => seats.has(entry.userId))
            .toSorted((a, b) => seats.get(a.userId) - seats.get(b.userId))
            .map(entry => ({ ...entry, roundIndex })));
        const interval = Math.max(120, Math.min(750, Math.round(9600 / Math.max(1, entries.length))));
        const finishDelay = 850;
        let pool = 0n;
        const runningTotals = Object.fromEntries((room.players ?? []).map(player => [player.userId, 0n]));
        const steps = entries.map((entry, index) => {
            const value = amount(entry.value);
            const from = pool;
            pool += value;
            runningTotals[entry.userId] += value;
            return { ...entry, index, value, from, pool, totals: { ...runningTotals }, payouts: payoutsAt(room, pool),
                at: index * interval, endAt: (index + 1) * interval, duration: interval };
        });
        return { steps, interval, finishDelay, duration: steps.length * interval + finishDelay, pool,
            payouts: payoutTargets(room) };
    }
    function playbackPlan(room) {
        const rounds = room.rounds ?? [], tally = tallyPlan(room), segments = [];
        let cursor = 0;
        const add = (kind, duration, roundIndex, completed, tallyCount = 0, holding = false) => {
            const start = cursor;
            cursor += duration;
            segments.push({ kind, start, end: cursor, duration, roundIndex, completed, tallyCount, holding });
        };
        for (const [index, round] of rounds.entries()) {
            add('spinning', 4200, index, index);
            if (room.exclusiveDrop === true && (round.entries ?? []).some(entry =>
                entry.exclusive?.triggered === true && entry.item && typeof entry.item === 'object' && !entry.item.isExclusiveTrigger)) {
                add('exclusive-trigger', 900, index, index);
                add('exclusive-spinning', 3600, index, index);
            }
            add('revealed', index + 1 < rounds.length ? 1350 : 850, index, index + 1);
        }
        if (rounds.length && tally.steps.length) {
            const addTally = (duration, count, holding = false) => add('tally', duration, rounds.length - 1, rounds.length, count, holding);
            addTally(180, 0);
            for (const step of tally.steps) addTally(step.duration, step.index + 1);
            addTally(tally.finishDelay, tally.steps.length, true);
            if (jackpotDecision(room)) add('jackpot-draw', 2800, rounds.length - 1, rounds.length, tally.steps.length, true);
        }
        return { segments, duration: cursor, tally, rounds };
    }
    function jackpotDecision(room) {
        const decision = room?.decision;
        if (rules?.MODES?.[room?.mode]?.base !== 'jackpot' || decision?.base !== 'jackpot'
            || !/^(0|[1-9]\d*)$/.test(decision.ticket ?? '') || !/^[1-9]\d*$/.test(decision.totalWeight ?? '')
            || !Array.isArray(decision.groups) || !Array.isArray(decision.winningGroups) || decision.winningGroups.length !== 1) return false;
        try {
            const ticket = BigInt(decision.ticket), total = BigInt(decision.totalWeight);
            let sum = 0n, cursor = 0n, ticketInWinner = false;
            for (const group of decision.groups) {
                if (!/^(0|[1-9]\d*)$/.test(group.weight ?? '')) return false;
                const weight = BigInt(group.weight), end = cursor + weight;
                if (group.id === decision.winningGroups[0] && ticket >= cursor && ticket < end && weight > 0n) ticketInWinner = true;
                sum += weight; cursor = end;
            }
            return ticket < total && sum === total && ticketInWinner;
        } catch { return false; }
    }
    function playbackAt(plan, elapsed) {
        const { segments, duration, tally, rounds } = plan;
        const at = Number.isNaN(elapsed) ? 0 : elapsed;
        if (!rounds.length || at >= duration) return { phase: 'finished', stage: 'finished',
            roundIndex: Math.max(0, rounds.length - 1), completed: rounds.length, progress: 1,
            elapsedInStage: 0, duration: 0, tallyCount: tally.steps.length };
        if (at < 0) return { phase: 'rounds', stage: 'waiting', roundIndex: 0, completed: 0,
            progress: 0, elapsedInStage: at, duration: 0, tallyCount: 0 };

        // Locate the stage by its end time so a late frame never replays stages it missed.
        let low = 0, high = segments.length - 1;
        while (low < high) {
            const mid = (low + high) >>> 1;
            if (at < segments[mid].end) high = mid;
            else low = mid + 1;
        }
        const segment = segments[low], elapsedInStage = at - segment.start;
        return { phase: segment.kind === 'tally' || segment.kind === 'jackpot-draw' ? 'tally' : 'rounds', stage: segment.kind,
            roundIndex: segment.roundIndex, completed: segment.completed, progress: elapsedInStage / segment.duration,
            elapsedInStage, duration: segment.duration, tallyCount: segment.tallyCount, holding: segment.holding };
    }
    function tallyAt(plan, playback) {
        const tally = plan.tally, steps = tally.steps;
        const zeroTotals = Object.fromEntries(Object.keys(steps[0]?.totals ?? {}).map(id => [id, 0n]));
        if (playback.phase === 'finished') return { pool: tally.pool, totals: steps.at(-1)?.totals ?? zeroTotals };
        if (playback.phase !== 'tally' || playback.tallyCount <= 0) return { pool: 0n, totals: zeroTotals };
        const step = steps[Math.min(steps.length, playback.tallyCount) - 1];
        if (!step) return { pool: 0n, totals: zeroTotals };
        if (playback.holding) return { pool: step.pool, totals: { ...step.totals } };
        const previous = steps[step.index - 1];
        const fraction = Math.min(1, Math.max(0, Number(playback.progress) || 0) / .82);
        const units = Math.round((1 - (1 - fraction) ** 3) * 1000);
        return { pool: interpolate(previous?.pool ?? 0n, step.pool, units),
            totals: Object.fromEntries(Object.entries(step.totals).map(([id, target]) => [id,
                interpolate(previous?.totals?.[id] ?? 0n, target, units)])) };
    }
    function jackpotPosition(decision, progress) {
        const scale = 1_000_000_000_000n;
        if (decision?.base !== 'jackpot' || !/^(0|[1-9]\d*)$/.test(decision.ticket ?? '')
            || !/^[1-9]\d*$/.test(decision.totalWeight ?? '')) return 0;
        try {
            const ticket = BigInt(decision.ticket), total = BigInt(decision.totalWeight);
            if (ticket >= total) return 0;
            const targetUnits = ((ticket * 2n + 1n) * scale) / (2n * total);
            const target = Number(targetUnits) / Number(scale);
            const amount = Math.min(1, Math.max(0, Number(progress) || 0));
            if (amount >= 1) return 3 + target;
            const eased = ease(amount);
            // Three complete rotations and the winning interval on the fourth.
            // UI renders four copies of the weighted rail to avoid cursor teleporting.
            return (3 + target) * eased;
        } catch { return 0; }
    }
    function ease(progress) {
        const position = Math.min(1, Math.max(0, progress));
        if (position === 0 || position === 1) return position;
        const curve = (t, a, b) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
        // Invert the x axis of cubic-bezier(.16, .58, .12, 1) before reading its y axis.
        let low = 0, high = 1;
        for (let i = 0; i < 16; i++) {
            const mid = (low + high) / 2;
            if (curve(mid, .16, .12) < position) low = mid;
            else high = mid;
        }
        return curve((low + high) / 2, .58, 1);
    }
    return { totals, standings, modeScores, rankings, uniqueGroupLeader, interpolate, indices, center, exclusiveRound, payoutTargets, payoutsAt, uniqueLeader,
        tallyPlan, playbackPlan, playbackAt, tallyAt, jackpotPosition, ease };
});
