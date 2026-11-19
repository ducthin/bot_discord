const { createDatabase } = require('../utils/database');
const { createPostgresHistoryStore } = require('../utils/historyStore');
const { createPostgresFavoritesStore, favoriteId, MAX_FAVORITES } = require('../utils/favoritesStore');
const { createPlaylistStore } = require('../utils/playlistStore');

const integration = process.env.TEST_DATABASE_URL ? describe : describe.skip;

integration('PostgreSQL music persistence', () => {
    let db;
    let second;
    let history;
    let favorites;
    let playlists;
    const owner = '99000000000000000001';
    const other = '99000000000000000002';
    const track = { title: 'Bài A', url: 'https://www.youtube.com/watch?v=abcdefghijk', duration: '3:40' };
    const next = { title: 'Bài B', url: 'https://www.youtube.com/watch?v=lmnopqrstuv', duration: '4:00' };

    beforeAll(async () => {
        db = createDatabase({ connectionString: process.env.TEST_DATABASE_URL });
        second = createDatabase({ connectionString: process.env.TEST_DATABASE_URL });
        await db.initialize();
        await second.initialize();
        history = createPostgresHistoryStore(db);
        favorites = createPostgresFavoritesStore(db);
        playlists = createPlaylistStore(db);
    });

    async function cleanup() {
        for (const table of ['music_history', 'favorites', 'playlists']) {
            await db.query(`DELETE FROM discord_bot.${table} WHERE user_id = ANY($1::text[])`, [[owner, other]]);
        }
    }

    beforeEach(cleanup);
    afterAll(async () => {
        if (db) await cleanup();
        await Promise.all([db?.close(), second?.close()]);
    });

    test('history survives independent pools, retains the latest 100 plays and scopes server statistics', async () => {
        const restarted = createPostgresHistoryStore(second);
        await Promise.all([
            history.addToHistory(owner, track, 'local'),
            restarted.addToHistory(owner, next, 'other'),
            history.addToHistory(other, track, 'local')
        ]);
        expect((await restarted.readUserHistory(owner)).map(song => song.title).sort()).toEqual(['Bài A', 'Bài B']);
        const local = await history.readServerHistory('local');
        expect(local.get(owner).map(song => song.title)).toEqual(['Bài A']);
        expect(local.get(other)).toHaveLength(1);
        for (let index = 0; index < 102; index++) {
            await history.addToHistory(owner, { ...track, title: `Play ${index}` }, 'local');
        }
        const saved = await restarted.readUserHistory(owner);
        expect(saved).toHaveLength(100);
        expect(saved[0].title).toBe('Play 2');
        expect(saved.at(-1).title).toBe('Play 101');
        expect(await restarted.clearUserHistory(owner)).toBe(true);
        expect(await history.readUserHistory(owner)).toEqual([]);
        expect(await restarted.clearUserHistory(owner)).toBe(false);
        expect(await history.readUserHistory(other)).toHaveLength(1);
    });

    test('favorites serialize duplicate saves across pools and enforce the capacity and owner boundaries', async () => {
        const independent = createPostgresFavoritesStore(second);
        const results = await Promise.all([
            favorites.save(owner, track), independent.save(owner, track), favorites.save(owner, next)
        ]);
        expect(results.filter(result => result === 'saved')).toHaveLength(2);
        expect(results.filter(result => result === 'exists')).toHaveLength(1);
        expect(await independent.list(owner)).toHaveLength(2);
        expect(await independent.list(other)).toEqual([]);
        expect(await independent.remove(other, favoriteId(track))).toBe(false);
        expect(await independent.remove(owner, favoriteId(track))).toBe(true);
        expect((await favorites.list(owner)).map(song => song.title)).toEqual(['Bài B']);
        const full = Array.from({ length: MAX_FAVORITES }, (_, index) => {
            const song = { title: `Track ${index}`, url: `https://example.com/${index}` };
            return { ...song, id: favoriteId(song) };
        });
        await db.query('UPDATE discord_bot.favorites SET songs = $2::jsonb WHERE user_id = $1', [owner, JSON.stringify(full)]);
        expect(await independent.save(owner, track)).toBe('full');
        expect(await independent.list(owner)).toHaveLength(MAX_FAVORITES);
    });

    test('playlists use parameterized names, persist edits and never cross user ownership', async () => {
        const name = "Rock's mix";
        const data = { name, songs: [track], totalSongs: 1, createdAt: new Date().toISOString() };
        await playlists.save(owner, name, data);
        const restarted = createPlaylistStore(second);
        expect(await restarted.load(owner, name)).toEqual(data);
        expect(await restarted.load(other, name)).toBeNull();
        await restarted.save(owner, name, { ...data, songs: [next], totalSongs: 1 });
        expect((await playlists.list(owner))[0].songs).toEqual([next]);
        expect(await playlists.list(other)).toEqual([]);
        expect(await restarted.remove(other, name)).toBe(false);
        expect(await playlists.remove(owner, name)).toBe(true);
        expect(await restarted.load(owner, name)).toBeNull();
        await expect(playlists.save(owner, '../escape', data)).rejects.toThrow('Tên playlist');
    });
});
