// Isolated UI preview: no Discord client, environment file or database is opened.
const { randomBytes } = require('node:crypto');
const { createHealthServer, startHealthServer } = require('../utils/runtime');
const { createAdminHandler } = require('../utils/adminWeb');
const { hashPassword, parseAdminConfig } = require('../utils/adminAuth');

async function start() {
    const port = Number(process.env.ADMIN_PREVIEW_PORT ?? 4317);
    const origin = `http://127.0.0.1:${port}`;
    const password = process.env.ADMIN_PREVIEW_PASSWORD || randomBytes(12).toString('base64url');
    const config = parseAdminConfig({ ADMIN_ENABLED: 'true', ADMIN_ORIGIN: origin, ADMIN_PASSWORD_HASH: await hashPassword(password) });
    const guild = { id: '123456789012345678', name: 'Tiệm Bánh Mây', memberCount: 1284 };
    const songs = [{ title: 'Nắng ấm xa dần', duration: '4:18', requester: 'Minh', position: 1 },
        { title: 'Một ngày thật khác', duration: '3:46', requester: 'Lan', position: 2 }];
    const music = { current: songs[0], paused: false, connected: true, volume: 65, loopMode: 'off', autoplay: false, queue: songs };
    const settings = { taixiuEnabled: true, taixiuChannelId: '234567890123456789' };
    const activity = [{ id: 'demo-1', action: 'music.volume', guildName: guild.name, status: 'success',
        detail: 'Đã đặt âm lượng 65%.', at: Date.now() - 120000 }];
    const battles = [{ id: '345678901234567890', status: 'waiting', players: 2, capacity: 4, roundCount: 12,
        channelId: '234567890123456789', fee: '450,000 xu' }];
    const members = [{ userId: '456789012345678901', userName: 'Minh Anh', username: 'minhanh', avatar: null },
        { userId: '456789012345678902', userName: 'Lan Hương', username: 'lanhuong', avatar: null },
        { userId: '456789012345678903', userName: 'Đức Hải', username: 'duchai', avatar: null }];
    const catalogue = () => ({ cases: require('../utils/cs2BattleCases').customCases.map(item => ({
        id: item.id, name: item.name, description: item.description, group: item.group,
        image: `/admin/art/${item.artId ?? item.id}.png`, available: false, fee: null, riskLabel: 'Giá minh họa chưa đồng bộ' })), pricedAt: Date.now() });
    const service = {
        overview: () => ({ demo: true, bot: { name: 'Mây Bot', tag: 'MayBot', ready: true, ping: 42, uptimeSeconds: 18364 },
            system: { rssMb: 186 }, guilds: [guild], catalogue: { caseCount: 169 }, activity }),
        guild: () => ({ guild, music, settings, battles, channels: [{ id: '234567890123456789', name: 'tiem-banh', type: 0 }],
            wallets: [{ ...members[0], memberAvailable: true, balance: '12,450,000 xu' },
                { ...members[1], memberAvailable: true, balance: '6,850,000 xu' },
                { userId: '456789012345678999', userName: 'Thành viên đã rời máy chủ', memberAvailable: false, balance: '125,000 xu' }], activity }),
        members: (_id, query = '') => {
            const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
            const search = normalize(typeof query === 'string' ? query : query.search ?? '');
            return { members: members.filter(member => normalize(`${member.userName} ${member.username} ${member.userId}`).includes(search)), hasMore: false };
        },
        catalogue, activity: () => activity,
        music: (_id, body) => { if (body.action === 'pause') music.paused = true; if (body.action === 'resume') music.paused = false;
            if (body.action === 'volume') music.volume = body.volume; if (body.action === 'loop') music.loopMode = body.mode;
            return { message: 'Đã cập nhật bản xem thử.' }; },
        settings: (_id, body) => { Object.assign(settings, body); return { message: 'Đã lưu thiết lập minh họa.' }; },
        coins: () => ({ message: 'Đã kiểm tra biểu mẫu minh họa; không cộng xu thật.' }),
        cancelBattle: () => { battles[0].status = 'cancelled'; return { message: 'Đã hủy phòng minh họa.' }; },
        refreshPrices: () => ({ message: 'Bản xem thử dùng danh mục cục bộ, không đồng bộ giá thật.' })
    };
    const handler = createAdminHandler({ config, service });
    const server = createHealthServer({ isReady: () => true, guilds: { cache: new Map() } }, { handler });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    console.log(`Preview: ${origin}/admin/`);
    console.log(`Preview password: ${password}`);
    const stop = () => { server.close(); server.closeAllConnections(); };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
}

if (require.main === module) void start().catch(error => { console.error(error.message); process.exitCode = 1; });
