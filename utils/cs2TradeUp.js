const crypto = require('node:crypto');
const { containersById, skins } = require('./cs2Catalogue');
const { tradeUpPool } = require('./cs2TradeUpCatalogue');

const COVERT = 3;

const storedFloat = value => Math.round(value * 1_000_000) / 1_000_000;

function inputInfo(drop) {
    if (!drop || drop.locked === true || typeof drop.id !== 'string' || !drop.id ||
        !Number.isInteger(drop.tier) || drop.tier < 0 || drop.tier > COVERT ||
        (drop.statTrak != null && typeof drop.statTrak !== 'boolean')) return null;
    const weaponCase = containersById.get(drop.caseId);
    if (!weaponCase || !tradeUpPool(weaponCase, drop.tier).includes(drop.skinId)) return null;
    const skin = skins[drop.skinId];
    const statTrak = drop.statTrak === true;
    if ((statTrak && !skin.stattrak) || !Number.isFinite(drop.float) ||
        !Number.isFinite(skin.min) || !Number.isFinite(skin.max) || skin.min >= skin.max ||
        drop.float < storedFloat(skin.min) || drop.float > storedFloat(skin.max)) return null;

    const pool = tradeUpPool(weaponCase, drop.tier + 1);
    if (!pool.some(skinId => !statTrak || skins[skinId].stattrak)) return null;
    // Inputs are already stored at six decimals. Clamp rounding at an exterior bound.
    const wear = Math.max(0, Math.min(1, (drop.float - skin.min) / (skin.max - skin.min)));
    return { weaponCase, tier: drop.tier, statTrak, required: drop.tier === COVERT ? 5 : 10, wear };
}

function isTradeUpInput(drop) {
    return inputInfo(drop) !== null;
}

function tradeUpGroups(drops = []) {
    const groups = new Map();
    const seen = new Set();
    for (const drop of drops) {
        const info = inputInfo(drop);
        if (!info || seen.has(drop.id)) continue;
        seen.add(drop.id);
        const { tier, statTrak, required } = info;
        const key = `${tier}/${statTrak}`;
        if (!groups.has(key)) groups.set(key, { tier, statTrak, required, count: 0 });
        groups.get(key).count++;
    }
    return [...groups.values()].sort((left, right) => left.tier - right.tier || Number(left.statTrak) - Number(right.statTrak));
}

function outputPool(weaponCase, tier, statTrak, wear) {
    const finishes = new Map();
    for (const skinId of tradeUpPool(weaponCase, tier)) {
        const skin = skins[skinId];
        if (statTrak && !skin.stattrak) continue;
        const float = skin.min == null || skin.max == null ? null : storedFloat(skin.min + wear * (skin.max - skin.min));
        const result = { caseId: weaponCase.id, skinId, tier, float, statTrak };
        // Doppler phases share a base finish, so they do not add tickets to its collection.
        const finish = tier === COVERT + 1 ? skin.name : skinId;
        if (!finishes.has(finish)) finishes.set(finish, []);
        finishes.get(finish).push(result);
    }
    return [...finishes.values()].map(variants => variants.length === 1 ? variants[0] : { ...variants[0], variants });
}

function buildTradeUp(drops) {
    if (!Array.isArray(drops) || !drops.length) throw new Error('Hãy chọn vật phẩm cho hợp đồng Trade Up.');
    const inputs = drops.map(inputInfo);
    if (inputs.some(input => !input)) throw new Error('Có vật phẩm không đủ điều kiện Trade Up.');
    if (new Set(drops.map(drop => drop.id)).size !== drops.length) throw new Error('Mỗi vật phẩm chỉ được dùng một lần.');
    const { required, tier, statTrak } = inputs[0];
    if (inputs.some(input => input.tier !== tier || input.statTrak !== statTrak)) {
        throw new Error('Hãy chọn vật phẩm cùng độ hiếm và cùng loại Thường hoặc StatTrak.');
    }
    if (drops.length !== required) throw new Error(`Hợp đồng này cần đúng ${required} vật phẩm.`);

    const wear = inputs.reduce((sum, input) => sum + input.wear, 0) / required;
    const counts = new Map();
    for (const { weaponCase } of inputs) counts.set(weaponCase, (counts.get(weaponCase) ?? 0) + 1);
    const sources = [...counts].map(([weaponCase, count]) => ({
        caseId: weaponCase.id, count, outcomes: outputPool(weaponCase, tier + 1, statTrak, wear)
    }));
    return { required, tier, statTrak, sources };
}

function drawTradeUp(plan, randomInt = crypto.randomInt) {
    let ticket = randomInt(plan.required);
    for (const { count, outcomes } of plan.sources) {
        if (ticket < count) {
            const { variants, ...outcome } = outcomes[randomInt(outcomes.length)];
            // Valve has not published phase weights. The simulator splits the selected finish equally.
            return variants ? { ...variants[randomInt(variants.length)] } : outcome;
        }
        ticket -= count;
    }
    throw new Error('Hợp đồng Trade Up không hợp lệ.');
}

module.exports = { tradeUpGroups, isTradeUpInput, buildTradeUp, drawTradeUp };
