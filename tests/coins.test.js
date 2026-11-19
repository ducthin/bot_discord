const { readCoins, parseCoins, decimalCoins, serializeCoins, formatCoins, formatCoinInput } = require('../utils/coins');

test.each([
    [0n, '0'], [100n, '1'], [150n, '1.50'], [-100n, '-1'], [-125n, '-1.25'],
    [100_000_000n, '1,000,000'], [123_456_789n, '1,234,567.89']
])('coin display groups %s without adding .00 to whole amounts', (amount, expected) => {
    expect(formatCoins(amount)).toBe(`${expected} xu`);
    expect(formatCoinInput(amount)).toBe(expected);
});

test('grouped inputs preserve every digit beyond Number precision', () => {
    const amount = 123456789012345678901234567890125n;
    const grouped = '1,234,567,890,123,456,789,012,345,678,901.25';
    expect(formatCoinInput(amount)).toBe(grouped);
    expect(formatCoins(amount, { exact: true })).toBe(`${grouped} xu`);
    expect(formatCoins(amount)).toMatch(/^≈.+ xu$/);
    expect(parseCoins(grouped)).toBe(amount);
    expect(parseCoins(formatCoinInput(amount / 100n * 100n))).toBe(amount / 100n * 100n);
    expect(readCoins(serializeCoins(amount))).toBe(amount);
});

test.each([
    ['1,000', 100_000n], ['1,000,000', 100_000_000n], ['1,234.50', 123_450n],
    ['1.234,50', 123_450n], ['1,5', 150n], [' 1,000.25 ', 100_025n]
])('accepts grouped monetary input %s unambiguously', (input, expected) => {
    expect(parseCoins(input)).toBe(expected);
    expect(parseCoins(formatCoinInput(expected))).toBe(expected);
});

test.each(['', '0', '0.00', '-1', '1e6', '1,00,000', '0.001', '0,123', '1,234.567', 'NaN', null, 1000])(
    'rejects malformed monetary input %s', input => expect(parseCoins(input)).toBeNull()
);

test('display changes preserve exact cents and existing storage shapes', () => {
    expect(decimalCoins(1_000_000n)).toBe('10000.00');
    expect(serializeCoins(1_000_000n)).toBe(10_000);
    expect(serializeCoins(1_000_050n)).toBe('10000.50');
    expect(readCoins('10000.50')).toBe(1_000_050n);
});
