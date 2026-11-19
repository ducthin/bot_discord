const { setTimeout: delay } = require('node:timers/promises');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, RESTJSONErrorCodes, escapeMarkdown } = require('discord.js');
const { COIN_SCALE, formatCoins } = require('./coins');
const { wearNames } = require('./cs2MarketNames');
const { TICKETS, customCases, customCasesById, ICONIC_CASE_IDS, casePricing, cachedPrices, lockedCase, riskMetrics } = require('./cs2BattleCases');
const { caseDescription, seedOddsNote } = require('./cs2CasePresentation');
const { respond } = require('./managementAccess');
const reel = require('./cs2Reel');
const metrics = require('./performanceMetrics');
const battle = require('./cs2Battles');
const { getBattleCaseArt, getBattleTieArt, getBattleTieAnimation } = require('./cs2BattleArt');
const market = require('./cs2Market');
const { MAX_PAINT_SEED } = require('./cs2Patterns');
const { getBlueGemReference } = require('./cs2BlueGemArt');

const PREFIX = 'mg_hom_battle-';
const DRAFT_TTL = 15 * 60_000;
const DRAFT_LIMIT = 128;
const CASE_MENU_SIZE = 23;
const ODDS_PAGE_SIZE = 8;
const SCHEDULE_PAGE_SIZE = 1;
const RESULT_PAGE_SIZE = 4;
const EMBED_TEXT_LIMIT = 6000;
const RESULT_LIFETIME_NOTE = `Tin kết quả tự xóa sau ${battle.RESULT_MESSAGE_LIFETIME / 60_000} phút · Có thể tạo lại khi tin kết quả còn hiệu lực`;
const RESULT_DELETE_RETRY_MS = 60_000;
const CASE_GROUPS = {
    casual: 'Khởi đầu', weapon: 'Theo dòng súng', rarity: 'Theo độ hiếm', theme: 'Theo chủ đề', gold: 'Dao, găng và Doppler'
};
const CASE_RISKS = { low: 'Rủi ro thấp', medium: 'Rủi ro vừa', high: 'Rủi ro cao', extreme: 'Rủi ro rất cao' };
const newCaseIds = new Set(ICONIC_CASE_IDS);
const CASE_BUDGETS = [
    ['under-50k', 'Dưới 50,000 xu', 0n, 50_000n],
    ['under-300k', '50,000 đến dưới 300,000 xu', 50_000n, 300_000n],
    ['under-1m', '300,000 đến dưới 1,000,000 xu', 300_000n, 1_000_000n],
    ['from-1m', 'Từ 1,000,000 xu', 1_000_000n, null]
];
const percent = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });
const seedPercent = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 5 });
const oddsText = weight => `${(Number.isInteger(weight) ? percent : seedPercent).format(weight * 100 / TICKETS)}%`;
const FILE = 'cs2-battle.gif';
const BATTLE_ROWS_PER_IMAGE = 3;
// Leave room for the rest of the multipart request under Discord's 25 MiB limit.
const BATTLE_IMAGE_BUDGET = 20_000_000;
const mentions = { parse: [] };

const modeDescriptions = {
    regular: 'Tổng giá cao nhất thắng', crazy: 'Tổng giá thấp nhất thắng', sharing: 'Chia đều giá trị tất cả món đã mở'
};

const row = (...components) => new ActionRowBuilder().addComponents(components);
const button = (action, id, label, style = ButtonStyle.Secondary, disabled = false) => new ButtonBuilder()
    .setCustomId(`${PREFIX}${action}_${id}`).setLabel(label).setStyle(style).setDisabled(disabled);
const select = (action, id, label, options) => new StringSelectMenuBuilder()
    .setCustomId(`${PREFIX}${action}_${id}`).setPlaceholder(label).addOptions(options);
const playerName = player => `${player.isBot ? '🤖 Bot' : `<@${player.id}>`}${player.team ? ` · Đội ${player.team}` : ''}`;
const seatedPlayerName = (room, player) => {
    const seat = battle.getSeats(room).findIndex(item => item?.id === player.id) + 1;
    return `${seat > 0 ? `${battle.seatLabel(room, seat)} · ` : ''}${playerName(player)}`;
};
const seatList = room => battle.getSeats(room).map((player, index) =>
    `${battle.seatLabel(room, index + 1)} · ${player ? playerName(player) : 'Trống'}`).join('\n');
const netValue = amount => amount > 0n ? `Lời ${formatCoins(amount)}` : amount < 0n ? `Lỗ ${formatCoins(-amount)}` : 'Hòa vốn';
const animationLabel = () => 'Đầy đủ · phát từng vòng';

function pricingMetrics(pricing) {
    const metrics = riskMetrics(pricing);
    if (!metrics) return '';
    const { fee, lossTickets, profitTickets, breakEvenTickets, maxValue, riskLabel } = metrics;
    const multiplier = percent.format(Number(maxValue * 100n / fee) / 100);
    return `Lời **${oddsText(profitTickets)}** · Hòa vốn **${oddsText(breakEvenTickets)}** · Lỗ **${oddsText(lossTickets)}**` +
        `\nTối đa **${multiplier}× phí** · Rủi ro: **${riskLabel}**` +
        '\nGiá trị kỳ vọng khoảng 95% phí; mỗi lượt độc lập và có thể lỗ.';
}

function rules(room) {
    const winner = room.tieSplit ? 'Các bên thắng đồng điểm chia đều giá trị toàn bộ món bằng xu.'
        : room.format === 'teams' ? 'Đội thắng chia đều giá trị toàn bộ món bằng xu.'
        : room.mode === 'sharing' ? 'Mỗi người nhận phần của mình bằng xu.' : 'Người thắng nhận toàn bộ skin vào kho.';
    const tie = room.tieRule === 'split' ? 'Hòa điểm: các bên đồng hạng thắng chia đều toàn bộ giá trị bằng xu.'
        : room.tieRule === 'sudden-death' ? 'Hòa điểm: vòng phụ 50/50 giữa từng cặp đồng hạng; nhiều bên dùng nhánh đấu xáo ngẫu nhiên.'
            : 'Hòa điểm: bốc thăm theo luật phòng cũ.';
    const coinPayout = room.payoutType === 'coins' || room.tieSplit || room.format === 'teams' || room.mode === 'sharing';
    const botShare = coinPayout && room.players?.some(player => player.isBot) && BigInt(room.unclaimedPayout ?? 0) > 0n
        ? '\nPhần chia của Bot không cộng vào ví người chơi.' : '';
    return `**${battle.formatLabel(room)} · ${battle.MODES[room.mode]}**\n${modeDescriptions[room.mode]}. ${winner}` +
        (room.mode === 'sharing' ? '' : `\n${tie}`) + botShare;
}

function caseArtwork(embed, item, limit, dropImage) {
    const art = getBattleCaseArt(item, limit);
    if (art) {
        embed.setImage(art.url);
        return [{ attachment: art.buffer, name: art.name }];
    }
    const fallback = item?.image ?? (item?.entries?.[0] && dropImage?.(item.entries[0].drop));
    if (fallback) embed.setThumbnail(fallback);
    return [];
}

function retainArtwork(payload, currentMessage) {
    const files = payload.files;
    if (!files?.length || !files.every(file => /^cs2-(?:battle-[a-z0-9-]+|tie)\.png$/.test(file.name))) return null;
    const attachments = [...(currentMessage?.attachments?.values?.() ?? [])];
    const retained = files.map(file => attachments.find(item => item.id && item.name === file.name));
    if (retained.some(item => !item)) return null;
    const result = { ...payload, attachments: retained.map(item => ({ id: item.id, filename: item.name })) };
    delete result.files;
    return result;
}

const artworkRejected = error => [40005, 50035, 50045, 50046].includes(error.code) || [400, 413].includes(error.status);

async function deliverArtwork(send, payload, currentMessage) {
    const deliver = value => metrics.measure('battle.upload', () => send(value), () => metrics.payloadBytes(value));
    // Only immutable PNGs already attached to this edit's message can be retained.
    // GIFs are uploaded again so Discord starts each saved animation from its first frame.
    const retained = retainArtwork(payload, currentMessage);
    if (retained) {
        try { return await deliver(retained); } catch (error) {
            if (!artworkRejected(error)) throw error;
            // An attachment may have been removed since the interaction was created.
            // Retry its original file before falling back to an image-free panel.
        }
    }
    try { return await deliver(payload); } catch (error) {
        const artwork = payload.files?.filter(file => /^cs2-(?:battle(?:-[a-z0-9-]+)?|tie[a-z0-9-]*)\.(?:png|gif)$/.test(file.name));
        if (!artwork?.length || artwork.length !== payload.files.length || !artworkRejected(error)) throw error;
        const fallback = { ...payload, attachments: [], embeds: payload.embeds.flatMap((embed, index) => {
            const copy = EmbedBuilder.from(embed);
            if (copy.data.image?.url?.startsWith('attachment://')) {
                if (index > 0 && Object.keys(copy.data).length === 1) return [];
                copy.setImage(null);
            }
            const item = customCasesById.get(artwork[0].name.slice(4, -4));
            if (item?.image) copy.setThumbnail(item.image);
            return [copy];
        }) };
        delete fallback.files;
        return deliver(fallback);
    }
}

const sideName = (room, side) => room.format === 'teams' ? `Đội ${side}`
    : playerName(room.players.find(player => player.id === side) ?? { id: side });

function tieResult(room) {
    if (!room.tie) return null;
    if (room.tieSplit) return 'Các bên đồng hạng thắng chia đều toàn bộ giá trị bằng xu; chênh lệch làm tròn tối đa 0.01 xu mỗi người.';
    if (!room.tieBreaks?.length) return 'Bốc thăm giữa các bên đồng điểm theo luật phòng cũ.';
    const matches = room.tieBreaks.map(match => `Vòng phụ ${match.round}: ${sideName(room, match.left)} ↔ ${sideName(room, match.right)} · **50/50** → ${sideName(room, match.winner)}`);
    const byes = room.tieBracket?.byes?.map(bye => `Vòng phụ ${bye.round}: ${sideName(room, bye.group)} được miễn lượt theo nhánh xáo ngẫu nhiên.`) ?? [];
    return [...matches, ...byes].join('\n');
}

function chunkLines(lines, maxLines = Infinity) {
    const chunks = [];
    let current = [];
    let length = 0;
    for (const line of lines) {
        if (current.length && (current.length >= maxLines || length + 1 + line.length > 1024)) {
            chunks.push(current);
            current = [];
            length = 0;
        }
        current.push(line);
        length += (current.length > 1 ? 1 : 0) + line.length;
    }
    if (current.length) chunks.push(current);
    return chunks;
}

function tieFields(room, name) {
    return chunkLines(tieResult(room).split('\n')).map((lines, index) => ({
        name: index ? `${name} · tiếp` : name, value: lines.join('\n')
    }));
}

const fieldTextLength = field => field.name.length + field.value.length;

function resultPages(roundFields, budget) {
    const pages = [];
    let current = [];
    let length = 0;
    let rounds = 0;
    const finish = () => {
        if (current.length) pages.push(current);
        current = [];
        length = 0;
        rounds = 0;
    };
    for (const fields of roundFields) {
        const roundLength = fields.reduce((sum, field) => sum + fieldTextLength(field), 0);
        if (rounds >= RESULT_PAGE_SIZE || (current.length && length + roundLength > budget)) finish();
        for (const field of fields) {
            if (current.length && length + fieldTextLength(field) > budget) finish();
            current.push(field);
            length += fieldTextLength(field);
        }
        rounds++;
    }
    finish();
    return pages.length ? pages : [[]];
}

const truncate = (value, limit) => value.length <= limit ? value : value.slice(0, limit - 1) + '…';
const caseName = id => battle.getBattleCase(id)?.name ?? 'Hòm không còn trong danh mục';
const clampPage = (page, pages) => Math.max(0, Math.min(Math.trunc(Number(page)) || 0, Math.max(0, pages - 1)));

function caseList(caseIds, page = 0) {
    return caseIds.slice(page * SCHEDULE_PAGE_SIZE, (page + 1) * SCHEDULE_PAGE_SIZE)
        .map((id, index) => `${page * SCHEDULE_PAGE_SIZE + index + 1}. ${truncate(caseName(id), 80)}`).join('\n');
}

function caseSummary(caseIds) {
    const counts = new Map();
    for (const id of caseIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    const lines = [...counts].map(([id, count]) => `${count} × ${truncate(caseName(id), 70)}`);
    let text = '';
    for (const [index, line] of lines.entries()) {
        const remaining = lines.length - index;
        if (text.length + line.length + 40 > 1024) return `${text}\n… và ${remaining} loại hòm. Bấm Lịch hòm.`;
        text += (text ? '\n' : '') + line;
    }
    return text;
}

function interleaveCases(caseIds) {
    const remaining = new Map();
    for (const id of caseIds) remaining.set(id, (remaining.get(id) ?? 0) + 1);
    const ordered = [];
    while (ordered.length < caseIds.length) {
        for (const [id, count] of remaining) {
            if (count > 0) {
                ordered.push(id);
                remaining.set(id, count - 1);
            }
        }
    }
    return ordered;
}

function schedulePanel(room, requestedPage, action = 'room-schedule') {
    const pages = Math.ceil(room.caseIds.length / SCHEDULE_PAGE_SIZE);
    const page = clampPage(requestedPage, pages);
    const embed = new EmbedBuilder().setTitle('Lịch hòm Case Battle').setColor('#5865f2')
        .setDescription(caseList(room.caseIds, page) || 'Chưa thêm hòm.')
        .setFooter({ text: `${room.caseIds.length} vòng · Trang ${page + 1}/${Math.max(1, pages)}` });
    return { embeds: [embed], components: pages > 1 ? [row(
        button(action, `${room.id}_${page - 1}`, 'Trang trước', ButtonStyle.Secondary, page === 0),
        button(action, `${room.id}_${page + 1}`, 'Trang sau', ButtonStyle.Secondary, page === pages - 1)
    )] : [], allowedMentions: mentions };
}

function roomPanel(room, dropImage, attachmentLimit) {
    const open = battle.isOpen(room);
    const status = open ? `Chờ người · ${room.players.length}/${battle.capacity(room)}`
        : room.reason ?? (room.status === 'waiting' ? 'Phòng đã hết hạn.' : 'Chủ phòng đã hủy trận.');
    const item = battle.getBattleCase(room.caseIds[0]);
    const embed = new EmbedBuilder().setTitle('⚔️ Case Battle').setColor(open ? '#5865f2' : '#747f8d')
        .setDescription(`${rules(room)}\n\n**${status}**${open ? '\nChọn vị trí trống để tham gia hoặc đổi chỗ. Chủ phòng cũng đổi được vị trí khi đang chờ.' : ''}`)
        .addFields({ name: 'Người chơi', value: seatList(room), inline: true },
            { name: `Lịch mở · ${room.caseIds.length} vòng`, value: caseSummary(room.caseIds), inline: true },
            { name: 'Phí mỗi người', value: `${formatCoins(BigInt(room.fee))} · trừ khi đủ chỗ` },
            { name: 'Hoạt ảnh', value: animationLabel(room) });
    if (open) embed.addFields({ name: 'Hạn tham gia', value: `<t:${Math.floor(room.expiresAt / 1000)}:R>`, inline: true });
    const join = room.format === 'teams'
        ? ['A', 'B'].map(team => button(`join-${team.toLowerCase()}`, room.id, `Vào đội ${team}`, ButtonStyle.Success,
            room.players.filter(player => player.team === team).length === 2))
        : [button('join', room.id, 'Tham gia', ButtonStyle.Success)];
    const files = caseArtwork(embed, item, attachmentLimit, dropImage);
    const emptySeats = battle.getSeats(room).flatMap((player, index) => player ? [] : [{
        label: battle.seatLabel(room, index + 1), value: String(index + 1),
        description: room.format === 'teams' ? `Trống · Đội ${index < 2 ? 'A' : 'B'} · tham gia hoặc đổi sang chỗ này`
            : 'Trống · tham gia hoặc đổi sang chỗ này'
    }]);
    const seatMenu = emptySeats.length ? select('seat', room.id, 'Chọn vị trí để tham gia / đổi chỗ', emptySeats) : null;
    const roomControls = room.format === 'teams'
        ? [row(...join, button('leave', room.id, 'Rời phòng'), button('cancel', room.id, 'Hủy phòng', ButtonStyle.Danger),
            button('refresh', room.id, 'Làm mới')),
        row(button('bot-start', room.id, 'Đấu với bot', ButtonStyle.Primary), button('room-schedule', `${room.id}_0`, 'Lịch hòm'),
            ...(room.pricesByCase ? [button('room-odds', room.id, 'Xem hòm và tỉ lệ')] : []))]
        : [row(...join, button('leave', room.id, 'Rời phòng'), button('cancel', room.id, 'Hủy phòng', ButtonStyle.Danger),
            button('refresh', room.id, 'Làm mới'), button('bot-start', room.id, 'Đấu với bot', ButtonStyle.Primary)),
        row(button('room-schedule', `${room.id}_0`, 'Lịch hòm'),
            ...(room.pricesByCase ? [button('room-odds', room.id, 'Xem hòm và tỉ lệ')] : []))];
    return { content: null, embeds: [embed], attachments: [], ...(files.length ? { files } : {}), allowedMentions: mentions,
        components: open ? [...(seatMenu ? [row(seatMenu)] : []), ...roomControls] : [] };
}

function battleDropPrice(drop, value) {
    const amount = `**${formatCoins(BigInt(value))}**`;
    const ref = market.getBlueGemMarketQuoteRef(drop);
    if (!ref) return amount;
    if (drop.priceVariant === 'blue-gem') return `${amount} · CSFloat đã khóa`;
    const { status, quote } = market.peekMarketDisplay(ref.name, ref);
    const reference = quote
        ? `CSFloat${status === 'estimate' ? ' đã lưu' : ''}: **${formatCoins(BigInt(quote.priceVnd) * COIN_SCALE)}**`
        : 'CSFloat chưa có giá đúng seed';
    return `${amount} điểm Battle · ${reference}`;
}

function battlePanel(room, revealed, dropName, requestedPage = 0, attachmentLimit) {
    const final = room.status === 'finished' && revealed === room.rounds.length;
    const scores = Object.fromEntries(room.players.map(player => [player.id, 0n]));
    const roundFields = room.rounds.slice(0, revealed).map(({ caseId, entries }, index) => {
        for (const { userId, value } of entries) scores[userId] += BigInt(value);
        const lines = entries.map(({ userId, drop, value }) => {
            const reference = getBlueGemReference(drop);
            const player = room.players.find(player => player.id === userId) ?? { id: userId };
            return `${seatedPlayerName(room, player)} · ${truncate(escapeMarkdown(dropName(drop)), 110)} · ${battleDropPrice(drop, value)}` +
                (drop.float == null ? '' : ` · Float ${drop.float.toFixed(6)}`) +
                (reference ? ` · [Ảnh seed #${drop.paintSeed}](${reference.patternUrl})` : '');
        });
        let offset = 0;
        return chunkLines(lines, 5).map(batch => {
            const seats = entries.length > 5 ? ` · người ${offset + 1}–${offset + batch.length}` : '';
            offset += batch.length;
            return { name: truncate(`Vòng ${index + 1} · ${caseName(caseId)}${seats}`, 256), value: batch.join('\n') };
        });
    });
    const embed = new EmbedBuilder().setTitle(final ? '🏆 Kết quả Case Battle' : '⚔️ Case Battle')
        .setColor(final ? '#e4ae39' : '#5865f2')
        .setDescription(`${rules(room)}\n**${revealed}/${room.rounds.length} vòng**`)
        .addFields({ name: 'Bảng điểm', value: room.players.map(player => `${seatedPlayerName(room, player)} · **${formatCoins(scores[player.id])}**`).join('\n') });
    if (room.format === 'teams') {
        embed.addFields({ name: 'Điểm theo đội', value: ['A', 'B'].map(team => `Đội ${team} · **${formatCoins(room.players
            .filter(player => player.team === team).reduce((sum, player) => sum + scores[player.id], 0n))}**`).join('\n') });
    }
    if (final) {
        const winners = room.winners.map(id => playerName(room.players.find(player => player.id === id) ?? { id })).join(' · ');
        const shared = room.payoutType === 'coins' || room.tieSplit || room.format === 'teams' || room.mode === 'sharing';
        const total = Object.values(scores).reduce((sum, score) => sum + score, 0n);
        const fee = BigInt(room.fee);
        const payouts = Object.entries(room.payouts ?? {});
        const payoutText = [payouts.length ? payouts.map(([id, amount]) =>
            `${playerName(room.players.find(player => player.id === id) ?? { id })} · **${formatCoins(BigInt(amount))}**`).join('\n')
            : 'Không có người chơi thật nhận xu.',
        ...(BigInt(room.unclaimedPayout ?? 0) > 0n
            ? [`🤖 Phần của Bot · **${formatCoins(BigInt(room.unclaimedPayout))}** · không cộng cho người chơi.`] : [])].join('\n');
        const skinText = room.discardedSkins
            ? `${winners} thắng; **${room.discardedSkins} skin** không vào kho.`
            : `${winners} nhận **${room.rounds.length * room.players.length} skin** vào kho.`;
        const payoutName = room.tieSplit || room.mode === 'sharing' ? 'Chia thưởng bằng xu'
            : room.format === 'teams' ? 'Thưởng đội bằng xu' : 'Thắng trận';
        embed.addFields({ name: payoutName, value: shared
            ? payoutText : skinText },
        { name: 'Lãi/lỗ theo giá lúc mở', value: room.players.filter(player => !player.isBot).map(({ id }) => {
            const received = shared ? BigInt(room.payouts[id] ?? 0) : (room.winners.includes(id) ? total : 0n);
            return `<@${id}> · **${netValue(received - fee)}**`;
        }).join('\n') || 'Không có người chơi thật.' });
        if (room.tie) embed.addFields(...tieFields(room, room.tieSplit ? 'Hòa điểm · Chia đều' : 'Hòa điểm · Vòng phụ'));
    }
    // Leave room for the largest page counter before packing round details.
    // Ten-player rooms can exceed Discord's 6000-character total with four rounds.
    const maxPages = Math.max(1, roundFields.flat().length);
    const footerBudget = `${RESULT_LIFETIME_NOTE} · Chi tiết vòng · Trang ${maxPages}/${maxPages}`.length;
    const baseLength = (embed.data.title?.length ?? 0) + (embed.data.description?.length ?? 0) +
        (embed.data.fields ?? []).reduce((sum, field) => sum + fieldTextLength(field), 0);
    const paginated = final ? resultPages(roundFields, EMBED_TEXT_LIMIT - baseLength - footerBudget) : [];
    const pages = final ? paginated.length : 1;
    const page = clampPage(requestedPage, pages);
    if (final) embed.setFooter({ text: [pages > 1 ? `Chi tiết vòng · Trang ${page + 1}/${pages}` : '', RESULT_LIFETIME_NOTE].filter(Boolean).join(' · ') });
    embed.addFields(...(final ? paginated[page] : roundFields.at(-1) ?? []));
    const art = final && room.tieBreaks?.length ? getBattleTieArt(attachmentLimit) : null;
    if (art) embed.setImage(art.url);
    return { content: null, embeds: [embed], attachments: [], ...(art ? { files: [{ attachment: art.buffer, name: art.name }] } : {}), allowedMentions: mentions,
        components: final ? [row(
            ...(pages > 1 ? [
            button('result-page', `${room.id}_${page - 1}`, 'Vòng trước', ButtonStyle.Secondary, page === 0),
            button('result-page', `${room.id}_${page + 1}`, 'Vòng sau', ButtonStyle.Secondary, page === pages - 1)] : []),
            button('room-schedule', `${room.id}_0`, 'Lịch hòm'), button('room-odds', room.id, 'Xem hòm và tỉ lệ'),
            button('recreate', room.id, 'Tạo lại trận', ButtonStyle.Primary)
        )] : [row(button('refresh', room.id, 'Làm mới'))] };
}

async function renderRoundImages(rounds, attachmentSizeLimit, shouldStop) {
    const limit = attachmentSizeLimit ?? Infinity;
    if (rounds.length >= 6) {
        const groupCount = Math.ceil(rounds.length / BATTLE_ROWS_PER_IMAGE);
        const rowsPerGroup = Math.floor(rounds.length / groupCount);
        const extraRows = rounds.length % groupCount;
        const groupLimit = Math.min(limit, Math.floor(BATTLE_IMAGE_BUDGET / groupCount));
        const files = [];
        let offset = 0;
        for (let index = 0; index < groupCount; index++) {
            if (shouldStop()) return null;
            const end = offset + rowsPerGroup + Number(index < extraRows);
            const media = await reel.renderCaseBatch(rounds.slice(offset, end), groupLimit, { profile: 'battle', fullWidth: true });
            if (!media?.gif?.length || media.gif.length > groupLimit) break;
            files.push({
                attachment: media.gif,
                name: index === 0 ? FILE : `cs2-battle-${index + 1}.gif`,
                description: `Vị trí ${offset + 1}–${end}`
            });
            offset = end;
        }
        if (files.length === groupCount) return files;
    }
    if (shouldStop()) return null;
    const media = await reel.renderCaseBatch(rounds, attachmentSizeLimit, { profile: 'battle' });
    return media?.gif?.length > 0 && media.gif.length <= limit ? [{ attachment: media.gif, name: FILE }] : null;
}

function createBattleUi({ rollDrop, reelRound, dropName, dropImage, showResult, shuttingDown = () => false }) {
    const drafts = new Map();
    const edits = new Map();
    const revealing = new Set();
    const directEdits = new WeakSet();
    const resultDeletions = new Map();
    const resultRecoveryRetries = new Map();
    const recoveringGuilds = new Set();
    const draftKey = (interaction, id) => `${interaction.guildId}/${interaction.user.id}/${id}`;
    function closeDraft(interaction, draft) {
        const key = draftKey(interaction, draft.id);
        if (drafts.get(key) === draft) drafts.delete(key);
    }

    function rememberDraft(interaction, draft, replacesMessage = false) {
        const now = Date.now();
        const owner = `${interaction.guildId}/${interaction.user.id}/`;
        for (const [key, previous] of drafts) {
            if (previous.expiresAt <= now || (replacesMessage && interaction.message?.id &&
                key.startsWith(owner) && previous.messageId === interaction.message.id)) drafts.delete(key);
        }
        if (drafts.size >= DRAFT_LIMIT) drafts.delete(drafts.keys().next().value);
        drafts.set(draftKey(interaction, draft.id), draft);
    }

    function expiredDraft(interaction, draft, content = 'Phiên tạo trận đã hết hạn. Bấm Mở lại Battle để chọn hòm và kiểm tra giá hiện tại.') {
        const origin = battle.getBattleCase(draft?.origin)?.key ? draft.origin : 'crate-4904';
        const preferred = customCasesById.has(draft?.preview) ? `_${draft.preview}` : '';
        return interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: mentions,
            components: [row(button('new', `${origin}${preferred}`, 'Mở lại Battle', ButtonStyle.Primary))] });
    }

    function oddsRows(entries, values) {
        return entries.flatMap((entry, index) => {
            const value = values?.[index];
            if (!entry.seedPrices?.length) return [{ entry, value }];
            const seedWeight = entry.weight / (MAX_PAINT_SEED + 1);
            return [{ entry: { ...entry, weight: entry.weight - seedWeight * entry.seedPrices.length }, value },
                ...entry.seedPrices.map(([paintSeed, price]) => ({
                    entry: { ...entry, weight: seedWeight, drop: { ...entry.drop, paintSeed, priceVariant: 'blue-gem' } },
                    value: price
                }))];
        })
            .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    }

    function oddsLine({ entry: { drop, exterior, weight, min, max }, value }, showRange = false) {
        const range = min == null ? '' : ` · Float ${(min / 1_000_000).toFixed(6)}–${(max / 1_000_000).toFixed(6)}`;
        return `**${truncate(escapeMarkdown(dropName(drop)), 120)}** · ${wearNames[exterior] ?? 'Vanilla'} · **${oddsText(weight)}**` +
            (value ? ` · ${formatCoins(BigInt(value) * COIN_SCALE)}` : '') + (showRange ? range : '');
    }

    function oddsPanel(item, pricing, requestedPage, action, scope, roomOptions) {
        const entries = oddsRows(pricing?.entries ?? item.entries, pricing?.values);
        const pages = Math.ceil(entries.length / ODDS_PAGE_SIZE);
        const page = Math.max(0, Math.min(requestedPage, pages - 1));
        const lines = entries.slice(page * ODDS_PAGE_SIZE, (page + 1) * ODDS_PAGE_SIZE).map(item => oddsLine(item, true));
        const embed = new EmbedBuilder().setTitle(`Vật phẩm · ${item.name}`).setColor('#5865f2')
            .setDescription((pricing?.values ? `${pricingMetrics(pricing)}\n\n` : '') +
                (seedOddsNote(pricing) ? `${seedOddsNote(pricing)} Tỷ lệ từng seed bên dưới đã nhân với cơ hội trúng skin.\n\n` : '') + lines.join('\n\n'))
            .setFooter({ text: `${entries.length} biến thể · Trang ${page + 1}/${pages}` });
        const components = [];
        if (roomOptions?.length > 1) components.push(row(select('room-odds-case', scope.split('_')[0], 'Chọn hòm trong trận', roomOptions)));
        if (pages > 1) components.push(row(
            button(action, `${scope}_${page - 1}`, 'Trang trước', ButtonStyle.Secondary, page === 0),
            button(action, `${scope}_${page + 1}`, 'Trang sau', ButtonStyle.Secondary, page === pages - 1)
        ));
        return { embeds: [embed], components, allowedMentions: mentions };
    }

    function caseGroups(prices) {
        const ordered = customCases.toSorted((a, b) => {
            const left = prices.get(a.id)?.fee;
            const right = prices.get(b.id)?.fee;
            if (left === right) return 0;
            if (left == null) return 1;
            return right == null || left < right ? -1 : 1;
        });
        const groups = Object.entries(CASE_GROUPS).map(([id, label]) => ({ id, label, cases: ordered.filter(item => item.group === id) }));
        groups.unshift({ id: 'new', label: 'Hòm mới', cases: ordered.filter(item => newCaseIds.has(item.id)) });
        for (const [risk, label] of Object.entries(CASE_RISKS)) {
            const cases = ordered.filter(item => prices.get(item.id)?.riskLevel === risk);
            if (cases.length) groups.push({ id: `risk-${risk}`, label, cases });
        }
        for (const [id, label, min, max] of CASE_BUDGETS) {
            const cases = ordered.filter(item => {
                const fee = prices.get(item.id)?.fee;
                return fee != null && fee >= min * COIN_SCALE && (max == null || fee < max * COIN_SCALE);
            });
            if (cases.length) groups.push({ id, label, cases });
        }
        return groups;
    }

    function draftPanel(draft, notice, freshPrices = false) {
        if (freshPrices || !draft.prices || Date.now() - draft.pricedAt > 5_000) {
            const priceOf = cachedPrices();
            draft.prices = Object.fromEntries(customCases.map(item => [item.id, casePricing(item, priceOf)]));
            draft.pricedAt = Date.now();
        }
        const prices = new Map(Object.entries(draft.prices));
        const panelId = `${draft.id}_${++draft.revision}`;
        if (draft.view === 'settings') return draftSettingsPanel(draft, panelId, notice);
        if (draft.view === 'history') return draftHistoryPanel(draft, panelId, notice);
        if (draft.view === 'history-detail') return draftHistoryDetailPanel(draft, panelId, notice);
        if (draft.view === 'schedule' && draft.caseIds.length) return draftSchedulePanel(draft, panelId, prices, notice);
        draft.view = 'catalogue';
        const groups = caseGroups(prices);
        const group = groups.find(group => group.id === draft.group)
            ?? groups.find(group => group.id === customCasesById.get(draft.preview).group);
        draft.group = group.id;
        if (draft.locatePreview) {
            const position = group.cases.findIndex(item => item.id === draft.preview);
            if (position >= 0) draft.page = Math.floor(position / CASE_MENU_SIZE);
            delete draft.locatePreview;
        }
        const lastPage = Math.ceil(group.cases.length / CASE_MENU_SIZE) - 1;
        draft.page = Math.min(draft.page, lastPage);
        const items = group.cases.slice(draft.page * CASE_MENU_SIZE, (draft.page + 1) * CASE_MENU_SIZE);
        if (!items.some(item => item.id === draft.preview)) draft.preview = items[0].id;
        const caseOptions = items.map(item => {
            const pricing = prices.get(item.id);
            return { value: item.id, label: item.name, default: item.id === draft.preview,
                description: pricing ? formatCoins(pricing.fee) : 'Chưa có giá' };
        });
        if (draft.page > 0) caseOptions.push({ value: 'previous', label: '← Trang hòm trước' });
        if (draft.page < lastPage) caseOptions.push({ value: 'next', label: 'Trang hòm sau →' });
        const fees = draft.caseIds.map(id => prices.get(id)?.fee ?? null);
        const fee = !fees.length ? 'Chưa chọn hòm' : fees.includes(null) ? 'Đang thiếu giá' : formatCoins(fees.reduce((sum, value) => sum + value, 0n));
        const item = customCasesById.get(draft.preview);
        const pricing = prices.get(item.id);
        const entries = pricing?.entries ?? item.entries;
        const embed = new EmbedBuilder().setTitle(`⚔️ ${item.name}`).setColor('#5865f2')
            .setDescription(`${caseDescription(item, pricing)}\n${pricing
                ? `Mở lẻ **${formatCoins(pricing.fee)}**\n` +
                    `Giá trị trung bình **${formatCoins(pricing.expected)}** · Cao nhất **${formatCoins(pricing.maxValue)}**\n${pricingMetrics(pricing)}`
                : item.blueOnly ? 'Đang chờ đủ giá CSFloat theo seed Blue Gem để mở hòm.' : 'Đang chờ đủ giá BUFF để mở hòm.'}\n\n${rules(draft)}\nHoạt ảnh: ${animationLabel(draft)}`)
            .addFields({ name: `Số vòng · ${draft.caseIds.length}/${battle.ROUND_LIMIT}`, value: caseSummary(draft.caseIds) || 'Thêm hòm vào trận; mỗi hòm tự tạo một vòng.' },
                { name: 'Phí Battle mỗi người', value: fee, inline: true });
        if (pricing?.goldTickets) embed.addFields({ name: 'Tỉ lệ ra dao/găng', value: oddsText(pricing.goldTickets), inline: true });
        const outcomes = oddsRows(entries, pricing?.values);
        const sample = outcomes.slice(0, 5).map(item => truncate(oddsLine(item), 195));
        const finishes = new Set(entries.map(({ drop }) => drop.skinId)).size;
        embed.addFields({ name: `${finishes} mẫu skin · ${outcomes.length} biến thể`, value: sample.join('\n') });
        if (notice) embed.setFooter({ text: notice });
        const rulesOptions = Object.entries(battle.FORMATS).flatMap(([format, name]) => Object.entries(battle.MODES)
            .filter(([mode]) => format !== 'teams' || mode !== 'sharing')
            .map(([mode, label]) => ({ label: `${name} · ${label}`, value: `${format}:${mode}`, default: draft.format === format && draft.mode === mode })));
        const files = caseArtwork(embed, item, draft.attachmentSizeLimit, dropImage);
        return { content: null, embeds: [embed], attachments: [], ...(files.length ? { files } : {}), allowedMentions: mentions, components: [
            row(select('rules', panelId, 'Số người và chế độ', rulesOptions)),
            row(select('group', panelId, `Lọc ${customCases.length} hòm Battle`, groups.map(({ id, label, cases }) => ({
                value: id, label: `${label} · ${cases.length} hòm`, default: id === draft.group
            })))),
            row(select('preview', panelId, 'Chọn hòm Battle', caseOptions)),
            row(button('add', panelId, `Thêm ×${draft.quantity}`, ButtonStyle.Secondary, !pricing || draft.caseIds.length === battle.ROUND_LIMIT),
                button('remove', panelId, '−1 hòm này', ButtonStyle.Secondary, !draft.caseIds.includes(item.id)),
                button('clear-case', panelId, 'Xóa hòm này', ButtonStyle.Secondary, !draft.caseIds.includes(item.id)),
                button('quantity', panelId, 'Số lượng'), button('schedule', panelId, 'Lịch hòm', ButtonStyle.Secondary, !draft.caseIds.length)),
            row(button('publish', panelId, 'Đăng phòng', ButtonStyle.Primary, !fees.length || fees.includes(null)),
                button('solo', panelId, 'Mở lẻ', ButtonStyle.Success, !pricing), button('draft-odds', panelId, 'Xem vật phẩm'),
                button('settings', panelId, 'Tùy chọn'),
                new ButtonBuilder().setCustomId(`mg_hom_case_${draft.origin}`).setLabel('Về hòm').setStyle(ButtonStyle.Secondary))
        ] };
    }

    function draftSettingsPanel(draft, panelId, notice) {
        const rulesOptions = Object.entries(battle.FORMATS).flatMap(([format, name]) => Object.entries(battle.MODES)
            .filter(([mode]) => format !== 'teams' || mode !== 'sharing')
            .map(([mode, label]) => ({ label: `${name} · ${label}`, value: `${format}:${mode}`, default: draft.format === format && draft.mode === mode })));
        const embed = new EmbedBuilder().setTitle('Tùy chọn Case Battle').setColor('#5865f2')
            .setDescription(`${rules(draft)}\n\nHoạt ảnh: **${animationLabel(draft)}**\nCác tùy chọn được lưu khi đăng phòng.`);
        if (notice) embed.setFooter({ text: notice });
        return { content: null, embeds: [embed], attachments: [], allowedMentions: mentions, components: [
            row(select('rules', panelId, 'Số người và chế độ', rulesOptions)),
            row(select('tie-rule', panelId, 'Xử lý khi hòa điểm', Object.entries(battle.TIE_RULES).map(([value, label]) => ({
                value, label, default: draft.tieRule === value,
                description: value === 'split' ? 'Các bên thắng đồng điểm chia toàn bộ giá trị bằng xu' : 'Từng cặp đồng điểm quay 50/50; nhiều bên dùng nhánh đấu'
            })))),
            row(button('player-limit', panelId, `Tùy chỉnh số người · ${battle.CUSTOM_PLAYER_MIN}–${battle.MAX_PLAYERS}`, ButtonStyle.Primary)),
            row(button('history', panelId, 'Lịch sử trận'), button('catalogue', panelId, 'Về bảng tạo trận', ButtonStyle.Primary))
        ] };
    }

    const historyStatus = entry => ({ waiting: 'Chờ người', revealing: 'Đang quay', finished: 'Hoàn tất', cancelled: 'Đã hủy', expired: 'Hết hạn' }[entry.status] ?? entry.status);

    function draftHistoryPanel(draft, panelId, notice) {
        const history = draft.history ?? { entries: [], total: 0, page: 0, pages: 1 };
        const embed = new EmbedBuilder().setTitle('Lịch sử Case Battle của bạn').setColor('#5865f2')
            .setDescription(history.entries.length ? history.entries.map((entry, index) =>
                `**${history.page * history.pageSize + index + 1}. ${battle.formatLabel(entry)} · ${battle.MODES[entry.mode]}**\n` +
                `${entry.caseIds.length} vòng · ${formatCoins(BigInt(entry.fee))}/người · ${historyStatus(entry)}\n<t:${Math.floor(entry.createdAt / 1000)}:f>`).join('\n\n')
                : 'Bạn chưa có trận Battle nào. Các trận đã tạo hoặc tham gia sẽ được lưu tại đây.')
            .setFooter({ text: notice ?? `${history.total} trận · Trang ${history.page + 1}/${history.pages} · Giá cũ chỉ để tham khảo; tạo lại dùng giá hiện tại.` });
        const components = [];
        if (history.entries.length) components.push(row(select('history-select', panelId, 'Chọn trận để xem và dùng lại cấu hình', history.entries.map(entry => ({
            label: truncate(`${battle.formatLabel(entry)} · ${battle.MODES[entry.mode]} · ${entry.caseIds.length} vòng`, 100), value: entry.id,
            description: truncate(`${historyStatus(entry)} · ${formatCoins(BigInt(entry.fee))}/người · #${entry.id}`, 100)
        })))));
        if (history.pages > 1) components.push(row(
            button('history-page', `${panelId}_${history.page - 1}`, 'Trận trước', ButtonStyle.Secondary, history.page === 0),
            button('history-page', `${panelId}_${history.page + 1}`, 'Trận sau', ButtonStyle.Secondary, history.page + 1 === history.pages)));
        components.push(row(button('settings', panelId, 'Tùy chọn'), button('catalogue', panelId, 'Về bảng tạo trận')));
        return { content: null, embeds: [embed], attachments: [], allowedMentions: mentions, components };
    }

    function draftHistoryDetailPanel(draft, panelId, notice) {
        const entry = draft.historyEntry;
        const received = entry.payoutType === 'coins' ? BigInt(entry.payouts?.[draft.userId] ?? 0)
            : entry.winners?.includes(draft.userId) ? BigInt(entry.pool ?? 0) : 0n;
        const embed = new EmbedBuilder().setTitle(`Lịch sử Battle · #${entry.id}`).setColor('#5865f2')
            .setDescription(`${rules(entry)}\n\n**${historyStatus(entry)}** · <t:${Math.floor(entry.createdAt / 1000)}:f>`)
            .addFields({ name: `Lịch mở · ${entry.caseIds.length} vòng`, value: caseSummary(entry.caseIds) || 'Hòm không còn trong danh mục.' },
                { name: 'Phí cũ mỗi người', value: formatCoins(BigInt(entry.fee)), inline: true },
                { name: 'Người chơi', value: seatList(entry), inline: true });
        if (entry.status === 'finished') {
            const participated = entry.players.some(player => player.id === draft.userId);
            embed.addFields({ name: 'Kết quả của bạn theo giá lúc mở', value: participated
                ? netValue(received - BigInt(entry.fee)) : 'Bạn đã rời phòng trước khi trận bắt đầu; không bị trừ phí.' });
            if (entry.tie) embed.addFields(...tieFields(entry, 'Xử lý hòa điểm'));
        }
        embed.setFooter({ text: notice ?? 'Dùng lại chỉ tạo bản nháp mới với giá hiện tại. Bạn tự kiểm tra rồi đăng phòng; chưa trừ xu.' });
        return { content: null, embeds: [embed], attachments: [], allowedMentions: mentions, components: [row(
            button('history-use', panelId, 'Dùng lại cấu hình', ButtonStyle.Primary),
            button('history', panelId, 'Lịch sử trận'), button('settings', panelId, 'Tùy chọn'))] };
    }

    function draftSchedulePanel(draft, panelId, prices, notice) {
        const distinct = [...new Set(draft.caseIds)];
        draft.scheduleMenuPage = clampPage(draft.scheduleMenuPage, Math.ceil(distinct.length / CASE_MENU_SIZE));
        const start = draft.scheduleMenuPage * CASE_MENU_SIZE;
        const scheduled = distinct.slice(start, start + CASE_MENU_SIZE);
        if (!scheduled.includes(draft.preview)) draft.preview = scheduled[0];
        draft.schedulePage = clampPage(draft.schedulePage, Math.ceil(draft.caseIds.length / SCHEDULE_PAGE_SIZE));
        const options = scheduled.map(id => ({ label: truncate(caseName(id), 100), value: id, default: id === draft.preview,
            description: `${draft.caseIds.filter(caseId => caseId === id).length} hòm trong trận` }));
        if (start > 0) options.push({ label: '← Các hòm trước', value: 'previous' });
        if (start + CASE_MENU_SIZE < distinct.length) options.push({ label: 'Các hòm sau →', value: 'next' });
        const fees = draft.caseIds.map(id => prices.get(id)?.fee ?? null);
        const fee = fees.includes(null) ? 'Đang thiếu giá' : formatCoins(fees.reduce((sum, value) => sum + value, 0n));
        const embed = new EmbedBuilder().setTitle('Lịch hòm · Tạo Case Battle').setColor('#5865f2')
            .setDescription(`${draft.caseIds.length} hòm = **${draft.caseIds.length} vòng** · Phí mỗi người **${fee}**\n${rules(draft)}\nHoạt ảnh: ${animationLabel(draft)}`)
            .addFields({ name: `Lịch mở · Trang ${draft.schedulePage + 1}/${Math.ceil(draft.caseIds.length / SCHEDULE_PAGE_SIZE)}`,
                value: caseList(draft.caseIds, draft.schedulePage) },
            { name: 'Hòm đang chỉnh', value: `${truncate(caseName(draft.preview), 100)} · ${draft.caseIds.filter(id => id === draft.preview).length} hòm` })
            .setFooter({ text: notice ?? 'Thêm hòm nối vào cuối lịch. Bấm Xếp đan xen để luân phiên từng loại hòm.' });
        return { content: null, embeds: [embed], attachments: [], components: [
            row(select('schedule-case', panelId, 'Chọn hòm trong lịch để chỉnh số lượng', options)),
            row(button('schedule-prev', panelId, 'Vòng trước', ButtonStyle.Secondary, draft.schedulePage === 0),
                button('schedule-next', panelId, 'Vòng sau', ButtonStyle.Secondary, (draft.schedulePage + 1) * SCHEDULE_PAGE_SIZE >= draft.caseIds.length),
                button('interleave', panelId, 'Xếp đan xen', ButtonStyle.Primary, distinct.length < 2)),
            row(button('add', panelId, `Thêm ×${draft.quantity}`, ButtonStyle.Success, !prices.get(draft.preview) || draft.caseIds.length === battle.ROUND_LIMIT),
                button('remove', panelId, '−1 hòm này', ButtonStyle.Secondary, !draft.caseIds.includes(draft.preview)),
                button('clear-case', panelId, 'Xóa hòm này', ButtonStyle.Secondary, !draft.caseIds.includes(draft.preview)), button('quantity', panelId, 'Số lượng')),
            row(button('catalogue', panelId, 'Thêm hòm khác'), button('publish', panelId, 'Đăng phòng', ButtonStyle.Primary, fees.includes(null)),
                button('settings', panelId, 'Tùy chọn'),
                button('clear-all', panelId, 'Xóa tất cả', ButtonStyle.Danger, !draft.caseIds.length))
        ], allowedMentions: mentions };
    }

    async function openBuilder(interaction, caseId, preferred) {
        await interaction.deferUpdate();
        const selected = customCasesById.get(preferred) ?? customCases[0];
        const draft = { id: interaction.id, origin: caseId, caseIds: [], group: selected.group, page: 0, preview: selected.id,
            quantity: 1, animationMode: 'full', tieRule: 'split', schedulePage: 0, scheduleMenuPage: 0, revision: 0,
            format: '2', playerLimit: battle.CUSTOM_PLAYER_MIN, mode: 'regular', userId: interaction.user.id, attachmentSizeLimit: interaction.attachmentSizeLimit,
            locatePreview: true, messageId: interaction.message?.id, expiresAt: Date.now() + DRAFT_TTL };
        const result = await deliverArtwork(value => interaction.editReply(value), draftPanel(draft), interaction.message);
        draft.messageId ??= result?.id;
        rememberDraft(interaction, draft, true);
        return result;
    }

    function useHistoryConfig(draft, entry) {
        if (!entry?.caseIds?.length || entry.caseIds.length > battle.ROUND_LIMIT || entry.caseIds.some(id => !customCasesById.has(id))) {
            return 'Một hòm trong trận cũ đã ngừng hỗ trợ. Hãy chọn hòm hiện có để tạo trận.';
        }
        if (!Object.hasOwn(battle.FORMATS, entry.format) || !Object.hasOwn(battle.MODES, entry.mode) ||
            (entry.format === 'custom' && !battle.isValidCustomPlayerLimit(entry.playerLimit))) return 'Cấu hình trận cũ không còn được hỗ trợ.';
        const selected = customCasesById.get(entry.caseIds[0]);
        Object.assign(draft, { caseIds: [...entry.caseIds], format: entry.format,
            playerLimit: entry.format === 'custom' ? entry.playerLimit
                : battle.isValidCustomPlayerLimit(draft.playerLimit) ? draft.playerLimit : battle.CUSTOM_PLAYER_MIN,
            mode: entry.mode,
            animationMode: 'full',
            tieRule: Object.hasOwn(battle.TIE_RULES, entry.tieRule) ? entry.tieRule : 'split',
            group: selected.group, preview: selected.id, page: 0, schedulePage: 0, scheduleMenuPage: 0,
            view: 'catalogue', pricedAt: 0, locatePreview: true });
        delete draft.prices;
        return null;
    }

    async function recreate(interaction, roomId) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const entry = await battle.getRecreateConfig(interaction.guildId, interaction.user.id, roomId, interaction.channelId);
        if (!entry || entry.status !== 'finished' || !entry.players.some(player => player.id === interaction.user.id)) {
            return interaction.editReply({ content: 'Không tìm thấy cấu hình trận còn hiệu lực dành cho bạn. Chỉ người tham gia trận mới tạo lại được; bạn có thể mở Battle để chọn hòm mới.', embeds: [],
                components: [row(button('new', 'crate-4904', 'Mở Battle', ButtonStyle.Primary))], attachments: [] });
        }
        const draft = { id: interaction.id, origin: 'crate-4904', quantity: 1, revision: 0,
            userId: interaction.user.id, attachmentSizeLimit: interaction.attachmentSizeLimit, expiresAt: Date.now() + DRAFT_TTL };
        const error = useHistoryConfig(draft, entry);
        if (error) return interaction.editReply({ content: error, embeds: [], components: [] });
        const result = await deliverArtwork(value => interaction.editReply(value), draftPanel(draft, 'Đã dùng lại cấu hình và cập nhật giá. Kiểm tra phí hiện tại rồi đăng phòng; chưa trừ xu.', true));
        draft.messageId = result?.id;
        rememberDraft(interaction, draft);
        return result;
    }

    async function publish(interaction, draft) {
        if (!interaction.channel?.isSendable?.()) return 'Kênh này chưa hỗ trợ đăng phòng Battle.';
        const { room, error } = await battle.createRoom(interaction.guildId, {
            id: interaction.id, channelId: interaction.channelId, hostId: interaction.user.id, caseIds: draft.caseIds,
            format: draft.format, playerLimit: draft.playerLimit, mode: draft.mode,
            animationMode: draft.animationMode, tieRule: draft.tieRule, expectedPrices: draft.prices
        });
        if (error) { draft.pricedAt = 0; return error; }
        let message;
        try {
            message = await deliverArtwork(value => interaction.channel.send(value), roomPanel(room, dropImage, interaction.attachmentSizeLimit));
        } catch (error) {
            await battle.actOnRoom(interaction.guild, interaction.channelId, room.id, interaction.user.id, 'cancel', rollDrop);
            console.warn('Lỗi đăng phòng Case Battle:', error.message);
            return 'Bot chưa đăng được phòng. Hãy kiểm tra quyền gửi tin nhắn và nhúng liên kết.';
        }
        closeDraft(interaction, draft);
        await interaction.editReply({ content: `Đã đăng [phòng Case Battle](${message.url}).`, embeds: [], components: [], attachments: [] });
        return null;
    }

    async function editDraft(interaction, action, id, version, page) {
        const draft = drafts.get(draftKey(interaction, id));
        if (!draft || draft.expiresAt <= Date.now()) return expiredDraft(interaction, draft);
        if (version !== String(draft.revision)) {
            return respond(interaction, 'Bảng vừa đổi. Hãy dùng các nút trên bảng mới.');
        }
        if (draft.busy) return respond(interaction, 'Đang xử lý bảng tạo trận.');
        if (action === 'quantity') {
            const modal = new ModalBuilder().setCustomId(`${PREFIX}quantity-submit_${id}_${version}`).setTitle('Số hòm thêm mỗi lần');
            modal.addComponents(row(new TextInputBuilder().setCustomId('quantity').setLabel(`Số lượng từ 1 đến ${battle.ROUND_LIMIT}`)
                .setStyle(TextInputStyle.Short).setValue(String(draft.quantity)).setRequired(true).setMaxLength(String(battle.ROUND_LIMIT).length)));
            await interaction.showModal(modal);
            draft.expiresAt = Date.now() + DRAFT_TTL;
            return;
        }
        if (action === 'player-limit') {
            const playerLimit = draft.format === 'custom' && battle.isValidCustomPlayerLimit(draft.playerLimit)
                ? draft.playerLimit : battle.CUSTOM_PLAYER_MIN;
            const modal = new ModalBuilder().setCustomId(`${PREFIX}player-limit-submit_${id}_${version}`).setTitle('Số người Battle tùy chỉnh');
            modal.addComponents(row(new TextInputBuilder().setCustomId('player-limit').setLabel(`Số người từ ${battle.CUSTOM_PLAYER_MIN} đến ${battle.MAX_PLAYERS}`)
                .setStyle(TextInputStyle.Short).setValue(String(playerLimit))
                .setRequired(true).setMaxLength(2)));
            await interaction.showModal(modal);
            draft.expiresAt = Date.now() + DRAFT_TTL;
            return;
        }
        const previous = { ...draft, caseIds: [...draft.caseIds] };
        draft.busy = true;
        try {
            await interaction.deferUpdate();
            draft.attachmentSizeLimit = interaction.attachmentSizeLimit ?? draft.attachmentSizeLimit;
            const value = interaction.values?.[0];
            let notice;
            if (action === 'rules') {
                const [format, mode] = (value ?? '').split(':');
                if (Object.hasOwn(battle.FORMATS, format) && Object.hasOwn(battle.MODES, mode) && (format !== 'teams' || mode !== 'sharing')) {
                    Object.assign(draft, { format, mode });
                }
            } else if (action === 'group') {
                draft.group = value;
                draft.page = 0;
            } else if (action === 'preview') {
                if (value === 'next') draft.page++;
                else if (value === 'previous') draft.page = Math.max(0, draft.page - 1);
                else if (customCasesById.has(value)) { draft.preview = value; draft.locatePreview = true; }
            } else if (action === 'tie-rule') {
                if (Object.hasOwn(battle.TIE_RULES, value)) draft.tieRule = value;
            } else if (action === 'settings') draft.view = 'settings';
            else if (action === 'history' || action === 'history-page') {
                draft.history = await battle.listHistory(interaction.guildId, interaction.user.id, action === 'history-page' ? page : 0);
                draft.view = 'history';
            } else if (action === 'history-select') {
                const entry = await battle.getHistoryConfig(interaction.guildId, interaction.user.id, value);
                if (entry) { draft.historyEntry = entry; draft.view = 'history-detail'; }
                else notice = 'Trận không có trong lịch sử của bạn hoặc đã hết hạn lưu.';
            } else if (action === 'history-use') {
                const entry = await battle.getHistoryConfig(interaction.guildId, interaction.user.id, draft.historyEntry?.id);
                notice = entry ? useHistoryConfig(draft, entry) : 'Trận không có trong lịch sử của bạn hoặc đã hết hạn lưu.';
                if (!notice) notice = 'Đã cập nhật cấu hình và giá hiện tại. Kiểm tra phí rồi đăng phòng; chưa trừ xu.';
            } else if (action === 'quantity-submit') {
                const input = interaction.fields.getTextInputValue('quantity').trim();
                const quantity = /^\d+$/.test(input) ? Number(input) : 0;
                if (quantity >= 1 && quantity <= battle.ROUND_LIMIT) draft.quantity = quantity;
                else notice = `Nhập số lượng từ 1 đến ${battle.ROUND_LIMIT}.`;
            } else if (action === 'player-limit-submit') {
                const input = interaction.fields.getTextInputValue('player-limit').trim();
                const playerLimit = /^\d{1,2}$/.test(input) ? Number(input) : 0;
                if (battle.isValidCustomPlayerLimit(playerLimit)) Object.assign(draft, { format: 'custom', playerLimit });
                else notice = `Nhập số người từ ${battle.CUSTOM_PLAYER_MIN} đến ${battle.MAX_PLAYERS}.`;
            } else if (action === 'schedule') draft.view = 'schedule';
            else if (action === 'catalogue') {
                draft.view = 'catalogue';
                draft.group = customCasesById.get(draft.preview)?.group ?? draft.group;
                draft.page = 0;
                draft.locatePreview = true;
            } else if (action === 'schedule-prev') draft.schedulePage--;
            else if (action === 'schedule-next') draft.schedulePage++;
            else if (action === 'interleave') {
                if (new Set(draft.caseIds).size < 2) notice = 'Thêm ít nhất hai loại hòm để xếp đan xen.';
                else {
                    draft.caseIds = interleaveCases(draft.caseIds);
                    draft.schedulePage = 0;
                    draft.view = 'schedule';
                    notice = 'Đã xếp luân phiên từng loại theo thứ tự xuất hiện đầu tiên; hòm còn dư được xếp tiếp ở cuối.';
                }
            } else if (action === 'schedule-case') {
                if (value === 'next') draft.scheduleMenuPage++;
                else if (value === 'previous') draft.scheduleMenuPage--;
                else if (draft.caseIds.includes(value)) draft.preview = value;
            } else if (action === 'add' && draft.prices[draft.preview] && draft.caseIds.length < battle.ROUND_LIMIT) {
                const count = Math.min(draft.quantity, battle.ROUND_LIMIT - draft.caseIds.length);
                draft.caseIds.push(...Array(count).fill(draft.preview));
                if (count < draft.quantity) notice = `Đã thêm ${count} hòm để đủ giới hạn ${battle.ROUND_LIMIT} vòng.`;
            } else if (action === 'remove') {
                const index = draft.caseIds.lastIndexOf(draft.preview);
                if (index >= 0) draft.caseIds.splice(index, 1);
            } else if (action === 'clear-case') draft.caseIds = draft.caseIds.filter(id => id !== draft.preview);
            else if (action === 'clear-all') draft.caseIds = [];
            else if (action === 'publish') {
                notice = await publish(interaction, draft);
                if (!notice) return;
            } else if (action === 'solo') {
                const item = customCasesById.get(draft.preview);
                const result = await battle.openSolo(interaction.guild, interaction.user.id, interaction.id, item, draft.prices[item.id]);
                if (result.status === 'opened') {
                    closeDraft(interaction, draft);
                    return await revealSolo(interaction, item, result);
                }
                draft.pricedAt = 0;
                notice = result.status === 'price-changed' ? 'Giá đã đổi. Kiểm tra rồi bấm Mở lẻ lại.' : 'Ví không đủ xu hoặc giá vừa đổi.';
            }
            // A price refresh may reorder the catalogue while the player reads
            // odds. Keep the chosen case visible unless they changed pages.
            if (action !== 'group' && !(action === 'preview' && ['next', 'previous'].includes(value))) {
                draft.locatePreview = true;
            }
            const payload = draftPanel(draft, notice);
            let result;
            try { result = await deliverArtwork(value => interaction.editReply(value), payload, interaction.message); } catch (error) {
                Object.assign(draft, previous);
                throw error;
            }
            draft.expiresAt = Date.now() + DRAFT_TTL;
            return result;
        } finally { draft.busy = false; }
    }

    async function revealSolo(interaction, item, result) {
        const loading = new EmbedBuilder().setTitle(`Mở hòm · ${item.name}`).setColor('#5865f2')
            .setDescription('Đang chuẩn bị dải quay…');
        try {
            if (item.image) loading.setThumbnail(item.image);
            await deliverArtwork(value => interaction.editReply(value), { content: null, embeds: [loading], components: [], attachments: [] });
            if (interaction.attachmentSizeLimit !== 0) {
                const { cards, selectedIndex, result: prize, landingSeed } = reelRound({ ...item, entries: result.entries }, result.drop);
                const media = await reel.renderCaseReel(cards, selectedIndex, prize, false, landingSeed, interaction.attachmentSizeLimit);
                if (media?.gif?.length && media.gif.length <= (interaction.attachmentSizeLimit ?? Infinity)) {
                    await deliverArtwork(value => interaction.editReply(value), { embeds: [loading.setImage(`attachment://${FILE}`)], attachments: [], files: [{ attachment: media.gif, name: FILE }] });
                    await delay(cards[selectedIndex].mystery ? reel.RARE_REEL_PLAYBACK_MS : reel.REEL_PLAYBACK_MS);
                }
            }
        } catch (error) { console.warn('Lỗi hoạt ảnh hòm Battle:', error.message); }
        return showResult(interaction, result.drop, `Đã mở ${item.name} · Phí ${formatCoins(result.fee)} · ${netValue(result.value - result.fee)} theo giá lúc mở`);
    }

    async function showDraftOdds(interaction, id, version, page) {
        const draft = drafts.get(draftKey(interaction, id));
        if (!draft || draft.expiresAt <= Date.now()) return expiredDraft(interaction, draft);
        const first = page === undefined;
        let view = draft.oddsViews?.get(version);
        if (first) {
            if (version !== String(draft.revision)) return respond(interaction, 'Bảng vừa đổi. Hãy mở vật phẩm từ bảng mới.');
            view = { itemId: draft.preview, pricing: draft.prices[draft.preview] };
        }
        if (!view) return respond(interaction, 'Bảng vật phẩm đã cũ. Mở Xem vật phẩm từ bảng tạo trận.');
        const item = customCasesById.get(view.itemId);
        const payload = oddsPanel(item, view.pricing, Number(page) || 0, 'draft-odds-page', `${id}_${version}`);
        const result = await (first ? interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }) : interaction.update(payload));
        if (first) {
            draft.oddsViews ??= new Map();
            if (draft.oddsViews.size >= 8) draft.oddsViews.delete(draft.oddsViews.keys().next().value);
            draft.oddsViews.set(version, view);
        }
        draft.expiresAt = Date.now() + DRAFT_TTL;
        return result;
    }

    async function showRoomOdds(interaction, id, selected, page) {
        const first = selected === undefined && !interaction.values?.length;
        if (first) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        else await interaction.deferUpdate();
        const room = await battle.readRoom(interaction.guildId, interaction.channelId, id);
        const cases = [...new Set(room?.caseIds)].flatMap(caseId => {
            const item = customCasesById.get(caseId);
            const prices = room.pricesByCase?.[caseId];
            const locked = lockedCase(item, prices);
            return locked ? [{ item, pricing: { entries: locked.entries, values: prices.values } }] : [];
        });
        if (!cases.length) return interaction.editReply({ content: 'Bảng giá phòng đã hết hạn.', embeds: [], components: [] });
        const caseId = interaction.values?.[0] ?? selected;
        const { item, pricing } = cases.find(entry => entry.item.id === caseId) ?? cases[0];
        const menuPage = Math.floor(cases.findIndex(entry => entry.item.id === item.id) / CASE_MENU_SIZE);
        const start = menuPage * CASE_MENU_SIZE;
        const options = cases.slice(start, start + CASE_MENU_SIZE).map(({ item: option }) => ({
            label: truncate(option.name, 100), value: option.id, default: option.id === item.id
        }));
        if (start > 0) options.push({ label: '← Các hòm trước', value: cases[start - CASE_MENU_SIZE].item.id });
        if (start + CASE_MENU_SIZE < cases.length) options.push({ label: 'Các hòm sau →', value: cases[start + CASE_MENU_SIZE].item.id });
        return interaction.editReply(oddsPanel(item, pricing, Number(page) || 0, 'room-odds-page', `${id}_${item.id}`, options));
    }

    async function showSchedule(interaction, id, page) {
        const first = !interaction.message?.flags?.has?.(MessageFlags.Ephemeral);
        if (first) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        else await interaction.deferUpdate();
        const room = await battle.readRoom(interaction.guildId, interaction.channelId, id);
        if (!room) return interaction.editReply({ content: 'Phòng Battle đã hết hạn.', embeds: [], components: [] });
        return interaction.editReply(schedulePanel(room, page));
    }

    async function showResultPage(interaction, id, page) {
        await interaction.deferUpdate();
        const room = await battle.readRoom(interaction.guildId, interaction.channelId, id);
        if (!room || room.status !== 'finished') return interaction.followUp({ content: 'Kết quả Battle chưa có hoặc đã hết hạn.', flags: MessageFlags.Ephemeral });
        return editBattleMessage(interaction, room, battlePanel(room, room.rounds.length, dropName, page, interaction.attachmentSizeLimit));
    }

    async function editBattleMessage(interaction, room, payload) {
        const messageId = room.pendingResultMessageId ?? interaction.message?.id;
        const messages = interaction.channel?.messages;
        const currentMessage = interaction.message?.id === messageId ? interaction.message : undefined;
        if (directEdits.has(interaction) && messageId && messages) return deliverArtwork(value => messages.edit(messageId, value), payload, currentMessage);
        try { return await deliverArtwork(value => interaction.editReply(value), payload, currentMessage); } catch (error) {
            if (!messageId || !messages) throw error;
            const result = await deliverArtwork(value => messages.edit(messageId, value), payload, currentMessage);
            // The bot token continues to work after an interaction's webhook token expires.
            directEdits.add(interaction);
            return result;
        }
    }

    function roundPanel(room, index, revealed = index) {
        const view = battlePanel(room, revealed, dropName);
        view.embeds[0].setTitle(`⚔️ Vòng ${index + 1}/${room.rounds.length} · ${caseName(room.rounds[index].caseId)}`);
        return view;
    }

    async function prepareRound(room, index, attachmentSizeLimit, shouldStop) {
        try {
            if (shouldStop() || attachmentSizeLimit === 0) return null;
            const round = room.rounds[index];
            const weaponCase = battle.getBattleCase(round.caseId);
            const displayCase = lockedCase(weaponCase, room.pricesByCase?.[round.caseId]) ?? weaponCase;
            const rounds = round.entries.map(entry => reelRound(displayCase, entry.drop));
            const files = await renderRoundImages(rounds, attachmentSizeLimit, shouldStop);
            if (!files) return null;
            return { files, playbackMs: rounds.some(item => item.cards[item.selectedIndex].mystery)
                ? reel.RARE_REEL_PLAYBACK_MS : reel.REEL_PLAYBACK_MS };
        } catch (error) {
            console.warn('Lỗi tạo hoạt ảnh vòng Case Battle:', error.message);
            return null;
        }
    }

    async function animateRounds(room, update, attachmentSizeLimit, shouldStop = shuttingDown, rethrowUpdateErrors = false) {
        // Catch render failures immediately: a prefetched render can settle while
        // the current GIF is playing, or after shutdown has ended this animation.
        let complete = true;
        try {
            let prepared = room.rounds.length && !shouldStop() ? prepareRound(room, 0, attachmentSizeLimit, shouldStop) : null;
            for (let index = 0; index < room.rounds.length; index++) {
                if (shouldStop()) { complete = false; break; }
                if (index === 0) await update(roundPanel(room, index));
                const media = await prepared;
                if (shouldStop()) break;
                const view = roundPanel(room, index);
                if (media) {
                    view.embeds[0].setImage(`attachment://${media.files[0].name}`);
                    for (const { name } of media.files.slice(1)) view.embeds.push(new EmbedBuilder().setImage(`attachment://${name}`));
                }
                if (index > 0 || media) await update(media ? { ...view, files: media.files } : view);
                else await update(roundPanel(room, index, index + 1));
                // One future round per room overlaps the current playback. Do not
                // queue the entire schedule, so other rooms retain renderer slots.
                prepared = index + 1 < room.rounds.length && !shouldStop()
                    ? prepareRound(room, index + 1, attachmentSizeLimit, shouldStop) : null;
                if (media && !shouldStop()) await delay(media.playbackMs);
            }
        } catch (error) {
            console.warn('Lỗi hiển thị hoạt ảnh Case Battle:', error.message);
            if (rethrowUpdateErrors) throw error;
            complete = false;
        }
        return complete && !shouldStop();
    }

    async function animate(interaction, room) {
        const update = payload => editBattleMessage(interaction, room, payload);
        const complete = await animateRounds(room, update, interaction.attachmentSizeLimit);
        if (!complete || shuttingDown() || !await animateTieBreaks(room, update, interaction.attachmentSizeLimit) || shuttingDown()) {
            if (room.status === 'finished') await showFinal(interaction, room);
            else if (room.pendingResultMessageId) scheduleResultRecovery(interaction.guild);
            return;
        }
        await showFinal(interaction, room);
    }

    async function animateTieBreaks(room, update, attachmentSizeLimit, shouldStop = shuttingDown, rethrowUpdateErrors = false) {
        let complete = true;
        for (const [index, match] of (room.tieBreaks ?? []).entries()) {
            if (shouldStop()) { complete = false; break; }
            const blue = sideName(room, match.left);
            const red = sideName(room, match.right);
            const embed = new EmbedBuilder().setTitle(`🪙 Vòng phụ 50/50 · ${index + 1}/${room.tieBreaks.length}`).setColor('#5865f2')
                .setDescription(`🔵 **${blue}**\n🔴 **${red}**\n\nMỗi bên **50%** trong cặp này · **Không thu thêm xu**.\nBên thắng đi tiếp.`);
            const panel = { content: null, embeds: [embed], attachments: [], components: [], allowedMentions: mentions };
            try {
                const media = attachmentSizeLimit === 0 ? null
                    : getBattleTieAnimation(match.winner === match.left ? 'left' : 'right', attachmentSizeLimit);
                if (media) {
                    embed.setImage(media.url);
                    await update({ ...panel, files: [{ attachment: media.buffer, name: media.name }] });
                    if (!shouldStop()) await delay(Math.min(3_000, Math.max(0, Number(media.durationMs) || 0)));
                }
                if (shouldStop()) break;
                embed.setImage(null).setColor('#e4ae39').addFields({ name: 'Qua vòng phụ', value: `**${sideName(room, match.winner)}**` });
                await update(panel);
            } catch (error) {
                console.warn('Lỗi hiển thị vòng phụ Battle:', error.message);
                if (rethrowUpdateErrors) throw error;
                complete = false;
                break;
            }
        }
        return complete && !shouldStop();
    }

    async function showFinal(interaction, room) {
        try {
            if (room.status === 'revealing') {
                const completed = await battle.completeReveal(interaction.guild, room.id);
                if (!completed.room || completed.room.status !== 'finished') throw new Error(completed.error ?? 'Chưa chốt được thưởng Battle.');
                room = completed.room;
            }
            const panel = battlePanel(room, room.rounds.length, dropName, 0, interaction.attachmentSizeLimit);
            await editBattleMessage(interaction, room, panel);
            const messageId = room.pendingResultMessageId ?? interaction.message?.id;
            if (messageId && messageId === interaction.message?.id && room.channelId === interaction.channelId &&
                !interaction.message?.flags?.has?.(MessageFlags.Ephemeral)) {
                const record = await battle.markResultPublished(interaction.guildId, room.id, messageId);
                await scheduleResultDeletion(interaction.guild, record, interaction.channel);
            }
        } catch (error) {
            if (room.pendingResultMessageId) scheduleResultRecovery(interaction.guild);
            throw error;
        }
    }

    async function scheduleResultDeletion(guild, record, knownChannel, retryMs) {
        if (shuttingDown() || !record || !Number.isSafeInteger(record.deleteAt) || !record.messageId || !record.channelId || !guild?.id) return;
        const key = `${guild.id}/${record.roomId}`;
        const existing = resultDeletions.get(key);
        if (existing?.record.messageId === record.messageId && existing.record.deleteAt === record.deleteAt) return;
        if (existing) clearTimeout(existing.timer);
        const entry = { record, timer: null };
        resultDeletions.set(key, entry);
        const release = () => { if (resultDeletions.get(key) === entry) resultDeletions.delete(key); };
        const remove = async () => {
            if (resultDeletions.get(key) !== entry) return;
            if (shuttingDown()) { release(); return; }
            // Retain this entry through the Discord request and disk acknowledgement;
            // reconnect/refresh events must not start another delete while it waits.
            let retry = false;
            try {
                const channel = knownChannel?.messages?.delete ? knownChannel : await guild.channels.fetch(record.channelId);
                if (!channel?.messages?.delete) throw new Error('Không truy cập được kênh kết quả Battle.');
                await channel.messages.delete(record.messageId);
                await battle.markResultDeleted(guild.id, record.roomId, record.messageId);
            } catch (error) {
                if (error.code === RESTJSONErrorCodes.UnknownChannel || error.code === RESTJSONErrorCodes.UnknownMessage) {
                    try { await battle.markResultDeleted(guild.id, record.roomId, record.messageId); } catch (saveError) {
                        console.warn('Lỗi lưu trạng thái xóa kết quả Battle:', saveError.message);
                        retry = true;
                    }
                } else {
                    console.warn('Lỗi tự xóa kết quả Case Battle:', error.message);
                    retry = true;
                }
            } finally {
                release();
            }
            if (retry && !shuttingDown()) await scheduleResultDeletion(guild, record, knownChannel, RESULT_DELETE_RETRY_MS);
        };
        const wait = retryMs ?? Math.max(0, record.deleteAt - Date.now());
        if (wait === 0) return remove();
        entry.timer = setTimeout(() => { void remove(); }, wait);
        entry.timer.unref?.();
    }

    function scheduleResultRecovery(guild) {
        if (shuttingDown() || resultRecoveryRetries.has(guild.id)) return;
        const timer = setTimeout(() => {
            resultRecoveryRetries.delete(guild.id);
            void restoreResults(guild).catch(error => console.warn('Lỗi khôi phục kết quả Case Battle:', error.message));
        }, RESULT_DELETE_RETRY_MS);
        resultRecoveryRetries.set(guild.id, timer);
        timer.unref?.();
    }

    function clearResultRecovery(guildId) {
        const timer = resultRecoveryRetries.get(guildId);
        if (timer) clearTimeout(timer);
        resultRecoveryRetries.delete(guildId);
    }

    async function restoreResults(guild) {
        if (shuttingDown() || recoveringGuilds.has(guild.id)) return;
        recoveringGuilds.add(guild.id);
        clearResultRecovery(guild.id);
        try {
            await restoreGuildResults(guild);
        } catch (error) {
            scheduleResultRecovery(guild);
            throw error;
        } finally {
            recoveringGuilds.delete(guild.id);
        }
    }

    async function restoreGuildResults(guild) {
        for (const pending of await battle.pendingResults(guild.id)) {
            if (shuttingDown()) return;
            let room = pending;
            const { pendingResultMessageId: messageId, channelId } = room;
            const key = `${guild.id}/${room.id}`;
            if (revealing.has(key) || edits.has(key)) continue;
            revealing.add(key);
            try {
                const channel = await guild.channels.fetch(channelId);
                if (shuttingDown()) return;
                if (!channel?.messages?.edit) throw new Error('Không truy cập được tin nhắn Battle để khôi phục vòng quay.');
                const update = payload => deliverArtwork(value => channel.messages.edit(messageId, value), payload);
                if (room.status === 'revealing') {
                    const roundsComplete = await animateRounds(room, update, undefined, shuttingDown, true);
                    const tiesComplete = roundsComplete && await animateTieBreaks(room, update, undefined, shuttingDown, true);
                    if (!roundsComplete || !tiesComplete) {
                        scheduleResultRecovery(guild);
                        continue;
                    }
                    const completed = await battle.completeReveal(guild, room.id);
                    if (!completed.room || completed.room.status !== 'finished') {
                        scheduleResultRecovery(guild);
                        continue;
                    }
                    room = completed.room;
                }
                await update(battlePanel(room, room.rounds.length, dropName));
                const record = await battle.markResultPublished(guild.id, room.id, messageId);
                await scheduleResultDeletion(guild, record, channel);
            } catch (error) {
                if (shuttingDown()) return;
                if (error.code === RESTJSONErrorCodes.UnknownChannel || error.code === RESTJSONErrorCodes.UnknownMessage) {
                    try {
                        if (room.status === 'revealing') {
                            const completed = await battle.completeReveal(guild, room.id);
                            if (!completed.room || completed.room.status !== 'finished') throw new Error(completed.error ?? 'Chưa chốt được thưởng Battle.');
                            room = completed.room;
                        }
                        await battle.markResultDeleted(guild.id, room.id, messageId);
                    } catch (saveError) {
                        console.warn('Lỗi chốt kết quả Battle không còn tin nhắn:', saveError.message);
                        scheduleResultRecovery(guild);
                    }
                } else {
                    console.warn('Lỗi khôi phục kết quả Case Battle:', error.message);
                    scheduleResultRecovery(guild);
                }
            } finally {
                revealing.delete(key);
            }
        }
        if (shuttingDown()) return;
        if ((await battle.pendingResults(guild.id)).length) scheduleResultRecovery(guild);
        else clearResultRecovery(guild.id);
        for (const record of await battle.pendingResultDeletions(guild.id)) {
            await scheduleResultDeletion(guild, record);
        }
    }

    async function roomAction(interaction, action, id) {
        const key = `${interaction.guildId}/${id}`;
        if (revealing.has(key)) return respond(interaction, 'Trận đang mở hòm. Kết quả sẽ hiện ngay trên bảng này.');
        await interaction.deferUpdate();
        const task = (edits.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
            if (revealing.has(key)) return interaction.followUp({ content: 'Trận đang mở hòm.', flags: MessageFlags.Ephemeral });
            const { room, error, started } = action === 'refresh'
                ? { room: await battle.readRoom(interaction.guildId, interaction.channelId, id) }
                : await battle.actOnRoom(interaction.guild, interaction.channelId, id, interaction.user.id, action, rollDrop, interaction.message?.id);
            if (!room) return interaction.followUp({ content: error ?? 'Phòng Battle đã hết hạn.', flags: MessageFlags.Ephemeral });
            if (!started) {
                if (room.status === 'finished') return showFinal(interaction, room);
                if (room.status === 'revealing') {
                    revealing.add(key);
                    return { startedRoom: room };
                }
                return deliverArtwork(value => interaction.editReply(value), roomPanel(room, dropImage, interaction.attachmentSizeLimit), interaction.message);
            }
            revealing.add(key);
            return { startedRoom: room };
        });
        edits.set(key, task);
        let result;
        try { result = await task; } finally { if (edits.get(key) === task) edits.delete(key); }
        if (!result?.startedRoom) return result;
        try { return await animate(interaction, result.startedRoom); } finally { revealing.delete(key); }
    }

    function handle(interaction) {
        const [action, id, version, page] = interaction.customId.slice(PREFIX.length).split('_');
        if (action === 'seat') {
            if (version !== undefined || page !== undefined || interaction.values?.length !== 1 || !/^(?:[1-9]|10)$/.test(interaction.values[0])) {
                return respond(interaction, 'Hãy chọn một vị trí trống trên bảng phòng Battle hiện tại.');
            }
            return roomAction(interaction, `seat-${interaction.values[0]}`, id);
        }
        if (action === 'new') {
            const source = battle.getBattleCase(id);
            // Older collection results already contain their collection source ID
            // in this button. Keep those buttons usable after the routing fix.
            if (source?.key) return openBuilder(interaction, id, version);
            if (customCasesById.has(version)) return openBuilder(interaction, 'crate-4904', version);
            return expiredDraft(interaction);
        }
        if (action === 'room-schedule') return showSchedule(interaction, id, version);
        if (action === 'result-page') return showResultPage(interaction, id, version);
        if (action === 'recreate') return recreate(interaction, id);
        if (action === 'draft-odds' || action === 'draft-odds-page') return showDraftOdds(interaction, id, version, page);
        if (['room-odds', 'room-odds-case', 'room-odds-page'].includes(action)) return showRoomOdds(interaction, id, version, page);
        if (['join', 'join-a', 'join-b', 'leave', 'cancel', 'refresh', 'bot-start'].includes(action)) return roomAction(interaction, action, id);
        return editDraft(interaction, action, id, version, page);
    }

    return { handle, restoreResults };
}

module.exports = { PREFIX, DRAFT_TTL, createBattleUi };
