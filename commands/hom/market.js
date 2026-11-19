const {
    ActionRowBuilder, ButtonStyle, EmbedBuilder, LabelBuilder, MessageFlags, ModalBuilder,
    StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, escapeMarkdown
} = require('discord.js');
const { containersById: byId, skins } = require('../../utils/cs2Catalogue');
const { getBlueGemArt } = require('../../utils/cs2BlueGemArt');
const { wearIndex, wearNames } = require('../../utils/cs2MarketNames');
const { formatCoinInput } = require('../../utils/coins');
const { respond } = require('../../utils/managementAccess');
const playerMarket = require('../../utils/cs2PlayerMarket');
const store = require('../../utils/managementStore');
const { getCoinBalance, formatCoins } = require('../taixiu');

const LISTINGS_PER_PAGE = 10;
const MARKET_FILTER_LIMIT = 128;
const MARKET_FILTER_TTL_MS = 15 * 60_000;
const MARKET_FILTER_NAME_LENGTH = 60;

function createMarket({
    PLAYER_MARKET_FILTER,
    PLAYER_MARKET_PRICE,
    PLAYER_MARKET_SELECT,
    addDropDetails,
    button,
    dropName,
    dropRarity,
    editHomReply,
    marketViewAction,
    pageButtons,
    resultImage,
    rows,
    tiers,
    userKey,
    inventory
}) {
    const marketPanels = new Map();
    const { dropLocation, resultView } = inventory;

    function marketPriceForm(weaponCase, dropId) {
        const modal = new ModalBuilder().setCustomId(`${PLAYER_MARKET_PRICE}${weaponCase.id}_${dropId}`).setTitle('Đăng bán ở chợ');
        const input = new TextInputBuilder().setCustomId('price').setStyle(TextInputStyle.Short)
            .setRequired(true).setMaxLength(playerMarket.PRICE_INPUT_LENGTH).setPlaceholder('Ví dụ: 1,500 hoặc 1,500.50');
        const label = 'Giá rao bằng xu';
        if (typeof modal.addLabelComponents === 'function' && LabelBuilder) {
            modal.addLabelComponents(new LabelBuilder().setLabel(label)
                .setDescription('Skin sẽ được giữ ở chợ cho đến khi có người mua hoặc bạn hủy tin.')
                .setTextInputComponent(input));
        } else {
            modal.addComponents(new ActionRowBuilder().addComponents(input.setLabel(label)));
        }
        return modal;
    }

    const marketPriceText = listing => formatCoins(BigInt(listing.price), { exact: true });

    const dropWear = drop => drop.float == null ? null : wearNames[wearIndex(drop.float)];

    function marketPanelKey(interaction) {
        return `${userKey(interaction)}/${interaction.message?.id ?? ''}`;
    }

    function marketPanel(interaction) {
        const key = marketPanelKey(interaction);
        const panel = marketPanels.get(key);
        if (panel?.expiresAt > Date.now()) return panel;
        marketPanels.delete(key);
        return {};
    }

    function updateMarketPanel(interaction, changes) {
        const key = marketPanelKey(interaction);
        const next = { ...marketPanel(interaction), ...changes, expiresAt: Date.now() + MARKET_FILTER_TTL_MS };
        marketPanels.delete(key);
        marketPanels.set(key, next);
        if (marketPanels.size > MARKET_FILTER_LIMIT) marketPanels.delete(marketPanels.keys().next().value);
    }

    function marketFilterForm(weaponCase, mine, filters = {}) {
        const modal = new ModalBuilder().setCustomId(PLAYER_MARKET_FILTER + weaponCase.id + (mine ? '_mine' : ''))
            .setTitle('Lọc chợ skin');
        const addInput = (id, label, placeholder, value, length) => {
            const input = new TextInputBuilder().setCustomId(id).setStyle(TextInputStyle.Short)
                .setRequired(false).setMaxLength(length).setPlaceholder(placeholder);
            if (value) input.setValue(value);
            modal.addLabelComponents(new LabelBuilder().setLabel(label).setTextInputComponent(input));
        };
        addInput('name', 'Tên vũ khí hoặc skin', 'Ví dụ: AK-47, Printstream', filters.name, MARKET_FILTER_NAME_LENGTH);
        const rarity = new StringSelectMenuBuilder().setCustomId('tier').setPlaceholder('Tất cả bậc')
            .addOptions([{ label: 'Tất cả bậc', value: 'all', default: filters.tier == null },
                ...tiers.map((tier, index) => ({ label: tier.name, value: String(index), default: index === filters.tier })),
                { label: 'Contraband', value: 'contraband', default: filters.tier === 'contraband' }]);
        modal.addLabelComponents(new LabelBuilder().setLabel('Bậc hiếm').setStringSelectMenuComponent(rarity));
        addInput('min', 'Giá tối thiểu (xu)', 'Ví dụ: 1,000', filters.min == null ? '' : formatCoinInput(filters.min), playerMarket.PRICE_INPUT_LENGTH);
        addInput('max', 'Giá tối đa (xu)', 'Ví dụ: 5,000.50', filters.max == null ? '' : formatCoinInput(filters.max), playerMarket.PRICE_INPUT_LENGTH);
        return modal;
    }

    const marketSearchText = text => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replaceAll('đ', 'd');

    function matchesMarketFilters(listing, filters) {
        if (!filters) return true;
        if (filters.tier != null) {
            const contraband = skins[listing.drop.skinId]?.rarity === 'Contraband';
            if (filters.tier === 'contraband' ? !contraband : contraband || listing.drop.tier !== filters.tier) return false;
        }
        if (filters.search && !marketSearchText(dropName(listing.drop)).includes(filters.search)) return false;
        if (filters.min == null && filters.max == null) return true;
        const price = BigInt(listing.price);
        return (filters.min == null || price >= filters.min) && (filters.max == null || price <= filters.max);
    }

    function marketFilterSummary(filters) {
        if (!filters) return '';
        return [filters.name ? `Tên: ${escapeMarkdown(filters.name)}` : '',
            filters.tier == null ? '' : filters.tier === 'contraband' ? 'Contraband' : tiers[filters.tier].name,
            filters.min == null ? '' : `Từ ${formatCoins(filters.min, { exact: true })}`,
            filters.max == null ? '' : `Đến ${formatCoins(filters.max, { exact: true })}`].filter(Boolean).join(' · ');
    }

    function playerMarketView(weaponCase, state, userId, requestedPage, mine, notice, filters) {
        const listings = playerMarket.getListings(state).filter(listing => (!mine || listing.sellerId === userId) && matchesMarketFilters(listing, filters));
        const pages = Math.max(1, Math.ceil(listings.length / LISTINGS_PER_PAGE));
        const page = Math.min(requestedPage, pages - 1);
        const visible = listings.slice(page * LISTINGS_PER_PAGE, (page + 1) * LISTINGS_PER_PAGE);
        const lines = visible.map(listing => {
            const { drop } = listing;
            return [`${dropRarity(drop).icon} **${dropName(drop)}**`, `**${marketPriceText(listing)}**`, dropWear(drop)].filter(Boolean).join(' · ');
        });
        const summary = marketFilterSummary(filters);
        const empty = summary ? 'Không có tin phù hợp với bộ lọc.' : mine
            ? 'Chọn một skin trong **Kho đồ**, rồi bấm **Đăng bán ở chợ**.' : 'Chưa có skin nào đang được rao trong máy chủ này.';
        const embed = new EmbedBuilder().setTitle(mine ? 'Tin bán của bạn' : 'Chợ skin').setColor('#5865f2')
            .setDescription(`Ví **${formatCoins(getCoinBalance(state, userId))}** · **${listings.length}** tin ${summary ? 'phù hợp' : 'đang rao'}` +
                (summary ? `\nBộ lọc · ${summary}` : '') + `\n\n${lines.join('\n') || empty}`)
            .setFooter({ text: [notice, `Trang ${page + 1}/${pages}`].filter(Boolean).join(' · ') });
        const select = visible.length ? new StringSelectMenuBuilder()
            .setCustomId(`${PLAYER_MARKET_SELECT}${weaponCase.id}_${page}${mine ? '_mine' : ''}`)
            .setPlaceholder('Chọn tin để xem chi tiết')
            .addOptions(visible.map(listing => ({
                label: dropName(listing.drop).slice(0, 100), value: listing.id,
                description: [marketPriceText(listing), dropWear(listing.drop), listing.sellerId === userId ? 'Tin của bạn' : ''].filter(Boolean).join(' · ')
            }))) : null;
        return {
            content: null, embeds: [embed], attachments: [], allowedMentions: { parse: [] },
            components: rows(...(select ? [[select]] : []), [
                button(marketViewAction(!mine), weaponCase.id, mine ? 'Tất cả tin' : 'Tin của tôi', { argument: 0 }),
                button('inventory', weaponCase.id, 'Kho đồ'),
                button('case', weaponCase.id, 'Về hòm'),
                ...(pages > 1 ? pageButtons(marketViewAction(mine), weaponCase.id, page, pages) : [])
            ], [
                button('market-filter', weaponCase.id, 'Lọc skin', { argument: mine ? 'mine' : 'all' }),
                ...(summary ? [button('market-clear-filter', weaponCase.id, 'Xóa bộ lọc', { argument: mine ? 'mine' : 'all' })] : [])
            ])
        };
    }

    function playerListingView(weaponCase, state, userId, listing, page, mine, notice) {
        const { drop, sellerId, id } = listing;
        const tier = dropRarity(drop);
        const wear = dropWear(drop);
        const source = byId.get(drop.caseId);
        const own = userId === sellerId;
        const embed = new EmbedBuilder().setTitle(dropName(drop)).setColor(tier.color)
            .setDescription(`${tier.icon} **${tier.name}** · ${source.name}`)
            .setImage(resultImage(drop, skins[drop.skinId], wear == null ? null : wearIndex(drop.float)))
            .addFields(
                { name: 'Giá rao', value: `**${marketPriceText(listing)}**`, inline: true },
                { name: 'Người bán', value: own ? 'Bạn' : `<@${sellerId}>`, inline: true }
            )
            .setFooter({ text: [notice, `Ví của bạn · ${formatCoins(getCoinBalance(state, userId))}`].filter(Boolean).join(' · ') });
        addDropDetails(embed, drop);
        const argument = `${id}_${page}${mine ? '_mine' : ''}`;
        return {
            content: null, embeds: [embed], attachments: [], allowedMentions: { parse: [] },
            components: rows([
                own ? button('market-cancel', weaponCase.id, 'Hủy tin và nhận lại skin', { argument, style: ButtonStyle.Danger })
                    : button('market-buy', weaponCase.id, `Mua · ${marketPriceText(listing)}`, { argument, style: ButtonStyle.Primary }),
                button(marketViewAction(mine), weaponCase.id, mine ? 'Về tin của tôi' : 'Về chợ', { argument: page })
            ])
        };
    }

    async function showPlayerMarket(interaction, weaponCase, page, mine, notice) {
        const state = await store.read(interaction.guild.id, { sections: ['cs2PlayerMarket'], wallets: [interaction.user.id] });
        return editHomReply(interaction, playerMarketView(weaponCase, state, interaction.user.id, page, mine, notice, marketPanel(interaction).filters));
    }

    async function editDropPanel(interaction, payload, drop) {
        const limit = interaction.attachmentSizeLimit;
        const art = Number.isSafeInteger(limit) && limit > 0 ? getBlueGemArt(drop) : null;
        if (art && art.buffer.length <= limit) {
            const embed = EmbedBuilder.from(payload.embeds[0]).setImage(art.url);
            try {
                return await editHomReply(interaction, { ...payload, embeds: [embed],
                    files: [{ attachment: art.buffer, name: art.name, description: dropName(drop) }] });
            } catch {
                // Retry the exact pattern source if the attachment cannot be sent.
            }
        }
        return editHomReply(interaction, payload);
    }

    async function showPlayerListing(interaction, weaponCase, listingId, page, mine, notice) {
        const state = await store.read(interaction.guild.id, { sections: ['cs2PlayerMarket'], wallets: [interaction.user.id] });
        const userId = interaction.user.id;
        const listing = playerMarket.getListing(state, listingId);
        if (!listing || (mine && listing.sellerId !== userId)) {
            return editHomReply(interaction, playerMarketView(weaponCase, state, userId, page, mine, 'Tin này đã rời chợ.', marketPanel(interaction).filters));
        }
        return editDropPanel(interaction, playerListingView(weaponCase, state, userId, listing, page, mine, notice), listing.drop);
    }

    const marketPage = input => Math.max(0, Number.parseInt(input, 10) || 0);

    async function selectPlayerListing(interaction) {
        const [caseId, page, scope] = interaction.customId.slice(PLAYER_MARKET_SELECT.length).split('_');
        const weaponCase = byId.get(caseId);
        if (!weaponCase || interaction.values.length !== 1) return respond(interaction, 'Hãy mở chợ và chọn lại tin bán.');
        await interaction.deferUpdate();
        return showPlayerListing(interaction, weaponCase, interaction.values[0], marketPage(page), scope === 'mine');
    }

    async function settlePlayerListing(interaction, weaponCase, listingId, page, mine, buying) {
        const { guild, user } = interaction;
        const result = buying ? await playerMarket.buySkin(guild, user.id, listingId)
            : await playerMarket.cancelListing(guild.id, user.id, listingId);
        if (result.status === 'bought') {
            const { drop, stash } = result;
            const marketReturn = { caseId: weaponCase.id, page, mine, dropId: drop.id };
            const inventory = dropLocation(weaponCase, stash, drop);
            updateMarketPanel(interaction, { marketReturn });
            return editDropPanel(interaction, resultView(byId.get(drop.caseId), { drop, balance: result.balance }, {
                inventory, marketReturn,
                notice: `Đã mua với ${marketPriceText(result.listing)}`
            }), drop);
        }
        if (result.status === 'cancelled') {
            return showPlayerMarket(interaction, weaponCase, page, true, 'Đã hủy tin và trả skin về kho.');
        }
        if (result.status === 'insufficient-funds') {
            return showPlayerListing(interaction, weaponCase, listingId, page, mine, 'Ví của bạn chưa đủ xu để mua skin này.');
        }
        const notices = {
            'not-found': 'Tin này đã được mua hoặc hủy.',
            'self-purchase': 'Đây là tin của bạn. Bạn có thể hủy tin để nhận lại skin.',
            forbidden: 'Chủ tin mới có thể hủy tin này.'
        };
        return showPlayerMarket(interaction, weaponCase, page, mine, notices[result.status] ?? 'Không thể xử lý tin này.');
    }

    async function applyPlayerMarketFilter(interaction) {
        const [caseId, scope] = interaction.customId.slice(PLAYER_MARKET_FILTER.length).split('_');
        const weaponCase = byId.get(caseId);
        if (!weaponCase) return respond(interaction, 'Mở chợ để chọn bộ lọc lại.');
        const fields = interaction.fields;
        const name = (fields.getTextInputValue('name') ?? '').trim();
        const tierValue = fields.getStringSelectValues('tier')?.[0];
        const tier = tierValue === 'all' ? null : tierValue === 'contraband' ? 'contraband'
            : tiers.findIndex((_, index) => String(index) === tierValue);
        const minText = (fields.getTextInputValue('min') ?? '').trim();
        const maxText = (fields.getTextInputValue('max') ?? '').trim();
        const min = minText ? playerMarket.parseListingPrice(minText) : null;
        const max = maxText ? playerMarket.parseListingPrice(maxText) : null;
        if (name.length > MARKET_FILTER_NAME_LENGTH || !name.isWellFormed() || tier === -1) {
            return respond(interaction, 'Hãy chọn lại tên hoặc bậc skin.');
        }
        if ((minText && min == null) || (maxText && max == null)) {
            return respond(interaction, 'Nhập giá dương bằng xu, tối đa 2 chữ số thập phân, hoặc để trống.');
        }
        if (min != null && max != null && min > max) return respond(interaction, 'Giá tối thiểu phải nhỏ hơn hoặc bằng giá tối đa.');
        await interaction.deferUpdate();
        updateMarketPanel(interaction, { filters: { name, search: marketSearchText(name), tier, min, max, minText, maxText } });
        return showPlayerMarket(interaction, weaponCase, 0, scope === 'mine');
    }

    async function publishPlayerListing(interaction) {
        const [caseId, dropId] = interaction.customId.slice(PLAYER_MARKET_PRICE.length).split('_');
        const weaponCase = byId.get(caseId);
        if (!weaponCase || !dropId) return respond(interaction, 'Mở kho và chọn lại skin để đăng bán.');
        const price = playerMarket.parseListingPrice(interaction.fields.getTextInputValue('price'));
        if (!price) return respond(interaction, 'Nhập giá lớn hơn 0 với tối đa 2 chữ số thập phân, ví dụ 1,500.50 xu.');
        await interaction.deferUpdate();
        const result = await playerMarket.listSkin(interaction.guild.id, interaction.user.id, dropId, price, interaction.id);
        if (result.status === 'listed') {
            return showPlayerMarket(interaction, weaponCase, 0, true, `Đã đăng bán với giá ${marketPriceText(result.listing)}.`);
        }
        const content = result.status === 'locked' ? 'Món này đang khóa. Mở khóa trước khi đăng bán.'
            : result.status === 'not-owned' ? 'Skin này đã rời kho. Hãy chọn lại.'
            : result.status === 'duplicate' ? 'Tin bán này đã được xử lý.' : 'Không thể đăng skin này. Hãy mở kho và thử lại.';
        return interaction.followUp({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    }

    return { marketPriceForm, marketFilterForm, showPlayerMarket, marketPage, selectPlayerListing, settlePlayerListing, applyPlayerMarketFilter, publishPlayerListing, getPanel: marketPanel, updatePanel: updateMarketPanel };
}

module.exports = { createMarket };
