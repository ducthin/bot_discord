const COIN_SCALE = 100n;
const MAX_SAFE_COINS = BigInt(Number.MAX_SAFE_INTEGER);
const coinFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const wholeCoinFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const scientificFormat = new Intl.NumberFormat('en-US', { notation: 'scientific', maximumSignificantDigits: 4 });
const dotDecimal = /^(\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?$/;
const commaDecimal = /^(\d+|\d{1,3}(?:\.\d{3})+)(?:,(\d{1,2}))?$/;

function readCoins(value) {
    if (typeof value !== 'string' || !value.includes('.')) return BigInt(value) * COIN_SCALE;
    const match = /^(-?\d+)\.(\d{1,2})$/.exec(value);
    if (!match) throw new TypeError('Invalid stored coin amount.');
    const [, whole, decimal] = match;
    const fraction = BigInt(decimal.padEnd(2, '0'));
    return BigInt(whole) * COIN_SCALE + (whole.startsWith('-') ? -fraction : fraction);
}

function parseCoins(input = '') {
    if (typeof input !== 'string') return null;
    input = input.trim();
    if (/^0+[.,]\d{3}/.test(input)) return null;
    const match = dotDecimal.exec(input) ?? commaDecimal.exec(input);
    if (!match) return null;
    const whole = BigInt(match[1].replace(/[.,]/g, ''));
    const fraction = BigInt((match[2] ?? '').padEnd(2, '0'));
    const amount = whole * COIN_SCALE + fraction;
    return amount > 0n ? amount : null;
}

function decimalCoins(amount) {
    const absolute = amount < 0n ? -amount : amount;
    const fraction = (absolute % COIN_SCALE).toString().padStart(2, '0');
    return `${amount < 0n ? '-' : ''}${absolute / COIN_SCALE}.${fraction}`;
}

function serializeCoins(amount) {
    // Whole values retain their existing on-disk shape. Fractions use exact decimal strings.
    if (amount % COIN_SCALE !== 0n) return decimalCoins(amount);
    const whole = amount / COIN_SCALE;
    return whole >= -MAX_SAFE_COINS && whole <= MAX_SAFE_COINS ? Number(whole) : whole.toString();
}

function formatCoins(amount, { exact = false } = {}) {
    const decimal = decimalCoins(amount);
    const formatted = formatCoinInput(amount);
    return (exact || formatted.length <= 40 ? formatted : `≈${scientificFormat.format(decimal)}`) + ' xu';
}

function formatCoinInput(amount) {
    return amount % COIN_SCALE === 0n ? wholeCoinFormat.format(amount / COIN_SCALE) : coinFormat.format(decimalCoins(amount));
}

module.exports = { COIN_SCALE, readCoins, parseCoins, decimalCoins, serializeCoins, formatCoins, formatCoinInput };
