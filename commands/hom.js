const crypto = require('node:crypto');
const metrics = require('../utils/performanceMetrics');
const {
    SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, LabelBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags
} = require('discord.js');
const { keys, skins, containersById: byId } = require('../utils/cs2Catalogue');
const { cases, tiers, TICKETS: totalWeight, RARE_SPECIAL_TIER, KEY_PRICE_AMOUNT, KEY_PRICE,
    drawSkin, rollDrop, paintSeedFor } = require('../utils/cs2NormalCases');
const collectionsByCase = require('../assets/cs2-collections.json');
const finishCatalog = require('../assets/cs2-finish-catalog.json');
const rareReelArt = require('../assets/cs2-rare-reel/index.json');
const { renderRoot, imagesBySkin } = require('../assets/cs2-wear-art.json');
const reel = require('../utils/cs2Reel');
const { SORT_ORDERS, normalizeSort } = require('../utils/cs2InventoryOrder');
const caseVoice = require('../utils/cs2Voice');
const market = require('../utils/cs2Market');
const priceSnapshot = require('../utils/cs2PriceSnapshot');
const { PREFIX: BATTLE_PREFIX, createBattle } = require('./hom/battle');
const { createInventory } = require('./hom/inventory');
const { createMarket } = require('./hom/market');
const { createTradeUp } = require('./hom/tradeUp');
const { PREFIX: UPGRADE_PREFIX, createUpgrade } = require('./hom/upgrade');
const { TICKETS: BATTLE_TICKETS, customCasesById, casePricing } = require('../utils/cs2BattleCases');
const { MAX_PAINT_SEED, patternLabel, isBlueGem } = require('../utils/cs2Patterns');
const { getBlueGemArt, getBlueGemReference } = require('../utils/cs2BlueGemArt');
const { getCaseMarketHashName, wearIndex, wearNames, wearBounds } = require('../utils/cs2MarketNames');
const store = require('../utils/managementStore');
const { COIN_SCALE } = require('../utils/coins');
const { canFitCaseOpening, CAPACITY_NOTICE } = require('../utils/caseOpeningCapacity');
const { respond } = require('../utils/managementAccess');
const { getCoinBalance, formatCoins, purchaseWithCoins } = require('./taixiu');

const PRICE_VERSION = 'xu1';
const PREFIX = 'mg_hom_';
const ORDER_PREFIX = `${PREFIX}order_`;
const INVENTORY_SELECT_PREFIX = `${PREFIX}inventory-select_`;
const INVENTORY_SORT_PREFIX = `${PREFIX}inventory-sort_`;
const PLAYER_MARKET_SELECT = `${PREFIX}market-select_`;
const PLAYER_MARKET_PRICE = `${PREFIX}market-price_`;
const PLAYER_MARKET_FILTER = `${PREFIX}market-filter-form_`;

const CASES_PER_PAGE = 21;
const ITEMS_PER_PAGE = 12;

const PRICE_SOURCE = 'BUFF.163';
const PRICE_BUTTON = 'Xem giá đã đồng bộ';
const WINNING_CARD = 24;
const REEL_FILE = 'cs2-opening.gif';
const BATCH_REEL_FILE = 'cs2-batch-opening.gif';
const RESULT_FILE = 'cs2-result.png';

const AUDIO_ACTION = 'open-audio';
const BATCH_ACTION = 'open-batch';
const CUSTOM_BATCH_ACTION = 'open-custom';
const CUSTOM_BATCH_PREFIX = `${PREFIX}open-form_`;
const BATCH_SIZES = [3, 5, 10];
const MAX_OPEN_COUNT = 100;
const ANIMATED_BATCH_SIZES = new Set([2, 3, 4, 5, 10]);
const SET_SIZES = [1, ...BATCH_SIZES];
const MESSAGE_EMBED_LIMIT = 10;
const VOICE_START_GRACE_MS = 650;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const editHomReply = (interaction, payload) => metrics.measure('hom.upload',
    () => interaction.editReply(payload), () => metrics.payloadBytes(payload));
const busyUsers = new Map();
const pendingPanels = new Map();
const activeOpenings = new Set();

const defaultCase = byId.get('crate-4904');
const contrabandRarity = Object.freeze({ name: 'Contraband', icon: '🟠', color: '#e4ae39' });
const dropRarity = drop => skins[drop.skinId]?.rarity === 'Contraband' ? contrabandRarity : tiers[drop.tier];
const sourceOnly = container => container?.kind === 'terminal' || container?.kind === 'collection';
const previewWeight = totalWeight - tiers[RARE_SPECIAL_TIER].weight;
const percent = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const odds = tiers.map(tier => `${tier.icon} ${tier.name} · **${percent.format(100 * tier.weight / totalWeight)}%**`).join('\n');

function skinName(skin) {
    return skin.phase ? `${skin.name} (${skin.phase})` : skin.name;
}

function paintSeedText(drop) {
    const seed = drop.paintSeed;
    return Number.isInteger(seed) && seed >= 0 && seed <= MAX_PAINT_SEED ? String(seed) : '—';
}

function dropCollection(drop) {
    const container = byId.get(drop.caseId);
    if (sourceOnly(container)) return container.collection;
    // Rare knives and gloves can be shared by several cases and lack these weapon collections.
    return drop.tier === RARE_SPECIAL_TIER ? undefined : collectionsByCase[drop.caseId];
}

function acquisitionDate(drop) {
    const { acquiredAt } = drop;
    return Number.isSafeInteger(acquiredAt) && acquiredAt > 0 && acquiredAt <= Date.now()
        ? `<t:${Math.floor(acquiredAt / 1000)}:D>` : null;
}

function addDropDetails(embed, drop) {
    const collection = dropCollection(drop);
    if (collection) embed.addFields({ name: 'Bộ sưu tập', value: collection });
    if (drop.float != null) embed.addFields(
        { name: 'Tình trạng', value: wearNames[wearIndex(drop.float)], inline: true },
        { name: 'Float', value: drop.float.toFixed(6), inline: true },
        { name: 'Seed', value: paintSeedText(drop), inline: true }
    );
    const finishId = finishCatalog[drop.skinId] ?? skins[drop.skinId]?.finishId;
    if (Number.isInteger(finishId)) embed.addFields({ name: 'Finish Catalog ID', value: String(finishId), inline: true });
    const pattern = patternLabel(drop.skinId, drop.paintSeed);
    if (pattern) embed.addFields({ name: 'Pattern', value: pattern, inline: true });
    if (isBlueGem(drop.skinId, drop.paintSeed)) {
        const reference = getBlueGemReference(drop);
        if (reference) embed.addFields({ name: 'Ảnh pattern', value: `[Seed #${drop.paintSeed} · pattern.wiki](${reference.patternUrl})`, inline: true });
        embed.addFields({ name: 'Định giá', value: drop.priceVariant === 'blue-gem'
            ? `Blue Gem #${drop.paintSeed} · CSFloat`
            : 'Giá mua lại theo skin và độ mòn', inline: true });
        if (drop.priceVariant !== 'blue-gem') {
            const ref = market.getBlueGemMarketQuoteRef(drop);
            const { status, quote } = displayMarketPrice(ref);
            const value = quote
                ? `${status === 'estimate' ? 'Giá đã lưu · ' : ''}**${formatCoins(BigInt(quote.priceVnd) * COIN_SCALE)}**`
                : 'Chưa có giá đúng seed và độ mòn.';
            embed.addFields({ name: `Tham khảo CSFloat · Seed #${drop.paintSeed}`, value });
        }
    }
    const acquired = acquisitionDate(drop);
    if (acquired) embed.addFields({ name: 'Ngày nhận', value: acquired, inline: true });
}

function resultImage(drop, skin, exterior) {
    const reference = getBlueGemReference(drop);
    if (reference) return reference.sourceUrl;
    if (exterior == null) return skin.image;
    const image = imagesBySkin[drop.skinId]?.[exterior];
    if (!image) return skin.image;
    if (image.startsWith('https://')) return image;
    return renderRoot + image.split('/').map(encodeURIComponent).join('/');
}

function dropImage(drop) {
    return resultImage(drop, skins[drop.skinId], drop.float == null ? null : wearIndex(drop.float));
}

function dropName(drop) {
    const skin = skins[drop.skinId];
    return `${drop.statTrak ? 'StatTrak™ ' : ''}${skin ? skinName(skin) : drop.skinId}` +
        (isBlueGem(drop.skinId, drop.paintSeed) ? ` · Blue Gem #${drop.paintSeed}` : '');
}

function getStash(state, userId) {
    const all = state.skinCases ??= {};
    return all[userId] ??= {};
}

const playerScope = userId => ({ wallets: [userId], inventory: [userId] });
const readPlayer = interaction => store.read(interaction.guild.id, playerScope(interaction.user.id));
const transactPlayer = (interaction, operation) => store.transact(
    interaction.guild.id, operation, playerScope(interaction.user.id));

function remember(stash, id) {
    if (stash.recentActions?.includes(id)) return false;
    stash.recentActions = [...(stash.recentActions ?? []), id].slice(-32);
    return true;
}

function releaseUser(interaction) {
    const key = userKey(interaction);
    if (busyUsers.get(key) === interaction) busyUsers.delete(key);
}

async function updatePanelAfter(interaction, initial, prepare, onAttachmentError) {
    const key = userKey(interaction);
    const update = {};
    pendingPanels.set(key, update);
    try {
        await editHomReply(interaction, initial);
        releaseUser(interaction);
        const payload = await prepare();
        if (!payload || pendingPanels.get(key) !== update || busyUsers.has(key)) return;
        busyUsers.set(key, interaction);
        try {
            await editHomReply(interaction, payload);
        } catch (error) {
            if (!payload.files) throw error;
            if (onAttachmentError) return await editHomReply(interaction, onAttachmentError(payload));
            console.warn('Không gửi được ảnh /hom:', error.message);
        }
    } finally {
        if (pendingPanels.get(key) === update) pendingPanels.delete(key);
        releaseUser(interaction);
    }
}

function button(action, caseId, label, { style = ButtonStyle.Secondary, disabled = false, argument } = {}) {
    // Old inventory panels can still refer to retired containers.
    if (action === 'case' && sourceOnly(byId.get(caseId))) caseId = defaultCase.id;
    const suffix = argument === undefined ? '' : `_${argument}`;
    return new ButtonBuilder().setCustomId(`${PREFIX}${action}_${caseId}${suffix}`)
        .setLabel(label).setStyle(style).setDisabled(disabled);
}

function rows(...groups) {
    return groups.map(group => new ActionRowBuilder().addComponents(group));
}

function pageButtons(action, caseId, page, pages) {
    return [
        button(action, caseId, 'Trang trước', { argument: page - 1, disabled: page === 0 }),
        button(action, caseId, 'Trang sau', { argument: page + 1, disabled: page === pages - 1 })
    ];
}

function priceCoins(amount) {
    return amount ? BigInt(amount) * COIN_SCALE : null;
}

function saleCoins(quote) {
    return priceCoins(quote?.priceVnd) ?? 0n;
}

function displayMarketPrice(ref) {
    return ref?.phase || ref?.paintSeed != null ? market.peekMarketDisplay(ref.name, ref) : market.peekMarketDisplay(ref?.name);
}

function quoteAge(quote) {
    return Number.isSafeInteger(quote?.observedAt) ? `<t:${Math.floor(quote.observedAt / 1000)}:R>` : '';
}

const quoteRefKey = ref => ref && market.marketQuoteKey(ref.name, ref.phase, ref.paintSeed);
const peekQuote = ref => ref?.phase || ref?.paintSeed != null ? market.peekMarketQuote(ref.name, ref) : market.peekMarketQuote(ref?.name);

function distinctQuoteRefs(entries) {
    const refs = new Map();
    for (const { marketRef } of entries) {
        if (marketRef) refs.set(quoteRefKey(marketRef), marketRef);
    }
    return refs;
}

function snapshotPriceStatus() {
    const next = priceSnapshot.nextRefreshAt();
    return `Giá ${PRICE_SOURCE} · Lần đồng bộ tiếp theo <t:${Math.ceil(next / 1000)}:t>`;
}

function availableCasePrice(offer) {
    return offer.status === 'fresh' ? offer.quote : null;
}

function casePriceIssue(offer, expectedPrice, label = 'hòm') {
    const quote = availableCasePrice(offer);
    if (!quote) return expectedPrice === null ? `${PRICE_SOURCE} chưa có giá cho ${label}. Thử lại sau.`
        : `Giá ${label} đã hết hạn. Hãy mở lại bảng giá rồi thử lại.`;
    return quote.priceVnd !== expectedPrice ? `Giá ${label} đã đổi. Xem giá mới rồi mua lại.` : null;
}

function missingPrice(status, ref) {
    if (ref?.paintSeed != null) return `Chưa có giá CSFloat cho Blue Gem #${ref.paintSeed}`;
    if (ref?.phase) return `${PRICE_SOURCE} chưa có giá cho phase này.`;
    if (status === 'unmapped') return 'Chưa có mã giá thị trường';
    return `Chưa có giá ${PRICE_SOURCE}`;
}

function shownPrice(input) {
    const value = Number(input);
    return /^[1-9]\d*$/.test(input ?? '') && Number.isSafeInteger(value) ? value : null;
}

function confirmedPrice(input, version) {
    return version === PRICE_VERSION ? shownPrice(input) : null;
}

function marketButton(quote) {
    return new ButtonBuilder().setLabel(quote?.source === 'csfloat' ? 'CSFloat' : PRICE_SOURCE).setStyle(ButtonStyle.Link).setURL(quote?.url ?? market.BUFF_MARKET_URL);
}

function availableOpenCount(weaponCase, stash) {
    return Math.min(stash?.cases?.[weaponCase.id] ?? 0, stash?.keys?.[weaponCase.key] ?? 0);
}

function missingSet(weaponCase, stash, quantity) {
    return {
        cases: Math.max(0, quantity - (stash?.cases?.[weaponCase.id] ?? 0)),
        keys: Math.max(0, quantity - (stash?.keys?.[weaponCase.key] ?? 0))
    };
}

function batchButtons(weaponCase, available) {
    return BATCH_SIZES.map(quantity => button(BATCH_ACTION, weaponCase.id, `Mở ${quantity} hòm`, {
        argument: quantity, disabled: available < quantity
    }));
}

function caseView(weaponCase, balance, stash, notice) {
    const caseCount = stash?.cases?.[weaponCase.id] ?? 0;
    const keyCount = stash?.keys?.[weaponCase.key] ?? 0;
    const available = availableOpenCount(weaponCase, stash);
    const page = Math.floor(cases.indexOf(weaponCase) / CASES_PER_PAGE);
    const pages = Math.ceil(cases.length / CASES_PER_PAGE);
    const catalog = cases.slice(page * CASES_PER_PAGE, (page + 1) * CASES_PER_PAGE);
    const select = new StringSelectMenuBuilder().setCustomId(`${PREFIX}select`)
        .setPlaceholder(`Chọn hòm · ${page + 1}/${pages}`)
        .addOptions(catalog.map(item => ({ label: item.name, value: item.id, default: item.id === weaponCase.id })));
    const marketName = getCaseMarketHashName(weaponCase.id);
    const offer = market.peekMarketDisplay(marketName);
    const priceVnd = availableCasePrice(offer)?.priceVnd;
    const price = priceCoins(priceVnd);
    let casePrice = `Chưa có giá ${PRICE_SOURCE}. Bot tự đồng bộ vào phút 00 và 30.`;
    if (offer.quote) {
        const details = quoteAge(offer.quote);
        const amount = formatCoins(priceCoins(offer.quote.priceVnd));
        casePrice = offer.status === 'fresh' ? `**${amount}** mỗi hòm${details ? `\n${details}` : ''}`
            : `Giá đã lưu **${amount}**${details ? ` · ${details}` : ''}\nĐang chờ bảng giá mới để mua.`;
    }
    const embed = new EmbedBuilder().setTitle(weaponCase.name).setThumbnail(weaponCase.image).setColor('#5865f2')
        .setDescription(`Ví **${formatCoins(balance)}** · Có **${caseCount} hòm** và **${keyCount} chìa**\n${keys[weaponCase.key].name}`)
        .addFields({ name: 'Giá mua hòm', value: casePrice },
        { name: 'Giá chìa', value: `**${formatCoins(KEY_PRICE)}** mỗi chìa` },
        { name: 'Tỉ lệ rơi', value: odds });
    if (notice) embed.setFooter({ text: notice });
    const catalogButtons = [
        button('contents', weaponCase.id, 'Vật phẩm trong hòm'),
        button('inventory', weaponCase.id, 'Kho đồ')
    ];
    if (page > 0) catalogButtons.push(button('case', cases[(page - 1) * CASES_PER_PAGE].id, 'Danh sách trước'));
    if (page + 1 < pages) catalogButtons.push(button('case', cases[(page + 1) * CASES_PER_PAGE].id, 'Danh sách sau'));
    if (marketName) catalogButtons.push(button('case-price', weaponCase.id, PRICE_BUTTON));
    return {
        content: null, embeds: [embed], attachments: [],
        components: rows([select], [
            button('buy', weaponCase.id, price ? `Mua hòm · ${formatCoins(price)}` : 'Mua hòm',
                { argument: price ? `${priceVnd}_${PRICE_VERSION}` : undefined, disabled: !price || balance < price }),
            button('key', weaponCase.id, `Mua chìa · ${formatCoins(KEY_PRICE)}`,
                { argument: `${KEY_PRICE_AMOUNT}_${PRICE_VERSION}`, disabled: balance < KEY_PRICE }),
            button('bulk', weaponCase.id, 'Mua nhiều', { argument: priceVnd, disabled: balance < KEY_PRICE && (!price || balance < price) }),
            button('buy-set', weaponCase.id, 'Mua theo bộ', { disabled: SET_SIZES.every(quantity => available >= quantity) })
        ], [
            button('open', weaponCase.id, 'Mở hòm', { style: ButtonStyle.Primary, disabled: available < 1 }),
            button(AUDIO_ACTION, weaponCase.id, 'Mở có tiếng', { disabled: available < 1 }),
            ...batchButtons(weaponCase, available)
        ], catalogButtons, [
            button(CUSTOM_BATCH_ACTION, weaponCase.id, 'Mở tùy chọn', { disabled: available < 1 }),
            button('market', weaponCase.id, 'Chợ skin', { argument: 0, style: ButtonStyle.Primary }),
            button('battle-new', weaponCase.id, '⚔️ Battle', { style: ButtonStyle.Primary }),
            button('upgrade', weaponCase.id, 'Upgrade', { style: ButtonStyle.Primary }),
            ...(marketName ? [marketButton(offer.quote)] : [])
        ])
    };
}

function contentsView(weaponCase, requestedPage) {
    const special = weaponCase.pools[4];
    const pages = 1 + Math.ceil(special.length / ITEMS_PER_PAGE);
    const page = Math.min(requestedPage, pages - 1);
    const embed = new EmbedBuilder().setTitle(`Vật phẩm · ${weaponCase.name}`).setThumbnail(weaponCase.image).setColor('#5865f2');
    if (page === 0) {
        embed.addFields(weaponCase.pools.slice(0, 4).map((pool, tier) => ({
            name: `${tiers[tier].icon} ${tiers[tier].name}`,
            value: pool.map(id => skinName(skins[id])).join('\n')
        })));
        if (special.length) embed.addFields({ name: '⭐ Rare Special Item', value: `${special.length} mẫu. Bấm **Trang sau** để xem.` });
    } else {
        const start = (page - 1) * ITEMS_PER_PAGE;
        embed.setDescription(special.slice(start, start + ITEMS_PER_PAGE).map(id => `⭐ ${skinName(skins[id])}`).join('\n'));
    }
    embed.setFooter({ text: `Trang ${page + 1}/${pages}` });
    return { content: null, embeds: [embed], attachments: [], components: rows([
        button('case', weaponCase.id, 'Về hòm'),
        ...(pages > 1 ? pageButtons('contents', weaponCase.id, page, pages) : [])
    ]) };
}

function sortMenu(customId, order) {
    return new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder(`Sắp xếp: ${SORT_ORDERS[normalizeSort(order)]}`)
        .addOptions(Object.entries(SORT_ORDERS).map(([value, label]) => ({ value, label, default: value === normalizeSort(order) })));
}

function likelyWearImages(skinId) {
    const skin = skins[skinId];
    if (skin.min == null || skin.max == null) return [skin.image];
    if (skin.min === skin.max) return [resultImage({ skinId }, skin, wearIndex(skin.min))];
    const chances = new Map();
    for (let index = 0; index < wearNames.length; index++) {
        const range = Math.min(skin.max, wearBounds[index + 1]) - Math.max(skin.min, wearBounds[index]);
        if (range <= 0) continue;
        const image = resultImage({ skinId }, skin, index);
        chances.set(image, (chances.get(image) ?? 0) + range);
    }
    return [...chances].sort((left, right) => right[1] - left[1]).slice(0, 2).map(([image]) => image);
}

function warmCase(weaponCase, canOpen) {
    const pool = weaponCase.pools[0];
    const bySkin = canOpen ? pool.map(likelyWearImages) : [];
    const prizeUrls = [...bySkin.map(([first]) => first), ...bySkin.map(([, second]) => second)].filter(Boolean);
    void reel.warmCaseReel(pool.map(id => skins[id].image), prizeUrls);
}

async function showCase(interaction, weaponCase, refresh = false) {
    const state = await readPlayer(interaction);
    const stash = state.skinCases?.[interaction.user.id];
    warmCase(weaponCase, availableOpenCount(weaponCase, stash) > 0);
    return editHomReply(interaction, caseView(weaponCase, getCoinBalance(state, interaction.user.id), stash,
        refresh ? snapshotPriceStatus() : undefined));
}

function purchaseForm(weaponCase, priceVnd) {
    const price = priceCoins(priceVnd);
    const suffix = `_${priceVnd ?? 0}_${KEY_PRICE_AMOUNT}_${PRICE_VERSION}`;
    const modal = new ModalBuilder().setCustomId(ORDER_PREFIX + weaponCase.id + suffix).setTitle(`Mua · ${weaponCase.name}`);
    const fields = [
        ['cases', price ? `Số hòm · ${formatCoins(price)}/cái` : 'Số hòm · Chưa có giá'],
        ['keys', `Số chìa · ${formatCoins(KEY_PRICE)}/cái`]
    ];
    for (const [id, label] of fields) {
        const input = new TextInputBuilder().setCustomId(id).setStyle(TextInputStyle.Short)
            .setRequired(false).setMaxLength(String(Number.MAX_SAFE_INTEGER).length)
            .setPlaceholder('Để trống nếu không mua');
        if (typeof modal.addLabelComponents === 'function' && LabelBuilder) {
            modal.addLabelComponents(new LabelBuilder().setLabel(label).setTextInputComponent(input));
        } else {
            modal.addComponents(new ActionRowBuilder().addComponents(input.setLabel(label)));
        }
    }
    return modal;
}

function purchaseQuantity(input) {
    const text = input?.trim() ?? '';
    if (!text) return 0;
    const quantity = Number(text);
    return /^\d+$/.test(text) && Number.isSafeInteger(quantity) ? quantity : null;
}

function openQuantity(input) {
    const quantity = purchaseQuantity(input);
    return quantity > 0 ? quantity : null;
}

function openForm(weaponCase, available) {
    const modal = new ModalBuilder().setCustomId(CUSTOM_BATCH_PREFIX + weaponCase.id).setTitle('Mở hòm tùy chọn');
    const label = `Số hòm (1–${MAX_OPEN_COUNT}) · Có thể mở ${Math.min(available, MAX_OPEN_COUNT)}`;
    const input = new TextInputBuilder().setCustomId('quantity').setStyle(TextInputStyle.Short)
        .setRequired(true).setMaxLength(String(MAX_OPEN_COUNT).length).setPlaceholder(`Nhập từ 1 đến ${MAX_OPEN_COUNT}`);
    if (typeof modal.addLabelComponents === 'function' && LabelBuilder) {
        modal.addLabelComponents(new LabelBuilder().setLabel(label).setTextInputComponent(input));
    } else {
        modal.addComponents(new ActionRowBuilder().addComponents(input.setLabel(label)));
    }
    return modal;
}

async function showBuySet(interaction, weaponCase) {
    const state = await readPlayer(interaction);
    const stash = state.skinCases?.[interaction.user.id];
    const balance = getCoinBalance(state, interaction.user.id);
    const name = getCaseMarketHashName(weaponCase.id);
    const caseQuote = market.peekMarketQuote(name);
    const unitPrice = priceCoins(caseQuote?.priceVnd);
    const options = SET_SIZES.map(quantity => {
        const missing = missingSet(weaponCase, stash, quantity);
        const price = missing.cases && !unitPrice ? null : (unitPrice ?? 0n) * BigInt(missing.cases) + KEY_PRICE * BigInt(missing.keys);
        return { quantity, missing, price };
    });
    const embed = new EmbedBuilder().setTitle(`Mua theo bộ · ${weaponCase.name}`).setThumbnail(weaponCase.image).setColor('#5865f2')
        .setDescription(`Ví **${formatCoins(balance)}**\nChọn mức mở để mua đúng số hòm và chìa còn thiếu.`)
        .addFields(options.map(({ quantity, missing, price }) => ({ name: `Đủ mở ${quantity} hòm`, value:
            price === 0n ? 'Đã đủ hòm và chìa.' : `${missing.cases} hòm · ${missing.keys} chìa\n${price === null ? 'Đang thiếu giá hòm.' : `Tổng **${formatCoins(price)}**`}` })));
    return editHomReply(interaction, { content: null, embeds: [embed], attachments: [], components: rows(
        options.map(({ quantity, missing, price }) => button('confirm-set', weaponCase.id, `Xác nhận mua bộ ${quantity}`, {
            argument: `${quantity}_${missing.cases}_${missing.keys}_${caseQuote?.priceVnd ?? 0}_${KEY_PRICE_AMOUNT}_${PRICE_VERSION}`,
            disabled: !price || price > balance, style: ButtonStyle.Primary
        })), [button('case', weaponCase.id, 'Về hòm')]) });
}

async function buy(interaction, weaponCase, caseQuantity, keyQuantity, expectedPriceVnd, expectedKeyPrice, setQuantity) {
    const { guild, user } = interaction;
    const marketName = getCaseMarketHashName(weaponCase.id);
    const offer = caseQuantity ? market.peekMarketDisplay(marketName) : null;
    const keyPriceChanged = keyQuantity > 0 && expectedKeyPrice !== KEY_PRICE_AMOUNT;
    const priceIssue = keyPriceChanged ? 'Giá chìa đã đổi. Xem giá mới rồi mua lại.'
        : offer && casePriceIssue(offer, expectedPriceVnd, 'hòm');
    if (priceIssue) {
        const state = await readPlayer(interaction);
        return editHomReply(interaction, caseView(weaponCase, getCoinBalance(state, user.id), state.skinCases?.[user.id], priceIssue));
    }
    const price = (priceCoins(offer?.quote?.priceVnd) ?? 0n) * BigInt(caseQuantity) + KEY_PRICE * BigInt(keyQuantity);
    let stockLimit = false;
    let checkoutPriceIssue;
    const { balance, reward } = await purchaseWithCoins(guild, user.id, price, state => {
        if (caseQuantity) {
            checkoutPriceIssue = casePriceIssue(market.peekMarketDisplay(marketName), expectedPriceVnd, 'hòm');
            if (checkoutPriceIssue) return null;
        }
        const stash = getStash(state, user.id);
        if (setQuantity) {
            const missing = missingSet(weaponCase, stash, setQuantity);
            if (missing.cases !== caseQuantity || missing.keys !== keyQuantity) {
                checkoutPriceIssue = 'Số hòm hoặc chìa đã thay đổi. Mở lại Mua theo bộ để xem số lượng mới.';
                return null;
            }
        }
        const caseCount = (stash.cases?.[weaponCase.id] ?? 0) + caseQuantity;
        const keyCount = (stash.keys?.[weaponCase.key] ?? 0) + keyQuantity;
        if (!Number.isSafeInteger(caseCount) || !Number.isSafeInteger(keyCount)) {
            stockLimit = true;
            return null;
        }
        if (!remember(stash, interaction.id)) return null;
        if (caseQuantity) (stash.cases ??= {})[weaponCase.id] = caseCount;
        if (keyQuantity) (stash.keys ??= {})[weaponCase.key] = keyCount;
        return stash;
    }, playerScope(user.id));
    const stash = reward ?? (await readPlayer(interaction)).skinCases?.[user.id];
    let notice = 'Giao dịch đã được xử lý.';
    if (reward) {
        const quantities = [];
        if (caseQuantity) quantities.push(`${caseQuantity} hòm`);
        if (keyQuantity) quantities.push(`${keyQuantity} chìa`);
        notice = `Đã mua ${quantities.join(' và ')} · Tổng ${formatCoins(price)}`;
    } else if (checkoutPriceIssue) {
        notice = checkoutPriceIssue;
    } else if (balance < price) {
        notice = `Cần ${formatCoins(price)}. Điểm danh bằng /tiembanh daily.`;
    } else if (stockLimit) {
        notice = 'Số lượng vượt giới hạn kho. Hãy nhập ít hơn.';
    }
    if (reward && stash.cases?.[weaponCase.id] > 0 && stash.keys?.[weaponCase.key] > 0) warmCase(weaponCase, true);
    return editHomReply(interaction, caseView(weaponCase, balance, stash, notice));
}

function reelRound(weaponCase, drop) {
    const skin = skins[drop.skinId];
    const tier = dropRarity(drop);
    const exterior = drop.float == null ? null : wearIndex(drop.float);
    const detail = exterior == null ? tier.name : `${tier.name} · ${wearNames[exterior]} · Float ${drop.float.toFixed(6)}`;
    // Store only a cosmetic seed. Drop selection continues to use crypto.randomInt.
    let state = drop.reelSeed;
    const randomInt = Number.isInteger(state) ? max => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return Math.floor(state / 0x100000000 * max);
    } : crypto.randomInt;
    const showGold = weaponCase.goldTickets === BATTLE_TICKETS;
    const previews = weaponCase.entries ? weaponCase.entries.map(entry => entry.drop)
        .filter(item => showGold || item.tier !== RARE_SPECIAL_TIER)
        : Array.from({ length: 12 }, () => drawSkin(weaponCase, randomInt, previewWeight));
    const mystery = rareReelArt.cases[weaponCase.id] ?? rareReelArt.cases[drop.caseId] ?? rareReelArt.default;
    const toCard = item => item.tier === RARE_SPECIAL_TIER && !showGold
        ? { mystery, color: dropRarity(item).color }
        : { image: weaponCase.entries ? dropImage(item) : skins[item.skinId].image,
            color: dropRarity(item).color };
    // Limit artwork fetches per reel while rotating the visible selection with each roll's seed.
    const options = showGold ? previews.filter(item => item.skinId !== drop.skinId) : previews;
    const available = options.length ? options : previews;
    const offset = weaponCase.entries ? randomInt(available.length) : 0;
    const filler = Array.from({ length: Math.min(available.length, weaponCase.entries ? 9 : 12) }, (_, index) =>
        toCard(available[(offset + index) % available.length]));
    const cards = Array.from({ length: WINNING_CARD + 4 }, () => filler[randomInt(filler.length)]);
    cards[WINNING_CARD] = toCard(drop);
    const image = resultImage(drop, skin, exterior);
    const result = { image, title: dropName(drop), detail, color: tier.color, tier: drop.tier };
    if (image !== skin.image && !getBlueGemReference(drop)) result.fallbackImage = skin.image;
    return { cards, selectedIndex: WINNING_CARD, result, landingSeed: drop.reelSeed };
}

function renderReel(weaponCase, drop, withSound, attachmentSizeLimit) {
    const custom = customCasesById.get(drop.battleCaseId);
    const current = custom && casePricing(custom);
    const reelCase = current ? { ...custom, entries: current.entries } : custom ?? weaponCase;
    const { cards, selectedIndex, result, landingSeed } = reelRound(reelCase, drop);
    return reel.renderCaseReel(cards, selectedIndex, result, withSound, landingSeed, attachmentSizeLimit);
}

async function waitForOpeningSound(readyVoice, media) {
    let timer;
    try {
        await Promise.race([
            Promise.all([readyVoice, media.audioReady]),
            new Promise(resolve => { timer = setTimeout(resolve, VOICE_START_GRACE_MS); })
        ]);
    } finally {
        clearTimeout(timer);
    }
}

function trackOpening(task) {
    activeOpenings.add(task);
    const finished = () => activeOpenings.delete(task);
    void task.then(finished, finished);
    return task;
}

function fitsOpeningAttachment(interaction, file) {
    const limit = interaction.attachmentSizeLimit;
    return file?.length > 0 && (!Number.isSafeInteger(limit) || file.length <= limit);
}

async function publishOpeningResult(interaction, payload, fallback = payload) {
    try {
        return await editHomReply(interaction, payload);
    } catch {
        return editHomReply(interaction, fallback);
    }
}

async function reveal(interaction, weaponCase, outcome, { withSound, inventory }) {
    const { drop, balance, canOpenAgain } = outcome;
    const battleCase = customCasesById.get(drop.battleCaseId);
    const goldOnly = battleCase?.goldTickets === BATTLE_TICKETS;
    let voice;
    let readyVoice = withSound
        ? caseVoice.prepareCaseVoice(interaction.member).then(session => { voice = session; return session; }, () => null)
        : null;
    let playing = false;
    let animated = false;
    const pattern = getBlueGemReference(drop);
    const verifiedArt = pattern && getBlueGemArt(drop)?.buffer;
    let art = fitsOpeningAttachment(interaction, verifiedArt) ? verifiedArt : undefined;
    try {
        const media = await renderReel(weaponCase, drop, withSound, interaction.attachmentSizeLimit);
        if (fitsOpeningAttachment(interaction, media?.gif)) {
            if (readyVoice && (!voice || !media.audio)) await waitForOpeningSound(readyVoice, media);
            const embed = new EmbedBuilder().setTitle(`Mở hòm · ${battleCase?.name ?? weaponCase.name}`)
                .setColor('#5865f2').setFooter({ text: `Ví còn ${formatCoins(balance)}` })
                .setImage(`attachment://${REEL_FILE}`);
            if (!goldOnly) embed.setThumbnail(weaponCase.image);
            await editHomReply(interaction, {
                content: null, embeds: [embed], attachments: [],
                components: [],
                files: [{ attachment: media.gif, name: REEL_FILE, description: 'Dải quay dừng trước khi hiện vật phẩm.' }]
            });
            animated = true;
            // Start voice at the GIF handoff so the reveal cue stays in sync.
            if (voice && media.audio) playing = voice.start(media.audio);
            if (readyVoice && !playing) {
                void readyVoice.then(session => session?.rest());
                readyVoice = null;
                void interaction.followUp({ content: 'Âm thanh chưa sẵn sàng trong phòng thoại.', flags: MessageFlags.Ephemeral })
                    .catch(() => {});
            }
            if (canOpenAgain) warmCase(weaponCase, true);
            const skin = skins[drop.skinId];
            const exterior = drop.float == null ? null : wearIndex(drop.float);
            let preparedArt;
            if (!pattern) {
                void reel.renderResultArtwork(resultImage(drop, skin, exterior)).then(image => {
                    preparedArt = image;
                }, () => {});
            }
            // Let the GIF show its last frame before replacing it with the static result.
            await delay(drop.tier === RARE_SPECIAL_TIER && !goldOnly ? reel.RARE_REEL_PLAYBACK_MS : reel.REEL_PLAYBACK_MS);
            if (fitsOpeningAttachment(interaction, preparedArt)) art = preparedArt;
        }
    } catch {
        // The roll is already in inventory. Show the result if the animation cannot be sent.
    } finally {
        if (readyVoice && !playing) void readyVoice.then(voice => voice?.close());
    }
    const options = { withSound, inventory, notice: animated ? undefined : 'Dải quay chưa tải được · Món đã lưu vào kho' };
    const fallback = resultView(weaponCase, outcome, options);
    return publishOpeningResult(interaction, art ? resultView(weaponCase, outcome, { ...options, art }) : fallback, fallback);
}

function batchResultView(weaponCase, { balance, available, drops }, animated) {
    const title = `Kết quả ${drops.length} hòm · ${weaponCase.name}`;
    const visibleDrops = drops.slice(0, MESSAGE_EMBED_LIMIT);
    const description = `Đã lưu **${drops.length} món** vào kho · Ví còn **${formatCoins(balance)}**` +
        (drops.length > visibleDrops.length ? `\nĐang hiện ${visibleDrops.length}/${drops.length} món đầu. Mở **Kho đồ** để xem toàn bộ.` : '') +
        (animated || !ANIMATED_BATCH_SIZES.has(drops.length) ? '' : '\nDải quay tạm thời không tải được.');
    const entries = visibleDrops.map((drop, index) => {
        const skin = skins[drop.skinId];
        const tier = dropRarity(drop);
        const exterior = drop.float == null ? null : wearIndex(drop.float);
        const wear = exterior == null ? '' : ` · ${wearNames[exterior]} · ${drop.float.toFixed(6)}`;
        const collection = dropCollection(drop);
        const seed = exterior == null ? '' : ` · Seed ${paintSeedText(drop)}`;
        const pattern = patternLabel(drop.skinId, drop.paintSeed);
        const ref = market.getDropMarketQuoteRef(drop);
        const display = displayMarketPrice(ref);
        const price = display.quote ? `${display.status === 'estimate' ? 'Giá đã lưu · ' : ''}**${formatCoins(saleCoins(display.quote))}**`
            : missingPrice(display.status, ref);
        return new EmbedBuilder().setTitle(`${index + 1}. ${dropName(drop)}`).setColor(tier.color)
            .setThumbnail(resultImage(drop, skin, exterior))
            .setDescription([`${tier.icon} ${tier.name}${wear}${seed}`, collection, pattern, price].filter(Boolean).join('\n'));
    });
    const select = new StringSelectMenuBuilder().setCustomId(`${PREFIX}select`).setPlaceholder('Chọn món để xem chi tiết hoặc bán')
        .addOptions(visibleDrops.map((drop, index) => ({ label: `${index + 1}. ${dropName(drop)}`.slice(0, 100).toWellFormed(), value: `drop_${drop.id}` })));
    const showSummaryEmbed = entries.length < MESSAGE_EMBED_LIMIT;
    if (showSummaryEmbed) entries.unshift(new EmbedBuilder().setTitle(title).setColor('#5865f2')
        .setThumbnail(weaponCase.image).setDescription(description));
    return {
        content: showSummaryEmbed ? null : `**${title}**\n${description}`,
        embeds: entries, attachments: [], components: rows([select], [
            button('open', weaponCase.id, 'Mở lẻ', { disabled: available < 1 }),
            ...batchButtons(weaponCase, available),
            button(CUSTOM_BATCH_ACTION, weaponCase.id, 'Mở tùy chọn', { disabled: available < 1 })
        ], [button('case', weaponCase.id, 'Về hòm'), button('inventory', weaponCase.id, 'Kho đồ')])
    };
}

async function revealBatch(interaction, weaponCase, outcome, title) {
    const { drops, available } = outcome;
    let animated = false;
    if (!ANIMATED_BATCH_SIZES.has(drops.length)) {
        return publishOpeningResult(interaction, batchResultView(weaponCase, outcome, animated));
    }
    try {
        const media = await reel.renderCaseBatch(drops.map(drop => reelRound(weaponCase, drop)), interaction.attachmentSizeLimit);
        if (fitsOpeningAttachment(interaction, media?.gif)) {
            const embed = new EmbedBuilder().setTitle(title).setColor('#5865f2').setImage(`attachment://${BATCH_REEL_FILE}`);
            await editHomReply(interaction, { content: null, embeds: [embed], attachments: [], components: [],
                files: [{ attachment: media.gif, name: BATCH_REEL_FILE, description: `${drops.length} dải quay đồng loạt.` }] });
            animated = true;
            if (available > 0) warmCase(weaponCase, true);
            await delay(drops.some(drop => drop.tier === RARE_SPECIAL_TIER) ? reel.RARE_REEL_PLAYBACK_MS : reel.REEL_PLAYBACK_MS);
        }
    } catch {
        // The drops are already saved. Publish the result even if the GIF could not be uploaded.
    }
    return publishOpeningResult(interaction, batchResultView(weaponCase, outcome, animated));
}

async function open(interaction, weaponCase, withSound, quantity = 1) {
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
        return respond(interaction, 'Số lượng mở phải là số nguyên dương hợp lệ.');
    }
    if (quantity > MAX_OPEN_COUNT) {
        return respond(interaction, `Discord chỉ mở tối đa ${MAX_OPEN_COUNT} hòm mỗi lượt.`);
    }
    const { guild, user } = interaction;
    const title = `${quantity === 1 ? 'Mở hòm' : `Mở ${quantity} hòm`} · ${weaponCase.name}`;
    const loading = new EmbedBuilder().setTitle(title).setColor('#5865f2').setThumbnail(weaponCase.image)
        .setDescription(quantity === 1 ? 'Đang chuẩn bị dải quay…' : ANIMATED_BATCH_SIZES.has(quantity)
            ? `Đang chuẩn bị ${quantity} dải quay…` : `Đang mở ${quantity} hòm và lưu vật phẩm vào kho…`);
    await interaction.update({ content: null, embeds: [loading], attachments: [], components: [] });
    const result = await transactPlayer(interaction, async (state, save) => {
        const stash = state.skinCases?.[user.id];
        const balance = getCoinBalance(state, user.id);
        const available = availableOpenCount(weaponCase, stash);
        if (available < quantity) {
            const notice = quantity === 1 ? 'Cần một hòm và chìa phù hợp để mở.'
                : `Cần ${quantity} hòm và ${quantity} chìa phù hợp để mở cùng lúc.`;
            return { stash, balance, notice };
        }
        if (!canFitCaseOpening(quantity, stash?.drops?.length ?? 0)) return { stash, balance, notice: CAPACITY_NOTICE };
        if (!remember(stash, interaction.id)) return { stash, balance, notice: 'Lượt mở đã được xử lý.' };
        const acquiredAt = Date.now();
        const drops = [];
        for (let index = 0; index < quantity; index++) {
            drops.push(rollDrop(weaponCase, quantity === 1 ? interaction.id : `${interaction.id}-${index + 1}`, acquiredAt));
            // Let other users' interactions progress while a large owned stack is rolled.
            if ((index + 1) % 500 === 0 && index + 1 < quantity) await new Promise(resolve => setImmediate(resolve));
        }
        stash.cases[weaponCase.id] -= quantity;
        stash.keys[weaponCase.key] -= quantity;
        stash.drops = (stash.drops ?? []).concat(drops);
        await save();
        return { drops, balance, available: available - quantity };
    }).catch(error => {
        console.error('Lỗi lưu lượt mở hòm:', error.message);
        return null;
    });
    if (!result) {
        loading.setDescription('Chưa thể lưu lượt mở. Về hòm để thử lại.');
        return editHomReply(interaction, {
            embeds: [loading], components: rows([button('case', weaponCase.id, 'Về hòm')])
        });
    }
    if (result.drops) {
        if (quantity > 1) return revealBatch(interaction, weaponCase, result, title);
        return reveal(interaction, weaponCase, { drop: result.drops[0], balance: result.balance, canOpenAgain: result.available > 0 }, { withSound });
    }
    return editHomReply(interaction, caseView(weaponCase, result.balance, result.stash, result.notice));
}

const tradeUpGroupKey = ({ tier, statTrak }) => `${tier}:${Number(statTrak)}`;

const marketViewAction = mine => mine ? 'market-mine' : 'market';

const userKey = interaction => `${interaction.guild.id}/${interaction.user.id}`;

const inventory = createInventory({
    KEY_PRICE_AMOUNT, PRICE_VERSION, AUDIO_ACTION, ITEMS_PER_PAGE, PRICE_SOURCE, PRICE_BUTTON, RESULT_FILE,
    INVENTORY_SELECT_PREFIX, INVENTORY_SORT_PREFIX,
    addDropDetails, availableOpenCount, button, displayMarketPrice, distinctQuoteRefs, dropCollection, dropName, dropRarity,
    editHomReply, marketButton, marketViewAction, missingPrice, pageButtons, paintSeedText, peekQuote,
    playerScope, priceCoins, quoteAge, quoteRefKey, readPlayer, resultImage, rows, saleCoins,
    snapshotPriceStatus, sortMenu, tiers, tradeUpGroupKey, transactPlayer, updatePanelAfter, userKey
});
const { inventoryEntries, showInventory, inventoryLocation, dropLocation, resultView, dropOutcome, showDrop,
    sellDrop, quoteSaleItems, quoteDrops, showBulkSale, showSellAll, bulkSaleAction, setDropLocks, lockSelected } = inventory;
const tradeUpUi = createTradeUp({ PREFIX, tiers, button, dropName, editHomReply, getStash, paintSeedFor,
    peekQuote, priceCoins, readPlayer, rows, sortMenu, tradeUpGroupKey, transactPlayer, userKey, inventory });
const { groupSelectPrefix: TRADE_UP_GROUP_SELECT, itemSelectPrefix: TRADE_UP_ITEM_SELECT,
    sortSelectPrefix: TRADE_UP_SORT_SELECT, start: startTradeUp, select: selectTradeUp, action: tradeUpAction,
    stages: tradeUpStages, notice: tradeUpNotice, expired: tradeUpExpired } = tradeUpUi;
const marketUi = createMarket({ PLAYER_MARKET_FILTER, PLAYER_MARKET_PRICE, PLAYER_MARKET_SELECT,
    addDropDetails, button, dropName, dropRarity, editHomReply, marketViewAction, pageButtons, resultImage, rows, tiers, userKey, inventory });
const { marketPriceForm, marketFilterForm, showPlayerMarket, marketPage, selectPlayerListing, settlePlayerListing,
    applyPlayerMarketFilter, publishPlayerListing, getPanel: marketPanel, updatePanel: updateMarketPanel } = marketUi;
const battleUi = createBattle({ rollDrop, reelRound, dropName, dropImage, readPlayer, button, editHomReply, inventory });
const upgradeUi = createUpgrade({ button, rows, readPlayer, editHomReply, dropName, userKey });

async function handleUpgrade(interaction) {
    const key = userKey(interaction);
    if (busyUsers.has(key)) return respond(interaction, '⏳ Đang xử lý hòm. Chờ kết quả rồi thử lại nhé.');
    pendingPanels.delete(key);
    busyUsers.set(key, interaction);
    try { return await trackOpening(upgradeUi.handle(interaction)); }
    finally { releaseUser(interaction); }
}

const dropActions = new Set(['result', 'inspect', 'sell', 'confirm-sale', 'lock-drop', 'unlock-drop']);
const bulkSaleActions = new Set(['confirm-bulk-sale', 'cancel-bulk-sale']);
const marketActions = ['market', 'market-mine', 'market-list', 'market-buy', 'market-cancel', 'market-filter', 'market-clear-filter'];
// Retired containers stay available for inventory and skin trading only.
const caseActions = new Set(['case', 'case-price', 'contents', 'buy', 'key', 'bulk', 'buy-set', 'confirm-set', 'open', AUDIO_ACTION, BATCH_ACTION, CUSTOM_BATCH_ACTION]);
const actions = new Set(['inventory', 'inventory-price', 'sell-all', ...caseActions,
    'lock-selected', 'unlock-selected', 'upgrade', 'tradeup', 'tradeup-next', ...Object.keys(tradeUpStages), ...dropActions, ...bulkSaleActions, ...marketActions]);

module.exports = {
    data: new SlashCommandBuilder().setName('hom').setDescription('Mở hòm CS2, xem kho đồ và mua bán skin bằng xu'),

    waitForOpenings({ finishBattles = false } = {}) {
        if (finishBattles) battleUi.finishAnimations();
        return Promise.allSettled(activeOpenings);
    },

    restoreBattleResults: battleUi.restoreResults,

    async execute(interaction) {
        const busy = userKey(interaction);
        if (busyUsers.has(busy)) return respond(interaction, '⏳ Đang xử lý hòm. Chờ kết quả rồi thử lại nhé.');
        pendingPanels.delete(busy);
        busyUsers.set(busy, interaction);
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            return await showCase(interaction, defaultCase);
        } finally {
            releaseUser(interaction);
        }
    },

    async select(interaction) {
        if (interaction.customId?.startsWith(BATTLE_PREFIX)) return battleUi.handle(interaction);
        if (interaction.customId?.startsWith(UPGRADE_PREFIX)) return handleUpgrade(interaction);
        const busy = userKey(interaction);
        if (busyUsers.has(busy)) return respond(interaction, '⏳ Đang xử lý hòm. Chờ kết quả rồi thử lại nhé.');
        pendingPanels.delete(busy);
        busyUsers.set(busy, interaction);
        try {
            if (interaction.customId?.startsWith(PLAYER_MARKET_SELECT)) return await selectPlayerListing(interaction);
            if (interaction.customId?.startsWith(INVENTORY_SORT_PREFIX)) {
                const weaponCase = byId.get(interaction.customId.slice(INVENTORY_SORT_PREFIX.length));
                const order = interaction.values[0];
                if (!weaponCase || interaction.values.length !== 1 || !Object.hasOwn(SORT_ORDERS, order)) {
                    return respond(interaction, 'Mở kho và chọn lại cách sắp xếp.');
                }
                await interaction.deferUpdate();
                const stash = await transactPlayer(interaction, async (state, save) => {
                    const current = getStash(state, interaction.user.id);
                    current.inventorySort = order;
                    await save();
                    return current;
                });
                return await showInventory(interaction, weaponCase, stash, 0);
            }
            const tradeUpPrefix = [TRADE_UP_GROUP_SELECT, TRADE_UP_ITEM_SELECT, TRADE_UP_SORT_SELECT]
                .find(prefix => interaction.customId?.startsWith(prefix));
            if (tradeUpPrefix) return await selectTradeUp(interaction, tradeUpPrefix);
            const selection = interaction.values[0];
            if (selection?.startsWith('drop_')) {
                const selected = [...new Set(interaction.values)];
                if (selected.length > ITEMS_PER_PAGE || selected.some(value => !value.startsWith('drop_'))) {
                    return respond(interaction, 'Chọn lại các vật phẩm trên trang kho hiện tại.');
                }
                await interaction.deferUpdate();
                const state = await readPlayer(interaction);
                const stash = state.skinCases?.[interaction.user.id];
                const owned = new Map(stash?.drops?.map(item => [item.id, item]));
                const drops = selected.map(value => owned.get(value.slice('drop_'.length)));
                const [originCaseId, pageText] = interaction.customId?.startsWith(INVENTORY_SELECT_PREFIX)
                    ? interaction.customId.slice(INVENTORY_SELECT_PREFIX.length).split('_') : [];
                const location = inventoryLocation(`${originCaseId}:${pageText}`);
                if (drops.length > 1) {
                    const weaponCase = byId.get(location?.caseId) ?? defaultCase;
                    if (drops.some(drop => !drop)) {
                        return interaction.followUp({ content: 'Một món đã rời kho. Hãy chọn lại.', flags: MessageFlags.Ephemeral });
                    }
                    return await showBulkSale(interaction, weaponCase, location?.page ?? 0, quoteDrops(drops));
                }
                const [drop] = drops;
                const weaponCase = drop && byId.get(drop.caseId);
                if (!weaponCase) {
                    return interaction.followUp({ content: 'Món này không còn trong kho của bạn.', flags: MessageFlags.Ephemeral });
                }
                const inventory = location ?? dropLocation(weaponCase, stash, drop);
                const { marketReturn } = marketPanel(interaction);
                return await showDrop(interaction, weaponCase, dropOutcome(state, interaction.user.id, weaponCase, drop), {
                    inventory, marketReturn: marketReturn?.dropId === drop.id ? marketReturn : undefined
                });
            }
            const weaponCase = byId.get(selection);
            if (!weaponCase || sourceOnly(weaponCase)) return respond(interaction, 'Bảng hòm đã cũ. Dùng /hom để mở lại.');
            await interaction.deferUpdate();
            return await showCase(interaction, weaponCase);
        } finally {
            releaseUser(interaction);
        }
    },

    async button(interaction) {
        if (interaction.customId.startsWith(BATTLE_PREFIX)) return trackOpening(battleUi.handle(interaction));
        if (interaction.customId.startsWith(UPGRADE_PREFIX)) return handleUpgrade(interaction);
        const parts = interaction.customId.slice(PREFIX.length).split('_');
        const [action, caseId, argument, mode, saleVersion, saleAudio] = parts;
        const weaponCase = byId.get(caseId);
        if (!weaponCase || !actions.has(action) || (sourceOnly(weaponCase) && caseActions.has(action))) {
            return respond(interaction, 'Bảng hòm đã cũ. Dùng /hom để mở lại.');
        }
        const busy = userKey(interaction);
        if (busyUsers.has(busy)) return respond(interaction, '⏳ Đang xử lý hòm. Chờ kết quả rồi thử lại nhé.');
        if (action === AUDIO_ACTION) {
            const error = caseVoice.caseVoiceError(interaction.member);
            if (error) return respond(interaction, error);
        }
        if (action === 'bulk') return interaction.showModal(purchaseForm(weaponCase, shownPrice(argument)));
        if (action === CUSTOM_BATCH_ACTION) {
            const state = await readPlayer(interaction);
            const available = availableOpenCount(weaponCase, state.skinCases?.[interaction.user.id]);
            if (available < 1) return respond(interaction, 'Cần một hòm và chìa phù hợp để mở.');
            return interaction.showModal(openForm(weaponCase, available));
        }
        if (action === 'market-list') {
            if (!argument) return respond(interaction, 'Mở kho và chọn lại skin để đăng bán.');
            const state = await readPlayer(interaction);
            const drop = state.skinCases?.[interaction.user.id]?.drops?.find(item => item.id === argument);
            if (!drop || drop.locked) return respond(interaction, drop?.locked ? 'Món này đang khóa. Mở khóa trước khi đăng bán.' : 'Món này không còn trong kho.');
            return interaction.showModal(marketPriceForm(weaponCase, argument));
        }
        if (action === 'market-filter') return interaction.showModal(marketFilterForm(weaponCase, argument === 'mine', marketPanel(interaction).filters));
        pendingPanels.delete(busy);
        busyUsers.set(busy, interaction);
        try {
            if (action === 'open' || action === AUDIO_ACTION) return await trackOpening(open(interaction, weaponCase, action === AUDIO_ACTION));
            if (action === BATCH_ACTION) {
                const quantity = openQuantity(argument);
                if (!quantity) return respond(interaction, 'Số lượng mở phải là số nguyên dương hợp lệ.');
                return await trackOpening(open(interaction, weaponCase, false, quantity));
            }
            await interaction.deferUpdate();
            if (action === 'upgrade') return await upgradeUi.start(interaction, weaponCase.id);
            if (action === 'buy') return await buy(interaction, weaponCase, 1, 0, confirmedPrice(argument, mode));
            if (action === 'key') return await buy(interaction, weaponCase, 0, 1, null, confirmedPrice(argument, mode));
            if (action === 'buy-set') return await showBuySet(interaction, weaponCase);
            if (action === 'confirm-set') {
                const quantity = SET_SIZES.find(size => String(size) === argument);
                const counts = [mode, saleVersion];
                const version = parts[7];
                if (!quantity || version !== PRICE_VERSION || counts.some(count => !/^(0|[1-9]\d*)$/.test(count ?? '') || Number(count) > quantity) ||
                    counts.every(count => count === '0')) return await showBuySet(interaction, weaponCase);
                return await buy(interaction, weaponCase, Number(mode), Number(saleVersion),
                    confirmedPrice(saleAudio, version), confirmedPrice(parts[6], version), quantity);
            }
            if (action === 'case' || action === 'case-price') return await showCase(interaction, weaponCase, action === 'case-price');
            if (bulkSaleActions.has(action)) return await bulkSaleAction(interaction, weaponCase, argument, action === 'confirm-bulk-sale');
            if (action === 'lock-selected' || action === 'unlock-selected') return await lockSelected(interaction, weaponCase, argument, action === 'lock-selected');
            if (Object.hasOwn(tradeUpStages, action)) return await tradeUpAction(interaction, action, weaponCase, argument, mode, saleVersion);
            if (action === 'market' || action === 'market-mine') {
                return await showPlayerMarket(interaction, weaponCase, marketPage(argument), action === 'market-mine');
            }
            if (action === 'market-clear-filter') {
                updateMarketPanel(interaction, { filters: undefined });
                return await showPlayerMarket(interaction, weaponCase, 0, argument === 'mine');
            }
            if (action === 'market-buy' || action === 'market-cancel') {
                return await settlePlayerListing(interaction, weaponCase, argument, marketPage(mode), saleVersion === 'mine', action === 'market-buy');
            }
            const page = Math.max(0, Number.parseInt(argument, 10) || 0);
            if (action === 'contents') return await editHomReply(interaction, contentsView(weaponCase, page));
            const state = await readPlayer(interaction);
            const stash = state.skinCases?.[interaction.user.id];
            if (action === 'tradeup') return await startTradeUp(interaction, weaponCase, page, stash);
            if (action === 'tradeup-next') {
                if (!/^[0-3]:[01]$/.test(mode ?? '')) return tradeUpNotice(interaction, tradeUpExpired);
                return await startTradeUp(interaction, weaponCase, page, stash, mode);
            }
            if (action === 'inventory' && tradeUpUi.cancelForMessage(interaction)) {
                return await showInventory(interaction, weaponCase, stash, page);
            }
            if (action === 'sell-all') {
                const offers = quoteSaleItems(inventoryEntries(stash));
                return await showSellAll(interaction, weaponCase, page, offers);
            }
            if (dropActions.has(action)) {
                const drop = stash?.drops?.find(item => item.id === argument &&
                    (item.caseId === caseId || caseId === defaultCase.id && sourceOnly(byId.get(item.caseId))));
                if (!drop) {
                    return interaction.followUp({ content: 'Không tìm thấy kết quả trong kho của bạn.', flags: MessageFlags.Ephemeral });
                }
                const sourceCase = byId.get(drop.caseId);
                const outcome = dropOutcome(state, interaction.user.id, sourceCase, drop);
                const inventory = inventoryLocation(parts.at(-1)) ??
                    (action === 'inspect' || sourceOnly(sourceCase) ? dropLocation(sourceCase, stash, drop) : undefined);
                if (action === 'lock-drop' || action === 'unlock-drop') {
                    const locked = action === 'lock-drop';
                    const result = await setDropLocks(interaction, [drop.id], locked);
                    const updated = result.stash?.drops?.find(item => item.id === drop.id);
                    if (!updated) return interaction.followUp({ content: 'Món này không còn trong kho.', flags: MessageFlags.Ephemeral });
                    return await showDrop(interaction, sourceCase, { ...outcome, drop: updated },
                        { inventory: inventory ?? dropLocation(sourceCase, result.stash, updated) });
                }
                if (action === 'confirm-sale') {
                    const withSound = (saleVersion === PRICE_VERSION ? saleAudio : saleVersion) === 'audio';
                    return await sellDrop(interaction, sourceCase, outcome, withSound, confirmedPrice(mode, saleVersion), inventory);
                }
                const withSound = mode === 'audio';
                const { marketReturn } = marketPanel(interaction);
                return await showDrop(interaction, sourceCase, outcome, { withSound, inventory, selling: action === 'sell',
                    marketReturn: marketReturn?.dropId === drop.id ? marketReturn : undefined });
            }
            return await showInventory(interaction, weaponCase, stash, page, { showNextSync: action === 'inventory-price' });
        } finally {
            releaseUser(interaction);
        }
    },

    async modal(interaction) {
        if (interaction.customId.startsWith(BATTLE_PREFIX)) return battleUi.handle(interaction);
        if (interaction.customId.startsWith(UPGRADE_PREFIX)) return handleUpgrade(interaction);
        const busy = userKey(interaction);
        if (busyUsers.has(busy)) return respond(interaction, '⏳ Đang xử lý hòm. Chờ kết quả rồi thử lại nhé.');
        if (interaction.customId.startsWith(CUSTOM_BATCH_PREFIX)) {
            const weaponCase = byId.get(interaction.customId.slice(CUSTOM_BATCH_PREFIX.length));
            if (!weaponCase || sourceOnly(weaponCase)) return respond(interaction, 'Bảng hòm đã cũ. Dùng /hom để mở lại.');
            const quantity = openQuantity(interaction.fields.fields.get('quantity')?.value);
            if (!quantity) return respond(interaction, 'Số lượng mở phải là số nguyên dương hợp lệ.');
            pendingPanels.delete(busy);
            busyUsers.set(busy, interaction);
            try {
                return await trackOpening(open(interaction, weaponCase, false, quantity));
            } finally {
                releaseUser(interaction);
            }
        }
        if (interaction.customId.startsWith(PLAYER_MARKET_PRICE) || interaction.customId.startsWith(PLAYER_MARKET_FILTER)) {
            pendingPanels.delete(busy);
            busyUsers.set(busy, interaction);
            try {
                return interaction.customId.startsWith(PLAYER_MARKET_FILTER)
                    ? await applyPlayerMarketFilter(interaction) : await publishPlayerListing(interaction);
            } finally {
                releaseUser(interaction);
            }
        }
        if (!interaction.customId.startsWith(ORDER_PREFIX)) return respond(interaction, 'Bảng hòm đã cũ. Dùng /hom để mở lại.');
        const [caseId, price, keyPrice, version] = interaction.customId.slice(ORDER_PREFIX.length).split('_');
        const weaponCase = byId.get(caseId);
        if (!weaponCase || sourceOnly(weaponCase)) return respond(interaction, 'Bảng hòm đã cũ. Dùng /hom để mở lại.');
        const caseQuantity = purchaseQuantity(interaction.fields.fields.get('cases')?.value);
        const keyQuantity = purchaseQuantity(interaction.fields.fields.get('keys')?.value);
        if (caseQuantity === null || keyQuantity === null || (!caseQuantity && !keyQuantity)) {
            return respond(interaction, 'Số lượng phải là số nguyên từ 0 trở lên. Hãy nhập ít nhất 1 hòm hoặc 1 chìa.');
        }
        pendingPanels.delete(busy);
        busyUsers.set(busy, interaction);
        try {
            await interaction.deferUpdate();
            return await buy(interaction, weaponCase, caseQuantity, keyQuantity, confirmedPrice(price, version), confirmedPrice(keyPrice, version));
        } finally {
            releaseUser(interaction);
        }
    }
};
