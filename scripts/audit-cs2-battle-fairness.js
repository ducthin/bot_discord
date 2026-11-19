const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { loadBattleAudit } = require('./lib/load-battle-audit');
const { customCases, TICKETS } = require('../utils/cs2BattleCases');

// Offline Monte Carlo audit: real winner/tie logic and secure ticket draws.
// Prices are explicitly synthetic fixtures, never live market quotes. The fast
// lookup has exactly the published integer weights (also tested exhaustively in
// cs2BattleCases.test.js). No Discord, database, wallets, or renderer is used.
function distribution(item) {
    const tickets = [];
    for (const [index, entry] of item.entries.entries()) {
        const value = BigInt((entry.drop.tier + 1) ** 3 * 1000 + (entry.exterior ?? 0) * 10 + index + 1) * 100n;
        for (let count = 0; count < entry.weight; count++) tickets.push(value);
    }
    if (tickets.length !== TICKETS) throw new Error(`Invalid tickets: ${item.id}`);
    return { id: item.id, tickets };
}

function sampleScenario(engine, scenario) {
    const { count, teams, mode, tieRule, trials, schedule } = scenario;
    const players = Array.from({ length: count }, (_, index) => ({ id: `p${index + 1}`,
        ...(teams ? { team: index < 2 ? 'A' : 'B' } : {}) }));
    const groups = teams ? ['A', 'B'] : players.map(player => player.id);
    const groupOf = Object.fromEntries(players.map(player => [player.id, player.team ?? player.id]));
    const room = { id: 'offline-audit', players, mode, tieRule };
    const totals = Object.fromEntries(players.map(player => [player.id, 0n]));
    const buckets = groups.map(() => Array(groups.length + 1).fill(0));
    const sole = groups.map(() => 0);
    const tiedWins = groups.map(() => 0);
    const byes = groups.map(() => 0);
    let ties = 0;
    for (let trial = 0; trial < trials; trial++) {
        for (const player of players) totals[player.id] = 0n;
        for (const item of schedule) for (const player of players) {
            totals[player.id] += item.tickets[crypto.randomInt(TICKETS)];
        }
        const result = engine.chooseWinners(room, totals);
        const winningGroups = new Set(result.winners.map(id => groupOf[id]));
        if (result.tie) ties++;
        for (const [index, group] of groups.entries()) {
            if (!winningGroups.has(group)) continue;
            buckets[index][winningGroups.size]++;
            if (result.tie) tiedWins[index]++;
            else if (winningGroups.size === 1) sole[index]++;
        }
        // Count the initial bye only; later-round byes may belong to a group
        // which already won a coin and do not describe the initial assignment.
        for (const bye of result.tieBracket?.byes ?? []) {
            if (bye.round === 1) byes[groups.indexOf(bye.group)]++;
        }
    }
    const expected = 1 / groups.length;
    return { category: scenario.category, format: teams ? '2v2' : String(count), mode, tieRule,
        trials, schedule: schedule.map(item => item.id), tieRate: ties / trials,
        seats: groups.map((group, index) => {
            const credit = buckets[index].reduce((sum, value, size) => size ? sum + value / size : sum, 0);
            const squares = buckets[index].reduce((sum, value, size) => size ? sum + value / (size * size) : sum, 0);
            const rate = credit / trials;
            const variance = Math.max(0, (squares - credit * credit / trials) / (trials - 1));
            const standardError = Math.sqrt(variance / trials);
            const deviation = Math.abs(rate - expected);
            return { seat: group, expected, fractionalWinRate: rate, standardError,
                absoluteZ: deviation < 1e-12 ? 0 : standardError ? deviation / standardError : null,
                soleWinRate: sole[index] / trials, tiedWinRate: tiedWins[index] / trials,
                winningMemberRate: buckets[index].reduce((sum, value) => sum + value, 0) / trials,
                initialByeRate: byes[index] / trials };
        }) };
}

function main() {
    const options = Object.fromEntries(process.argv.slice(2).map(argument => argument.replace(/^--/, '').split('=')));
    const trials = Number(options.trials ?? 50_000);
    const focusTrials = Number(options['focus-trials'] ?? 200_000);
    const catalogueTrials = Number(options['catalogue-trials'] ?? 10_000);
    if (![trials, focusTrials, catalogueTrials].every(value => Number.isInteger(value) && value >= 1000 && value <= 1_000_000)) {
        throw new Error('Trials must be integers from 1000 to 1000000.');
    }
    const engine = loadBattleAudit();
    const catalogue = customCases.map(distribution);
    const balanced = catalogue.find(item => item.id === 'battle-balance');
    const farm = { id: 'fixture-99-percent-equal-low-value',
        tickets: Array.from({ length: TICKETS }, (_, index) => index < 9900 ? 100n : 100_000n) };
    const equal = { id: 'fixture-all-equal', tickets: Array(TICKETS).fill(100n) };
    const scenarios = [];
    const add = (base, modes = ['regular', 'crazy'], tieRules = ['split', 'sudden-death']) => {
        for (const mode of modes) for (const tieRule of tieRules) scenarios.push({ ...base, mode, tieRule });
    };
    for (const schedule of [[balanced], [farm], Array(10).fill(farm), [equal]]) {
        add({ category: 'focus-three-seats', count: 3, trials: focusTrials, schedule });
    }
    for (const count of [2, 4, 5, 6, 7, 8, 9, 10]) {
        add({ category: 'formats', count, trials, schedule: [balanced] });
        add({ category: 'sharing', count, trials: catalogueTrials, schedule: [balanced] }, ['sharing'], ['split']);
    }
    add({ category: 'sharing', count: 3, trials: catalogueTrials, schedule: [balanced] }, ['sharing'], ['split']);
    add({ category: 'formats', count: 4, teams: true, trials, schedule: [balanced] });
    // Odd brackets: force a tie to exercise every initial bye/coin path in 5–10.
    for (const count of [5, 6, 7, 8, 9, 10]) {
        add({ category: 'all-tied-brackets', count, trials, schedule: [equal] }, ['regular'], ['sudden-death']);
    }
    add({ category: 'fifty-rounds', count: 3, trials: catalogueTrials,
        schedule: Array.from({ length: 50 }, (_, index) => catalogue[index % catalogue.length]) });
    for (const item of catalogue) {
        add({ category: 'catalogue', count: 3, trials: catalogueTrials, schedule: [item] });
    }
    const started = performance.now();
    const results = scenarios.map((scenario, index) => {
        if (index % 24 === 0) process.stderr.write(`Auditing scenario ${index + 1}/${scenarios.length} (${scenario.category})...\n`);
        return sampleScenario(engine, scenario);
    });
    const measurements = results.reduce((sum, result) => sum + result.seats.length, 0);
    // Hoeffding + union bound: simultaneous 99% coverage across all reported
    // fractional win rates, including shared ties. No normal approximation.
    const alpha = 0.01;
    const warnings = [];
    for (const result of results) {
        result.simultaneousErrorBound = Math.sqrt(Math.log(2 * measurements / alpha) / (2 * result.trials));
        for (const seat of result.seats) {
            if (Math.abs(seat.fractionalWinRate - seat.expected) > result.simultaneousErrorBound) {
                warnings.push({ category: result.category, format: result.format, mode: result.mode,
                    tieRule: result.tieRule, schedule: result.schedule, seat: seat.seat });
            }
        }
    }
    const sourceHashes = Object.fromEntries(['cs2Battles.js', 'cs2BattleCases.js', 'cs2DiscoveryCases.js', 'cs2IconicCases.js'].map(file => [file,
        crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', 'utils', file))).digest('hex')]));
    const report = { generatedAt: new Date().toISOString(), node: process.version, sourceHashes,
        priceSource: 'synthetic positive price fixtures; published weights; never live market prices',
        methodology: 'Actual chooseWinners/breakTie; independent crypto.randomInt(10000) per opening; ' +
            'fractional win credit 1/number of winning sides (teams counted as two sides); ' +
            'simultaneous 99% Hoeffding bounds across all seat measurements. No observed player history.',
        seconds: (performance.now() - started) / 1000, scenarios: results.length, measurements,
        battles: results.reduce((sum, result) => sum + result.trials, 0),
        openings: results.reduce((sum, result) => sum + result.trials * (result.format === '2v2' ? 4 : Number(result.format)) * result.schedule.length, 0),
        warnings, results };
    const output = path.resolve(options.output ?? path.join(__dirname, '..', '.runtime', 'battle-fairness.json'));
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ output, scenarios: report.scenarios, battles: report.battles,
        openings: report.openings, seconds: report.seconds, warnings: warnings.length })}\n`);
    if (warnings.length) process.exitCode = 1;
}

if (require.main === module) main();
module.exports = { distribution, sampleScenario };
