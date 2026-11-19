const { Pool } = require('pg');

const SCHEMA = `
CREATE SCHEMA IF NOT EXISTS discord_bot;
CREATE TABLE IF NOT EXISTS discord_bot.guild_records (
    guild_id text NOT NULL, section text NOT NULL, entry_key text NOT NULL, data jsonb NOT NULL,
    PRIMARY KEY (guild_id, section, entry_key)
);
CREATE TABLE IF NOT EXISTS discord_bot.wallets (
    guild_id text NOT NULL, user_id text NOT NULL,
    amount_units numeric NOT NULL CHECK (amount_units = trunc(amount_units)),
    PRIMARY KEY (guild_id, user_id)
);
CREATE TABLE IF NOT EXISTS discord_bot.inventory (
    guild_id text NOT NULL, user_id text NOT NULL, drop_id text NOT NULL,
    position integer NOT NULL, data jsonb NOT NULL,
    PRIMARY KEY (guild_id, user_id, drop_id)
);
CREATE INDEX IF NOT EXISTS inventory_owner_order ON discord_bot.inventory (guild_id, user_id, position);
CREATE TABLE IF NOT EXISTS discord_bot.music_history (user_id text PRIMARY KEY, songs jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS music_history_guilds ON discord_bot.music_history USING gin (songs jsonb_path_ops);
CREATE TABLE IF NOT EXISTS discord_bot.favorites (user_id text PRIMARY KEY, songs jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS discord_bot.playlists (
    user_id text NOT NULL, name text NOT NULL, data jsonb NOT NULL, PRIMARY KEY (user_id, name)
);
CREATE TABLE IF NOT EXISTS discord_bot.player_sessions (
    token_hash text PRIMARY KEY, owner jsonb NOT NULL, created_at bigint NOT NULL, expires_at bigint NOT NULL,
    csrf_token text NOT NULL, mutations integer NOT NULL DEFAULT 0, window_until bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS player_sessions_expiry ON discord_bot.player_sessions (expires_at);
CREATE TABLE IF NOT EXISTS discord_bot.app_meta (key text PRIMARY KEY, value text NOT NULL);
INSERT INTO discord_bot.app_meta (key, value) VALUES ('schema_version', '1') ON CONFLICT DO NOTHING;
`;

function validateConfiguration(connectionString = process.env.DATABASE_URL) {
    if (!connectionString) throw new Error('DATABASE_URL is required. Run SETUP_POSTGRES.bat or configure PostgreSQL in .env.');
    let url;
    try { url = new URL(connectionString); } catch { throw new Error('DATABASE_URL must be a PostgreSQL connection URL.'); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2) {
        throw new Error('DATABASE_URL must specify a PostgreSQL server and database.');
    }
    return connectionString;
}

function createDatabase(options = {}) {
    let pool;
    let initializing;
    let closing;
    let draining = false;
    const pending = new Map();
    function getPool() {
        if (closing && !draining) throw new Error('Database is closing.');
        if (!pool) {
            const { connectionString = process.env.DATABASE_URL, ...poolOptions } = options;
            pool = new Pool({ connectionString: validateConfiguration(connectionString), max: 5,
                connectionTimeoutMillis: 5000, idleTimeoutMillis: 30_000, statement_timeout: 30_000,
                application_name: 'discord-bot', ...poolOptions });
            pool.on('error', error => console.error('PostgreSQL pool error:', error.code ?? error.name));
        }
        return pool;
    }

    async function initialize() {
        if (!initializing) {
            initializing = (async () => {
                const client = await getPool().connect();
                try {
                    await client.query('BEGIN');
                    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('discord_bot:schema', 0))");
                    await client.query(SCHEMA);
                    await client.query('COMMIT');
                } catch (error) {
                    await client.query('ROLLBACK').catch(() => {});
                    throw error;
                } finally { client.release(); }
            })().catch(error => { initializing = undefined; throw error; });
        }
        return initializing;
    }

    async function runTransaction(scope, operation) {
        await initialize();
        const client = await getPool().connect();
        try {
            await client.query('BEGIN');
            // Shared reset barrier allows independent owners to proceed concurrently.
            await client.query("SELECT pg_advisory_xact_lock_shared(hashtextextended('discord_bot:reset', 0))");
            await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`discord_bot:${scope}`]);
            const result = await operation(client);
            const committed = await client.query('COMMIT');
            if (committed.command !== 'COMMIT') throw new Error('PostgreSQL transaction was rolled back.');
            return result;
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally { client.release(); }
    }

    async function transaction(scope, operation) {
        if (typeof scope !== 'string' || !scope || scope.length > 1000) throw new Error('Invalid database transaction scope.');
        if (closing) throw new Error('Database is closing.');
        // Wait for this owner's earlier work before taking a pool connection.
        // PostgreSQL still serializes matching scopes in other bot processes.
        const task = (pending.get(scope) || Promise.resolve()).catch(() => {})
            .then(() => runTransaction(scope, operation));
        pending.set(scope, task);
        const cleanup = () => { if (pending.get(scope) === task) pending.delete(scope); };
        task.then(cleanup, cleanup);
        return task;
    }

    async function query(text, values) {
        if (closing) throw new Error('Database is closing.');
        await initialize();
        return getPool().query(text, values);
    }

    async function reset() {
        if (closing) throw new Error('Database is closing.');
        await initialize();
        const client = await getPool().connect();
        try {
            await client.query('BEGIN');
            await client.query("SELECT pg_advisory_xact_lock(hashtextextended('discord_bot:reset', 0))");
            await client.query(`TRUNCATE TABLE discord_bot.guild_records, discord_bot.wallets,
                discord_bot.inventory, discord_bot.music_history, discord_bot.favorites, discord_bot.playlists`);
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally { client.release(); }
    }

    async function close() {
        if (closing) return closing;
        draining = true;
        closing = (async () => {
            try {
                await Promise.allSettled([...pending.values()]);
                await initializing?.catch(() => {});
            } finally {
                draining = false;
                await pool?.end();
            }
        })();
        return closing;
    }

    return { initialize, transaction, query, reset, close };
}

module.exports = { ...createDatabase(), createDatabase, validateConfiguration };
