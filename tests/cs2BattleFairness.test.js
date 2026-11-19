const { loadBattleAudit } = require('../scripts/lib/load-battle-audit');
const battle = loadBattleAudit();
const { crypto, market, wallet } = battle.auditDependencies;
const source = battle.getBattleCase('battle-balance').entries[0].drop;

function permutations(values) {
    if (values.length < 2) return [values];
    return values.flatMap((value, index) => permutations(values.filter((_, other) => other !== index))
        .map(rest => [value, ...rest]));
}

function* randomPaths(bounds, prefix = []) {
    if (!bounds.length) { yield prefix; return; }
    for (let value = 0; value < bounds[0]; value++) yield* randomPaths(bounds.slice(1), [...prefix, value]);
}

beforeEach(() => {
    jest.spyOn(market, 'getDropMarketQuoteRef').mockImplementation(drop => ({ name: String(drop.auditPrice) }));
    jest.spyOn(market, 'peekMarketQuote').mockImplementation(name => ({ priceVnd: Number(name) }));
});

afterEach(() => jest.restoreAllMocks());

function settlePrices(prices, { occupants = prices.map((_, index) => String(101 + index)), mode = 'regular',
    tieRule = 'split', bots = [] } = {}) {
    const botIds = new Set(bots);
    const players = occupants.map(id => ({ id, ...(botIds.has(id) ? { isBot: true, name: 'Bot' } : {}) }));
    const room = { id: 'audit-room', hostId: players.find(player => !player.isBot).id, channelId: '20',
        caseIds: [source.caseId], format: prices.length <= 4 ? String(prices.length) : 'custom',
        ...(prices.length > 4 ? { playerLimit: prices.length } : {}), mode, tieRule, fee: '100', status: 'waiting',
        players, seats: Object.fromEntries(players.map((player, index) => [player.id, index + 1])) };
    const state = { taixiu: { balances: Object.fromEntries(players.filter(player => !player.isBot).map(player => [player.id, 1000])) } };
    let draw = 0;
    const roll = jest.fn((_item, id, acquiredAt) => ({ ...source, id, acquiredAt, auditPrice: prices[draw++] }));
    battle.settle(room, state, roll);
    expect(roll).toHaveBeenCalledTimes(prices.length);
    return { room, state };
}

test.each(['regular', 'crazy'])('%s three-seat score permutations give every position equal winning credit', mode => {
    const draw = jest.spyOn(crypto, 'randomInt');
    const players = ['left', 'middle', 'right'].map(id => ({ id }));
    const credit = { left: 0, middle: 0, right: 0 };
    const uniqueWins = { left: 0, middle: 0, right: 0 };
    for (const left of [100n, 200n, 300n]) for (const middle of [100n, 200n, 300n]) for (const right of [100n, 200n, 300n]) {
        const values = [left, middle, right];
        const totals = Object.fromEntries(players.map((player, index) => [player.id, values[index]]));
        const winningValue = (mode === 'regular' ? values.reduce((a, b) => a > b ? a : b) : values.reduce((a, b) => a < b ? a : b));
        const expected = players.filter(player => totals[player.id] === winningValue).map(player => player.id);
        const result = battle.chooseWinners({ id: 'audit-scores', players, mode, tieRule: 'split' }, totals);
        expect(result.winners).toEqual(expected);
        expect(result.tie).toBe(expected.length > 1);
        expect(result.tieSplit).toBe(expected.length > 1);
        for (const id of result.winners) {
            credit[id] += 6 / result.winners.length;
            if (result.winners.length === 1) uniqueWins[id]++;
        }
        for (const order of permutations(players)) {
            const reordered = battle.chooseWinners({ id: 'audit-scores', players: order, mode, tieRule: 'split' }, totals);
            expect([...reordered.winners].sort()).toEqual([...expected].sort());
        }
    }
    // 27 equally likely score vectors distribute 27 total winning shares equally.
    expect(credit).toEqual({ left: 54, middle: 54, right: 54 });
    expect(uniqueWins).toEqual({ left: 5, middle: 5, right: 5 });
    expect(draw).not.toHaveBeenCalled();
});

test.each([3, 4])('%i-way sudden death has exactly equal winners across every shuffle and coin path', count => {
    const groups = Array.from({ length: count }, (_, index) => `seat-${index + 1}`);
    const original = [...groups];
    const bounds = [...Array.from({ length: count - 1 }, (_, index) => count - index), ...Array(count - 1).fill(2)];
    const wins = Object.fromEntries(groups.map(id => [id, 0]));
    const byes = Object.fromEntries(groups.map(id => [id, 0]));
    const draw = jest.spyOn(crypto, 'randomInt');
    let paths = 0;
    for (const path of randomPaths(bounds)) {
        let index = 0;
        draw.mockImplementation(max => {
            expect(max).toBe(bounds[index]);
            return path[index++];
        });
        const result = battle.breakTie('audit-bracket', groups);
        wins[result.winner]++;
        for (const bye of result.tieBracket.byes) byes[bye.group]++;
        expect([...result.tieBracket.order].sort()).toEqual([...groups].sort());
        expect(result.tieBreaks).toHaveLength(count - 1);
        expect(result.tieBreaks.every(match => match.probability === 0.5 && [match.left, match.right].includes(match.winner))).toBe(true);
        expect(result.tieBreaks.at(-1).winner).toBe(result.winner);
        expect(index).toBe(bounds.length);
        paths++;
    }
    expect(groups).toEqual(original);
    expect(paths).toBe(count === 3 ? 24 : 192);
    expect(Object.values(wins)).toEqual(Array(count).fill(paths / count));
    expect(Object.values(byes)).toEqual(Array(count).fill(count === 3 ? paths / count : 0));
});

test.each(['regular', 'crazy'])('%s team scoring and tied team coins are invariant to player order', mode => {
    const players = [{ id: 'a1', team: 'A' }, { id: 'a2', team: 'A' }, { id: 'b1', team: 'B' }, { id: 'b2', team: 'B', isBot: true }];
    const draw = jest.spyOn(crypto, 'randomInt');
    for (const order of permutations(players)) {
        const room = { id: 'audit-teams', players: order, mode, tieRule: 'sudden-death' };
        const clear = battle.chooseWinners(room, { a1: 100n, a2: 300n, b1: 200n, b2: 100n });
        expect([...clear.winners].sort()).toEqual(mode === 'regular' ? ['a1', 'a2'] : ['b1', 'b2']);
        const teamWins = { A: 0, B: 0 };
        for (const coin of [0, 1]) {
            draw.mockReturnValue(coin);
            const tied = battle.chooseWinners(room, { a1: 100n, a2: 200n, b1: 200n, b2: 100n });
            expect(tied.winners).toHaveLength(2);
            const winningTeam = players.find(player => player.id === tied.winners[0]).team;
            expect(tied.winners.every(id => players.find(player => player.id === id).team === winningTeam)).toBe(true);
            teamWins[winningTeam]++;
        }
        expect(teamWins).toEqual({ A: 1, B: 1 });
    }
});

test.each(['regular', 'crazy'])('%s keeps identical outcomes when host, guest and bot exchange physical seats', mode => {
    const botId = `${battle.BOT_ID}:audit-room:1`;
    const draw = jest.spyOn(crypto, 'randomInt');
    for (const occupants of permutations(['101', '102', botId])) {
        const wins = Object.fromEntries(occupants.map(id => [id, 0]));
        for (const prices of permutations([100, 200, 300])) {
            const { room, state } = settlePrices(prices, { occupants, mode, bots: [botId] });
            const expectedSeat = prices.indexOf(mode === 'regular' ? 300 : 100);
            expect(room.winners).toEqual([occupants[expectedSeat]]);
            expect(room.rounds[0].entries.map(entry => entry.userId)).toEqual(occupants);
            expect(room.rounds[0].entries.map(entry => entry.value)).toEqual(prices.map(price => String(price * 100)));
            expect(room.pool).toBe('60000');
            expect(room.discardedSkins ?? 0).toBe(room.winners[0] === botId ? 3 : 0);
            expect(wallet.getCoinBalance(state, '101')).toBe(99_900n);
            expect(wallet.getCoinBalance(state, '102')).toBe(99_900n);
            expect(state.taixiu.balances[botId]).toBeUndefined();
            wins[room.winners[0]]++;
        }
        expect(Object.values(wins)).toEqual([2, 2, 2]);
    }
    expect(draw).not.toHaveBeenCalled();
});

test.each([3, 6, 7, 9])('%i tied winners share remainder cents equally across every starting offset including a bot', count => {
    const botId = `${battle.BOT_ID}:audit-room:1`;
    const occupants = [...Array.from({ length: count - 1 }, (_, index) => String(101 + index)), botId, '999'];
    const winners = occupants.slice(0, count);
    const totals = Object.fromEntries(winners.map(id => [id, 0n]));
    const extras = Object.fromEntries(winners.map(id => [id, 0]));
    const draw = jest.spyOn(crypto, 'randomInt');
    let pool;
    let remainder;
    for (let offset = 0; offset < count; offset++) {
        draw.mockReturnValue(offset);
        const { room } = settlePrices([...Array(count).fill(2), 1], { occupants, bots: [botId] });
        expect(room.winners).toEqual(winners);
        expect(room.payoutType).toBe('coins');
        expect(draw).toHaveBeenLastCalledWith(count);
        pool = BigInt(room.pool);
        remainder = pool % BigInt(count);
        expect(remainder).toBeGreaterThan(0n);
        const amounts = winners.map(id => id === botId ? BigInt(room.unclaimedPayout) : BigInt(room.payouts[id]));
        expect(amounts.reduce((sum, amount) => sum + amount, 0n)).toBe(pool);
        expect(amounts.reduce((a, b) => a > b ? a : b) - amounts.reduce((a, b) => a < b ? a : b)).toBeLessThanOrEqual(1n);
        for (const [index, id] of winners.entries()) {
            totals[id] += amounts[index];
            extras[id] += Number(amounts[index] > pool / BigInt(count));
        }
        expect(room.payouts[botId]).toBeUndefined();
    }
    expect(Object.values(totals)).toEqual(Array(count).fill(pool));
    expect(Object.values(extras)).toEqual(Array(count).fill(Number(remainder)));
    expect(draw).toHaveBeenCalledTimes(count);
});

test('ten-way Sharing needs no rounding draw because integer market values divide by ten exactly', () => {
    const draw = jest.spyOn(crypto, 'randomInt');
    const { room } = settlePrices([1, 1, 1, 1, 1, 1, 1, 1, 1, 2], { mode: 'sharing' });
    expect(room.pool).toBe('1100');
    expect(Object.values(room.payouts)).toEqual(Array(10).fill('110'));
    expect(draw).not.toHaveBeenCalled();
});
