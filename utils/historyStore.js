const fs = require('fs').promises;
const path = require('path');
const { randomUUID } = require('crypto');
const database = require('./database');

function createPostgresHistoryStore(db = database) {
    return {
        async readUserHistory(userId) {
            if (!/^\d{1,20}$/.test(userId)) return [];
            const { rows } = await db.query('SELECT songs FROM discord_bot.music_history WHERE user_id = $1', [userId]);
            return Array.isArray(rows[0]?.songs) ? rows[0].songs.filter(song => song && typeof song === 'object') : [];
        },
        async readServerHistory(guildId) {
            const result = new Map();
            if (!guildId) return result;
            const { rows } = await db.query('SELECT user_id, songs FROM discord_bot.music_history WHERE songs @> $1::jsonb',
                [JSON.stringify([{ guildId }])]);
            for (const row of rows) {
                const songs = Array.isArray(row.songs) ? row.songs.filter(song => song?.guildId === guildId) : [];
                if (songs.length) result.set(row.user_id, songs);
            }
            return result;
        },
        async addToHistory(userId, song, guildId) {
            if (!/^\d{1,20}$/.test(userId)) return;
            const entry = { title: song.title, url: song.url, duration: song.duration, thumbnail: song.thumbnail,
                playedAt: new Date().toISOString(), requester: song.requester, guildId };
            await db.transaction(`history:${userId}`, async client => {
                const { rows } = await client.query('SELECT songs FROM discord_bot.music_history WHERE user_id = $1 FOR UPDATE', [userId]);
                const history = Array.isArray(rows[0]?.songs) ? rows[0].songs : [];
                await client.query(
                    `INSERT INTO discord_bot.music_history (user_id, songs) VALUES ($1, $2::jsonb)
                     ON CONFLICT (user_id) DO UPDATE SET songs = EXCLUDED.songs`,
                    [userId, JSON.stringify([...history, entry].slice(-100))]);
            });
        },
        async clearUserHistory(userId) {
            if (!/^\d{1,20}$/.test(userId)) return false;
            return db.transaction(`history:${userId}`, async client => {
                const { rowCount } = await client.query('DELETE FROM discord_bot.music_history WHERE user_id = $1', [userId]);
                return rowCount > 0;
            });
        }
    };
}

// Explicit file-backed fixtures remain available for the existing isolated tests.
// Runtime exports below always use PostgreSQL and never read these files.
function createHistoryStore(directory) {
    const pending = new Map();
    const isUserId = id => /^\d{1,20}$/.test(id);
    const currentFile = id => path.join(directory, id, 'songs.json');
    const legacyFile = id => path.join(directory, `${id}.json`);

    async function readUserHistory(userId) {
        if (!isUserId(userId)) return [];
        for (const file of [currentFile(userId), legacyFile(userId)]) {
            try {
                const data = JSON.parse(await fs.readFile(file, 'utf8'));
                const songs = Array.isArray(data) ? data : data?.songs;
                return Array.isArray(songs) ? songs.filter(song => song && typeof song === 'object') : [];
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
            }
        }
        return [];
    }

    async function readServerHistory(guildId) {
        const result = new Map();
        if (!guildId) return result;
        let entries;
        try { entries = await fs.readdir(directory, { withFileTypes: true }); }
        catch (error) { if (error.code === 'ENOENT') return result; throw error; }
        for (const entry of entries) {
            if (!entry.isDirectory() || !isUserId(entry.name)) continue;
            const history = await readUserHistory(entry.name).catch(error => {
                if (error instanceof SyntaxError) return [];
                throw error;
            });
            const songs = history.filter(song => song.guildId === guildId);
            if (songs.length) result.set(entry.name, songs);
        }
        return result;
    }

    function serialize(userId, operation) {
        const task = (pending.get(userId) || Promise.resolve()).catch(() => {}).then(operation);
        pending.set(userId, task);
        const cleanup = () => { if (pending.get(userId) === task) pending.delete(userId); };
        task.then(cleanup, cleanup);
        return task;
    }

    async function addToHistory(userId, song, guildId) {
        if (!isUserId(userId)) return;
        return serialize(userId, async () => {
            const file = currentFile(userId);
            const history = await readUserHistory(userId);
            history.push({ title: song.title, url: song.url, duration: song.duration, thumbnail: song.thumbnail,
                playedAt: new Date().toISOString(), requester: song.requester, guildId });
            await fs.mkdir(path.dirname(file), { recursive: true });
            const tempFile = `${file}.${randomUUID()}.tmp`;
            try {
                await fs.writeFile(tempFile, JSON.stringify({ songs: history.slice(-100) }, null, 2));
                await fs.rename(tempFile, file);
            } catch (error) {
                await fs.unlink(tempFile).catch(() => {});
                throw error;
            }
        });
    }

    async function clearUserHistory(userId) {
        if (!isUserId(userId)) return false;
        return serialize(userId, async () => {
            let removed = false;
            for (const file of [legacyFile(userId), currentFile(userId)]) {
                try { await fs.unlink(file); removed = true; }
                catch (error) { if (error.code !== 'ENOENT') throw error; }
            }
            return removed;
        });
    }

    return { readUserHistory, readServerHistory, addToHistory, clearUserHistory };
}

module.exports = { ...createPostgresHistoryStore(database), createPostgresHistoryStore, createHistoryStore };
