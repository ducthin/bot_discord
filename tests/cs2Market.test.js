const market = require('../utils/cs2Market');
const snapshot = require('../utils/cs2PriceSnapshot');

const CASE = 'Kilowatt Case';
const SKIN = 'AK-47 | Redline (Field-Tested)';
const NOW = Date.UTC(2026, 10, 14);
const HOUR = 60 * 60_000;
const buffQuote = {
    priceVnd: 1803, observedAt: NOW - HOUR, expiresAt: NOW + 23 * HOUR, source: 'buff',
    phase: null, url: 'https://buff.163.com/goods/12345'
};

afterEach(() => jest.restoreAllMocks());

test('reads current and display-only BUFF quotes locally and makes no per-item network request', () => {
    const request = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Unexpected network request'));
    const estimate = { ...buffQuote, observedAt: NOW - 25 * HOUR, expiresAt: NOW - HOUR };
    jest.spyOn(snapshot, 'peek').mockImplementation((name, options) => {
        if (name === CASE) return buffQuote;
        if (name === SKIN && options.allowStale) return estimate;
        return null;
    });

    expect(market.peekMarketQuote(CASE)).toBe(buffQuote);
    expect(market.peekMarketDisplay(CASE)).toEqual({ status: 'fresh', quote: buffQuote });
    expect(market.peekMarketQuote(SKIN)).toBeNull();
    expect(market.peekMarketDisplay(SKIN)).toEqual({ status: 'estimate', quote: estimate });
    expect(market.peekMarketDisplay('Missing skin')).toEqual({ status: 'snapshot-missing', quote: null });
    expect(request).not.toHaveBeenCalled();
});

test.each(['steam', 'steam-snapshot', 'steam-lowest-listing', 'csfloat', 'skinport', undefined])(
    'ignores cached %s prices for display and transaction', source => {
        jest.spyOn(snapshot, 'peek').mockReturnValue({ ...buffQuote, source });
        expect(market.peekMarketQuote(CASE)).toBeNull();
        expect(market.peekMarketDisplay(CASE)).toEqual({ status: 'snapshot-missing', quote: null });
    }
);

test('isolates each exact Doppler phase and rejects a generic quote for a known phase', () => {
    const ruby = market.getDropMarketQuoteRef({ skinId: 'skin-48064d096b19', float: 0.03, statTrak: true });
    const phase2 = { ...ruby, phase: 'Phase 2' };
    const sapphire = { ...ruby, phase: 'Sapphire' };
    const rubyQuote = { ...buffQuote, priceVnd: 60_000_000, phase: 'Ruby' };
    const phase2Quote = { ...buffQuote, priceVnd: 10_000_000, phase: 'Phase 2' };
    jest.spyOn(snapshot, 'peek').mockImplementation((name, options) => {
        if (name !== ruby.name) return null;
        if (options.phase === 'Ruby') return rubyQuote;
        if (options.phase === 'Phase 2') return phase2Quote;
        return buffQuote;
    });

    expect(ruby).toEqual({ name: '★ StatTrak™ Survival Knife | Doppler (Factory New)', phase: 'Ruby' });
    expect(market.peekMarketQuote(ruby.name, ruby)).toBe(rubyQuote);
    expect(market.peekMarketQuote(phase2.name, phase2)).toBe(phase2Quote);
    expect(market.peekMarketQuote(sapphire.name, sapphire)).toBeNull();
    expect(market.peekMarketDisplay(sapphire.name, sapphire)).toEqual({ status: 'snapshot-missing', quote: null });
});

test.each([null, 'https://buff.163.com.evil.example/goods/1', 'http://buff.163.com/goods/1',
    'https://buff.163.com/other', 'https://user@buff.163.com/goods/1', `https://buff.163.com/goods/1?q=${'a'.repeat(512)}`])(
    'falls back to the BUFF market link when the listing link is unavailable or invalid (%s)', url => {
        jest.spyOn(snapshot, 'peek').mockReturnValue({ ...buffQuote, url });
        expect(market.peekMarketQuote(CASE)).toMatchObject({ url: market.BUFF_MARKET_URL });
    }
);

test('invalid names and phase keys never query the snapshot', () => {
    const lookup = jest.spyOn(snapshot, 'peek');
    expect(market.peekMarketQuote('')).toBeNull();
    expect(market.peekMarketQuote(CASE, { phase: 'a\0b' })).toBeNull();
    expect(market.peekMarketDisplay('  ')).toEqual({ status: 'unmapped', quote: null });
    expect(lookup).not.toHaveBeenCalled();
});
