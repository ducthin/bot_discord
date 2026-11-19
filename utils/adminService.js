const os = require('node:os');
const { randomUUID, createHash, randomInt } = require('node:crypto');
const { ChannelType } = require('discord.js');
const { AudioPlayerStatus } = require('@discordjs/voice');
const store = require('./managementStore');
const musicTools = require('./musicUtils');
const battle = require('./cs2Battles');
const wallet = require('../commands/taixiu');
const { isGuildAllowed } = require('./guildUtils');
const { isFeatureEnabled } = require('./features');
const { customCases, cachedPrices, casePricing } = require('./cs2BattleCases');
const priceSnapshot = require('./cs2PriceSnapshot');
const blueGemPrices = require('./cs2BlueGemPrices');
const { parseCoins, serializeCoins, readCoins, formatCoins } = require('./coins');

const AUDIT_LIMIT = 200;
const MEMBER_LIMIT = 25;
const MEMBER_CACHE_TTL = 60_000;
const MEMBER_SEARCH_TTL = 15_000;
const normalizeMemberText = value => value.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase();
const discordId = /^[1-9]\d{0,19}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const text = (value, limit = 240) => typeof value === 'string' ? value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').slice(0, limit) : '';
const safeUrl = value => {
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
    catch { return null; }
};
const imageUrl = (entity, method) => {
    try { return safeUrl(entity?.[method]?.({ size: 128, extension: 'png' })); } catch { return null; }
};

function createAdminService({ client, commands, isShuttingDown = () => false }) {
    let cachedCatalogue;
    let catalogueAt = 0;
    const memberCache = new Map();
    const memberSearchCache = new Map();
    const memberListCache = new Map();

    function memo(cache, key, limit, ttl, load) {
        const previous = cache.get(key);
        if (previous && previous.until > Date.now()) return previous.promise;
        cache.delete(key);
        const entry = { until: Date.now() + ttl };
        entry.promise = Promise.resolve().then(load).then(value => { entry.value = value; return value; });
        cache.set(key, entry);
        while (cache.size > limit) cache.delete(cache.keys().next().value);
        return entry.promise;
    }

    function memberRecord(found, member, expectedId) {
        const user = member?.user;
        const userId = user?.id;
        if (!discordId.test(userId ?? '') || user.bot !== false || (expectedId && expectedId !== userId)
            || (member.id != null && member.id !== userId) || (member.guild?.id != null && member.guild.id !== found.id)
            || (member.guildId != null && member.guildId !== found.id)) return null;
        const name = value => text(value, 100).trim();
        const username = name(user.username) || null;
        const userName = name(member.displayName) || name(user.globalName) || username || 'Không rõ tên';
        return { dto: { userId, userName, username, avatar: imageUrl(member, 'displayAvatarURL') ?? imageUrl(user, 'displayAvatarURL') },
            match: normalizeMemberText([member.displayName, member.nickname, user.globalName, user.username, userId]
                .map(value => name(value)).join(' ')) };
    }

    function rememberMember(found, record) {
        const value = { record, failed: false };
        memberCache.set(`${found.id}:${record.dto.userId}`, { until: Date.now() + MEMBER_CACHE_TTL, value, promise: Promise.resolve(value) });
        while (memberCache.size > 1000) memberCache.delete(memberCache.keys().next().value);
    }

    function localMembers(found) {
        const records = new Map();
        let inspected = 0;
        let hasMore = false;
        for (const member of found.members.cache?.values?.() ?? []) {
            if (++inspected > 1000) { hasMore = true; break; }
            const record = memberRecord(found, member);
            if (record) records.set(record.dto.userId, record);
        }
        const prefix = `${found.id}:`;
        for (const [key, entry] of memberCache) {
            if (key.startsWith(prefix) && entry.until > Date.now() && entry.value?.record && !records.has(entry.value.record.dto.userId)) {
                records.set(entry.value.record.dto.userId, entry.value.record);
            }
        }
        return { records, hasMore };
    }

    async function findMember(found, userId) {
        const local = memberRecord(found, found.members.cache?.get?.(userId), userId);
        if (local) return { record: local, failed: false };
        if (!client.isReady()) return { record: null, failed: true };
        return memo(memberCache, `${found.id}:${userId}`, 1000, MEMBER_CACHE_TTL, async () => {
            try {
                const member = await found.members.fetch({ user: userId, force: true, cache: false });
                return { record: memberRecord(found, member, userId), failed: false };
            } catch (error) {
                return { record: null, failed: ![10007, 10013].includes(error.code) };
            }
        });
    }

    async function enrichWallets(found, entries) {
        const results = new Array(entries.length);
        let next = 0;
        await Promise.all(Array.from({ length: Math.min(5, entries.length) }, async () => {
            while (next < entries.length) {
                const index = next++;
                results[index] = await findMember(found, entries[index].userId);
            }
        }));
        return entries.map((entry, index) => ({ ...entry, userName: results[index].record?.dto.userName ?? 'Không rõ tên',
            username: results[index].record?.dto.username ?? null, avatar: results[index].record?.dto.avatar ?? null,
            memberAvailable: Boolean(results[index].record) }));
    }

    function walletEntries(state) {
        return Object.entries(state.taixiu?.balances ?? {}).filter(([userId]) => discordId.test(userId))
            .map(([userId, balance]) => ({ userId, amount: readCoins(balance) }))
            .sort((a, b) => a.amount === b.amount ? 0 : a.amount > b.amount ? -1 : 1).slice(0, 50)
            .map(({ userId, amount }) => ({ userId, balance: formatCoins(amount) }));
    }

    async function members(id, search = '') {
        const found = getGuild(id, true);
        if (typeof search !== 'string' || search.length > 100 || search !== text(search, 100)) fail(400, 'Từ khóa tìm thành viên tối đa 100 ký tự.');
        const query = search.trim();
        if (/^\d+$/.test(query) && !discordId.test(query)) fail(400, 'ID thành viên không hợp lệ.');
        return structuredClone(await memo(memberSearchCache, `${id}:${query.toLowerCase()}`, 100, MEMBER_SEARCH_TTL, async () => {
            if (discordId.test(query)) {
                const result = await findMember(found, query);
                return { members: result.record ? [result.record.dto] : [], hasMore: false,
                    ...(result.failed ? { notice: 'Chưa kiểm tra được thành viên với Discord. Vui lòng thử lại sau.' } : {}) };
            }
            const local = localMembers(found);
            let hasMore = local.hasMore;
            let incomplete = false;
            if (query) {
                try {
                    const matches = await found.members.search({ query, limit: MEMBER_LIMIT, cache: false });
                    let count = 0;
                    for (const member of matches.values()) {
                        if (++count > MEMBER_LIMIT) break;
                        const record = memberRecord(found, member);
                        if (record) { local.records.set(record.dto.userId, record); rememberMember(found, record); }
                    }
                    hasMore ||= matches.size >= MEMBER_LIMIT;
                } catch { incomplete = true; }
            } else {
                const listed = await memo(memberListCache, id, 50, MEMBER_CACHE_TTL, async () => {
                    try {
                        const matches = await found.members.list({ limit: 100, cache: false });
                        const records = [];
                        let count = 0;
                        for (const member of matches.values()) {
                            if (++count > 100) break;
                            const record = memberRecord(found, member);
                            if (record) records.push(record);
                        }
                        return { records, hasMore: matches.size >= 100, failed: false };
                    } catch { return { records: [], hasMore: false, failed: true }; }
                });
                for (const record of listed.records) { local.records.set(record.dto.userId, record); rememberMember(found, record); }
                hasMore ||= listed.hasMore;
                incomplete ||= listed.failed;
                const state = await store.read(id, { wallets: 'all' });
                const entries = walletEntries(state);
                await enrichWallets(found, entries);
                for (const entry of entries) {
                    const record = memberRecord(found, found.members.cache?.get?.(entry.userId), entry.userId)
                        ?? memberCache.get(`${id}:${entry.userId}`)?.value?.record;
                    if (record) local.records.set(entry.userId, record);
                }
                hasMore ||= Object.keys(state.taixiu?.balances ?? {}).length > entries.length;
            }
            const needle = normalizeMemberText(query);
            const results = [...local.records.values()].filter(record => !needle || record.match.includes(needle))
                .sort((a, b) => a.dto.userName.localeCompare(b.dto.userName, 'vi') || a.dto.userId.localeCompare(b.dto.userId));
            return { members: results.slice(0, MEMBER_LIMIT).map(record => record.dto), hasMore: hasMore || results.length > MEMBER_LIMIT,
                ...(incomplete ? { notice: 'Danh sách Discord chưa đầy đủ. Bạn có thể tìm thêm bằng ID người nhận.' } : {}) };
        }));
    }

    function assertRunning() {
        if (isShuttingDown()) fail(503, 'Bot đang dừng. Vui lòng thử lại sau.');
    }

    function allowedGuilds() {
        return [...client.guilds.cache.values()].filter(item => item?.available !== false && isGuildAllowed(item.id));
    }

    function getGuild(id, write = false) {
        assertRunning();
        if (!discordId.test(id ?? '') || !isGuildAllowed(id)) fail(404, 'Không tìm thấy máy chủ được phép quản lý.');
        const found = client.guilds.cache.get(id);
        if (!found || found.available === false) fail(404, 'Máy chủ hiện không khả dụng.');
        if (write && !client.isReady()) fail(503, 'Bot chưa kết nối Discord.');
        return found;
    }

    const guildSummary = item => ({ id: item.id, name: text(item.name, 100), icon: imageUrl(item, 'iconURL'), memberCount: item.memberCount ?? 0 });

    function addAudit(state, guild, action, message, meta = {}) {
        const entry = { id: randomUUID(), guildId: guild.id, guildName: text(guild.name, 100), action,
            message: text(message, 400), detail: text(message, 400), at: Date.now(), ...meta };
        const entries = Array.isArray(state.adminAudit?.entries) ? state.adminAudit.entries : [];
        state.adminAudit = { entries: [entry, ...entries].slice(0, AUDIT_LIMIT) };
        return entry;
    }

    async function audit(guild, action, message, meta) {
        const entry = await store.transact(guild.id, async (state, save) => {
            const entry = addAudit(state, guild, action, message, meta);
            await save();
            return entry;
        }, { sections: ['adminAudit'] });
        return entry;
    }

    async function activity() {
        assertRunning();
        const lists = await Promise.all(allowedGuilds().map(async item => {
            const state = await store.read(item.id, { sections: ['adminAudit'] });
            const entries = Array.isArray(state.adminAudit?.entries) ? state.adminAudit.entries : [];
            return entries.map(entry => ({ id: text(entry.id, 60), guildId: item.id, guildName: text(item.name, 100),
                action: text(entry.action, 80), message: text(entry.message, 400), detail: text(entry.message, 400), at: entry.at,
                ...(entry.userId ? { userId: text(entry.userId, 20) } : {}), ...(entry.reason ? { reason: text(entry.reason, 160) } : {}) }));
        }));
        return lists.flat().sort((a, b) => b.at - a.at).slice(0, AUDIT_LIMIT);
    }

    function catalogue() {
        assertRunning();
        if (!cachedCatalogue || Date.now() - catalogueAt >= 10_000) {
            const priceOf = cachedPrices();
            const cases = customCases.map(item => {
                const pricing = casePricing(item, priceOf);
                return { id: item.id, name: item.name, description: item.description, group: item.group,
                    art: `/admin/art/${item.artId ?? item.id}.png`, image: `/admin/art/${item.artId ?? item.id}.png`,
                    available: Boolean(pricing), fee: pricing ? formatCoins(pricing.fee) : null,
                    expected: pricing ? formatCoins(pricing.expected) : null,
                    maxValue: pricing ? formatCoins(pricing.maxValue) : null, riskLevel: pricing?.riskLevel ?? null,
                    riskLabel: pricing?.riskLabel ?? 'Đang chờ giá', entryCount: pricing?.entries.length ?? item.entries.length };
            });
            catalogueAt = Date.now();
            cachedCatalogue = { cases, caseCount: cases.length, availableCases: cases.filter(item => item.available).length,
                pricedAt: catalogueAt, nextRefreshAt: Math.min(priceSnapshot.nextRefreshAt(), blueGemPrices.nextRefreshAt()) };
        }
        return structuredClone(cachedCatalogue);
    }

    function songSummary(song, position) {
        return song ? { title: text(song.title, 200) || 'Không rõ tên', url: safeUrl(song.url), thumbnail: safeUrl(song.thumbnail),
            duration: text(String(song.duration ?? ''), 20), requester: text(song.requester ?? song.requestedBy, 100), position } : null;
    }

    function musicSummary(id) {
        const data = musicTools.musicData.get(id);
        const status = data?.player?.state?.status;
        return { current: songSummary(data?.currentSong), paused: [AudioPlayerStatus.Paused, AudioPlayerStatus.AutoPaused].includes(status),
            connected: Boolean(data?.connection && data.connection.state?.status !== 'destroyed'), volume: data?.volume ?? 50,
            loopMode: data?.loopMode ?? 'off', autoplay: data?.autoplay === true,
            elapsedSeconds: data ? musicTools.getCurrentPlaybackTime(data) : 0,
            queue: (data?.queue ?? []).slice(0, 200).map((song, index) => ({ ...songSummary(song, index + 1), current: song === data.currentSong })) };
    }

    function battleSummary(room) {
        return { id: text(room.id, 60), status: text(room.status, 20), mode: text(room.mode, 20), hostId: text(room.hostId, 20),
            channelId: text(room.channelId, 20), players: Array.isArray(room.players) ? room.players.length : 0,
            capacity: battle.capacity(room), roundCount: room.caseIds?.length ?? 0,
            fee: formatCoins(BigInt(room.fee ?? 0)), createdAt: room.createdAt, expiresAt: room.expiresAt };
    }

    async function overview() {
        assertRunning();
        const memory = process.memoryUsage();
        const { cases: _cases, ...catalogueSummary } = catalogue();
        return { bot: { name: text(client.user?.username, 80) || 'Discord Bot', tag: text(client.user?.tag, 100),
            avatar: imageUrl(client.user, 'displayAvatarURL'), ready: client.isReady(), ping: Math.max(0, Math.round(client.ws?.ping ?? 0)),
            uptimeSeconds: Math.floor((client.uptime ?? 0) / 1000) },
        system: { memoryMb: Math.round(memory.rss / 1048576), rssMb: Math.round(memory.rss / 1048576),
            heapMb: Math.round(memory.heapUsed / 1048576), platform: process.platform, nodeVersion: process.version,
            uptimeSeconds: Math.floor(process.uptime()), hostUptimeSeconds: Math.floor(os.uptime()) },
        guilds: allowedGuilds().map(guildSummary), features: { serverManagement: isFeatureEnabled('serverManagement'),
            music: true, battles: true, coins: true, commands: commands?.size ?? 0 }, catalogue: catalogueSummary, activity: await activity() };
    }

    async function guild(id) {
        const found = getGuild(id);
        const state = await store.read(id, { sections: ['settings', 'cs2Battles', 'adminAudit'], wallets: 'all' });
        const wallets = await enrichWallets(found, walletEntries(state));
        return { guild: guildSummary(found), channels: [...found.channels.cache.values()]
            .filter(channel => [ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type))
            .map(channel => ({ id: channel.id, name: text(channel.name, 100), type: channel.type })).slice(0, 500),
        music: musicSummary(id), settings: { taixiuChannelId: state.settings?.taixiuRoom?.channelId ?? null,
            taixiuEnabled: Boolean(state.settings?.taixiuRoom?.channelId) },
        battles: Object.values(state.cs2Battles ?? {}).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, 100).map(battleSummary),
        wallets, activity: (state.adminAudit?.entries ?? []).slice(0, 50).map(entry => ({ id: text(entry.id, 60),
            guildId: found.id, guildName: text(found.name, 100), action: text(entry.action, 80), message: text(entry.message, 400),
            detail: text(entry.message, 400), at: entry.at })) };
    }

    async function music(id, body = {}) {
        const found = getGuild(id, true);
        const action = body.action;
        if (!['pause', 'resume', 'skip', 'stop', 'disconnect', 'volume', 'loop', 'autoplay', 'shuffle', 'remove'].includes(action)) fail(400, 'Thao tác âm nhạc không hợp lệ.');
        const data = musicTools.initGuildMusicData(id);
        let message;
        if (action === 'pause' || action === 'resume') {
            if (!data.currentSong || !data.player) fail(409, 'Chưa có bài hát đang phát.');
            if (data.player.state?.status === AudioPlayerStatus.AutoPaused) fail(409, 'Kết nối voice chưa sẵn sàng để phát nhạc.');
            const changed = action === 'pause' ? data.player.pause() : data.player.unpause();
            if (!changed) fail(409, 'Chưa thể đổi trạng thái phát.');
            message = action === 'pause' ? 'Đã tạm dừng nhạc.' : 'Đã tiếp tục phát nhạc.';
        } else if (action === 'skip') {
            if (!musicTools.skipCurrentSong(data)) fail(409, 'Chưa có bài hát để bỏ qua.');
            message = 'Đã bỏ qua bài hiện tại.';
        } else if (action === 'stop') {
            await musicTools.stopMusic(data); message = 'Đã dừng nhạc và xóa hàng đợi.';
        } else if (action === 'disconnect') {
            await musicTools.disconnectMusic(data); message = 'Đã rời phòng thoại.';
        } else if (action === 'volume') {
            const value = body.volume ?? body.value;
            if (!Number.isInteger(value) || value < 0 || value > 100) fail(400, 'Âm lượng phải là số nguyên từ 0 đến 100.');
            data.volume = value;
            data.audioResource?.volume?.setVolume(value / 100);
            message = `Đã đặt âm lượng ${value}%.`;
        } else if (action === 'loop') {
            const mode = body.mode ?? body.value;
            if (!['off', 'track', 'queue'].includes(mode)) fail(400, 'Chế độ lặp không hợp lệ.');
            data.loopMode = mode; message = `Đã đổi chế độ lặp: ${{ off: 'Tắt', track: 'Một bài', queue: 'Hàng đợi' }[mode]}.`;
        } else if (action === 'autoplay') {
            const value = body.enabled ?? body.value;
            if (typeof value !== 'boolean') fail(400, 'Trạng thái tự phát phải là bật hoặc tắt.');
            data.autoplay = value; message = `Đã ${value ? 'bật' : 'tắt'} tự phát nhạc.`;
        } else if (action === 'shuffle') {
            const start = Number(Boolean(data.currentSong && data.queue[0] === data.currentSong));
            if (data.queue.length - start < 2) fail(409, 'Cần ít nhất hai bài đang chờ để trộn.');
            for (let index = data.queue.length - 1; index > start; index--) {
                const target = randomInt(start, index + 1);
                [data.queue[index], data.queue[target]] = [data.queue[target], data.queue[index]];
            }
            message = 'Đã trộn các bài đang chờ.';
        } else if (action === 'remove') {
            const position = body.position;
            if (!Number.isInteger(position) || position < 1 || position > data.queue.length) fail(400, 'Vị trí bài hát không hợp lệ.');
            if (data.queue[position - 1] === data.currentSong) fail(409, 'Dùng Bỏ qua để bỏ bài đang phát.');
            if (body.expectedUrl !== null && typeof body.expectedUrl !== 'string') fail(400, 'Hãy tải lại hàng đợi trước khi xóa bài.');
            const expected = safeUrl(body.expectedUrl);
            if (typeof body.expectedUrl === 'string' && !expected) fail(400, 'Địa chỉ bài hát cần xóa không hợp lệ.');
            const current = safeUrl(data.queue[position - 1]?.url);
            if (expected !== current) fail(409, 'Hàng đợi đã thay đổi. Hãy tải lại rồi thử xóa lại.');
            data.queue.splice(position - 1, 1); message = 'Đã xóa bài khỏi hàng đợi.';
        }
        await audit(found, `music.${action}`, message);
        return { message, music: musicSummary(id) };
    }

    async function settings(id, body = {}) {
        const found = getGuild(id, true);
        const enabled = body.taixiuEnabled;
        if (typeof enabled !== 'boolean') fail(400, 'Hãy chọn bật hoặc tắt bàn Tiệm Bánh.');
        const channelId = body.taixiuChannelId;
        if (enabled && (!discordId.test(channelId ?? '') || !wallet.automaticChannel(found, channelId))) {
            fail(400, 'Chọn kênh chữ mà bot có quyền xem, gửi tin và nhúng liên kết.');
        }
        const message = enabled ? 'Đã cập nhật kênh bàn Tiệm Bánh.' : 'Đã tắt bàn Tiệm Bánh tự động.';
        await store.transact(id, async (state, save) => {
            state.settings ??= {};
            if (enabled) state.settings.taixiuRoom = { channelId };
            else delete state.settings.taixiuRoom;
            addAudit(state, found, 'settings.bakery', message, { enabled, ...(enabled ? { channelId } : {}) });
            await save();
        }, { sections: ['settings', 'adminAudit'] });
        try { await wallet.syncAutomaticBoard(found); }
        catch { return { message: `${message} Bot chưa đồng bộ được bảng Discord; kiểm tra quyền kênh và thử lại.`,
            warning: true, settings: { taixiuEnabled: enabled, taixiuChannelId: enabled ? channelId : null } }; }
        return { message, settings: { taixiuEnabled: enabled, taixiuChannelId: enabled ? channelId : null } };
    }

    async function coins(id, body = {}) {
        const found = getGuild(id, true);
        const { userId, requestId } = body;
        const amountInput = typeof body.amount === 'string' ? body.amount.trim() : '';
        const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
        if (!discordId.test(userId ?? '') || !uuid.test(requestId ?? '')) fail(400, 'ID người nhận hoặc mã yêu cầu không hợp lệ.');
        if (!reason || reason.length > 160 || reason !== text(reason, 160)) fail(400, 'Nhập lý do từ 1 đến 160 ký tự.');
        const amount = amountInput.length <= 30 ? parseCoins(amountInput) : null;
        if (!amount) fail(400, 'Số xu phải lớn hơn 0, tối đa 2 chữ số thập phân.');
        const fingerprint = createHash('sha256').update(JSON.stringify([userId, amount.toString(), reason])).digest('hex');
        const replay = await store.read(id, { sections: ['adminRequests'] });
        const previous = replay.adminRequests?.[requestId];
        if (previous) {
            if (previous.fingerprint !== fingerprint) fail(409, 'Mã yêu cầu đã dùng cho nội dung khác.');
            return { ...previous.result, replayed: true };
        }
        const member = await found.members.fetch({ user: userId, force: true, cache: false }).catch(error => {
            if ([10007, 10013].includes(error.code)) return null;
            throw error;
        });
        const recipient = memberRecord(found, member, userId);
        if (!recipient) fail(400, 'Người nhận phải là thành viên thật đang ở máy chủ.');
        assertRunning();
        let updatedState;
        const scope = { sections: ['adminRequests', 'adminAudit'], wallets: [userId] };
        const result = await store.transact(id, async (state, save) => {
            const requests = state.adminRequests ??= {};
            const previous = requests[requestId];
            if (previous) {
                if (previous.fingerprint !== fingerprint) fail(409, 'Mã yêu cầu đã dùng cho nội dung khác.');
                return { ...previous.result, replayed: true };
            }
            const balance = wallet.getCoinBalance(state, userId) + amount;
            if (balance < 0n) fail(409, 'Số dư không hợp lệ.');
            (state.taixiu ??= { balances: {}, round: null }).balances[userId] = serializeCoins(balance);
            const result = { message: `Đã cộng ${formatCoins(amount)} cho ${recipient.dto.userName} (${userId}).`, userId, userName: recipient.dto.userName,
                amount: formatCoins(amount), balance: formatCoins(balance), replayed: false };
            requests[requestId] = { fingerprint, result, at: Date.now() };
            addAudit(state, found, 'coins.grant', result.message, { userId, reason, amount: amount.toString(), requestId });
            await save();
            updatedState = state;
            return result;
        }, scope);
        if (updatedState) {
            try { wallet.refreshCoinLeaderboard(found, updatedState, scope); }
            catch (error) { console.warn('Không cập nhật được xếp hạng sau cộng xu quản trị:', error.code ?? 'unknown'); }
        }
        return result;
    }

    async function cancelBattle(id, roomId) {
        const found = getGuild(id, true);
        if (typeof roomId !== 'string' || !discordId.test(roomId)) fail(400, 'ID trận không hợp lệ.');
        const state = await store.read(id, { sections: ['cs2Battles'] });
        const room = state.cs2Battles?.[roomId];
        if (!room) fail(404, 'Không tìm thấy trận Battle.');
        if (!battle.isOpen(room)) fail(409, 'Chỉ có thể hủy phòng Battle đang chờ.');
        const result = await battle.actOnRoom(found, room.channelId, room.id, room.hostId, 'cancel');
        if (result.error) fail(409, result.error);
        if (result.room?.status !== 'cancelled') fail(409, 'Trận đã bắt đầu; không thể hủy.');
        const message = 'Đã hủy phòng Battle đang chờ; không trừ xu.';
        await audit(found, 'battle.cancel', message, { roomId });
        return { message, battle: battleSummary(result.room) };
    }

    async function refreshPrices() {
        assertRunning();
        const [buff, blueGem] = await Promise.all([priceSnapshot.refresh(), blueGemPrices.refresh()]);
        cachedCatalogue = undefined;
        const status = { buff: { status: buff.status, count: buff.count, updatedAt: buff.updatedAt, nextRefreshAt: buff.nextRefreshAt },
            blueGem: { status: blueGem.status, count: blueGem.count, updatedAt: blueGem.updatedAt, nextRefreshAt: blueGem.nextRefreshAt } };
        const message = [buff, blueGem].every(item => item.status === 'cooldown')
            ? 'Bảng giá đã được kiểm tra trong chu kỳ này; bot tiếp tục đồng bộ theo lịch.' : 'Đã hoàn tất yêu cầu kiểm tra bảng giá.';
        return { message, ...status, catalogue: catalogue() };
    }

    return { overview, guild, members, catalogue, music, settings, coins, cancelBattle, refreshPrices, activity };
}

module.exports = { createAdminService };
