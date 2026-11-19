const crypto = require('node:crypto');
const path = require('node:path');
const {
    SlashCommandBuilder, ChannelType, PermissionFlagsBits, MessageFlags, EmbedBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, LabelBuilder, ModalBuilder, TextInputBuilder,
    TextInputStyle, RESTJSONErrorCodes
} = require('discord.js');
const store = require('../utils/managementStore');
const renderDice = require('../utils/diceImage');
const { isGuildAllowed } = require('../utils/guildUtils');
const { respond, edit, hasChannelPermissions } = require('../utils/managementAccess');
const { COIN_SCALE, readCoins, parseCoins, serializeCoins, formatCoins: coins } = require('../utils/coins');

const STARTING_BALANCE = 1000n * COIN_SCALE;
const DAILY_REWARD = 20_000_000n * COIN_SCALE;
const DAILY_COOLDOWN_MS = 4 * 60 * 60 * 1000;
const BIG_WIN = 5000n * COIN_SCALE;
const DAILY_HINT = 'Bấm **Điểm danh** hoặc dùng `/tiembanh daily` để nhận **5,000,000 xu** mỗi 8 giờ.';
const ROUND_SECONDS = 30;
const SECOND_MS = 1000;
const ROUND_MS = ROUND_SECONDS * SECOND_MS;
const COUNTDOWN_CHECKPOINTS = [24, 17, 10];
const MIN_BOARD_UPDATE_LEAD_MS = 7000;
const ROLL_RESUME_GRACE_MS = 1500;
const ROLL_MS = 2600;
const PAYOUT_DELAY_MS = 1000;
const REVEAL_RETRY_MS = 5000;
const SLOW_BOARD_EDIT_MS = 2000;
const RESULT_MS = 6000;
const RECENT_COIN_GRANT_LIMIT = 32;
const HISTORY_LIMIT = 20;
const HISTORY_PAGE_SIZE = 10;
const DICE_HISTORY_LIMIT = 20;
const TRAIL_LIMIT = 12;
const DICE_HISTORY_TITLE = '🎲 Lịch sử xúc xắc';
const LEADERBOARD_TITLE = '🏆 Xếp hạng Tiệm Bánh Mây';
const EMPTY_LEADERBOARD = 'Chưa có người chơi. Dùng /tiembanh wallet để mở ví.';
const LEADERBOARD_REFRESH_MS = 1000;
const PUBLICATION_LEASE_MS = 60_000;
const PUBLICATION_HEARTBEAT_MS = 15_000;
const publicationOwner = crypto.randomUUID();
const boardTasks = new Map();
const boardRetries = new Map();
const timers = new WeakMap();
const nextRounds = new WeakMap();
const reveals = new WeakMap();
const revealStarts = new WeakMap();
const betReplies = new WeakMap();
const leaderboards = new WeakMap();
const GAME_SCOPE = { sections: ['taixiu', 'settings'], wallets: 'all' };
const readGame = guildId => store.read(guildId, GAME_SCOPE);
async function transactGame(guildId, operation) {
    const effects = [];
    const result = await store.transact(guildId, (state, save) => operation(state, save, effect => effects.push(effect)), GAME_SCOPE);
    // save() flushes rows; only the resolved transaction confirms PostgreSQL COMMIT.
    for (const effect of effects) {
        try { effect(); }
        catch (error) { console.error('Lỗi cập nhật Tiệm Bánh Mây sau khi lưu:', error.message); }
    }
    return result;
}
const sides = { tai: 'Bánh Bông', xiu: 'Bánh Bơ' };
const rollMarkers = { tai: '🔴', xiu: '🔵', tie: '🟡' };
const diceFaces = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const ROLL_IMAGE_NAME = 'taixiu-roll.gif';
const ROLL_IMAGE_PATH = path.join(__dirname, '..', 'assets', ROLL_IMAGE_NAME);
const DICE_IMAGE_NAME = 'xuc-xac.png';
const showDice = dice => dice.map(face => diceFaces[face - 1]).join('　');
const format = new Intl.NumberFormat('vi-VN');
const { ViewChannel, SendMessages, EmbedLinks, AttachFiles } = PermissionFlagsBits;
const discordId = /^[1-9]\d{0,19}$/;

function walletBalance(game, userId) {
    const balance = game.balances[userId];
    return balance == null ? STARTING_BALANCE : readCoins(balance);
}

function addWalletCoins(game, userId, amount) {
    const balance = walletBalance(game, userId) + amount;
    game.balances[userId] = serializeCoins(balance);
    return balance;
}

function gameState(state) {
    // Older deployments can load the commands before updating the shared store.
    return state.taixiu ??= { balances: {}, round: null };
}

function automaticChannel(guild, channelId) {
    const channel = guild.channels.cache.get(channelId);
    if (channel?.type === ChannelType.GuildText &&
        hasChannelPermissions(channel, guild.members.me, [ViewChannel, SendMessages, EmbedLinks])) return channel;
    return null;
}

function readStakes(bet, legacyAmount) {
    const stakes = { tai: readCoins(bet?.tai ?? 0), xiu: readCoins(bet?.xiu ?? 0) };
    if (typeof bet === 'string') stakes[bet] = readCoins(legacyAmount);
    else if (bet?.choice) stakes[bet.choice] = readCoins(bet.amount);
    return stakes;
}

function payoutFor(stakes, winner) {
    return winner === 'tie' ? stakes.tai + stakes.xiu : stakes[winner] * 2n;
}

function personalResult(result) {
    if (!result) return 'Bạn chưa có kết quả cược trên máy chủ này.';
    const stakes = readStakes(result);
    const payout = payoutFor(stakes, result.winner);
    const net = payout - stakes.tai - stakes.xiu;
    let outcome = '⚖️ **Bạn hòa vốn.**';
    if (result.winner === 'tie') outcome = '🎲 **Ba mặt giống nhau. Bạn được hoàn toàn bộ tiền cược.**';
    else if (net > 0n) outcome = `🎉 **Bạn thắng +${coins(net)}!**`;
    else if (net < 0n) outcome = `❌ **Bạn thua ${coins(-net)}.**`;
    const resultText = result.winner === 'tie' ? 'Hoàn cược' : `${sides[result.winner]} thắng`;
    return `${outcome}\n${resultText} · <t:${Math.floor(result.at / 1000)}:f>\n` +
        `${sides.tai} **${coins(stakes.tai)}** · ${sides.xiu} **${coins(stakes.xiu)}** · Trả về **${coins(payout)}**`;
}

function recentResults(game, userId) {
    const previous = game.lastResults?.[userId];
    return game.history?.[userId] ?? (previous ? [previous] : []);
}

function recentRolls(game) {
    if (game.rolls) return game.rolls;
    const round = game.round;
    return round?.result ? [{ at: round.closesAt, ...round.result }] : [];
}

function rollLine({ dice, total, winner }) {
    const outcome = winner === 'tie' ? 'Hoàn cược' : sides[winner];
    return `${rollMarkers[winner]} **${outcome}** · ${dice.join(' + ')} = **${total}**`;
}

function render(round, ranking, phase = 'board', withImage = false) {
    const rolling = phase === 'roll';
    const showingDraw = phase === 'draw';
    const result = showingDraw ? round.draw : round.result;
    const players = Object.entries(round.bets).map(([id, bet]) => ({ id, ...readStakes(bet, round.bet) }));
    const embed = new EmbedBuilder().setTitle(round.automatic ? '🎲 Bàn Tiệm Bánh Mây tự động' : '🎲 Tiệm Bánh Mây')
        .setColor('#5865f2');
    const button = (action, label, style = ButtonStyle.Secondary) => new ButtonBuilder()
        .setCustomId(`mg_taixiu_${action}_${round.id}`).setLabel(label).setStyle(style);
    const components = [];
    if (rolling || (round.draw && !showingDraw)) {
        embed.setColor('#faa61a').setDescription(rolling
            ? 'Đã khóa cược · Đang lắc xúc xắc…'
            : 'Đã khóa cược · Đang chờ hiển thị xúc xắc…');
        embed.addFields({ name: '👥 Người chơi', value: format.format(players.length), inline: true });
    } else if (!result) {
        const totals = { tai: { count: 0, amount: 0n }, xiu: { count: 0, amount: 0n } };
        for (const stakes of players) {
            for (const side of Object.keys(sides)) {
                if (stakes[side] > 0n) totals[side].count++;
                totals[side].amount += stakes[side];
            }
        }
        if (round.closesAt == null) {
            embed.setDescription(`**Đang chờ lượt cược đầu tiên**\nChọn **${sides.tai}** hoặc **${sides.xiu}** rồi nhập số xu để mở ván ${ROUND_SECONDS} giây.`);
        } else {
            const lastStretch = round.closesAt - Date.now() <= COUNTDOWN_CHECKPOINTS.at(-1) * SECOND_MS;
            if (lastStretch) embed.setColor('#faa61a');
            embed.setDescription(`Bấm **${sides.tai}** hoặc **${sides.xiu}** để đặt hoặc thêm xu trước khi khóa cược.`);
            const deadline = Math.ceil(round.closesAt / SECOND_MS);
            embed.addFields({ name: '⏳ Đếm ngược', value: `**Khóa cược <t:${deadline}:R>**\nGiờ khóa · <t:${deadline}:T>` });
        }
        embed.addFields(
            { name: '👥 Người chơi', value: `**${format.format(players.length)} người**\n${coins(totals.tai.amount + totals.xiu.amount)} đã cược`, inline: true },
            { name: `🔴 ${sides.tai}`, value: `**${coins(totals.tai.amount)}**\n${format.format(totals.tai.count)} người`, inline: true },
            { name: `🔵 ${sides.xiu}`, value: `**${coins(totals.xiu.amount)}**\n${format.format(totals.xiu.count)} người`, inline: true }
        ).setFooter({ text: 'Xu ảo trong bot · Có thể cược cả hai cửa · Tối đa bằng số dư · Ba mặt giống nhau hoàn cược' });
        components.push(new ActionRowBuilder().addComponents(
            button('tai', `${sides.tai} · 11–17`, ButtonStyle.Danger),
            button('xiu', `${sides.xiu} · 4–10`, ButtonStyle.Primary),
            button('result', 'Kết quả của tôi')
        ), new ActionRowBuilder().addComponents(
            button('wallet', 'Ví xu'),
            button('daily', 'Điểm danh', ButtonStyle.Success),
            button('top', 'Xếp hạng'),
            button('history', 'Lịch sử cược'),
            button('dice', 'Lịch sử xúc xắc')
        ));
    } else {
        const { dice, total, winner } = result;
        const diceText = withImage ? '' : `**${showDice(dice)}**\n`;
        const outcome = winner === 'tie' ? 'Ba mặt giống nhau · Hoàn xu cược' : `${sides[winner]} thắng`;
        const winners = (showingDraw ? [] : players).map(stakes => ({ id: stakes.id, amount: payoutFor(stakes, winner) - stakes.tai - stakes.xiu }))
            .filter(player => player.amount > 0n).sort((first, second) => Number(second.amount - first.amount));
        const bigWin = winners.length > 0 && winners[0].amount >= BIG_WIN;
        embed.setTitle(bigWin ? '🎉 Chúc mừng thắng lớn!' : '🎲 Kết quả Tiệm Bánh Mây')
            .setColor(bigWin ? '#f5c451' : winner === 'tie' ? '#faa61a' : '#57f287')
            .setDescription(`${diceText}**${dice.join(' + ')} = ${total}** · **${outcome}**`);
        embed.addFields({ name: '👥 Người chơi', value: format.format(players.length), inline: true });
        if (showingDraw) {
            embed.setFooter({ text: 'Đang trả thưởng…' });
        } else if (winners.length) {
            const profits = winners.slice(0, 8).map(({ id, amount }) =>
                `${amount >= BIG_WIN ? '🎉 ' : ''}<@${id}> · **+${coins(amount)}**`);
            if (winners.length > profits.length) profits.push(`Và ${format.format(winners.length - profits.length)} người thắng khác.`);
            embed.addFields({ name: '🏆 Lãi sau ván', value: profits.join('\n') });
        } else if (winner !== 'tie') {
            embed.setFooter({ text: 'Ván này chưa có người có lãi.' });
        }
        if (!showingDraw) components.push(new ActionRowBuilder().addComponents(
            ...(!round.automatic ? [button('replay', 'Chơi lại', ButtonStyle.Primary)] : []),
            button('result', 'Kết quả của tôi'),
            button('history', 'Lịch sử cược'),
            button('dice', 'Lịch sử xúc xắc')
        ), new ActionRowBuilder().addComponents(
            button('wallet', 'Ví xu'),
            button('daily', 'Điểm danh', ButtonStyle.Success),
            button('top', 'Xếp hạng')
        ));
    }
    const standings = new EmbedBuilder().setTitle(LEADERBOARD_TITLE).setColor('#5865f2')
        .setDescription(ranking?.description ?? EMPTY_LEADERBOARD).setFooter({ text: 'Top 5 · Tổng xu gồm cả xu đang cược' });
    const rolls = ranking?.rolls ?? [];
    const trail = rolls.slice(0, TRAIL_LIMIT).reverse().map(roll => rollMarkers[roll.winner]).join(' ');
    standings.addFields({ name: 'Lượt lắc gần đây · Cũ → mới', value: trail
        ? `${trail}\n🔴 ${sides.tai} · 🔵 ${sides.xiu} · 🟡 Hoàn cược`
        : 'Kết quả sẽ hiện sau khi ván đầu tiên hoàn tất.' });
    if (rolls.length) {
        standings.addFields({ name: '🎲 Xúc xắc gần đây', value: rolls.slice(0, 3).map(rollLine).join('\n') });
    }
    const payload = { embeds: [embed, standings], components, allowedMentions: { parse: [] } };
    if (withImage && (rolling || result)) {
        const file = rolling
            ? { attachment: ROLL_IMAGE_PATH, name: ROLL_IMAGE_NAME, description: 'Ba viên xúc xắc đang lắc' }
            : {
                attachment: renderDice(result.dice),
                name: DICE_IMAGE_NAME,
                description: `Ba mặt xúc xắc: ${result.dice.join(', ')}`
            };
        embed.setImage(`attachment://${file.name}`);
        payload.files = [file];
    }
    return payload;
}

function wasDeleted(error) {
    return [RESTJSONErrorCodes.UnknownMessage, RESTJSONErrorCodes.UnknownChannel].includes(error.code);
}

async function refreshRound(guild, round, phase = 'board', recoverMissing = false) {
    const channel = guild.channels.cache.get(round.channelId);
    if (!channel) {
        if (recoverMissing) throw Object.assign(new Error('Unknown Channel'), { code: RESTJSONErrorCodes.UnknownChannel });
        return false;
    }
    const rolling = phase === 'roll';
    const ranking = leaderboards.get(guild);
    const description = rolling ? ranking?.published : ranking?.description;
    const snapshot = { description, rolls: ranking?.rolls };
    const editBoard = includeImage => channel.messages.edit(round.messageId, {
        ...render(round, snapshot, phase, includeImage), attachments: []
    });
    const startedAt = Date.now();
    try {
        const withImage = Boolean(rolling || phase === 'draw' || round.result) && hasChannelPermissions(channel, guild.members.me, [AttachFiles]);
        if (rolling && !withImage) return false;
        try {
            await editBoard(withImage);
        } catch (error) {
            if (!withImage || ![RESTJSONErrorCodes.MissingPermissions, 'ENOENT'].includes(error.code)) throw error;
            if (rolling) return false;
            await editBoard(false);
        }
        if (!rolling && ranking) ranking.published = description;
        return true;
    } catch (error) {
        if ((phase === 'draw' || recoverMissing) && wasDeleted(error)) throw error;
        if (!wasDeleted(error)) {
            console.error('Lỗi cập nhật bàn Tiệm Bánh Mây:', error.message);
        }
        return false;
    } finally {
        const elapsed = Date.now() - startedAt;
        if (elapsed >= SLOW_BOARD_EDIT_MS) {
            const label = rolling ? 'lắc xúc xắc' : phase === 'draw' || round.result ? 'kết quả' : 'đếm ngược';
            console.warn(`Cập nhật ${label} Tiệm Bánh Mây (${guild.id}) mất ${elapsed} ms.`);
        }
    }
}

async function retireBoard(guild, round) {
    const channel = guild.channels.cache.get(round.channelId);
    try {
        await leaderboards.get(guild)?.edit;
        await channel?.messages.edit(round.messageId, { content: 'Bàn Tiệm Bánh Mây tự động đã đóng tại đây.', embeds: [], components: [], attachments: [] });
    } catch (error) {
        if (!wasDeleted(error)) console.error('Lỗi đóng bàn Tiệm Bánh Mây:', error.message);
    }
}

function boardTask(guild, operation) {
    const task = (boardTasks.get(guild.id) ?? Promise.resolve()).catch(() => {}).then(operation);
    boardTasks.set(guild.id, task);
    const release = () => { if (boardTasks.get(guild.id) === task) boardTasks.delete(guild.id); };
    void task.then(release, release);
    return task;
}

function retryBoard(guild, wait = REVEAL_RETRY_MS) {
    if (boardRetries.has(guild.id)) return;
    const timer = setTimeout(() => {
        boardRetries.delete(guild.id);
        void syncAutomaticBoard(guild).catch(error => console.error('Lỗi khôi phục bàn Tiệm Bánh Mây:', error.message));
    }, Math.max(1, wait));
    timer.unref();
    boardRetries.set(guild.id, timer);
}

const roundPhase = round => !round ? 'none' : round.result ? 'result' : round.draw ? 'draw'
    : round.closesAt == null ? 'waiting' : 'active';

function publicationMatches(state, publication) {
    const round = gameState(state).round;
    return (state.settings.taixiuRoom?.channelId ?? null) === publication.settingChannelId &&
        (round?.id ?? null) === publication.sourceId && (round?.messageId ?? null) === publication.sourceMessageId &&
        (round?.channelId ?? null) === publication.sourceChannelId &&
        (publication.kind === 'repair' || roundPhase(round) === publication.sourcePhase);
}

async function claimPublication(state, save) {
    const game = gameState(state);
    const pending = game.boardPublication;
    if (!pending) return null;
    if (!publicationMatches(state, pending)) {
        delete game.boardPublication;
        await save();
        return null;
    }
    if (pending.owner !== publicationOwner && pending.leaseUntil > Date.now()) {
        return { busy: true, leaseUntil: pending.leaseUntil };
    }
    pending.owner = publicationOwner;
    pending.leaseUntil = Date.now() + PUBLICATION_LEASE_MS;
    await save();
    return { publication: structuredClone(pending), game };
}

async function reserveBoard(state, save, round, kind, forceSend = false) {
    const game = gameState(state);
    const previous = game.round;
    // Preserve the legacy last result before replacing its round.
    if (!game.rolls && previous?.result) game.rolls = recentRolls(game);
    const publication = {
        id: crypto.randomBytes(12).toString('hex'), owner: publicationOwner,
        leaseUntil: Date.now() + PUBLICATION_LEASE_MS, kind,
        sourceId: previous?.id ?? null, sourceMessageId: previous?.messageId ?? null,
        sourceChannelId: previous?.channelId ?? null, sourcePhase: roundPhase(previous),
        settingChannelId: state.settings.taixiuRoom?.channelId ?? null,
        round: structuredClone(round), ...(forceSend ? { forceSend: true } : {})
    };
    game.boardPublication = publication;
    await save();
    return { publication: structuredClone(publication), game };
}

function automaticRound(state) {
    const previous = gameState(state).round;
    const channelId = state.settings.taixiuRoom?.channelId;
    return { id: crypto.randomUUID(), automatic: true, channelId, closesAt: null, bets: {},
        ...(previous?.automatic && previous.channelId === channelId ? { messageId: previous.messageId } : {}) };
}

async function publishBoard(guild, prepared) {
    if (prepared?.busy) {
        retryBoard(guild, prepared.leaseUntil - Date.now());
        return null;
    }
    if (!prepared?.publication) return null;
    const { publication } = prepared;
    const round = publication.kind === 'repair' ? { ...prepared.game.round, channelId: publication.round.channelId }
        : { ...publication.round };
    const channel = automaticChannel(guild, round.channelId);
    if (!channel) { retryBoard(guild); return null; }
    let posted;
    let ranking;
    let accepted = false;
    let messageId = publication.forceSend ? null : round.messageId;
    let heartbeatBusy = false;
    const heartbeat = setInterval(() => {
        if (heartbeatBusy) return;
        heartbeatBusy = true;
        void transactGame(guild.id, async (state, save) => {
            const pending = gameState(state).boardPublication;
            if (pending?.id !== publication.id || pending.owner !== publicationOwner) return;
            pending.leaseUntil = Date.now() + PUBLICATION_LEASE_MS;
            await save();
        }).catch(error => console.error('Lỗi gia hạn đăng bàn Tiệm Bánh Mây:', error.message))
            .finally(() => { heartbeatBusy = false; });
    }, PUBLICATION_HEARTBEAT_MS);
    heartbeat.unref();
    try {
        ranking = cacheLeaderboard(guild, prepared.game);
        ranking.publishing = true;
        await ranking.edit;
        const snapshot = { description: ranking.description, rolls: ranking.rolls };
        if (messageId) {
            try { await channel.messages.edit(messageId, { ...render(round, snapshot), attachments: [] }); }
            catch (error) {
                if (error.code !== RESTJSONErrorCodes.UnknownMessage) throw error;
                messageId = null;
            }
        }
        if (!messageId) {
            // Discord deduplicates recent retries after an uncertain send/commit.
            // The database still validates the sole accepted message ID afterwards.
            posted = await channel.send({ ...render(round, snapshot), nonce: publication.id, enforceNonce: true });
            messageId = posted.id;
        }
        const completed = await transactGame(guild.id, async (state, save) => {
            const game = gameState(state);
            const pending = game.boardPublication;
            if (pending?.id !== publication.id || pending.owner !== publicationOwner) return { stale: true, game };
            if (!publicationMatches(state, pending)) {
                delete game.boardPublication;
                await save();
                return { stale: true, game };
            }
            const previous = game.round;
            // Bets and a draw may have changed while Discord was slow. Repair only
            // the destination fields of the current round, never its old snapshot.
            game.round = publication.kind === 'repair'
                ? { ...previous, channelId: round.channelId, messageId }
                : { ...pending.round, messageId };
            delete game.boardPublication;
            await save();
            return { round: game.round, previous, game };
        });
        if (completed.stale) {
            const current = completed.game.round;
            if (posted && (current?.messageId !== messageId || current.channelId !== channel.id)) {
                await posted.delete?.().catch(() => {});
            } else if (current?.messageId === messageId && current.channelId === channel.id) {
                await refreshRound(guild, current);
            }
            return { stale: true };
        }
        clearTimeout(boardRetries.get(guild.id));
        boardRetries.delete(guild.id);
        const currentRanking = cacheLeaderboard(guild, completed.game);
        currentRanking.published = snapshot.description;
        accepted = true;
        if (!completed.round.result && !completed.round.draw && completed.round.closesAt != null) scheduleRound(guild, completed.round);
        if (completed.previous?.automatic && completed.previous.channelId !== completed.round.channelId) {
            await retireBoard(guild, completed.previous);
        }
        return completed.round;
    } catch (error) {
        // Keep the stable operation/nonce for a retry, but release this process's
        // lease immediately. A crashed process is recovered after its lease ends.
        await transactGame(guild.id, async (state, save) => {
            const pending = gameState(state).boardPublication;
            if (pending?.id !== publication.id || pending.owner !== publicationOwner) return;
            pending.leaseUntil = 0;
            await save();
        }).catch(() => {});
        retryBoard(guild);
        throw error;
    } finally {
        clearInterval(heartbeat);
        if (ranking) {
            ranking.publishing = false;
            if (accepted) queueLeaderboardRefresh(guild);
        }
    }
}

async function openNextAutomaticBoard(guild, sourceId) {
    return boardTask(guild, async () => {
        const prepared = await transactGame(guild.id, async (state, save) => {
            const claimed = await claimPublication(state, save);
            if (claimed) return claimed;
            const round = gameState(state).round;
            if (round?.id !== sourceId || !round.result || !state.settings.taixiuRoom) return null;
            return reserveBoard(state, save, automaticRound(state), 'new');
        });
        const result = await publishBoard(guild, prepared);
        if (result?.stale) retryBoard(guild);
        return result;
    });
}

function scheduleNextRound(guild, round, wait = RESULT_MS) {
    if (!nextRounds.has(guild)) nextRounds.set(guild, new Set());
    const pending = nextRounds.get(guild);
    if (pending.has(round.id)) return;
    pending.add(round.id);
    setTimeout(async () => {
        pending.delete(round.id);
        try { await openNextAutomaticBoard(guild, round.id); }
        catch (error) {
            console.error('Lỗi mở ván Tiệm Bánh Mây tiếp theo:', error.message);
            scheduleNextRound(guild, round, 30000);
        }
    }, wait).unref();
}

async function syncAutomaticBoard(guild) {
    let restoringDraw;
    const synced = await boardTask(guild, async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
            const plan = await transactGame(guild.id, async (state, save, afterCommit) => {
                const game = gameState(state);
                const claimed = await claimPublication(state, save);
                if (claimed) return claimed;
                const round = game.round;
                const setting = state.settings.taixiuRoom;
                if (round && !round.result && round.closesAt != null) {
                    if (round.closesAt <= Date.now()) {
                        if (round.draw && !reveals.get(guild)?.has(round.id)) restoringDraw = round.id;
                        await beginDrawIfDue(guild, game, save, afterCommit);
                        return { game };
                    }
                    afterCommit(() => scheduleRound(guild, round));
                    return { game, refresh: round.automatic ? round : null };
                }
                if (round?.result && reveals.get(guild)?.has(round.id)) return { game };
                if (!setting) {
                    if (round?.automatic && !round.result) {
                        game.round = null;
                        await save();
                        return { game, retire: round };
                    }
                    return { game, refresh: round?.result ? round : null };
                }
                if (round?.automatic && round.channelId === setting.channelId) {
                    return { game, refresh: round, next: Boolean(round.result) };
                }
                return reserveBoard(state, save, automaticRound(state), 'new');
            });
            if (plan.publication || plan.busy) {
                const result = await publishBoard(guild, plan);
                if (result?.stale) continue;
                return result;
            }
            const ranking = cacheLeaderboard(guild, plan.game);
            await ranking.edit;
            if (plan.retire) await retireBoard(guild, plan.retire);
            if (plan.refresh) {
                let visible;
                try { visible = await refreshRound(guild, plan.refresh, 'board', true); }
                catch (error) {
                    if (!wasDeleted(error)) throw error;
                    const prepared = await transactGame(guild.id, (state, save) =>
                        reserveRepair(guild, state, save, { id: plan.refresh.id, messageId: plan.refresh.messageId }));
                    const repaired = await publishBoard(guild, prepared);
                    if (repaired?.stale) continue;
                    return repaired;
                }
                if (plan.next) scheduleNextRound(guild, plan.refresh, visible ? RESULT_MS : 0);
            }
            return plan.game.round;
        }
        retryBoard(guild);
        return null;
    });
    // A resumed persisted draw restores its destination before startup reports
    // success. Release the publication queue before waiting: repair uses it too.
    if (restoringDraw) await revealStarts.get(guild)?.get(restoringDraw);
    return synced;
}

async function reserveRepair(guild, state, save, { id, messageId, deletedIds, drawing = false } = {}) {
    const claimed = await claimPublication(state, save);
    if (claimed) return claimed;
    const round = gameState(state).round;
    if (!round || (id && round.id !== id) || (messageId && round.messageId !== messageId) ||
        (deletedIds && !deletedIds.has(round.messageId))) return null;
    if (drawing && !round.draw) return null;
    if (!round.draw && (!round.automatic || !state.settings.taixiuRoom)) return null;
    if (round.result) {
        return reveals.get(guild)?.has(round.id) ? null : reserveBoard(state, save, automaticRound(state), 'new');
    }
    const channel = automaticChannel(guild, round.channelId) ?? automaticChannel(guild, state.settings.taixiuRoom?.channelId);
    return channel ? reserveBoard(state, save, { ...round, channelId: channel.id }, 'repair', true) : null;
}

async function repairBoard(guild, options) {
    return boardTask(guild, async () => {
        const prepared = await transactGame(guild.id, (state, save) => reserveRepair(guild, state, save, options));
        const result = await publishBoard(guild, prepared);
        if (result?.stale) retryBoard(guild);
        return result?.stale ? null : result;
    });
}

function waitForRound(ms) {
    return new Promise(resolve => setTimeout(resolve, ms).unref());
}

async function publishDraw(guild, round) {
    try {
        if (await refreshRound(guild, round, 'draw')) return round;
        if (automaticChannel(guild, round.channelId)) return null;
    } catch (error) {
        if (error.code !== RESTJSONErrorCodes.UnknownMessage) throw error;
    }
    const target = await repairBoard(guild, { id: round.id, messageId: round.messageId, drawing: true });
    return target && await refreshRound(guild, target, 'draw') ? target : null;
}

async function payRound(guild, shown) {
    const paid = await transactGame(guild.id, async (state, save) => {
        const game = gameState(state);
        const { round } = game;
        if (round?.id !== shown.id || !round.draw || round.messageId !== shown.messageId || round.channelId !== shown.channelId) return null;
        const rolls = recentRolls(game);
        round.result = round.draw;
        delete round.draw;
        delete round.betRequests;
        const { winner } = round.result;
        const results = {};
        const history = game.history ??= {};
        const at = Date.now();
        game.rolls = [{ at, ...round.result }, ...rolls].slice(0, DICE_HISTORY_LIMIT);
        for (const [id, bet] of Object.entries(round.bets)) {
            const stakes = readStakes(bet, round.bet);
            const payout = payoutFor(stakes, winner);
            if (payout > 0n) addWalletCoins(game, id, payout);
            results[id] = { at, winner, tai: serializeCoins(stakes.tai), xiu: serializeCoins(stakes.xiu) };
            history[id] = [results[id], ...recentResults(game, id)].slice(0, HISTORY_LIMIT);
        }
        await save();
        return { round, game, results };
    });
    if (!paid) return null;
    cacheLeaderboard(guild, paid.game);
    const recipients = betReplies.get(guild);
    betReplies.delete(guild);
    return { ...paid, recipients };
}

async function revealRound(guild, round, lastCountdownEdit, animate) {
    if (!reveals.has(guild)) reveals.set(guild, new Set());
    const pending = reveals.get(guild);
    if (pending.has(round.id)) return;
    pending.add(round.id);
    let ready;
    if (!revealStarts.has(guild)) revealStarts.set(guild, new Map());
    const starts = revealStarts.get(guild);
    starts.set(round.id, new Promise(resolve => { ready = resolve; }));
    try {
        await lastCountdownEdit;
        let target = round;
        for (;;) {
            try {
                target ??= gameState(await readGame(guild.id)).round;
                if (target?.id !== round.id || !target.draw) return;
                if (animate) {
                    animate = false;
                    if (await refreshRound(guild, target, 'roll')) await waitForRound(ROLL_MS);
                }
                const shown = await publishDraw(guild, target);
                ready();
                if (shown) {
                    await waitForRound(PAYOUT_DELAY_MS);
                    const paid = await payRound(guild, shown);
                    if (paid) {
                        sendPersonalResults(paid.recipients, paid.results);
                        const visible = await refreshRound(guild, paid.round);
                        scheduleNextRound(guild, paid.round, visible ? RESULT_MS : 0);
                        return;
                    }
                }
            } catch (error) {
                console.error('Lỗi công bố kết quả Tiệm Bánh Mây:', error.message);
            }
            ready();
            target = null;
            await waitForRound(REVEAL_RETRY_MS);
        }
    } finally {
        ready();
        starts.delete(round.id);
        pending.delete(round.id);
        queueLeaderboardRefresh(guild);
    }
}

function sendPersonalResults(recipients, results) {
    if (!recipients) return;
    for (const [userId, { interaction, confirmation }] of recipients) {
        void confirmation.then(() => interaction.followUp({
            content: personalResult(results[userId]), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] }
        })).catch(() => {});
    }
    recipients.clear();
}

async function beginDrawIfDue(guild, game, save, afterCommit) {
    const round = game.round;
    if (!round || round.result || round.closesAt == null || round.closesAt > Date.now()) return;
    const animate = !round.draw && (timers.get(guild)?.id === round.id || Date.now() - round.closesAt < ROLL_RESUME_GRACE_MS);
    if (!round.draw) {
        const dice = Array.from({ length: 3 }, () => crypto.randomInt(1, 7));
        const total = dice.reduce((sum, face) => sum + face, 0);
        const winner = dice.every(face => face === dice[0]) ? 'tie' : (total >= 11 ? 'tai' : 'xiu');
        round.draw = { dice, total, winner };
        await save();
    }
    afterCommit(() => {
        const lastCountdownEdit = stopRoundTimer(guild, round.id) ?? leaderboards.get(guild)?.edit;
        void revealRound(guild, round, lastCountdownEdit, animate)
            .catch(error => console.error('Lỗi hiển thị kết quả Tiệm Bánh Mây:', error.message));
    });
}

function stopRoundTimer(guild, roundId) {
    const scheduled = timers.get(guild);
    if (!scheduled || scheduled.id !== roundId) return;
    clearTimeout(scheduled.timer);
    clearTimeout(scheduled.countdown);
    timers.delete(guild);
    return scheduled.pendingEdit;
}

function updateCountdown(guild, scheduled) {
    if (timers.get(guild) !== scheduled || scheduled.round.closesAt - Date.now() < MIN_BOARD_UPDATE_LEAD_MS ||
        scheduled.pendingEdit || leaderboards.get(guild)?.edit) return;
    scheduled.pendingEdit = refreshRound(guild, scheduled.round).finally(() => {
        scheduled.pendingEdit = null;
    });
}

function scheduleCountdown(guild, scheduled) {
    const now = Date.now();
    const nextTick = COUNTDOWN_CHECKPOINTS.map(seconds => scheduled.round.closesAt - seconds * SECOND_MS).find(at => at > now);
    if (nextTick == null) return;
    scheduled.countdown = setTimeout(() => {
        if (timers.get(guild) !== scheduled) return;
        updateCountdown(guild, scheduled);
        scheduleCountdown(guild, scheduled);
    }, nextTick - now).unref();
}

function scheduleRound(guild, round, delay = Math.max(0, round.closesAt - Date.now())) {
    if (round.draw) return;
    const current = timers.get(guild);
    if (current?.id === round.id) {
        current.round = round;
        return current;
    }
    if (current) stopRoundTimer(guild, current.id);
    const scheduled = { id: round.id, round, pendingEdit: null };
    scheduleCountdown(guild, scheduled);
    scheduled.timer = setTimeout(async () => {
        try {
            const pending = await transactGame(guild.id, async (state, save, afterCommit) => {
                const game = gameState(state);
                if (game.round?.id !== round.id || game.round.result) return null;
                await beginDrawIfDue(guild, game, save, afterCommit);
                return game.round.draw || game.round.result ? null : game.round;
            });
            if (timers.get(guild) === scheduled) stopRoundTimer(guild, round.id);
            if (pending && !timers.has(guild)) scheduleRound(guild, pending);
        } catch (error) {
            console.error('Lỗi tính kết quả Tiệm Bánh Mây:', error.message);
            if (timers.get(guild) === scheduled) stopRoundTimer(guild, round.id);
            if (!timers.has(guild)) scheduleRound(guild, round, 5000);
        }
    }, delay).unref();
    timers.set(guild, scheduled);
    return scheduled;
}

function heldBet(game, userId) {
    const round = game.round;
    if (!round || round.result || !Object.hasOwn(round.bets, userId)) return 0n;
    const stakes = readStakes(round.bets[userId], round.bet);
    return stakes.tai + stakes.xiu;
}

function betError(state, round, interaction, id) {
    if (!round || !interaction.message || round.id !== id || round.channelId !== interaction.channelId || round.messageId !== interaction.message.id) {
        return '⌛ Bàn này đã kết thúc.';
    }
    if (round.result || (round.closesAt != null && round.closesAt <= Date.now())) return '⌛ Đã hết giờ đặt cược.';
    if (round.closesAt == null && state.settings.taixiuRoom?.channelId !== round.channelId) return '⌛ Bàn tự động đã chuyển hoặc tắt.';
}

function leaderboardLines(game, limit) {
    const top = [];
    for (const [id, balance] of Object.entries(game.balances)) {
        const player = { id, total: readCoins(balance) + heldBet(game, id) };
        const position = top.findIndex(other => player.total > other.total ||
            (player.total === other.total && player.id.localeCompare(other.id) < 0));
        if (position >= 0) top.splice(position, 0, player);
        else if (top.length < limit) top.push(player);
        if (top.length > limit) top.pop();
    }
    if (!top.length) return EMPTY_LEADERBOARD;
    let rank = 1;
    return top.map(({ id, total }, index) => {
        if (index > 0 && top[index - 1].total !== total) rank = index + 1;
        return `**${rank}.** <@${id}> · **${coins(total)}**`;
    }).join('\n');
}

function cacheLeaderboard(guild, game) {
    const ranking = leaderboards.get(guild) ?? {};
    ranking.revision = (ranking.revision ?? 0) + 1;
    ranking.description = leaderboardLines(game, 5);
    ranking.rolls = recentRolls(game);
    ranking.needsReload = false;
    leaderboards.set(guild, ranking);
    return ranking;
}

function queueLeaderboardRefresh(guild) {
    const ranking = leaderboards.get(guild);
    if (!ranking || ranking.timer || ranking.edit || ranking.publishing || (!ranking.needsReload && ranking.description === ranking.published)) return;
    ranking.timer = setTimeout(() => {
        ranking.timer = null;
        const revision = ranking.revision;
        void transactGame(guild.id, state => gameState(state)).then(game => {
            if (ranking.publishing) return;
            if (ranking.revision !== revision) { queueLeaderboardRefresh(guild); return; }
            if (ranking.needsReload) {
                cacheLeaderboard(guild, game);
                ranking.needsReload = false;
            }
            const { round } = game;
            if (!round?.messageId || ranking.edit || ranking.description === ranking.published) return;
            // Active rounds carry the ranking in their scheduled board updates.
            if ((round.closesAt != null && !round.result) || reveals.get(guild)?.has(round.id)) return;
            const sent = ranking.description;
            ranking.edit = refreshRound(guild, round).finally(() => {
                ranking.edit = null;
                if (ranking.needsReload || ranking.description !== sent) queueLeaderboardRefresh(guild);
            });
        }).catch(error => console.error('Lỗi cập nhật xếp hạng Tiệm Bánh Mây:', error.message));
    }, LEADERBOARD_REFRESH_MS).unref();
}

function updateLeaderboard(guild, game) {
    cacheLeaderboard(guild, game);
    const { round } = game;
    if (round && (round.closesAt == null || round.result)) queueLeaderboardRefresh(guild);
}

function queueLeaderboardReload(guild) {
    if (!guild?.channels?.cache) return;
    const ranking = leaderboards.get(guild);
    // Startup/setup seed the ranking for an existing board. Pure wallet users
    // do not need a background full-wallet read after every trade.
    if (!ranking) return;
    ranking.revision = (ranking.revision ?? 0) + 1;
    ranking.needsReload = true;
    leaderboards.set(guild, ranking);
    queueLeaderboardRefresh(guild);
}

function refreshCoinLeaderboard(guild, state, scope) {
    if (scope && scope.wallets !== 'all') queueLeaderboardReload(guild);
    else updateLeaderboard(guild, gameState(state));
}

async function exchangeWalletCoins(guild, userId, change, applyTrade, scope) {
    let savedState;
    const result = await store.transact(guild.id, async (state, save) => {
        const game = gameState(state);
        const balance = walletBalance(game, userId);
        if (balance + change < 0n) return { balance };
        const reward = applyTrade(state);
        if (!reward) return { balance };
        const remaining = addWalletCoins(game, userId, change);
        await save();
        savedState = state;
        return { balance: remaining, reward };
    }, scope);
    if (savedState) {
        try { refreshCoinLeaderboard(guild, savedState, scope); }
        catch (error) { console.error('Lỗi cập nhật xếp hạng sau giao dịch xu:', error.message); }
    }
    return result;
}

async function purchaseWithCoins(guild, userId, price, grantReward, scope) {
    if (price <= 0n) throw new RangeError('The purchase price must be positive.');
    return exchangeWalletCoins(guild, userId, -price, grantReward, scope);
}

async function sellForCoins(guild, userId, proceeds, removeItem, scope) {
    if (proceeds <= 0n) throw new RangeError('The sale proceeds must be positive.');
    return exchangeWalletCoins(guild, userId, proceeds, removeItem, scope);
}

module.exports = {
    automaticChannel,
    syncAutomaticBoard,
    getCoinBalance: (state, userId) => walletBalance(gameState(state), userId),
    refreshCoinLeaderboard,
    formatCoins: coins,
    purchaseWithCoins,
    sellForCoins,
    data: new SlashCommandBuilder().setName('tiembanh').setDescription('Chơi Tiệm Bánh Mây bằng xu ảo và xem bảng xếp hạng')
        .addSubcommand(command => command.setName('play').setDescription('Mở hoặc đến bàn Tiệm Bánh Mây'))
        .addSubcommand(command => command.setName('wallet').setDescription('Xem số xu của bạn trong máy chủ'))
        .addSubcommand(command => command.setName('daily').setDescription('Điểm danh nhận 5,000,000 xu mỗi 8 giờ'))
        .addSubcommand(command => command.setName('top').setDescription('Xem 10 người có nhiều xu nhất'))
        .addSubcommand(command => command.setName('history').setDescription('Xem lịch sử cược của bạn trên máy chủ'))
        .addSubcommand(command => command.setName('dice').setDescription('Xem các kết quả xúc xắc gần nhất của máy chủ')),

    async execute(interaction) {
        const action = interaction.options.getSubcommand();
        if (action === 'play') return this.play(interaction);
        if (action === 'daily') return this.claimDaily(interaction);
        if (action === 'history') return this.showHistory(interaction);
        if (action === 'dice') return this.showDiceHistory(interaction);
        return this.showStats(interaction, action);
    },

    async handlePrivateMessage(message) {
        if (message.channel?.type !== ChannelType.DM || message.author.bot ||
            message.author.id !== process.env.TAIXIU_OWNER_ID?.trim()) return;

        const [command, guildId, input, userId = message.author.id, extra] = message.content.trim().split(/\s+/);
        if (command !== '!addxu') return;
        const amount = parseCoins(input);
        if (!discordId.test(guildId ?? '') || !discordId.test(userId) || !amount || extra) {
            return message.reply('Cú pháp `!addxu <ID máy chủ> <số xu> [ID người nhận]`. Nhập số dương có tối đa 2 chữ số thập phân. Bỏ ID người nhận để cộng cho bạn.');
        }
        const guild = message.client.guilds.cache.get(guildId);
        if (!guild?.available || !isGuildAllowed(guildId)) {
            return message.reply('❌ Bot không hoạt động trên máy chủ này. Hãy kiểm tra ID máy chủ.');
        }
        const member = await guild.members.fetch({ user: userId, force: true, cache: false }).catch(error => {
            if (![RESTJSONErrorCodes.UnknownMember, RESTJSONErrorCodes.UnknownUser].includes(error.code)) throw error;
            return null;
        });
        if (!member || member.user.bot) return message.reply('❌ Hãy chọn một người đang là thành viên của máy chủ.');

        const result = await transactGame(guildId, async (state, save, afterCommit) => {
            const game = gameState(state);
            const grants = game.recentCoinGrants ?? [];
            if (grants.includes(message.id)) return 'ℹ️ Yêu cầu này đã được cộng xu.';
            const balance = addWalletCoins(game, userId, amount);
            game.recentCoinGrants = [...grants, message.id].slice(-RECENT_COIN_GRANT_LIMIT);
            await save();
            afterCommit(() => updateLeaderboard(guild, game));
            return `✅ Đã cộng **${coins(amount)}** cho ID \`${userId}\` trên **${guild.name}**. Số dư có thể dùng là **${coins(balance)}**.`;
        });
        return message.reply(result);
    },

    async showStats(interaction, action) {
        const { guild, user } = interaction;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const message = await transactGame(guild.id, async (state, save, afterCommit) => {
            const game = gameState(state);
            await beginDrawIfDue(guild, game, save, afterCommit);
            if (action === 'top') return `**${LEADERBOARD_TITLE}**\n${leaderboardLines(game, 10)}`;
            if (action === 'result') return personalResult(recentResults(game, user.id)[0]);
            if (!Object.hasOwn(game.balances, user.id)) {
                game.balances[user.id] = serializeCoins(STARTING_BALANCE);
                await save();
                afterCommit(() => updateLeaderboard(guild, game));
            }
            const held = heldBet(game, user.id);
            return `🪙 Bạn có **${coins(walletBalance(game, user.id))}** có thể dùng.` +
                (held ? ` Đang đặt cược **${coins(held)}**.` : '') + `\n${DAILY_HINT}`;
        });
        return edit(interaction, message);
    },

    async showHistory(interaction, requestedPage) {
        const { guild, user } = interaction;
        if (requestedPage === undefined) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        else await interaction.deferUpdate();
        const entries = await transactGame(guild.id, async (state, save, afterCommit) => {
            const game = gameState(state);
            await beginDrawIfDue(guild, game, save, afterCommit);
            return recentResults(game, user.id);
        });
        if (!entries.length) return interaction.editReply({ content: 'Bạn chưa có lịch sử cược trên máy chủ này.', embeds: [], components: [] });

        const pages = Math.ceil(entries.length / HISTORY_PAGE_SIZE);
        const page = Math.min(requestedPage ?? 1, pages);
        const start = (page - 1) * HISTORY_PAGE_SIZE;
        const embed = new EmbedBuilder().setTitle('📜 Lịch sử Tiệm Bánh Mây').setColor('#5865f2')
            .setDescription(entries.slice(start, start + HISTORY_PAGE_SIZE).map(personalResult).join('\n\n'))
            .setFooter({ text: `Trang ${page}/${pages} · ${entries.length} ván gần nhất` });
        const components = [];
        if (pages > 1) {
            components.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`mg_taixiu_historypage_${page - 1}`).setLabel('Trang trước')
                    .setStyle(ButtonStyle.Secondary).setDisabled(page === 1),
                new ButtonBuilder().setCustomId(`mg_taixiu_historypage_${page + 1}`).setLabel('Trang sau')
                    .setStyle(ButtonStyle.Secondary).setDisabled(page === pages)
            ));
        }
        return interaction.editReply({ embeds: [embed], components, allowedMentions: { parse: [] } });
    },

    async showDiceHistory(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const rolls = recentRolls(gameState(await readGame(interaction.guild.id)));
        if (!rolls.length) return edit(interaction, 'Chưa có ván Tiệm Bánh Mây nào hoàn tất trên máy chủ này.');
        const lines = rolls.map(roll => `${rollLine(roll)} · <t:${Math.floor(roll.at / SECOND_MS)}:f>`);
        const embed = new EmbedBuilder().setTitle(DICE_HISTORY_TITLE).setColor('#5865f2')
            .setDescription(lines.join('\n')).setFooter({ text: `${rolls.length} ván · Mới nhất ở trên` });
        return interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
    },

    async claimDaily(interaction) {
        const { guild, user } = interaction;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const message = await transactGame(guild.id, async (state, save, afterCommit) => {
            const game = gameState(state);
            const now = Date.now();
            // Keep timestamps separate from the old dailyClaims calendar-day indexes.
            const claims = game.dailyClaimTimes ??= {};
            const lastClaim = claims[user.id];
            if (Number.isSafeInteger(lastClaim) && lastClaim >= 0 && now < lastClaim + DAILY_COOLDOWN_MS) {
                const next = Math.ceil((lastClaim + DAILY_COOLDOWN_MS) / SECOND_MS);
                return `⏳ Bạn cần chờ đủ 8 giờ giữa hai lần điểm danh. Lượt tiếp theo <t:${next}:R>.`;
            }
            const balance = addWalletCoins(game, user.id, DAILY_REWARD);
            claims[user.id] = now;
            await save();
            afterCommit(() => updateLeaderboard(guild, game));
            const next = Math.ceil((now + DAILY_COOLDOWN_MS) / SECOND_MS);
            return `✅ Điểm danh thành công. Bạn nhận **${coins(DAILY_REWARD)}** và hiện có **${coins(balance)}**.\nLượt tiếp theo <t:${next}:R>.`;
        });
        return edit(interaction, message);
    },

    async play(interaction, replayId) {
        const { channel, guild, member } = interaction;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const plan = await boardTask(guild, async () => {
            const prepared = await transactGame(guild.id, async (state, save, afterCommit) => {
                const game = gameState(state);
                await beginDrawIfDue(guild, game, save, afterCommit);
                if (state.settings.taixiuRoom) {
                    const current = game.round;
                    const waitingForNext = current?.result && nextRounds.get(guild)?.has(current.id);
                    return { automatic: true, sync: !current?.automatic || current.channelId !== state.settings.taixiuRoom.channelId ||
                        (current.result && !waitingForNext) };
                }
                if (channel?.type !== ChannelType.GuildText ||
                    !hasChannelPermissions(channel, member, [ViewChannel, SendMessages]) ||
                    !hasChannelPermissions(channel, guild.members.me, [ViewChannel, SendMessages, EmbedLinks])) {
                    return { message: '❌ Hãy dùng trong kênh chữ mà bạn và bot có thể gửi tin. Bot cần quyền Nhúng liên kết.' };
                }
                if (game.round && !game.round.result) {
                    if (game.round.closesAt != null && !game.round.draw) afterCommit(() => scheduleRound(guild, game.round));
                    return { message: `ℹ️ Máy chủ đang có một bàn ở <#${game.round.channelId}>.` };
                }
                if (replayId) {
                    const previous = game.round;
                    if (!previous?.result || previous.id !== replayId || previous.channelId !== channel.id ||
                        previous.messageId !== interaction.message?.id) {
                        return { message: '⌛ Bàn này đã cũ. Bạn có thể mở bàn bằng /tiembanh play.' };
                    }
                }
                const claimed = await claimPublication(state, save);
                if (claimed) return claimed;
                return reserveBoard(state, save, {
                    id: interaction.id, channelId: channel.id, closesAt: Date.now() + ROUND_MS, bets: {}
                }, 'new');
            });
            if (prepared.message || prepared.automatic) return prepared;
            const round = await publishBoard(guild, prepared);
            if (!round || round.stale) {
                retryBoard(guild);
                return { message: '⏳ Bàn đang được khôi phục. Hãy thử lại sau vài giây.' };
            }
            return { message: `✅ Đã mở bàn ở <#${round.channelId}>. Bấm **${sides.tai}** hoặc **${sides.xiu}** để nhập số xu cược.` };
        });
        if (plan.automatic) {
            if (plan.sync) await syncAutomaticBoard(guild);
            const state = await readGame(guild.id);
            const board = gameState(state).round;
            const channelId = state.settings.taixiuRoom?.channelId;
            if (board?.automatic && board.channelId === channelId) {
                return edit(interaction, `🎲 Bấm nút cược trên bàn ở <#${board.channelId}>. <https://discord.com/channels/${guild.id}/${board.channelId}/${board.messageId}>`);
            }
            return edit(interaction, channelId ? `🎲 Kênh Tiệm Bánh Mây tự động là <#${channelId}>.` : 'ℹ️ Bàn tự động đã tắt. Dùng /tiembanh play để mở bàn.');
        }
        return edit(interaction, plan.message);
    },

    async button(interaction) {
        const [choice, id] = interaction.customId.slice('mg_taixiu_'.length).split('_');
        if (choice === 'wallet' || choice === 'top' || choice === 'result') return this.showStats(interaction, choice);
        if (choice === 'history') return this.showHistory(interaction);
        if (choice === 'dice') return this.showDiceHistory(interaction);
        if (choice === 'historypage') return this.showHistory(interaction, Math.max(1, Number.parseInt(id, 10) || 1));
        if (choice === 'daily') return this.claimDaily(interaction);
        if (choice === 'replay' && id) return this.play(interaction, id);
        if (!Object.hasOwn(sides, choice)) return respond(interaction, '❌ Lựa chọn không hợp lệ.');
        const state = await readGame(interaction.guildId);
        const game = gameState(state);
        const error = betError(state, game.round, interaction, id);
        if (error) return respond(interaction, error);
        const balance = walletBalance(game, interaction.user.id);
        if (balance === 0n) return respond(interaction, `🪙 Bạn đã hết xu. ${DAILY_HINT}`);
        const description = `Ví có ${coins(balance)}. Gõ all để cược hết số dư.`;
        const input = new TextInputBuilder().setCustomId('amount').setStyle(TextInputStyle.Short)
            .setPlaceholder('Ví dụ: 1,000,000 hoặc all').setRequired(true);
        const modal = new ModalBuilder().setCustomId(`mg_taixiu_bet_${choice}_${id}`).setTitle(`Cược ${sides[choice]}`);
        if (typeof modal.addLabelComponents === 'function' && LabelBuilder) {
            modal.addLabelComponents(new LabelBuilder().setLabel('Số xu cược').setDescription(description).setTextInputComponent(input));
        } else {
            modal.addComponents(new ActionRowBuilder().addComponents(input.setLabel('Số xu cược').setPlaceholder(description)));
        }
        return interaction.showModal(modal);
    },

    async modal(interaction) {
        const [choice, id] = interaction.customId.slice('mg_taixiu_bet_'.length).split('_');
        if (!Object.hasOwn(sides, choice)) return respond(interaction, '❌ Lựa chọn không hợp lệ.');
        const input = interaction.fields.getTextInputValue('amount').trim();
        const allIn = input.toLowerCase() === 'all';
        const requestedAmount = parseCoins(input);
        if (!allIn && requestedAmount === null) {
            return respond(interaction, '❌ Nhập số dương có tối đa 2 chữ số thập phân hoặc gõ `all` để cược hết số dư.');
        }
        const { guild, user } = interaction;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const result = await transactGame(guild.id, async (state, save, afterCommit) => {
            const game = gameState(state);
            await beginDrawIfDue(guild, game, save, afterCommit);
            const round = game.round;
            const error = betError(state, round, interaction, id);
            if (error) return error;
            if (interaction.id && round.betRequests?.includes(interaction.id)) return 'ℹ️ Lượt cược này đã được ghi nhận.';
            const ready = round.closesAt == null;
            const newWallet = !Object.hasOwn(game.balances, user.id);
            const balance = walletBalance(game, user.id);
            if (balance === 0n) return `🪙 Bạn đã hết xu. ${DAILY_HINT}`;
            const amount = allIn ? balance : requestedAmount;
            if (balance < amount) return `❌ Bạn còn **${coins(balance)}**. Hãy nhập số nhỏ hơn hoặc điểm danh để nhận xu.`;
            const remaining = balance - amount;
            const stakes = readStakes(round.bets[user.id], round.bet);
            stakes[choice] += amount;
            game.balances[user.id] = serializeCoins(remaining);
            round.bets[user.id] = { tai: serializeCoins(stakes.tai), xiu: serializeCoins(stakes.xiu) };
            if (interaction.id) (round.betRequests ??= []).push(interaction.id);
            if (ready) round.closesAt = Date.now() + ROUND_MS;
            await save();
            const receipt = `✅ Đã đặt **${coins(amount)}** vào **${sides[choice]}**. Ví còn **${coins(remaining)}**.\n` +
                `Cược ván này · ${sides.tai} **${coins(stakes.tai)}** · ${sides.xiu} **${coins(stakes.xiu)}**`;
            return { game, round, newWallet, ready, receipt };
        });
        if (typeof result === 'string') return edit(interaction, result);
        // Publish receipts and schedule work only after the database commit succeeds.
        if (result.newWallet) cacheLeaderboard(guild, result.game);
        const scheduled = scheduleRound(guild, result.round);
        if (result.ready) {
            const previousEdit = leaderboards.get(guild)?.edit;
            if (previousEdit) void previousEdit.then(() => updateCountdown(guild, scheduled));
            else updateCountdown(guild, scheduled);
        }
        const confirmation = edit(interaction, result.receipt);
        const recipients = betReplies.get(guild) ?? new Map();
        recipients.set(user.id, { interaction, confirmation });
        betReplies.set(guild, recipients);
        return confirmation;
    },

    async resume(guild) {
        return syncAutomaticBoard(guild);
    },

    async recoverDeleted(guild, ids) {
        return repairBoard(guild, { deletedIds: ids });
    }
};
