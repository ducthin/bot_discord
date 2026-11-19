const crypto = require('node:crypto');
const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder,
    ModalBuilder, TextInputBuilder, TextInputStyle, LabelBuilder
} = require('discord.js');
const engine = require('../../utils/cs2Upgrade');
const art = require('../../utils/cs2UpgradeArt');
const market = require('../../utils/cs2Market');
const { skins } = require('../../utils/cs2Catalogue');
const { wearNames, wearIndex } = require('../../utils/cs2MarketNames');
const { COIN_SCALE, parseCoins, formatCoins, formatCoinInput } = require('../../utils/coins');
const { getCoinBalance } = require('../taixiu');
const { respond } = require('../../utils/managementAccess');

const PREFIX = 'mg_hom_upgrade:';
const PAGE_SIZE = 12;
const DISCORD_INPUT_LIMIT = 10;
const SESSION_TTL_MS = 20 * 60_000;
const SESSION_LIMIT = 128;
const MULTIPLIERS = [1.05, 1.5, 2, 5, 10, 20];
const percent = tickets => `${(tickets / 1000).toFixed(3)}%`;
const amount = value => formatCoins(BigInt(value ?? 0));
const compact = text => String(text).slice(0, 100).toWellFormed();
const targetName = target => `${target.name}${target.phase ? ` · ${target.phase}` : ''}`;
const winRange = attempt => {
    const start = attempt.startTicket ?? (attempt.direction === 'over' ? engine.TICKETS - attempt.winTickets : 0);
    const end = start + attempt.winTickets;
    return end <= engine.TICKETS ? `${start + 1}–${end}` : `${start + 1}–${engine.TICKETS} ∪ 1–${end - engine.TICKETS}`;
};
const numericFormValue = value => {
    const formatted = formatCoinInput(value);
    return formatted.length <= 45 ? formatted : formatted.replaceAll(',', '');
};
const messages = {
    'not-owned': 'Một skin đã rời kho. Hãy chọn lại nguyên liệu.', locked: 'Một skin đang khóa. Hãy mở khóa rồi chọn lại.',
    'stale-inputs': 'Kho đã thay đổi. Hãy chọn lại nguyên liệu.', 'stale-prices': 'Giá đã thay đổi. Hãy xem và xác nhận giá mới.',
    'price-changed': 'Giá đã thay đổi. Hãy xem và xác nhận giá mới.', 'missing-price': 'Một món chưa có giá thị trường còn hạn. Hãy chờ đồng bộ giá.',
    'insufficient-funds': 'Ví không đủ xu. Chưa trừ skin hay xu.', expired: 'Xác nhận đã hết hạn. Hãy chọn lại mục tiêu.',
    'not-found': 'Lượt chờ không còn. Hãy xem Lịch sử để kiểm tra kết quả.', 'invalid-inputs': 'Chọn tối đa 10 skin hợp lệ, không bị khóa.',
    'invalid-target': 'Mục tiêu không còn hợp lệ. Hãy chọn lại.', 'target-too-cheap': 'Giá mục tiêu phải cao hơn tổng giá trị dùng để Upgrade.',
    'chance-too-low': 'Tỷ lệ dưới 1%. Hãy thêm nguyên liệu hoặc chọn mục tiêu rẻ hơn.',
    'stale-confirmation': 'Client seed của lượt chờ đã thay đổi. Bấm Lượt chờ để xem và xác nhận lại.'
};

function createUpgrade({ button, rows, readPlayer, editHomReply, dropName, userKey }) {
    const sessions = new Map();
    const payload = (embed, components, extra = {}) => ({ content: null, embeds: [embed], attachments: [], components, allowedMentions: { parse: [] }, ...extra });
    const id = (session, action, arg) => `${PREFIX}${action}:${session.token}:${session.revision}${arg === undefined ? '' : `:${arg}`}`;
    const control = (session, action, label, options = {}) => new ButtonBuilder().setCustomId(id(session, action, options.arg))
        .setLabel(label).setStyle(options.style ?? ButtonStyle.Secondary).setDisabled(options.disabled ?? false);
    const navigation = session => button('inventory', session.caseId, 'Về kho');
    const freshQuote = ref => {
        if (!ref) return null;
        const result = market.peekMarketQuote(ref.name, ref);
        const now = Date.now();
        return result?.source === (ref.paintSeed != null ? 'csfloat' : 'buff') &&
            (result.paintSeed ?? null) === (ref.paintSeed ?? null) && (result.phase ?? null) === ref.phase &&
            Number.isSafeInteger(result.priceVnd) && result.priceVnd > 0 && Number.isSafeInteger(result.observedAt) && result.observedAt <= now &&
            Number.isSafeInteger(result.expiresAt) && result.expiresAt > now ? result : null;
    };
    const quote = drop => freshQuote(market.getDropMarketQuoteRef(drop));
    const value = drop => {
        const price = quote(drop)?.priceVnd;
        return Number.isSafeInteger(price) && price > 0 ? BigInt(price) * COIN_SCALE : null;
    };
    const noticeFor = status => messages[status] ?? 'Chưa thể Upgrade. Hãy chọn lại nguyên liệu và mục tiêu.';

    function remember(interaction, session) {
        const now = Date.now();
        for (const [key, entry] of sessions) if (entry.expiresAt <= now) sessions.delete(key);
        sessions.delete(userKey(interaction));
        while (sessions.size >= SESSION_LIMIT) sessions.delete(sessions.keys().next().value);
        sessions.set(userKey(interaction), { ...session, expiresAt: now + SESSION_TTL_MS });
    }

    // Publish the new revision before replacing the session, so failed edits leave old controls usable.
    async function publish(interaction, session, view) {
        await editHomReply(interaction, view);
        remember(interaction, session);
    }

    function selectedDrops(state, interaction, session) {
        const owned = state.skinCases?.[interaction.user.id]?.drops ?? [];
        return owned.filter(drop => session.selected.includes(drop.id));
    }

    function inputView(interaction, session, state, notice) {
        const stash = state.skinCases?.[interaction.user.id];
        const all = engine.eligibleInputs(stash).filter(drop => value(drop) !== null);
        const available = new Set(all.map(drop => drop.id));
        session.selected = session.selected.filter(dropId => available.has(dropId));
        const prices = new Map(all.map(drop => [drop.id, value(drop)]));
        all.sort((a, b) => session.order === 'newest' ? (b.acquiredAt ?? 0) - (a.acquiredAt ?? 0) || a.id.localeCompare(b.id)
            : (prices.get(a.id) < prices.get(b.id) ? -1 : prices.get(a.id) > prices.get(b.id) ? 1 : a.id.localeCompare(b.id)) * (session.order === 'desc' ? -1 : 1));
        const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
        session.page = Math.max(0, Math.min(session.page, pages - 1));
        const visible = all.slice(session.page * PAGE_SIZE, (session.page + 1) * PAGE_SIZE);
        session.visible = visible.map(drop => drop.id);
        const selectedValue = all.reduce((sum, drop) => sum + (session.selected.includes(drop.id) ? prices.get(drop.id) : 0n), 0n);
        const stake = selectedValue + session.coinStake;
        const lines = session.selected.slice(0, DISCORD_INPUT_LIMIT).map(dropId => {
            const drop = all.find(item => item.id === dropId);
            return `• ${dropName(drop)} · ${amount(prices.get(dropId))}`;
        });
        if (session.selected.length > DISCORD_INPUT_LIMIT) lines.push(`• và ${session.selected.length - DISCORD_INPUT_LIMIT} skin khác đã chọn trên web.`);
        const embed = new EmbedBuilder().setTitle('Upgrade · Chọn nguyên liệu').setColor('#9b5cff')
            .setDescription(`Chọn tối đa **10 skin** hoặc dùng xu để nhận một skin đắt hơn. Thắng nhận món đích; thua mất nguyên liệu và xu đã chọn.\n\n${lines.join('\n') || 'Chưa chọn skin.'}`)
            .addFields({ name: 'Giá trị tham gia', value: `Skin **${amount(selectedValue)}** + Xu **${amount(session.coinStake)}** = **${amount(stake)}**` },
                { name: 'Ví hiện tại', value: amount(getCoinBalance(state, interaction.user.id)) })
            .setFooter({ text: [notice, 'Chỉ hiện skin mở khóa có giá thị trường còn hạn', `Trang ${session.page + 1}/${pages}`].filter(Boolean).join(' · ') });
        const otherSelected = session.selected.filter(dropId => !session.visible.includes(dropId)).length;
        const maxValues = Math.min(visible.length, DISCORD_INPUT_LIMIT - otherSelected);
        const menu = visible.length && maxValues > 0 ? new StringSelectMenuBuilder().setCustomId(id(session, 'items'))
            .setPlaceholder(`Đã chọn ${session.selected.length}/10 · Chọn hoặc bỏ skin trên trang này`)
            .setMinValues(0).setMaxValues(maxValues).addOptions(visible.map(drop => ({
                label: compact(dropName(drop)), value: drop.id, default: session.selected.includes(drop.id),
                description: compact(`${amount(prices.get(drop.id))}${drop.float == null ? '' : ` · ${wearNames[wearIndex(drop.float)]} · ${drop.float.toFixed(6)}`}`)
            }))) : null;
        const sort = new StringSelectMenuBuilder().setCustomId(id(session, 'sort')).setPlaceholder('Sắp xếp nguyên liệu').addOptions([
            { label: 'Giá tăng dần', value: 'asc', default: session.order === 'asc' },
            { label: 'Giá giảm dần', value: 'desc', default: session.order === 'desc' },
            { label: 'Mới nhận trước', value: 'newest', default: session.order === 'newest' }
        ]);
        return payload(embed, rows(...(menu ? [[menu]] : []), [sort], [
            control(session, 'ipage', 'Trang trước', { arg: session.page - 1, disabled: session.page === 0 }),
            control(session, 'ipage', 'Trang sau', { arg: session.page + 1, disabled: session.page + 1 === pages }),
            control(session, 'auto', 'Chọn nhanh 10', { disabled: !all.length }), control(session, 'clear', 'Bỏ chọn')
        ], [control(session, 'settings', 'Xu & Client seed'), control(session, 'targets', 'Chọn skin đích', { style: ButtonStyle.Primary, disabled: stake <= 0n })], [
            navigation(session), control(session, 'history', 'Lịch sử'), control(session, 'pending', 'Lượt chờ'), control(session, 'help', 'Cách chơi')
        ]));
    }

    function targetOptions(interaction, session, state) {
        const drops = selectedDrops(state, interaction, session);
        const stake = drops.reduce((sum, drop) => sum + (value(drop) ?? 0n), 0n) + session.coinStake;
        if (stake <= 0n || drops.length !== session.selected.length) return [];
        const filters = session.filters;
        const query = filters.query.toLocaleLowerCase('en');
        const minimumTimes100 = BigInt(Math.round(session.multiplier * 100));
        return engine.targetCatalogue().flatMap(target => {
            if (query && !targetName(target).toLocaleLowerCase('en').includes(query)) return [];
            if (filters.wear !== null && target.exterior !== filters.wear) return [];
            if (filters.statTrak !== null && target.statTrak !== filters.statTrak) return [];
            const ref = target.marketRef;
            const price = freshQuote(ref)?.priceVnd;
            if (!Number.isSafeInteger(price) || price <= 0) return [];
            const targetValue = BigInt(price) * COIN_SCALE;
            if (targetValue <= stake || targetValue * 100n < stake * minimumTimes100 || (filters.min !== null && targetValue < filters.min) ||
                (filters.max !== null && targetValue > filters.max)) return [];
            const winTickets = Number(stake * BigInt(engine.RTP_TICKETS) / targetValue);
            if (winTickets < engine.MIN_WIN_TICKETS) return [];
            return [{ target, targetValue, winTickets: Math.min(engine.MAX_WIN_TICKETS, winTickets) }];
        }).sort((a, b) => (a.targetValue < b.targetValue ? -1 : a.targetValue > b.targetValue ? 1 : a.target.id.localeCompare(b.target.id)) * (session.targetOrder === 'desc' ? -1 : 1));
    }

    function targetView(interaction, session, state, notice) {
        const options = targetOptions(interaction, session, state);
        const pages = Math.max(1, Math.ceil(options.length / PAGE_SIZE));
        session.page = Math.max(0, Math.min(session.page, pages - 1));
        const visible = options.slice(session.page * PAGE_SIZE, (session.page + 1) * PAGE_SIZE);
        session.visible = visible.map(item => item.target.id);
        const drops = selectedDrops(state, interaction, session);
        const preview = engine.preview({ drops, targetId: session.targetId, coinStake: session.coinStake });
        session.preview = preview.status === 'ready' && drops.length === session.selected.length ? preview : null;
        const description = visible.map(({ target, targetValue, winTickets }, index) => `${index + 1}. **${targetName(target)}** · ${amount(targetValue)} · ${percent(winTickets)}`).join('\n');
        const embed = new EmbedBuilder().setTitle('Upgrade · Chọn skin đích').setColor('#9b5cff')
            .setDescription(description || 'Chưa có mục tiêu khớp bộ lọc và giá BUFF còn hạn. Thử mốc nhân thấp hơn, xóa bộ lọc hoặc chờ bảng giá đồng bộ.')
            .setFooter({ text: [notice, `Mốc ≥${session.multiplier}x`, `${options.length} mẫu`, `Trang ${session.page + 1}/${pages}`].filter(Boolean).join(' · ') });
        if (session.preview) {
            embed.addFields({ name: 'Mục tiêu đã chọn', value: `${targetName(session.preview.target)}\n**${amount(session.preview.stake)} → ${amount(session.preview.targetValue)}** · Thắng **${percent(session.preview.winTickets)}**` });
            if (session.preview.target.image) embed.setThumbnail(session.preview.target.image);
        }
        const select = visible.length ? new StringSelectMenuBuilder().setCustomId(id(session, 'target')).setPlaceholder('Chọn đúng mẫu, wear và StatTrak muốn nhận')
            .addOptions(visible.map(({ target, targetValue, winTickets }) => ({ label: compact(targetName(target)), value: target.id,
                description: compact(`${target.phase ? `${target.phase} · ` : ''}${amount(targetValue)} · ${percent(winTickets)} · ${target.exterior == null ? 'Không float' : wearNames[target.exterior]}`),
                default: target.id === session.targetId }))) : null;
        return payload(embed, rows(...(select ? [[select]] : []), MULTIPLIERS.slice(0, 5).map(multiplier => control(session, 'multi', `${multiplier}x`, {
            arg: multiplier, style: session.multiplier === multiplier ? ButtonStyle.Primary : ButtonStyle.Secondary
        })), [control(session, 'multi', '20x', { arg: 20 }),
            control(session, 'tpage', 'Trang trước', { arg: session.page - 1, disabled: session.page === 0 }),
            control(session, 'tpage', 'Trang sau', { arg: session.page + 1, disabled: session.page + 1 === pages }),
            control(session, 'filter', 'Tìm / Lọc'), control(session, 'torder', session.targetOrder === 'asc' ? 'Giá ↑' : 'Giá ↓')
        ], [control(session, 'inputs', 'Đổi nguyên liệu'), control(session, 'direction', session.direction === 'under' ? 'Vùng thắng: Đầu' : 'Vùng thắng: Cuối'),
            control(session, 'review', 'Xem xác nhận', { style: ButtonStyle.Success, disabled: !session.preview }), control(session, 'unfilter', 'Xóa bộ lọc')],
        [navigation(session), control(session, 'history', 'Lịch sử')]));
    }

    function confirmView(session, pending, notice) {
        session.pendingId = pending.id;
        session.pendingClientSeed = pending.clientSeed;
        session.pendingHash = pending.hash;
        session.clientSeed = pending.clientSeed;
        session.selected = [...pending.inputIds];
        session.coinStake = BigInt(pending.coinStake);
        session.targetId = pending.targetId;
        session.direction = pending.direction;
        const inputs = pending.inputs.slice(0, DISCORD_INPUT_LIMIT).map(drop => `• ${dropName(drop)}`);
        if (pending.inputs.length > DISCORD_INPUT_LIMIT) inputs.push(`• và ${pending.inputs.length - DISCORD_INPUT_LIMIT} skin khác.`);
        const embed = new EmbedBuilder().setTitle('Upgrade · Xác nhận lượt').setColor('#9b5cff')
            .setDescription(`**${targetName(pending.target)}**\nThắng nhận 1 skin đích. Nguyên liệu dùng ở cả thắng và thua: **${pending.inputIds.length} skin** và **${amount(pending.coinStake)}**.\n${inputs.join('\n')}\nChưa trừ nguyên liệu hoặc xu khi đang ở màn xác nhận.`)
            .addFields({ name: 'Giá trị', value: `**${amount(pending.stake)} → ${amount(pending.targetValue)}**`, inline: true },
                { name: 'Tỷ lệ thắng', value: `**${percent(pending.winTickets)}** · Vé ${winRange(pending)}/100000`, inline: true },
                { name: 'Cam kết trước lượt (HMAC-SHA256)', value: `\`${pending.hash}\`` },
                { name: 'Client seed', value: `\`${pending.clientSeed}\` · Nonce **${pending.nonce}**` },
                { name: 'Hết hạn', value: `<t:${Math.floor(pending.expiresAt / 1000)}:R>` })
            .setFooter({ text: notice ?? 'Công thức bot: min(90%, floor(giá trị vào / giá đích × 95000) / 1000%). Tối thiểu 1%.' });
        return payload(embed, rows([control(session, 'roll', 'UPGRADE', { style: ButtonStyle.Success }),
            control(session, 'seed', 'Đổi client seed'), control(session, 'targets', 'Chọn lại'),
            control(session, 'history', 'Lịch sử'), navigation(session)]));
    }

    function resultView(session, receipt, { proof = false, image } = {}) {
        const valid = engine.verify(receipt);
        const embed = new EmbedBuilder().setTitle(receipt.won ? 'Upgrade thành công!' : 'Upgrade chưa thành công').setColor(receipt.won ? '#a970ff' : '#e85b6a')
            .setDescription(`**${targetName(receipt.target)}**\n${receipt.won ? 'Skin đích đã được lưu vào kho.' : 'Nguyên liệu và xu đã chọn đã được sử dụng.'}`)
            .addFields({ name: 'Tỷ lệ / Kết quả', value: `**${percent(receipt.winTickets)}** · Vé **${receipt.ticket}/100000** · Vùng ${receipt.startTicket === undefined ? receipt.direction === 'over' ? 'cuối' : 'đầu' : winRange(receipt)}` },
                { name: 'Giá trị đã dùng', value: `${amount(receipt.stake)} → ${amount(receipt.targetValue)}` })
            .setFooter({ text: `Mã lượt ${receipt.id} · ${valid ? 'Kiểm chứng khớp' : 'Kiểm chứng không khớp'}` });
        const skin = skins[receipt.target.skinId];
        if (skin?.image) embed.setThumbnail(skin.image);
        if (image) embed.setImage(image);
        if (proof) embed.addFields({ name: 'Public hash', value: `\`${receipt.hash}\`` },
            { name: 'Server seed / Salt', value: `\`${receipt.serverSeed}\`\n\`${receipt.salt}\`` },
            { name: 'Client seed / Nonce', value: `\`${receipt.clientSeed}\` · **${receipt.nonce}**` });
        if (receipt.drop?.float != null) embed.addFields({ name: 'Skin nhận được', value: `${wearNames[wearIndex(receipt.drop.float)]} · Float ${receipt.drop.float.toFixed(6)} · Seed ${receipt.drop.paintSeed}` });
        return payload(embed, rows([control(session, 'inputs', 'Upgrade mới', { style: ButtonStyle.Primary }), navigation(session),
            control(session, 'history', 'Lịch sử'), control(session, 'proof', 'Kiểm chứng / JSON')]));
    }

    async function reveal(interaction, session, result) {
        const receipt = result.receipt;
        session.stage = 'result';
        session.receiptId = receipt.id;
        let media;
        if (result.status === 'settled') {
            try {
                media = await art.renderUpgrade(receipt, interaction.attachmentSizeLimit);
                if (media?.gif) {
                    const embed = new EmbedBuilder().setTitle('Upgrade · Đang quay').setColor('#9b5cff')
                        .setDescription(`Tỷ lệ thắng **${percent(receipt.winTickets)}** · Kết quả đã được lưu an toàn.`).setImage('attachment://cs2-upgrade.gif');
                    await editHomReply(interaction, payload(embed, [], { files: [{ attachment: media.gif, name: 'cs2-upgrade.gif' }] }));
                    await new Promise(resolve => setTimeout(resolve, media.durationMs));
                }
            } catch { media = null; }
        }
        const image = media?.png ? 'attachment://cs2-upgrade.png' : undefined;
        const view = resultView(session, receipt, { image });
        if (media?.png) view.files = [{ attachment: media.png, name: 'cs2-upgrade.png' }];
        try { await publish(interaction, session, view); }
        catch (error) {
            if (!view.files) throw error;
            await publish(interaction, session, resultView(session, receipt));
        }
    }

    function form(session, action) {
        const modalAction = action === 'settings' ? 'settings-save' : action === 'seed' ? 'seedsave' : 'filter-save';
        const modalTitle = action === 'settings' ? 'Upgrade · Xu và Client seed' : action === 'seed' ? 'Upgrade · Client seed' : 'Upgrade · Tìm skin đích';
        const modal = new ModalBuilder().setCustomId(id(session, modalAction)).setTitle(modalTitle);
        const fields = action === 'settings' ? [
            ['coins', 'Số xu thêm vào (trống hoặc 0 để bỏ)', numericFormValue(session.coinStake), 45],
            ['seed', 'Client seed (chữ, số, dấu - và _)', session.clientSeed, 64]
        ] : action === 'seed' ? [['seed', 'Client seed sau khi xem hash', session.clientSeed, 64]] : [['query', 'Tên skin / vũ khí / phase', session.filters.query, 80],
            ['wear', 'Wear: FN, MW, FT, WW, BS (trống = tất cả)', session.filters.wear === null ? '' : ['FN', 'MW', 'FT', 'WW', 'BS'][session.filters.wear], 2],
            ['stattrak', 'StatTrak: yes / no (trống = tất cả)', session.filters.statTrak === null ? '' : session.filters.statTrak ? 'yes' : 'no', 3],
            ['min', 'Giá đích tối thiểu (xu)', session.filters.min === null ? '' : numericFormValue(session.filters.min), 45],
            ['max', 'Giá đích tối đa (xu)', session.filters.max === null ? '' : numericFormValue(session.filters.max), 45]];
        for (const [field, label, initial, max] of fields) {
            const input = new TextInputBuilder().setCustomId(field).setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(max);
            if (initial) input.setValue(initial);
            if (typeof modal.addLabelComponents === 'function' && LabelBuilder) modal.addLabelComponents(new LabelBuilder().setLabel(label).setTextInputComponent(input));
            else modal.addComponents(new ActionRowBuilder().addComponents(input.setLabel(label)));
        }
        return modal;
    }

    async function showHistory(interaction, session, requestedPage = 0) {
        const history = await engine.history(interaction.guild.id, interaction.user.id);
        const pages = Math.max(1, Math.ceil(history.length / 6));
        session.stage = 'history';
        session.page = Math.max(0, Math.min(requestedPage, pages - 1));
        const visible = history.slice(session.page * 6, (session.page + 1) * 6);
        session.visible = visible.map(receipt => receipt.id);
        const embed = new EmbedBuilder().setTitle('Upgrade · Lịch sử cá nhân').setColor('#9b5cff')
            .setDescription(visible.map(receipt => `${receipt.won ? '✅' : '❌'} **${targetName(receipt.target)}**\n${amount(receipt.stake)} → ${amount(receipt.targetValue)} · ${percent(receipt.winTickets)} · Vé ${receipt.ticket}`).join('\n\n') || 'Chưa có lượt Upgrade.')
            .setFooter({ text: `Lưu ${engine.HISTORY_LIMIT} lượt gần nhất · Trang ${session.page + 1}/${pages}` });
        const menu = visible.length ? new StringSelectMenuBuilder().setCustomId(id(session, 'receipt')).setPlaceholder('Chọn lượt để xem / kiểm chứng')
            .addOptions(visible.map(receipt => ({ label: compact(`${receipt.won ? 'Thắng' : 'Thua'} · ${targetName(receipt.target)}`), value: receipt.id,
                description: compact(`Vé ${receipt.ticket} · ${percent(receipt.winTickets)} · #${receipt.nonce}`) }))) : null;
        await publish(interaction, session, payload(embed, rows(...(menu ? [[menu]] : []), [
            control(session, 'hpage', 'Trang trước', { arg: session.page - 1, disabled: session.page === 0 }),
            control(session, 'hpage', 'Trang sau', { arg: session.page + 1, disabled: session.page + 1 === pages }),
            control(session, 'inputs', 'Upgrade mới'), navigation(session), control(session, 'pending', 'Lượt chờ')
        ])));
    }

    async function start(interaction, caseId) {
        const session = { token: crypto.randomBytes(6).toString('hex'), revision: 0, messageId: interaction.message?.id,
            caseId, stage: 'inputs', selected: [], coinStake: 0n, clientSeed: crypto.randomBytes(12).toString('hex'),
            direction: 'under', page: 0, order: 'asc', multiplier: 2, targetOrder: 'asc', targetId: null,
            filters: { query: '', wear: null, statTrak: null, min: null, max: null } };
        const state = await readPlayer(interaction);
        await publish(interaction, session, inputView(interaction, session, state));
    }

    const stageActions = {
        inputs: ['items', 'sort', 'ipage', 'auto', 'clear', 'settings', 'settings-save', 'targets', 'help'],
        targets: ['target', 'multi', 'tpage', 'filter', 'filter-save', 'torder', 'direction', 'review', 'unfilter'],
        confirm: ['roll', 'seed', 'seedsave'], result: ['proof'], history: ['receipt', 'hpage']
    };

    async function handle(interaction) {
        const [action, token, revision, arg, ...extra] = interaction.customId.slice(PREFIX.length).split(':');
        const current = sessions.get(userKey(interaction));
        if (!current || extra.length || current.expiresAt <= Date.now() || current.token !== token ||
            String(current.revision) !== revision || !current.messageId || current.messageId !== interaction.message?.id ||
            ![...(stageActions[current.stage] ?? []), 'inputs', 'history', 'pending', ...(current.stage === 'confirm' ? ['targets'] : [])].includes(action)) {
            return respond(interaction, 'Bảng Upgrade đã cũ. Dùng /hom → Upgrade để mở lại; kết quả đã lưu có trong Lịch sử.');
        }
        if (action === 'settings' || action === 'filter' || action === 'seed') return interaction.showModal(form(current, action));
        const session = { ...current, revision: current.revision + 1, selected: [...current.selected], filters: { ...current.filters } };
        const invalid = message => respond(interaction, message);
        const text = field => interaction.fields.getTextInputValue(field).trim();
        if (action === 'settings-save') {
            const raw = text('coins');
            const coins = !raw || raw === '0' ? 0n : parseCoins(raw);
            const seed = text('seed') || session.clientSeed;
            if (coins === null || coins.toString().length > 34 || !/^[A-Za-z0-9_-]{1,64}$/.test(seed)) return invalid('Nhập xu hợp lệ (tối đa 2 số thập phân) và Client seed gồm 1–64 chữ, số, - hoặc _.');
            session.coinStake = coins;
            session.clientSeed = seed;
        }
        if (action === 'seedsave') {
            const seed = text('seed');
            if (!/^[A-Za-z0-9_-]{1,64}$/.test(seed)) return invalid('Client seed phải có 1–64 chữ, số, - hoặc _.');
            session.clientSeed = seed;
        }
        if (action === 'filter-save') {
            const wear = text('wear').toUpperCase();
            const statTrak = text('stattrak').toLowerCase();
            const min = text('min') ? parseCoins(text('min')) : null;
            const max = text('max') ? parseCoins(text('max')) : null;
            if ((wear && !['FN', 'MW', 'FT', 'WW', 'BS'].includes(wear)) || (statTrak && !['yes', 'no'].includes(statTrak)) ||
                (text('min') && min === null) || (text('max') && max === null) || (min !== null && max !== null && min > max)) return invalid('Bộ lọc chưa hợp lệ. Wear dùng FN/MW/FT/WW/BS, StatTrak dùng yes/no, giá tối thiểu không vượt tối đa.');
            session.filters = { query: text('query'), wear: wear ? ['FN', 'MW', 'FT', 'WW', 'BS'].indexOf(wear) : null,
                statTrak: statTrak ? statTrak === 'yes' : null, min, max };
            session.page = 0;
        }
        if (action === 'items') {
            const values = [...new Set(interaction.values)];
            const selected = [...session.selected.filter(dropId => !session.visible.includes(dropId)), ...values];
            if (values.some(dropId => !session.visible.includes(dropId)) || selected.length > DISCORD_INPUT_LIMIT) return invalid('Chọn tối đa 10 skin trên menu hiện tại.');
            session.selected = selected;
        }
        if (action === 'target') {
            if (interaction.values.length !== 1 || !session.visible.includes(interaction.values[0])) return invalid('Chọn mục tiêu trong trang hiện tại.');
            session.targetId = interaction.values[0];
        }
        if (action === 'sort') {
            if (interaction.values.length !== 1 || !['asc', 'desc', 'newest'].includes(interaction.values[0])) return invalid('Chọn lại cách sắp xếp.');
            session.order = interaction.values[0]; session.page = 0;
        }
        if (['ipage', 'tpage', 'hpage'].includes(action)) {
            if (!/^(0|[1-9]\d{0,5})$/.test(arg ?? '')) return invalid('Trang không hợp lệ.');
            session.page = Number(arg);
        }
        if (action === 'multi') {
            if (!MULTIPLIERS.includes(Number(arg))) return invalid('Chọn lại mốc nhân.');
            session.multiplier = Number(arg); session.page = 0;
        }
        if (action === 'clear') session.selected = [];
        if (action === 'unfilter') { session.filters = { query: '', wear: null, statTrak: null, min: null, max: null }; session.page = 0; }
        if (action === 'torder') session.targetOrder = session.targetOrder === 'asc' ? 'desc' : 'asc';
        if (action === 'direction') session.direction = session.direction === 'under' ? 'over' : 'under';
        await interaction.deferUpdate();
        if (action === 'seedsave') {
            const updated = await engine.updateClientSeed(interaction.guild.id, interaction.user.id, current.pendingId, session.clientSeed);
            if (updated.attempt) {
                session.stage = 'confirm';
                return publish(interaction, session, confirmView(session, updated.attempt, 'Client seed đã đổi sau khi xem hash; hash giữ nguyên.'));
            }
            const pending = await engine.pending(interaction.guild.id, interaction.user.id);
            if (pending) return publish(interaction, session, confirmView(session, pending, noticeFor(updated.status)));
            session.stage = 'inputs'; session.page = 0;
            return publish(interaction, session, inputView(interaction, session, await readPlayer(interaction), noticeFor(updated.status)));
        }
        if (action === 'history' || action === 'hpage') return showHistory(interaction, session, action === 'history' ? 0 : session.page);
        if (action === 'receipt' || action === 'proof') {
            const receiptId = action === 'receipt' ? interaction.values?.[0] : session.receiptId;
            if (action === 'receipt' && (interaction.values.length !== 1 || !session.visible.includes(receiptId))) return showHistory(interaction, session);
            const receipt = (await engine.history(interaction.guild.id, interaction.user.id)).find(item => item.id === receiptId);
            if (!receipt) return showHistory(interaction, session);
            session.stage = 'result'; session.receiptId = receipt.id;
            const view = resultView(session, receipt, { proof: action === 'proof' });
            if (action === 'proof') {
                const json = Buffer.from(JSON.stringify(receipt, null, 2));
                if (json.length <= (interaction.attachmentSizeLimit ?? 8_000_000)) view.files = [{ attachment: json, name: `upgrade-${receipt.nonce}.json` }];
            }
            try { return await publish(interaction, session, view); }
            catch (error) { if (!view.files) throw error; delete view.files; return publish(interaction, session, view); }
        }
        if (action === 'pending') {
            const pending = await engine.pending(interaction.guild.id, interaction.user.id);
            if (pending && pending.expiresAt > Date.now()) {
                session.stage = 'confirm'; session.pendingId = pending.id;
                return publish(interaction, session, confirmView(session, pending));
            }
        }
        if (action === 'roll') {
            const result = await engine.settle(interaction.guild, interaction.user.id, session.pendingId, {
                expectedClientSeed: session.pendingClientSeed, expectedHash: session.pendingHash
            });
            if (result.receipt) return reveal(interaction, session, result);
            session.stage = 'inputs'; session.page = 0;
            return publish(interaction, session, inputView(interaction, session, await readPlayer(interaction), noticeFor(result.status)));
        }
        const state = await readPlayer(interaction);
        if (action === 'review') {
            const drops = selectedDrops(state, interaction, session);
            const preview = current.preview;
            if (!preview || drops.length !== session.selected.length) return publish(interaction, session, targetView(interaction, session, state, 'Kho đã thay đổi. Hãy xem lại.'));
            const prepared = await engine.prepare(interaction.guild.id, interaction.user.id, { inputIds: session.selected,
                targetId: session.targetId, coinStake: session.coinStake, clientSeed: session.clientSeed, direction: session.direction,
                expectedSignature: preview.signature, expectedPrices: preview.prices });
            const pending = prepared.attempt;
            if (pending) {
                session.stage = 'confirm'; session.pendingId = pending.id;
                return publish(interaction, session, confirmView(session, pending));
            }
            return publish(interaction, session, targetView(interaction, session, state, noticeFor(prepared.status)));
        }
        if (action === 'auto') session.selected = engine.eligibleInputs(state.skinCases?.[interaction.user.id]).filter(drop => value(drop) !== null)
            .sort((a, b) => value(a) < value(b) ? -1 : value(a) > value(b) ? 1 : a.id.localeCompare(b.id)).slice(0, DISCORD_INPUT_LIMIT).map(drop => drop.id);
        if (action === 'inputs' || action === 'help' || action === 'pending') {
            session.stage = 'inputs'; session.page = 0;
            if (action === 'inputs' && current.stage === 'result') { session.selected = []; session.coinStake = 0n; session.targetId = null; }
        }
        if (action === 'targets') { session.stage = 'targets'; session.page = 0; }
        const notice = action === 'help' ? '1. Chọn skin/xu → 2. Chọn đích → 3. Kiểm tra tỷ lệ và hash → 4. UPGRADE. Tỷ lệ cao nhất 90%; mỗi lượt độc lập.'
            : action === 'pending' ? 'Không có lượt đang chờ xác nhận. Kết quả cũ nằm trong Lịch sử.' : undefined;
        return publish(interaction, session, session.stage === 'targets' ? targetView(interaction, session, state, notice) : inputView(interaction, session, state, notice));
    }

    return { start, handle };
}

module.exports = { PREFIX, createUpgrade };
