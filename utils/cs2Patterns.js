const { fade, blue } = require('../assets/cs2-patterns.json');

const MAX_PAINT_SEED = 1000;
const percent = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NO_GEM_SEEDS = Object.freeze([]);
const gemSeedsBySkin = new Map(Object.entries(blue).filter(([, pattern]) => pattern.gems)
    .map(([skinId, pattern]) => [skinId, Object.freeze([...pattern.gems])]));

function blueGemSeeds(skinId) {
    return gemSeedsBySkin.get(skinId) ?? NO_GEM_SEEDS;
}

function isBlueGem(skinId, seed) {
    return Number.isInteger(seed) && seed >= 0 && seed <= MAX_PAINT_SEED && blueGemSeeds(skinId).includes(seed);
}

function patternLabel(skinId, seed) {
    if (!Number.isInteger(seed) || seed < 0 || seed > MAX_PAINT_SEED) return null;

    const fadePattern = fade[skinId];
    const fadePercent = fadePattern?.values?.[seed];
    if (Number.isInteger(fadePercent)) return `${fadePattern.name} ${percent.format(fadePercent / 100)}%`;

    const bluePattern = blue[skinId];
    const bluePercent = bluePattern?.values?.[seed];
    if (!Number.isInteger(bluePercent)) return null;
    const label = blueGemSeeds(skinId).includes(seed) ? 'Blue Gem · ' : '';
    return `${label}Xanh mặt chính ${percent.format(bluePercent / 100)}%`;
}

module.exports = { MAX_PAINT_SEED, patternLabel, isBlueGem, blueGemSeeds };
