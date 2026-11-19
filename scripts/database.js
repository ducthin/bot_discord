require('dotenv').config();
const fs = require('node:fs/promises');
const path = require('node:path');
const database = require('../utils/database');

async function resetLegacyFiles() {
    const dataRoot = path.resolve(__dirname, '../data');
    for (const name of ['management', 'history', 'favorites', 'playlists']) {
        const target = path.resolve(dataRoot, name);
        if (path.dirname(target) !== dataRoot) throw new Error('Invalid legacy data directory.');
        const info = await fs.lstat(target).catch(error => { if (error.code !== 'ENOENT') throw error; });
        if (info?.isSymbolicLink()) throw new Error(`Refusing to reset linked data/${name}.`);
        if (info) await fs.rm(target, { recursive: true, force: true });
    }
}

async function main() {
    const action = process.argv[2] ?? 'check';
    if (!['init', 'check', 'reset'].includes(action)) throw new Error('Use db:init, db:check or db:reset -- --yes.');
    if (action === 'reset' && !process.argv.includes('--yes')) throw new Error('To start empty, stop the bot and run RESET_DATA.bat or node scripts/database.js reset --yes.');
    await database.initialize();
    if (action === 'reset') {
        await database.reset();
        await resetLegacyFiles();
        console.log('PostgreSQL reset: wallets, inventory, battles, settings and music data are empty. Old JSON data removed.');
    } else {
        await database.query('SELECT 1');
        console.log(action === 'init' ? 'PostgreSQL initialized. Existing data was not changed.' : 'PostgreSQL connection OK.');
    }
}

main().catch(error => {
    console.error('Database:', error.code ?? error.message);
    process.exitCode = 1;
}).finally(() => database.close());
