const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const revision = require('../assets/cs2-cases.json').source.revision;
const collectionNames = [
    'The Cobblestone Collection', 'The Norse Collection', 'The Gods and Monsters Collection',
    'The St. Marc Collection', 'The 2021 Dust 2 Collection', 'The 2021 Mirage Collection',
    'The 2021 Vertigo Collection', 'The Canals Collection', 'The Rising Sun Collection',
    'The Havoc Collection', 'The Control Collection', 'The Ancient Collection',
    'The Chop Shop Collection', 'The Bank Collection', 'The Assault Collection',
    'The Dust Collection', 'The Dust 2 Collection', 'The Mirage Collection', 'The Italy Collection',
    'The Cache Collection', 'The Baggage Collection', 'The Overpass Collection',
    'The Nuke Collection', 'The Inferno Collection', 'The Anubis Collection',
    'The Overpass 2024 Collection', 'The 2021 Train Collection', 'The Sport & Field Collection',
    'The Graphic Design Collection', 'The 2018 Inferno Collection'
];
const rarityTiers = new Map([
    ['rarity_rare_weapon', 0], ['rarity_mythical_weapon', 1],
    ['rarity_legendary_weapon', 2], ['rarity_ancient_weapon', 3]
]);

async function readSource(name, inputDirectory) {
    if (inputDirectory) return JSON.parse(fs.readFileSync(path.join(inputDirectory, `${name}.json`), 'utf8'));
    const url = `https://raw.githubusercontent.com/ByMykel/CSGO-API/${revision}/public/api/en/${name}.json`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Unable to fetch ${url}: HTTP ${response.status}`);
    return response.json();
}

function buildCatalogue(upstreamSkins, upstreamCollections) {
    const existingSkins = {
        ...require('../assets/cs2-cases.json').skins,
        ...require('../assets/cs2-terminals.json').skins
    };
    const skinsById = new Map(upstreamSkins.map(skin => [skin.id, skin]));
    const collectionsByName = new Map(upstreamCollections.map(collection => [collection.name, collection]));
    const catalogue = {
        source: {
            project: 'ByMykel/CSGO-API', revision,
            scope: 'Mil-Spec and higher weapon finishes from selected collections; standalone Contraband Howl.'
        },
        collections: [],
        skins: {}
    };
    const finishes = {};
    const collectionLabels = {};
    const index = [];

    function addSkin(skin, collectionId, tier, extra = {}) {
        if (!skin || !Number.isFinite(skin.min_float) || !Number.isFinite(skin.max_float)) {
            throw new Error(`Missing finish metadata in ${collectionId}`);
        }
        const metadata = {
            name: skin.name, image: skin.image,
            min: skin.min_float, max: skin.max_float, stattrak: skin.stattrak,
            rarity: skin.rarity.name, collectionId,
            ...(skin.phase ? { phase: skin.phase } : {}), ...extra
        };
        if (!existingSkins[skin.id] && !catalogue.skins[skin.id]) catalogue.skins[skin.id] = metadata;
        const paintIndex = Number(skin.paint_index);
        if (!Number.isInteger(paintIndex) || paintIndex < 0) throw new Error(`Invalid paint index: ${skin.id}`);
        finishes[skin.id] = paintIndex;
        index.push({
            id: skin.id, name: skin.name, source: collectionId,
            min: skin.min_float, max: skin.max_float, tier,
            stattrak: skin.stattrak, rarity: skin.rarity.name,
            ...(skin.phase ? { phase: skin.phase } : {})
        });
    }

    for (const name of collectionNames) {
        const collection = collectionsByName.get(name);
        if (!collection) throw new Error(`Missing upstream collection: ${name}`);
        const pools = [[], [], [], [], []];
        for (const item of collection.contains) {
            const tier = rarityTiers.get(item.rarity.id);
            if (tier === undefined) continue;
            const skin = skinsById.get(item.id);
            addSkin(skin, collection.id, tier);
            pools[tier].push(item.id);
        }
        if (!pools.flat().length) throw new Error(`Empty collection: ${name}`);
        catalogue.collections.push({
            id: collection.id, name: collection.name, image: collection.image,
            kind: 'collection', nonMarketable: true, pools
        });
        collectionLabels[collection.id] = collection.name;
    }

    const howl = upstreamSkins.find(skin => skin.name === 'M4A4 | Howl');
    if (!howl || howl.rarity.id !== 'rarity_contraband_weapon') throw new Error('Missing Contraband Howl metadata');
    addSkin(howl, 'special-contraband', 3, { tradeUp: false });
    catalogue.collections.push({
        id: 'special-contraband', name: 'Contraband Archive (Bot Custom)', image: howl.image,
        kind: 'collection', nonMarketable: true, tradeUp: false,
        pools: [[], [], [], [howl.id], []]
    });
    collectionLabels['special-contraband'] = 'Contraband Archive (Bot Custom)';
    return { catalogue, finishes, collectionLabels, index };
}

async function main() {
    const argument = process.argv.indexOf('--input-dir');
    const inputDirectory = argument === -1 ? null : path.resolve(process.argv[argument + 1]);
    const [upstreamSkins, upstreamCollections] = await Promise.all([
        readSource('skins', inputDirectory), readSource('collections', inputDirectory)
    ]);
    const { catalogue, finishes, collectionLabels, index } = buildCatalogue(upstreamSkins, upstreamCollections);
    const oldFinishes = require('../assets/cs2-finish-catalog.json');
    for (const [id, paintIndex] of Object.entries(finishes)) {
        if (oldFinishes[id] !== undefined && oldFinishes[id] !== paintIndex) {
            throw new Error(`Paint index mismatch for ${id}: ${oldFinishes[id]} versus ${paintIndex}`);
        }
    }
    const writeJson = (relative, data) => fs.writeFileSync(path.join(root, relative), `${JSON.stringify(data, null, 2)}\n`);
    writeJson('assets/cs2-iconic-collections.json', catalogue);
    writeJson('assets/cs2-finish-catalog.json', { ...oldFinishes, ...finishes });
    writeJson('assets/cs2-collections.json', { ...require('../assets/cs2-collections.json'), ...collectionLabels });
    if (inputDirectory) {
        fs.writeFileSync(path.join(inputDirectory, 'iconic-index.json'), `${JSON.stringify(index, null, 2)}\n`);
    }
    console.log(`Built ${catalogue.collections.length} sources with ${index.length} finishes (${Object.keys(catalogue.skins).length} new skins).`);
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { buildCatalogue, collectionNames };
