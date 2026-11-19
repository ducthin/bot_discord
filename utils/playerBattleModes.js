(function (root, factory) {
    'use strict';
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.MaySkinsBattleModes = factory();
})(typeof window === 'object' ? window : this, function () {
    'use strict';
// Shared Battle rules for the server and browser. Keep this module free of Node APIs.
const MODES = Object.freeze({
    regular: Object.freeze({ name: 'THƯỜNG', description: 'Tổng giá trị cao nhất thắng', icon: '⚔', base: 'regular', inverse: false }),
    crazy: Object.freeze({ name: 'CRAZY', description: 'Tổng giá trị thấp nhất thắng', icon: '↯', base: 'regular', inverse: true }),
    sharing: Object.freeze({ name: 'SHARING', description: 'Chia đều toàn bộ phần thưởng cho mọi người', icon: '◇', base: 'sharing', inverse: false }),
    terminal: Object.freeze({ name: 'TERMINAL', description: 'Chỉ giá trị vòng cuối quyết định người thắng', icon: '⇥', base: 'terminal', inverse: false }),
    terminal_crazy: Object.freeze({ name: 'TERMINAL CRAZY', description: 'Giá trị vòng cuối thấp nhất thắng', icon: '⇤', base: 'terminal', inverse: true }),
    clutch: Object.freeze({ name: 'CLUTCH', description: 'Lấy vòng có giá trị cao nhất để so tài', icon: '✦', base: 'clutch', inverse: false }),
    clutch_crazy: Object.freeze({ name: 'CLUTCH CRAZY', description: 'Lấy vòng có giá trị thấp nhất để so tài', icon: '✧', base: 'clutch', inverse: true }),
    jackpot: Object.freeze({ name: 'JACKPOT', description: 'Bốc thăm theo tỷ trọng tổng giá trị đã mở', icon: '◎', base: 'jackpot', inverse: false }),
    jackpot_crazy: Object.freeze({ name: 'JACKPOT CRAZY', description: 'Tổng giá trị càng thấp, cơ hội bốc thăm càng cao', icon: '◉', base: 'jackpot', inverse: true })
});

const FORMATS = Object.freeze({
    solo: Object.freeze({ name: 'ĐẤU ĐƠN', description: 'Mỗi người một phe', capacities: Object.freeze([2, 3, 4, 5, 6]), teamSize: 1 }),
    '2v2': Object.freeze({ name: '2 ĐẤU 2', description: 'Hai đội, mỗi đội hai người', capacities: Object.freeze([4]), teamSize: 2 }),
    '3v3': Object.freeze({ name: '3 ĐẤU 3', description: 'Hai đội, mỗi đội ba người', capacities: Object.freeze([6]), teamSize: 3 }),
    '2v2v2': Object.freeze({ name: '2 ĐẤU 2 ĐẤU 2', description: 'Ba đội, mỗi đội hai người', capacities: Object.freeze([6]), teamSize: 2 })
});

const amount = value => {
    try { const result = BigInt(value ?? 0); return result > 0n ? result : 0n; }
    catch { return 0n; }
};
const modeFor = room => {
    const id = room?.mode ?? 'regular';
    if (!Object.hasOwn(MODES, id)) throw new TypeError('Unsupported Battle mode.');
    return MODES[id];
};

function validConfiguration({ mode = 'regular', format = 'solo', capacity } = {}) {
    return typeof mode === 'string' && typeof format === 'string' && Object.hasOwn(MODES, mode) && Object.hasOwn(FORMATS, format)
        && Number.isInteger(capacity) && FORMATS[format].capacities.includes(capacity);
}

function teamForSeat(format = 'solo', seat) {
    const layout = Object.hasOwn(FORMATS, format) ? FORMATS[format] : null;
    if (!layout || format === 'solo' || !Number.isInteger(seat) || seat < 1 || seat > layout.capacities[0]) return null;
    return String.fromCharCode(65 + Math.floor((seat - 1) / layout.teamSize));
}

function playerSeats(room, players) {
    const capacity = Math.max(players.length, Number.isInteger(room.capacity) ? room.capacity : 0);
    const occupied = new Set(), seats = new Map(), pending = [];
    const valid = seat => Number.isInteger(seat) && seat >= 1 && seat <= capacity && !occupied.has(seat);
    for (const [index, player] of players.entries()) {
        const stored = room.seats?.[player.userId];
        if (valid(stored)) { occupied.add(stored); seats.set(player.userId, stored); }
        else pending.push({ player, index });
    }
    for (const { player, index } of pending) {
        const seat = valid(player.seat) ? player.seat : valid(index + 1) ? index + 1
            : Array.from({ length: capacity }, (_, at) => at + 1).find(valid);
        occupied.add(seat); seats.set(player.userId, seat);
    }
    return seats;
}

function scoreBattle(room, roundCount = room?.rounds?.length ?? 0) {
    room ??= {};
    const mode = modeFor(room), players = room?.players ?? [], rounds = room?.rounds ?? [];
    const count = roundCount === Infinity ? rounds.length
        : Math.max(0, Math.min(rounds.length, Number.isFinite(roundCount) ? Math.floor(roundCount) : 0));
    const seats = playerSeats(room, players), groups = [], byGroup = new Map(), byUser = new Map();
    for (const player of [...players].sort((left, right) => seats.get(left.userId) - seats.get(right.userId))) {
        const team = teamForSeat(room.format ?? 'solo', seats.get(player.userId));
        const id = team ? `team:${team}` : player.userId;
        if (!byGroup.has(id)) {
            const group = { id, label: team ? `Đội ${team}` : player.displayName ?? player.userId, userIds: [], score: 0n };
            groups.push(group); byGroup.set(id, group);
        }
        const group = byGroup.get(id);
        group.userIds.push(player.userId); byUser.set(player.userId, group);
    }
    const playerScores = Object.fromEntries(players.map(player => [player.userId, 0n]));
    const selected = mode.base === 'terminal' ? count === rounds.length && rounds.length ? rounds.slice(-1) : [] : rounds.slice(0, count);
    let measured = 0;
    for (const round of selected) {
        const roundPlayers = Object.fromEntries(players.map(player => [player.userId, 0n]));
        const roundGroups = new Map(groups.map(group => [group.id, 0n]));
        for (const entry of round.entries ?? []) {
            const group = byUser.get(entry.userId);
            if (!group) continue;
            const value = amount(entry.value);
            roundPlayers[entry.userId] += value;
            roundGroups.set(group.id, roundGroups.get(group.id) + value);
        }
        if (mode.base === 'clutch') {
            for (const player of players) {
                const previous = playerScores[player.userId], value = roundPlayers[player.userId];
                if (!measured || (mode.inverse ? value < previous : value > previous)) playerScores[player.userId] = value;
            }
            for (const group of groups) {
                const value = roundGroups.get(group.id);
                if (!measured || (mode.inverse ? value < group.score : value > group.score)) group.score = value;
            }
        } else {
            for (const player of players) playerScores[player.userId] += roundPlayers[player.userId];
            for (const group of groups) group.score += roundGroups.get(group.id);
        }
        measured++;
    }
    return { groups, playerScores, groupScores: Object.fromEntries(groups.map(group => [group.id, group.score])) };
}

function jackpotWeights(groups, inverse = false) {
    const scores = groups.map(group => amount(group.score));
    const zeroCount = scores.filter(score => score === 0n).length;
    const product = inverse && !zeroCount ? scores.reduce((value, score) => value * score, 1n) : 0n;
    return groups.map((group, index) => ({ ...group, weight: inverse
        ? zeroCount ? scores[index] === 0n ? 1n : 0n : product / scores[index]
        : scores.every(score => score === 0n) ? 1n : scores[index] }));
}

function resolveBattle(room, drawBigInt) {
    const mode = modeFor(room), scores = scoreBattle(room), groups = scores.groups;
    if (!groups.length) throw new TypeError('A Battle requires players.');
    const decision = { base: mode.base, inverse: mode.inverse,
        groups: groups.map(group => ({ ...group, score: group.score.toString() })), winningGroups: [] };
    if (mode.base === 'sharing') decision.winningGroups = groups.map(group => group.id);
    else if (mode.base === 'jackpot') {
        const weighted = jackpotWeights(groups, mode.inverse);
        const total = weighted.reduce((sum, group) => sum + group.weight, 0n);
        if (typeof drawBigInt !== 'function') throw new TypeError('Jackpot requires a deterministic BigInt draw.');
        const ticket = drawBigInt(total);
        if (typeof ticket !== 'bigint' || ticket < 0n || ticket >= total) throw new RangeError('Invalid Jackpot draw.');
        let end = 0n;
        for (const group of weighted) {
            end += group.weight;
            if (ticket < end) { decision.winningGroups = [group.id]; break; }
        }
        decision.groups = weighted.map(group => ({ ...group, score: group.score.toString(), weight: group.weight.toString() }));
        decision.ticket = ticket.toString(); decision.totalWeight = total.toString();
    } else {
        const best = groups.reduce((value, group) => mode.inverse
            ? group.score < value ? group.score : value : group.score > value ? group.score : value, groups[0].score);
        decision.winningGroups = groups.filter(group => group.score === best).map(group => group.id);
    }
    const winningGroups = new Set(decision.winningGroups);
    const winningUsers = new Set(groups.filter(group => winningGroups.has(group.id)).flatMap(group => group.userIds));
    return { winners: (room.players ?? []).filter(player => winningUsers.has(player.userId)).map(player => player.userId), decision };
}

return { MODES, FORMATS, validConfiguration, teamForSeat, scoreBattle, jackpotWeights, resolveBattle };
});
