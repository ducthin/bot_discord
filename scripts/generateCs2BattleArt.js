// Regenerate the local raster catalogue: node scripts/generateCs2BattleArt.js
// Append new catalogue art without changing existing covers: add --only-missing.
// Render specific covers: add --ids battle-p250,battle-five-seven.
// Keep an expansion preview separate: add --selected-sheet contact-sheet-expansion.jpg.
// Requires Python 3 with Pillow and NumPy. Missing catalogue cutouts are downloaded
// once; subsequent runs use the checked-in sources and work offline.
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseArgs } = require('node:util');
const { customCases } = require('../utils/cs2BattleCases');
const { skins } = require('../utils/cs2Catalogue');
const reel = require('../utils/cs2Reel');
const { getBlueGemArt } = require('../utils/cs2BlueGemArt');

const root = path.join(__dirname, '..', 'assets', 'cs2-battle-art');

async function main() {
    const { values } = parseArgs({ options: { 'only-missing': { type: 'boolean' }, ids: { type: 'string' }, 'selected-sheet': { type: 'string' } } });
    const ids = values.ids === undefined ? null : new Set(values.ids.split(',').map(id => id.trim()).filter(Boolean));
    await fs.mkdir(path.join(root, 'sources'), { recursive: true });
    const manifest = customCases.map((item, index) => {
        const drop = item.legacyEntries.at(-1).drop;
        const blueArt = item.blueOnly ? getBlueGemArt(drop) : null;
        if (item.blueOnly && !blueArt) throw new Error('Blue Gem cover requires a registered seed reference');
        const secondary = index >= 72 && !blueArt ? [...item.legacyEntries].reverse().find(entry => entry.drop.skinId !== drop.skinId)?.drop : null;
        return { id: item.id, name: item.name, group: item.group, index, skinId: drop.skinId,
            source: blueArt ? `../cs2-blue-gems/${blueArt.filename}` : `sources/${drop.skinId}.png`,
            sourceUrl: blueArt?.sourceUrl ?? skins[drop.skinId].image,
            ...(blueArt ? { paintSeed: drop.paintSeed, patternUrl: blueArt.patternUrl } : {}),
            ...(secondary ? { secondarySkinId: secondary.skinId, secondarySource: `sources/${secondary.skinId}.png`, secondarySourceUrl: skins[secondary.skinId].image } : {}) };
    });
    if (ids && (!ids.size || [...ids].some(id => !manifest.some(item => item.id === id)))) throw new Error('Unknown or empty Battle case IDs');
    const selected = [];
    for (const item of manifest) {
        if (ids && !ids.has(item.id)) continue;
        if (values['only-missing']) {
            try { await fs.access(path.join(root, `${item.id}.png`)); continue; } catch { /* Cover needs rendering. */ }
        }
        selected.push(item);
    }
    const cutouts = selected.flatMap(item => [item, ...(item.secondarySkinId ? [{ skinId: item.secondarySkinId, source: item.secondarySource, sourceUrl: item.secondarySourceUrl }] : [])]);
    const sources = [...new Map(cutouts.map(item => [item.skinId, item])).values()];
    let position = 0;
    await Promise.all(Array.from({ length: 3 }, async () => {
        while (position < sources.length) {
            const item = sources[position++];
            const file = path.join(root, item.source);
            try { await fs.access(file); } catch {
                const image = await reel.cachedImage(item.sourceUrl);
                if (image.length > 3 * 1024 * 1024) throw new Error('Source image exceeds artwork limit');
                await fs.writeFile(file, image);
            }
        }
    }));
    await fs.writeFile(path.join(root, 'catalogue.json'), JSON.stringify(manifest, null, 2));
    const args = [path.join(__dirname, 'generateCs2BattleArt.py'), root];
    if (values['only-missing']) args.push('--only-missing');
    if (ids) args.push('--ids', [...ids].join(','));
    if (values['selected-sheet']) args.push('--selected-sheet', values['selected-sheet']);
    const result = spawnSync(process.env.BATTLE_ART_PYTHON || 'python', args,
        { stdio: 'inherit', windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = result.status || 1;
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
