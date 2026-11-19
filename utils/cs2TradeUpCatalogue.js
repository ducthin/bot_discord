const { skins } = require('./cs2Catalogue');

// Valve's Huntsman collection still lists these two finishes after their removal from the case.
// They are the collection-only successors reachable from the bot's supported input tiers.
const HUNTSMAN_CASE_ID = 'crate-4017';
const huntsmanSuccessors = {
    1: 'skin-c928639d51cb', // MAC-10 | Curse
    2: 'skin-a503e5d8d0b7' // USP-S | Orion
};

function tradeUpPool(weaponCase, tier) {
    if (weaponCase.tradeUp === false) return [];
    const pool = weaponCase.pools[tier] ?? [];
    const extra = weaponCase.id === HUNTSMAN_CASE_ID ? huntsmanSuccessors[tier] : undefined;
    return (extra ? [...pool, extra] : pool).filter(skinId => skins[skinId]?.tradeUp !== false);
}

module.exports = { tradeUpPool };
