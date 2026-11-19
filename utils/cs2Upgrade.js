const crypto = require('node:crypto');
const { containers, containersById, skins } = require('./cs2Catalogue');
const { wearNames, wearBounds } = require('./cs2MarketNames');
const { MAX_PAINT_SEED } = require('./cs2Patterns');
const market = require('./cs2Market');
const store = require('./managementStore');
const { COIN_SCALE, serializeCoins } = require('./coins');
const wallet = require('../commands/taixiu');

// Ownership and request-size checks bound selections; the whole inventory may be used.
const MAX_INPUTS = Number.MAX_SAFE_INTEGER;
const PENDING_TTL_MS = 5 * 60_000;
const HISTORY_LIMIT = 30;
const TICKETS = 100_000;
const MIN_WIN_TICKETS = 1_000;
const MAX_WIN_TICKETS = 90_000;
const RTP_TICKETS = 95_000;
const FLOAT_SCALE = 1_000_000;
const VERSION = 1;
const discordId = /^[1-9]\d{0,19}$/;
const targetById = new Map();
let catalogue;

function targetCatalogue() {
    if (catalogue) return catalogue;
    const byQuote = new Map();
    for (const weaponCase of containers) {
        for (const [tier, pool] of weaponCase.pools.entries()) {
            for (const skinId of pool) {
                const skin = skins[skinId];
                if (!skin) continue;
                const vanilla = skin.min == null && skin.max == null;
                if (!vanilla && (!Number.isFinite(skin.min) || !Number.isFinite(skin.max) || skin.min > skin.max)) continue;
                const skinMin = vanilla ? null : Math.round(skin.min * FLOAT_SCALE);
                const skinMax = vanilla ? null : Math.round(skin.max * FLOAT_SCALE);
                for (let exterior = 0; exterior < (vanilla ? 1 : wearNames.length); exterior++) {
                    const min = vanilla ? null : Math.max(skinMin, Math.round(wearBounds[exterior] * FLOAT_SCALE));
                    const max = vanilla ? null : Math.min(skinMax,
                        Math.round(wearBounds[exterior + 1] * FLOAT_SCALE) - (exterior === wearNames.length - 1 ? 0 : 1));
                    if (!vanilla && min > max) continue;
                    for (const statTrak of skin.stattrak ? [false, true] : [false]) {
                        const drop = { caseId: weaponCase.id, skinId, tier, float: vanilla ? null : min / FLOAT_SCALE, statTrak };
                        const ref = market.getDropMarketQuoteRef(drop);
                        if (!ref) continue;
                        const key = market.marketQuoteKey(ref.name, ref.phase);
                        if (byQuote.has(key)) continue;
                        const id = crypto.createHash('sha256').update(`upgrade-v1\0${key}`).digest('hex').slice(0, 20);
                        const target = Object.freeze({ id, caseId: weaponCase.id, skinId, tier, statTrak,
                            exterior: vanilla ? null : exterior, wear: vanilla ? null : wearNames[exterior],
                            minFloat: vanilla ? null : min / FLOAT_SCALE, maxFloat: vanilla ? null : max / FLOAT_SCALE,
                            name: ref.name, phase: ref.phase, image: skin.image,
                            marketRef: Object.freeze({ ...ref }), drop: Object.freeze(drop) });
                        byQuote.set(key, target);
                        targetById.set(id, target);
                    }
                }
            }
        }
    }
    catalogue = Object.freeze([...byQuote.values()]);
    return catalogue;
}

function getTarget(id) {
    targetCatalogue();
    return typeof id === 'string' ? targetById.get(id) ?? null : null;
}

function legitimateDrop(drop) {
    if (!drop || typeof drop.id !== 'string' || !drop.id || drop.id.length > 100 ||
        !Number.isInteger(drop.tier) || drop.tier < 0 || drop.tier > 4 ||
        (drop.statTrak != null && typeof drop.statTrak !== 'boolean')) return false;
    const weaponCase = containersById.get(drop.caseId);
    if (!weaponCase?.pools[drop.tier]?.includes(drop.skinId)) return false;
    if (drop.float != null && drop.float !== Math.round(drop.float * FLOAT_SCALE) / FLOAT_SCALE) return false;
    if (drop.paintSeed != null && (!Number.isInteger(drop.paintSeed) || drop.paintSeed < 0 || drop.paintSeed > MAX_PAINT_SEED)) return false;
    return market.getDropMarketQuoteRef(drop) !== null;
}

function eligibleInputs(stash) {
    const drops = Array.isArray(stash?.drops) ? stash.drops : [];
    const counts = new Map();
    for (const drop of drops) counts.set(drop?.id, (counts.get(drop?.id) ?? 0) + 1);
    return drops.filter(drop => drop?.locked !== true && counts.get(drop?.id) === 1 && legitimateDrop(drop));
}

function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    return value;
}

function inputSignature(drops) {
    const ordered = drops.toSorted((left, right) => left.id.localeCompare(right.id));
    return crypto.createHash('sha256').update(JSON.stringify(canonical(ordered))).digest('hex');
}

function freshPrice(ref, now) {
    const quote = market.peekMarketQuote(ref.name, ref);
    const source = ref.paintSeed == null ? 'buff' : 'csfloat';
    if (!quote || quote.source !== source || (quote.phase ?? null) !== ref.phase ||
        (quote.paintSeed ?? null) !== (ref.paintSeed ?? null) ||
        !Number.isSafeInteger(quote.priceVnd) || quote.priceVnd <= 0 ||
        !Number.isSafeInteger(quote.observedAt) || quote.observedAt > now ||
        !Number.isSafeInteger(quote.expiresAt) || quote.expiresAt <= now) return null;
    return { name: ref.name, phase: ref.phase, priceVnd: quote.priceVnd,
        ...(ref.paintSeed == null ? {} : { paintSeed: ref.paintSeed, source }),
        observedAt: quote.observedAt, expiresAt: quote.expiresAt };
}

const validStartTicket = value => Number.isInteger(value) && value >= 0 && value < TICKETS;

function preview({ drops = [], targetId, coinStake = 0n, startTicket } = {}, now = Date.now()) {
    if (!Array.isArray(drops) || drops.length > MAX_INPUTS || new Set(drops.map(drop => drop?.id)).size !== drops.length) {
        return { status: 'invalid-inputs' };
    }
    if (drops.some(drop => drop?.locked === true)) return { status: 'locked' };
    if (drops.some(drop => !legitimateDrop(drop))) return { status: 'invalid-inputs' };
    if (typeof coinStake !== 'bigint' || coinStake < 0n) return { status: 'invalid-stake' };
    if (startTicket !== undefined && !validStartTicket(startTicket)) return { status: 'invalid-start-ticket' };
    const target = getTarget(targetId);
    if (!target) return { status: 'invalid-target' };
    const prices = { inputs: [], target: freshPrice(target.marketRef, now) };
    if (!prices.target) return { status: 'missing-price' };
    let inputValue = 0n;
    for (const drop of drops) {
        const quote = freshPrice(market.getDropMarketQuoteRef(drop), now);
        if (!quote) return { status: 'missing-price' };
        inputValue += BigInt(quote.priceVnd) * COIN_SCALE;
        prices.inputs.push({ id: drop.id, ...quote });
    }
    const stake = inputValue + coinStake;
    const targetValue = BigInt(prices.target.priceVnd) * COIN_SCALE;
    if (stake <= 0n) return { status: 'invalid-stake' };
    if (targetValue <= stake) return { status: 'target-too-cheap' };
    const calculated = stake * BigInt(RTP_TICKETS) / targetValue;
    const winTickets = Number(calculated > BigInt(MAX_WIN_TICKETS) ? BigInt(MAX_WIN_TICKETS) : calculated);
    if (winTickets < MIN_WIN_TICKETS) return { status: 'chance-too-low' };
    return { status: 'ready', inputValue, coinStake, stake, targetValue, winTickets,
        ...(startTicket === undefined ? {} : { startTicket }),
        chance: winTickets / 1_000, multiplier: Number(targetValue) / Number(stake),
        signature: inputSignature(drops), prices, target };
}

function samePrices(left, right) {
    if (!left || !right || !Array.isArray(left.inputs) || !Array.isArray(right.inputs) || left.inputs.length !== right.inputs.length) return false;
    if (!left.target || !right.target || [...left.inputs, ...right.inputs].some(quote => typeof quote?.id !== 'string')) return false;
    const amount = quote => [quote?.name, quote?.phase ?? null, quote?.paintSeed ?? null,
        quote?.source ?? 'buff', quote?.priceVnd];
    const inputs = quotes => quotes.toSorted((a, b) => a.id.localeCompare(b.id)).map(quote => [quote.id, ...amount(quote)]);
    return JSON.stringify([amount(left.target), inputs(left.inputs)]) === JSON.stringify([amount(right.target), inputs(right.inputs)]);
}

const scopeFor = userId => ({ wallets: [userId], inventory: [userId] });
const validOwner = (guildId, userId) => typeof guildId === 'string' && discordId.test(guildId) &&
    typeof userId === 'string' && discordId.test(userId);
const validClient = seed => typeof seed === 'string' && seed.length > 0 && seed.length <= 128 && seed.isWellFormed() && !/[\x00-\x1f\x7f]/.test(seed);
const commitment = (serverSeed, salt) => crypto.createHmac('sha256', salt).update(serverSeed).digest('hex');

function publicAttempt(attempt) {
    if (!attempt) return null;
    const { serverSeed, salt, ...publicFields } = attempt;
    return structuredClone(publicFields);
}

function ownedInputs(stash, inputIds) {
    if (!Array.isArray(inputIds) || inputIds.length > MAX_INPUTS || inputIds.some(id => typeof id !== 'string' || !id) ||
        new Set(inputIds).size !== inputIds.length) return null;
    const selected = new Set(inputIds);
    const drops = (stash?.drops ?? []).filter(drop => selected.has(drop.id));
    return drops.length === inputIds.length && new Set(drops.map(drop => drop.id)).size === drops.length ? drops : null;
}

async function prepare(guildId, userId, {
    inputIds = [], targetId, coinStake = 0n, clientSeed = userId, direction = 'under', startTicket, expectedSignature, expectedPrices
} = {}) {
    if (!validOwner(guildId, userId)) return { status: 'invalid-request' };
    if (!validClient(clientSeed)) return { status: 'invalid-client-seed' };
    if (!['under', 'over'].includes(direction)) return { status: 'invalid-direction' };
    if (startTicket !== undefined && !validStartTicket(startTicket)) return { status: 'invalid-start-ticket' };
    return store.transact(guildId, async (state, save) => {
        const now = Date.now();
        const stash = state.skinCases?.[userId];
        const drops = ownedInputs(stash, inputIds);
        if (!drops) return { status: 'stale-inputs' };
        const plan = preview({ drops, targetId, coinStake, startTicket }, now);
        if (plan.status !== 'ready') return { status: plan.status };
        if (expectedSignature != null && expectedSignature !== plan.signature) return { status: 'stale-inputs' };
        if (expectedPrices != null && !samePrices(plan.prices, expectedPrices)) return { status: 'price-changed' };
        if (wallet.getCoinBalance(state, userId) < coinStake) return { status: 'insufficient-funds' };
        const inventory = (state.skinCases ??= {})[userId] ??= {};
        const upgrade = inventory.upgrade ??= { nextNonce: 1, lastSettledNonce: 0, history: [] };
        const previous = upgrade.pending;
        if (previous && previous.expiresAt > now && previous.signature === plan.signature &&
            previous.targetId === targetId && previous.coinStake === coinStake.toString() &&
            previous.direction === direction && previous.startTicket === startTicket &&
            previous.clientSeed === clientSeed && samePrices(previous.prices, plan.prices)) {
            return { status: 'prepared', attempt: publicAttempt(previous) };
        }
        const nonce = upgrade.nextNonce;
        if (!Number.isSafeInteger(nonce) || nonce < 1 || nonce >= Number.MAX_SAFE_INTEGER || nonce <= (upgrade.lastSettledNonce ?? 0)) {
            return { status: 'invalid-state' };
        }
        const serverSeed = crypto.randomBytes(32).toString('hex');
        const salt = crypto.randomBytes(32).toString('hex');
        const attempt = { version: VERSION, id: crypto.randomUUID(), guildId, userId, nonce,
            createdAt: now, expiresAt: now + PENDING_TTL_MS, direction, clientSeed,
            ...(startTicket === undefined ? {} : { startTicket }),
            hash: commitment(serverSeed, salt), serverSeed, salt,
            inputIds: [...inputIds], inputs: structuredClone(drops), targetId, target: structuredClone(plan.target),
            inputValue: plan.inputValue.toString(), coinStake: coinStake.toString(), stake: plan.stake.toString(),
            targetValue: plan.targetValue.toString(), winTickets: plan.winTickets,
            chance: plan.chance, multiplier: plan.multiplier, signature: plan.signature, prices: plan.prices };
        upgrade.nextNonce = nonce + 1;
        upgrade.pending = attempt;
        await save();
        return { status: 'prepared', attempt: publicAttempt(attempt) };
    }, scopeFor(userId));
}

async function updateClientSeed(guildId, userId, attemptId, seed) {
    if (!validOwner(guildId, userId) || typeof attemptId !== 'string' || !attemptId) return { status: 'invalid-request' };
    if (!validClient(seed)) return { status: 'invalid-client-seed' };
    return store.transact(guildId, async (state, save) => {
        const attempt = state.skinCases?.[userId]?.upgrade?.pending;
        if (!attempt || attempt.id !== attemptId) return { status: 'not-found' };
        if (attempt.guildId !== guildId || attempt.userId !== userId) return { status: 'invalid-state' };
        if (attempt.expiresAt <= Date.now()) return { status: 'expired' };
        attempt.clientSeed = seed;
        await save();
        return { status: 'updated', attempt: publicAttempt(attempt) };
    }, scopeFor(userId));
}

function fairTicket(serverSeed, clientSeed, nonce) {
    const digest = crypto.createHmac('sha512', `${clientSeed}-${nonce}`).update(serverSeed).digest('hex');
    return Number(BigInt(`0x${digest.slice(0, 15)}`) % BigInt(TICKETS)) + 1;
}

function seededInteger(attempt, domain, bound) {
    const size = BigInt(bound);
    const range = 1n << 64n;
    const limit = range - range % size;
    for (let cursor = 0; ; cursor++) {
        const message = JSON.stringify(['cs2-upgrade-v1', attempt.clientSeed, attempt.nonce, domain, cursor]);
        const digest = crypto.createHmac('sha256', attempt.serverSeed).update(message).digest('hex');
        const value = BigInt(`0x${digest.slice(0, 16)}`);
        if (value < limit) return Number(value % size);
    }
}

function outputDrop(attempt, acquiredAt) {
    const target = getTarget(attempt.targetId);
    const min = target.minFloat == null ? null : Math.round(target.minFloat * FLOAT_SCALE);
    const max = target.maxFloat == null ? null : Math.round(target.maxFloat * FLOAT_SCALE);
    const float = min == null ? null : (min + seededInteger(attempt, 'float', max - min + 1)) / FLOAT_SCALE;
    return { ...target.drop, float, ...(float == null ? {} : { paintSeed: seededInteger(attempt, 'paint-seed', MAX_PAINT_SEED + 1) }),
        id: `${attempt.id}-upgrade`, acquiredAt, inventoryRevision: attempt.id, upgrade: true, upgradeAttemptId: attempt.id };
}

function wonTicket(ticket, winTickets, direction, startTicket) {
    const start = startTicket ?? (direction === 'over' ? TICKETS - winTickets : 0);
    return (ticket - 1 - start + TICKETS) % TICKETS < winTickets;
}

async function settle(guild, userId, attemptId, { expectedClientSeed, expectedHash, onSettled } = {}) {
    const guildId = typeof guild === 'string' ? guild : guild?.id;
    if (!validOwner(guildId, userId) || typeof attemptId !== 'string' || !attemptId) return { status: 'invalid-request' };
    let savedState;
    const scope = scopeFor(userId);
    const result = await store.transact(guildId, async (state, save) => {
        const now = Date.now();
        const stash = state.skinCases?.[userId];
        const upgrade = stash?.upgrade;
        const completed = upgrade?.history?.find(receipt => receipt.id === attemptId);
        if (completed) return { status: 'duplicate', receipt: structuredClone(completed) };
        const attempt = upgrade?.pending;
        if (!attempt || attempt.id !== attemptId) return { status: 'not-found' };
        if ((expectedClientSeed !== undefined && expectedClientSeed !== attempt.clientSeed) ||
            (expectedHash !== undefined && expectedHash !== attempt.hash)) return { status: 'stale-confirmation' };
        if (attempt.guildId !== guildId || attempt.userId !== userId || attempt.nonce <= upgrade.lastSettledNonce) return { status: 'invalid-state' };
        if (!['under', 'over'].includes(attempt.direction) ||
            (attempt.startTicket !== undefined && !validStartTicket(attempt.startTicket))) return { status: 'invalid-state' };
        if (attempt.expiresAt <= now) return { status: 'expired' };
        const drops = ownedInputs(stash, attempt.inputIds);
        if (!drops) return { status: 'stale-inputs' };
        if (drops.some(drop => drop.locked === true)) return { status: 'locked' };
        if (inputSignature(drops) !== attempt.signature) return { status: 'stale-inputs' };
        const plan = preview({ drops, targetId: attempt.targetId, coinStake: BigInt(attempt.coinStake) }, now);
        if (plan.status !== 'ready') return { status: plan.status };
        if (!samePrices(plan.prices, attempt.prices) || plan.winTickets !== attempt.winTickets) return { status: 'price-changed' };
        const current = wallet.getCoinBalance(state, userId);
        if (current < plan.coinStake) return { status: 'insufficient-funds' };
        const ticket = fairTicket(attempt.serverSeed, attempt.clientSeed, attempt.nonce);
        const won = wonTicket(ticket, attempt.winTickets, attempt.direction, attempt.startTicket);
        const drop = won ? outputDrop(attempt, now) : null;
        const receipt = { ...publicAttempt(attempt), prices: plan.prices, serverSeed: attempt.serverSeed, salt: attempt.salt,
            at: now, ticket, won, drop };
        const consumed = new Set(attempt.inputIds);
        stash.drops = (stash.drops ?? []).filter(item => !consumed.has(item.id));
        if (drop) stash.drops.push(drop);
        const balance = current - plan.coinStake;
        if (plan.coinStake > 0n) state.taixiu.balances[userId] = serializeCoins(balance);
        upgrade.lastSettledNonce = attempt.nonce;
        upgrade.history = [receipt, ...(upgrade.history ?? [])].slice(0, HISTORY_LIMIT);
        delete upgrade.pending;
        if (typeof onSettled === 'function') onSettled(state, { receipt, drop });
        await save();
        savedState = state;
        return { status: 'settled', receipt: structuredClone(receipt), drop, balance };
    }, scope);
    if (savedState && guild?.channels?.cache) {
        try { wallet.refreshCoinLeaderboard(guild, savedState, scope); }
        catch (error) { console.error('Lỗi cập nhật bảng xếp hạng sau Upgrade:', error.message); }
    }
    return result;
}

async function pending(guildId, userId) {
    if (!validOwner(guildId, userId)) return null;
    const state = await store.read(guildId, { inventory: [userId] });
    const attempt = state.skinCases?.[userId]?.upgrade?.pending;
    return attempt && attempt.expiresAt > Date.now() ? publicAttempt(attempt) : null;
}

async function history(guildId, userId) {
    if (!validOwner(guildId, userId)) return [];
    const state = await store.read(guildId, { inventory: [userId] });
    return structuredClone(state.skinCases?.[userId]?.upgrade?.history ?? []);
}

function verify(receipt) {
    try {
        if (!receipt || receipt.version !== VERSION || typeof receipt.serverSeed !== 'string' || !receipt.serverSeed ||
            typeof receipt.salt !== 'string' || !receipt.salt || !validClient(receipt.clientSeed) ||
            !validOwner(receipt.guildId, receipt.userId) || !Number.isSafeInteger(receipt.at) ||
            receipt.at < receipt.createdAt || receipt.at >= receipt.expiresAt ||
            !Number.isSafeInteger(receipt.nonce) || receipt.nonce < 1 || !['under', 'over'].includes(receipt.direction) ||
            (receipt.startTicket !== undefined && !validStartTicket(receipt.startTicket)) ||
            !Number.isInteger(receipt.winTickets) || receipt.winTickets < MIN_WIN_TICKETS || receipt.winTickets > MAX_WIN_TICKETS ||
            commitment(receipt.serverSeed, receipt.salt) !== receipt.hash) return false;
        const ticket = fairTicket(receipt.serverSeed, receipt.clientSeed, receipt.nonce);
        if (ticket !== receipt.ticket || wonTicket(ticket, receipt.winTickets, receipt.direction, receipt.startTicket) !== receipt.won) return false;
        const target = getTarget(receipt.targetId);
        if (!target || JSON.stringify(canonical(receipt.target)) !== JSON.stringify(canonical(target)) ||
            !Array.isArray(receipt.inputs) || receipt.inputs.length > MAX_INPUTS ||
            receipt.inputs.some(drop => drop.locked === true || !legitimateDrop(drop)) ||
            !Array.isArray(receipt.inputIds) || receipt.inputIds.length !== receipt.inputs.length ||
            new Set(receipt.inputIds).size !== receipt.inputs.length ||
            !Array.isArray(receipt.prices?.inputs) || receipt.prices.inputs.length !== receipt.inputs.length) return false;
        if (receipt.signature !== inputSignature(receipt.inputs)) return false;
        const inputIds = new Set(receipt.inputIds);
        if (receipt.inputs.some(drop => !inputIds.has(drop.id))) return false;
        const sameRef = (quote, ref) => quote?.name === ref.name && (quote.phase ?? null) === ref.phase &&
            (quote.paintSeed ?? null) === (ref.paintSeed ?? null) &&
            (quote.source ?? 'buff') === (ref.paintSeed == null ? 'buff' : 'csfloat');
        if (!sameRef(receipt.prices.target, target.marketRef)) return false;
        const quotesById = new Map(receipt.prices.inputs.map(quote => [quote.id, quote]));
        const priceIds = new Set();
        for (const drop of receipt.inputs) {
            const quote = quotesById.get(drop.id);
            if (!sameRef(quote, market.getDropMarketQuoteRef(drop)) || priceIds.has(quote.id)) return false;
            priceIds.add(quote.id);
        }
        if ([receipt.prices.target, ...receipt.prices.inputs].some(quote =>
            !Number.isSafeInteger(quote.priceVnd) || quote.priceVnd <= 0 ||
            !Number.isSafeInteger(quote.observedAt) || quote.observedAt > receipt.at ||
            !Number.isSafeInteger(quote.expiresAt) || quote.expiresAt <= receipt.at)) return false;
        if (['stake', 'targetValue', 'coinStake', 'inputValue'].some(field =>
            typeof receipt[field] !== 'string' || !/^(0|[1-9]\d{0,39})$/.test(receipt[field]))) return false;
        const stake = BigInt(receipt.stake), targetValue = BigInt(receipt.targetValue);
        const inputValue = receipt.prices.inputs.reduce((sum, quote) => sum + BigInt(quote.priceVnd) * COIN_SCALE, 0n);
        if (stake <= 0n || targetValue <= stake || BigInt(receipt.coinStake) < 0n || BigInt(receipt.inputValue) !== inputValue ||
            stake !== inputValue + BigInt(receipt.coinStake) || targetValue !== BigInt(receipt.prices.target.priceVnd) * COIN_SCALE) return false;
        const calculated = stake * BigInt(RTP_TICKETS) / targetValue;
        const winTickets = Number(calculated > BigInt(MAX_WIN_TICKETS) ? BigInt(MAX_WIN_TICKETS) : calculated);
        if (winTickets !== receipt.winTickets) return false;
        if (receipt.won) return JSON.stringify(canonical(receipt.drop)) === JSON.stringify(canonical(outputDrop(receipt, receipt.at)));
        return receipt.drop === null;
    } catch { return false; }
}

module.exports = { MAX_INPUTS, PENDING_TTL_MS, HISTORY_LIMIT, TICKETS, MIN_WIN_TICKETS, MAX_WIN_TICKETS,
    RTP_TICKETS, targetCatalogue, getTarget, eligibleInputs, preview, prepare, updateClientSeed, settle, pending, history, verify,
    fairTicket, commitment };
