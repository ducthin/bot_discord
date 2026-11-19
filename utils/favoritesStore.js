const fs = require('fs').promises;
const path = require('path');
const { createHash, randomUUID } = require('crypto');
const database = require('./database');

const MAX_FAVORITES = 100;

function favoriteId(song) {
    if (typeof song?.url !== 'string' || !song.url) return null;
    return createHash('sha256').update(song.url).digest('base64url');
}

// Explicit file-backed fixtures for isolated tests; runtime uses PostgreSQL below.
function createFavoritesStore(directory) {
    const pending = new Map();

    function fileFor(userId) {
        if (!/^\d{1,20}$/.test(userId)) throw new Error('Invalid favorite owner ID.');
        return path.join(directory, userId + '.json');
    }

    async function list(userId) {
        try {
            const songs = JSON.parse(await fs.readFile(fileFor(userId), 'utf8'));
            if (!Array.isArray(songs)) throw new Error('Invalid favorites file.');
            return songs.filter(song => song?.id && favoriteId(song) === song.id);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            return [];
        }
    }

    function update(userId, change) {
        const task = (pending.get(userId) || Promise.resolve()).catch(() => {}).then(async () => {
            const { next, result } = change(await list(userId));
            if (!next) return result;
            const file = fileFor(userId);
            const temp = file + '.' + randomUUID() + '.tmp';
            await fs.mkdir(directory, { recursive: true });
            try {
                await fs.writeFile(temp, JSON.stringify(next, null, 2));
                await fs.rename(temp, file);
            } finally {
                await fs.unlink(temp).catch(() => {});
            }
            return result;
        });
        pending.set(userId, task);
        const cleanup = () => { if (pending.get(userId) === task) pending.delete(userId); };
        task.then(cleanup, cleanup);
        return task;
    }

    function save(userId, song) {
        const id = favoriteId(song);
        if (!id) throw new Error('Track has no URL.');
        const { title, url, duration, thumbnail } = song;
        return update(userId, songs => {
            if (songs.some(track => track.id === id)) return { result: 'exists' };
            if (songs.length >= MAX_FAVORITES) return { result: 'full' };
            return { next: [{ id, title, url, duration, thumbnail }, ...songs], result: 'saved' };
        });
    }

    function remove(userId, id) {
        return update(userId, songs => {
            const next = songs.filter(track => track.id !== id);
            return next.length < songs.length ? { next, result: true } : { result: false };
        });
    }

    return { list, save, remove };
}

function createPostgresFavoritesStore(db = database) {
    return {
        async list(userId) {
            if (!/^\d{1,20}$/.test(userId)) return [];
            const { rows } = await db.query('SELECT songs FROM discord_bot.favorites WHERE user_id = $1', [userId]);
            const songs = rows[0]?.songs;
            return Array.isArray(songs) ? songs.filter(song => song?.id && favoriteId(song) === song.id) : [];
        },
        async save(userId, song) {
            if (!/^\d{1,20}$/.test(userId)) throw new Error('Invalid favorite owner ID.');
            const id = favoriteId(song);
            if (!id) throw new Error('Track has no URL.');
            const { title, url, duration, thumbnail } = song;
            return db.transaction(`favorites:${userId}`, async client => {
                await client.query(
                    `INSERT INTO discord_bot.favorites (user_id, songs) VALUES ($1, '[]'::jsonb)
                     ON CONFLICT (user_id) DO NOTHING`, [userId]);
                const selected = await client.query('SELECT songs FROM discord_bot.favorites WHERE user_id = $1 FOR UPDATE', [userId]);
                const songs = selected.rows[0]?.songs ?? [];
                if (songs.some(track => track.id === id)) return 'exists';
                if (songs.length >= MAX_FAVORITES) return 'full';
                await client.query('UPDATE discord_bot.favorites SET songs = $2::jsonb WHERE user_id = $1',
                    [userId, JSON.stringify([{ id, title, url, duration, thumbnail }, ...songs])]);
                return 'saved';
            });
        },
        async remove(userId, id) {
            if (!/^\d{1,20}$/.test(userId)) return false;
            return db.transaction(`favorites:${userId}`, async client => {
                const selected = await client.query('SELECT songs FROM discord_bot.favorites WHERE user_id = $1 FOR UPDATE', [userId]);
                const songs = selected.rows[0]?.songs ?? [];
                const next = songs.filter(track => track.id !== id);
                if (next.length === songs.length) return false;
                await client.query('UPDATE discord_bot.favorites SET songs = $2::jsonb WHERE user_id = $1', [userId, JSON.stringify(next)]);
                return true;
            });
        }
    };
}

module.exports = { ...createPostgresFavoritesStore(database), createPostgresFavoritesStore, createFavoritesStore, favoriteId, MAX_FAVORITES };
