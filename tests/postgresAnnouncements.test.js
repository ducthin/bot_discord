const { ChannelType, PermissionsBitField } = require('discord.js');
const { createDatabase } = require('../utils/database');
const store = require('../utils/managementStore');
const { sendDueAnnouncements } = require('../utils/announcements');

const integration = process.env.TEST_DATABASE_URL ? describe : describe.skip;

integration('PostgreSQL announcement delivery', () => {
    let db;
    let independentDb;
    let primary;
    let independent;
    const guildId = '99000000000000000003';

    beforeAll(async () => {
        db = createDatabase({ connectionString: process.env.TEST_DATABASE_URL });
        independentDb = createDatabase({ connectionString: process.env.TEST_DATABASE_URL });
        await Promise.all([db.initialize(), independentDb.initialize()]);
        primary = store.createPostgresManagementStore(db);
        independent = store.createPostgresManagementStore(independentDb);
    });

    async function cleanup() {
        for (const table of ['guild_records', 'wallets', 'inventory']) {
            await db.query(`DELETE FROM discord_bot.${table} WHERE guild_id = $1`, [guildId]);
        }
    }

    beforeEach(async () => {
        await cleanup();
        jest.spyOn(store, 'transact').mockImplementation(primary.transact);
        jest.spyOn(store, 'read').mockImplementation(primary.read);
    });
    afterEach(() => jest.restoreAllMocks());
    afterAll(async () => {
        if (db) await cleanup();
        await Promise.all([db?.close(), independentDb?.close()]);
    });

    function fixture(post) {
        const all = new PermissionsBitField(PermissionsBitField.All);
        const author = { permissions: all };
        const channel = { id: '22', type: ChannelType.GuildText, permissionsFor: () => all };
        return { id: guildId, channels: { cache: new Map([[channel.id, channel]]) },
            members: { me: {}, fetch: jest.fn().mockResolvedValue(author) }, client: { rest: { post } } };
    }

    async function seed(overrides = {}) {
        await primary.transact(guildId, async (state, save) => {
            state.announcements['1'] = { id: 1, authorId: '11', channelId: '22', status: 'pending',
                sendAt: Date.now() - 1000, nonce: '778', text: 'Thông báo thử', ...overrides };
            await save();
        });
    }

    test('commits its sending marker before REST and keeps wallets responsive during a slow delivery', async () => {
        await seed();
        let finishPost;
        let enteredPost;
        const entered = new Promise(resolve => { enteredPost = resolve; });
        const post = jest.fn(() => {
            enteredPost();
            return new Promise(resolve => { finishPost = resolve; });
        });
        const guild = fixture(post);
        const sending = sendDueAnnouncements(guild);
        await entered;
        try {
            const visible = (await independent.read(guildId)).announcements['1'];
            expect(visible).toMatchObject({ status: 'sending', nonce: '778' });
            expect(visible.deliveryToken).toBeTruthy();
            let timeout;
            try {
                await Promise.race([
                    independent.transact(guildId, async (state, save) => {
                        state.taixiu.balances['101'] = 500_000;
                        await save();
                    }),
                    new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Wallet blocked by Discord REST')), 2000); })
                ]);
            } finally { clearTimeout(timeout); }
            await sendDueAnnouncements(guild);
            expect(post).toHaveBeenCalledTimes(1);
        } finally {
            finishPost({ id: '99' });
            await sending;
        }
        const saved = await independent.read(guildId);
        expect(saved.announcements['1']).toMatchObject({ status: 'sent', messageId: '99' });
        expect(saved.announcements['1'].deliveryToken).toBeUndefined();
        expect(saved.taixiu.balances['101']).toBe(500_000);
    });

    test('retries with the same nonce and stops retrying outside the deduplication window', async () => {
        let clock = Date.now();
        jest.spyOn(Date, 'now').mockImplementation(() => clock);
        jest.spyOn(console, 'error').mockImplementation(() => {});
        await seed();
        const post = jest.fn().mockRejectedValue(new Error('Network timeout'));
        const guild = fixture(post);
        await sendDueAnnouncements(guild);
        const first = (await independent.read(guildId)).announcements['1'];
        expect(first.status).toBe('sending');
        expect(first.firstAttempt).toBe(clock);
        expect(first.deliveryToken).toBeUndefined();
        await sendDueAnnouncements(guild);
        expect(post).toHaveBeenCalledTimes(1);
        clock += 15_000;
        await sendDueAnnouncements(guild);
        expect(post).toHaveBeenCalledTimes(2);
        expect(post.mock.calls[1]).toEqual(post.mock.calls[0]);
        clock = first.firstAttempt + 120_000;
        await sendDueAnnouncements(guild);
        expect(post).toHaveBeenCalledTimes(2);
        expect((await independent.read(guildId)).announcements['1'].status).toBe('unknown');
    });
});
