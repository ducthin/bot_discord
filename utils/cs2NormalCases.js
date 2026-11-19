const crypto = require('node:crypto');
const { cases, skins } = require('./cs2Catalogue');
const { COIN_SCALE } = require('./coins');
const { MAX_PAINT_SEED } = require('./cs2Patterns');

const KEY_PRICE_AMOUNT = 60_000;
const KEY_PRICE = BigInt(KEY_PRICE_AMOUNT) * COIN_SCALE;
const normalCasesById = new Map(cases.map(item => [item.id, item]));

const tiers = [
    { name: 'Mil-Spec', icon: '🔵', color: '#4b69ff', weight: 3125 },
    { name: 'Restricted', icon: '🟣', color: '#8847ff', weight: 625 },
    { name: 'Classified', icon: '🩷', color: '#d32ce6', weight: 125 },
    { name: 'Covert', icon: '🔴', color: '#eb4b4b', weight: 25 },
    { name: 'Rare Special Item', icon: '⭐', color: '#e4ae39', weight: 10 }
];
const RARE_SPECIAL_TIER = tiers.length - 1;
const TICKETS = tiers.reduce((total, tier) => total + tier.weight, 0);

function caseEntries(weaponCase) {
    return weaponCase.pools.flatMap((pool, tier) => pool.map(skinId => ({
        skinId, tier, chance: (tiers[tier].weight / TICKETS * 100) / pool.length
    })));
}

function drawSkin(weaponCase, randomInt = crypto.randomInt, weight = TICKETS) {
    let roll = randomInt(weight);
    for (const [tier, rarity] of tiers.entries()) {
        if (roll < rarity.weight) {
            const pool = weaponCase.pools[tier];
            return { skinId: pool[randomInt(pool.length)], tier };
        }
        roll -= rarity.weight;
    }
    throw new Error('Invalid case rarity weights.');
}

function paintSeedFor(float, randomInt = crypto.randomInt) {
    return float == null ? {} : { paintSeed: randomInt(MAX_PAINT_SEED + 1) };
}

function rollDrop(weaponCase, id, acquiredAt, randomInt = crypto.randomInt) {
    const item = drawSkin(weaponCase, randomInt);
    const skin = skins[item.skinId];
    // The finish's float range uses six decimals for display and storage.
    const min = Math.round(skin.min * 1_000_000);
    const max = Math.round(skin.max * 1_000_000);
    const float = skin.min == null || skin.max == null ? null : randomInt(min, max + 1) / 1_000_000;
    return { id, caseId: weaponCase.id, ...item, float, acquiredAt, statTrak: skin.stattrak && randomInt(10) === 0,
        reelSeed: crypto.randomBytes(4).readUInt32BE(), ...paintSeedFor(float, randomInt) };
}

module.exports = { cases, normalCasesById, KEY_PRICE_AMOUNT, KEY_PRICE, tiers, RARE_SPECIAL_TIER, TICKETS, totalWeight: TICKETS,
    caseEntries, drawSkin, rollDrop, paintSeedFor };
