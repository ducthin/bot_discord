const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { cases, containersById, skins } = require('../utils/cs2Catalogue');
const { tiers: standardTiers, TICKETS: standardTickets } = require('../utils/cs2NormalCases');
const { COIN_SCALE } = require('../utils/coins');
const { MAX_PAINT_SEED, isBlueGem } = require('../utils/cs2Patterns');
const { wearBounds, marketQuoteKey } = require('../utils/cs2MarketNames');
const market = require('../utils/cs2Market');
const { TICKETS, customCases, casePricing, riskMetrics, lockCasePricing, lockedCase, rollCustomCase } = require('../utils/cs2BattleCases');

// Read-only, offline audit. Importing catalogue/pricing helpers does not start their
// refreshers. Cache rows are historical observations, not permission to trade on
// stale prices. This script never loads .env, the store, Discord, or the network.
const ROOT = path.join(__dirname, '..');
const SEEDS = MAX_PAINT_SEED + 1;
const JOINT_TICKETS = BigInt(TICKETS * SEEDS);
const RETURN_PERCENT = 95n;

function readJson(relative) {
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function validEntry(entry, candidate = false) {
    const skin = skins[entry?.drop?.skinId];
    const source = containersById.get(entry?.drop?.caseId);
    if (!skin || !source?.pools[entry.drop.tier]?.includes(entry.drop.skinId) ||
        !Number.isSafeInteger(entry.weight) || entry.weight < (candidate ? 0 : 1) ||
        typeof entry.drop.statTrak !== 'boolean' || entry.drop.statTrak && !skin.stattrak) return false;
    const ref = market.getDropMarketQuoteRef(entry.drop);
    if (!ref || marketQuoteKey(ref.name, ref.phase, ref.paintSeed) !==
        marketQuoteKey(entry.ref?.name, entry.ref?.phase, entry.ref?.paintSeed)) return false;
    if (entry.drop.priceVariant != null && (entry.drop.priceVariant !== 'blue-gem' ||
        !isBlueGem(entry.drop.skinId, entry.drop.paintSeed))) return false;
    if (entry.exterior === null) return skin.min == null && skin.max == null && entry.min === null && entry.max === null;
    if (!Number.isInteger(entry.exterior) || entry.exterior < 0 || entry.exterior > 4 ||
        !Number.isInteger(entry.min) || !Number.isInteger(entry.max)) return false;
    const min = Math.max(Math.round(skin.min * 1_000_000), Math.round(wearBounds[entry.exterior] * 1_000_000));
    const max = Math.min(Math.round(skin.max * 1_000_000),
        Math.round(wearBounds[entry.exterior + 1] * 1_000_000) - Number(entry.exterior < 4));
    return min <= max && entry.min === min && entry.max === max;
}

// Equal-price variants may have different allocations. Every ticket allocation
// at a higher price must be at most the smallest allocation at any lower price.
// Keep whole equal-price buckets together so source order cannot hide a violation.
function priceOddsInversions(pricing) {
    if (!Array.isArray(pricing?.entries) || !Array.isArray(pricing.values) ||
        pricing.entries.length !== pricing.values.length) return [];
    let rows;
    try {
        rows = pricing.entries.map((entry, index) => ({ value: BigInt(pricing.values[index]), weight: entry.weight, index }));
    } catch { return []; }
    if (rows.some(row => row.value <= 0n || !Number.isSafeInteger(row.weight) || row.weight < 1)) return [];
    rows.sort((left, right) => left.value === right.value ? left.index - right.index : left.value < right.value ? -1 : 1);
    const errors = [];
    let cheapestAllocation = null;
    for (let offset = 0; offset < rows.length;) {
        const value = rows[offset].value;
        let minimum = rows[offset], maximum = rows[offset], end = offset + 1;
        while (end < rows.length && rows[end].value === value) {
            if (rows[end].weight < minimum.weight) minimum = rows[end];
            if (rows[end].weight > maximum.weight) maximum = rows[end];
            end++;
        }
        if (cheapestAllocation && maximum.weight > cheapestAllocation.weight) {
            errors.push({ cheaperIndex: cheapestAllocation.index, cheaperValue: cheapestAllocation.value.toString(),
                cheaperTickets: cheapestAllocation.weight, expensiveIndex: maximum.index,
                expensiveValue: value.toString(), expensiveTickets: maximum.weight });
        }
        if (!cheapestAllocation || minimum.weight < cheapestAllocation.weight) cheapestAllocation = minimum;
        offset = end;
    }
    return errors;
}

function checkPricing(pricing) {
    const errors = [];
    if (!pricing?.entries?.length) return ['Missing pricing'];
    if (typeof pricing.fee !== 'bigint' || pricing.fee <= 0n) return ['Invalid fee'];
    if (pricing.entries.some(entry => !validEntry(entry))) errors.push('Invalid priced entry');
    if (pricing.entries.reduce((sum, entry) => sum + entry.weight, 0) !== TICKETS) errors.push('Priced tickets do not total 10000');
    if (priceOddsInversions(pricing).length) errors.push('More expensive reward has more tickets than a cheaper reward');
    const metrics = riskMetrics(pricing);
    if (!metrics) return [...errors, 'Invalid risk metrics'];
    if (Math.abs(metrics.lossTickets + metrics.profitTickets + metrics.breakEvenTickets - TICKETS) > 1e-8) {
        errors.push('Risk tickets do not total 10000');
    }
    for (const kind of ['lossTickets', 'profitTickets', 'breakEvenTickets']) {
        if (!Number.isFinite(pricing[kind]) || Math.abs(pricing[kind] - metrics[kind]) > 1e-8) errors.push(`Published ${kind} differs from prices`);
    }
    const weighted = pricing.entries.reduce((sum, entry, index) => {
        const seedPrices = entry.seedPrices ?? [];
        const jointValue = BigInt(pricing.values[index]) * BigInt(SEEDS - seedPrices.length) +
            seedPrices.reduce((total, [, value]) => total + BigInt(value), 0n);
        return sum + jointValue * BigInt(entry.weight);
    }, 0n);
    const numerator = weighted * COIN_SCALE * 100n;
    const denominator = JOINT_TICKETS * RETURN_PERCENT;
    if (pricing.fee * denominator < numerator) errors.push('Expected return exceeds 95%');
    if ((pricing.fee - 1n) * denominator >= numerator) errors.push('Fee exceeds the exact EV / 95% ceiling');
    if (pricing.expected !== weighted * COIN_SCALE / JOINT_TICKETS) errors.push('Expected value differs from joint seed distribution');
    return errors;
}

function pricingSummary(item, pricing) {
    if (!pricing) return { available: false };
    const goldTickets = pricing.entries.reduce((sum, entry) => sum + (entry.drop.tier === 4 ? entry.weight : 0), 0);
    const restored = lockedCase(item, lockCasePricing(pricing));
    const errors = checkPricing(pricing);
    if (goldTickets !== pricing.goldTickets) errors.push('Published priced gold tickets mismatch');
    const bandTickets = pricing.bandTickets;
    const bands = ['common', 'regular', 'premium', 'jackpot'];
    if (!bandTickets || bands.some(band => !Number.isSafeInteger(bandTickets[band]) || bandTickets[band] < 0) ||
        bands.reduce((sum, band) => sum + bandTickets[band], 0) !== TICKETS) errors.push('Priced band tickets do not total 10000');
    if (bandTickets && pricing.jackpotTickets !== bandTickets.jackpot) errors.push('Published priced jackpot tickets mismatch');
    if (!Array.isArray(pricing.ticketProfile) || pricing.ticketProfile.length !== bands.length ||
        bands.some((band, index) => pricing.ticketProfile[index] !== bandTickets?.[band])) errors.push('Published priced ticket profile mismatch');
    if (!restored || JSON.stringify(restored.entries) !== JSON.stringify(pricing.entries)) errors.push('Locked snapshot did not round-trip');
    return { available: true, entries: pricing.entries.length, feeCents: pricing.fee.toString(),
        expectedCents: pricing.expected.toString(), lossPercent: pricing.lossTickets / 100,
        profitPercent: pricing.profitTickets / 100, breakEvenPercent: pricing.breakEvenTickets / 100,
        risk: pricing.riskLevel, goldPercent: goldTickets / 100, jackpotPercent: pricing.jackpotTickets / 100,
        bandTickets, ticketProfile: pricing.ticketProfile, valueOddsInversions: priceOddsInversions(pricing),
        seedQuoteEntries: pricing.entries.filter(entry => entry.seedPrices?.length).length, errors };
}

function syntheticPrice(entry) {
    const digest = crypto.createHash('sha256').update(marketQuoteKey(entry.ref.name, entry.ref.phase, entry.ref.paintSeed)).digest();
    const base = [100, 1000, 10000, 100000, 1000000][entry.drop.tier];
    return base + digest.readUInt16BE() % base;
}

function readCache() {
    const snapshot = readJson('data/cs2-price-snapshot.json');
    const blue = readJson('data/cs2-blue-gem-prices.json');
    const quotes = new Map();
    for (const [key, priceVnd, observedAt, phase = null] of snapshot?.quotes ?? []) {
        if (Number.isSafeInteger(priceVnd) && priceVnd > 0) quotes.set(key, { priceVnd, observedAt, phase, source: 'buff' });
    }
    for (const row of blue?.rows ?? []) {
        if (Number.isSafeInteger(row.priceVnd) && row.priceVnd > 0) quotes.set(marketQuoteKey(row.name, null, row.paintSeed),
            { priceVnd: row.priceVnd, observedAt: row.observedAt, phase: null, paintSeed: row.paintSeed, source: 'csfloat' });
    }
    return { quotes, updatedAt: snapshot?.updatedAt ?? null, blueCheckedAt: blue?.checkedAt ?? null };
}

function withQuoteReader(reader, run) {
    const original = market.peekMarketQuote;
    market.peekMarketQuote = reader;
    try { return run(); } finally { market.peekMarketQuote = original; }
}

function auditCatalogue() {
    const failures = [];
    const tiers = standardTiers.map(({ name, weight }) => ({ name, weight }));
    const total = standardTickets;
    const standard = cases.map(item => {
        const errors = [];
        if (item.pools.length !== tiers.length || item.pools.some(pool => !pool.length)) errors.push('Missing rarity pool');
        if (item.pools.flat().some(id => !skins[id])) errors.push('Unknown skin');
        if (new Set(item.pools.flat()).size !== item.pools.flat().length) errors.push('Duplicate skin in case');
        if (errors.length) failures.push(...errors.map(error => `${item.id}: ${error}`));
        return { id: item.id, name: item.name, pools: item.pools.map(pool => pool.length), errors };
    });
    const cache = readCache();
    const custom = customCases.map(item => {
        const errors = [];
        const key = entry => marketQuoteKey(entry.ref.name, entry.ref.phase, entry.ref.paintSeed);
        if (item.entries.some(entry => !validEntry(entry))) errors.push('Invalid published entry');
        if (item.candidates.some(entry => !validEntry(entry, true))) errors.push('Invalid candidate');
        if (item.entries.reduce((sum, entry) => sum + entry.weight, 0) !== TICKETS) errors.push('Published tickets do not total 10000');
        const goldTickets = item.entries.reduce((sum, entry) => sum + (entry.drop.tier === 4 ? entry.weight : 0), 0);
        const jackpotTickets = item.entries.reduce((sum, entry) => sum +
            (item.bandByKey.get(key(entry)) === 'jackpot' ? entry.weight : 0), 0);
        if (goldTickets !== item.goldTickets) errors.push('Published gold tickets mismatch');
        if (jackpotTickets !== item.jackpotTickets) errors.push('Published jackpot tickets mismatch');
        if (item.ticketProfile) {
            const bands = ['common', 'regular', 'premium', 'jackpot'];
            const profile = bands.map(band => item.entries.reduce((sum, entry) => sum +
                (item.bandByKey.get(key(entry)) === band ? entry.weight : 0), 0));
            if (profile.some((weight, index) => weight !== item.ticketProfile[index])) errors.push('Published ticket profile mismatch');
        }
        // Exercise every actual ticket range through the production draw function.
        let boundary = 0;
        const values = item.entries.map((_, index) => index + 1);
        for (const [index, entry] of item.entries.entries()) {
            for (let ticket = boundary; ticket < boundary + entry.weight; ticket++) {
                const draw = (min, max) => max == null ? min === TICKETS ? ticket : 0 : min;
                const outcome = rollCustomCase(item, values, 'audit', 1, draw);
                if (outcome.drop.skinId !== entry.drop.skinId || outcome.value !== BigInt(index + 1) * COIN_SCALE) {
                    errors.push(`Draw disagrees with published ticket ${ticket}`);
                    break;
                }
            }
            boundary += entry.weight;
        }
        const synthetic = withQuoteReader((name, ref) => ref?.paintSeed == null ? null :
            { source: 'csfloat', paintSeed: ref.paintSeed, priceVnd: 2_000_000 + ref.paintSeed * 1000 },
        () => pricingSummary(item, casePricing(item, syntheticPrice)));
        const cached = withQuoteReader((name, ref) => cache.quotes.get(marketQuoteKey(name, ref?.phase, ref?.paintSeed)) ?? null,
            () => pricingSummary(item, casePricing(item, entry => cache.quotes.get(key(entry))?.priceVnd ?? null)));
        const missingCached = !cached.available ? item.entries.filter(entry => !cache.quotes.has(key(entry))).map(entry => entry.ref) : [];
        for (const [mode, pricing] of [['synthetic', synthetic], ['cached', cached]]) {
            for (const error of pricing.errors ?? []) errors.push(`${mode}: ${error}`);
        }
        if (!synthetic.available) errors.push('Synthetic pricing unavailable');
        failures.push(...errors.map(error => `${item.id}: ${error}`));
        return { id: item.id, name: item.name, entries: item.entries.length, candidates: item.candidates.length,
            goldPercent: goldTickets / 100, jackpotPercent: jackpotTickets / 100, synthetic, cached, missingCached, errors };
    });
    const sourceHashes = Object.fromEntries(['commands/hom.js', 'utils/cs2BattleCases.js', 'utils/cs2DiscoveryCases.js',
        'utils/cs2IconicCases.js', 'assets/cs2-iconic-collections.json',
        'assets/cs2-cases.json', 'assets/cs2-patterns.json'].filter(relative => fs.existsSync(path.join(ROOT, relative)))
        .map(relative => [relative, crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, relative))).digest('hex')]));
    return { generatedAt: new Date().toISOString(), offline: true, sourceHashes,
        methodology: 'Exact published tickets and raw profiles; exhaustive production ticket draws; every priced equal-value bucket checked against all cheaper allocations; actual priced gold/band/profile metadata; integer EV/95% fee checks; seed-aware risk sums; historical cache rows without network or freshness claims.',
        standardOdds: tiers.map(tier => ({ name: tier.name, weight: tier.weight, percent: tier.weight * 100 / total })),
        standardStatTrakPercent: 10, cacheUpdatedAt: cache.updatedAt && new Date(cache.updatedAt).toISOString(),
        blueCacheCheckedAt: cache.blueCheckedAt && new Date(cache.blueCheckedAt).toISOString(),
        standard, custom, summary: { standardCases: standard.length, customCases: custom.length,
            checkedTickets: custom.length * TICKETS, cachedAvailable: custom.filter(item => item.cached.available).length,
            cachedUnavailable: custom.filter(item => !item.cached.available).length,
            syntheticValueOddsViolations: custom.reduce((sum, item) => sum + (item.synthetic.valueOddsInversions?.length ?? 0), 0),
            cachedValueOddsViolations: custom.reduce((sum, item) => sum + (item.cached.valueOddsInversions?.length ?? 0), 0),
            cachedRisks: custom.reduce((counts, item) => { if (item.cached.available) counts[item.cached.risk] = (counts[item.cached.risk] ?? 0) + 1; return counts; }, {}) }, failures };
}

function main() {
    const options = process.argv.slice(2);
    if (options.some(option => option !== '--json' && !option.startsWith('--output='))) {
        throw new Error('Usage: node scripts/audit-cs2-case-odds.js [--json] [--output=path.json]');
    }
    const report = auditCatalogue();
    const output = options.find(option => option.startsWith('--output='))?.slice('--output='.length);
    if (output) {
        const target = path.resolve(output);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n');
    }
    if (options.includes('--json')) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    else {
        process.stdout.write(`${report.summary.standardCases} standard + ${report.summary.customCases} custom cases; ${report.summary.checkedTickets.toLocaleString('en-US')} ticket draws; ${report.failures.length} failures.\n`);
        process.stdout.write(`Historical cache: ${report.summary.cachedAvailable} priced, ${report.summary.cachedUnavailable} unavailable; risks ${JSON.stringify(report.summary.cachedRisks)}.\n`);
        for (const item of report.custom.filter(item => !item.cached.available)) process.stdout.write(`Missing cache: ${item.id} (${item.missingCached.map(ref => ref.name).join(', ') || 'required cheap replacements unavailable'}).\n`);
        if (report.failures.length) process.stdout.write(report.failures.join('\n') + '\n');
        if (output) process.stdout.write(`Report: ${path.resolve(output)}\n`);
    }
    if (report.failures.length) process.exitCode = 1;
}

if (require.main === module) main();
module.exports = { auditCatalogue, checkPricing, priceOddsInversions, validEntry };
