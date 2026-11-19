const { patternLabel } = require('../utils/cs2Patterns');

test('Fade percentages use both the exact finish and its paint seed', () => {
    expect(patternLabel('skin-3d5660b8b090', 0)).toBe('Fade 84,87%'); // R8 Revolver | Fade
    expect(patternLabel('skin-3d5660b8b090', 1000)).toBe('Fade 81,42%');
    expect(patternLabel('skin-657a59e6566b', 0)).toBe('Fade 95,13%'); // Karambit | Fade
    expect(patternLabel('skin-657a59e6566b', 1000)).toBeNull();
});

test('Case Hardened shows measured playside coverage and flags verified Blue Gem seeds', () => {
    expect(patternLabel('skin-5fd3ee42a6c4', 661)).toBe('Blue Gem · Xanh mặt chính 76,13%'); // AK-47 | Case Hardened
    expect(patternLabel('skin-5fd3ee42a6c4', 0)).toBe('Xanh mặt chính 1,31%');
    expect(patternLabel('skin-133e4c36778f', 0)).toBe('Xanh mặt chính 0,00%');
    expect(patternLabel('skin-133e4c36778f', 868)).toBe('Blue Gem · Xanh mặt chính 100,00%');
    expect(patternLabel('skin-c187005d5542', 387)).toBe('Blue Gem · Xanh mặt chính 95,11%');
    expect(patternLabel('skin-688d607e4dec', 182)).toBe('Blue Gem · Xanh mặt chính 85,67%');
    expect(patternLabel('skin-8d6879f0a2bc', 661)).toBeNull();
    expect(patternLabel('skin-5fd3ee42a6c4', undefined)).toBeNull();
});
