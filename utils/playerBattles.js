const crypto = require('node:crypto');
const store = require('./managementStore');
const wallet = require('../commands/taixiu');
const cases = require('./cs2BattleCases');
const { VERSION: EXCLUSIVE_VERSION, SUPPORTED_VERSIONS: EXCLUSIVE_VERSIONS, describeExclusive, rollExclusiveCase } = require('./playerExclusiveDrop');
const { botProfiles } = require('./playerBattleBotProfiles');
const { COIN_SCALE, serializeCoins, formatCoins } = require('./coins');
const { ROUND_LIMIT: MAX_ROUNDS } = require('./cs2BattleLimits');
const battleModes = require('./playerBattleModes');

const INDEX = 'playerWebBattles';
const MAX_WAITING = 30;
const LIFETIME = 10 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => hash(JSON.stringify(canonical(value)));
const section = id => `playerWebBattle:${id}`;
const cleanText = value => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 100) : '';
const safeAvatar = value => {
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; }
    catch { return null; }
};

// Rejection sampling avoids modulo bias. The stream and its seed are persisted
// with the room; the seed is public only after the atomic settlement commits.
function randomStream(room) {
    let nonce = 0;
    return (minimum, maximum) => {
        if (maximum === undefined) { maximum = minimum; minimum = 0; }
        const range = maximum - minimum;
        if (!Number.isSafeInteger(range) || range <= 0 || range > 2 ** 48) throw new Error('Invalid Battle random range.');
        const ceiling = Math.floor(2 ** 48 / range) * range;
        let value;
        do {
            value = crypto.createHmac('sha256', room.serverSeed)
                .update(JSON.stringify([room.id, room.clientSeed, nonce++])).digest().readUIntBE(0, 6);
        } while (value >= ceiling);
        return minimum + value % range;
    };
}

// Separate, unbiased BigInt stream for weighted Jackpot decisions. It cannot
// consume or alter the item-roll stream used by existing and historical rooms.
function jackpotTicket(room, upper) {
    if (typeof upper !== 'bigint' || upper <= 0n) throw new Error('Invalid Jackpot range.');
    if (upper === 1n) return 0n;
    const bits = (upper - 1n).toString(2).length;
    const blocks = Math.ceil(bits / 256), mask = (1n << BigInt(bits)) - 1n;
    for (let attempt = 0; ; attempt++) {
        let hex = '';
        for (let block = 0; block < blocks; block++) hex += crypto.createHmac('sha256', room.serverSeed)
            .update(JSON.stringify(['web-battle-jackpot-v1', room.id, room.clientSeed, attempt, block])).digest('hex');
        const value = BigInt('0x' + hex) & mask;
        if (value < upper) return value;
    }
}

function rollRounds(room) {
    const draw = randomStream(room);
    const rounds = room.caseIds.map((caseId, roundIndex) => {
        const item = cases.customCasesById.get(caseId);
        const pricing = room.pricesByCase[caseId];
        const locked = cases.lockedCase(item, pricing);
        if (!locked) fail(409, 'Bảng hòm đã thay đổi. Hãy hủy phòng rồi tạo lại; chưa trừ xu.');
        if (room.exclusiveDrop === true && (!EXCLUSIVE_VERSIONS.includes(room.exclusiveVersion) ||
            pricing.exclusiveVersion !== room.exclusiveVersion || !/^\d+$/.test(pricing.fee ?? ''))) {
            fail(409, 'Cấu hình Exclusive Drop của Battle không hợp lệ; chưa trừ xu.');
        }
        return { caseId, entries: room.players.map((player, seat) => {
            const id = `${room.id}-${roundIndex + 1}-${seat + 1}`;
            const outcome = room.exclusiveDrop === true
                ? rollExclusiveCase(locked, { ...pricing, entries: locked.entries, fee: BigInt(pricing.fee) }, id, room.startedAt, draw, true, room.exclusiveVersion)
                : cases.rollCustomCase(locked, pricing.values, id, room.startedAt, draw);
            outcome.drop.reelSeed = draw(2 ** 32);
            return { userId: player.userId, drop: outcome.drop, value: outcome.value.toString(),
                ...(outcome.exclusive ? { exclusive: outcome.exclusive } : {}) };
        }) };
    });
    return { rounds, draw };
}

function verifyRoom(room) {
    try {
        const fields = ['rounds', 'totals', 'winners', 'pool', 'payoutType', 'payouts',
            ...(room.rulesVersion >= 2 ? ['decision'] : []),
            ...(room.players.some(player => player.isBot) ? ['unclaimedPayout', 'discardedSkins', 'botPayouts'] : [])];
        const actual = Object.fromEntries(fields.map(key => [key, room[key]]));
        return room.status === 'finished' && hash(room.serverSeed) === room.commitment && digest(battleOutcome(room)) === digest(actual);
    } catch { return false; }
}

function battleOutcome(room) {
    const { rounds, draw } = rollRounds(room);
    const totals = Object.fromEntries(room.players.map(player => [player.userId, 0n]));
    for (const round of rounds) for (const entry of round.entries) totals[entry.userId] += BigInt(entry.value);
    const all = Object.values(totals);
    const resolved = room.rulesVersion >= 2 ? battleModes.resolveBattle({ ...room, rounds }, upper => jackpotTicket(room, upper)) : null;
    const best = all.reduce((a, b) => room.mode === 'crazy' ? (a < b ? a : b) : (a > b ? a : b));
    const winners = resolved?.winners ?? room.players.filter(player => room.mode === 'sharing' || totals[player.userId] === best).map(player => player.userId);
    const pool = all.reduce((sum, value) => sum + value, 0n);
    const payoutType = winners.length > 1 ? 'coins' : 'skins';
    const payouts = {};
    const botPayouts = {};
    let unclaimedPayout = 0n;
    let discardedSkins = 0;
    if (payoutType === 'coins') {
        const count = BigInt(winners.length), remainder = pool % count;
        const offset = remainder ? draw(winners.length) : 0;
        winners.forEach((userId, index) => {
            const amount = pool / count + (BigInt((index - offset + winners.length) % winners.length) < remainder ? 1n : 0n);
            if (room.players.find(player => player.userId === userId).isBot) {
                unclaimedPayout += amount;
                botPayouts[userId] = amount.toString();
            }
            else payouts[userId] = amount.toString();
        });
    } else if (room.players.find(player => player.userId === winners[0]).isBot) discardedSkins = rounds.reduce((sum, round) => sum + round.entries.length, 0);
    return { rounds, totals: Object.fromEntries(Object.entries(totals).map(([id, value]) => [id, value.toString()])),
        winners, pool: pool.toString(), payoutType, payouts, ...(resolved ? { decision: resolved.decision } : {}),
        ...(room.players.some(player => player.isBot) ? { unclaimedPayout: unclaimedPayout.toString(), discardedSkins, botPayouts } : {}) };
}

function seatsFor(room) {
    const result = Array(room.capacity).fill(null);
    const pending = [];
    for (const player of room.players) {
        const seat = room.seats?.[player.userId];
        if (Number.isInteger(seat) && seat >= 1 && seat <= room.capacity && !result[seat - 1]) result[seat - 1] = player;
        else pending.push(player);
    }
    for (const player of pending) result[result.indexOf(null)] = player;
    return result;
}

function saveSeats(room, seats) {
    room.seats = Object.fromEntries(seats.flatMap((player, index) => player ? [[player.userId, index + 1]] : []));
}

function createPlayerBattles({ ownerGuild, pricingFor, quoteIdFor, itemDTO, request, previous, saveReceipt, checkQuota, updateBoard, recordActionState }) {
    function roomId(value) {
        if (typeof value !== 'string' || !UUID.test(value)) fail(400, 'Mã phòng Battle không hợp lệ.');
        return value.toLowerCase();
    }
    function capabilities(room, owner) {
        const waiting = room.status === 'waiting' && room.expiresAt > Date.now();
        const seated = room.players.some(player => player.userId === owner.userId);
        const host = room.hostId === owner.userId;
        return { canJoin: waiting && !seated && room.players.length < room.capacity,
            canLeave: waiting && seated && !host, canCancel: waiting && host,
            canStart: waiting && host && room.players.length === room.capacity,
            canChangeSeat: waiting && seated, canAddBot: waiting && host && room.players.length < room.capacity,
            canRemoveBot: waiting && host && room.players.some(player => player.isBot) };
    }
    function publicRoom(room, owner, summary = false) {
        const seats = seatsFor(room);
        const value = { id: room.id, status: room.status === 'waiting' && room.expiresAt <= Date.now() ? 'expired' : room.status,
            hostId: room.hostId, capacity: room.capacity, mode: room.mode, format: room.format ?? 'solo', rulesVersion: room.rulesVersion ?? 1,
            caseIds: [...room.caseIds], cases: structuredClone(room.cases),
            exclusiveDrop: room.exclusiveDrop === true, ...(room.exclusiveDrop === true ? { exclusiveVersion: room.exclusiveVersion } : {}),
            fee: room.fee, feeFormatted: formatCoins(BigInt(room.fee)),
            seats: Object.fromEntries(seats.flatMap((player, index) => player ? [[player.userId, index + 1]] : [])),
            players: structuredClone(room.players).map(player => {
                const seat = seats.findIndex(entry => entry?.userId === player.userId) + 1;
                const team = battleModes.teamForSeat(room.format ?? 'solo', seat);
                return { ...player, seat, ...(team ? { team } : {}) };
            }),
            createdAt: room.createdAt, expiresAt: room.expiresAt, commitment: room.commitment, ...capabilities(room, owner) };
        if (room.finishedAt) value.finishedAt = room.finishedAt;
        if (room.status === 'finished') {
            if (!summary) {
                // A stable shared animation epoch means every participant joins the same point in the replay,
                // even when their Battle response arrives at a different time.
                const finishedAt = Number.isFinite(room.finishedAt) ? room.finishedAt
                    : Number.isFinite(room.startedAt) ? room.startedAt : room.createdAt;
                if (Number.isFinite(finishedAt)) value.playbackStartedAt = finishedAt + 6000;
            }
            Object.assign(value, { winners: [...room.winners], totals: { ...room.totals }, pool: room.pool,
                ...(!summary && room.decision ? { decision: structuredClone(room.decision) } : {}),
                poolFormatted: formatCoins(BigInt(room.pool)), payoutType: room.payoutType, payouts: { ...room.payouts },
                ...(room.unclaimedPayout != null ? { unclaimedPayout: room.unclaimedPayout,
                    unclaimedPayoutFormatted: formatCoins(BigInt(room.unclaimedPayout)), discardedSkins: room.discardedSkins ?? 0,
                    botPayouts: { ...room.botPayouts } } : {}) });
            if (!summary) {
                value.rounds = room.rounds.map(round => ({ caseId: round.caseId, entries: round.entries.map(entry => ({
                    userId: entry.userId, item: itemDTO(entry.drop, BigInt(entry.value)), value: entry.value, valueFormatted: formatCoins(BigInt(entry.value)),
                    ...(entry.exclusive ? { exclusive: structuredClone(entry.exclusive) } : {})
                })) }));
                value.proof = { serverSeed: room.serverSeed, clientSeed: room.clientSeed, commitment: room.commitment,
                    algorithm: 'HMAC-SHA256/rejection-v1', outcomesHash: digest(room.rounds), verified: verifyRoom(room),
                    ...(room.rulesVersion >= 2 ? { rulesVersion: room.rulesVersion, mode: room.mode, format: room.format,
                        jackpotAlgorithm: battleModes.MODES[room.mode]?.base === 'jackpot' ? 'HMAC-SHA256/BigInt-rejection-v1' : undefined } : {}) };
            }
        }
        return value;
    }
    function remember(state, room) {
        const index = state[INDEX] ??= {};
        index[room.id] = publicRoom(room, {}, true);
        const closed = Object.values(index).filter(entry => entry.status !== 'waiting' || entry.expiresAt <= Date.now())
            .sort((a, b) => (b.finishedAt ?? b.createdAt) - (a.finishedAt ?? a.createdAt));
        for (const entry of closed.slice(50)) delete index[entry.id];
    }
    async function list(owner) {
        await ownerGuild(owner);
        const state = await store.read(owner.guildId, { sections: [INDEX] });
        return { rooms: Object.values(state[INDEX] ?? {}).sort((a, b) => b.createdAt - a.createdAt)
            .map(room => ({ ...room, status: room.status === 'waiting' && room.expiresAt <= Date.now() ? 'expired' : room.status, ...capabilities(room, owner) })),
            limits: { rounds: MAX_ROUNDS, capacities: [2, 3, 4, 5, 6], modes: Object.keys(battleModes.MODES), formats: Object.keys(battleModes.FORMATS) } };
    }
    async function detail(owner, id) {
        await ownerGuild(owner);
        id = roomId(id);
        const state = await store.read(owner.guildId, { sections: [section(id)] });
        const room = state[section(id)];
        if (!room) fail(404, 'Không tìm thấy phòng Battle trong máy chủ này.');
        return { room: publicRoom(room, owner) };
    }
    function createOptions(owner, body) {
        let caseIds = body.caseIds;
        if (caseIds === undefined && Array.isArray(body.cases)) {
            if (!body.cases.length || body.cases.length > MAX_ROUNDS || body.cases.some(entry => !entry || !Number.isInteger(entry.count)
                || entry.count < 1 || entry.count > MAX_ROUNDS)
                || body.cases.reduce((total, entry) => total + entry.count, 0) > MAX_ROUNDS) fail(400, `Chọn từ 1 đến ${MAX_ROUNDS} hòm Battle.`);
            caseIds = body.cases.flatMap(entry => Array(entry.count).fill(entry.caseId));
        }
        if (!Array.isArray(caseIds) || !caseIds.length || caseIds.length > MAX_ROUNDS || caseIds.some(id => typeof id !== 'string' || !cases.customCasesById.has(id))) fail(400, `Chọn từ 1 đến ${MAX_ROUNDS} hòm Battle hợp lệ.`);
        const capacity = body.capacity;
        const mode = body.mode ?? 'regular';
        const format = body.format ?? 'solo';
        if (!battleModes.validConfiguration({ capacity, mode, format })) fail(400, 'Cấu hình số người, đội hoặc chế độ Battle chưa hợp lệ.');
        if (body.exclusiveDrop !== undefined && typeof body.exclusiveDrop !== 'boolean') fail(400, 'Lựa chọn Exclusive Drop không hợp lệ.');
        const quoteIds = body.quoteIds;
        if (!quoteIds || typeof quoteIds !== 'object' || Array.isArray(quoteIds)
            || caseIds.some(id => typeof quoteIds[id] !== 'string' || !/^[a-f0-9]{64}$/.test(quoteIds[id]))) fail(400, 'Hãy xem phí các hòm trước khi tạo Battle.');
        const clientSeed = body.clientSeed ?? `${owner.userId}:${String(body.requestId).toLowerCase()}`;
        if (typeof clientSeed !== 'string' || !clientSeed.length || clientSeed.length > 100 || clientSeed !== cleanText(clientSeed)) fail(400, 'Client seed dài từ 1 đến 100 ký tự, không chứa ký tự điều khiển.');
        return { caseIds: [...caseIds], capacity, mode, ...(format === 'solo' ? {} : { format }), clientSeed, quoteIds: Object.fromEntries([...new Set(caseIds)].sort().map(id => [id, quoteIds[id]])),
            ...(body.exclusiveDrop !== undefined ? { exclusiveDrop: body.exclusiveDrop } : {}) };
    }
    function freshPrices(options) {
        const pricesByCase = {}, catalogue = [];
        let fee = 0n;
        for (const id of [...new Set(options.caseIds)]) {
            const item = cases.customCasesById.get(id);
            const pricing = pricingFor(item);
            if (!pricing) fail(409, 'Một hòm chưa có giá còn hạn. Chưa trừ xu; vui lòng chờ đồng bộ.');
            if (quoteIdFor(pricing) !== options.quoteIds[id]) fail(409, 'Giá hòm đã thay đổi. Hãy xem lại phí rồi tạo phòng mới; chưa trừ xu.');
            pricesByCase[id] = cases.lockCasePricing(pricing);
            const info = { id, name: item.name, image: `/play/art/${item.artId ?? id}.png`, fee: pricing.fee.toString(), feeFormatted: formatCoins(pricing.fee) };
            if (options.exclusiveDrop === true) {
                Object.assign(pricesByCase[id], { fee: pricing.fee.toString(), exclusiveVersion: EXCLUSIVE_VERSION });
                const exclusive = describeExclusive(pricing, itemDTO), selected = new Set(exclusive.indices);
                info.exclusive = exclusive;
                info.reelEntries = pricing.entries.map((entry, index) => ({
                    ...itemDTO(entry.drop, BigInt(pricing.values[index]) * COIN_SCALE), id: `${id}-${index}`,
                    chance: entry.weight / cases.TICKETS * 100, exclusiveEligible: selected.has(index) }));
            }
            catalogue.push(info);
            fee += BigInt(options.caseIds.filter(caseId => caseId === id).length) * pricing.fee;
        }
        return { pricesByCase, cases: catalogue, fee: fee.toString() };
    }
    function member(owner) {
        return { userId: owner.userId, displayName: cleanText(owner.displayName) || owner.userId, avatar: safeAvatar(owner.avatar) };
    }
    async function create(owner, body = {}) {
        await ownerGuild(owner, true);
        const options = createOptions(owner, body);
        const key = request(owner, body, ['battle-create', options]);
        const id = crypto.randomUUID();
        const scope = { sections: [INDEX, section(id), key.section], wallets: [owner.userId], inventory: [owner.userId] };
        return store.transact(owner.guildId, async (state, save) => {
            const replay = previous(state, key);
            if (replay) return replay;
            const stash = (state.skinCases ??= {})[owner.userId] ??= {};
            checkQuota(stash);
            const open = Object.values(state[INDEX] ?? {}).filter(room => room.status === 'waiting' && room.expiresAt > Date.now());
            if (open.some(room => room.hostId === owner.userId)) fail(409, 'Bạn đã có một phòng Battle đang chờ.');
            if (open.length >= MAX_WAITING) fail(409, 'Đang có quá nhiều phòng Battle. Vui lòng thử lại sau.');
            const pricing = freshPrices(options);
            const balance = wallet.getCoinBalance(state, owner.userId);
            if (balance < BigInt(pricing.fee)) fail(409, 'Ví chưa đủ xu để tạo Battle.');
            const serverSeed = crypto.randomBytes(32).toString('hex');
            const room = { id, format: 'solo', ...options, ...pricing, rulesVersion: 2, hostId: owner.userId, status: 'waiting', players: [member(owner)],
                seats: { [owner.userId]: 1 },
                ...(options.exclusiveDrop === true ? { exclusiveVersion: EXCLUSIVE_VERSION } : {}),
                serverSeed, commitment: hash(serverSeed), createdAt: Date.now(), expiresAt: Date.now() + LIFETIME };
            state[section(id)] = room;
            remember(state, room);
            const result = { room: publicRoom(room, owner), balance: balance.toString(), balanceFormatted: formatCoins(balance), replayed: false };
            saveReceipt(state, stash, key, result, 'battle-create');
            await save();
            return result;
        }, scope);
    }
    function settle(room, state) {
        if (room.seats) room.players = seatsFor(room).filter(Boolean);
        room.startedAt = Date.now();
        const outcome = battleOutcome(room);
        const { rounds, winners, payoutType, payouts } = outcome;
        Object.assign(room, outcome, { status: 'finished', finishedAt: Date.now() });
        if (!verifyRoom(room)) throw new Error('Battle outcome verification failed.');
        const balances = (state.taixiu ??= { balances: {}, round: null }).balances ??= {};
        for (const player of room.players.filter(player => !player.isBot)) balances[player.userId] = serializeCoins(wallet.getCoinBalance(state, player.userId) - BigInt(room.fee));
        if (payoutType === 'coins') {
            for (const [userId, amount] of Object.entries(payouts)) balances[userId] = serializeCoins(wallet.getCoinBalance(state, userId) + BigInt(amount));
        } else if (!room.players.find(player => player.userId === winners[0]).isBot) {
            const stash = (state.skinCases ??= {})[winners[0]] ??= {};
            (stash.drops ??= []).push(...rounds.flatMap(round => round.entries.map(entry => entry.drop)));
        }
        if (recordActionState) {
            for (const player of room.players.filter(entry => !entry.isBot)) {
                const skinIds = rounds.flatMap(round => round.entries.filter(entry => entry.userId === player.userId).map(entry => entry.drop.skinId));
                recordActionState(state, player.userId, { actionId: `battle:${room.id}:${player.userId}`, type: 'battle_complete', count: 1, skinIds, win: winners.includes(player.userId) });
            }
        }
    }
    async function act(owner, id, action, body = {}) {
        const guild = await ownerGuild(owner, true);
        id = roomId(id);
        if (action === 'seat' && (!Number.isInteger(body.seat) || body.seat < 1 || body.seat > 6)) fail(400, 'Chọn vị trí từ 1 đến 6.');
        if (action === 'bot' && (body.seat != null && (!Number.isInteger(body.seat) || body.seat < 1 || body.seat > 6)
            || body.remove != null && typeof body.remove !== 'boolean' || body.botId != null && !botProfiles.some(profile => profile.id === body.botId))) fail(400, 'Lựa chọn Bot chưa hợp lệ.');
        const options = action === 'seat' ? { seat: body.seat }
            : action === 'bot' ? { seat: body.seat ?? null, remove: body.remove === true, botId: body.botId ?? null } : null;
        const key = request(owner, body, [`battle-${action}`, id, ...(options ? [options] : [])]);
        const initialState = await store.read(owner.guildId, { sections: [section(id)] });
        const initial = initialState[section(id)];
        if (!initial) fail(404, 'Không tìm thấy phòng Battle trong máy chủ này.');
        const owners = [...new Set([owner.userId, ...initial.players.filter(player => !player.isBot).map(player => player.userId)])];
        if (action === 'start' && initial.status === 'waiting' && initial.hostId === owner.userId) {
            if (initial.players.length !== initial.capacity) fail(409, 'Phòng cần đủ người trước khi bắt đầu.');
            await Promise.all(initial.players.filter(player => !player.isBot && player.userId !== owner.userId).map(player => ownerGuild({ ...owner, userId: player.userId }, true)));
        }
        const scope = { sections: [INDEX, section(id), key.section], wallets: owners, inventory: owners };
        let saved, settled = false;
        const result = await store.transact(owner.guildId, async (state, save) => {
            const replay = previous(state, key);
            if (replay) return replay;
            const room = state[section(id)];
            if (!room) fail(404, 'Không tìm thấy phòng Battle.');
            const stash = (state.skinCases ??= {})[owner.userId] ??= {};
            checkQuota(stash);
            if (room.players.some(player => !player.isBot && !owners.includes(player.userId))) fail(409, 'Thành viên phòng đã đổi. Hãy tải lại rồi thử lại.');
            let replayed = false;
            if (room.status === 'finished' && action === 'start' && room.hostId === owner.userId) replayed = true;
            else if (room.status === 'cancelled' && action === 'cancel' && room.hostId === owner.userId) replayed = true;
            else {
                if (room.status !== 'waiting' || room.expiresAt <= Date.now()) fail(409, 'Phòng Battle đã kết thúc hoặc hết hạn; chưa trừ thêm xu.');
                const current = room.players.some(player => player.userId === owner.userId);
                if (action === 'join') {
                    if (current) replayed = true;
                    else {
                        if (room.players.length >= room.capacity) fail(409, 'Phòng đã đủ người.');
                        if (wallet.getCoinBalance(state, owner.userId) < BigInt(room.fee)) fail(409, 'Ví chưa đủ xu để tham gia.');
                        const seats = seatsFor(room);
                        const player = member(owner);
                        seats[seats.indexOf(null)] = player;
                        saveSeats(room, seats);
                        room.players.push(player);
                    }
                } else if (action === 'seat') {
                    if (body.seat > room.capacity) fail(400, 'Vị trí này không có trong phòng.');
                    const seats = seatsFor(room), target = body.seat - 1;
                    const from = seats.findIndex(player => player?.userId === owner.userId);
                    if (from >= 0) {
                        if (from === target) replayed = true;
                        else [seats[from], seats[target]] = [seats[target], seats[from]];
                    } else {
                        if (seats[target]) fail(409, 'Vị trí đã có người. Chọn một chỗ trống để tham gia.');
                        if (wallet.getCoinBalance(state, owner.userId) < BigInt(room.fee)) fail(409, 'Ví chưa đủ xu để tham gia.');
                        const player = member(owner);
                        room.players.push(player); seats[target] = player;
                    }
                    saveSeats(room, seats);
                } else if (action === 'bot') {
                    if (room.hostId !== owner.userId) fail(403, 'Chỉ chủ phòng được thêm hoặc gỡ Bot.');
                    const seats = seatsFor(room);
                    if (body.remove === true) {
                        if (!Number.isInteger(body.seat) || body.seat > room.capacity) fail(400, 'Chọn vị trí Bot muốn gỡ.');
                        const player = seats[body.seat - 1];
                        if (!player?.isBot) fail(409, 'Vị trí này không có Bot.');
                        room.players = room.players.filter(entry => entry.userId !== player.userId);
                        seats[body.seat - 1] = null;
                    } else {
                        const target = body.seat == null ? seats.indexOf(null) : body.seat - 1;
                        if (target < 0 || target >= room.capacity || seats[target]) fail(409, 'Hãy chọn một vị trí trống để thêm Bot.');
                        const available = botProfiles.filter(profile => (!body.botId || profile.id === body.botId)
                            && !room.players.some(player => player.botProfileId === profile.id));
                        const profile = available.length ? available[body.botId ? 0 : crypto.randomInt(available.length)] : null;
                        if (!profile) fail(409, 'Bot này đang có trong phòng. Hãy chọn Bot khác.');
                        const player = { userId: `web-bot:${room.id}:${profile.id}`, displayName: profile.name,
                            avatar: profile.avatar, isBot: true, botProfileId: profile.id };
                        room.players.push(player); seats[target] = player;
                    }
                    saveSeats(room, seats);
                } else if (action === 'leave') {
                    if (!current || room.hostId === owner.userId) fail(409, 'Chủ phòng hãy dùng Hủy phòng; chỉ thành viên đang tham gia mới có thể rời.');
                    room.players = room.players.filter(player => player.userId !== owner.userId);
                    saveSeats(room, seatsFor(room).map(player => player?.userId === owner.userId ? null : player));
                } else if (action === 'cancel') {
                    if (room.hostId !== owner.userId) fail(403, 'Chỉ chủ phòng được hủy Battle.');
                    room.status = 'cancelled'; room.finishedAt = Date.now();
                } else if (action === 'start') {
                    if (room.hostId !== owner.userId) fail(403, 'Chỉ chủ phòng được bắt đầu Battle.');
                    if (room.players.length !== room.capacity) fail(409, 'Phòng chưa đủ người.');
                    const fresh = freshPrices(room);
                    if (fresh.fee !== room.fee || digest(fresh.pricesByCase) !== digest(room.pricesByCase)) fail(409, 'Giá Battle đã thay đổi. Chưa trừ xu; hãy tạo phòng mới.');
                    if (room.players.some(player => !player.isBot && wallet.getCoinBalance(state, player.userId) < BigInt(room.fee))) fail(409, 'Một người chơi không còn đủ xu. Chưa trừ xu của ai.');
                    settle(room, state);
                    settled = true;
                } else fail(400, 'Thao tác Battle không hợp lệ.');
            }
            remember(state, room);
            const balance = wallet.getCoinBalance(state, owner.userId);
            const result = { room: publicRoom(room, owner), balance: balance.toString(), balanceFormatted: formatCoins(balance), replayed };
            saveReceipt(state, stash, key, result, `battle-${action}`);
            await save(); saved = state;
            return result;
        }, scope);
        if (saved && settled) updateBoard(guild, saved, scope);
        return result;
    }
    return { battleList: list, battleDetail: detail, battleCreate: create,
        battleJoin: (owner, id, body) => act(owner, id, 'join', body), battleLeave: (owner, id, body) => act(owner, id, 'leave', body),
        battleCancel: (owner, id, body) => act(owner, id, 'cancel', body), battleStart: (owner, id, body) => act(owner, id, 'start', body),
        battleSeat: (owner, id, body) => act(owner, id, 'seat', body), battleBot: (owner, id, body) => act(owner, id, 'bot', body) };
}

module.exports = { createPlayerBattles, verifyRoom, MAX_ROUNDS, LIFETIME };
