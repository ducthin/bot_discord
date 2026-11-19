const { containers, keys, skins } = require('./cs2Catalogue');

const wearNames = Object.freeze(['Factory New', 'Minimal Wear', 'Field-Tested', 'Well-Worn', 'Battle-Scarred']);
// Match the exterior categories used for Steam listings, including the 0.38 and 0.45 cutoffs.
const wearBounds = Object.freeze([0, 0.07, 0.15, 0.38, 0.45, 1]);
const wearCutoffs = wearBounds.slice(1, -1);
const caseNames = new Map(containers.filter(container => !container.nonMarketable)
    .map(({ id, name, marketHashName }) => [id, marketHashName ?? name]));
const caseMarketNames = new Set(caseNames.values());
// Steam lists only grandfathered keys that could be traded before the October 2019 change.
const marketableKeys = new Set([
    'key-1385', 'key-1383', 'key-1375', 'key-1374', 'key-1373', 'key-1366', 'key-1365',
    'key-1364', 'key-1356', 'key-1351', 'key-1350', 'key-1347', 'key-7000', 'key-1334',
    'key-1333', 'key-1330', 'key-1325', 'key-1323', 'key-1322', 'key-1204', 'key-1309',
    'key-1305', 'key-1303', 'key-1203', 'key-1214'
]);

function wearIndex(float) {
    const nextExterior = wearCutoffs.findIndex(bound => float < bound);
    return nextExterior < 0 ? wearNames.length - 1 : nextExterior;
}

function getCaseMarketHashName(caseId) {
    return caseNames.get(caseId) ?? null;
}

function isCaseMarketHashName(name) {
    return caseMarketNames.has(name);
}

function marketQuoteKey(name, phase, paintSeed) {
    const base = phase == null ? name : `${name}\u0000${phase}`;
    return paintSeed == null ? base : `${base}\u0000seed:${paintSeed}`;
}

function getKeyMarketHashName(keyId) {
    return marketableKeys.has(keyId) ? keys[keyId].name : null;
}

function getDropMarketHashName(drop) {
    if (typeof drop?.skinId !== 'string' || !Object.hasOwn(skins, drop.skinId)) return null;
    const skin = skins[drop.skinId];
    if (drop.statTrak != null && typeof drop.statTrak !== 'boolean') return null;
    if (drop.statTrak && !skin.stattrak) return null;

    // Steam groups Doppler phases and gems under the finish's base name.
    let name = skin.name;
    if (drop.statTrak) {
        name = name.startsWith('★ ') ? `★ StatTrak™ ${name.slice(2)}` : `StatTrak™ ${name}`;
    }
    if (skin.min == null && skin.max == null) return drop.float == null ? name : null;

    // Stored rolls and their catalogue bounds use six-decimal precision.
    const min = Math.round(skin.min * 1000000) / 1000000;
    const max = Math.round(skin.max * 1000000) / 1000000;
    if (!Number.isFinite(drop.float) || drop.float < min || drop.float > max) return null;
    return `${name} (${wearNames[wearIndex(drop.float)]})`;
}

module.exports = { getCaseMarketHashName, isCaseMarketHashName, getKeyMarketHashName, getDropMarketHashName, marketQuoteKey,
    wearIndex, wearNames, wearBounds };
