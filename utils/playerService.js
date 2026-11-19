const crypto = require('node:crypto');
const { setImmediate: yieldEventLoop } = require('node:timers/promises');
const { canFitCaseOpening, CAPACITY_NOTICE } = require('./caseOpeningCapacity');
const store = require('./managementStore');
const wallet = require('../commands/taixiu');
const market = require('./cs2Market');
const playerMarket = require('./cs2PlayerMarket');
const upgradeEngine = require('./cs2Upgrade');
const casesEngine = require('./cs2BattleCases');
const standard = require('./cs2NormalCases');
const { describeExclusive, rollExclusiveCase } = require('./playerExclusiveDrop');
const { caseDescription } = require('./cs2CasePresentation');
const { cases: standardCases, skins } = require('./cs2Catalogue');
const { getCaseMarketHashName, wearNames, wearBounds, wearIndex } = require('./cs2MarketNames');
const { getPlayerSkinImage, getPlayerTargetImage } = require('./playerAssets');
const { COIN_SCALE, parseCoins, serializeCoins, formatCoins, decimalCoins } = require('./coins');
const { isGuildAllowed } = require('./guildUtils');

const REQUEST_LIMIT = 5000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^[1-9]\d{0,19}$/;
const HASH = /^[a-f0-9]{64}$/;
const STANDARD_QUOTE = /^(\d{13})\.([a-f0-9]{64})$/;
const STANDARD_QUOTE_TTL = 120_000;
const standardCasesById = standard.normalCasesById;
const rarity = [ ['Mil-Spec', '#4b69ff'], ['Restricted', '#8847ff'], ['Classified', '#d32ce6'], ['Covert', '#eb4b4b'], ['Rare Special Item', '#e4ae39'] ];
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const scopeFor = userId => ({ wallets: [userId], inventory: [userId] });
const safeImage = value => {
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; }
    catch { return null; }
};

function freshQuote(ref) {
    if (!ref) return null;
    const quote = market.peekMarketQuote(ref.name, ref);
    const now = Date.now();
    return quote && quote.source === (ref.paintSeed == null ? 'buff' : 'csfloat') &&
        (quote.phase ?? null) === (ref.phase ?? null) && (quote.paintSeed ?? null) === (ref.paintSeed ?? null) &&
        Number.isSafeInteger(quote.priceVnd) && quote.priceVnd > 0 &&
        Number.isSafeInteger(quote.observedAt) && quote.observedAt <= now &&
        Number.isSafeInteger(quote.expiresAt) && quote.expiresAt > now ? quote : null;
}

function dropImage(drop) {
    return getPlayerSkinImage(drop);
}

function itemDTO(drop, overrideValue, eligible = false) {
    const skin = skins[drop.skinId];
    const tier = Number.isInteger(drop.tier) && drop.tier >= 0 && drop.tier < rarity.length ? drop.tier : 0;
    const [label, color] = skin?.rarity === 'Contraband' ? ['Contraband', '#e4ae39'] : rarity[tier];
    const quote = overrideValue === undefined ? freshQuote(market.getDropMarketQuoteRef(drop)) : null;
    const value = overrideValue === undefined ? (quote ? BigInt(quote.priceVnd) * COIN_SCALE : null) : overrideValue;
    return { id: drop.id ?? null, skinId: drop.skinId, name: `${drop.statTrak ? 'StatTrak™ ' : ''}${skin?.name ?? 'Skin'}${skin?.phase ? ` · ${skin.phase}` : ''}`,
        image: dropImage(drop), tier, rarity: label, color,
        weapon: skin?.name?.split(' | ')[0] ?? null, finish: skin?.name?.split(' | ').slice(1).join(' | ') || null,
        phase: skin?.phase ?? null,
        paintSeed: Number.isInteger(drop.paintSeed) && drop.paintSeed >= 0 && drop.paintSeed <= 1000 ? drop.paintSeed : null,
        priceVariant: drop.priceVariant === 'blue-gem' ? 'blue-gem' : null,
        wear: drop.float == null ? null : wearNames[wearIndex(drop.float)], float: drop.float ?? null,
        statTrak: drop.statTrak === true, locked: drop.locked === true, exclusiveDrop: drop.exclusiveDrop === true,
        value: value == null ? null : value.toString(), valueFormatted: value == null ? 'Chưa có giá' : formatCoins(value),
        upgradeEligible: eligible && drop.locked !== true && value != null,
        acquiredAt: Number.isSafeInteger(drop.acquiredAt) ? drop.acquiredAt : null };
}

function standardSkinPrice(skinId) {
    const skin = skins[skinId];
    if (!skin) return { valueFormatted: 'Chưa có giá', priceNote: null };
    const variants = [];
    const vanilla = skin.min == null && skin.max == null;
    const addVariants = (float, wear) => {
        for (const statTrak of skin.stattrak ? [false, true] : [false]) {
            const quote = freshQuote(market.getDropMarketQuoteRef({ skinId, float, statTrak }));
            if (quote) variants.push({ wear, statTrak, price: BigInt(quote.priceVnd) * COIN_SCALE });
        }
    };
    if (vanilla) {
        addVariants(null, null);
    } else if (Number.isFinite(skin.min) && Number.isFinite(skin.max) && skin.min <= skin.max) {
        const scale = 1_000_000;
        const skinMin = Math.round(skin.min * scale), skinMax = Math.round(skin.max * scale);
        for (let exterior = 0; exterior < wearNames.length; exterior++) {
            const min = Math.max(skinMin, Math.round(wearBounds[exterior] * scale));
            const max = Math.min(skinMax, Math.round(wearBounds[exterior + 1] * scale) - (exterior === wearNames.length - 1 ? 0 : 1));
            if (min > max) continue;
            addVariants(min / scale, wearNames[exterior]);
        }
    }
    if (!variants.length) return { valueFormatted: 'Chưa có giá', priceNote: null };
    const description = variants.map(({ wear, statTrak, price }) =>
        `${statTrak ? 'StatTrak™ · ' : ''}${wear ?? 'Không phân loại'}: ${formatCoins(price)}`).join(' · ');
    const values = variants.map(variant => variant.price).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    const valueFormatted = values[0] === values.at(-1) ? formatCoins(values[0])
        : `${formatCoins(values[0])} – ${formatCoins(values.at(-1))}`;
    return { valueFormatted, priceNote: `Giá thị trường theo độ mòn: ${description}` };
}

function casePrices() {
    const cached = new Map();
    return entry => {
        const key = market.marketQuoteKey(entry.ref.name, entry.ref.phase, entry.ref.paintSeed);
        if (!cached.has(key)) cached.set(key, freshQuote(entry.ref)?.priceVnd ?? null);
        return cached.get(key);
    };
}
function pricingFor(item) { return casesEngine.casePricing(item, casePrices()); }
function quoteIdFor(pricing) { return digest({ fee: pricing.fee.toString(), pricing: casesEngine.lockCasePricing(pricing) }); }
function caseDTO(item, pricing) {
    return { id: item.id, name: item.name, description: caseDescription(item, pricing, { showGold: true }), group: item.group,
        image: `/play/art/${item.artId ?? item.id}.png`, available: Boolean(pricing),
        fee: pricing?.fee.toString() ?? null, feeFormatted: pricing ? formatCoins(pricing.fee) : 'Chờ đồng bộ giá',
        entryCount: pricing?.entries.length ?? item.entries.length, riskLabel: pricing?.riskLabel ?? 'Chưa có giá' };
}

function standardCaseQuote(item) {
    const name = getCaseMarketHashName(item.id);
    return name ? freshQuote({ name }) : null;
}

function stockCount(value) {
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function standardCaseDTO(item, quote) {
    const keyPrice = BigInt(standard.KEY_PRICE_AMOUNT) * COIN_SCALE;
    const casePrice = quote ? BigInt(quote.priceVnd) * COIN_SCALE : null;
    const fee = casePrice == null ? null : casePrice + keyPrice;
    const rarities = standard.tiers.map(({ name, color, weight }, tier) => ({ tier, name, color, chance: 100 * weight / standard.TICKETS }));
    return { id: item.id, name: item.name, kind: 'standard', group: 'standard', image: safeImage(item.image),
        description: 'Hòm thường từ Discord. Mỗi lượt dùng một hòm và một chìa tương ứng.',
        available: fee != null, fee: fee?.toString() ?? null, feeFormatted: fee == null ? 'Chờ giá hòm' : formatCoins(fee),
        keyId: item.key, keyPrice: keyPrice.toString(), keyPriceFormatted: formatCoins(keyPrice),
        casePrice: casePrice?.toString() ?? null, casePriceFormatted: casePrice == null ? null : formatCoins(casePrice),
        entryCount: item.pools.reduce((total, pool) => total + pool.length, 0), riskLabel: 'Hòm thường', rarities };
}

function standardCheckout(item, stash, count) {
    const ownedCases = Math.min(count, stockCount(stash?.cases?.[item.id]));
    const ownedKeys = Math.min(count, stockCount(stash?.keys?.[item.key]));
    const missingCases = count - ownedCases, missingKeys = count - ownedKeys;
    const price = missingCases ? standardCaseQuote(item) : null;
    if (missingCases && !price) fail(409, 'Chưa có giá hòm còn hạn. Bạn vẫn có thể mở hòm đã có trong kho.');
    const fee = (BigInt(price?.priceVnd ?? 0) * BigInt(missingCases) + BigInt(standard.KEY_PRICE_AMOUNT) * BigInt(missingKeys)) * COIN_SCALE;
    return { ownedCases, ownedKeys, missingCases, missingKeys, price, fee };
}

const engineMessages = {
    'stale-inputs': 'Kho đồ đã thay đổi. Hãy chọn lại skin.', locked: 'Skin đang khóa. Hãy mở khóa trước.',
    'price-changed': 'Giá vừa thay đổi. Hãy xem và xác nhận lại.', 'missing-price': 'Một skin chưa có giá còn hạn. Vui lòng chờ đồng bộ.',
    'insufficient-funds': 'Ví không đủ xu.', expired: 'Lượt xác nhận đã hết hạn. Hãy chuẩn bị lại.',
    'stale-confirmation': 'Thông tin lượt chờ đã đổi. Hãy tải lại trước khi xác nhận.', 'not-found': 'Không tìm thấy lượt chờ. Kiểm tra lịch sử trước khi thử lại.',
    'target-too-cheap': 'Mục tiêu phải có giá cao hơn tổng giá trị nguyên liệu.', 'chance-too-low': 'Tỷ lệ thấp hơn 1%. Hãy tăng nguyên liệu hoặc chọn mục tiêu khác.',
    'invalid-inputs': 'Chọn skin hợp lệ, không trùng nhau.', 'invalid-target': 'Mục tiêu không hợp lệ.',
    'invalid-stake': 'Số xu Upgrade không hợp lệ.', 'invalid-client-seed': 'Client seed không hợp lệ.', 'invalid-direction': 'Vùng thắng không hợp lệ.',
    'invalid-start-ticket': 'Vị trí vùng thắng không hợp lệ.'
};
function checkEngine(result, accepted) {
    if (!accepted.includes(result?.status)) fail(409, engineMessages[result?.status] ?? 'Chưa thể Upgrade. Hãy tải lại và thử lại.');
    return result;
}

function publicAttempt(attempt, settled = false) {
    if (!attempt) return null;
    const value = { id: attempt.id, createdAt: attempt.createdAt, expiresAt: attempt.expiresAt, nonce: attempt.nonce,
        hash: attempt.hash, clientSeed: attempt.clientSeed, direction: attempt.direction,
        ...(attempt.startTicket === undefined ? {} : { startTicket: attempt.startTicket }), inputIds: attempt.inputIds,
        inputs: (attempt.inputs ?? []).map(drop => itemDTO(drop)), targetId: attempt.targetId,
        target: attempt.target ? targetDTO(attempt.target, BigInt(attempt.targetValue)) : null,
        inputValue: attempt.inputValue, coinStake: attempt.coinStake, stake: attempt.stake, targetValue: attempt.targetValue,
        chance: attempt.chance, winTickets: attempt.winTickets, multiplier: attempt.multiplier,
        signature: attempt.signature, prices: attempt.prices };
    if (settled) Object.assign(value, { at: attempt.at, won: attempt.won, ticket: attempt.ticket,
        drop: attempt.drop ? itemDTO(attempt.drop) : null, serverSeed: attempt.serverSeed, salt: attempt.salt,
        verified: upgradeEngine.verify(attempt) });
    return value;
}
function targetDTO(target, value) {
    return { id: target.id, name: `${target.name}${target.phase ? ` · ${target.phase}` : ''}`, image: getPlayerTargetImage(target),
        value: value.toString(), valueFormatted: formatCoins(value), wear: target.wear, tier: target.tier };
}

function createPlayerService({ client, isShuttingDown = () => false } = {}) {
    let catalogueCache, catalogueAt = 0;
    let activityRecorder = null;
    const actionFlights = new Map();
    const standardQuoteKey = crypto.randomBytes(32);
    function running() { if (isShuttingDown()) fail(503, 'Bot đang khởi động lại. Vui lòng thử lại sau.'); }
    async function ownerGuild(owner, mutation = false) {
        running();
        if (!owner || !ID.test(owner.guildId ?? '') || !ID.test(owner.userId ?? '') || !isGuildAllowed(owner.guildId)) fail(403, 'Tài khoản hoặc máy chủ không được phép.');
        const guild = client.guilds.cache.get(owner.guildId);
        if (!guild || guild.available === false) fail(404, 'Máy chủ hiện không khả dụng.');
        if (mutation) {
            if (!client.isReady()) fail(503, 'Bot chưa kết nối Discord.');
            const member = await guild.members.fetch({ user: owner.userId, force: true, cache: false }).catch(error => {
                if ([10007, 10013].includes(error.code)) return null;
                throw error;
            });
            if (!member || member.user?.bot || member.user?.id !== owner.userId || (member.id != null && member.id !== owner.userId)
                || (member.guild?.id != null && member.guild.id !== owner.guildId)) fail(403, 'Bạn phải đang là thành viên của máy chủ.');
        }
        return guild;
    }
    function getCase(id) {
        const item = typeof id === 'string' && casesEngine.customCasesById.get(id);
        if (!item) fail(404, 'Không tìm thấy hòm.');
        return item;
    }
    function request(owner, body, fingerprintBody) {
        if (!UUID.test(body?.requestId ?? '')) fail(400, 'Mã yêu cầu không hợp lệ.');
        const id = body.requestId.toLowerCase();
        return { id, fingerprint: digest(fingerprintBody), section: `playerWebRequest:${owner.userId}:${id}` };
    }
    function previous(state, key) {
        const entry = state[key.section];
        if (!entry) return null;
        if (entry.fingerprint !== key.fingerprint) fail(409, 'Mã yêu cầu đã dùng cho nội dung khác.');
        return { ...structuredClone(entry.result), replayed: true };
    }
    function saveReceipt(state, stash, key, result, action) {
        checkQuota(stash);
        // Each receipt has a separately selected section. Other inventory actions
        // never load old receipts, while a retry loads exactly its own record.
        state[key.section] = { fingerprint: key.fingerprint, result: structuredClone(result), at: Date.now() };
        stash.webRequestCount = (stash.webRequestCount ?? 0) + 1;
        const summary = { requestId: key.id, action, at: Date.now(), total: result.total, balance: result.balance,
            items: (result.results ?? result.items ?? []).map(item => ({ id: item.id, name: item.name, image: item.image, tier: item.tier, value: item.value,
                exclusiveDrop: item.exclusiveDrop === true })) };
        if (result.room) {
            const labels = { 'battle-create': 'Tạo phòng Battle', 'battle-join': 'Tham gia Battle', 'battle-leave': 'Rời phòng Battle',
                'battle-cancel': 'Hủy phòng Battle', 'battle-start': 'Hoàn tất Battle',
                'battle-seat': 'Đổi chỗ Battle', 'battle-bot': 'Cập nhật bot Battle' };
            Object.assign(summary, { roomId: result.room.id, roomStatus: result.room.status,
                message: `${labels[action] ?? 'Battle'} · ${result.room.caseIds.length} vòng`,
                total: action === 'battle-start' && !result.replayed ? result.room.fee : '0' });
        }
        stash.webHistory = [summary, ...(stash.webHistory ?? [])].slice(0, 30);
    }
    function checkQuota(stash) {
        const count = stash?.webRequestCount ?? 0;
        if (!Number.isSafeInteger(count) || count < 0 || count >= REQUEST_LIMIT) fail(409, 'Tài khoản đã đạt giới hạn yêu cầu web. Liên hệ chủ bot.');
    }
    function updateBoard(guild, state, scope) {
        try { wallet.refreshCoinLeaderboard(guild, state, scope); }
        catch { console.warn('Chưa cập nhật được bảng xu sau thao tác web.'); }
    }

    function parseMarketAmount(value, label) {
        if (typeof value !== 'string' || value.length > 45) fail(400, `${label} không hợp lệ.`);
        const amount = playerMarket.parseListingPrice(value);
        if (amount == null) fail(400, `${label} phải lớn hơn 0 và tối đa hai chữ số thập phân.`);
        return amount;
    }
    function actionReplay(state, key) {
        const receipt = state[key.section];
        if (!receipt) return null;
        if (receipt.fingerprint !== key.fingerprint) fail(409, 'Mã yêu cầu đã dùng cho nội dung khác.');
        return { ...structuredClone(receipt.result), replayed: true };
    }
    async function readActionReplay(owner, key) {
        const state = await store.read(owner.guildId, { sections: [key.section] });
        return actionReplay(state, key);
    }
    async function actionOnce(owner, key, execute) {
        const id = `${owner.guildId}:${key.section}`;
        const active = actionFlights.get(id);
        if (active) {
            if (active.fingerprint !== key.fingerprint) fail(409, 'Mã yêu cầu đã dùng cho nội dung khác.');
            return { ...structuredClone(await active.pending), replayed: true };
        }
        const pending = Promise.resolve().then(execute);
        actionFlights.set(id, { fingerprint: key.fingerprint, pending });
        try { return await pending; }
        finally { if (actionFlights.get(id)?.pending === pending) actionFlights.delete(id); }
    }
    async function saveActionReplay(owner, key, result) {
        return store.transact(owner.guildId, async (state, save) => {
            const existing = actionReplay(state, key);
            if (existing) return existing;
            state[key.section] = { fingerprint: key.fingerprint, result: structuredClone(result), at: Date.now() };
            await save();
            return result;
        }, { sections: [key.section] });
    }
    function marketListingDto(guild, listing, viewerId) {
        const member = guild.members?.cache?.get?.(listing.sellerId);
        const quote = freshQuote(market.getDropMarketQuoteRef(listing.drop));
        const value = quote ? BigInt(quote.priceVnd) * COIN_SCALE : null;
        return { listingId: listing.id, sellerId: listing.sellerId,
            sellerName: String(listing.sellerName ?? member?.displayName ?? member?.user?.globalName ?? member?.user?.username ?? `Người chơi ${listing.sellerId}`).slice(0, 100),
            item: itemDTO(listing.drop, value ?? null), price: listing.price, priceFormatted: formatCoins(BigInt(listing.price), { exact: true }),
            marketValue: value?.toString() ?? null, marketValueFormatted: value == null ? 'Chưa có giá' : formatCoins(value), own: listing.sellerId === viewerId };
    }
    async function marketListings(owner, query = {}) {
        const guild = await ownerGuild(owner);
        const page = Number(query.page ?? 0), mine = query.mine === true || query.mine === '1';
        if (!Number.isInteger(page) || page < 0 || page > 100_000) fail(400, 'Trang chợ không hợp lệ.');
        const state = await store.read(owner.guildId, { sections: ['cs2PlayerMarket'] });
        const listings = playerMarket.getListings(state).filter(listing => !mine || listing.sellerId === owner.userId);
        const pages = Math.ceil(listings.length / 20), actual = pages ? Math.min(page, pages - 1) : 0;
        return { listings: listings.slice(actual * 20, (actual + 1) * 20).map(listing => marketListingDto(guild, listing, owner.userId)),
            page: actual, pages, total: listings.length };
    }
    function deterministicListingId(owner, requestId) {
        const value = crypto.createHash('sha256').update(`${owner.guildId}:${owner.userId}:${requestId.toLowerCase()}`).digest('hex');
        return (BigInt(`0x${value.slice(0, 32)}`) % 99_999_999_999_999_999_999n + 1n).toString();
    }
    async function marketList(owner, body = {}) {
        const guild = await ownerGuild(owner, true);
        const price = parseMarketAmount(body.price, 'Giá rao');
        if (typeof body.itemId !== 'string' || !body.itemId || body.itemId.length > 100 || !/^\d+$/.test(body.expectedMarketValue ?? '') || body.expectedMarketValue.length > 40) fail(400, 'Skin hoặc giá tham khảo không hợp lệ.');
        const key = request(owner, body, ['market-list', body.itemId, price.toString(), body.expectedMarketValue]);
        return actionOnce(owner, key, async () => {
            const scope = { sections: ['cs2PlayerMarket', key.section], wallets: [owner.userId], inventory: [owner.userId] };
            let savedState;
            const result = await store.transact(owner.guildId, async (state, save) => {
                const replay = previous(state, key);
                if (replay) return replay;
                const stash = state.skinCases?.[owner.userId];
                checkQuota(stash);
                const drops = stash?.drops ?? [], matches = drops.filter(drop => drop.id === body.itemId);
                if (matches.length !== 1 || !playerMarket.isDrop(matches[0])) fail(409, 'Skin không còn hợp lệ trong kho.');
                const drop = matches[0];
                if (drop.locked === true) fail(409, 'Skin đang khóa. Mở khóa trước khi đăng bán.');
                const quote = freshQuote(market.getDropMarketQuoteRef(drop));
                const value = quote ? BigInt(quote.priceVnd) * COIN_SCALE : null;
                if (value == null) fail(409, 'Skin chưa có báo giá thị trường còn hạn.');
                if (value.toString() !== body.expectedMarketValue) fail(409, 'Giá tham khảo vừa cập nhật. Hãy xem lại skin trước khi đăng bán.');
                const listingId = deterministicListingId(owner, key.id);
                if (state.cs2PlayerMarket?.[listingId] || stash.recentActions?.includes(listingId)) fail(409, 'Yêu cầu đăng bán đã được xử lý.');
                const listing = { id: listingId, sellerId: owner.userId, sellerName: String(owner.displayName ?? '').slice(0, 100),
                    price: price.toString(), drop, createdAt: Date.now() };
                (state.cs2PlayerMarket ??= {})[listingId] = listing;
                stash.drops = drops.filter(item => item.id !== body.itemId);
                stash.recentActions = [...(stash.recentActions ?? []), listingId].slice(-32);
                const balance = wallet.getCoinBalance(state, owner.userId);
                const response = { status: 'listed', listing: marketListingDto(guild, listing, owner.userId), balance: balance.toString(),
                    balanceFormatted: formatCoins(balance), replayed: false };
                saveReceipt(state, stash, key, response, 'market-list');
                if (stash.webHistory[0]) stash.webHistory[0].message = `Đăng bán ${response.listing.item.name} · ${response.listing.priceFormatted}`;
                await save(); savedState = state;
                return response;
            }, scope);
            if (savedState) updateBoard(guild, savedState, scope);
            return result;
        });
    }
    async function marketBuy(owner, body = {}) {
        const guild = await ownerGuild(owner, true);
        if (typeof body.listingId !== 'string' || !/^\d{1,20}$/.test(body.listingId)) fail(400, 'Tin bán không hợp lệ.');
        const key = request(owner, body, ['market-buy', body.listingId]);
        return actionOnce(owner, key, async () => {
            const snapshot = await store.read(owner.guildId, { sections: ['cs2PlayerMarket'] });
            const initial = playerMarket.getListing(snapshot, body.listingId);
            if (!initial) {
                const replay = await readActionReplay(owner, key);
                if (replay) return replay;
                fail(409, 'Tin bán đã rời chợ.');
            }
            const sellerId = initial.sellerId;
            const scope = { sections: ['cs2PlayerMarket', key.section], wallets: [owner.userId, sellerId], inventory: [owner.userId, sellerId] };
            let savedState;
            const result = await store.transact(owner.guildId, async (state, save) => {
                const replay = previous(state, key);
                if (replay) return replay;
                const buyerStash = (state.skinCases ??= {})[owner.userId] ??= {};
                checkQuota(buyerStash);
                const listing = playerMarket.getListing(state, body.listingId);
                if (!listing || listing.sellerId !== sellerId) fail(409, 'Tin bán đã rời chợ.');
                if (listing.sellerId === owner.userId) fail(409, 'Đây là tin bán của bạn.');
                if (playerMarket.ownsDrop(state, owner.userId, listing.drop.id) || playerMarket.ownsDrop(state, listing.sellerId, listing.drop.id)) fail(409, 'Skin không còn hợp lệ trong tin bán.');
                if (!freshQuote(market.getDropMarketQuoteRef(listing.drop))) fail(409, 'Skin chưa có báo giá thị trường còn hạn; giao dịch chưa được thực hiện.');
                const price = BigInt(listing.price), current = wallet.getCoinBalance(state, owner.userId);
                if (current < price) fail(409, 'Ví chưa đủ xu để mua skin này.');
                const balance = current - price;
                state.taixiu.balances[owner.userId] = serializeCoins(balance);
                state.taixiu.balances[listing.sellerId] = serializeCoins(wallet.getCoinBalance(state, listing.sellerId) + price);
                const drop = { ...listing.drop, acquiredAt: Date.now(), inventoryRevision: listing.id };
                playerMarket.restoreDrop(state, owner.userId, drop);
                delete state.cs2PlayerMarket[body.listingId];
                const response = { status: 'bought', listing: marketListingDto(guild, listing, owner.userId), item: itemDTO(drop),
                    balance: balance.toString(), balanceFormatted: formatCoins(balance), replayed: false };
                saveReceipt(state, buyerStash, key, response, 'market-buy');
                if (buyerStash.webHistory[0]) buyerStash.webHistory[0].message = `Mua ${response.item.name} · ${response.listing.priceFormatted}`;
                await save(); savedState = state;
                return response;
            }, scope);
            if (savedState) updateBoard(guild, savedState, scope);
            return result;
        });
    }
    async function marketCancel(owner, body = {}) {
        await ownerGuild(owner, true);
        if (typeof body.listingId !== 'string' || !/^\d{1,20}$/.test(body.listingId)) fail(400, 'Tin bán không hợp lệ.');
        const key = request(owner, body, ['market-cancel', body.listingId]);
        return actionOnce(owner, key, async () => {
            const scope = { sections: ['cs2PlayerMarket', key.section], wallets: [owner.userId], inventory: [owner.userId] };
            const guild = await ownerGuild(owner);
            return store.transact(owner.guildId, async (state, save) => {
                const replay = previous(state, key);
                if (replay) return replay;
                const stash = (state.skinCases ??= {})[owner.userId] ??= {};
                checkQuota(stash);
                const listing = playerMarket.getListing(state, body.listingId);
                if (!listing) fail(409, 'Tin bán đã rời chợ.');
                if (listing.sellerId !== owner.userId) fail(403, 'Chỉ người bán mới có thể hủy tin.');
                if (playerMarket.ownsDrop(state, owner.userId, listing.drop.id)) fail(409, 'Skin đã có trong kho. Hãy tải lại trước khi hủy tin.');
                playerMarket.restoreDrop(state, owner.userId, { ...listing.drop, inventoryRevision: listing.id });
                delete state.cs2PlayerMarket[body.listingId];
                const balance = wallet.getCoinBalance(state, owner.userId);
                const response = { status: 'cancelled', listing: marketListingDto(guild, listing, owner.userId),
                    balance: balance.toString(), balanceFormatted: formatCoins(balance), replayed: false };
                saveReceipt(state, stash, key, response, 'market-cancel');
                if (stash.webHistory[0]) stash.webHistory[0].message = `Hủy tin bán · ${response.listing.item.name}`;
                await save();
                return response;
            }, scope);
        });
    }
    async function transferRecipient(owner, recipientId) {
        if (typeof recipientId !== 'string' || !ID.test(recipientId)) fail(400, 'ID người nhận không hợp lệ.');
        if (recipientId === owner.userId) fail(400, 'Bạn không thể chuyển xu cho chính mình.');
        const guild = await ownerGuild(owner, true);
        let member;
        try { member = await guild.members.fetch({ user: recipientId, force: true, cache: false }); }
        catch (error) { if ([10007, 10013].includes(error.code)) member = null; else throw error; }
        if (!member || member.user?.bot || member.user?.id !== recipientId || member.guild?.id && member.guild.id !== owner.guildId) fail(404, 'Người nhận phải là thành viên trong cùng máy chủ Discord.');
        return { guild, member, name: String(member.displayName ?? member.user.globalName ?? member.user.username ?? `Người chơi ${recipientId}`).slice(0, 100) };
    }
    async function transferQuote(owner, body = {}) {
        const amount = parseMarketAmount(body.amount, 'Số xu chuyển');
        const { member, name } = await transferRecipient(owner, body.recipientId);
        const state = await store.read(owner.guildId, { wallets: [owner.userId] });
        const balance = wallet.getCoinBalance(state, owner.userId), after = balance - amount;
        if (after < 0n) fail(409, 'Ví không đủ xu để chuyển số tiền này.');
        return { recipientId: member.user.id, recipientName: name, amount: amount.toString(), amountInput: decimalCoins(amount), amountFormatted: formatCoins(amount),
            fee: '0', feeFormatted: formatCoins(0n), balance: balance.toString(), balanceFormatted: formatCoins(balance),
            balanceAfter: after.toString(), balanceAfterFormatted: formatCoins(after) };
    }
    async function transfer(owner, body = {}) {
        const amount = parseMarketAmount(body.amount, 'Số xu chuyển');
        const { guild, member, name } = await transferRecipient(owner, body.recipientId);
        const recipientId = member.user.id;
        const key = request(owner, body, ['transfer', recipientId, amount.toString()]);
        const scope = { sections: [key.section], wallets: [owner.userId, recipientId], inventory: [owner.userId, recipientId] };
        let savedState;
        const result = await store.transact(owner.guildId, async (state, save) => {
            const replay = actionReplay(state, key);
            if (replay) return replay;
            const senderStash = (state.skinCases ??= {})[owner.userId] ??= {};
            const recipientStash = state.skinCases[recipientId] ??= {};
            checkQuota(senderStash);
            const now = Date.now(), window = senderStash.webTransferWindow;
            const activeWindow = window && Number.isSafeInteger(window.startedAt) && now - window.startedAt < 60 * 60_000 ? window : { startedAt: now, count: 0 };
            if (activeWindow.count >= 10) fail(429, 'Đã đạt giới hạn 10 lần chuyển mỗi giờ. Hãy thử lại sau.');
            const current = wallet.getCoinBalance(state, owner.userId);
            if (current < amount) fail(409, 'Ví không đủ xu để chuyển số tiền này.');
            const recipientBalance = wallet.getCoinBalance(state, recipientId);
            const balance = current - amount;
            state.taixiu.balances[owner.userId] = serializeCoins(balance);
            state.taixiu.balances[recipientId] = serializeCoins(recipientBalance + amount);
            senderStash.webTransferWindow = { startedAt: activeWindow.startedAt, count: activeWindow.count + 1 };
            senderStash.webRequestCount = (senderStash.webRequestCount ?? 0) + 1;
            const response = { status: 'transferred', recipientId, recipientName: name, amount: amount.toString(), amountFormatted: formatCoins(amount),
                fee: '0', feeFormatted: formatCoins(0n), balance: balance.toString(), balanceFormatted: formatCoins(balance), replayed: false };
            state[key.section] = { fingerprint: key.fingerprint, result: structuredClone(response), at: now };
            senderStash.webHistory = [{ requestId: key.id, action: 'transfer', at: now, total: amount.toString(), balance: balance.toString(),
                message: `Chuyển ${formatCoins(amount)} cho ${name}` }, ...(senderStash.webHistory ?? [])].slice(0, 30);
            recipientStash.webHistory = [{ action: 'receive', at: now, total: amount.toString(), balance: (recipientBalance + amount).toString(),
                message: `Nhận ${formatCoins(amount)} từ ${String(owner.displayName ?? `Người chơi ${owner.userId}`).slice(0, 100)}` }, ...(recipientStash.webHistory ?? [])].slice(0, 30);
            await save(); savedState = state;
            return response;
        }, scope);
        if (savedState) updateBoard(guild, savedState, { wallets: [owner.userId, recipientId], inventory: [owner.userId, recipientId] });
        return result;
    }

    function catalogue() {
        running();
        if (!catalogueCache || Date.now() - catalogueAt >= 10_000) {
            const prices = casePrices();
            const cases = [...casesEngine.customCases.map(item => caseDTO(item, casesEngine.casePricing(item, prices))),
                ...standardCases.map(item => standardCaseDTO(item, standardCaseQuote(item)))];
            catalogueCache = { cases, groups: [...new Set(cases.map(item => item.group))] };
            catalogueAt = Date.now();
        }
        return structuredClone(catalogueCache);
    }
    function caseDetail(id) {
        running();
        const rangeCache = new Map();
        const marketRangeFor = skinId => {
            if (!rangeCache.has(skinId)) rangeCache.set(skinId, standardSkinPrice(skinId));
            return rangeCache.get(skinId);
        };
        const ordinary = standardCasesById.get(id);
        if (ordinary) {
            const summary = standardCaseDTO(ordinary, standardCaseQuote(ordinary));
            const entries = standard.caseEntries(ordinary).map(({ skinId, tier, chance }, index) => ({
                ...itemDTO({ skinId, tier }, null), ...marketRangeFor(skinId), statTrak: null,
                possibleStatTrak: skins[skinId]?.stattrak === true,
                id: `${id}-${tier}-${index}`, chance, exclusiveEligible: false
            }));
            return { case: summary, fee: summary.fee, quoteId: null, entries, rarities: summary.rarities, exclusive: { available: false } };
        }
        const item = getCase(id), pricing = pricingFor(item);
        const exclusive = describeExclusive(pricing, itemDTO), selected = new Set(exclusive.indices);
        const entries = pricing ? pricing.entries.map((entry, index) => ({
            ...itemDTO(entry.drop, BigInt(pricing.values[index]) * COIN_SCALE),
            ...(entry.drop.priceVariant === 'blue-gem' ? {
                marketRangeFormatted: formatCoins(BigInt(pricing.values[index]) * COIN_SCALE),
                marketRangeLabel: `Seed #${entry.drop.paintSeed}`,
                marketRangeNote: `Giá Blue Gem theo đúng pattern seed #${entry.drop.paintSeed}.`
            } : {
                marketRangeFormatted: marketRangeFor(entry.drop.skinId).valueFormatted,
                marketRangeNote: marketRangeFor(entry.drop.skinId).priceNote
            }),
            id: `${item.id}-${index}`, chance: entry.weight / casesEngine.TICKETS * 100,
            exclusiveEligible: selected.has(index) })) : [];
        return { case: caseDTO(item, pricing), quoteId: pricing ? quoteIdFor(pricing) : null, fee: pricing?.fee.toString() ?? null,
            entries, exclusive };
    }
    async function me(owner) {
        await ownerGuild(owner);
        const state = await store.read(owner.guildId, scopeFor(owner.userId));
        const stash = state.skinCases?.[owner.userId];
        const drops = (stash?.drops ?? []).filter(drop => skins[drop.skinId]);
        const eligible = new Set(upgradeEngine.eligibleInputs(stash).map(drop => drop.id));
        const balance = wallet.getCoinBalance(state, owner.userId);
        const pending = stash?.upgrade?.pending;
        return { user: { guildId: owner.guildId, userId: owner.userId, displayName: String(owner.displayName ?? '').slice(0, 100), avatar: safeImage(owner.avatar) },
            balance: balance.toString(), balanceFormatted: formatCoins(balance),
            caseStock: { cases: structuredClone(stash?.cases ?? {}), keys: structuredClone(stash?.keys ?? {}) },
            inventory: drops.toReversed().map(drop => itemDTO(drop, undefined, eligible.has(drop.id))), inventoryTotal: drops.length,
            history: structuredClone(stash?.webHistory ?? []).slice(0, 30),
            upgrade: { pending: pending?.expiresAt > Date.now() ? publicAttempt(pending) : null,
                history: (stash?.upgrade?.history ?? []).slice(0, 30).map(receipt => publicAttempt(receipt, true)) } };
    }
    function standardQuoteSignature(owner, item, count, plan, expiresAt) {
        return crypto.createHmac('sha256', standardQuoteKey).update(JSON.stringify([
            owner.guildId, owner.userId, item.id, count, plan.ownedCases, plan.ownedKeys, plan.fee.toString(), expiresAt
        ])).digest('hex');
    }
    async function openQuote(owner, { caseId, count } = {}) {
        await ownerGuild(owner);
        const item = standardCasesById.get(caseId);
        if (!item) fail(404, 'Không tìm thấy hòm thường.');
        if (!Number.isSafeInteger(count) || count < 1) fail(400, 'Số hòm phải là số nguyên dương hợp lệ.');
        const state = await store.read(owner.guildId, scopeFor(owner.userId));
        const stash = state.skinCases?.[owner.userId];
        if (!canFitCaseOpening(count, stash?.drops?.length ?? 0)) fail(413, CAPACITY_NOTICE);
        const plan = standardCheckout(item, stash, count);
        const { fee, ownedCases, ownedKeys, missingCases, missingKeys } = plan;
        const casePrice = plan.price ? BigInt(plan.price.priceVnd) * COIN_SCALE : null;
        const keyPrice = BigInt(standard.KEY_PRICE_AMOUNT) * COIN_SCALE;
        const expiresAt = Math.min(Date.now() + STANDARD_QUOTE_TTL, plan.price?.expiresAt ?? Infinity);
        const quote = `${expiresAt}.${standardQuoteSignature(owner, item, count, plan, expiresAt)}`;
        return { quote, expiresAt, fee: fee.toString(), feeFormatted: formatCoins(fee), ownedCases, ownedKeys, missingCases, missingKeys,
            casePrice: casePrice?.toString() ?? null, casePriceFormatted: casePrice == null ? null : formatCoins(casePrice),
            keyPrice: keyPrice.toString(), keyPriceFormatted: formatCoins(keyPrice),
            affordable: wallet.getCoinBalance(state, owner.userId) >= fee };
    }
    async function open(owner, body = {}) {
        const guild = await ownerGuild(owner, true);
        const { caseId, count, quoteId, quote } = body;
        const ordinary = standardCasesById.get(caseId);
        const quoteParts = ordinary && typeof quote === 'string' ? STANDARD_QUOTE.exec(quote) : null;
        if (!Number.isSafeInteger(count) || count < 1 || (ordinary ? !quoteParts : !HASH.test(quoteId ?? ''))) fail(400, 'Số hòm phải là số nguyên dương an toàn và có báo giá hợp lệ.');
        if (body.exclusiveDrop !== undefined && typeof body.exclusiveDrop !== 'boolean') fail(400, 'Lựa chọn Exclusive Drop không hợp lệ.');
        if (ordinary && body.exclusiveDrop === true) fail(400, 'Exclusive Drop chỉ áp dụng cho hòm Battle.');
        const fingerprint = ['open', caseId, count, ordinary ? quote : quoteId];
        if (body.exclusiveDrop !== undefined) fingerprint.push({ exclusiveDrop: body.exclusiveDrop });
        const item = ordinary ?? getCase(caseId), key = request(owner, body, fingerprint);
        let saved;
        const scope = { ...scopeFor(owner.userId), sections: [key.section] };
        const result = await store.transact(owner.guildId, async (state, save) => {
            const stash = (state.skinCases ??= {})[owner.userId] ??= {};
            const replay = previous(state, key);
            if (replay) return replay;
            checkQuota(stash);
            let plan, pricing, resolved;
            if (ordinary) {
                const expiresAt = Number(quoteParts[1]);
                if (expiresAt <= Date.now()) fail(409, 'Báo giá đã hết hạn. Hãy lấy báo giá mới.');
                plan = standardCheckout(item, stash, count);
                if (!crypto.timingSafeEqual(Buffer.from(quoteParts[2], 'hex'), Buffer.from(standardQuoteSignature(owner, item, count, plan, expiresAt), 'hex'))) {
                    fail(409, 'Giá hoặc số hòm và chìa trong kho đã thay đổi. Hãy xác nhận lại.');
                }
            } else {
                pricing = pricingFor(item);
                if (!pricing || typeof pricing.fee !== 'bigint' || pricing.fee <= 0n || quoteIdFor(pricing) !== quoteId) fail(409, 'Báo giá hòm vừa thay đổi. Hãy xem lại trước khi mở.');
            }
            const current = wallet.getCoinBalance(state, owner.userId), total = plan?.fee ?? pricing.fee * BigInt(count);
            if (current < total) fail(409, 'Ví không đủ xu để mở số hòm này.');
            if (!canFitCaseOpening(count, stash.drops?.length ?? 0)) fail(413, CAPACITY_NOTICE);
            if (!ordinary) {
                resolved = casesEngine.lockedCase(item, casesEngine.lockCasePricing(pricing));
                if (!resolved) fail(409, 'Nội dung hòm đã thay đổi. Hãy tải lại.');
            }
            const now = Date.now();
            const drops = [], results = [];
            for (let index = 0; index < count; index++) {
                const dropId = `web-${key.id}-${index + 1}`;
                const { drop, value, exclusive } = ordinary ? { drop: standard.rollDrop(item, dropId, now) }
                    : rollExclusiveCase(resolved, pricing, dropId, now, crypto.randomInt, body.exclusiveDrop !== false);
                drops.push({ ...drop, inventoryRevision: key.id });
                results.push({ ...itemDTO(drop, value, true), ...(exclusive ? { exclusive } : {}) });
                if ((index + 1) % 250 === 0) await yieldEventLoop();
            }
            if (plan?.ownedCases) stash.cases[item.id] -= plan.ownedCases;
            if (plan?.ownedKeys) stash.keys[item.key] -= plan.ownedKeys;
            stash.drops = (stash.drops ?? []).concat(drops);
            activityRecorder?.(state, owner.userId, { actionId: `case:${key.id}`, type: 'case_open', caseId, count,
                skinIds: results.map(result => result.skinId) }, now);
            const balance = current - total;
            if (total > 0n) state.taixiu.balances[owner.userId] = serializeCoins(balance);
            const result = { requestId: key.id, results,
                ...(pricing ? { exclusive: { ...describeExclusive(pricing, itemDTO), enabled: body.exclusiveDrop !== false } } : {}),
                fee: (pricing?.fee ?? total).toString(), total: total.toString(),
                balance: balance.toString(), balanceFormatted: formatCoins(balance), replayed: false };
            saveReceipt(state, stash, key, result, 'open');
            await save(); saved = state;
            return result;
        }, scope);
        if (saved && result.total !== '0') updateBoard(guild, saved, scope);
        return result;
    }

    function selected(stash, ids, max = 50) {
        if (!Array.isArray(ids) || !ids.length || ids.length > max || ids.some(id => typeof id !== 'string' || !id || id.length > 100) || new Set(ids).size !== ids.length) fail(400, 'Danh sách skin không hợp lệ.');
        const wanted = new Set(ids), drops = (stash?.drops ?? []).filter(drop => wanted.has(drop.id));
        if (drops.length !== ids.length || new Set(drops.map(drop => drop.id)).size !== drops.length) fail(409, 'Một skin không còn thuộc kho của bạn.');
        return drops;
    }
    function salePlan(stash, ids) {
        const drops = selected(stash, ids);
        if (drops.some(drop => drop.locked === true)) fail(409, 'Một skin đang khóa. Chưa bán skin nào.');
        const quotes = drops.map(drop => freshQuote(market.getDropMarketQuoteRef(drop)));
        if (quotes.some(quote => !quote)) fail(409, 'Một skin chưa có giá còn hạn. Vui lòng chờ đồng bộ.');
        const values = quotes.map(quote => BigInt(quote.priceVnd) * COIN_SCALE);
        const canonical = drops.map((drop, index) => ({ drop, price: quotes[index].priceVnd })).sort((a, b) => a.drop.id.localeCompare(b.drop.id));
        return { drops, values, quoteId: digest(canonical), total: values.reduce((sum, value) => sum + value, 0n) };
    }
    async function sellQuote(owner, body = {}) {
        await ownerGuild(owner);
        const state = await store.read(owner.guildId, scopeFor(owner.userId)), plan = salePlan(state.skinCases?.[owner.userId], body.itemIds);
        return { quoteId: plan.quoteId, total: plan.total.toString(), totalFormatted: formatCoins(plan.total), items: plan.drops.map((drop, index) => itemDTO(drop, plan.values[index])) };
    }
    async function sell(owner, body = {}) {
        const guild = await ownerGuild(owner, true);
        if (!HASH.test(body.quoteId ?? '')) fail(400, 'Báo giá bán không hợp lệ.');
        if (!Array.isArray(body.itemIds) || body.itemIds.some(id => typeof id !== 'string')) fail(400, 'Danh sách skin không hợp lệ.');
        const key = request(owner, body, ['sell', [...body.itemIds].sort(), body.quoteId]);
        const scope = { ...scopeFor(owner.userId), sections: [key.section] };
        let saved;
        const result = await store.transact(owner.guildId, async (state, save) => {
            const stash = state.skinCases?.[owner.userId], replay = previous(state, key);
            if (replay) return replay;
            checkQuota(stash);
            const plan = salePlan(stash, body.itemIds);
            if (plan.quoteId !== body.quoteId) fail(409, 'Kho hoặc giá vừa thay đổi. Hãy xác nhận lại giá bán.');
            const ids = new Set(plan.drops.map(drop => drop.id));
            stash.drops = stash.drops.filter(drop => !ids.has(drop.id));
            const balance = wallet.getCoinBalance(state, owner.userId) + plan.total;
            state.taixiu.balances[owner.userId] = serializeCoins(balance);
            const result = { requestId: key.id, items: plan.drops.map((drop, index) => itemDTO(drop, plan.values[index])), total: plan.total.toString(),
                totalFormatted: formatCoins(plan.total), balance: balance.toString(), balanceFormatted: formatCoins(balance), replayed: false };
            saveReceipt(state, stash, key, result, 'sell');
            await save(); saved = state;
            return result;
        }, scope);
        if (saved) updateBoard(guild, saved, scope);
        return result;
    }
    async function locks(owner, body = {}) {
        await ownerGuild(owner, true);
        if (typeof body.locked !== 'boolean') fail(400, 'Trạng thái khóa không hợp lệ.');
        return store.transact(owner.guildId, async (state, save) => {
            const drops = selected(state.skinCases?.[owner.userId], body.itemIds);
            for (const drop of drops) { if (body.locked) drop.locked = true; else delete drop.locked; }
            await save();
            return { itemIds: drops.map(drop => drop.id), locked: body.locked };
        }, { inventory: [owner.userId] });
    }
    async function targets(owner, query = {}) {
        await ownerGuild(owner);
        const search = typeof query.search === 'string' ? query.search.trim().toLowerCase().slice(0, 100) : '';
        const page = Number(query.page ?? 0);
        if (!Number.isInteger(page) || page < 0 || page > 100000 ||
            ['minValue', 'maxValue', 'desiredValue'].some(key => query[key] != null && !/^\d{1,40}$/.test(String(query[key])))) fail(400, 'Bộ lọc mục tiêu không hợp lệ.');
        const min = BigInt(query.minValue ?? 0), max = query.maxValue == null ? null : BigInt(query.maxValue);
        const desired = query.desiredValue == null ? null : BigInt(query.desiredValue);
        if (max != null && max < min) fail(400, 'Bộ lọc mục tiêu không hợp lệ.');
        const items = upgradeEngine.targetCatalogue().filter(target => !search || `${target.name} ${target.phase ?? ''}`.toLowerCase().includes(search)).flatMap(target => {
            const quote = freshQuote(target.marketRef);
            if (!quote) return [];
            const value = BigInt(quote.priceVnd) * COIN_SCALE;
            if (value < min || (max != null && value > max)) return [];
            return [targetDTO(target, value)];
        }).sort((a, b) => {
            const left = BigInt(a.value), right = BigInt(b.value);
            if (desired != null) {
                const distance = value => value < desired ? desired - value : value - desired;
                const delta = distance(left) - distance(right);
                if (delta) return delta < 0n ? -1 : 1;
            }
            return left === right ? a.id.localeCompare(b.id) : left < right ? -1 : 1;
        });
        const pages = Math.ceil(items.length / 50), actual = pages ? Math.min(page, pages - 1) : 0;
        return { items: items.slice(actual * 50, (actual + 1) * 50), page: actual, total: items.length, pages };
    }
    function upgradeOptions(body = {}) {
        if (typeof body.coinStake !== 'string' || body.coinStake.length > 40) fail(400, 'Số xu Upgrade không hợp lệ.');
        const coinStake = /^0(?:[.,]0{1,2})?$/.test(body.coinStake.trim()) ? 0n : parseCoins(body.coinStake);
        if (coinStake == null) fail(400, 'Nhập số xu không âm, tối đa hai chữ số thập phân.');
        if (!Array.isArray(body.inputIds) || body.inputIds.length > upgradeEngine.MAX_INPUTS || body.inputIds.some(id => typeof id !== 'string' || !id || id.length > 100) || new Set(body.inputIds).size !== body.inputIds.length) fail(400, 'Chọn skin hợp lệ, không trùng nhau.');
        if (body.startTicket !== undefined && (!Number.isInteger(body.startTicket) || body.startTicket < 0 || body.startTicket >= upgradeEngine.TICKETS)) fail(400, 'Vị trí vùng thắng không hợp lệ.');
        return { inputIds: body.inputIds, targetId: body.targetId, coinStake, clientSeed: body.clientSeed, direction: body.direction,
            ...(body.startTicket === undefined ? {} : { startTicket: body.startTicket }) };
    }
    async function upgradePreview(owner, body = {}) {
        await ownerGuild(owner);
        const options = upgradeOptions(body), state = await store.read(owner.guildId, scopeFor(owner.userId));
        const owned = state.skinCases?.[owner.userId]?.drops ?? [];
        const selectedIds = new Set(options.inputIds);
        const drops = owned.filter(drop => selectedIds.has(drop.id));
        if (drops.length !== options.inputIds.length) fail(409, 'Một skin không còn thuộc kho của bạn.');
        const plan = checkEngine(upgradeEngine.preview({ ...options, drops }), ['ready']);
        return { status: 'ready', inputValue: plan.inputValue.toString(), coinStake: plan.coinStake.toString(), stake: plan.stake.toString(),
            targetValue: plan.targetValue.toString(), chance: plan.chance, winTickets: plan.winTickets, multiplier: plan.multiplier,
            ...(plan.startTicket === undefined ? {} : { startTicket: plan.startTicket }),
            signature: plan.signature, prices: plan.prices, target: targetDTO(plan.target, plan.targetValue) };
    }
    async function upgradePrepare(owner, body = {}) {
        await ownerGuild(owner, true);
        const options = upgradeOptions(body);
        if (!HASH.test(body.expectedSignature ?? '') || !body.expectedPrices || typeof body.expectedPrices !== 'object') fail(400, 'Hãy xem tỷ lệ trước khi xác nhận Upgrade.');
        const result = checkEngine(await upgradeEngine.prepare(owner.guildId, owner.userId, { ...options,
            expectedSignature: body.expectedSignature, expectedPrices: body.expectedPrices }), ['prepared']);
        return { status: result.status, attempt: publicAttempt(result.attempt) };
    }
    async function upgradeSettle(owner, body = {}) {
        const guild = await ownerGuild(owner, true);
        if (typeof body.attemptId !== 'string' || !UUID.test(body.attemptId) || !HASH.test(body.expectedHash ?? '') || typeof body.expectedClientSeed !== 'string') fail(400, 'Xác nhận Upgrade không hợp lệ.');
        const result = checkEngine(await upgradeEngine.settle(guild, owner.userId, body.attemptId,
            { expectedHash: body.expectedHash, expectedClientSeed: body.expectedClientSeed,
                onSettled: (state, settled) => activityRecorder?.(state, owner.userId, { actionId: `upgrade:${body.attemptId}`, type: 'upgrade_complete', count: 1,
                    skinIds: settled.drop?.skinId ? [settled.drop.skinId] : [] }) }), ['settled', 'duplicate']);
        const state = await store.read(owner.guildId, scopeFor(owner.userId)), balance = wallet.getCoinBalance(state, owner.userId);
        return { status: result.status, replayed: result.status === 'duplicate', receipt: publicAttempt(result.receipt, true),
            balance: balance.toString(), balanceFormatted: formatCoins(balance) };
    }
    const validateOwner = owner => ownerGuild(owner, true).then(() => ({ ...owner }));
    const activities = require('./playerActivities').createPlayerActivities({ ownerGuild, request, previous,
        saveReceipt, checkQuota, itemDTO });
    activityRecorder = activities.recordActionState;
    const battles = require('./playerBattles').createPlayerBattles({ ownerGuild, pricingFor, quoteIdFor, itemDTO,
        request, previous, saveReceipt, checkQuota, updateBoard, recordActionState: activities.recordActionState });
    return { validateOwner, catalogue, caseDetail, me, openQuote, open, sellQuote, sell, locks, targets, upgradePreview, upgradePrepare, upgradeSettle,
        marketListings, marketList, marketBuy, marketCancel, transferQuote, transfer, ...battles, ...activities };
}

module.exports = { createPlayerService, itemDTO, REQUEST_LIMIT };
