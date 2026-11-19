const fs = require('fs');
const { spawnSync } = require('child_process');

async function main() {
try {
    const [major, minor] = process.versions.node.split('.').map(Number);
    if (major < 22 || (major === 22 && minor < 12)) throw new Error('Node >=22.12.0 is required.');
    require('@discordjs/opus');
    require('@discordjs/voice');
    require('../utils/commandLoader').getCommandsData();
    const ffmpeg = require('ffmpeg-static');
    const { YOUTUBE_DL_PATH } = require('yt-dlp-exec/src/constants');
    for (const [label, executable, args] of [['FFmpeg', ffmpeg, ['-version']], ['yt-dlp', YOUTUBE_DL_PATH, ['--version']]]) {
        if (!executable || !fs.existsSync(executable)) throw new Error(`${label} is missing. Run npm rebuild ffmpeg-static yt-dlp-exec.`);
        const result = spawnSync(executable, args, { timeout: 30000, windowsHide: true, encoding: 'utf8' });
        if (result.error || result.status !== 0) throw new Error(`${label} could not start. Reinstall dependencies on this VPS.`);
    }
    if (!process.argv.includes('--dependencies-only')) {
        require('dotenv').config();
        const token = process.env.DISCORD_TOKEN || '';
        if (!token || /your-|here|example/i.test(token)) throw new Error('Fill DISCORD_TOKEN in .env.');
        if (!/^\d{17,20}$/.test(process.env.CLIENT_ID || '')) throw new Error('Fill CLIENT_ID with the application ID in .env.');
        const guilds = (process.env.GUILD_IDS || process.env.GUILD_ID || '').split(',').map(x => x.trim());
        if (!guilds.length || guilds.some(x => !/^\d{17,20}$/.test(x))) throw new Error('Fill GUILD_ID or GUILD_IDS with server IDs in .env.');
        const database = require('../utils/database');
        database.validateConfiguration();
        await database.query('SELECT 1');
    }
    console.log('Preflight OK (no Discord connection made).');
} catch (error) {
    console.error(`Preflight: ${error.message}`);
    process.exitCode = 1;
} finally {
    await require('../utils/database').close();
}
}
void main();
