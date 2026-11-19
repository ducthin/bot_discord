const presentation = require('../web/play/battle-presentation');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');

test('visible totals include only revealed rounds and preserve exact large minor units', () => {
    const players = [{ userId: '1' }, { userId: '2' }];
    const rounds = [
        { entries: [{ userId: '1', value: '9007199254740993123' }, { userId: '2', value: '100' }] },
        { entries: [{ userId: '1', value: '77' }, { userId: '2', value: '9007199254740993201' }] }
    ];
    expect(presentation.totals(players, rounds, 0)).toEqual({ '1': 0n, '2': 0n });
    expect(presentation.totals(players, rounds, 1)).toEqual({ '1': 9007199254740993123n, '2': 100n });
    expect(presentation.totals(players, rounds, 2)).toEqual({ '1': 9007199254740993200n, '2': 9007199254740993301n });
});

test('regular and Crazy reverse winner colors, including multi-way ties and Sharing', () => {
    const values = { a: '9007199254740993123', b: '9007199254740993124', c: '9007199254740993125' };
    expect(presentation.standings(values, 'regular')).toEqual({ a: 'trailing', b: 'trailing', c: 'leading' });
    expect(presentation.standings(values, 'crazy')).toEqual({ a: 'leading', b: 'trailing', c: 'trailing' });
    expect(presentation.standings({ a: '20', b: '10', c: '10' }, 'regular')).toEqual({ a: 'leading', b: 'trailing', c: 'trailing' });
    expect(presentation.standings({ a: '20', b: '10', c: '10' }, 'crazy')).toEqual({ a: 'trailing', b: 'tied', c: 'tied' });
    expect(presentation.standings({ a: '10', b: '20', c: '20' }, 'crazy')).toEqual({ a: 'leading', b: 'trailing', c: 'trailing' });
    expect(presentation.standings({ a: '10', b: '10' }, 'regular')).toEqual({ a: 'tied', b: 'tied' });
    expect(presentation.standings({ a: '20', b: '20', c: '10' }, 'regular')).toEqual({ a: 'tied', b: 'tied', c: 'trailing' });
    expect(presentation.standings({ a: '10', b: '10' }, 'crazy', true)).toEqual({ a: 'leading', b: 'leading' });
    expect(presentation.standings(values, 'sharing')).toEqual({ a: 'sharing', b: 'sharing', c: 'sharing' });
});

function modeFixture(mode = 'regular', format = 'solo') {
    const players = ['a', 'b', 'c', 'd'].map((userId, index) => ({ userId, seat: index + 1 }));
    return { mode, format, players, seats: Object.fromEntries(players.map(player => [player.userId, player.seat])),
        rounds: [[100, 100, 10, 10], [1, 1, 30, 30], [10, 10, 20, 20]].map(values => ({
            entries: values.map((value, index) => ({ userId: players[index].userId, value: String(value) }))
        })) };
}

test('team standings color every teammate by the shared team score rather than personal totals', () => {
    const room = modeFixture('regular', '2v2');
    expect(presentation.rankings(room, 1)).toEqual({ a: 'leading', b: 'leading', c: 'trailing', d: 'trailing' });
    const scores = presentation.modeScores(room, 1);
    expect(scores.groups.map(group => group.score)).toEqual([200n, 20n]);
    expect(presentation.uniqueGroupLeader(room, 1)).toBe(scores.groups.find(group => group.userIds.includes('a')).id);
    expect(presentation.rankings({ ...room, mode: 'crazy' }, 1)).toEqual({ a: 'trailing', b: 'trailing', c: 'leading', d: 'leading' });
    expect(presentation.rankings({ ...room, mode: 'sharing' }, 1)).toEqual({ a: 'sharing', b: 'sharing', c: 'sharing', d: 'sharing' });
    expect(presentation.uniqueGroupLeader({ ...room, mode: 'sharing' }, 1)).toBeNull();
});

test('Terminal waits for the final round and Clutch follows a single-round score', () => {
    const terminal = modeFixture('terminal', '2v2');
    expect(presentation.rankings(terminal, 2)).toEqual({ a: 'tied', b: 'tied', c: 'tied', d: 'tied' });
    expect(presentation.uniqueGroupLeader(terminal, 2)).toBeNull();
    expect(presentation.rankings(terminal, 3)).toEqual({ a: 'trailing', b: 'trailing', c: 'leading', d: 'leading' });
    expect(presentation.rankings({ ...terminal, mode: 'terminal_crazy' }, 3)).toEqual({ a: 'leading', b: 'leading', c: 'trailing', d: 'trailing' });
    const clutch = { mode: 'clutch', players: [{ userId: 'a' }, { userId: 'b' }], rounds: [
        { entries: [{ userId: 'a', value: '100' }, { userId: 'b', value: '60' }] },
        { entries: [{ userId: 'a', value: '1' }, { userId: 'b', value: '60' }] }
    ] };
    expect(presentation.rankings(clutch, 2)).toEqual({ a: 'leading', b: 'trailing' });
    expect(presentation.rankings({ ...clutch, mode: 'regular' }, 2)).toEqual({ a: 'trailing', b: 'leading' });
    expect(presentation.rankings({ ...clutch, mode: 'clutch_crazy' }, 2)).toEqual({ a: 'leading', b: 'trailing' });
});

test('Jackpot presentation never treats chance weight as a decided winner before final reveal', () => {
    const room = { ...modeFixture('jackpot', '2v2'), winners: ['c', 'd'] };
    for (const mode of ['jackpot', 'jackpot_crazy']) {
        const value = { ...room, mode };
        expect(presentation.rankings(value, 3)).toEqual({ a: 'tied', b: 'tied', c: 'tied', d: 'tied' });
        expect(presentation.uniqueGroupLeader(value, 3)).toBeNull();
        expect(presentation.rankings(value, 3, true)).toEqual({ a: 'trailing', b: 'trailing', c: 'leading', d: 'leading' });
        expect(presentation.standings({ a: 99n, b: 1n }, mode, true)).toEqual({ a: 'tied', b: 'tied' });
    }
});

test('legacy rooms without a format keep independent personal rankings', () => {
    const room = modeFixture();
    delete room.format;
    const scores = presentation.modeScores(room, 3);
    expect(scores.groups).toHaveLength(4);
    expect(scores.groups.map(group => group.userIds)).toEqual([['a'], ['b'], ['c'], ['d']]);
    expect(presentation.rankings(room, 3)).toEqual(presentation.standings(presentation.totals(room.players, room.rounds), 'regular'));
});

test('the deferred browser scripts use the same rules without CommonJS', () => {
    const context = { window: {} };
    for (const modulePath of ['../utils/playerBattleModes', '../web/play/battle-presentation']) {
        runInNewContext(readFileSync(require.resolve(modulePath), 'utf8'), context);
    }
    const room = modeFixture('terminal_crazy', '2v2');
    expect(context.window.MaySkinsBattlePresentation.rankings(room, 3)).toEqual(presentation.rankings(room, 3));
});

test('counter interpolation is monotonic and ends exactly without floating point money', () => {
    const end = '9007199254740993123456';
    const frames = Array.from({ length: 1001 }, (_, units) => presentation.interpolate('37', end, units));
    expect(frames[0]).toBe(37n);
    expect(frames.at(-1)).toBe(BigInt(end));
    expect(frames.every((value, index) => index === 0 || value >= frames[index - 1])).toBe(true);
    expect(presentation.interpolate('100', '1', 1000)).toBe(1n);
    expect(presentation.interpolate('0', '10', -100)).toBe(0n);
    expect(presentation.interpolate('0', '10', 1200)).toBe(10n);
});

test('replay filler stays deterministic and the winning item lands at the exact center', () => {
    expect(presentation.indices(12, 34, 'room:1:player')).toEqual(presentation.indices(12, 34, 'room:1:player'));
    expect(presentation.indices(12, 34, 'room:2:player')).not.toEqual(presentation.indices(12, 34, 'room:1:player'));
    expect(presentation.indices(12, 34, 'room:1:player').every(index => index >= 0 && index < 12)).toBe(true);
    for (const [windowHeight, cardHeight] of [[300, 220], [250, 190]]) {
        const winnerIndex = 10, startIndex = winnerIndex + 5;
        const start = presentation.center(windowHeight, cardHeight, 0, startIndex);
        const finish = presentation.center(windowHeight, cardHeight, 0, winnerIndex);
        expect(finish).toBeGreaterThan(start);
        expect(finish + winnerIndex * cardHeight + cardHeight / 2).toBe(windowHeight / 2);
    }
});

function exclusiveFixture() {
    const common = { id: 'common', skinId: 'pistol', name: 'Pistol', tier: 0, value: '100' };
    const goldA = { id: 'gold-a', skinId: 'knife', name: 'Knife', tier: 4, wear: 'Factory New', statTrak: false, value: '10000', exclusiveEligible: true };
    const goldB = { id: 'gold-b', skinId: 'glove', name: 'Glove', tier: 4, wear: 'Minimal Wear', statTrak: false, value: '20000', exclusiveEligible: true };
    return { exclusiveDrop: true, fee: '500', pool: '30100', players: [{ userId: 'a' }, { userId: 'b' }, { userId: 'c' }],
        cases: [{ id: 'case-a', reelEntries: [common, goldA, goldB], exclusive: {
            available: true, chance: 2, trigger: { id: 'trigger-case-a', name: 'Exclusive Drop', isExclusiveTrigger: true },
            items: [goldA, goldB]
        } }], rounds: [{ caseId: 'case-a', entries: [
            { userId: 'a', item: { ...goldA, id: 'outcome-a' }, value: '10000', exclusive: { triggered: true, chance: 2 } },
            { userId: 'b', item: { ...common, id: 'outcome-b' }, value: '100' },
            { userId: 'c', item: { ...goldB, id: 'outcome-c' }, value: '20000', exclusive: { triggered: true, chance: 2 } }
        ] }] };
}

test('Exclusive round plan covers simultaneous hits and keeps the actual skins out of the first reel', () => {
    const room = exclusiveFixture(), before = structuredClone(room);
    const plan = presentation.exclusiveRound(room, 0);
    expect(plan).toMatchObject({ enabled: true, hasExclusive: true, hitUserIds: ['a', 'c'],
        trigger: { id: 'trigger-case-a', name: 'Exclusive Drop', isExclusiveTrigger: true, tier: 4, chance: 2 } });
    expect(plan.normalPool.map(item => item.id)).toEqual(['common', 'trigger-case-a']);
    expect(plan.exclusivePool.map(item => item.id)).toEqual(['gold-a', 'gold-b']);
    expect(plan.entriesByUser.a).toBe(room.rounds[0].entries[0]);
    expect(plan.entriesByUser.b.item.id).toBe('outcome-b');
    expect(room).toEqual(before);
    // Merely preparing the second spin must not reveal this round in totals or change the payout data.
    expect(presentation.totals(room.players, room.rounds, 0)).toEqual({ a: 0n, b: 0n, c: 0n });
    expect(presentation.totals(room.players, room.rounds, 1)).toEqual({ a: 10000n, b: 100n, c: 20000n });
    expect(room.fee).toBe('500');
    expect(room.pool).toBe('30100');
});

test('disabled Exclusive ignores stale trigger flags and restores every ordinary reel outcome', () => {
    const room = { ...exclusiveFixture(), exclusiveDrop: false };
    const plan = presentation.exclusiveRound(room, 0);
    expect(plan).toMatchObject({ enabled: false, hasExclusive: false, hitUserIds: [], exclusivePool: [] });
    expect(plan.normalPool.map(item => item.id)).toEqual(['common', 'gold-a', 'gold-b']);
    expect(plan.normalPool.some(item => item.isExclusiveTrigger)).toBe(false);
});

test('legacy Exclusive results get branded trigger and safe pools without leaking future hit skins', () => {
    const room = exclusiveFixture();
    delete room.cases;
    room.rounds.push({ caseId: 'case-b', entries: [
        { userId: 'a', item: { id: 'future-secret', skinId: 'secret', name: 'Future Secret' }, exclusive: { triggered: true } },
        { userId: 'b', item: { id: 'future-common', skinId: 'rifle', name: 'Rifle' } }
    ] });
    const plan = presentation.exclusiveRound(room, 0);
    expect(plan.trigger).toMatchObject({ id: 'exclusive-drop', name: 'Exclusive Drop', isExclusiveTrigger: true, tier: 4, chance: 2 });
    expect(plan.normalPool.map(item => item.id)).toEqual(['outcome-b', 'future-common', 'exclusive-drop']);
    expect(plan.exclusivePool.map(item => item.id)).toEqual(['outcome-a', 'outcome-c']);
    expect(plan.normalPool.some(item => ['outcome-a', 'outcome-c', 'future-secret'].includes(item.id))).toBe(false);
});

test('Exclusive filler rejects mismarked result variants and duplicate trigger placeholders', () => {
    const room = exclusiveFixture();
    delete room.cases[0].reelEntries[1].exclusiveEligible;
    room.cases[0].reelEntries.push({ id: 'stale-trigger', isExclusiveTrigger: true });
    room.cases[0].exclusive.items.push({ id: 'stale-trigger', isExclusiveTrigger: true });
    const plan = presentation.exclusiveRound(room, 0);
    expect(plan.normalPool.map(item => item.id)).toEqual(['common', 'trigger-case-a']);
    expect(plan.normalPool.filter(item => item.isExclusiveTrigger)).toHaveLength(1);
    expect(plan.exclusivePool.map(item => item.id)).toEqual(['gold-a', 'gold-b']);
});

test('non-triggering and missing legacy rounds remain safe and deterministic', () => {
    const room = exclusiveFixture();
    room.rounds[0].entries.forEach(entry => { delete entry.exclusive; });
    const plan = presentation.exclusiveRound(room, 0);
    expect(plan.hasExclusive).toBe(false);
    expect(plan.hitUserIds).toEqual([]);
    expect(plan.normalPool.map(item => item.id)).toEqual(['common', 'trigger-case-a']);
    expect(presentation.exclusiveRound(room, 0)).toEqual(plan);
    expect(presentation.exclusiveRound({}, 0)).toMatchObject({ enabled: false, hasExclusive: false,
        hitUserIds: [], normalPool: [], exclusivePool: [], entriesByUser: {} });
    expect(presentation.exclusiveRound(null, 0)).toMatchObject({ enabled: false, hasExclusive: false, normalPool: [] });
});

test('final tally adds every skin once in round and seat order with exact large cumulative values', () => {
    const room = { players: [{ userId: 'a', seat: 2 }, { userId: 'b', seat: 1 }], winners: ['a'],
        payoutType: 'skins', pool: '9007199254740993300', rounds: [
            { entries: [{ userId: 'a', value: '9007199254740993123' }, { userId: 'b', value: '100' }] },
            { entries: [{ userId: 'a', value: '70' }, { userId: 'b', value: '7' }] }
        ] };
    const plan = presentation.tallyPlan(room);
    expect(plan.steps.map(step => [step.roundIndex, step.userId])).toEqual([[0, 'b'], [0, 'a'], [1, 'b'], [1, 'a']]);
    expect(plan.steps.map(step => step.pool)).toEqual([100n, 9007199254740993223n, 9007199254740993230n, 9007199254740993300n]);
    expect(plan.steps.map(step => step.totals)).toEqual([
        { a: 0n, b: 100n }, { a: 9007199254740993123n, b: 100n },
        { a: 9007199254740993123n, b: 107n }, { a: 9007199254740993193n, b: 107n }
    ]);
    expect(plan.steps.every((step, index) => step.from === (index ? plan.steps[index - 1].pool : 0n))).toBe(true);
    expect(plan.steps.at(-1).payouts).toEqual({ a: 9007199254740993300n, b: 0n });
    expect(plan.payouts).toEqual(plan.steps.at(-1).payouts);
    expect(plan.interval).toBe(750);
    expect(plan.steps.map(step => [step.at, step.endAt])).toEqual([[0, 750], [750, 1500], [1500, 2250], [2250, 3000]]);
    expect(plan.duration - plan.steps.at(-1).endAt).toBe(850);
    expect(room.rounds[0].entries[0].userId).toBe('a');
});

test('tally standings use partial personal totals and only unique leaders trigger lead changes', () => {
    const room = { players: [{ userId: 'a', seat: 1 }, { userId: 'b', seat: 2 }],
        rounds: [{ entries: [{ userId: 'a', value: '10' }, { userId: 'b', value: '30' }] },
            { entries: [{ userId: 'a', value: '40' }, { userId: 'b', value: '20' }] }] };
    const steps = presentation.tallyPlan(room).steps;
    expect(steps.map(step => presentation.uniqueLeader(step.totals, 'regular'))).toEqual(['a', 'b', 'a', null]);
    expect(steps.map(step => presentation.uniqueLeader(step.totals, 'crazy'))).toEqual(['b', 'a', 'b', null]);
    expect(steps.map(step => presentation.uniqueLeader(step.totals, 'sharing'))).toEqual([null, null, null, null]);
    expect(steps[0].totals).toEqual({ a: 10n, b: 0n });
    expect(steps.at(-1).totals).toEqual({ a: 50n, b: 50n });
});

test.each(['regular', 'crazy', 'sharing'])('tally uses committed payouts for %s including ties and rounding remainders', mode => {
    const room = { mode, players: [{ userId: 'a' }, { userId: 'b' }, { userId: 'bot', isBot: true }],
        winners: ['a', 'b', 'bot'], payoutType: 'coins', pool: '11', payouts: { a: '4', b: '3' }, botPayouts: { bot: '4' } };
    expect(presentation.payoutsAt(room, 0)).toEqual({ a: 0n, b: 0n, bot: 0n });
    expect(presentation.payoutsAt(room, 5)).toEqual({ a: 1n, b: 1n, bot: 1n });
    expect(presentation.payoutsAt(room, 11)).toEqual({ a: 4n, b: 3n, bot: 4n });
    expect(presentation.payoutsAt(room, 1000)).toEqual({ a: 4n, b: 3n, bot: 4n });
    expect(presentation.payoutsAt(room, -5)).toEqual({ a: 0n, b: 0n, bot: 0n });
});

test('long battles tally every item with a bounded presentation duration and no unknown users', () => {
    const room = { players: Array.from({ length: 4 }, (_, index) => ({ userId: String(index), seat: index + 1 })),
        winners: ['0'], payoutType: 'skins', pool: '80', rounds: Array.from({ length: 20 }, () => ({
            entries: [...Array.from({ length: 4 }, (_, index) => ({ userId: String(index), value: '1' })), { userId: 'foreign', value: '9999' }]
        })) };
    const plan = presentation.tallyPlan(room);
    expect(plan.steps).toHaveLength(80);
    expect(plan.pool).toBe(80n);
    expect(plan.duration).toBeLessThanOrEqual(11000);
    expect(plan.steps.every((step, index) => step.at === (index ? plan.steps[index - 1].endAt : 0))).toBe(true);
    expect(plan.steps.at(-1).payouts).toEqual({ 0: 80n, 1: 0n, 2: 0n, 3: 0n });
    expect(presentation.tallyPlan({ players: [], rounds: [] }).steps).toEqual([]);
    expect(presentation.payoutsAt({ players: [{ userId: '0' }], pool: '0', winners: ['0'], payoutType: 'skins' }, 0)).toEqual({ 0: 0n });
});

test('a 100-round four-seat battle retains all 400 rewards through the final tally', () => {
    const players = Array.from({ length: 4 }, (_, index) => ({ userId: String(index), seat: index + 1 }));
    const rounds = Array.from({ length: 100 }, (_, roundIndex) => ({
        entries: players.map((player, seatIndex) => ({ userId: player.userId, value: String(roundIndex * 4 + seatIndex + 1) }))
    }));
    const room = { players, rounds, winners: ['3'], payoutType: 'skins', pool: '80200' };
    const plan = presentation.tallyPlan(room);
    expect(plan.steps).toHaveLength(400);
    expect(plan.steps.at(-1)).toMatchObject({ index: 399, roundIndex: 99, userId: '3', value: 400n, pool: 80200n,
        totals: { 0: 19900n, 1: 20000n, 2: 20100n, 3: 20200n }, payouts: { 0: 0n, 1: 0n, 2: 0n, 3: 80200n } });
    expect(presentation.totals(players, rounds, 100)).toEqual(plan.steps.at(-1).totals);
    expect(plan.steps.every((step, index) => step.index === index && step.roundIndex === Math.floor(index / 4))).toBe(true);
    expect(plan.pool).toBe(80200n);
    expect(plan.duration).toBe(48850);
});

test('a hundred-round six-seat team battle tallies all six hundred rewards on the shared clock', () => {
    const players = Array.from({ length: 6 }, (_, index) => ({ userId: String(index), seat: index + 1 }));
    const room = { mode: 'regular', format: '3v3', players, winners: players.map(player => player.userId),
        payoutType: 'coins', pool: '30300', payouts: Object.fromEntries(players.map(player => [player.userId, '5050'])),
        rounds: Array.from({ length: 100 }, (_, index) => ({ entries: players.map(player => ({
            userId: player.userId, value: String(index + 1), item: { name: 'Skin ' + index }
        })) })) };
    const plan = presentation.playbackPlan(room);
    expect(plan.tally.steps).toHaveLength(600);
    expect(plan.tally.steps.at(-1)).toMatchObject({ index: 599, roundIndex: 99, userId: '5', pool: 30300n });
    expect(plan.tally.steps.at(-1).payouts).toEqual(Object.fromEntries(players.map(player => [player.userId, 5050n])));
    expect(presentation.modeScores(room, 100).groups.map(group => group.score)).toEqual([15150n, 15150n]);
    expect(presentation.playbackAt(plan, plan.duration - 1)).toMatchObject({ stage: 'tally', tallyCount: 600, holding: true });
    expect(presentation.tallyAt(plan, presentation.playbackAt(plan, plan.duration))).toEqual({ pool: 30300n,
        totals: Object.fromEntries(players.map(player => [player.userId, 5050n])) });
    expect(presentation.playbackAt(plan, plan.duration)).toMatchObject({ stage: 'finished', completed: 100, tallyCount: 600 });
});

function timelineFixture(roundCount = 1, hitUserIds = []) {
    const players = [{ userId: 'a', seat: 1 }, { userId: 'b', seat: 2 }];
    return { id: 'shared-room', exclusiveDrop: true, players, winners: ['a'], payoutType: 'skins', pool: '300',
        rounds: Array.from({ length: roundCount }, (_, roundIndex) => ({ caseId: 'case', entries: players.map((player, seat) => ({
            userId: player.userId, value: String((roundIndex + 1) * (seat + 1)), item: { id: `${roundIndex}-${seat}`, name: `skin ${roundIndex}-${seat}` },
            ...(hitUserIds.includes(player.userId) ? { exclusive: { triggered: true } } : {})
        })) })) };
}

test('shared playback timeline keeps all clients on the same current stage after tab suspension', () => {
    const plan = presentation.playbackPlan(timelineFixture(3));
    const initial = presentation.playbackAt(plan, 2000);
    const suspended = presentation.playbackAt(plan, 2000);
    expect(suspended).toEqual(initial);
    expect(presentation.playbackAt(plan, 12000)).toMatchObject({ phase: 'rounds', stage: 'spinning', roundIndex: 2,
        completed: 2, duration: 4200 });
    expect(presentation.playbackAt(plan, plan.duration)).toMatchObject({ phase: 'finished', stage: 'finished', completed: 3 });
    expect(presentation.playbackAt(plan, -250)).toMatchObject({ phase: 'rounds', stage: 'waiting', roundIndex: 0,
        completed: 0, progress: 0, elapsedInStage: -250 });
});

test('shared timeline adds synchronized trigger and second-spin stages only for actual Exclusive hits', () => {
    const noHit = presentation.playbackPlan(timelineFixture(1));
    const oneHitRoom = timelineFixture(1, ['a']);
    const oneHit = presentation.playbackPlan(oneHitRoom);
    const multiHit = presentation.playbackPlan(timelineFixture(1, ['a', 'b']));
    expect(noHit.segments.map(segment => segment.kind)).not.toContain('exclusive-trigger');
    expect(oneHit.segments.map(segment => segment.kind)).toEqual(['spinning', 'exclusive-trigger', 'exclusive-spinning', 'revealed',
        'tally', 'tally', 'tally', 'tally']);
    expect(multiHit.segments.filter(segment => segment.kind === 'exclusive-trigger')).toHaveLength(1);
    expect(multiHit.segments.filter(segment => segment.kind === 'exclusive-spinning')).toHaveLength(1);
    expect(presentation.playbackAt(oneHit, 4200)).toMatchObject({ phase: 'rounds', stage: 'exclusive-trigger', progress: 0, completed: 0 });
    expect(presentation.playbackAt(oneHit, 5100)).toMatchObject({ stage: 'exclusive-spinning', progress: 0, completed: 0 });
    expect(presentation.playbackAt(oneHit, 8700)).toMatchObject({ stage: 'revealed', completed: 1 });
    expect(presentation.playbackAt(oneHit, 8800)).toMatchObject({ phase: 'rounds', stage: 'revealed', completed: 1 });
    expect(presentation.playbackAt(oneHit, 11000).phase).toBe('tally');
    expect(presentation.playbackPlan({ ...timelineFixture(1), exclusiveDrop: false,
        rounds: timelineFixture(1, ['a']).rounds }).segments.map(segment => segment.kind)).not.toContain('exclusive-trigger');
});

test('shared reel easing follows the configured curve and stays bounded and monotonic', () => {
    const values = Array.from({ length: 101 }, (_, index) => presentation.ease(index / 100));
    expect(values[0]).toBe(0);
    expect(values.at(-1)).toBe(1);
    expect(values.every((value, index) => value >= 0 && value <= 1 && (index === 0 || value >= values[index - 1]))).toBe(true);
    expect(presentation.ease(.5)).toBeCloseTo(.9273, 3);
    expect(presentation.ease(-1)).toBe(0);
    expect(presentation.ease(2)).toBe(1);
});

test('100-round Exclusive battle timeline reaches all 400 tally entries without dropping rounds', () => {
    const players = Array.from({ length: 4 }, (_, seat) => ({ userId: String.fromCharCode(97 + seat), seat: seat + 1 }));
    const room = { ...timelineFixture(100, players.map(player => player.userId)), players,
        rounds: Array.from({ length: 100 }, (_, roundIndex) => ({ caseId: 'case', entries: players.map((player, seat) => ({
            userId: player.userId, value: String(roundIndex + seat + 1), item: { id: `${roundIndex}-${seat}`, name: 'skin' },
            exclusive: { triggered: true }
        })) })) };
    const plan = presentation.playbackPlan(room);
    expect(plan.rounds).toHaveLength(100);
    expect(plan.tally.steps).toHaveLength(400);
    expect(plan.segments.filter(segment => segment.kind === 'exclusive-trigger')).toHaveLength(100);
    expect(presentation.playbackAt(plan, plan.duration - 1)).toMatchObject({ phase: 'tally', stage: 'tally', tallyCount: 400 });
    expect(presentation.playbackAt(plan, plan.duration)).toMatchObject({ phase: 'finished', stage: 'finished', completed: 100,
        tallyCount: 400 });
});

test('shared tally values seek directly to the same count position for late viewers and resumed tabs', () => {
    const room = timelineFixture(1);
    room.rounds[0].entries[0].value = '100000';
    room.rounds[0].entries[1].value = '200000';
    room.pool = '300000';
    const plan = presentation.playbackPlan(room);
    const first = plan.segments.find(segment => segment.kind === 'tally' && segment.tallyCount === 1);
    const at = first.start + first.duration * .41;
    const playback = presentation.playbackAt(plan, at);
    const host = presentation.tallyAt(plan, playback);
    const lateViewer = presentation.tallyAt(plan, presentation.playbackAt(plan, at));
    expect(lateViewer).toEqual(host);
    expect(host).toEqual({ pool: 87500n, totals: { a: 87500n, b: 0n } });
    const second = plan.segments.find(segment => segment.kind === 'tally' && segment.tallyCount === 2);
    expect(presentation.tallyAt(plan, presentation.playbackAt(plan, second.start))).toEqual({
        pool: 100000n, totals: { a: 100000n, b: 0n } });
    expect(presentation.tallyAt(plan, presentation.playbackAt(plan, second.start + second.duration * .82))).toEqual({
        pool: 300000n, totals: { a: 100000n, b: 200000n } });
});

test('the final shared tally hold never restarts or reverses the last addition', () => {
    const room = timelineFixture(1);
    const plan = presentation.playbackPlan(room);
    const hold = plan.segments.at(-1);
    expect(hold.holding).toBe(true);
    const end = plan.tally.steps.at(-1);
    const expected = { pool: end.pool, totals: end.totals };
    expect(presentation.tallyAt(plan, presentation.playbackAt(plan, hold.start - 1))).toEqual(expected);
    expect(presentation.tallyAt(plan, presentation.playbackAt(plan, hold.start))).toEqual(expected);
    expect(presentation.tallyAt(plan, presentation.playbackAt(plan, hold.start + hold.duration / 2))).toEqual(expected);
    expect(presentation.tallyAt(plan, presentation.playbackAt(plan, plan.duration))).toEqual(expected);
    expect(presentation.tallyAt(plan, presentation.playbackAt(plan, -1))).toEqual({ pool: 0n, totals: { a: 0n, b: 0n } });
});

test('Jackpot adds a synchronized draw stage after the final tally and lands in the committed ticket interval', () => {
    const room = { ...timelineFixture(1), mode: 'jackpot', decision: {
        base: 'jackpot', ticket: '25', totalWeight: '100', winningGroups: ['a'],
        groups: [{ id: 'a', score: '75', weight: '75' }, { id: 'b', score: '25', weight: '25' }]
    } };
    const plan = presentation.playbackPlan(room);
    expect(plan.segments.at(-2)).toMatchObject({ kind: 'tally', holding: true, tallyCount: 2 });
    expect(plan.segments.at(-1)).toMatchObject({ kind: 'jackpot-draw', duration: 2800, holding: true, tallyCount: 2 });
    const draw = plan.segments.at(-1), mid = presentation.playbackAt(plan, draw.start + 1400);
    expect(mid).toMatchObject({ phase: 'tally', stage: 'jackpot-draw', completed: 1, tallyCount: 2, holding: true });
    expect(presentation.playbackAt(plan, draw.end)).toMatchObject({ stage: 'finished', completed: 1 });
    const start = presentation.jackpotPosition(room.decision, 0);
    const landed = presentation.jackpotPosition(room.decision, 1);
    expect(start).toBe(0);
    expect(landed).toBeCloseTo(3.255, 6);
    expect(landed).toBeGreaterThan(3.25);
    expect(landed).toBeLessThan(3.26);
});

test('invalid or absent Jackpot decisions never add a draw segment and keep ordinary totals unchanged', () => {
    const base = timelineFixture(1);
    const invalid = { ...base, mode: 'jackpot', decision: { base: 'jackpot', ticket: '0', totalWeight: '0', winningGroups: [] } };
    expect(presentation.playbackPlan(invalid).segments.some(segment => segment.kind === 'jackpot-draw')).toBe(false);
    expect(presentation.jackpotPosition(invalid.decision, .5)).toBe(0);
    const wrongWinner = { ...invalid, decision: { base: 'jackpot', ticket: '99', totalWeight: '100', winningGroups: ['a'],
        groups: [{ id: 'a', score: '75', weight: '75' }, { id: 'b', score: '25', weight: '25' }] } };
    expect(presentation.playbackPlan(wrongWinner).segments.some(segment => segment.kind === 'jackpot-draw')).toBe(false);
    expect(presentation.playbackPlan({ ...base, mode: 'regular' }).duration).toBe(presentation.playbackPlan(base).duration);
});
