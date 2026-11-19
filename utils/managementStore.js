const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const database = require('./database');
const { readCoins, serializeCoins } = require('./coins');
const metrics = require('./performanceMetrics');

function createManagementStore(directory) {
    const pending = new Map();
    function fileFor(guildId) {
        if (typeof guildId !== 'string' || !/^\d{1,20}$/.test(guildId)) throw new Error('Invalid guild ID.');
        return path.join(directory, guildId + '.json');
    }

    async function readAll(guildId) {
        const defaults = emptyState();
        try {
            const data = JSON.parse(await fs.readFile(fileFor(guildId), 'utf8'));
            return { ...defaults, ...data, activity: { ...defaults.activity, ...data.activity } };
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            return defaults;
        }
    }

    async function read(guildId, requestedScope) {
        const scope = normalizeScope(requestedScope);
        const state = await readAll(guildId);
        return scope ? selectState(state, scope) : state;
    }

    function transact(guildId, operation, requestedScope) {
        const scope = normalizeScope(requestedScope);
        const task = (pending.get(guildId) || Promise.resolve()).catch(() => {}).then(async () => {
            const complete = await readAll(guildId);
            const state = scope ? selectState(complete, scope) : complete;
            let previous = scope ? flattenState(state) : null;
            const file = fileFor(guildId);
            const save = async () => {
                let next;
                if (scope) {
                    next = flattenState(state);
                    assertScopedChanges(previous, next, scope);
                    mergeScopedState(complete, state, scope);
                }
                const temporary = file + '.' + randomUUID() + '.tmp';
                await fs.mkdir(directory, { recursive: true });
                try {
                    await fs.writeFile(temporary, JSON.stringify(scope ? complete : state, null, 2));
                    await fs.rename(temporary, file);
                    if (scope) previous = next;
                } finally {
                    await fs.unlink(temporary).catch(() => {});
                }
            };
            return operation(state, save);
        });
        pending.set(guildId, task);
        const cleanup = () => { if (pending.get(guildId) === task) pending.delete(guildId); };
        task.then(cleanup, cleanup);
        return task;
    }

    return { read, transact };
}

function emptyState() {
    return { settings: {}, rooms: {}, reports: {}, tickets: {}, lfg: {}, suggestions: {}, announcements: {},
        nextCase: 1, nextAnnouncement: 1, nextLfgTeam: 1,
        taixiu: { balances: {}, round: null }, activity: { roomsOpened: 0, roomJoins: 0, voiceJoins: {} } };
}

function validateGuild(guildId) {
    if (typeof guildId !== 'string' || !/^\d{1,20}$/.test(guildId)) throw new Error('Invalid guild ID.');
}

// Scope is an allowlist. Wallets and per-user stash metadata/items are selected
// separately from ordinary sections; every writer still locks the whole guild.
function normalizeScope(scope) {
    if (scope === undefined) return null;
    if (!scope || typeof scope !== 'object' || Array.isArray(scope) ||
        Object.keys(scope).some(key => !['sections', 'wallets', 'inventory'].includes(key))) throw new Error('Invalid management scope.');
    const selection = (value, allAllowed = true) => {
        if (value === undefined) return new Set();
        if (allAllowed && value === 'all') return 'all';
        if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !id || id.length > 100)) {
            throw new Error('Management scope selections must be arrays of IDs or all.');
        }
        return new Set(value);
    };
    const sections = selection(scope.sections, false);
    if (sections.has('skinCases')) throw new Error('Select skinCases through the inventory scope.');
    return { sections, wallets: selection(scope.wallets), inventory: selection(scope.inventory) };
}

const includesOwner = (selection, id) => selection === 'all' || selection.has(id);
const includesRecord = (scope, row) => row.section === 'skinCases'
    ? includesOwner(scope.inventory, row.entry_key)
    : scope.sections.has(row.section);
const includesRow = (scope, kind, key, row) => kind === 'records' ? includesRecord(scope, row)
    : includesOwner(scope[kind === 'wallets' ? 'wallets' : 'inventory'], kind === 'wallets' ? key : row.user_id);

function scopedRows(source, scope) {
    if (!scope) return source;
    return Object.fromEntries(Object.entries(source).map(([kind, rows]) =>
        [kind, new Map([...rows].filter(([key, row]) => includesRow(scope, kind, key, row)))]));
}

function selectedOwners(source, selection) {
    return Object.fromEntries(Object.entries(source ?? {}).filter(([id]) => includesOwner(selection, id)));
}

function selectState(source, scope) {
    const selected = emptyState();
    for (const section of scope.sections) {
        if (Object.hasOwn(source, section)) Object.defineProperty(selected, section, {
            value: structuredClone(source[section]), enumerable: true, writable: true, configurable: true
        });
    }
    selected.taixiu ??= { round: null };
    selected.taixiu.balances = selectedOwners(source.taixiu?.balances, scope.wallets);
    const inventory = selectedOwners(source.skinCases, scope.inventory);
    if (Object.keys(inventory).length || (scope.inventory === 'all' && source.skinCases)) selected.skinCases = structuredClone(inventory);
    return selected;
}

function mergeScopedState(complete, selected, scope) {
    const balances = complete.taixiu?.balances ?? {};
    for (const section of scope.sections) {
        if (Object.hasOwn(selected, section)) Object.defineProperty(complete, section, {
            value: structuredClone(selected[section]), enumerable: true, writable: true, configurable: true
        });
        else delete complete[section];
    }
    complete.taixiu ??= { round: null };
    complete.taixiu.balances = balances;
    const mergeOwners = (target, source, selection) => {
        for (const id of selection === 'all' ? new Set([...Object.keys(target), ...Object.keys(source ?? {})]) : selection) {
            if (Object.hasOwn(source ?? {}, id)) Object.defineProperty(target, id, {
                value: structuredClone(source[id]), enumerable: true, writable: true, configurable: true
            });
            else delete target[id];
        }
    };
    mergeOwners(balances, selected.taixiu?.balances, scope.wallets);
    if (scope.inventory === 'all') {
        if (Object.hasOwn(selected, 'skinCases')) complete.skinCases = structuredClone(selected.skinCases);
        else delete complete.skinCases;
    } else if (scope.inventory.size && (complete.skinCases || selected.skinCases)) {
        mergeOwners(complete.skinCases ??= {}, selected.skinCases, scope.inventory);
    }
}

function assertScopedChanges(previous, next, scope) {
    for (const kind of Object.keys(previous)) {
        for (const key of new Set([...previous[kind].keys(), ...next[kind].keys()])) {
            const before = previous[kind].get(key);
            const after = next[kind].get(key);
            if (kind === 'wallets' ? before === after : before?.data === after?.data && before?.position === after?.position) continue;
            const row = after ?? before;
            // A partial inventory writer may create its parent object, but does
            // not own the shared section marker or any other user's entries.
            if (kind === 'records' && row.section === 'skinCases' && row.entry_key === '' &&
                (scope.inventory === 'all' || scope.inventory.size)) continue;
            if (!includesRow(scope, kind, key, row)) throw new Error(`Cannot save ${kind} outside management scope.`);
        }
    }
}

function hydrateState({ records, wallets, inventory }, encoded = true) {
    const state = emptyState();
    const decode = value => encoded ? JSON.parse(value) : value;
    for (const row of records.values()) {
        if (row.entry_key !== '') continue;
        Object.defineProperty(state, row.section, { value: decode(row.data), enumerable: true, writable: true, configurable: true });
    }
    for (const row of records.values()) {
        if (row.entry_key === '') continue;
        const section = state[row.section] ??= {};
        Object.defineProperty(section, row.entry_key, { value: decode(row.data), enumerable: true, writable: true, configurable: true });
    }
    state.taixiu ??= { round: null };
    state.taixiu.balances = {};
    for (const [userId, amount] of wallets) state.taixiu.balances[userId] = serializeCoins(BigInt(amount));
    for (const row of [...inventory.values()].sort((first, second) => first.position - second.position)) {
        const stash = (state.skinCases ??= {})[row.user_id] ??= {};
        (stash.drops ??= []).push(decode(row.data));
    }
    return state;
}

// Keep the existing state API while storing separate records, wallets and items.
// Only changed rows are written; all changes in one callback commit together.
function flattenState(state) {
    const records = new Map();
    const wallets = new Map();
    const inventory = new Map();
    const record = (section, key, value) => {
        const data = JSON.stringify(value);
        if (data !== undefined) records.set(JSON.stringify([section, key]), { section, entry_key: key, data });
    };
    for (const [section, source] of Object.entries(state)) {
        if (source && typeof source === 'object' && !Array.isArray(source)) {
            record(section, '', {});
            for (const [key, value] of Object.entries(source)) {
                if (section === 'taixiu' && key === 'balances') {
                    for (const [userId, amount] of Object.entries(value ?? {})) wallets.set(userId, readCoins(amount).toString());
                } else if (section === 'skinCases') {
                    const { drops, ...meta } = value;
                    record(section, key, { ...meta, ...(Array.isArray(drops) ? { drops: [] } : {}) });
                    for (const [position, drop] of (drops ?? []).entries()) {
                        if (typeof drop.id !== 'string' || !drop.id) throw new Error('Inventory item must have an ID.');
                        const itemKey = JSON.stringify([key, drop.id]);
                        if (inventory.has(itemKey)) throw new Error('Duplicate inventory item ID.');
                        inventory.set(itemKey, { user_id: key, drop_id: drop.id, position, data: JSON.stringify(drop) });
                    }
                } else record(section, key, value);
            }
        } else record(section, '', source);
    }
    return { records, wallets, inventory };
}

function createPostgresManagementStore(db = database) {
    async function load(executor, guildId, scope) {
        const params = [guildId];
        const parameter = value => { params.push(value); return `$${params.length}`; };
        const selections = [];
        const recordFilters = [];
        if (scope?.sections.size) recordFilters.push(`section = ANY(${parameter([...scope.sections])}::text[])`);
        if (scope?.inventory === 'all') recordFilters.push("section = 'skinCases'");
        else if (scope?.inventory.size) recordFilters.push(`(section = 'skinCases' AND entry_key = ANY(${parameter([...scope.inventory])}::text[]))`);
        if (!scope || recordFilters.length) selections.push(`SELECT 'record' AS kind, section, entry_key, data, NULL::integer AS position
            FROM discord_bot.guild_records WHERE guild_id = $1${scope ? ` AND (${recordFilters.join(' OR ')})` : ''}`);
        if (!scope || scope.wallets === 'all' || scope.wallets.size) selections.push(`SELECT 'wallet' AS kind, 'taixiu' AS section, user_id AS entry_key, to_jsonb(amount_units::text) AS data, NULL::integer AS position
            FROM discord_bot.wallets WHERE guild_id = $1${scope && scope.wallets !== 'all' ? ` AND user_id = ANY(${parameter([...scope.wallets])}::text[])` : ''}`);
        if (!scope || scope.inventory === 'all' || scope.inventory.size) selections.push(`SELECT 'inventory' AS kind, user_id AS section, drop_id AS entry_key, data, position
            FROM discord_bot.inventory WHERE guild_id = $1${scope && scope.inventory !== 'all' ? ` AND user_id = ANY(${parameter([...scope.inventory])}::text[])` : ''}`);
        if (!selections.length) return emptyState();
        const { rows } = await executor.query(selections.join('\nUNION ALL\n'), params);
        const flattened = { records: new Map(), wallets: new Map(), inventory: new Map() };
        for (const row of rows) {
            if (row.kind === 'record') flattened.records.set(JSON.stringify([row.section, row.entry_key]),
                { section: row.section, entry_key: row.entry_key, data: row.data });
            else if (row.kind === 'wallet') flattened.wallets.set(row.entry_key, row.data);
            else flattened.inventory.set(JSON.stringify([row.section, row.entry_key]),
                { user_id: row.section, drop_id: row.entry_key, position: row.position, data: row.data });
        }
        return hydrateState(flattened, false);
    }

    async function persist(client, guildId, previous, next) {
        const removedRecords = [...previous.records].filter(([key]) => !next.records.has(key)).map(([, row]) => row);
        const changedRecords = [...next.records].filter(([key, row]) => previous.records.get(key)?.data !== row.data).map(([, row]) => row);
        if (removedRecords.length) await client.query(`DELETE FROM discord_bot.guild_records AS saved USING
            jsonb_to_recordset($2::jsonb) AS removed(section text, entry_key text)
            WHERE saved.guild_id = $1 AND saved.section = removed.section AND saved.entry_key = removed.entry_key`, [guildId, JSON.stringify(removedRecords)]);
        if (changedRecords.length) await client.query(`INSERT INTO discord_bot.guild_records (guild_id, section, entry_key, data)
            SELECT $1, section, entry_key, data::jsonb FROM jsonb_to_recordset($2::jsonb) AS updated(section text, entry_key text, data text)
            ON CONFLICT (guild_id, section, entry_key) DO UPDATE SET data = EXCLUDED.data`, [guildId, JSON.stringify(changedRecords)]);

        const removedWallets = [...previous.wallets.keys()].filter(key => !next.wallets.has(key));
        const changedWallets = [...next.wallets].filter(([id, amount]) => previous.wallets.get(id) !== amount)
            .map(([user_id, amount_units]) => ({ user_id, amount_units }));
        if (removedWallets.length) await client.query('DELETE FROM discord_bot.wallets WHERE guild_id = $1 AND user_id = ANY($2::text[])', [guildId, removedWallets]);
        if (changedWallets.length) await client.query(`INSERT INTO discord_bot.wallets (guild_id, user_id, amount_units)
            SELECT $1, user_id, amount_units FROM jsonb_to_recordset($2::jsonb) AS updated(user_id text, amount_units numeric)
            ON CONFLICT (guild_id, user_id) DO UPDATE SET amount_units = EXCLUDED.amount_units`, [guildId, JSON.stringify(changedWallets)]);

        const removedItems = [...previous.inventory].filter(([key]) => !next.inventory.has(key)).map(([, row]) => row);
        const changedItems = [...next.inventory].filter(([key, row]) => {
            const old = previous.inventory.get(key);
            return old?.data !== row.data || old.position !== row.position;
        }).map(([, row]) => ({ ...row, data: JSON.parse(row.data) }));
        if (removedItems.length) await client.query(`DELETE FROM discord_bot.inventory AS saved USING
            jsonb_to_recordset($2::jsonb) AS removed(user_id text, drop_id text)
            WHERE saved.guild_id = $1 AND saved.user_id = removed.user_id AND saved.drop_id = removed.drop_id`, [guildId, JSON.stringify(removedItems)]);
        if (changedItems.length) await client.query(`INSERT INTO discord_bot.inventory (guild_id, user_id, drop_id, position, data)
            SELECT $1, user_id, drop_id, position, data FROM jsonb_to_recordset($2::jsonb) AS updated(user_id text, drop_id text, position integer, data jsonb)
            ON CONFLICT (guild_id, user_id, drop_id) DO UPDATE SET position = EXCLUDED.position, data = EXCLUDED.data`, [guildId, JSON.stringify(changedItems)]);
    }

    async function read(guildId, requestedScope) {
        return metrics.measure('store.read', () => {
            validateGuild(guildId);
            return load(db, guildId, normalizeScope(requestedScope));
        });
    }

    async function transact(guildId, operation, requestedScope) {
        return metrics.measure('store.transaction', () => {
            validateGuild(guildId);
            const scope = normalizeScope(requestedScope);
            return db.transaction(`guild:${guildId}`, client => metrics.measure('store.locked', async () => {
                const state = await load(client, guildId, scope);
                let previous = flattenState(state);
                const save = async () => {
                    const next = flattenState(state);
                    if (scope) assertScopedChanges(previous, next, scope);
                    await persist(client, guildId, scopedRows(previous, scope), scopedRows(next, scope));
                    previous = next;
                };
                return operation(state, save);
            }));
        });
    }
    return { read, transact };
}

// The explicit directory factory is kept for isolated existing test fixtures only.
// Production always uses PostgreSQL and never falls back to old JSON files.
module.exports = { ...createPostgresManagementStore(), createPostgresManagementStore, createManagementStore };
