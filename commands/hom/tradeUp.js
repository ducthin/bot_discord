const crypto = require('node:crypto');
const { ButtonStyle, EmbedBuilder, MessageFlags, StringSelectMenuBuilder } = require('discord.js');
const { containersById: byId, skins } = require('../../utils/cs2Catalogue');
const market = require('../../utils/cs2Market');
const { isTradeUpInput, tradeUpGroups, buildTradeUp, drawTradeUp } = require('../../utils/cs2TradeUp');
const { SORT_ORDERS, sortDrops } = require('../../utils/cs2InventoryOrder');
const { wearIndex, wearNames } = require('../../utils/cs2MarketNames');
const { formatCoins } = require('../../utils/coins');
const { respond } = require('../../utils/managementAccess');

function createTradeUp({
    PREFIX, tiers, button, dropName, editHomReply, getStash, paintSeedFor, peekQuote,
    priceCoins, readPlayer, rows, sortMenu, tradeUpGroupKey, transactPlayer, userKey, inventory
}) {
    const tradeUpSessions = new Map();
    const TRADE_UP_TTL_MS = 10 * 60_000;
    const TRADE_UP_SESSION_LIMIT = 128;
    const TRADE_UP_PICK_PAGE = 25;
    const TRADE_UP_ODDS_PAGE = 8;
    const TRADE_UP_GROUP_SELECT = `${PREFIX}tradeup-group_`;
    const TRADE_UP_ITEM_SELECT = `${PREFIX}tradeup-items_`;
    const TRADE_UP_SORT_SELECT = `${PREFIX}tradeup-sort_`;
    const { dropLocation, dropOutcome, resultView, showInventory } = inventory;

    const tradeUpGroupName = ({ tier, statTrak }) => `${tiers[tier].name} · ${statTrak ? 'StatTrak™' : 'Thường'}`;
    const matchesTradeUpGroup = (drop, group) => drop.tier === group.tier && (drop.statTrak === true) === group.statTrak;
    const tradeUpPercent = new Intl.NumberFormat('vi-VN', { style: 'percent', maximumFractionDigits: 3 });

    function readyTradeUpGroup(groups, key) {
        return groups.find(group => group.count >= group.required && tradeUpGroupKey(group) === key);
    }

    function tradeUpPrice(drop) {
        return peekQuote(market.getDropMarketQuoteRef(drop))?.priceVnd;
    }

    function quickTradeUpSelection(drops, group) {
        const eligible = new Map();
        for (const drop of drops) {
            if (!matchesTradeUpGroup(drop, group) || !isTradeUpInput(drop) || eligible.has(drop.id)) continue;
            eligible.set(drop.id, tradeUpPrice(drop) ?? Infinity);
        }
        const cheapest = [...eligible].sort(([, first], [, second]) => first === second ? 0 : first - second);
        return new Set(cheapest.slice(0, group.required).map(([id]) => id));
    }

    function prepareQuickTradeUp(session, drops, group) {
        if (!group) return false;
        const selected = quickTradeUpSelection(drops, group);
        if (selected.size !== group.required) return false;
        Object.assign(session, { group, selected, pickPage: 0, stage: 'pick' });
        return true;
    }

    function tradeUpReply(embed, components) {
        return { content: null, embeds: [embed], attachments: [], components };
    }

    function tradeUpButton(session, action, label, { page, ...options } = {}) {
        const version = `${session.token}_${session.revision}`;
        const argument = page === undefined ? version : `${version}_${page}`;
        return button(`tradeup-${action}`, session.caseId, label, { ...options, argument });
    }

    function tradeUpGroupView(session, drops) {
        const groups = tradeUpGroups(drops);
        const ready = groups.filter(group => group.count >= group.required);
        const embed = new EmbedBuilder().setTitle('Hợp đồng Trade Up').setColor('#5865f2')
            .setDescription('Đổi **10 skin cùng bậc** lấy 1 skin bậc kế tiếp, hoặc đổi **5 Covert** lấy 1 dao hay găng. Skin Thường và StatTrak™ dùng hợp đồng riêng. Hợp đồng Covert StatTrak™ chỉ ra dao.');
        const stock = groups.map(group => `${tiers[group.tier].icon} ${tradeUpGroupName(group)} · **${group.count}/${group.required}**`);
        embed.addFields({ name: 'Skin đủ điều kiện trong kho', value: stock.join('\n') || 'Chưa có skin phù hợp.' });
        if (!ready.length) embed.setFooter({ text: 'Bạn cần đủ skin trong ít nhất một nhóm để lập hợp đồng.' });
        const select = ready.length ? new StringSelectMenuBuilder()
            .setCustomId(`${TRADE_UP_GROUP_SELECT}${session.token}_${session.revision}`)
            .setPlaceholder('Chọn loại hợp đồng')
            .addOptions(ready.map(group => ({
                label: tradeUpGroupName(group), value: tradeUpGroupKey(group),
                description: `${group.required} skin → ${group.tier === 3 ? (group.statTrak ? 'Dao StatTrak™' : 'Dao hoặc găng') : tiers[group.tier + 1].name}`
            }))) : null;
        const quick = ready.map(group => tradeUpButton(session, 'quick', `Chọn nhanh ${group.required} ${tiers[group.tier].name}${group.statTrak ? ' StatTrak™' : ''}`,
            { page: tradeUpGroupKey(group), style: ButtonStyle.Primary }));
        const back = button('inventory', session.caseId, 'Về kho', { argument: session.inventoryPage });
        const navigation = quick.length >= 5 ? [quick.slice(0, 5), [...quick.slice(5), back]] : [[...quick, back]];
        return tradeUpReply(embed, rows(...(select ? [[select]] : []), ...navigation));
    }

    function tradeUpPickView(session, drops, notice) {
        const { group } = session;
        const eligible = sortDrops(drops.filter(drop => matchesTradeUpGroup(drop, group) && isTradeUpInput(drop)),
            session.sortOrder ?? 'newest', drop => priceCoins(tradeUpPrice(drop)));
        const eligibleIds = new Set(eligible.map(drop => drop.id));
        session.selected = new Set([...session.selected].filter(id => eligibleIds.has(id)));
        session.inputs = drops.filter(drop => session.selected.has(drop.id) && matchesTradeUpGroup(drop, group) && isTradeUpInput(drop));
        const ready = session.selected.size === group.required && session.inputs.length === group.required;
        const pages = Math.max(1, Math.ceil(eligible.length / TRADE_UP_PICK_PAGE));
        const page = session.pickPage = Math.max(0, Math.min(session.pickPage, pages - 1));
        const visible = eligible.slice(page * TRADE_UP_PICK_PAGE, (page + 1) * TRADE_UP_PICK_PAGE);
        session.visibleIds = new Set(visible.map(drop => drop.id));
        const selectedElsewhere = [...session.selected].filter(id => !session.visibleIds.has(id)).length;
        session.maxValues = Math.min(visible.length, group.required - selectedElsewhere);
        const embed = new EmbedBuilder().setTitle('Chọn skin để Trade Up').setColor(tiers[group.tier].color)
            .setDescription(`**${tradeUpGroupName(group)}** · Đã chọn **${session.selected.size}/${group.required}**\n${ready
                ? `**Trade Up ngay** sẽ đổi ${group.required} skin đang chọn lấy 1 món.`
                : 'Bạn có thể chọn skin từ nhiều bộ sưu tập và nhiều trang.'}`)
            .setFooter({ text: [notice, `Trang ${page + 1}/${pages}`].filter(Boolean).join(' · ') });
        if (ready) addTradeUpInputs(embed, session.inputs);
        const select = session.maxValues > 0 ? new StringSelectMenuBuilder()
            .setCustomId(`${TRADE_UP_ITEM_SELECT}${session.token}_${session.revision}`)
            .setPlaceholder('Chọn hoặc bỏ chọn skin trên trang này')
            .setMinValues(0).setMaxValues(session.maxValues)
            .addOptions(visible.map(drop => {
                const price = priceCoins(tradeUpPrice(drop));
                const label = price ? formatCoins(price, { exact: true }) : 'Chưa có giá';
                return {
                    label: dropName(drop).slice(0, 100).toWellFormed(), value: drop.id, default: session.selected.has(drop.id),
                    description: `${label} · Float ${drop.float.toFixed(6)} · ${byId.get(drop.caseId).name}`.slice(0, 100).toWellFormed()
                };
            })) : null;
        return tradeUpReply(embed, rows([sortMenu(`${TRADE_UP_SORT_SELECT}${session.token}_${session.revision}`, session.sortOrder ?? 'newest')],
            ...(select ? [[select]] : []), [
            ...(pages > 1 ? [
                tradeUpButton(session, 'pick-page', 'Trang trước', { page: page - 1, disabled: page === 0 }),
                tradeUpButton(session, 'pick-page', 'Trang sau', { page: page + 1, disabled: page === pages - 1 })
            ] : []),
            tradeUpButton(session, 'review', 'Xem xác suất', { disabled: !ready }),
            tradeUpButton(session, 'groups', 'Chọn loại'),
            button('inventory', session.caseId, 'Về kho', { argument: session.inventoryPage })
        ], [
            tradeUpButton(session, 'fill', `Chọn nhanh ${group.required}`, { disabled: eligibleIds.size < group.required }),
            tradeUpButton(session, 'direct', 'Trade Up ngay', { style: ButtonStyle.Danger, disabled: !ready })
        ]));
    }

    function addTradeUpInputs(embed, inputs) {
        let total = 0n;
        let unpriced = 0;
        for (let start = 0; start < inputs.length; start += 5) {
            const selected = inputs.slice(start, start + 5).map(drop => {
                const price = priceCoins(tradeUpPrice(drop));
                if (price) total += price;
                else unpriced++;
                return `${dropName(drop)} · ${drop.float.toFixed(6)} · ${price ? formatCoins(price, { exact: true }) : 'Chưa có giá'}`;
            });
            embed.addFields({ name: `Skin sẽ đổi · ${start + 1}–${start + selected.length}`, value: selected.join('\n') });
        }
        const missing = unpriced ? `${unpriced}/${inputs.length} món chưa có giá` : '';
        const estimate = total ? `**${formatCoins(total, { exact: true })}**` : '';
        embed.addFields({ name: 'Giá trị tham chiếu của skin sẽ đổi', value: [estimate, missing].filter(Boolean).join(' · ') });
    }

    function tradeUpOddsView(session) {
        const { plan, inputs } = session;
        const grouped = new Map();
        for (const { count, outcomes: candidates } of plan.sources) {
            const chance = count / plan.required / candidates.length;
            for (const drop of candidates) {
                const key = (drop.variants ?? [drop]).map(item => item.skinId).sort().join('/');
                if (!grouped.has(key)) grouped.set(key, { drop, chance: 0 });
                grouped.get(key).chance += chance;
            }
        }
        const outcomes = [...grouped.values()].sort((left, right) => right.chance - left.chance);
        const pages = Math.ceil(outcomes.length / TRADE_UP_ODDS_PAGE);
        const page = session.oddsPage = Math.max(0, Math.min(session.oddsPage, pages - 1));
        const lines = outcomes.slice(page * TRADE_UP_ODDS_PAGE, (page + 1) * TRADE_UP_ODDS_PAGE).map(({ drop, chance }) => {
            const variants = drop.variants ?? [];
            const name = variants.length ? `${drop.statTrak ? 'StatTrak™ ' : ''}${skins[drop.skinId].name}` : dropName(drop);
            const float = variants.some(variant => variant.float !== drop.float) ? 'Float tùy phase'
                : drop.float == null ? '' : `${wearNames[wearIndex(drop.float)]} · Float ${drop.float.toFixed(6)}`;
            const phases = variants.length
                ? `${variants.map(variant => skins[variant.skinId].phase).join(', ')} · ${tradeUpPercent.format(chance / variants.length)} mỗi phase`
                : '';
            const detail = [float, phases].filter(Boolean).join(' · ');
            return `**${tradeUpPercent.format(chance)}** · **${name}**${detail ? `\n${detail}` : ''}`;
        });
        const collectionOdds = plan.sources.map(({ caseId, count }) =>
            `${byId.get(caseId).name} · **${tradeUpPercent.format(count / plan.required)}**`);
        const embed = new EmbedBuilder().setTitle('Xác nhận Trade Up').setColor(tiers[plan.tier + 1].color)
            .setDescription(`**${plan.required} skin** sẽ rời kho khi xác nhận. Bạn nhận **1 món**.\n\n${lines.join('\n\n')}`)
            .addFields({ name: 'Xác suất theo bộ sưu tập', value: collectionOdds.join('\n') })
            .setFooter({ text: `Kết quả có thể nhận · Trang ${page + 1}/${pages}${outcomes.some(({ drop }) => drop.variants?.length) ? ' · Bot chia đều cơ hội giữa các phase của cùng mẫu' : ''}` });
        addTradeUpInputs(embed, inputs);
        return tradeUpReply(embed, rows([
            ...(pages > 1 ? [
                tradeUpButton(session, 'odds-page', 'Trang trước', { page: page - 1, disabled: page === 0 }),
                tradeUpButton(session, 'odds-page', 'Trang sau', { page: page + 1, disabled: page === pages - 1 })
            ] : []),
            tradeUpButton(session, 'confirm', 'Xác nhận Trade Up', { style: ButtonStyle.Danger }),
            tradeUpButton(session, 'edit', 'Sửa lựa chọn'),
            button('inventory', session.caseId, 'Về kho', { argument: session.inventoryPage })
        ]));
    }

    async function startTradeUp(interaction, weaponCase, inventoryPage, stash, quickGroupKey) {
        const session = {
            token: crypto.randomBytes(8).toString('hex'), revision: 0, messageId: interaction.message?.id,
            expiresAt: Date.now() + TRADE_UP_TTL_MS, stage: 'group', caseId: weaponCase.id, inventoryPage,
            sortOrder: stash?.tradeUpSort ?? 'newest'
        };
        const scope = userKey(interaction);
        const drops = stash?.drops ?? [];
        const quick = quickGroupKey != null && prepareQuickTradeUp(session, drops, readyTradeUpGroup(tradeUpGroups(drops), quickGroupKey));
        await editHomReply(interaction, quick ? tradeUpPickView(session, drops, 'Đã chọn nhanh · Ưu tiên skin có giá thấp') : tradeUpGroupView(session, drops));
        tradeUpSessions.delete(scope);
        tradeUpSessions.set(scope, session);
        if (tradeUpSessions.size > TRADE_UP_SESSION_LIMIT) tradeUpSessions.delete(tradeUpSessions.keys().next().value);
    }

    function currentTradeUp(interaction, token, revision) {
        const session = tradeUpSessions.get(userKey(interaction));
        return session && session.token === token && String(session.revision) === revision &&
            session.messageId === interaction.message?.id && session.expiresAt > Date.now() ? session : null;
    }

    const tradeUpExpired = 'Bảng Trade Up đã cũ. Mở kho đồ để tạo hợp đồng mới.';

    function advanceTradeUp(session) {
        session.revision += 1;
        session.expiresAt = Date.now() + TRADE_UP_TTL_MS;
    }

    async function editTradeUp(interaction, current, draft, payload) {
        await editHomReply(interaction, payload);
        if (tradeUpSessions.get(userKey(interaction)) === current) Object.assign(current, draft);
    }

    const tradeUpNotice = (interaction, content) => interaction.followUp({ content, flags: MessageFlags.Ephemeral });

    async function selectTradeUp(interaction, prefix) {
        const [token, revision] = interaction.customId.slice(prefix.length).split('_');
        const current = currentTradeUp(interaction, token, revision);
        const choosingGroup = prefix === TRADE_UP_GROUP_SELECT;
        const sorting = prefix === TRADE_UP_SORT_SELECT;
        if (!current || current.stage !== (choosingGroup ? 'group' : 'pick')) return respond(interaction, tradeUpExpired);
        const session = { ...current };
        await interaction.deferUpdate();
        const state = await readPlayer(interaction);
        const drops = state.skinCases?.[interaction.user.id]?.drops ?? [];
        if (sorting) {
            const order = interaction.values[0];
            if (interaction.values.length !== 1 || !Object.hasOwn(SORT_ORDERS, order)) return tradeUpNotice(interaction, 'Chọn cách sắp xếp trong danh sách.');
            session.sortOrder = order;
            session.pickPage = 0;
            await transactPlayer(interaction, async (data, save) => {
                getStash(data, interaction.user.id).tradeUpSort = order;
                await save();
            });
        } else if (choosingGroup) {
            const group = readyTradeUpGroup(tradeUpGroups(drops), interaction.values[0]);
            if (!group || interaction.values.length !== 1) return tradeUpNotice(interaction, 'Kho đã thay đổi. Hãy mở lại Trade Up để chọn nhóm.');
            Object.assign(session, { group, selected: new Set(), pickPage: 0, stage: 'pick' });
        } else {
            const values = new Set(interaction.values);
            if (values.size !== interaction.values.length || values.size > session.maxValues ||
                [...values].some(id => !session.visibleIds.has(id))) {
                return tradeUpNotice(interaction, 'Hãy chọn lại các skin trên trang hiện tại.');
            }
            const selectedElsewhere = [...session.selected].filter(id => !session.visibleIds.has(id));
            session.selected = new Set([...selectedElsewhere, ...values]);
        }
        advanceTradeUp(session);
        return editTradeUp(interaction, current, session, tradeUpPickView(session, drops));
    }

    function tradeUpInputSignature(inputs) {
        const sorted = inputs.toSorted((first, second) => first.id.localeCompare(second.id));
        return JSON.stringify(sorted.map(({ id, caseId, skinId, tier, float, statTrak, paintSeed, acquiredAt, locked, inventoryRevision, priceVariant }) =>
            [id, caseId, skinId, tier, float, statTrak, paintSeed, acquiredAt, locked === true, inventoryRevision, priceVariant]));
    }

    async function confirmTradeUp(interaction, session, weaponCase) {
        const userId = interaction.user.id;
        const expected = tradeUpInputSignature(session.inputs);
        const result = await transactPlayer(interaction, async (state, save) => {
            const stash = state.skinCases?.[userId];
            const current = stash?.drops?.filter(drop => session.selected.has(drop.id)) ?? [];
            if (current.some(drop => drop.locked === true)) return { stash, notice: 'Một món đang khóa. Chưa đổi skin nào.' };
            if (tradeUpInputSignature(current) !== expected) return { stash };
            let plan;
            try {
                plan = session.stage === 'review' ? session.plan : buildTradeUp(current);
            } catch (error) {
                return { stash, notice: error.message };
            }
            const output = drawTradeUp(plan);
            const drop = { ...output, id: interaction.id, tradeUp: true, acquiredAt: Date.now(), ...paintSeedFor(output.float) };
            stash.drops = [...stash.drops.filter(item => !session.selected.has(item.id)), drop];
            await save();
            return { stash, outcome: dropOutcome(state, userId, byId.get(drop.caseId), drop) };
        });
        tradeUpSessions.delete(userKey(interaction));
        if (!result.outcome) {
            return showInventory(interaction, weaponCase, result.stash, session.inventoryPage,
                { notice: result.notice ?? 'Kho đã thay đổi. Chưa đổi skin nào.' });
        }
        const { drop } = result.outcome;
        const quickTradeUp = readyTradeUpGroup(tradeUpGroups(result.stash.drops), tradeUpGroupKey(session.group));
        return editHomReply(interaction, resultView(byId.get(drop.caseId), result.outcome, {
            inventory: dropLocation(weaponCase, result.stash, drop), notice: 'Đã đổi và lưu vào kho',
            quickTradeUp
        }));
    }

    const tradeUpStages = {
        'tradeup-quick': 'group', 'tradeup-fill': 'pick', 'tradeup-pick-page': 'pick', 'tradeup-groups': 'pick', 'tradeup-review': 'pick', 'tradeup-direct': 'pick',
        'tradeup-odds-page': 'review', 'tradeup-edit': 'review', 'tradeup-confirm': 'review'
    };

    async function tradeUpAction(interaction, action, weaponCase, token, revision, requestedPage) {
        const current = currentTradeUp(interaction, token, revision);
        if (!current || current.stage !== tradeUpStages[action] || current.caseId !== weaponCase.id) {
            return tradeUpNotice(interaction, tradeUpExpired);
        }
        if (action === 'tradeup-confirm') return confirmTradeUp(interaction, current, weaponCase);
        if (action === 'tradeup-direct') {
            if (current.selected.size !== current.group.required || current.inputs.length !== current.group.required) {
                return tradeUpNotice(interaction, 'Hãy chọn đủ skin trước khi Trade Up.');
            }
            return confirmTradeUp(interaction, current, weaponCase);
        }
        const session = { ...current };
        advanceTradeUp(session);
        if (action === 'tradeup-odds-page') {
            session.oddsPage = Number.parseInt(requestedPage, 10) || 0;
            return editTradeUp(interaction, current, session, tradeUpOddsView(session));
        }
        const state = await readPlayer(interaction);
        const drops = state.skinCases?.[interaction.user.id]?.drops ?? [];
        if (action === 'tradeup-quick') {
            const group = readyTradeUpGroup(tradeUpGroups(drops), requestedPage);
            if (!prepareQuickTradeUp(session, drops, group)) {
                return editTradeUp(interaction, current, session, tradeUpGroupView(session, drops));
            }
            return editTradeUp(interaction, current, session, tradeUpPickView(session, drops, 'Đã chọn nhanh · Ưu tiên skin có giá thấp'));
        }
        if (action === 'tradeup-fill') {
            const selected = prepareQuickTradeUp(session, drops, session.group);
            return editTradeUp(interaction, current, session, tradeUpPickView(session, drops,
                selected ? 'Đã chọn nhanh · Ưu tiên skin có giá thấp' : 'Kho đã thay đổi. Chưa đủ skin trong nhóm này.'));
        }
        if (action === 'tradeup-groups') {
            session.stage = 'group';
            return editTradeUp(interaction, current, session, tradeUpGroupView(session, drops));
        }
        if (action === 'tradeup-pick-page') session.pickPage = Number.parseInt(requestedPage, 10) || 0;
        if (action === 'tradeup-edit') session.stage = 'pick';
        if (action === 'tradeup-review') {
            const inputs = drops.filter(drop => session.selected.has(drop.id) && matchesTradeUpGroup(drop, session.group) && isTradeUpInput(drop));
            if (inputs.length !== session.group.required) {
                return editTradeUp(interaction, current, session, tradeUpPickView(session, drops, 'Chọn đủ skin còn trong kho.'));
            }
            let plan;
            try {
                plan = buildTradeUp(inputs);
            } catch (error) {
                return editTradeUp(interaction, current, session, tradeUpPickView(session, drops, error.message));
            }
            Object.assign(session, { plan, inputs, oddsPage: 0, stage: 'review' });
            return editTradeUp(interaction, current, session, tradeUpOddsView(session));
        }
        return editTradeUp(interaction, current, session, tradeUpPickView(session, drops));
    }

    function cancelForMessage(interaction) {
        const scope = userKey(interaction);
        const session = tradeUpSessions.get(scope);
        if (!session || session.messageId !== interaction.message?.id) return false;
        tradeUpSessions.delete(scope);
        return true;
    }

    return {
        groupSelectPrefix: TRADE_UP_GROUP_SELECT,
        itemSelectPrefix: TRADE_UP_ITEM_SELECT,
        sortSelectPrefix: TRADE_UP_SORT_SELECT,
        start: startTradeUp,
        select: selectTradeUp,
        action: tradeUpAction,
        stages: tradeUpStages,
        notice: tradeUpNotice,
        expired: tradeUpExpired,
        cancelForMessage
    };
}

module.exports = { createTradeUp };
