const fs = require('node:fs/promises');
const path = require('node:path');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const reel = require('../utils/cs2Reel');
const catalogue = require('../assets/cs2-battle-art/catalogue.json');

// Offline renderer load check. It never connects to Discord or uses player data.
async function main() {
    const options = Object.fromEntries(process.argv.slice(2).map(argument => argument.replace(/^--/, '').split('=')));
    const concurrency = (options.concurrency ?? '1,2,4').split(',').map(Number);
    const players = Number(options.players ?? 4);
    if (!concurrency.every(value => Number.isInteger(value) && value >= 1 && value <= 12) || ![2, 3, 4].includes(players)) {
        throw new Error('Use --concurrency=1,2,4 and --players=2,3,4');
    }
    const artwork = options.artwork ?? 'repeated';
    if (!['repeated', 'mixed'].includes(artwork)) throw new Error('Use --artwork=repeated or --artwork=mixed');
    const sources = artwork === 'mixed' ? [...new Map(catalogue.map(item => [item.source, item])).values()].slice(0, 24)
        : catalogue.slice(0, 4);
    const assets = await Promise.all(sources.map(item =>
        fs.readFile(path.join(__dirname, '..', 'assets', 'cs2-battle-art', item.source))));
    const savedFetch = global.fetch;
    global.fetch = async url => new Response(assets[Number(new URL(url).pathname.match(/battle-benchmark-(\d+)/)?.[1] ?? 0)],
        { headers: { 'content-type': 'image/png' } });
    const profile = options.profile ?? 'default';
    const roundsFor = seed => Array.from({ length: players }, (_, row) => {
        const imageFor = index => `https://community.akamai.steamstatic.com/economy/image/battle-benchmark-${artwork === 'mixed'
            ? (index + row * 7) % assets.length : row}`;
        const image = imageFor(24);
        const cards = Array.from({ length: 28 }, (_, index) => row === 0 && index === 24
            ? { mystery: 'default_rare_item.png', color: '#e4ae39' }
            : { image: imageFor(index), color: artwork === 'mixed' ? ['#4b69ff', '#8847ff', '#d32ce6', '#eb4b4b'][index % 4] : '#4b69ff' });
        return { cards, selectedIndex: 24, landingSeed: seed + row,
            result: { image, color: row === 0 ? '#e4ae39' : '#4b69ff', tier: row === 0 ? 4 : 0,
                title: 'Battle benchmark', detail: 'Offline artwork' } };
    });
    const measurements = [];
    let reuse;
    try {
        for (const count of concurrency) {
            process.stderr.write(`Rendering ${count} simultaneous ${players}-player rounds (${profile})...\n`);
            const loop = monitorEventLoopDelay({ resolution: 20 });
            loop.enable();
            const start = performance.now();
            const jobs = await Promise.all(Array.from({ length: count }, async (_, index) => {
                const media = await reel.renderCaseBatch(roundsFor(54 + count * 100 + index), 7_500_000, { profile });
                return { completedMs: Math.round(performance.now() - start), bytes: media?.gif?.length ?? 0,
                    rendered: Boolean(media?.gif?.length) };
            }));
            loop.disable();
            measurements.push({ concurrency: count, elapsedMs: Math.round(performance.now() - start),
                rendered: jobs.filter(job => job.rendered).length, jobs,
                eventLoopP99Ms: Math.round(loop.percentile(99) / 1e6),
                nodeRssMb: Math.round(process.memoryUsage().rss / 1024 / 1024) });
        }
        if (options.reuse === 'true') {
            const rounds = roundsFor(900_000);
            const start = performance.now();
            const [first, duplicate] = await Promise.all([
                reel.renderCaseBatch(rounds, 7_500_000, { profile }),
                reel.renderCaseBatch(rounds, 7_500_000, { profile })
            ]);
            const concurrentMs = Math.round(performance.now() - start);
            const cachedStart = performance.now();
            const cached = await reel.renderCaseBatch(rounds, 7_500_000, { profile });
            reuse = { concurrentMs, cachedMs: Math.round(performance.now() - cachedStart), bytes: cached?.gif?.length ?? 0,
                sharedConcurrentBuffer: Boolean(first?.gif && first.gif === duplicate?.gif),
                sharedCachedBuffer: Boolean(first?.gif && first.gif === cached?.gif) };
        }
    } finally { global.fetch = savedFetch; }
    const report = { players, profile, artwork, uniqueArtwork: assets.length, measurements, ...(reuse ? { reuse } : {}) };
    if (options.output) {
        const output = path.resolve(options.output);
        await fs.mkdir(path.dirname(output), { recursive: true });
        await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
    }
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
