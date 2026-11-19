const crypto = require('node:crypto');
const cases = require('./cs2BattleCases');
const { COIN_SCALE } = require('./coins');

const VERSION = 2;
const MAX_ITEMS = 12;
const MAX_VARIANTS = 2;
const MAX_WEIGHT_BY_VERSION = Object.freeze({
    1: Math.floor(cases.TICKETS / 10),
    2: Math.floor(cases.TICKETS / 500)
});
const SUPPORTED_VERSIONS = Object.freeze(Object.keys(MAX_WEIGHT_BY_VERSION).map(Number));

function exclusivePlan(pricing, version = VERSION) {
    const maxWeight = MAX_WEIGHT_BY_VERSION[version];
    if (!pricing || typeof pricing.fee !== 'bigint' || pricing.fee <= 0n ||
        !Array.isArray(pricing.entries) || !Array.isArray(pricing.values) ||
        pricing.entries.length !== pricing.values.length ||
        pricing.entries.some(entry => !entry?.drop?.skinId || !Number.isSafeInteger(entry.weight) || entry.weight <= 0) ||
        pricing.entries.reduce((total, entry) => total + entry.weight, 0) !== cases.TICKETS ||
        pricing.values.some(value => !Number.isSafeInteger(value) || value <= 0) || !maxWeight) return null;

    const candidates = pricing.entries.map((entry, index) => ({ entry, index, value: BigInt(pricing.values[index]) * COIN_SCALE }))
        .filter(candidate => candidate.value >= pricing.fee * 2n)
        .sort((left, right) => left.value === right.value ? left.index - right.index : left.value > right.value ? -1 : 1);
    const variants = new Map(), indices = [];
    let weight = 0;
    for (const candidate of candidates) {
        const skinId = candidate.entry.drop.skinId;
        if ((variants.get(skinId) ?? 0) >= MAX_VARIANTS || weight + candidate.entry.weight > maxWeight) continue;
        indices.push(candidate.index);
        weight += candidate.entry.weight;
        variants.set(skinId, (variants.get(skinId) ?? 0) + 1);
        if (indices.length >= MAX_ITEMS) break;
    }
    return variants.size >= 3 ? { version, indices, weight } : null;
}

function describeExclusive(pricing, itemDTO, version = VERSION) {
    const plan = exclusivePlan(pricing, version);
    const chance = plan ? plan.weight / cases.TICKETS * 100 : 0;
    return { available: Boolean(plan), version, chance, indices: plan?.indices ?? [],
        items: plan ? plan.indices.map(index => ({
            ...itemDTO(pricing.entries[index].drop, BigInt(pricing.values[index]) * COIN_SCALE),
            id: `exclusive-${index}`, index, exclusiveEligible: true,
            chance: pricing.entries[index].weight / plan.weight * 100,
            overallChance: pricing.entries[index].weight / cases.TICKETS * 100 })) : [],
        trigger: plan ? { id: 'exclusive-drop', name: 'Exclusive Drop', isExclusiveTrigger: true,
            tier: 4, rarity: 'Exclusive Drop', color: '#e4ae39', chance } : null };
}

function rollExclusiveCase(locked, pricing, id, now, draw = crypto.randomInt, enabled = true, version = VERSION) {
    const plan = enabled ? exclusivePlan(pricing, version) : null;
    if (!plan) return cases.rollCustomCase(locked, pricing.values, id, now, draw);

    const exclusiveIndices = new Set(plan.indices);
    const offsets = [];
    let offset = 0;
    for (const entry of locked.entries) {
        offsets.push(offset);
        offset += entry.weight;
    }

    // Round one keeps regular items in their original order and combines the
    // selected tickets into one trigger. Round two uses their original weights,
    // preserving every final item's probability and the existing case price.
    const firstTicket = draw(cases.TICKETS);
    let ticket, exclusive;
    if (firstTicket >= cases.TICKETS - plan.weight) {
        const secondTicket = draw(plan.weight);
        let remaining = secondTicket;
        for (const index of plan.indices) {
            if (remaining < locked.entries[index].weight) {
                ticket = offsets[index] + remaining;
                exclusive = { triggered: true, version: plan.version, firstTicket, secondTicket, entryIndex: index,
                    chance: plan.weight / cases.TICKETS * 100 };
                break;
            }
            remaining -= locked.entries[index].weight;
        }
    } else {
        let remaining = firstTicket;
        for (let index = 0; index < locked.entries.length; index++) {
            if (exclusiveIndices.has(index)) continue;
            if (remaining < locked.entries[index].weight) {
                ticket = offsets[index] + remaining;
                break;
            }
            remaining -= locked.entries[index].weight;
        }
    }

    let firstDraw = true;
    const outcome = cases.rollCustomCase(locked, pricing.values, id, now, (...args) => {
        if (firstDraw) { firstDraw = false; return ticket; }
        return draw(...args);
    });
    if (exclusive) {
        outcome.drop.exclusiveDrop = true;
        outcome.exclusive = exclusive;
    }
    return outcome;
}

module.exports = { VERSION, SUPPORTED_VERSIONS, exclusivePlan, describeExclusive, rollExclusiveCase };
