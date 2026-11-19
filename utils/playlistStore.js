const database = require('./database');
const { playlistPath } = require('./playlistPath');

function validateOwner(userId) {
    if (typeof userId !== 'string' || !/^\d{1,20}$/.test(userId)) throw new Error('Invalid playlist owner ID.');
}

function validatePlaylistName(name) {
    // Preserve the names accepted by the old playlist command without touching files.
    playlistPath('.', name);
    if (name.length > 100) throw new Error('Tên playlist dài tối đa 100 ký tự.');
    return name;
}

function createPlaylistStore(db = database) {
    return {
        async save(userId, name, data) {
            validateOwner(userId);
            validatePlaylistName(name);
            await db.transaction(`playlists:${userId}`, client => client.query(
                `INSERT INTO discord_bot.playlists (user_id, name, data) VALUES ($1, $2, $3::jsonb)
                 ON CONFLICT (user_id, name) DO UPDATE SET data = EXCLUDED.data`,
                [userId, name, JSON.stringify(data)]));
        },
        async load(userId, name) {
            validateOwner(userId);
            validatePlaylistName(name);
            const { rows } = await db.query('SELECT data FROM discord_bot.playlists WHERE user_id = $1 AND name = $2', [userId, name]);
            return rows[0]?.data ?? null;
        },
        async list(userId) {
            validateOwner(userId);
            const { rows } = await db.query('SELECT data FROM discord_bot.playlists WHERE user_id = $1 ORDER BY name', [userId]);
            return rows.map(row => row.data);
        },
        async remove(userId, name) {
            validateOwner(userId);
            validatePlaylistName(name);
            return db.transaction(`playlists:${userId}`, async client => {
                const { rowCount } = await client.query('DELETE FROM discord_bot.playlists WHERE user_id = $1 AND name = $2', [userId, name]);
                return rowCount > 0;
            });
        }
    };
}

module.exports = { ...createPlaylistStore(database), createPlaylistStore, validatePlaylistName };
