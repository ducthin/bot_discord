const { skins } = require('./cs2Catalogue');
const { getDropMarketHashName, marketQuoteKey } = require('./cs2MarketNames');
const priceSnapshot = require('./cs2PriceSnapshot');
const blueGemPrices = require('./cs2BlueGemPrices');
const { isBlueGem } = require('./cs2Patterns');

const BUFF_ORIGIN = 'https://buff.163.com';
const BUFF_MARKET_URL = `${BUFF_ORIGIN}/market/csgo`;
const DISCORD_LINK_LIMIT = 512;

function validMarketName(name) {
    return typeof name === 'string' && name.length > 0 && name.length <= 200 && name.isWellFormed() &&
        name === name.trim() && name !== '.' && name !== '..' && !/[\x00-\x1f\x7f]/.test(name);
}

function getDropMarketQuoteRef(drop) {
    const name = getDropMarketHashName(drop);
    if (!name) return null;
    const ref = { name, phase: skins[drop.skinId].phase ?? null };
    if (drop.priceVariant != null) {
        if (drop.priceVariant !== 'blue-gem' || !isBlueGem(drop.skinId, drop.paintSeed)) return null;
        ref.paintSeed = drop.paintSeed;
    }
    return ref;
}

function getBlueGemMarketQuoteRef(drop) {
    if (!isBlueGem(drop?.skinId, drop?.paintSeed)) return null;
    const { paintSeed } = drop;
    const name = getDropMarketHashName(drop);
    return validMarketQuoteRef(name, null, paintSeed) ? { name, phase: null, paintSeed } : null;
}

function validMarketQuoteRef(name, phase, paintSeed) {
    return validMarketName(name) && (phase === null || validMarketName(phase)) &&
        (paintSeed == null || phase === null && Number.isInteger(paintSeed) && paintSeed >= 0 && paintSeed <= 1000 && blueGemPrices.supports(name, paintSeed));
}

function buffMarketUrl(link) {
    const url = typeof link === 'string' && link.length <= DISCORD_LINK_LIMIT ? URL.parse(link) : null;
    if (url?.origin === BUFF_ORIGIN && !url.username && !url.password &&
        url.href.length <= DISCORD_LINK_LIMIT && /^\/goods\/\d+\/?$/.test(url.pathname)) return url.href;
    return BUFF_MARKET_URL;
}

function peekSnapshotQuote(name, phase, allowStale = false, paintSeed) {
    if (paintSeed != null) {
        const quote = blueGemPrices.peek(name, { paintSeed, allowStale });
        return quote?.source === 'csfloat' && quote.paintSeed === paintSeed && (quote.phase ?? null) === null ? quote : null;
    }
    const quote = priceSnapshot.peek(name, { phase, allowStale });
    if (quote?.source !== 'buff' || (quote.phase ?? null) !== phase) return null;
    const url = buffMarketUrl(quote.url);
    return quote.url === url ? quote : { ...quote, url };
}

function peekMarketQuote(name, { phase = null, paintSeed } = {}) {
    return validMarketQuoteRef(name, phase, paintSeed) ? peekSnapshotQuote(name, phase, false, paintSeed) : null;
}

function peekMarketDisplay(name, { phase = null, paintSeed } = {}) {
    if (!validMarketQuoteRef(name, phase, paintSeed)) return { status: 'unmapped', quote: null };
    const fresh = peekSnapshotQuote(name, phase, false, paintSeed);
    if (fresh) return { status: 'fresh', quote: fresh };
    const estimate = peekSnapshotQuote(name, phase, true, paintSeed);
    return estimate ? { status: 'estimate', quote: estimate } : { status: 'snapshot-missing', quote: null };
}

module.exports = {
    BUFF_MARKET_URL, CSFLOAT_MARKET_URL: blueGemPrices.MARKET_URL,
    getDropMarketQuoteRef, getBlueGemMarketQuoteRef, marketQuoteKey, peekMarketQuote, peekMarketDisplay
};
