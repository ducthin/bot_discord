const crypto = require('node:crypto');
const { containersById } = require('./cs2Catalogue');
const market = require('./cs2Market');
const store = require('./managementStore');
const { COIN_SCALE, serializeCoins } = require('./coins');
const wallet = require('../commands/taixiu');
const { customCasesById, casePricing, cachedPrices, lockCasePricing, lockedCase, rollCustomCase } = require('./cs2BattleCases');
const { ROUND_LIMIT } = require('./cs2BattleLimits');

const FORMATS = { 2: '2 người', 3: '3 người', 4: '4 người', custom: 'Tùy chỉnh 5–10 người', teams: '2 đấu 2' };
const MODES = { regular: 'Thường', crazy: 'Crazy', sharing: 'Chia đều' };
const TIE_RULES = { split: 'Chia đều xu', 'sudden-death': 'Vòng 50/50' };
const BOT_ID = 'case-battle-bot';
const CUSTOM_PLAYER_MIN = 5;
const MAX_PLAYERS = 10;
const ROOM_LIFETIME = 10 * 60_000;
const ROOM_LIMIT = 30;
const RESULT_LIMIT = 30;
const HISTORY_LIMIT = 30;
const HISTORY_PAGE_SIZE = 5;
const HISTORY_LIFETIME = 1 * 60_000;
const RESULT_MESSAGE_LIFETIME = 60_000;
const ROOM_SCOPE = { sections: ['cs2Battles'] };
const HISTORY_SCOPE = { sections: ['cs2Battles', 'cs2BattleHistory'] };
const RESULT_SCOPE = { sections: ['cs2Battles', 'cs2BattleResultMessages'] };

function getBattleCase(id) {
    const custom = customCasesById.get(id);
    if (custom) return custom;
    const item = containersById.get(id);
    return item?.key ? item : null;
}

function isOpen(room, now = Date.now()) {
    return room.status === 'waiting' && room.expiresAt > now;
}

const isValidCustomPlayerLimit = value => Number.isInteger(value) && value >= CUSTOM_PLAYER_MIN && value <= MAX_PLAYERS;
const capacity = room => room.format === 'teams' ? 4
    : room.format === 'custom' ? (isValidCustomPlayerLimit(room.playerLimit) ? room.playerLimit : 0)
        : Number(room.format);
const formatLabel = room => room.format === 'custom'
    ? (isValidCustomPlayerLimit(room.playerLimit) ? `${room.playerLimit} người tùy chỉnh` : FORMATS.custom)
    : FORMATS[room.format] ?? 'Battle';

const teamForSeat = seat => seat <= 2 ? 'A' : 'B';

function getSeats(room) {
    const count = capacity(room);
    if (!Number.isInteger(count) || count < 1 || count > MAX_PLAYERS) return [];
    const seats = Array(count).fill(null);
    const assigned = new Set();
    const players = Array.isArray(room.players) ? room.players : [];
    for (const player of players) {
        const seat = room.seats?.[player.id];
        if (Number.isInteger(seat) && seat >= 1 && seat <= count && !seats[seat - 1] && !assigned.has(player.id)) {
            seats[seat - 1] = player;
            assigned.add(player.id);
        }
    }
    for (const player of players) {
        if (assigned.has(player.id)) continue;
        const position = seats.findIndex((occupant, index) => !occupant &&
            (room.format !== 'teams' || teamForSeat(index + 1) === (player.team === 'B' ? 'B' : 'A')));
        if (position < 0) continue;
        seats[position] = player;
        assigned.add(player.id);
    }
    return seats;
}

function seatLabel(room, seat) {
    if (!Number.isInteger(seat) || seat < 1 || seat > capacity(room)) return null;
    return room.format === 'teams' ? `${teamForSeat(seat)}${(seat - 1) % 2 + 1}` : `Vị trí ${seat}`;
}

function storeSeats(room, positions = getSeats(room)) {
    room.seats = Object.fromEntries(positions.flatMap((player, index) => player ? [[player.id, index + 1]] : []));
    if (room.format === 'teams') {
        for (const player of room.players) player.team = teamForSeat(room.seats[player.id]);
    }
}

function resultDeleteAt(record) {
    if (!Number.isSafeInteger(record?.deleteAt)) return null;
    // Older saved results may still have a ten-minute deadline. Apply the
    // current lifetime from their original publication, never from a refresh.
    return Number.isSafeInteger(record.publishedAt)
        ? Math.min(record.deleteAt, record.publishedAt + RESULT_MESSAGE_LIFETIME) : record.deleteAt;
}

function pruneRooms(rooms, now, publishedResults = {}) {
    // Visible results still need their rounds and locked prices for pagination,
    // schedules and odds. Keep those rooms until their existing deadline.
    const hasVisibleResult = room => {
        const result = publishedResults[room.id];
        return room.status === 'finished' && result?.roomId === room.id && result.channelId === room.channelId &&
            resultDeleteAt(result) > now;
    };
    const closed = Object.values(rooms).filter(room => !isOpen(room, now) && !room.pendingResultMessageId && !hasVisibleResult(room))
        .sort((a, b) => (b.finishedAt ?? b.expiresAt) - (a.finishedAt ?? a.expiresAt));
    for (const room of closed.slice(RESULT_LIMIT - 1)) delete rooms[room.id];
}

async function createRoom(guildId, { id, channelId, hostId, caseIds, format, playerLimit, mode, animationMode = 'full', tieRule = 'split', expectedPrices }) {
    if (!Object.hasOwn(FORMATS, format) || (format === 'custom' && !isValidCustomPlayerLimit(playerLimit)) ||
        !Object.hasOwn(MODES, mode) || (format === 'teams' && mode === 'sharing') ||
        !['fast', 'full'].includes(animationMode) ||
        !Object.hasOwn(TIE_RULES, tieRule) ||
        !Array.isArray(caseIds) || !caseIds.length || caseIds.length > ROUND_LIMIT || caseIds.some(id => !customCasesById.has(id))) {
        return { error: format === 'custom' && !isValidCustomPlayerLimit(playerLimit)
            ? `Số người tùy chỉnh phải từ ${CUSTOM_PLAYER_MIN} đến ${MAX_PLAYERS}.` : 'Cấu hình trận chưa hợp lệ.' };
    }
    return store.transact(guildId, async (state, save) => {
        const rooms = state.cs2Battles ??= {};
        const now = Date.now();
        if (rooms[id]) return { error: 'Phòng này đã được xử lý.' };
        const open = Object.values(rooms).filter(room => isOpen(room, now));
        if (open.some(room => room.hostId === hostId)) return { error: 'Bạn đã có một phòng Battle đang chờ.' };
        if (open.length >= ROOM_LIMIT) return { error: 'Đang có quá nhiều phòng chờ. Hãy thử lại sau.' };
        const priceOf = cachedPrices();
        const prices = Object.fromEntries([...new Set(caseIds)].map(caseId => [caseId, casePricing(getBattleCase(caseId), priceOf)]));
        if (Object.values(prices).includes(null)) return { error: caseIds.some(id => prices[id] == null && customCasesById.get(id)?.blueOnly)
            ? 'Hòm Blue Gem đang thiếu giá CSFloat đúng seed. Hãy chờ đồng bộ hoặc chọn hòm khác.'
            : 'Một hòm đang thiếu giá BUFF. Hãy chọn hòm khác hoặc chờ đồng bộ.' };
        const fee = caseIds.reduce((sum, caseId) => sum + prices[caseId].fee, 0n);
        const pricesByCase = Object.fromEntries(Object.entries(prices).map(([caseId, pricing]) => [caseId, lockCasePricing(pricing)]));
        if (Object.entries(pricesByCase).some(([caseId, pricing]) => !samePricing(pricing, expectedPrices?.[caseId]))) {
            return { error: 'Giá đã đổi. Kiểm tra phí mới rồi bấm Đăng phòng lại.' };
        }
        if (wallet.getCoinBalance(state, hostId) < fee) return { error: 'Ví của bạn chưa đủ xu cho trận này.' };
        backfillHistory(state);
        pruneRooms(rooms, now, state.cs2BattleResultMessages);
        const room = { id, channelId, hostId, caseIds: [...caseIds], format, ...(format === 'custom' ? { playerLimit } : {}),
            mode, animationMode: 'full', tieRule, createdAt: now, fee: fee.toString(), pricesByCase, status: 'waiting',
            players: [{ id: hostId, ...(format === 'teams' ? { team: 'A' } : {}) }], seats: { [hostId]: 1 }, expiresAt: now + ROOM_LIFETIME };
        rooms[id] = room;
        recordHistory(state, room, now);
        await save();
        return { room };
    }, { sections: [...HISTORY_SCOPE.sections, 'cs2BattleResultMessages'], wallets: [hostId] });
}

function samePricing(left, right) {
    return left.revision === right?.revision && Array.isArray(right.values) &&
        left.values.length === right.values.length && left.values.every((value, index) => value === right.values[index]);
}

async function openSolo(guild, userId, id, item, expectedPrices) {
    const pricing = casePricing(item);
    if (!pricing || !samePricing(pricing, expectedPrices)) return { status: 'price-changed' };
    const { reward } = await wallet.purchaseWithCoins(guild, userId, pricing.fee, state => {
        const current = casePricing(item);
        if (!current || !samePricing(current, pricing)) return null;
        const inventories = state.skinCases ??= {};
        const stash = inventories[userId] ??= {};
        if (stash.recentActions?.includes(id)) return null;
        const outcome = rollCustomCase({ ...item, entries: pricing.entries }, pricing.values, id, Date.now());
        stash.recentActions = [...(stash.recentActions ?? []), id].slice(-32);
        (stash.drops ??= []).push(outcome.drop);
        return { ...outcome, fee: pricing.fee };
    }, { wallets: [userId], inventory: [userId] });
    return reward ? { status: 'opened', ...reward, entries: pricing.entries } : { status: 'unavailable' };
}

function chooseWinners(room, totals) {
    if (room.mode === 'sharing') return { winners: room.players.map(player => player.id), tie: false };
    const scores = new Map();
    for (const player of room.players) {
        const group = player.team ?? player.id;
        scores.set(group, (scores.get(group) ?? 0n) + totals[player.id]);
    }
    const better = room.mode === 'crazy' ? (a, b) => a < b : (a, b) => a > b;
    const best = [...scores.values()].reduce((a, b) => better(a, b) ? a : b);
    const tied = [...scores].filter(([, total]) => total === best).map(([id]) => id);
    const tie = tied.length > 1;
    let winningGroups = tied;
    let tieBreaks = [];
    let tieBracket;
    const tieSplit = tie && room.tieRule === 'split';
    if (tie && room.tieRule === 'sudden-death') {
        const result = breakTie(room.id, tied);
        winningGroups = [result.winner];
        tieBreaks = result.tieBreaks;
        tieBracket = result.tieBracket;
    } else if (tie && !tieSplit) winningGroups = [tied[crypto.randomInt(tied.length)]];
    return { winners: room.players.filter(player => winningGroups.includes(player.team ?? player.id)).map(player => player.id),
        tie, tieSplit, tieGroups: tie ? tied : [], tieBreaks, ...(tieBracket ? { tieBracket } : {}) };
}

function breakTie(roomId, groups) {
    const order = [...groups];
    // Randomize the bye as well as each coin, so every tied side has the same overall chance.
    if (order.length > 2) for (let index = order.length - 1; index > 0; index--) {
        const selected = crypto.randomInt(index + 1);
        [order[index], order[selected]] = [order[selected], order[index]];
    }
    let remaining = [...order];
    const tieBreaks = [];
    const byes = [];
    let round = 0;
    while (remaining.length > 1) {
        round++;
        const next = [];
        for (let index = 0; index < remaining.length; index += 2) {
            const left = remaining[index];
            const right = remaining[index + 1];
            if (right === undefined) {
                byes.push({ round, group: left });
                next.push(left);
                continue;
            }
            const winner = [left, right][crypto.randomInt(2)];
            tieBreaks.push({ id: `${roomId}-tie-${tieBreaks.length + 1}`, round, left, right, winner, probability: 0.5 });
            next.push(winner);
        }
        remaining = next;
    }
    return { winner: remaining[0], tieBreaks, tieBracket: { order, byes, rounds: round } };
}

function settle(room, state, rollDrop, orderSeats = Boolean(room.seats) && !room.legacySeatOrder) {
    const positions = getSeats(room);
    storeSeats(room, positions);
    if (orderSeats) room.players = positions.filter(Boolean);
    const now = Date.now();
    const totals = Object.fromEntries(room.players.map(({ id }) => [id, 0n]));
    const rounds = [];
    for (const [index, caseId] of room.caseIds.entries()) {
        const weaponCase = getBattleCase(caseId);
        const pricing = room.pricesByCase?.[caseId];
        const resolved = weaponCase?.entries && lockedCase(weaponCase, pricing);
        if (!weaponCase || (weaponCase.entries && !resolved)) {
            Object.assign(room, { status: 'cancelled', reason: 'Bảng hòm đã đổi. Hãy tạo phòng mới.', finishedAt: now });
            return;
        }
        const entries = [];
        for (const [seat, player] of room.players.entries()) {
            const dropId = `${room.id}-${index + 1}-${seat + 1}`;
            let outcome;
            if (resolved) {
                outcome = rollCustomCase(resolved, pricing.values, dropId, now);
            } else {
                const drop = rollDrop(weaponCase, dropId, now);
                const ref = market.getDropMarketQuoteRef(drop);
                const price = ref && market.peekMarketQuote(ref.name, ref)?.priceVnd;
                if (!Number.isSafeInteger(price) || price <= 0) {
                    Object.assign(room, { status: 'cancelled', reason: 'Một món vừa mở thiếu giá BUFF. Trận đã hủy, không trừ xu.', finishedAt: now });
                    return;
                }
                outcome = { drop, value: BigInt(price) * COIN_SCALE };
            }
            totals[player.id] += outcome.value;
            entries.push({ userId: player.id, drop: outcome.drop, value: outcome.value.toString() });
        }
        rounds.push({ caseId, entries });
    }
    const result = chooseWinners(room, totals);
    const { winners, tieSplit } = result;
    const pool = Object.values(totals).reduce((sum, amount) => sum + amount, 0n);
    const payouts = {};
    const fee = BigInt(room.fee);
    const balances = state.taixiu.balances;
    for (const { id, isBot } of room.players) {
        if (!isBot) balances[id] = serializeCoins(wallet.getCoinBalance(state, id) - fee);
    }
    const payoutType = room.format === 'teams' || room.mode === 'sharing' || tieSplit ? 'coins' : 'skins';
    let unclaimedPayout = 0n;
    let discardedSkins = 0;
    if (payoutType === 'coins') {
        const playerById = new Map(room.players.map(player => [player.id, player]));
        // Every winning seat has the same share, including bots. A bot's share
        // stays unclaimed instead of increasing the real players' winnings.
        const count = BigInt(winners.length);
        const remainder = pool % count;
        // Randomize the starting seat for indivisible cents. Every winning seat,
        // including a bot, has remainder/count chance of receiving one extra cent.
        // Persisted payouts are reused on reveal/recovery; this never runs again.
        const remainderStart = remainder ? crypto.randomInt(winners.length) : 0;
        for (const [index, id] of winners.entries()) {
            const remainderIndex = (index - remainderStart + winners.length) % winners.length;
            const amount = pool / count + (BigInt(remainderIndex) < remainder ? 1n : 0n);
            if (playerById.get(id).isBot) {
                unclaimedPayout += amount;
                continue;
            }
            payouts[id] = amount.toString();
        }
    } else {
        const winner = room.players.find(player => winners.includes(player.id) && !player.isBot);
        if (!winner) discardedSkins = rounds.length * room.players.length;
    }
    Object.assign(room, { status: 'revealing', rounds, ...result, payouts, payoutType,
        pool: pool.toString(), totals: Object.fromEntries(Object.entries(totals).map(([id, total]) => [id, total.toString()])),
        ...(unclaimedPayout ? { unclaimedPayout: unclaimedPayout.toString() } : {}), ...(discardedSkins ? { discardedSkins } : {}) });
}

function applyPendingPayout(room, state) {
    if (room.payoutType === 'coins') {
        const balances = state.taixiu.balances;
        for (const [id, amount] of Object.entries(room.payouts ?? {})) {
            balances[id] = serializeCoins(wallet.getCoinBalance(state, id) + BigInt(amount));
        }
    } else {
        const winner = room.players.find(player => room.winners.includes(player.id) && !player.isBot);
        if (winner) {
            const inventories = state.skinCases ??= {};
            const stash = inventories[winner.id] ??= {};
            (stash.drops ??= []).push(...room.rounds.flatMap(round => round.entries.map(({ drop }) => drop)));
        }
    }
    room.status = 'finished';
    room.finishedAt = Date.now();
}

function botSeats(room) {
    if (!room.seats || room.legacySeatOrder) {
        const players = [...room.players];
        let nextBot = 1;
        while (players.length < capacity(room)) {
            let team;
            if (room.format === 'teams') {
                const counts = Object.fromEntries(['A', 'B'].map(side => [side, players.filter(player => player.team === side).length]));
                const humans = Object.fromEntries(['A', 'B'].map(side => [side, players.filter(player => player.team === side && !player.isBot).length]));
                team = counts.A < counts.B ? 'A' : counts.B < counts.A ? 'B'
                    : humans.A < humans.B ? 'A' : humans.B < humans.A ? 'B' : 'B';
            }
            players.push({ id: `${BOT_ID}:${room.id}:${nextBot++}`, isBot: true, name: 'Bot', ...(team ? { team } : {}) });
        }
        room.seats = Object.fromEntries(getSeats({ ...room, players }).flatMap((player, index) => player ? [[player.id, index + 1]] : []));
        return players;
    }
    let nextBot = 1;
    const positions = getSeats(room).map((player, index) => player ?? {
        id: `${BOT_ID}:${room.id}:${nextBot++}`, isBot: true, name: 'Bot',
        ...(room.format === 'teams' ? { team: teamForSeat(index + 1) } : {})
    });
    storeSeats(room, positions);
    return positions;
}

async function readRoom(guildId, channelId, id) {
    const room = (await store.read(guildId, ROOM_SCOPE)).cs2Battles?.[id];
    return room && room.channelId === channelId ? { ...room,
        seats: Object.fromEntries(getSeats(room).flatMap((player, index) => player ? [[player.id, index + 1]] : [])),
        animationMode: 'full' } : null;
}

async function actOnRoom(guild, channelId, id, userId, action, rollDrop, messageId) {
    const selectingSeat = typeof action === 'string' && action.startsWith('seat-');
    const initial = selectingSeat ? (await store.read(guild.id, ROOM_SCOPE)).cs2Battles?.[id] : null;
    const movingSeat = initial?.players?.some(player => player.id === userId);
    const scope = action === 'cancel' || action === 'leave' || movingSeat ? HISTORY_SCOPE
        : { sections: [...HISTORY_SCOPE.sections, 'taixiu'], wallets: 'all', ...(messageId ? {} : { inventory: 'all' }) };
    let savedState;
    const result = await store.transact(guild.id, async (state, save) => {
        const room = state.cs2Battles?.[id];
        if (!room || room.channelId !== channelId) return { error: 'Phòng Battle này đã hết hạn.' };
        if (!isOpen(room)) return { room };
        const orderSeats = selectingSeat || (Boolean(room.seats) && !room.legacySeatOrder);
        const inferredLegacySeats = !selectingSeat && !room.seats;
        if (action === 'cancel') {
            if (room.hostId !== userId) return { error: 'Chỉ chủ phòng mới có thể hủy trận.' };
            Object.assign(room, { status: 'cancelled', finishedAt: Date.now() });
        } else if (action === 'leave') {
            if (room.hostId === userId) return { error: 'Bạn là chủ phòng. Dùng nút Hủy phòng để kết thúc.' };
            if (!room.players.some(player => player.id === userId)) return { error: 'Bạn chưa tham gia phòng này.' };
            const positions = getSeats(room).map(player => player?.id === userId ? null : player);
            room.players = room.players.filter(player => player.id !== userId);
            storeSeats(room, positions);
        } else if (action === 'bot-start') {
            if (room.hostId !== userId) return { error: 'Chỉ chủ phòng mới có thể bắt đầu trận với Bot.' };
            if (room.players.some(player => player.isBot)) return { error: 'Phòng này đã có Bot tham gia.' };
            const fee = BigInt(room.fee);
            if (room.players.some(player => !player.isBot && wallet.getCoinBalance(state, player.id) < fee)) {
                return { error: 'Một người chơi không còn đủ xu để bắt đầu trận với Bot.' };
            }
            room.players = botSeats(room);
            settle(room, state, rollDrop, orderSeats);
            if (room.status === 'revealing' && messageId) room.pendingResultMessageId = messageId;
            else if (room.status === 'revealing') applyPendingPayout(room, state);
        } else {
            const positions = getSeats(room);
            const current = room.players.find(player => player.id === userId);
            let selected;
            if (selectingSeat) {
                if (!/^seat-(?:[1-9]|10)$/.test(action)) return { error: 'Hãy chọn đúng vị trí trong phòng.' };
                selected = Number(action.slice('seat-'.length));
                if (selected > positions.length) return { error: 'Vị trí này không có trong phòng.' };
                const occupant = positions[selected - 1];
                if (occupant?.id === userId) return { room, notice: 'Bạn đang ở vị trí này.' };
                if (occupant) return { error: 'Vị trí này đã có người. Hãy chọn chỗ trống khác.' };
                if (current) {
                    const previous = positions.findIndex(player => player?.id === userId);
                    if (previous < 0) return { error: 'Vị trí của bạn vừa thay đổi. Hãy làm mới phòng.' };
                    positions[previous] = null;
                    positions[selected - 1] = current;
                    delete room.legacySeatOrder;
                    storeSeats(room, positions);
                    recordHistory(state, room);
                    await save();
                    return { room };
                }
                // A member may have left after the initial scope read. Retry
                // through a fresh request that can load the joining wallets.
                if (movingSeat) return { error: 'Bạn vừa rời phòng. Hãy chọn vị trí lại.' };
            } else {
                const team = action === 'join-a' ? 'A' : action === 'join-b' ? 'B' : null;
                if ((room.format === 'teams') !== Boolean(team) || (!team && action !== 'join')) return { error: 'Hãy chọn đúng chỗ trong phòng.' };
                if (current) return { error: 'Bạn đã có chỗ trong phòng.' };
                selected = positions.findIndex((player, index) => !player && (!team || teamForSeat(index + 1) === team)) + 1;
                if (!selected) return { error: team ? `Đội ${team} đã đủ người.` : 'Phòng này đã đủ người.' };
            }
            const team = room.format === 'teams' ? teamForSeat(selected) : null;
            const fee = BigInt(room.fee);
            if (wallet.getCoinBalance(state, userId) < fee) return { error: 'Ví của bạn chưa đủ xu để tham gia.' };
            const player = { id: userId, ...(team ? { team } : {}) };
            room.players.push(player);
            positions[selected - 1] = player;
            if (selectingSeat) delete room.legacySeatOrder;
            storeSeats(room, positions);
            if (inferredLegacySeats) room.legacySeatOrder = true;
            if (room.players.length === capacity(room)) {
                const short = room.players.filter(player => !player.isBot && wallet.getCoinBalance(state, player.id) < fee);
                if (short.length) {
                    const removed = new Set(short.map(player => player.id));
                    if (removed.has(room.hostId)) {
                        Object.assign(room, { status: 'cancelled', reason: 'Chủ phòng không còn đủ xu. Trận đã hủy.', finishedAt: Date.now() });
                    } else {
                        room.players = room.players.filter(player => !removed.has(player.id));
                    }
                } else {
                    settle(room, state, rollDrop, orderSeats);
                    if (room.status === 'revealing' && messageId) room.pendingResultMessageId = messageId;
                    else if (room.status === 'revealing') applyPendingPayout(room, state);
                }
            }
        }
        if (inferredLegacySeats) room.legacySeatOrder = true;
        storeSeats(room);
        recordHistory(state, room);
        await save();
        if (room.status === 'finished') {
            savedState = state;
            return { room, started: true };
        }
        if (room.status === 'revealing') return { room, started: true };
        return { room };
    }, scope);
    if (savedState) {
        try { wallet.refreshCoinLeaderboard(guild, savedState, scope); }
        catch (error) { console.warn('Lỗi cập nhật xếp hạng sau Battle:', error.message); }
    }
    return result;
}

async function completeReveal(guild, id) {
    const initial = (await store.read(guild.id, ROOM_SCOPE)).cs2Battles?.[id];
    if (!initial) return { error: 'Phòng Battle này đã hết hạn.' };
    if (initial.status !== 'revealing') return { room: initial };
    const owners = [...new Set([...initial.players.filter(player => !player.isBot).map(player => player.id),
        ...Object.keys(initial.payouts ?? {})])];
    const scope = { ...HISTORY_SCOPE, wallets: owners, inventory: owners };
    let savedState;
    const result = await store.transact(guild.id, async (state, save) => {
        const room = state.cs2Battles?.[id];
        if (!room) return { error: 'Phòng Battle này đã hết hạn.' };
        if (room.status === 'finished') return { room };
        if (room.status !== 'revealing') return { room };
        if (room.players.some(player => !player.isBot && !owners.includes(player.id)) ||
            Object.keys(room.payouts ?? {}).some(userId => !owners.includes(userId))) {
            return { error: 'Trận vừa thay đổi. Hãy thử lại để chốt thưởng.' };
        }
        applyPendingPayout(room, state);
        recordHistory(state, room);
        await save();
        savedState = state;
        return { room, completed: true };
    }, scope);
    if (result.completed) {
        try { wallet.refreshCoinLeaderboard(guild, savedState, scope); } catch (error) {
            console.warn('Lỗi cập nhật xếp hạng sau Battle:', error.message);
        }
    }
    return result;
}

async function pendingResults(guildId) {
    const { cs2Battles } = await store.read(guildId, ROOM_SCOPE);
    return Object.values(cs2Battles ?? {}).filter(room => room.pendingResultMessageId &&
        (room.status === 'revealing' || room.status === 'finished'));
}

function historyEntry(room, now) {
    const entry = { id: room.id, roomId: room.id, channelId: room.channelId, hostId: room.hostId,
        caseIds: [...room.caseIds], format: room.format, ...(room.format === 'custom' ? { playerLimit: room.playerLimit } : {}),
        mode: room.mode, animationMode: 'full',
        tieRule: room.tieRule ?? 'legacy-random', fee: room.fee, roundCount: room.caseIds.length,
        createdAt: room.createdAt ?? now, updatedAt: now, expiresAt: room.expiresAt, status: room.status,
        players: room.players.map(player => ({ ...player })),
        seats: Object.fromEntries(getSeats(room).flatMap((player, index) => player ? [[player.id, index + 1]] : [])) };
        for (const key of ['finishedAt', 'reason', 'winners', 'payouts', 'payoutType', 'pool', 'totals', 'tie', 'tieSplit', 'tieGroups', 'tieBreaks', 'tieBracket', 'unclaimedPayout', 'discardedSkins']) {
        if (room[key] !== undefined) entry[key] = structuredClone(room[key]);
    }
    if (room.status === 'finished') {
        entry.payoutType ??= room.format === 'teams' || room.mode === 'sharing' || room.tieSplit ? 'coins' : 'skins';
        const totals = legacyTotals(room);
        if (totals) {
            entry.totals ??= Object.fromEntries(Object.entries(totals).map(([id, amount]) => [id, amount.toString()]));
            entry.pool ??= Object.values(totals).reduce((sum, amount) => sum + amount, 0n).toString();
        }
    }
    return entry;
}

function legacyTotals(room) {
    const ids = room.players.map(player => player.id);
    if (!ids.length || new Set(ids).size !== ids.length || !Array.isArray(room.rounds) || !room.rounds.length) return null;
    const totals = Object.fromEntries(ids.map(id => [id, 0n]));
    for (const round of room.rounds) {
        if (!Array.isArray(round?.entries) || round.entries.length !== ids.length) return null;
        const seen = new Set();
        for (const entry of round.entries) {
            if (!Object.hasOwn(totals, entry?.userId) || seen.has(entry.userId) ||
                typeof entry.value !== 'string' || !/^\d{1,100}$/.test(entry.value)) return null;
            totals[entry.userId] += BigInt(entry.value);
            seen.add(entry.userId);
        }
    }
    return totals;
}

function recordHistory(state, room, now = Date.now()) {
    pruneHistory(state, now);
    const history = state.cs2BattleHistory ??= {};
    const users = new Set([...(room.historyUserIds ?? []).filter(id => !String(id).startsWith(`${BOT_ID}:`)), room.hostId,
        ...room.players.filter(player => !player.isBot && !String(player.id).startsWith(`${BOT_ID}:`)).map(player => player.id)]);
    room.historyUserIds = [...users];
    const entry = historyEntry(room, now);
    for (const userId of users) {
        const entries = history[userId] ?? [];
        const previous = entries.find(item => item.id === room.id);
        const snapshot = { ...entry, createdAt: previous?.createdAt ?? entry.createdAt };
        history[userId] = [snapshot, ...entries.filter(item => item.id !== room.id)].slice(0, HISTORY_LIMIT);
    }
}

function pruneHistory(state, now = Date.now()) {
    const history = state.cs2BattleHistory;
    if (!history) return false;
    let changed = false;
    for (const [userId, entries] of Object.entries(history)) {
        if (!Array.isArray(entries)) {
            delete history[userId];
            changed = true;
            continue;
        }
        const retained = entries.filter(entry => !Number.isSafeInteger(entry?.createdAt) ||
            entry.createdAt + HISTORY_LIFETIME > now);
        if (retained.length !== entries.length) {
            if (retained.length) history[userId] = retained;
            else delete history[userId];
            changed = true;
        }
    }
    return changed;
}

function backfillHistory(state) {
    const candidates = new Map();
    let changed = false;
    for (const room of Object.values(state.cs2Battles ?? {})) {
        if (!Array.isArray(room.caseIds) || !Array.isArray(room.players) || !room.hostId) continue;
        const timestamp = room.finishedAt ?? room.createdAt ?? room.expiresAt - ROOM_LIFETIME;
        const entry = historyEntry(room, Number.isFinite(timestamp) ? timestamp : Date.now());
        const users = new Set([...(room.historyUserIds ?? []).filter(id => !String(id).startsWith(`${BOT_ID}:`)), room.hostId,
            ...room.players.filter(player => !player.isBot && !String(player.id).startsWith(`${BOT_ID}:`)).map(player => player.id)]);
        for (const userId of users) {
            const existing = state.cs2BattleHistory?.[userId] ?? [];
            const previous = existing.find(item => item.id === room.id);
            if (previous) {
                if (!Number.isSafeInteger(previous.createdAt) && Number.isSafeInteger(entry.createdAt)) {
                    previous.createdAt = entry.createdAt;
                    changed = true;
                }
                for (const key of ['payoutType', 'pool', 'totals', 'seats']) if (previous[key] === undefined && entry[key] !== undefined) {
                    previous[key] = structuredClone(entry[key]);
                    changed = true;
                }
                continue;
            }
            if (!candidates.has(userId)) candidates.set(userId, []);
            candidates.get(userId).push(entry);
        }
    }
    for (const [userId, entries] of candidates) {
        const existing = state.cs2BattleHistory?.[userId] ?? [];
        const merged = [...existing, ...entries].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, HISTORY_LIMIT);
        if (merged.length === existing.length && merged.every((entry, index) => entry.id === existing[index].id)) continue;
        (state.cs2BattleHistory ??= {})[userId] = merged;
        changed = true;
    }
    return changed;
}

function visibleHistoryEntry(entry, now = Date.now()) {
    const snapshot = structuredClone(entry);
    snapshot.seats = Object.fromEntries(getSeats(snapshot).flatMap((player, index) => player ? [[player.id, index + 1]] : []));
    snapshot.animationMode = 'full';
    if (snapshot.status === 'waiting' && snapshot.expiresAt <= now) snapshot.status = 'expired';
    return snapshot;
}

async function listHistory(guildId, userId, requestedPage = 0) {
    return store.transact(guildId, async (state, save) => {
        const backfilled = backfillHistory(state);
        const pruned = pruneHistory(state);
        const changed = backfilled || pruned;
        if (changed) await save();
        const entries = state.cs2BattleHistory?.[userId] ?? [];
        const total = entries.length;
        const pages = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
        const page = Math.max(0, Math.min(Math.trunc(Number(requestedPage)) || 0, pages - 1));
        return { entries: entries.slice(page * HISTORY_PAGE_SIZE, (page + 1) * HISTORY_PAGE_SIZE).map(entry => visibleHistoryEntry(entry)),
            total, page, pages, pageSize: HISTORY_PAGE_SIZE };
    }, HISTORY_SCOPE);
}

async function getHistoryConfig(guildId, userId, historyId) {
    return store.transact(guildId, async (state, save) => {
        const backfilled = backfillHistory(state);
        const pruned = pruneHistory(state);
        const changed = backfilled || pruned;
        if (changed) await save();
        const entry = state.cs2BattleHistory?.[userId]?.find(item => item.id === historyId);
        return entry ? visibleHistoryEntry(entry) : null;
    }, HISTORY_SCOPE);
}

function recreateConfig(room) {
    if (!Array.isArray(room?.caseIds) || !room.caseIds.length || !Array.isArray(room.players)) return null;
    return { id: room.id, channelId: room.channelId, hostId: room.hostId, status: 'finished',
        caseIds: [...room.caseIds], format: room.format,
        ...(room.format === 'custom' ? { playerLimit: room.playerLimit } : {}),
        mode: room.mode, animationMode: 'full', tieRule: room.tieRule ?? 'legacy-random',
        players: room.players.map(({ id, isBot, team }) => ({ id, ...(isBot ? { isBot: true } : {}), ...(team ? { team } : {}) })) };
}

function canRecreate(config, userId, roomId, channelId) {
    return typeof userId === 'string' && userId && !userId.startsWith(`${BOT_ID}:`) &&
        config?.status === 'finished' && config.id === roomId && (!channelId || config.channelId === channelId) &&
        config.players?.some(player => player.id === userId && !player.isBot);
}

async function getRecreateConfig(guildId, userId, roomId, channelId) {
    // Result expiry starts at publication; personal history starts at room
    // creation. A long reveal must not expire its recreate button immediately.
    const state = await store.read(guildId, { sections: [...HISTORY_SCOPE.sections, 'cs2BattleResultMessages'] });
    const result = state.cs2BattleResultMessages?.[roomId];
    if (result && !(resultDeleteAt(result) > Date.now())) return null;
    const published = result?.recreateConfig;
    if (result && result.roomId === roomId && (!channelId || result.channelId === channelId) &&
        canRecreate(published, userId, roomId, channelId)) return structuredClone(published);
    const room = state.cs2Battles?.[roomId];
    if (room?.status === 'finished' && canRecreate(room, userId, roomId, channelId)) return recreateConfig(room);
    // Older results can outlive their room without the new publication snapshot.
    // A still-retained history entry may recover the configuration, but only for
    // a player who remained in the final participant list.
    const entry = state.cs2BattleHistory?.[userId]?.find(item => item.id === roomId &&
        (!Number.isSafeInteger(item.createdAt) || item.createdAt + HISTORY_LIFETIME > Date.now()));
    return canRecreate(entry, userId, roomId, channelId) ? recreateConfig(entry) : null;
}

function publicResultRecord(record) {
    const { recreateConfig: _config, ...publicRecord } = record;
    return { ...publicRecord, deleteAt: resultDeleteAt(record) };
}

function markResultPublished(guildId, id, messageId) {
    return store.transact(guildId, async (state, save) => {
        const room = state.cs2Battles?.[id];
        if (!room || room.status !== 'finished' || typeof messageId !== 'string' || !messageId ||
            (room.pendingResultMessageId && room.pendingResultMessageId !== messageId)) return null;
        const existing = state.cs2BattleResultMessages?.[id];
        if (existing && existing.messageId !== messageId) return null;
        let changed = false;
        if (room.pendingResultMessageId === messageId) {
            delete room.pendingResultMessageId;
            changed = true;
        }
        let record = existing;
        if (!record) {
            const publishedAt = Date.now();
            record = { roomId: id, channelId: room.channelId, messageId, publishedAt,
                deleteAt: publishedAt + RESULT_MESSAGE_LIFETIME };
            // Keep cleanup records separate: completed rooms can be pruned before
            // the message expires, and a restart must still restore the timer.
            (state.cs2BattleResultMessages ??= {})[id] = record;
            changed = true;
        }
        if (!record.recreateConfig) {
            const config = recreateConfig(room);
            if (config) { record.recreateConfig = config; changed = true; }
        }
        const deleteAt = resultDeleteAt(record);
        if (deleteAt !== null && record.deleteAt !== deleteAt) {
            record.deleteAt = deleteAt;
            changed = true;
        }
        if (changed) await save();
        return publicResultRecord(record);
    }, RESULT_SCOPE);
}

async function pendingResultDeletions(guildId) {
    const state = await store.read(guildId, { sections: ['cs2BattleResultMessages'] });
    return Object.values(state.cs2BattleResultMessages ?? {}).filter(record =>
        typeof record?.roomId === 'string' && typeof record.channelId === 'string' &&
        typeof record.messageId === 'string' && Number.isSafeInteger(record.deleteAt) && record.deleteAt > 0
    ).map(publicResultRecord);
}

function markResultDeleted(guildId, id, messageId) {
    return store.transact(guildId, async (state, save) => {
        let changed = false;
        if (state.cs2BattleResultMessages?.[id]?.messageId === messageId) {
            delete state.cs2BattleResultMessages[id];
            changed = true;
        }
        const room = state.cs2Battles?.[id];
        if (room?.pendingResultMessageId === messageId) {
            delete room.pendingResultMessageId;
            changed = true;
        }
        if (changed) await save();
    }, RESULT_SCOPE);
}

module.exports = { FORMATS, MODES, TIE_RULES, BOT_ID, ROUND_LIMIT, CUSTOM_PLAYER_MIN, MAX_PLAYERS, HISTORY_LIMIT, HISTORY_PAGE_SIZE, HISTORY_LIFETIME, RESULT_MESSAGE_LIFETIME,
    capacity, formatLabel, getSeats, seatLabel, isValidCustomPlayerLimit, isOpen, getBattleCase, createRoom, readRoom, actOnRoom, completeReveal, openSolo,
    pendingResults, markResultPublished, pendingResultDeletions, markResultDeleted, listHistory, getHistoryConfig, getRecreateConfig };
