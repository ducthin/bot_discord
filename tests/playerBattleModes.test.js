const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const rules = require('../utils/playerBattleModes');

const room = (matrix, extra = {}) => ({ mode: 'regular', format: 'solo', capacity: matrix[0]?.length ?? 2,
    players: Array.from({ length: matrix[0]?.length ?? 2 }, (_, index) => ({ userId: String(index + 1), seat: index + 1 })),
    rounds: matrix.map(values => ({ entries: values.map((value, index) => ({ userId: String(index + 1), value: String(value) })) })), ...extra });

test('all nine mode choices and four formats expose browser-safe metadata and validate their capacities', () => {
    expect(Object.keys(rules.MODES)).toEqual(['regular', 'crazy', 'sharing', 'terminal', 'terminal_crazy', 'clutch', 'clutch_crazy', 'jackpot', 'jackpot_crazy']);
    for (const [mode, metadata] of Object.entries(rules.MODES)) {
        expect(metadata).toMatchObject({ name: expect.any(String), description: expect.any(String), icon: expect.any(String), base: expect.any(String), inverse: expect.any(Boolean) });
        for (const [format, layout] of Object.entries(rules.FORMATS)) for (const capacity of layout.capacities) {
            expect(rules.validConfiguration({ mode, format, capacity })).toBe(true);
        }
    }
    expect(rules.validConfiguration({ capacity: 5 })).toBe(true);
    for (const options of [{ capacity: 1 }, { capacity: 7 }, { capacity: 4.5 }, { capacity: 4, format: '3v3' },
        { capacity: 6, format: '2v2' }, { capacity: 4, mode: 'unknown' }, { capacity: 4, format: 'toString' }, { capacity: 4, mode: 'toString' }]) {
        expect(rules.validConfiguration(options)).toBe(false);
    }
    const browser = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../utils/playerBattleModes.js'), 'utf8'), browser);
    expect(Object.keys(browser.window.MaySkinsBattleModes.MODES)).toEqual(Object.keys(rules.MODES));
    expect(browser.window.MaySkinsBattleModes.validConfiguration({ mode: 'terminal', format: '3v3', capacity: 6 })).toBe(true);
});

test('team membership is determined by exact format seats rather than cached player team labels', () => {
    expect(Array.from({ length: 4 }, (_, index) => rules.teamForSeat('2v2', index + 1))).toEqual(['A', 'A', 'B', 'B']);
    expect(Array.from({ length: 6 }, (_, index) => rules.teamForSeat('3v3', index + 1))).toEqual(['A', 'A', 'A', 'B', 'B', 'B']);
    expect(Array.from({ length: 6 }, (_, index) => rules.teamForSeat('2v2v2', index + 1))).toEqual(['A', 'A', 'B', 'B', 'C', 'C']);
    expect(rules.teamForSeat('solo', 1)).toBeNull();
    expect(rules.teamForSeat('2v2', 5)).toBeNull();
    expect(rules.teamForSeat('3v3', 0)).toBeNull();
    expect(rules.teamForSeat('3v3', 1.5)).toBeNull();
    expect(rules.teamForSeat('toString', 1)).toBeNull();
    const battle = room([[1, 2, 3, 4]], { format: '2v2', seats: { 1: 3, 2: 4, 3: 1, 4: 2 } });
    battle.players.forEach(player => { player.team = 'A'; });
    const scored = rules.scoreBattle(battle);
    expect(scored.groups).toEqual([
        { id: 'team:A', label: 'Đội A', userIds: ['3', '4'], score: 7n },
        { id: 'team:B', label: 'Đội B', userIds: ['1', '2'], score: 3n }
    ]);
    expect(rules.resolveBattle(battle).winners).toEqual(['3', '4']);
});

test('legacy seat-less rooms use player seats or array order and can score all six players', () => {
    const battle = room([[1, 2, 3, 4, 5, 6]], { format: '2v2v2' });
    expect(rules.scoreBattle(battle).groupScores).toEqual({ 'team:A': 3n, 'team:B': 7n, 'team:C': 11n });
    battle.players.forEach(player => { delete player.seat; });
    expect(rules.scoreBattle(battle).groupScores).toEqual({ 'team:A': 3n, 'team:B': 7n, 'team:C': 11n });
    expect(rules.resolveBattle(battle).winners).toEqual(['5', '6']);
});

test('regular, Crazy and Sharing retain exact total, reversed and split winner behavior', () => {
    const battle = room([[15, 3, 7], [4, 5, 1]]);
    expect(rules.scoreBattle(battle).playerScores).toEqual({ 1: 19n, 2: 8n, 3: 8n });
    expect(rules.resolveBattle(battle).winners).toEqual(['1']);
    expect(rules.resolveBattle({ ...battle, mode: 'crazy' }).winners).toEqual(['2', '3']);
    expect(rules.resolveBattle({ ...battle, mode: 'sharing' }).winners).toEqual(['1', '2', '3']);
    expect(rules.resolveBattle(room([[1, 1, 1, 1]], { format: '2v2' })).winners).toEqual(['1', '2', '3', '4']);
});

test('Terminal counts only the last round and reveals no competing score before that round completes', () => {
    const battle = room([[1000, 1], [4, 7]], { mode: 'terminal' });
    expect(rules.scoreBattle(battle, 1).playerScores).toEqual({ 1: 0n, 2: 0n });
    expect(rules.scoreBattle(battle).playerScores).toEqual({ 1: 4n, 2: 7n });
    expect(rules.resolveBattle(battle).winners).toEqual(['2']);
    expect(rules.resolveBattle({ ...battle, mode: 'terminal_crazy' }).winners).toEqual(['1']);
    expect(rules.scoreBattle(battle, 0).playerScores).toEqual({ 1: 0n, 2: 0n });
    expect(rules.scoreBattle(battle, Infinity).playerScores).toEqual({ 1: 4n, 2: 7n });
});

test('Clutch compares best round totals and Clutch Crazy compares lowest round totals', () => {
    const battle = room([[80, 50], [1, 50], [1, 50]], { mode: 'clutch' });
    expect(rules.resolveBattle(battle).winners).toEqual(['1']);
    expect(rules.resolveBattle({ ...battle, mode: 'regular' }).winners).toEqual(['2']);
    expect(rules.scoreBattle(battle).playerScores).toEqual({ 1: 80n, 2: 50n });
    expect(rules.scoreBattle({ ...battle, mode: 'clutch_crazy' }).playerScores).toEqual({ 1: 1n, 2: 50n });
    expect(rules.resolveBattle({ ...battle, mode: 'clutch_crazy' }).winners).toEqual(['1']);
    expect(rules.scoreBattle({ ...battle, mode: 'clutch_crazy' }, 0).playerScores).toEqual({ 1: 0n, 2: 0n });
    const teams = room([[100, 0, 60, 60], [0, 100, 0, 0]], { mode: 'clutch', format: '2v2' });
    expect(rules.scoreBattle(teams).groupScores).toEqual({ 'team:A': 100n, 'team:B': 120n });
    expect(rules.resolveBattle(teams).winners).toEqual(['3', '4']);
    expect(rules.resolveBattle({ ...teams, mode: 'clutch_crazy' }).winners).toEqual(['3', '4']);
});

test('unknown entries do not alter group scores and incomplete input retains zero-score groups', () => {
    const battle = room([[10, 20]], { mode: 'terminal' });
    battle.rounds[0].entries.push({ userId: 'intruder', value: '999999999999999999999999999999999999' });
    expect(rules.scoreBattle(battle).groupScores).toEqual({ 1: 10n, 2: 20n });
    expect(rules.scoreBattle(battle, NaN).groupScores).toEqual({ 1: 0n, 2: 0n });
    expect(rules.scoreBattle({ players: [], rounds: [] })).toEqual({ groups: [], playerScores: {}, groupScores: {} });
    expect(() => rules.resolveBattle({ players: [], rounds: [] })).toThrow('requires players');
    expect(() => rules.resolveBattle({ ...battle, mode: 'toString' })).toThrow('Unsupported Battle mode');
});

test('Jackpot ticket intervals are exact, half-open and weighted by group totals', () => {
    const battle = room([[10, 20, 30]], { mode: 'jackpot' });
    for (const [ticket, winner] of [[0n, '1'], [9n, '1'], [10n, '2'], [29n, '2'], [30n, '3'], [59n, '3']]) {
        const draw = jest.fn(() => ticket), result = rules.resolveBattle(battle, draw);
        expect(draw).toHaveBeenCalledWith(60n);
        expect(result.winners).toEqual([winner]);
        expect(result.decision).toMatchObject({ ticket: ticket.toString(), totalWeight: '60', base: 'jackpot', inverse: false });
        expect(result.decision.groups.map(group => group.weight)).toEqual(['10', '20', '30']);
    }
    const teams = room([[5, 5, 10, 10]], { mode: 'jackpot', format: '2v2' });
    expect(rules.resolveBattle(teams, () => 9n).winners).toEqual(['1', '2']);
    expect(rules.resolveBattle(teams, () => 10n).winners).toEqual(['3', '4']);
    expect(() => rules.resolveBattle(battle)).toThrow('deterministic BigInt');
    for (const ticket of [-1n, 60n, 1]) expect(() => rules.resolveBattle(battle, () => ticket)).toThrow('Invalid Jackpot');
});

test('Crazy Jackpot uses exact reciprocal weights and gives zero-score groups equal exclusive chances', () => {
    const battle = room([[10, 20, 40]], { mode: 'jackpot_crazy' });
    const result = rules.resolveBattle(battle, total => total - 1n);
    expect(result.decision.groups.map(group => group.weight)).toEqual(['800', '400', '200']);
    expect(result.decision.totalWeight).toBe('1400');
    expect(result.winners).toEqual(['3']);
    expect(rules.resolveBattle(battle, () => 799n).winners).toEqual(['1']);
    expect(rules.resolveBattle(battle, () => 800n).winners).toEqual(['2']);
    const zero = room([[0, 50, 0]], { mode: 'jackpot_crazy' });
    expect(rules.resolveBattle(zero, () => 0n).winners).toEqual(['1']);
    expect(rules.resolveBattle(zero, () => 1n).winners).toEqual(['3']);
    expect(rules.resolveBattle(zero, () => 0n).decision.groups.map(group => group.weight)).toEqual(['1', '0', '1']);
    for (const mode of ['jackpot', 'jackpot_crazy']) {
        const allZero = rules.resolveBattle(room([[0, 0, 0]], { mode }), () => 2n);
        expect(allZero.decision.groups.map(group => group.weight)).toEqual(['1', '1', '1']);
        expect(allZero.winners).toEqual(['3']);
    }
});

test('large coin values and reciprocal weights never pass through floating-point numbers', () => {
    const huge = 90071992547409931234567890123456789n;
    const battle = room([[huge, huge + 1n]], { mode: 'jackpot_crazy' });
    expect(rules.scoreBattle(battle).groupScores).toEqual({ 1: huge, 2: huge + 1n });
    const result = rules.resolveBattle(battle, () => huge + 1n);
    expect(result.decision.groups.map(group => group.weight)).toEqual([(huge + 1n).toString(), huge.toString()]);
    expect(result.decision.totalWeight).toBe((2n * huge + 1n).toString());
    expect(result.winners).toEqual(['2']);
    expect(() => JSON.stringify(result)).not.toThrow();
});
