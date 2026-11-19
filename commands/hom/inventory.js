const crypto = require('node:crypto');
const { ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, StringSelectMenuBuilder } = require('discord.js');
const { containersById: byId, keys, skins } = require('../../utils/cs2Catalogue');
const { TICKETS: BATTLE_TICKETS, customCasesById } = require('../../utils/cs2BattleCases');
const { getCaseMarketHashName, wearIndex, wearNames } = require('../../utils/cs2MarketNames');
const { sortDrops } = require('../../utils/cs2InventoryOrder');
const { getBlueGemArt, getBlueGemReference } = require('../../utils/cs2BlueGemArt');
const inventoryArt = require('../../utils/cs2InventoryArt');
const market = require('../../utils/cs2Market');
const reel = require('../../utils/cs2Reel');
const { getCoinBalance, formatCoins, sellForCoins } = require('../taixiu');

const INVENTORY_GRID_ITEMS = 6;
const INVENTORY_FILE = 'cs2-inventory.png';
const BULK_SALE_TTL_MS = 5 * 60_000;
const BULK_SALE_LIMIT = 128;
const legacySkins = {
    'glock-signal': 'Glock-18 | Tín Hiệu', 'mp9-haze': 'MP9 | Sương Xám', 'famas-midnight': 'FAMAS | Ca Đêm',
    'galil-sand': 'Galil AR | Gió Cát', 'usp-electric': 'USP-S | Xung Điện', 'mac10-orbit': 'MAC-10 | Quỹ Đạo',
    'ssg-aurora': 'SSG 08 | Cực Quang', 'deagle-embers': 'Desert Eagle | Tàn Lửa', 'm4a4-ocean': 'M4A4 | Sóng Ngầm',
    'awp-nebula': 'AWP | Tinh Vân', 'ak47-redstorm': 'AK-47 | Bão Đỏ', 'm4a1s-plasma': 'M4A1-S | Lõi Plasma',
    'karambit-amber': 'Karambit | Hổ Phách', 'butterfly-starlight': 'Butterfly Knife | Ánh Sao'
};

function createInventory({
    KEY_PRICE_AMOUNT,
    PRICE_VERSION,
    AUDIO_ACTION,
    ITEMS_PER_PAGE,
    PRICE_SOURCE,
    PRICE_BUTTON,
    RESULT_FILE,
    INVENTORY_SELECT_PREFIX,
    INVENTORY_SORT_PREFIX,
    addDropDetails,
    availableOpenCount,
    button,
    displayMarketPrice,
    distinctQuoteRefs,
    dropCollection,
    dropName,
    dropRarity,
    editHomReply,
    marketButton,
    marketViewAction,
    missingPrice,
    pageButtons,
    paintSeedText,
    peekQuote,
    playerScope,
    priceCoins,
    quoteAge,
    quoteRefKey,
    readPlayer,
    resultImage,
    rows,
    saleCoins,
    snapshotPriceStatus,
    sortMenu,
    tiers,
    tradeUpGroupKey,
    transactPlayer,
    updatePanelAfter,
    userKey
}) {
    const pendingBulkSales = new Map();

    function inventoryDrops(stash) {
        return sortDrops(stash?.drops ?? [], stash?.inventorySort, inventoryDropPrice);
    }

    function inventoryDropPrice(drop) {
        const quote = displayMarketPrice(market.getDropMarketQuoteRef(drop)).quote;
        return Number.isSafeInteger(quote?.priceVnd) && quote.priceVnd > 0 ? BigInt(quote.priceVnd) : null;
    }

    function inventoryDropLabel(drop) {
        const details = drop.float == null ? '' : ` · ${wearNames[wearIndex(drop.float)]} · ${drop.float.toFixed(6)}`;
        const source = dropCollection(drop) ?? byId.get(drop.caseId)?.name;
        const seed = drop.paintSeed == null ? '' : ` · Seed ${paintSeedText(drop)}`;
        return `${drop.locked ? '🔒 ' : ''}${dropRarity(drop).icon} **${dropName(drop)}**${source ? ` · ${source}` : ''}${details}${seed}`;
    }

    function inventoryEntries(stash) {
        const ownedCases = Object.entries(stash?.cases ?? {}).filter(([, count]) => count > 0)
            .map(([id, count]) => {
                const container = byId.get(id);
                const icon = container?.kind === 'terminal' ? '💻' : '📦';
                const name = getCaseMarketHashName(id);
                return { label: `${icon} ${container?.name ?? id} · ×${count}`, stock: 'cases', id, count, marketRef: name ? { name } : null };
            });
        const ownedKeys = Object.entries(stash?.keys ?? {}).filter(([, count]) => count > 0)
            .map(([id, count]) => ({ label: `🔑 ${keys[id]?.name ?? id} · ×${count}`, stock: 'keys', id, count,
                fixedPrice: Object.hasOwn(keys, id) ? KEY_PRICE_AMOUNT : null }));
        const collected = inventoryDrops(stash).map(drop => ({ count: 1, drop, marketRef: market.getDropMarketQuoteRef(drop) }));
        const legacy = Object.entries(stash?.items ?? {}).filter(([, count]) => count > 0)
            .map(([id, count]) => ({ label: `🎒 ${legacySkins[id] ?? id} · ×${count}`, count }));
        return [...collected, ...ownedCases, ...ownedKeys, ...legacy];
    }

    function inventoryView(weaponCase, entries, page, pages, notice, priceStatus, sortOrder) {
        let knownCount = 0n;
        let itemCount = 0n;
        let total = 0n;
        let hasEstimate = false;
        const start = page * ITEMS_PER_PAGE;
        const visible = [];
        const displayByRef = new Map();
        for (const [index, entry] of entries.entries()) {
            const key = quoteRefKey(entry.marketRef);
            if (!entry.fixedPrice && !displayByRef.has(key)) {
                displayByRef.set(key, displayMarketPrice(entry.marketRef));
            }
            const display = entry.fixedPrice ? { status: 'fixed' } : displayByRef.get(key);
            const price = entry.fixedPrice ?? display.quote?.priceVnd ?? null;
            const quantity = BigInt(entry.count);
            itemCount += quantity;
            if (price !== null) {
                knownCount += quantity;
                total += BigInt(price) * quantity;
                if (display.status === 'estimate') hasEstimate = true;
            }
            if (index >= start && index < start + ITEMS_PER_PAGE) visible.push({ ...entry, price, display });
        }
        const lines = visible.map(({ label, drop, price, count, display, marketRef }) => {
            const info = display.status === 'estimate' ? ['Giá đã lưu', quoteAge(display.quote)].filter(Boolean).join(' · ') : '';
            const value = price === null ? missingPrice(display.status, marketRef)
                : `**${formatCoins(priceCoins(price))}**${count > 1 ? '/món' : ''}${info ? ` · ${info}` : ''}`;
            return `${drop ? inventoryDropLabel(drop) : label}\n↳ ${value}`;
        });
        const coverage = knownCount < itemCount ? `\nĐã có giá ${knownCount}/${itemCount} món` : '';
        const totalText = knownCount > 0n || itemCount === 0n
            ? `**${formatCoins(priceCoins(total) ?? 0n)}**` : 'Chưa lấy được giá';
        const keyPriceNote = entries.some(entry => entry.fixedPrice) ? '\nChìa theo giá bot' : '';
        const embed = new EmbedBuilder().setTitle('Kho đồ của bạn').setColor('#5865f2')
            .setDescription(lines.join('\n') || 'Kho đồ đang trống.')
            .addFields({ name: knownCount < itemCount || hasEstimate ? 'Tổng giá trị tạm tính' : 'Tổng giá trị kho',
                value: `${totalText}${coverage}${hasEstimate ? '\nGồm giá đã lưu' : ''}${keyPriceNote}` })
            .setFooter({ text: [notice, priceStatus, entries.some(entry => entry.marketRef?.paintSeed != null) ? 'Blue Gem: CSFloat theo seed' : null,
                `Trang ${page + 1}/${pages}`].filter(Boolean).join(' · ') });
        const pageDrops = visible.filter(entry => entry.drop);
        const select = pageDrops.length ? new StringSelectMenuBuilder().setCustomId(`${INVENTORY_SELECT_PREFIX}${weaponCase.id}_${page}`)
            .setPlaceholder(pageDrops.length === 1 ? 'Chọn súng để xem lại hoặc khóa' : 'Chọn một để xem · Chọn nhiều để bán hoặc khóa')
            .setMaxValues(pageDrops.length)
            .addOptions(pageDrops.map(({ drop, price, display }, index) => {
                const value = price == null ? 'Chưa có giá' : formatCoins(priceCoins(price), { exact: true });
                const priceLabel = display.status === 'estimate' ? `${value} (giá đã lưu)` : value;
                const wear = drop.float == null ? dropRarity(drop).name : `${wearNames[wearIndex(drop.float)]} · ${drop.float.toFixed(6)}`;
                const source = dropCollection(drop) ?? byId.get(drop.caseId)?.name;
                const seed = drop.paintSeed == null ? undefined : `Seed ${paintSeedText(drop)}`;
                return {
                    label: `${drop.locked ? '🔒 ' : ''}${index + 1}. ${dropName(drop)}`.slice(0, 100), value: `drop_${drop.id}`,
                    description: [priceLabel, wear, source, seed].filter(Boolean).join(' · ').slice(0, 100).toWellFormed()
                };
            })) : null;
        const payload = { content: null, embeds: [embed], attachments: [], components: rows(
            [sortMenu(`${INVENTORY_SORT_PREFIX}${weaponCase.id}`, sortOrder)], ...(select ? [[select]] : []), [
            button('case', weaponCase.id, 'Về hòm'),
            ...(entries.some(entry => entry.marketRef) ? [button('inventory-price', weaponCase.id, PRICE_BUTTON, { argument: page })] : []),
            ...(entries.some(entry => entry.marketRef || entry.fixedPrice) ? [
                button('sell-all', weaponCase.id, 'Bán hết kho', { argument: page, style: ButtonStyle.Danger })
            ] : []),
            ...(pages > 1 ? pageButtons('inventory', weaponCase.id, page, pages) : [])
        ], [
            button('tradeup', weaponCase.id, 'Trade Up', { argument: page, style: ButtonStyle.Primary }),
            button('upgrade', weaponCase.id, 'Upgrade', { style: ButtonStyle.Primary }),
            button('market', weaponCase.id, 'Chợ skin', { argument: 0 })
        ]) };
        return { payload, visible, lines };
    }

    async function inventoryImages(limit, { payload, visible, lines }) {
        if (!Number.isSafeInteger(limit) || limit <= 0) return null;
        const cards = visible.filter(entry => entry.drop).flatMap(({ drop, price, display, marketRef }, index) => {
            if (!Object.hasOwn(skins, drop.skinId)) return [];
            const skin = skins[drop.skinId];
            const exterior = drop.float == null ? null : wearIndex(drop.float);
            return [{
                number: index + 1, name: dropName(drop), ...(drop.locked ? { locked: true } : {}),
                image: resultImage(drop, skin, exterior), fallback: getBlueGemReference(drop)?.sourceUrl ?? skin.image,
                color: dropRarity(drop).color,
                detail: exterior == null ? dropRarity(drop).name : `${wearNames[exterior]} · Float ${drop.float.toFixed(6)}` +
                    (drop.paintSeed == null ? '' : ` · Seed ${paintSeedText(drop)}`),
                collection: dropCollection(drop) ?? byId.get(drop.caseId)?.name,
                hasPrice: price !== null,
                price: price === null ? missingPrice(display.status, marketRef)
                    : `${formatCoins(priceCoins(price))}${display.status === 'estimate' ? ' · Giá đã lưu' : ''}`
            }];
        });
        const groups = [];
        for (let index = 0; index < cards.length; index += INVENTORY_GRID_ITEMS) {
            groups.push(cards.slice(index, index + INVENTORY_GRID_ITEMS));
        }
        const grids = await Promise.allSettled(groups.map(group => inventoryArt.renderInventoryGrid(group, Math.min(limit, 5_000_000))));
        const files = [];
        const images = [];
        const pictured = new Set();
        for (const [index, result] of grids.entries()) {
            if (result.status !== 'fulfilled' || !result.value) continue;
            const grid = result.value;
            const group = groups[index];
            const name = index === 0 ? INVENTORY_FILE : `cs2-inventory-${index + 1}.png`;
            const description = group.map(card => `${card.number}. ${card.name}`).join('\n').slice(0, 1024).toWellFormed();
            files.push({ attachment: grid.png, name, description });
            if (groups.length > 1) images.push(new EmbedBuilder().setImage(`attachment://${name}`));
            if (grid.hasLabels) for (const card of group) pictured.add(card.number);
        }
        if (!files.length) return null;
        let dropNumber = 0;
        const otherItems = lines.filter((_, index) => !visible[index].drop || !pictured.has(++dropNumber));
        const embed = EmbedBuilder.from(payload.embeds[0])
            .setDescription(otherItems.join('\n') || 'Chọn món bên dưới để xem chi tiết hoặc bán.');
        return { ...payload, embeds: [embed, ...images], files };
    }

    async function showInventory(interaction, weaponCase, stash, requestedPage, { notice, showNextSync = false } = {}) {
        const entries = inventoryEntries(stash);
        const pages = Math.max(1, Math.ceil(entries.length / ITEMS_PER_PAGE));
        const page = Math.min(requestedPage, pages - 1);
        const view = inventoryView(weaponCase, entries, page, pages, notice, showNextSync ? snapshotPriceStatus() : undefined, stash?.inventorySort);
        const canAttach = Number.isSafeInteger(interaction.attachmentSizeLimit) && interaction.attachmentSizeLimit > 0;
        if (!canAttach || !view.visible.some(entry => entry.drop)) return editHomReply(interaction, view.payload);
        return updatePanelAfter(interaction, view.payload, () => inventoryImages(interaction.attachmentSizeLimit, view), () => view.payload);
    }

    function dropActionId(dropId, withSound, inventory) {
        const location = inventory ? `_${inventoryOrigin(inventory.caseId)}:${inventory.page}` : '';
        return `${dropId}${withSound ? '_audio' : ''}${location}`;
    }

    const inventoryOrigin = caseId => byId.get(caseId)?.key ? caseId : 'crate-4904';

    function dropButton(action, caseId, label, options = {}) {
        const origin = byId.get(caseId)?.kind === 'collection' ? inventoryOrigin(caseId) : caseId;
        let argument = options.argument;
        // Collection names and UUID upgrade IDs can otherwise exceed Discord's
        // 100-character component limit. The optional return-page context can
        // be recovered from the owned drop when it does not fit.
        if (typeof argument === 'string' && `mg_hom_${action}_${origin}_${argument}`.length > 100) {
            argument = argument.replace(/_[^_]+:\d+$/, '');
        }
        return button(action, origin, label, { ...options, argument });
    }

    function inventoryLocation(value) {
        const [caseId, pageText] = value?.split(':') ?? [];
        const page = Number(pageText);
        return byId.has(caseId) && /^\d+$/.test(pageText ?? '') && Number.isSafeInteger(page) ? { caseId, page } : undefined;
    }

    function dropLocation(weaponCase, stash, drop) {
        const index = inventoryDrops(stash).findIndex(item => item.id === drop.id);
        return { caseId: inventoryOrigin(weaponCase.id), page: Math.floor(Math.max(0, index) / ITEMS_PER_PAGE) };
    }

    function resultControls(weaponCase, canOpenAgain, { dropId, withSound, inventory, tradeUp }) {
        const openAction = withSound ? AUDIO_ACTION : 'open';
        const resultId = dropActionId(dropId, withSound, inventory);
        if (inventory || tradeUp || weaponCase.kind === 'terminal' || weaponCase.kind === 'collection') return rows([
            button('inventory', inventory?.caseId ?? weaponCase.id, 'Về kho', { argument: inventory?.page ?? 0 })
        ]);
        return rows([
            ...(canOpenAgain ? [button(openAction, weaponCase.id, 'Mở tiếp', { style: ButtonStyle.Primary })] : []),
            button('inspect', weaponCase.id, 'Xem súng trong kho', { argument: resultId }),
            button('case', weaponCase.id, 'Về hòm'),
            button('inventory', weaponCase.id, 'Kho đồ')
        ]);
    }

    function resultView(weaponCase, { drop, balance, canOpenAgain }, { withSound, notice, art, imageUrl, inventory, selling = false, marketReturn, quickTradeUp } = {}) {
        const skin = skins[drop.skinId];
        const tier = dropRarity(drop);
        const exterior = drop.float == null ? null : wearIndex(drop.float);
        const ref = market.getDropMarketQuoteRef(drop);
        const display = displayMarketPrice(ref);
        const quote = display.status === 'fresh' ? display.quote : null;
        const proceeds = saleCoins(quote);
        const image = imageUrl ?? resultImage(drop, skin, exterior);
        const battleCase = customCasesById.get(drop.battleCaseId);
        const embed = new EmbedBuilder().setTitle(dropName(drop)).setColor(tier.color)
            .setImage(art ? `attachment://${RESULT_FILE}` : image)
            .setDescription(`${drop.locked ? '🔒 **Đã khóa · Không thể bán hoặc Trade Up**\n' : ''}${tier.icon} **${tier.name}** · ${battleCase?.name ?? weaponCase.name}${drop.tradeUp ? ' · Trade Up' : ''}`)
            .setFooter({ text: `Đã lưu vào kho · Ví còn ${formatCoins(balance)}` });
        if (battleCase?.goldTickets !== BATTLE_TICKETS) embed.setThumbnail(weaponCase.image);
        const payload = { content: null, embeds: [embed], attachments: [],
            ...(art ? { files: [{ attachment: art, name: RESULT_FILE, description: dropName(drop) }] } : {}) };
        if (notice) embed.setFooter({ text: `${notice} · Ví còn ${formatCoins(balance)}` });
        addDropDetails(embed, drop);
        const controls = resultControls(weaponCase, canOpenAgain, { dropId: drop.id, withSound, inventory, tradeUp: drop.tradeUp });
        if (inventory || drop.tradeUp) controls[0].addComponents(new ButtonBuilder().setLabel('Mở ảnh gốc').setStyle(ButtonStyle.Link).setURL(image));
        if (quickTradeUp) controls[0].addComponents(button('tradeup-next', inventory.caseId, `Chọn ${quickTradeUp.required} skin tiếp`, {
            argument: `${inventory.page}_${tradeUpGroupKey(quickTradeUp)}`, style: ButtonStyle.Primary
        }));
        if (marketReturn) controls[0].addComponents(button(marketViewAction(marketReturn.mine), marketReturn.caseId, 'Về chợ', { argument: marketReturn.page }));
        const resultId = dropActionId(drop.id, withSound, inventory);
        if (ref) {
            const details = [quoteAge(display.quote), display.quote?.phase].filter(Boolean).join(' · ');
            const priceText = quote
                ? `Bán nhận **${formatCoins(proceeds)}**${details ? `\n${details}` : ''}`
                : display.quote
                    ? `Giá đã lưu **${formatCoins(saleCoins(display.quote))}**${details ? ` · ${details}` : ''}\nĐang chờ bảng giá mới để bán.`
                    : missingPrice(display.status, ref);
            embed.addFields({ name: ref.paintSeed != null ? `Giá CSFloat · Seed #${ref.paintSeed}` : `Giá ${PRICE_SOURCE}`, value: priceText });
            if (selling && proceeds > 0n && !drop.locked) {
                embed.setDescription(`Bán **${dropName(drop)}** khỏi kho để nhận **${formatCoins(proceeds)}**?`);
                const saleId = dropActionId(`${drop.id}_${quote.priceVnd}_${PRICE_VERSION}`, withSound, inventory);
                return { ...payload, components: rows([
                    dropButton('confirm-sale', weaponCase.id, 'Xác nhận bán', { argument: saleId, style: ButtonStyle.Danger }),
                    dropButton('result', weaponCase.id, 'Hủy', { argument: resultId }),
                    dropButton('lock-drop', weaponCase.id, '🔒 Khóa món', { argument: resultId }), marketButton(quote)
                ]) };
            }
            controls.push(...rows([
                dropButton('market-list', weaponCase.id, 'Đăng bán ở chợ', { argument: drop.id, style: ButtonStyle.Primary, disabled: drop.locked === true }),
                ...(proceeds > 0n ? [dropButton('sell', weaponCase.id, 'Bán lấy xu', { argument: resultId, disabled: drop.locked === true })] : []),
                ...(!quote ? [dropButton('result', weaponCase.id, PRICE_BUTTON, { argument: resultId })] : []),
                marketButton(display.quote ?? (ref.paintSeed != null ? { source: 'csfloat', url: market.CSFLOAT_MARKET_URL } : null))
            ]));
        } else {
            embed.addFields({ name: `Giá ${PRICE_SOURCE}`, value: 'Mẫu này chưa có mã giá thị trường tương ứng.' });
        }
        controls.push(...rows([dropButton(drop.locked ? 'unlock-drop' : 'lock-drop', weaponCase.id,
            drop.locked ? '🔓 Mở khóa món' : '🔒 Khóa món', { argument: resultId })]));
        return { ...payload, components: controls };
    }

    function dropOutcome(state, userId, weaponCase, drop) {
        const stash = state.skinCases?.[userId];
        const canOpenAgain = availableOpenCount(weaponCase, stash) > 0;
        return { drop, balance: getCoinBalance(state, userId), canOpenAgain };
    }

    async function showDrop(interaction, weaponCase, outcome, { withSound, selling, inventory, marketReturn } = {}) {
        const { drop } = outcome;
        const ref = market.getDropMarketQuoteRef(drop);
        const limit = interaction.attachmentSizeLimit;
        const canAttach = Number.isSafeInteger(limit) && limit > 0;
        const options = { withSound, selling, inventory, marketReturn };
        if (!selling && canAttach) {
            const initial = resultView(weaponCase, outcome, options);
            return updatePanelAfter(interaction, initial, async () => {
                const cachedQuote = displayMarketPrice(ref).quote;
                const artwork = await inspectDropArtwork(drop, limit);
                const quote = displayMarketPrice(ref).quote;
                if (!artwork.art && artwork.imageUrl === initial.embeds[0].data.image?.url &&
                    quote?.priceVnd === cachedQuote?.priceVnd && quote?.observedAt === cachedQuote?.observedAt) return null;
                return resultView(weaponCase, outcome, { ...options, ...artwork });
            }, () => resultView(weaponCase, outcome, { ...options,
                imageUrl: getBlueGemReference(drop)?.sourceUrl ?? skins[drop.skinId].image }));
        }
        return editHomReply(interaction, resultView(weaponCase, outcome, options));
    }

    async function inspectDropArtwork(drop, limit) {
        if (!Number.isSafeInteger(limit) || limit <= 0) return {};
        const skin = skins[drop.skinId];
        const exterior = drop.float == null ? null : wearIndex(drop.float);
        const preferred = resultImage(drop, skin, exterior);
        if (getBlueGemReference(drop)) {
            const art = getBlueGemArt(drop)?.buffer;
            return art?.length > 0 && art.length <= limit ? { art, imageUrl: preferred } : { imageUrl: preferred };
        }
        for (const imageUrl of new Set([preferred, skin.image])) {
            const art = await reel.cachedImage(imageUrl).catch(() => null);
            if (art?.length && art.length <= limit) return { art, imageUrl };
        }
        return { imageUrl: skin.image };
    }

    function offerPrice({ quote, fixedPrice }) {
        return fixedPrice ? priceCoins(fixedPrice) : saleCoins(quote);
    }

    function offerCount({ count = 1 }) {
        return BigInt(count);
    }

    function saleTotal(offers) {
        return offers.reduce((total, offer) => total + offerPrice(offer) * offerCount(offer), 0n);
    }

    async function settleSale(interaction, offers) {
        const { guild, user } = interaction;
        const proceeds = saleTotal(offers);
        const dropIds = offers.flatMap(({ drop }) => drop ? [drop.id] : []);
        const soldIds = new Set(dropIds);
        let expired = false;
        let changed = false;
        let locked = false;
        const { balance, reward } = await sellForCoins(guild, user.id, proceeds, state => {
            const now = Date.now();
            if (offers.some(({ quote }) => quote && quote.expiresAt <= now)) {
                expired = true;
                return null;
            }
            if (offers.some(({ marketRef, quote }) =>
                marketRef && peekQuote(marketRef)?.priceVnd !== quote?.priceVnd)) {
                changed = true;
                return null;
            }
            const stash = state.skinCases?.[user.id];
            if (!stash || soldIds.size !== dropIds.length) return null;
            const owned = new Map(stash?.drops?.map(item => [item.id, item]));
            if (dropIds.some(id => owned.get(id)?.locked === true)) {
                locked = true;
                return null;
            }
            if (offers.some(({ drop, marketRef, stock, id, count, fixedPrice }) => {
                if (drop) {
                    const item = owned.get(drop.id);
                    return item?.caseId !== drop.caseId || item.acquiredAt !== drop.acquiredAt ||
                        item.inventoryRevision !== drop.inventoryRevision ||
                        quoteRefKey(market.getDropMarketQuoteRef(item)) !== quoteRefKey(marketRef);
                }
                const ownedCount = Number(stash[stock]?.[id]);
                if (!Number.isSafeInteger(ownedCount) || ownedCount < Number(count)) return true;
                if (stock === 'keys') return !Object.hasOwn(keys, id) || fixedPrice !== KEY_PRICE_AMOUNT;
                return stock !== 'cases' || getCaseMarketHashName(id) !== marketRef?.name;
            })) return null;
            if (soldIds.size) {
                const remaining = stash.drops.filter(item => !soldIds.has(item.id));
                if (stash.drops.length - remaining.length !== soldIds.size) return null;
                stash.drops = remaining;
            }
            for (const { stock, id, count } of offers) {
                if (!stock) continue;
                const remaining = Number(stash[stock][id]) - Number(count);
                if (remaining) stash[stock][id] = remaining;
                else delete stash[stock][id];
            }
            return stash;
        }, playerScope(user.id));
        return { balance, stash: reward, expired, changed, locked, proceeds };
    }

    async function sellDrop(interaction, weaponCase, outcome, withSound, expectedPrice, inventory) {
        const { drop } = outcome;
        if (drop.locked) return editHomReply(interaction, resultView(weaponCase, outcome,
            { withSound, inventory, notice: 'Món này đang khóa. Mở khóa trước khi bán.' }));
        const marketRef = market.getDropMarketQuoteRef(drop);
        const quote = peekQuote(marketRef);
        const proceeds = saleCoins(quote);
        if (!proceeds || quote.priceVnd !== expectedPrice) {
            const notice = proceeds ? 'Giá đã đổi. Hãy kiểm tra lại trước khi bán.' : 'Chưa có giá thị trường để bán.';
            return editHomReply(interaction, resultView(weaponCase, outcome, { withSound, inventory, selling: proceeds > 0n, notice }));
        }
        const { balance, stash, expired, changed, locked } = await settleSale(interaction, [{ drop, marketRef, quote }]);
        if (locked) return interaction.followUp({ content: 'Món này vừa được khóa. Chưa bán món nào.', flags: MessageFlags.Ephemeral });
        if (changed) return editHomReply(interaction, resultView(weaponCase, { ...outcome, balance }, {
            withSound, inventory, selling: true, notice: 'Bảng giá vừa đổi. Hãy kiểm tra lại trước khi bán.'
        }));
        if (expired) {
            return editHomReply(interaction, resultView(weaponCase, { ...outcome, balance }, { withSound, inventory, notice: 'Giá đã hết hạn. Hãy cập nhật lại.' }));
        }
        if (!stash) return interaction.followUp({ content: 'Món này không còn trong kho của bạn.', flags: MessageFlags.Ephemeral });
        const receipt = `Đã bán ${dropName(drop)} · +${formatCoins(proceeds)} · Ví ${formatCoins(balance)}`;
        return showInventory(interaction, byId.get(inventory?.caseId) ?? weaponCase, stash, inventory?.page ?? 0, { notice: receipt });
    }

    const bulkSaleKey = interaction => `${userKey(interaction)}/${interaction.message?.id ?? ''}`;

    function quoteSaleItems(items) {
        const refs = distinctQuoteRefs(items);
        const quotes = new Map([...refs].map(([key, ref]) => [key, peekQuote(ref)]));
        return items.map(item => ({ ...item, quote: quotes.get(quoteRefKey(item.marketRef)) ?? null }));
    }

    function quoteDrops(drops) {
        return quoteSaleItems(drops.map(drop => ({ drop, marketRef: market.getDropMarketQuoteRef(drop) })));
    }

    function saleButtons(interaction, weaponCase, page, sale, label = 'Xác nhận bán') {
        const scope = bulkSaleKey(interaction);
        pendingBulkSales.delete(scope);
        if (!sale) return [button('inventory', weaponCase.id, 'Chọn lại', { argument: page })];
        const token = crypto.randomUUID();
        pendingBulkSales.set(scope, { ...sale, token, caseId: weaponCase.id, page, expiresAt: Date.now() + BULK_SALE_TTL_MS });
        if (pendingBulkSales.size > BULK_SALE_LIMIT) pendingBulkSales.delete(pendingBulkSales.keys().next().value);
        return [
            button('confirm-bulk-sale', weaponCase.id, label, { argument: token, style: ButtonStyle.Danger, disabled: sale.blocked === true }),
            button('cancel-bulk-sale', weaponCase.id, 'Hủy', { argument: token }),
            ...(sale.selectionOffers ? [
                button('lock-selected', weaponCase.id, '🔒 Khóa các món đã chọn', { argument: token,
                    disabled: sale.selectionOffers.every(({ drop }) => drop.locked === true) }),
                button('unlock-selected', weaponCase.id, '🔓 Mở khóa các món đã chọn', { argument: token,
                    disabled: sale.selectionOffers.every(({ drop }) => drop.locked !== true) })
            ] : [])
        ];
    }

    function showBulkSale(interaction, weaponCase, page, offers, notice) {
        const now = Date.now();
        const hasPrice = quote => saleCoins(quote) > 0n && quote.expiresAt > now;
        const lines = offers.map(({ drop, quote }) => {
            const wear = drop.float == null ? '' : ` (${wearNames[wearIndex(drop.float)]})`;
            const price = hasPrice(quote) ? `**${formatCoins(saleCoins(quote))}**` : 'Chưa có giá bán';
            return `• ${drop.locked ? '🔒 ' : ''}${dropName(drop)}${wear} · ${price}`;
        });
        const eligible = offers.filter(({ drop }) => drop.locked !== true);
        const lockedCount = offers.length - eligible.length;
        const available = eligible.length > 0 && eligible.every(({ quote }) => hasPrice(quote));
        const description = available ? `Tổng nhận **${formatCoins(saleTotal(eligible))}**` : 'Chọn các món chưa khóa và đã có giá để bán.';
        const embed = new EmbedBuilder().setTitle(`Bán ${eligible.length} món`).setColor('#5865f2')
            .setDescription(`${description}\n\n${lines.join('\n')}`);
        if (notice || lockedCount) embed.setFooter({ text: [notice, lockedCount ? `${lockedCount} món đang khóa sẽ ở lại kho.` : ''].filter(Boolean).join(' · ') });
        const controls = saleButtons(interaction, weaponCase, page,
            { offers: eligible, selectionOffers: offers, blocked: !available });
        return editHomReply(interaction, { content: null, embeds: [embed], attachments: [], components: rows(controls) });
    }

    function showSellAll(interaction, weaponCase, page, offers, { skipped = 0n, locked = 0n, notice } = {}) {
        const now = Date.now();
        const eligible = [];
        const counts = { drops: 0n, cases: 0n, keys: 0n };
        let pendingPrice = false;
        for (const offer of offers) {
            if (offer.drop?.locked === true) {
                locked += offerCount(offer);
            } else if (offer.fixedPrice || (offer.quote?.expiresAt > now && offerPrice(offer) > 0n)) {
                eligible.push(offer);
                counts[offer.stock ?? 'drops'] += offerCount(offer);
            } else {
                skipped += offerCount(offer);
                if (offer.marketRef) pendingPrice = true;
            }
        }
        const count = counts.drops + counts.cases + counts.keys;
        const totals = count ? `Tổng nhận **${formatCoins(saleTotal(eligible))}**\n**${counts.drops} súng · ${counts.cases} hòm · ${counts.keys} chìa**` : 'Chưa có món nào có giá hợp lệ để bán.';
        const omitted = (skipped ? `\n\n**${skipped} món chưa có giá hợp lệ** sẽ ở lại kho.` : '') +
            (locked ? `\n\n🔒 **${locked} món đang khóa** sẽ ở lại kho.` : '');
        const keysNote = counts.keys ? '\nChìa tính theo giá cố định trong bot.' : '';
        const embed = new EmbedBuilder().setTitle('Bán hết kho').setColor('#5865f2').setDescription(`${totals}${omitted}${keysNote}`);
        if (notice) embed.setFooter({ text: notice });
        const sale = count ? { offers: eligible, all: true, skipped, locked } : null;
        const controls = saleButtons(interaction, weaponCase, page, sale, skipped ? `Bán ${count} món có giá` : 'Xác nhận bán hết');
        if (pendingPrice) controls.push(button('sell-all', weaponCase.id, PRICE_BUTTON, { argument: page }));
        return editHomReply(interaction, { content: null, embeds: [embed], attachments: [], components: rows(controls) });
    }

    async function bulkSaleAction(interaction, weaponCase, token, confirm) {
        const scope = bulkSaleKey(interaction);
        const sale = pendingBulkSales.get(scope);
        if (!sale || sale.token !== token || sale.caseId !== weaponCase.id) {
            return interaction.followUp({ content: 'Lượt xác nhận này đã cũ. Mở kho đồ để chọn lại.', flags: MessageFlags.Ephemeral });
        }
        const returnToInventory = async notice => {
            const state = await readPlayer(interaction);
            return showInventory(interaction, weaponCase, state.skinCases?.[interaction.user.id], sale.page, { notice });
        };
        if (!confirm || sale.expiresAt <= Date.now()) {
            pendingBulkSales.delete(scope);
            return returnToInventory(confirm ? 'Lượt xác nhận đã hết hạn. Hãy chọn lại.' : undefined);
        }
        if (sale.blocked || !sale.offers.length) return returnToInventory('Chọn các món chưa khóa và đã có giá để bán.');

        const offers = quoteSaleItems(sale.offers);
        if (offers.some(offer => offer.marketRef && !offer.quote)) {
            return interaction.followUp({ content: `Bảng giá ${PRICE_SOURCE} chưa có giá hợp lệ cho một số món. Hãy mở lại bảng bán.`,
                flags: MessageFlags.Ephemeral });
        }
        if (offers.some((offer, index) => offerPrice(offer) !== offerPrice(sale.offers[index]))) {
            const notice = 'Giá đã thay đổi. Kiểm tra lại trước khi bán.';
            if (sale.all) return showSellAll(interaction, weaponCase, sale.page, offers, { skipped: sale.skipped, locked: sale.locked, notice });
            return showBulkSale(interaction, weaponCase, sale.page, offers, notice);
        }
        const { balance, stash, expired, changed, locked, proceeds } = await settleSale(interaction, offers);
        pendingBulkSales.delete(scope);
        if (expired) return returnToInventory('Giá đã hết hạn. Hãy chọn lại để lấy giá mới.');
        if (changed) return returnToInventory('Bảng giá vừa đổi. Hãy chọn lại trước khi bán.');
        if (locked) return returnToInventory('Một món vừa được khóa. Chưa bán món nào. Hãy chọn lại.');
        if (!stash) return returnToInventory('Kho đã thay đổi. Hãy kiểm tra và chọn lại.');
        const count = offers.reduce((total, offer) => total + offerCount(offer), 0n);
        const receipt = `Đã bán ${count} món · +${formatCoins(proceeds)} · Ví ${formatCoins(balance)}`;
        return showInventory(interaction, weaponCase, stash, sale.page, { notice: receipt });
    }

    async function setDropLocks(interaction, ids, locked) {
        return transactPlayer(interaction, async (state, save) => {
            const stash = state.skinCases?.[interaction.user.id];
            const owned = new Map(stash?.drops?.map(drop => [drop.id, drop]));
            if (!ids.length || ids.some(id => !owned.has(id))) return { stash, changed: false };
            for (const id of ids) {
                if (locked) owned.get(id).locked = true;
                else delete owned.get(id).locked;
            }
            await save();
            return { stash, changed: true };
        });
    }

    async function lockSelected(interaction, weaponCase, token, locked) {
        const scope = bulkSaleKey(interaction);
        const selection = pendingBulkSales.get(scope);
        if (!selection?.selectionOffers || selection.token !== token || selection.caseId !== weaponCase.id || selection.expiresAt <= Date.now()) {
            return interaction.followUp({ content: 'Lựa chọn đã cũ. Mở kho và chọn lại các món.', flags: MessageFlags.Ephemeral });
        }
        const ids = selection.selectionOffers.map(({ drop }) => drop.id);
        const { stash, changed } = await setDropLocks(interaction, ids, locked);
        pendingBulkSales.delete(scope);
        return showInventory(interaction, weaponCase, stash, selection.page, {
            notice: changed ? `Đã ${locked ? 'khóa' : 'mở khóa'} ${ids.length} món.` : 'Kho đã thay đổi. Chưa thay đổi khóa món nào.'
        });
    }

    return { inventoryEntries, showInventory, inventoryLocation, dropLocation, resultView, dropOutcome, showDrop, sellDrop, quoteSaleItems, quoteDrops, showBulkSale, showSellAll, bulkSaleAction, setDropLocks, lockSelected };
}

module.exports = { createInventory };
