const store = require('./managementStore');
const { parseCoins, serializeCoins } = require('./coins');
const { getDropMarketHashName } = require('./cs2MarketNames');
const { containersById } = require('./cs2Catalogue');
const { tradeUpPool } = require('./cs2TradeUpCatalogue');
const { getDropMarketQuoteRef } = require('./cs2Market');
const wallet = require('../commands/taixiu');

const discordId = /^[1-9]\d{0,19}$/;
const storedPrice = /^[1-9]\d*$/;
const PRICE_INPUT_LENGTH = 45; // Includes thousands separators and the decimal point.
const MAX_PRICE_DIGITS = 34; // Preserve the existing limit, stored in hundredths of a xu.
const RECENT_ACTION_LIMIT = 32;

function isDiscordId(id) {
    return typeof id === 'string' && discordId.test(id);
}

function isDrop(drop) {
    if (typeof drop?.id !== 'string' || !drop.id || !Number.isInteger(drop.tier) || drop.tier < 0 || drop.tier > 4) return false;
    const source = containersById.get(drop.caseId);
    const belongsToSource = source?.pools[drop.tier]?.includes(drop.skinId) ||
        source && tradeUpPool(source, drop.tier).includes(drop.skinId);
    return Boolean(belongsToSource && getDropMarketHashName(drop) && getDropMarketQuoteRef(drop));
}

function isListing(listing) {
    return isDiscordId(listing?.id) && isDiscordId(listing.sellerId) && isDrop(listing.drop) && listing.drop.locked !== true &&
        typeof listing.price === 'string' && listing.price.length <= MAX_PRICE_DIGITS &&
        storedPrice.test(listing.price) && Number.isSafeInteger(listing.createdAt);
}

function parseListingPrice(raw) {
    if (typeof raw !== 'string') return null;
    const value = raw.trim();
    // A zero thousands group is invalid and could be a fractional price with too many digits.
    if (value.length > PRICE_INPUT_LENGTH || /^0+[.,]\d{3}/.test(value)) return null;
    const amount = parseCoins(value);
    return amount != null && amount.toString().length <= MAX_PRICE_DIGITS ? amount : null;
}

function readListing(state, id) {
    const listings = state?.cs2PlayerMarket;
    return isDiscordId(id) && listings && Object.hasOwn(listings, id) ? listings[id] : null;
}

function getListing(state, id) {
    const listing = readListing(state, id);
    return listing?.id === id && isListing(listing) ? listing : null;
}

function getListings(state) {
    return Object.keys(state?.cs2PlayerMarket ?? {}).map(id => getListing(state, id)).filter(Boolean)
        .sort((first, second) => second.createdAt - first.createdAt || second.id.length - first.id.length || second.id.localeCompare(first.id));
}

function restoreDrop(state, userId, drop) {
    const inventories = state.skinCases ??= {};
    const inventory = inventories[userId] ??= {};
    (inventory.drops ??= []).push(drop);
    return inventory;
}

function ownsDrop(state, userId, dropId) {
    return Boolean(state.skinCases?.[userId]?.drops?.some(drop => drop.id === dropId));
}

async function listSkin(guildId, sellerId, dropId, price, listingId) {
    if (!isDiscordId(guildId) || !isDiscordId(sellerId) || !isDiscordId(listingId) ||
        typeof dropId !== 'string' || !dropId) return { status: 'invalid' };
    if (typeof price !== 'bigint' || price <= 0n || price.toString().length > MAX_PRICE_DIGITS) return { status: 'invalid-price' };

    return store.transact(guildId, async (state, save) => {
        const stash = state.skinCases?.[sellerId];
        if ((state.cs2PlayerMarket && Object.hasOwn(state.cs2PlayerMarket, listingId)) ||
            stash?.recentActions?.includes(listingId)) return { status: 'duplicate' };
        const matches = stash?.drops?.filter(drop => drop.id === dropId) ?? [];
        if (matches.length !== 1 || !isDrop(matches[0])) return { status: 'not-owned' };

        const [drop] = matches;
        if (drop.locked === true) return { status: 'locked' };
        const listing = { id: listingId, sellerId, price: price.toString(), drop, createdAt: Date.now() };
        (state.cs2PlayerMarket ??= {})[listingId] = listing;
        stash.drops = stash.drops.filter(item => item.id !== dropId);
        stash.recentActions = [...(stash.recentActions ?? []), listingId].slice(-RECENT_ACTION_LIMIT);
        await save();
        return { status: 'listed', listing };
    }, { sections: ['cs2PlayerMarket'], inventory: [sellerId] });
}

async function buySkin(guild, buyerId, listingId) {
    const guildId = typeof guild === 'string' ? guild : guild?.id;
    if (!isDiscordId(guildId) || !isDiscordId(buyerId) || !isDiscordId(listingId)) return { status: 'invalid' };

    const initial = readListing(await store.read(guildId, { sections: ['cs2PlayerMarket'] }), listingId);
    if (!initial) return { status: 'not-found' };
    if (initial.id !== listingId || !isListing(initial)) return { status: 'invalid-listing' };
    const owners = [...new Set([buyerId, initial.sellerId])];
    const scope = { sections: ['cs2PlayerMarket'], wallets: owners, inventory: owners };
    let savedState;
    const result = await store.transact(guildId, async (state, save) => {
        const listing = readListing(state, listingId);
        if (!listing) return { status: 'not-found' };
        if (listing.id !== listingId || !isListing(listing)) return { status: 'invalid-listing' };
        if (listing.sellerId !== initial.sellerId) return { status: 'invalid-listing' };
        if (listing.sellerId === buyerId) return { status: 'self-purchase' };
        if (ownsDrop(state, buyerId, listing.drop.id) || ownsDrop(state, listing.sellerId, listing.drop.id)) {
            return { status: 'already-owned' };
        }

        const price = BigInt(listing.price);
        const current = wallet.getCoinBalance(state, buyerId);
        if (current < price) return { status: 'insufficient-funds', balance: current };
        const balance = current - price;
        const sellerBalance = wallet.getCoinBalance(state, listing.sellerId) + price;
        state.taixiu.balances[buyerId] = serializeCoins(balance);
        state.taixiu.balances[listing.sellerId] = serializeCoins(sellerBalance);
        const drop = { ...listing.drop, acquiredAt: Date.now(), inventoryRevision: listing.id };
        const stash = restoreDrop(state, buyerId, drop);
        delete state.cs2PlayerMarket[listingId];
        await save();
        savedState = state;
        return { status: 'bought', listing, balance, drop, stash };
    }, scope);
    if (savedState && guild?.channels?.cache) {
        try { wallet.refreshCoinLeaderboard(guild, savedState, scope); }
        catch (error) { console.error('Lỗi cập nhật bảng xếp hạng sau giao dịch Chợ skin:', error.message); }
    }
    return result;
}

async function cancelListing(guildId, sellerId, listingId) {
    if (!isDiscordId(guildId) || !isDiscordId(sellerId) || !isDiscordId(listingId)) return { status: 'invalid' };

    return store.transact(guildId, async (state, save) => {
        const listing = readListing(state, listingId);
        if (!listing) return { status: 'not-found' };
        if (listing.id !== listingId || !isDiscordId(listing.sellerId) || !isDrop(listing.drop)) {
            return { status: 'invalid-listing' };
        }
        if (listing.sellerId !== sellerId) return { status: 'forbidden' };
        if (ownsDrop(state, sellerId, listing.drop.id)) return { status: 'already-owned' };

        // Returning from escrow starts a new inventory visit while preserving the
        // original acquisition date. Old sale/Trade Up confirmations must expire.
        restoreDrop(state, sellerId, { ...listing.drop, inventoryRevision: listing.id });
        delete state.cs2PlayerMarket[listingId];
        await save();
        return { status: 'cancelled', listing };
    }, { sections: ['cs2PlayerMarket'], inventory: [sellerId] });
}

module.exports = { listSkin, buySkin, cancelListing, parseListingPrice, getListings, getListing, isDrop, ownsDrop, restoreDrop, PRICE_INPUT_LENGTH };
