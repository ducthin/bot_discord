const crypto = require('node:crypto');
const store = require('./managementStore');
const { cases, collections, skins } = require('./cs2Catalogue');
const { COIN_SCALE, readCoins, serializeCoins } = require('./coins');
const { getPlayerSkinImage } = require('./playerAssets');

const DAY = 24 * 60 * 60_000;
const BANGKOK_OFFSET = 7 * 60 * 60_000;
const DAILY_ATTACK_LIMIT = 3;
const MAX_PHASES = 3;
const MAX_LEADERBOARD = 250;
const MAX_RECENT = 12;
const RALLY_TTL = 3 * 60_000;
const RALLY_DAMAGE = 75;
const DAILY_MISSIONS = Object.freeze([
    { id: 'daily-attacks', label: 'Ra chiến trường', description: 'Tấn công Boss 2 lần hôm nay', target: 2, rewardXp: 12, rewardCoins: 3_000_000 },
    { id: 'daily-tactic', label: 'Chọn chiến thuật', description: 'Dùng Ngắm điểm yếu hoặc Tiếp sức 1 lần', target: 1, rewardXp: 10, rewardCoins: 2_000_000 },
    { id: 'daily-veteran', label: 'Không bỏ cuộc', description: 'Dùng cả 3 lượt săn Boss hôm nay', target: 3, rewardXp: 18, rewardCoins: 5_000_000 }
]);
const WEEKLY_MISSIONS = Object.freeze([
    { id: 'attacks', label: 'Ra chiến trường', description: 'Tấn công Boss 9 lần trong tuần', target: 9, rewardXp: 60, rewardCoins: 10_000_000 },
    { id: 'precision', label: 'Xạ thủ chính xác', description: 'Dùng Ngắm điểm yếu 3 lần', target: 3, rewardXp: 35, rewardCoins: 5_000_000 },
    { id: 'rally', label: 'Sức mạnh đồng đội', description: 'Gửi Tiếp sức đồng đội 3 lần', target: 3, rewardXp: 35, rewardCoins: 5_000_000 },
    { id: 'damage', label: 'Gây sát thương', description: 'Gây tổng cộng 1.500 sát thương', target: 1500, rewardXp: 50, rewardCoins: 10_000_000 }
]);
const ATTACKS = Object.freeze({
    steady: { label: 'Tấn công ổn định', minimum: 175, maximum: 206 },
    precision: { label: 'Ngắm điểm yếu', minimum: 120, maximum: 221 },
    rally: { label: 'Tiếp sức đồng đội', minimum: 100, maximum: 141 }
});
const BOSSES = Object.freeze([
    { id: 'ash-dragon', name: 'Hỏa Long Tro Tàn', icon: '🐉', color: '#f47855', description: 'Một cổ long thức giấc dưới lòng thành phố. Cả máy chủ hợp sức để chặn nó.' },
    { id: 'frost-colossus', name: 'Cự Nhân Băng Giá', icon: '❄️', color: '#72c6ff', description: 'Phá vỡ lớp giáp băng trước khi cơn bão phủ kín chiến trường.' },
    { id: 'iron-hydra', name: 'Thủy Quái Thiết Giáp', icon: '⚙️', color: '#c89bff', description: 'Ba đầu máy móc chỉ khuất phục khi mọi người phối hợp đúng lúc.' }
]);
const RANKS = Object.freeze([
    { xp: 0, label: 'Tân binh', icon: '◇' },
    { xp: 120, label: 'Trinh sát', icon: '⌖' },
    { xp: 360, label: 'Chiến binh', icon: '⚔' },
    { xp: 800, label: 'Kỳ cựu', icon: '✦' },
    { xp: 1600, label: 'Huyền thoại', icon: '♛' }
]);
const CASE_REWARDS = Object.freeze({
    fever: Object.freeze({ caseId: 'crate-7007', keyId: 'key-7008', label: 'Fever Case + chìa' }),
    kilowatt: Object.freeze({ caseId: 'crate-4904', keyId: 'key-1394', label: 'Kilowatt Case + chìa' }),
    revolution: Object.freeze({ caseId: 'crate-4880', keyId: 'key-1393', label: 'Revolution Case + chìa' }),
    dreams: Object.freeze({ caseId: 'crate-4818', keyId: 'key-1391', label: 'Dreams & Nightmares Case + chìa' }),
    breakout: Object.freeze({ caseId: 'crate-4018', keyId: 'key-1309', label: 'Operation Breakout Case + chìa' })
});
const BOSS_VICTORY_REWARD = Object.freeze({
    caseReward: CASE_REWARDS.breakout,
    coins: 20_000_000,
    label: 'Hòm chiến thắng Boss'
});
const DAILY_COMPLETION_COINS = 10_000_000;
const WEEKLY_COMPLETION_COINS = 10_000_000;
const COLLECTION_SET_REWARD = Object.freeze({ coins: 5_000_000, caseReward: CASE_REWARDS.kilowatt });
const rewardCoins = (amount, id, label) => ({ id, label, coins: amount });
const rewardCase = (id, label, reward, coins = 0) => ({ id, label, caseReward: reward, ...(coins ? { coins } : {}) });
const DAILY_ACTIVITY_MISSIONS = Object.freeze([
    { id: 'open-cases', label: 'Mở hòm tiếp tế', description: 'Mở 3 hòm bất kỳ', action: 'openCases', target: 3, rewardXp: 40, reward: rewardCase('fever-case', CASE_REWARDS.fever.label, CASE_REWARDS.fever, 5_000_000) },
    { id: 'battle-round', label: 'Vào sàn Battle', description: 'Hoàn tất 1 Battle', action: 'battles', target: 1, rewardXp: 35, reward: rewardCoins(10_000_000, 'battle-coins', '10.000.000 xu') },
    { id: 'upgrade-run', label: 'Thử vận may', description: 'Hoàn tất 1 lượt Upgrade', action: 'upgrades', target: 1, rewardXp: 30, reward: rewardCase('kilowatt-case', CASE_REWARDS.kilowatt.label, CASE_REWARDS.kilowatt, 5_000_000) },
    { id: 'new-finish', label: 'Nhặt finish mới', description: 'Nhận 2 finish chưa từng có', action: 'newSkins', target: 2, rewardXp: 35, reward: rewardCoins(10_000_000, 'finish-coins', '10.000.000 xu') },
    { id: 'boss-strike', label: 'Đánh dấu Boss', description: 'Gây 1 đòn lên Boss tuần', action: 'bossAttacks', target: 1, rewardXp: 30, reward: rewardCase('fever-case', CASE_REWARDS.fever.label, CASE_REWARDS.fever, 5_000_000) }
]);
const WEEKLY_ACTIVITY_MISSIONS = Object.freeze([
    { id: 'open-cases', label: 'Kho hòm mở rộng', description: 'Mở 15 hòm trong tuần', action: 'openCases', target: 15, rewardXp: 120, reward: rewardCase('revolution-case', CASE_REWARDS.revolution.label, CASE_REWARDS.revolution, 10_000_000) },
    { id: 'battle-rounds', label: 'Đấu sĩ cuối tuần', description: 'Hoàn tất 5 Battle', action: 'battles', target: 5, rewardXp: 120, reward: rewardCoins(20_000_000, 'battle-weekly-coins', '20.000.000 xu') },
    { id: 'upgrade-runs', label: 'Thợ rèn may mắn', description: 'Hoàn tất 3 lượt Upgrade', action: 'upgrades', target: 3, rewardXp: 120, reward: rewardCase('dreams-case', CASE_REWARDS.dreams.label, CASE_REWARDS.dreams, 10_000_000) },
    { id: 'boss-damage', label: 'Phá giáp Boss', description: 'Gây 1.500 sát thương Boss', action: 'bossDamage', target: 1500, rewardXp: 160, reward: rewardCase('breakout-case', CASE_REWARDS.breakout.label, CASE_REWARDS.breakout, 15_000_000) },
    { id: 'new-finishes', label: 'Bộ sưu tập mở rộng', description: 'Nhặt 5 finish mới', action: 'newSkins', target: 5, rewardXp: 100, reward: rewardCoins(15_000_000, 'finish-weekly-coins', '15.000.000 xu') }
]);
const COLLECTION_MILESTONES = Object.freeze([
    { id: 'collection-25', threshold: 25, label: 'Người mở khóa', description: 'Thu thập 25% finish độc nhất', reward: 'Danh hiệu Người mở khóa', rewardCoins: 5_000_000, caseReward: CASE_REWARDS.fever },
    { id: 'collection-50', threshold: 50, label: 'Thợ săn bộ sưu tập', description: 'Thu thập 50% finish độc nhất', reward: 'Khung hồ sơ Thợ săn', rewardCoins: 10_000_000, caseReward: CASE_REWARDS.kilowatt },
    { id: 'collection-75', threshold: 75, label: 'Chủ kho di vật', description: 'Thu thập 75% finish độc nhất', reward: 'Nền hồ sơ Di vật', rewardCoins: 20_000_000, caseReward: CASE_REWARDS.dreams },
    { id: 'collection-100', threshold: 100, label: 'Huyền thoại sưu tầm', description: 'Thu thập đủ 240 finish độc nhất', reward: 'Di vật Sưu tầm tối thượng', rewardCoins: 50_000_000, caseReward: CASE_REWARDS.breakout }
]);
const validImage = value => {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
    } catch { return null; }
};

function bangkokDate(now) {
    return new Date(now + BANGKOK_OFFSET).toISOString().slice(0, 10);
}

function weekStart(dayKey) {
    const date = new Date(`${dayKey}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    return date.toISOString().slice(0, 10);
}

function nextResetAt(seasonKey) {
    const nextMonday = Date.parse(`${seasonKey}T00:00:00.000Z`) + 7 * DAY;
    return nextMonday - BANGKOK_OFFSET;
}

function bossForSeason(seasonKey) {
    const seasonNumber = Math.floor(Date.parse(`${seasonKey}T00:00:00.000Z`) / (7 * DAY));
    return BOSSES[((seasonNumber % BOSSES.length) + BOSSES.length) % BOSSES.length];
}

function bossHealth(guild, phase = 1) {
    const members = Number.isSafeInteger(guild?.memberCount) ? guild.memberCount : guild?.members?.cache?.size ?? 0;
    const base = Math.max(1_500, Math.min(8_000, 700 + Math.round(Math.sqrt(Math.min(1_000, Math.max(0, members))) * 240)));
    return Math.round(base * (1 + (phase - 1) * 0.18));
}

function activityCounters() {
    return { openCases: 0, battles: 0, upgrades: 0, newSkins: 0, bossAttacks: 0, bossDamage: 0, caseFuel: 0, caseFuelProgress: 0 };
}

function activityFor(stash, timestamp) {
    const dayKey = bangkokDate(timestamp), seasonKey = weekStart(dayKey);
    const existing = stash.activityMissions && typeof stash.activityMissions === 'object' ? stash.activityMissions : {};
    const activity = {
        dailyDate: existing.dailyDate === dayKey ? dayKey : dayKey,
        daily: existing.dailyDate === dayKey && existing.daily && typeof existing.daily === 'object' ? { ...activityCounters(), ...existing.daily } : activityCounters(),
        dailyClaims: existing.dailyDate === dayKey && Array.isArray(existing.dailyClaims) ? [...existing.dailyClaims] : [],
        weeklyKey: existing.weeklyKey === seasonKey ? seasonKey : seasonKey,
        weekly: existing.weeklyKey === seasonKey && existing.weekly && typeof existing.weekly === 'object' ? { ...activityCounters(), ...existing.weekly } : activityCounters(),
        weeklyClaims: existing.weeklyKey === seasonKey && Array.isArray(existing.weeklyClaims) ? [...existing.weeklyClaims] : [],
        dailyBonusClaimed: existing.dailyDate === dayKey && existing.dailyBonusClaimed === true,
        weeklyBonusClaimed: existing.weeklyKey === seasonKey && existing.weeklyBonusClaimed === true,
        lifetimeXp: Number.isSafeInteger(existing.lifetimeXp) && existing.lifetimeXp >= 0 ? existing.lifetimeXp : 0,
        cosmetics: existing.cosmetics && typeof existing.cosmetics === 'object' ? { ...existing.cosmetics } : {},
        lifetimeSkinIds: Array.isArray(existing.lifetimeSkinIds) ? [...new Set(existing.lifetimeSkinIds)] : [...new Set((stash.drops ?? []).map(drop => drop.skinId).filter(Boolean))],
        processed: Array.isArray(existing.processed) ? [...existing.processed].slice(-240) : []
    };
    return { activity, dayKey, seasonKey };
}

function applyActivityAction(stash, action, timestamp = Date.now()) {
    const { activity } = activityFor(stash, timestamp);
    const count = Math.max(1, Math.min(100, Number.isSafeInteger(action.count) ? action.count : 1));
    const increment = (key, value = count) => {
        activity.daily[key] = Math.min(100_000, (activity.daily[key] ?? 0) + value);
        activity.weekly[key] = Math.min(100_000, (activity.weekly[key] ?? 0) + value);
    };
    if (action.type === 'case_open') {
        increment('openCases', count);
        const dailyRemainder = Math.max(0, Number(activity.daily.caseFuelProgress) || 0) + count;
        const dailyFuel = Math.floor(dailyRemainder / 3);
        activity.daily.caseFuel = Math.min(12, (activity.daily.caseFuel ?? 0) + dailyFuel);
        activity.daily.caseFuelProgress = dailyRemainder % 3;
        const weeklyRemainder = Math.max(0, Number(activity.weekly.caseFuelProgress) || 0) + count;
        const weeklyFuel = Math.floor(weeklyRemainder / 3);
        activity.weekly.caseFuel = Math.min(60, (activity.weekly.caseFuel ?? 0) + weeklyFuel);
        activity.weekly.caseFuelProgress = weeklyRemainder % 3;
    }
    if (action.type === 'battle_complete') increment('battles', count);
    if (action.type === 'upgrade_complete') increment('upgrades', count);
    if (action.type === 'boss_attack') { increment('bossAttacks', count); increment('bossDamage', Math.max(0, Math.min(10_000, Number(action.damage) || 0))); }
    if (Array.isArray(action.skinIds)) {
        const known = new Set(activity.lifetimeSkinIds);
        let fresh = 0;
        for (const skinId of action.skinIds) {
            if (typeof skinId !== 'string' || known.has(skinId)) continue;
            known.add(skinId); fresh++;
        }
        activity.lifetimeSkinIds = [...known].slice(-10_000);
        increment('newSkins', fresh);
    }
    stash.activityMissions = activity;
    return activity;
}

function missionView(mission, counters, claims) {
    const progress = Math.min(mission.target, Number(counters?.[mission.action]) || 0);
    const reward = { xp: mission.rewardXp, cosmetic: mission.reward.label };
    if (mission.reward.coins) reward.coins = mission.reward.coins;
    if (mission.reward.caseReward) reward.case = { ...mission.reward.caseReward };
    return { ...mission, progress, complete: progress >= mission.target, claimed: claims.includes(mission.id), reward };
}

function activitySnapshot(stash, timestamp = Date.now()) {
    const { activity, dayKey, seasonKey } = activityFor(stash, timestamp);
    const daily = DAILY_ACTIVITY_MISSIONS.map(mission => missionView(mission, activity.daily, activity.dailyClaims));
    const weekly = WEEKLY_ACTIVITY_MISSIONS.map(mission => missionView(mission, activity.weekly, activity.weeklyClaims));
    return { dayKey, seasonKey, xp: activity.lifetimeXp, cosmetics: activity.cosmetics,
        daily, weekly,
        dailyCompleted: daily.filter(item => item.claimed).length,
        weeklyCompleted: weekly.filter(item => item.claimed).length,
        rewardRules: { dailyAll: 'Hoàn tất 5/5 nhiệm vụ ngày: +' + DAILY_COMPLETION_COINS.toLocaleString('vi-VN') + ' xu + Fever Case + chìa', weeklyAll: 'Hoàn tất 5/5 nhiệm vụ tuần: +' + WEEKLY_COMPLETION_COINS.toLocaleString('vi-VN') + ' xu + Operation Breakout Case + chìa' },
        caseFuel: Math.min(12, Number(activity.daily.caseFuel) || 0),
        caseFuelProgress: Math.max(0, Math.min(2, Number(activity.daily.caseFuelProgress) || 0)),
        caseFuelNeeded: 3 };
}

function newEvent(guild, seasonKey) {
    const boss = bossForSeason(seasonKey);
    const health = bossHealth(guild);
    return { seasonKey, bossId: boss.id, health, maxHealth: health, phase: 1, phasesCleared: 0, maxPhases: MAX_PHASES,
        defeated: false, totalDamage: 0, attacks: 0, participants: 0, leaderboard: {}, rallyCharges: [], recent: [] };
}

function progressFor(stash, seasonKey, dayKey) {
    const existing = stash.bossHunt && typeof stash.bossHunt === 'object' ? stash.bossHunt : {};
    const progress = existing.seasonKey === seasonKey ? { ...existing } : {
        seasonKey, dailyDate: dayKey, dailyUsed: 0, dailyTactical: 0, dailyMissionClaims: [], seasonAttacks: 0, seasonDamage: 0, seasonXp: 0,
        lifetimeXp: Number.isSafeInteger(existing.lifetimeXp) && existing.lifetimeXp > 0 ? existing.lifetimeXp : 0,
        weeklyMissions: { attacks: 0, precision: 0, rally: 0, damage: 0 }, missionClaims: [],
        medals: Array.isArray(existing.medals) ? [...existing.medals] : []
    };
    if (progress.dailyDate !== dayKey) {
        progress.dailyDate = dayKey;
        progress.dailyUsed = 0;
        progress.dailyTactical = 0;
        progress.dailyMissionClaims = [];
    }
    progress.dailyUsed = Number.isSafeInteger(progress.dailyUsed) && progress.dailyUsed >= 0 ? progress.dailyUsed : 0;
    progress.dailyTactical = Number.isSafeInteger(progress.dailyTactical) && progress.dailyTactical >= 0 ? progress.dailyTactical : 0;
    progress.dailyMissionClaims = Array.isArray(progress.dailyMissionClaims) ? progress.dailyMissionClaims : [];
    progress.seasonAttacks = Number.isSafeInteger(progress.seasonAttacks) && progress.seasonAttacks >= 0 ? progress.seasonAttacks : 0;
    progress.seasonDamage = Number.isSafeInteger(progress.seasonDamage) && progress.seasonDamage >= 0 ? progress.seasonDamage : 0;
    progress.seasonXp = Number.isSafeInteger(progress.seasonXp) && progress.seasonXp >= 0 ? progress.seasonXp : 0;
    progress.lifetimeXp = Number.isSafeInteger(progress.lifetimeXp) && progress.lifetimeXp >= 0 ? progress.lifetimeXp : 0;
    progress.weeklyMissions = progress.weeklyMissions && typeof progress.weeklyMissions === 'object'
        ? progress.weeklyMissions : { attacks: 0, precision: 0, rally: 0, damage: 0 };
    progress.missionClaims = Array.isArray(progress.missionClaims) ? progress.missionClaims : [];
    progress.medals = Array.isArray(progress.medals) ? progress.medals : [];
    return progress;
}

function rankFor(xp) {
    let index = 0;
    for (let rank = 1; rank < RANKS.length; rank++) if (xp >= RANKS[rank].xp) index = rank;
    const next = RANKS[index + 1] ?? null;
    return { ...RANKS[index], nextXp: next?.xp ?? null, nextLabel: next?.label ?? null,
        progress: next ? Math.max(0, Math.min(100, (xp - RANKS[index].xp) / (next.xp - RANKS[index].xp) * 100)) : 100 };
}

function leaderboardRows(event, userId) {
    return Object.entries(event.leaderboard ?? {}).map(([id, entry]) => ({ userId: id, displayName: entry.displayName,
        damage: entry.damage, attacks: entry.attacks, isYou: id === userId }))
        .sort((left, right) => right.damage - left.damage || left.displayName.localeCompare(right.displayName, 'vi'))
        .slice(0, 10);
}

function snapshot(event, progress, userId, now, caseFuel = 0) {
    const boss = BOSSES.find(item => item.id === event.bossId) ?? BOSSES[0];
    const dailyUsed = Math.min(DAILY_ATTACK_LIMIT, progress.dailyUsed ?? 0);
    const recent = (event.recent ?? []).map(entry => ({ ...entry, isYou: entry.userId === userId }));
    return {
        season: { key: event.seasonKey, resetsAt: nextResetAt(event.seasonKey), label: `Tuần bắt đầu ${event.seasonKey}` },
        boss: { ...boss, health: event.health, maxHealth: event.maxHealth, healthPercent: event.maxHealth ? Math.max(0, Math.min(100, event.health / event.maxHealth * 100)) : 0,
            phase: event.phase, maxPhases: event.maxPhases, phasesCleared: event.phasesCleared, defeated: event.defeated,
            totalDamage: event.totalDamage, attacks: event.attacks, participants: event.participants,
            rallyCharges: (event.rallyCharges ?? []).filter(charge => charge.expiresAt > now).length },
        daily: { used: dailyUsed, limit: DAILY_ATTACK_LIMIT, remaining: Math.max(0, DAILY_ATTACK_LIMIT - dailyUsed) },
        caseFuel: Math.max(0, Math.min(12, Number(caseFuel) || 0)),
        victoryReward: { label: BOSS_VICTORY_REWARD.label, coins: BOSS_VICTORY_REWARD.coins,
            case: { ...BOSS_VICTORY_REWARD.caseReward } },
        progress: { attacks: progress.seasonAttacks, damage: progress.seasonDamage, seasonXp: progress.seasonXp,
            lifetimeXp: progress.lifetimeXp, rank: rankFor(progress.lifetimeXp),
            medals: progress.medals.map(seasonKey => ({ seasonKey, boss: bossForSeason(seasonKey) })) },
        dailyMissions: DAILY_MISSIONS.map(mission => ({ ...mission,
            progress: Math.min(mission.target, mission.id === 'daily-tactic' ? progress.dailyTactical : progress.dailyUsed),
            complete: (mission.id === 'daily-tactic' ? progress.dailyTactical : progress.dailyUsed) >= mission.target,
            coins: mission.rewardCoins,
            claimed: progress.dailyMissionClaims.includes(mission.id) })),
        missions: WEEKLY_MISSIONS.map(mission => ({ ...mission,
            progress: Math.min(mission.target, Number(progress.weeklyMissions?.[mission.id]) || 0),
            complete: (Number(progress.weeklyMissions?.[mission.id]) || 0) >= mission.target,
            coins: mission.rewardCoins,
            claimed: progress.missionClaims.includes(mission.id) })),
        leaderboard: leaderboardRows(event, userId), recent
    };
}

function drawAttack(style, randomInt) {
    const spec = ATTACKS[style];
    if (!spec) return null;
    let damage = randomInt(spec.minimum, spec.maximum);
    const critical = style === 'precision' && randomInt(0, 100) < 18;
    if (critical) damage = Math.round(damage * 1.65);
    return { damage, critical };
}

function insertLeaderboard(event, userId, displayName, progress) {
    event.leaderboard ??= {};
    const existing = event.leaderboard[userId];
    const row = { displayName: String(displayName ?? `Người chơi ${userId}`).slice(0, 80),
        damage: progress.seasonDamage, attacks: progress.seasonAttacks };
    if (existing || Object.keys(event.leaderboard).length < MAX_LEADERBOARD) {
        event.leaderboard[userId] = row;
        return;
    }
    const weakest = Object.entries(event.leaderboard).sort((left, right) => left[1].damage - right[1].damage)[0];
    if (weakest && row.damage > weakest[1].damage) {
        delete event.leaderboard[weakest[0]];
        event.leaderboard[userId] = row;
    }
}

function createPlayerActivities({ ownerGuild, request, previous, saveReceipt, checkQuota, itemDTO,
    now = Date.now, randomInt = crypto.randomInt } = {}) {
    function creditCoins(state, userId, amount) {
        if (!Number.isSafeInteger(amount) || amount <= 0) return;
        state.taixiu ??= { balances: {}, round: null };
        state.taixiu.balances ??= {};
        const balance = readCoins(state.taixiu.balances[userId] ?? 0);
        state.taixiu.balances[userId] = serializeCoins(balance + BigInt(amount) * COIN_SCALE);
    }

    function addCaseReward(stash, caseReward) {
        const { caseId, keyId, label } = caseReward;
        if (!cases.some(item => item.id === caseId)) throw Object.assign(new Error('Phần thưởng hòm không còn khả dụng.'), { status: 409 });
        stash.cases ??= {};
        stash.keys ??= {};
        stash.cases[caseId] = (Number(stash.cases[caseId]) || 0) + 1;
        stash.keys[keyId] = (Number(stash.keys[keyId]) || 0) + 1;
        return { caseId, keyId, label };
    }

    function recordActionState(state, userId, action, timestamp = now()) {
        const stash = (state.skinCases ??= {})[userId] ??= {};
        const { activity } = activityFor(stash, timestamp);
        const actionId = typeof action.actionId === 'string' ? action.actionId : null;
        if (actionId && activity.processed.includes(actionId)) return activity;
        applyActivityAction(stash, action, timestamp);
        if (actionId) stash.activityMissions.processed = [...stash.activityMissions.processed, actionId].slice(-240);
        return stash.activityMissions;
    }

    function consumeCaseFuel(stash, timestamp) {
        const { activity } = activityFor(stash, timestamp);
        const fuel = Math.max(0, Number(activity.daily.caseFuel) || 0);
        if (!fuel) {
            stash.activityMissions = activity;
            return false;
        }
        activity.daily.caseFuel = fuel - 1;
        stash.activityMissions = activity;
        return true;
    }

    function currentCaseFuel(stash, timestamp) {
        const { activity } = activityFor(stash, timestamp);
        return Math.max(0, Math.min(12, Number(activity.daily.caseFuel) || 0));
    }

    async function recordAction(owner, body = {}) {
        await ownerGuild(owner);
        if (typeof body.actionId !== 'string' || !body.actionId || typeof body.type !== 'string') return null;
        return store.transact(owner.guildId, async (state, save) => {
            recordActionState(state, owner.userId, body, now());
            await save();
            return activitySnapshot(state.skinCases?.[owner.userId] ?? {}, now());
        }, { inventory: [owner.userId] });
    }

    async function activityMissions(owner) {
        await ownerGuild(owner);
        const state = await store.read(owner.guildId, { inventory: [owner.userId] });
        return activitySnapshot(state.skinCases?.[owner.userId] ?? {}, now());
    }

    async function activityMissionClaim(owner, body = {}) {
        await ownerGuild(owner, true);
        const type = body.type === 'weekly' ? 'weekly' : body.type === 'daily' ? 'daily' : null;
        const missions = type === 'weekly' ? WEEKLY_ACTIVITY_MISSIONS : type === 'daily' ? DAILY_ACTIVITY_MISSIONS : null;
        const mission = missions?.find(item => item.id === body.missionId);
        if (!mission) throw Object.assign(new Error('Không tìm thấy nhiệm vụ.'), { status: 404 });
        const key = request(owner, body, ['activity-mission-claim', type, mission.id]);
        return store.transact(owner.guildId, async (state, save) => {
            const replay = previous(state, key);
            if (replay) return replay;
            const stash = (state.skinCases ??= {})[owner.userId] ??= {};
            checkQuota(stash);
            const timestamp = now(), { activity } = activityFor(stash, timestamp);
            stash.activityMissions = activity;
            const counters = type === 'weekly' ? activity.weekly : activity.daily;
            const claims = type === 'weekly' ? activity.weeklyClaims : activity.dailyClaims;
            if ((Number(counters[mission.action]) || 0) < mission.target) throw Object.assign(new Error('Nhiệm vụ chưa hoàn thành.'), { status: 409 });
            if (claims.includes(mission.id)) throw Object.assign(new Error('Nhiệm vụ này đã nhận thưởng.'), { status: 409 });
            claims.push(mission.id);
            activity.lifetimeXp = Math.min(999_999, activity.lifetimeXp + mission.rewardXp);
            if (!mission.reward.coins && !mission.reward.caseReward) {
                activity.cosmetics[mission.reward.id] = (activity.cosmetics[mission.reward.id] ?? 0) + 1;
            }
            const bonuses = [];
            const bonusCases = [];
            const reward = { xp: mission.rewardXp, cosmetic: mission.reward.label, bonuses };
            if (mission.reward.coins) {
                creditCoins(state, owner.userId, mission.reward.coins);
                reward.coins = mission.reward.coins;
            }
            if (mission.reward.caseReward) {
                reward.case = addCaseReward(stash, mission.reward.caseReward);
            }
            if (type === 'daily' && !activity.dailyBonusClaimed && DAILY_ACTIVITY_MISSIONS.every(item => activity.dailyClaims.includes(item.id))) {
                activity.dailyBonusClaimed = true;
                activity.cosmetics['supply-cache'] = (activity.cosmetics['supply-cache'] ?? 0) + 1;
                creditCoins(state, owner.userId, DAILY_COMPLETION_COINS);
                reward.completionCoins = DAILY_COMPLETION_COINS;
                bonusCases.push(addCaseReward(stash, CASE_REWARDS.fever));
                bonuses.push('Hòm tiếp tế hồ sơ', 'Thưởng đủ ngày: +' + DAILY_COMPLETION_COINS.toLocaleString('vi-VN') + ' xu + Fever Case + chìa');
            }
            if (type === 'weekly' && !activity.weeklyBonusClaimed && WEEKLY_ACTIVITY_MISSIONS.every(item => activity.weeklyClaims.includes(item.id))) {
                activity.weeklyBonusClaimed = true;
                activity.cosmetics['boss-frame'] = (activity.cosmetics['boss-frame'] ?? 0) + 1;
                creditCoins(state, owner.userId, WEEKLY_COMPLETION_COINS);
                reward.completionCoins = WEEKLY_COMPLETION_COINS;
                bonusCases.push(addCaseReward(stash, CASE_REWARDS.breakout));
                bonuses.push('Khung Boss', 'Thưởng đủ tuần: +' + WEEKLY_COMPLETION_COINS.toLocaleString('vi-VN') + ' xu + Operation Breakout Case + chìa');
            }
            reward.bonuses = bonuses;
            reward.bonusCases = bonusCases;
            const response = { status: 'claimed', type, mission: { id: mission.id, label: mission.label }, reward,
                quests: activitySnapshot(stash, timestamp), replayed: false };
            saveReceipt(state, stash, key, response, 'activity-mission-claim');
            await save();
            return response;
        }, { sections: [key.section], wallets: [owner.userId], inventory: [owner.userId] });
    }

    function collectionBookSnapshot(stash) {
        const drops = stash?.drops ?? [];
        const owned = new Set(drops.map(drop => drop.skinId).filter(id => Object.hasOwn(skins, id)));
        const allIds = new Set(collections.flatMap(collection => collection.pools.flat()).filter(id => Object.hasOwn(skins, id)));
        const sets = collections.map(collection => {
            const seen = new Set();
            const items = collection.pools.flatMap((pool, tier) => pool.map(skinId => ({ skinId, tier })))
                .filter(({ skinId }) => Object.hasOwn(skins, skinId) && !seen.has(skinId) && seen.add(skinId))
                .map(({ skinId, tier }) => ({ ...itemDTO({ skinId, tier, statTrak: false }, null), owned: owned.has(skinId) }));
            const ownedCount = items.filter(item => item.owned).length;
            return { id: collection.id, name: collection.name, image: validImage(collection.image),
                kind: collection.kind, owned: ownedCount, total: items.length,
                percent: items.length ? Math.round(ownedCount / items.length * 100) : 0,
                complete: items.length > 0 && ownedCount === items.length,
                claimed: stash?.collectionBook?.claimed?.includes(collection.id) === true,
                rewardClaimed: stash?.collectionBook?.rewardClaims?.includes(collection.id) === true,
                rewardCoins: COLLECTION_SET_REWARD.coins, rewardCase: { ...COLLECTION_SET_REWARD.caseReward }, items };
        });
        const totalUnique = allIds.size;
        const collectedUnique = [...allIds].filter(id => owned.has(id)).length;
        const totals = { collected: collectedUnique, total: totalUnique, sets: sets.length,
            completeSets: sets.filter(set => set.complete).length,
            claimedSets: sets.filter(set => set.claimed).length,
            rewardedSets: sets.filter(set => set.rewardClaimed).length,
            percent: totalUnique ? Math.round(collectedUnique / totalUnique * 100) : 0 };
        const claimedMilestones = new Set(stash?.collectionBook?.milestones ?? []);
        const claimedMilestoneRewards = new Set(stash?.collectionBook?.milestoneRewardClaims ?? []);
        return { totals, sets, milestones: COLLECTION_MILESTONES.map(milestone => ({ ...milestone,
            caseReward: { ...milestone.caseReward },
            complete: totals.percent >= milestone.threshold, claimed: claimedMilestones.has(milestone.id),
            rewardClaimed: claimedMilestoneRewards.has(milestone.id) })) };
    }

    async function collectionBook(owner) {
        await ownerGuild(owner);
        const state = await store.read(owner.guildId, { inventory: [owner.userId] });
        return collectionBookSnapshot(state.skinCases?.[owner.userId] ?? {});
    }

    async function collectionBookClaim(owner, body = {}) {
        await ownerGuild(owner, true);
        const item = body.collectionId ? collections.find(entry => entry.id === body.collectionId) : null;
        const milestone = body.milestoneId ? COLLECTION_MILESTONES.find(entry => entry.id === body.milestoneId) : null;
        if (!item && !milestone) throw Object.assign(new Error('Không tìm thấy phần thưởng sưu tập.'), { status: 404 });
        const key = request(owner, body, ['collection-book-claim', item?.id ?? milestone.id]);
        const scope = { sections: [key.section], inventory: [owner.userId] };
        return store.transact(owner.guildId, async (state, save) => {
            const replay = previous(state, key);
            if (replay) return replay;
            const stash = (state.skinCases ??= {})[owner.userId] ??= {};
            checkQuota(stash);
            const book = collectionBookSnapshot(stash);
            if (milestone) {
                const available = book.milestones.find(entry => entry.id === milestone.id);
                if (!available?.complete) throw Object.assign(new Error(`Cần đạt ${milestone.threshold}% sổ sưu tập trước khi nhận phần thưởng.`), { status: 409 });
                stash.collectionBook ??= { claimed: [] };
                stash.collectionBook.milestones ??= [];
                stash.collectionBook.milestoneRewardClaims ??= [];
                if (stash.collectionBook.milestoneRewardClaims.includes(milestone.id)) throw Object.assign(new Error('Bạn đã nhận phần thưởng mốc này.'), { status: 409 });
                stash.collectionBook.milestones = [...new Set([...stash.collectionBook.milestones, milestone.id])];
                stash.collectionBook.milestoneRewardClaims = [...new Set([...stash.collectionBook.milestoneRewardClaims, milestone.id])];
                stash.collectionBook.milestonesAt ??= {};
                stash.collectionBook.milestonesAt[milestone.id] = now();
                const rewardCase = addCaseReward(stash, milestone.caseReward);
                creditCoins(state, owner.userId, milestone.rewardCoins);
                const response = { status: 'claimed', milestone: { id: milestone.id, label: milestone.label }, reward: milestone.reward,
                    rewardCoins: milestone.rewardCoins, rewardCase,
                    book: collectionBookSnapshot(stash), replayed: false };
                saveReceipt(state, stash, key, response, 'collection-milestone-claim');
                await save();
                return response;
            }
            const collection = book.sets.find(entry => entry.id === item.id);
            if (!collection?.complete) throw Object.assign(new Error('Hãy sở hữu đủ skin trong bộ sưu tập trước khi nhận huy hiệu.'), { status: 409 });
            stash.collectionBook ??= { claimed: [] };
            stash.collectionBook.rewardClaims ??= [];
            if (stash.collectionBook.rewardClaims.includes(item.id)) throw Object.assign(new Error('Bạn đã nhận phần thưởng của bộ sưu tập này.'), { status: 409 });
            stash.collectionBook.claimed = [...new Set([...(stash.collectionBook.claimed ?? []), item.id])];
            stash.collectionBook.rewardClaims = [...new Set([...stash.collectionBook.rewardClaims, item.id])];
            stash.collectionBook.claimedAt ??= {};
            stash.collectionBook.claimedAt[item.id] = now();
            const rewardCase = addCaseReward(stash, COLLECTION_SET_REWARD.caseReward);
            creditCoins(state, owner.userId, COLLECTION_SET_REWARD.coins);
            const response = { status: 'claimed', collection: { id: item.id, name: item.name },
                badge: { id: item.id, name: item.name }, reward: 'Huy hiệu hồ sơ',
                rewardCoins: COLLECTION_SET_REWARD.coins, rewardCase,
                book: collectionBookSnapshot(stash), replayed: false };
            saveReceipt(state, stash, key, response, 'collection-claim');
            await save();
            return response;
        }, { ...scope, wallets: [owner.userId] });
    }

    async function bossHunt(owner) {
        const guild = await ownerGuild(owner);
        const dayKey = bangkokDate(now()), seasonKey = weekStart(dayKey);
        const state = await store.read(owner.guildId, { sections: ['playerBossHunt'], inventory: [owner.userId] });
        const stash = state.skinCases?.[owner.userId] ?? {};
        const timestamp = now();
        const event = state.playerBossHunt?.seasonKey === seasonKey ? state.playerBossHunt : newEvent(guild, seasonKey);
        const progress = progressFor(stash, seasonKey, dayKey);
        return snapshot(event, progress, owner.userId, timestamp, currentCaseFuel(stash, timestamp));
    }

    async function bossHuntAttack(owner, body = {}) {
        const guild = await ownerGuild(owner, true);
        if (!Object.hasOwn(ATTACKS, body.style)) throw Object.assign(new Error('Chọn một kiểu tấn công hợp lệ.'), { status: 400 });
        const key = request(owner, body, ['boss-hunt-attack', body.style]);
        const scope = { sections: ['playerBossHunt', key.section], wallets: [owner.userId], inventory: [owner.userId] };
        return store.transact(owner.guildId, async (state, save) => {
            const replay = previous(state, key);
            if (replay) return replay;
            const stash = (state.skinCases ??= {})[owner.userId] ??= {};
            checkQuota(stash);
            const timestamp = now(), dayKey = bangkokDate(timestamp), seasonKey = weekStart(dayKey);
            let event = state.playerBossHunt;
            if (!event || event.seasonKey !== seasonKey) event = state.playerBossHunt = newEvent(guild, seasonKey);
            const progress = progressFor(stash, seasonKey, dayKey);
            if (event.defeated) throw Object.assign(new Error('Boss tuần này đã bị hạ. Đội sẽ gặp Boss mới vào tuần sau.'), { status: 409 });
            if (progress.dailyUsed >= DAILY_ATTACK_LIMIT) throw Object.assign(new Error('Bạn đã dùng hết 3 lượt săn Boss hôm nay. Lượt mới có vào 00:00 giờ Việt Nam.'), { status: 429 });

            const attack = drawAttack(body.style, randomInt);
            const caseFuelUsed = consumeCaseFuel(stash, timestamp);
            const caseFuelBonus = caseFuelUsed ? 75 : 0;
            const liveCharges = (event.rallyCharges ?? []).filter(charge => charge.expiresAt > timestamp);
            let teamBonus = 0, chargeUsed = null;
            const chargeIndex = liveCharges.findIndex(charge => charge.userId !== owner.userId);
            if (chargeIndex >= 0) {
                [chargeUsed] = liveCharges.splice(chargeIndex, 1);
                teamBonus = chargeUsed.damage;
            }
            event.rallyCharges = liveCharges;
            const rawDamage = attack.damage + teamBonus + caseFuelBonus;
            const damage = Math.min(event.health, rawDamage);
            event.health -= damage;
            event.totalDamage = (Number.isSafeInteger(event.totalDamage) ? event.totalDamage : 0) + damage;
            event.attacks = (Number.isSafeInteger(event.attacks) ? event.attacks : 0) + 1;
            progress.dailyUsed++;
            if (body.style === 'precision' || body.style === 'rally') progress.dailyTactical++;
            progress.seasonAttacks++;
            progress.seasonDamage += damage;
            progress.seasonXp += 12;
            progress.lifetimeXp += 12;
            progress.weeklyMissions.attacks++;
            progress.weeklyMissions.damage += damage;
            if (body.style === 'precision') progress.weeklyMissions.precision++;
            if (body.style === 'rally') progress.weeklyMissions.rally++;
            let phaseCleared = false, bossDefeated = false, xpAwarded = 12;
            const missionRewards = [];
            for (const mission of DAILY_MISSIONS) {
                const value = mission.id === 'daily-tactic' ? progress.dailyTactical : progress.dailyUsed;
                if (value >= mission.target && !progress.dailyMissionClaims.includes(mission.id)) {
                    progress.dailyMissionClaims.push(mission.id);
                    progress.seasonXp += mission.rewardXp;
                    progress.lifetimeXp += mission.rewardXp;
                    xpAwarded += mission.rewardXp;
                    creditCoins(state, owner.userId, mission.rewardCoins);
                    missionRewards.push({ id: mission.id, label: mission.label, xp: mission.rewardXp, coins: mission.rewardCoins });
                }
            }
            for (const mission of WEEKLY_MISSIONS) {
                if (progress.weeklyMissions[mission.id] >= mission.target && !progress.missionClaims.includes(mission.id)) {
                    progress.missionClaims.push(mission.id);
                    progress.seasonXp += mission.rewardXp;
                    progress.lifetimeXp += mission.rewardXp;
                    xpAwarded += mission.rewardXp;
                    creditCoins(state, owner.userId, mission.rewardCoins);
                    missionRewards.push({ id: mission.id, label: mission.label, xp: mission.rewardXp, coins: mission.rewardCoins });
                }
            }
            if (event.health <= 0) {
                phaseCleared = true;
                event.phasesCleared++;
                xpAwarded += 20;
                progress.seasonXp += 20;
                progress.lifetimeXp += 20;
                if (event.phasesCleared >= MAX_PHASES) {
                    event.defeated = true;
                    bossDefeated = true;
                    xpAwarded += 40;
                    progress.seasonXp += 40;
                    progress.lifetimeXp += 40;
                    event.health = 0;
                } else {
                    event.phase = event.phasesCleared + 1;
                    event.maxHealth = bossHealth(guild, event.phase);
                    event.health = event.maxHealth;
                }
            }
            if (body.style === 'rally' && !event.defeated) {
                event.rallyCharges.push({ userId: owner.userId, displayName: String(owner.displayName ?? '').slice(0, 80),
                    damage: RALLY_DAMAGE, expiresAt: timestamp + RALLY_TTL });
                if (event.rallyCharges.length > 100) event.rallyCharges = event.rallyCharges.slice(-100);
            }
            stash.bossHunt = progress;
            recordActionState(state, owner.userId, { actionId: `boss:${key.id}`, type: 'boss_attack', damage, count: 1 }, timestamp);
            insertLeaderboard(event, owner.userId, owner.displayName, progress);
            if (progress.seasonAttacks === 1) event.participants = (Number.isSafeInteger(event.participants) ? event.participants : 0) + 1;
            const attackResult = { userId: owner.userId, displayName: String(owner.displayName ?? '').slice(0, 80),
                style: body.style, styleLabel: ATTACKS[body.style].label, damage, teamBonus, caseFuelUsed, caseFuelBonus, critical: attack.critical,
                phaseCleared, bossDefeated, at: timestamp };
            event.recent = [attackResult, ...(event.recent ?? [])].slice(0, MAX_RECENT);
            state.playerBossHunt = event;
            const actionText = `${ATTACKS[body.style].label}: ${damage.toLocaleString('vi-VN')} sát thương`;
            const message = `${actionText}${caseFuelBonus ? ` · +${caseFuelBonus} hỏa lực từ hòm` : ''}${teamBonus ? ` · +${teamBonus} tiếp sức` : ''}${attack.critical ? ' · CHÍ MẠNG!' : ''}${phaseCleared ? bossDefeated ? ' · HẠ BOSS!' : ` · VƯỢT PHA ${event.phasesCleared}!` : ''}`;
            const response = { ...snapshot(event, progress, owner.userId, timestamp, currentCaseFuel(stash, timestamp)), lastAttack: { ...attackResult, xp: xpAwarded },
                missionRewards, message: [message, ...missionRewards.map(reward => `Nhiệm vụ ${reward.label}: +${reward.xp} XP`)].join(' · '), total: '0', replayed: false };
            saveReceipt(state, stash, key, response, 'boss-attack');
            await save();
            return response;
        }, scope);
    }

    async function bossHuntClaim(owner, body = {}) {
        await ownerGuild(owner, true);
        const key = request(owner, body, ['boss-hunt-claim']);
        const scope = { sections: ['playerBossHunt', key.section], wallets: [owner.userId], inventory: [owner.userId] };
        return store.transact(owner.guildId, async (state, save) => {
            const replay = previous(state, key);
            if (replay) return replay;
            const stash = (state.skinCases ??= {})[owner.userId] ??= {};
            checkQuota(stash);
            const event = state.playerBossHunt;
            const dayKey = bangkokDate(now()), seasonKey = weekStart(dayKey);
            const progress = progressFor(stash, seasonKey, dayKey);
            if (!event || event.seasonKey !== seasonKey || !event.defeated) {
                throw Object.assign(new Error('Hãy cùng máy chủ hạ Boss trước khi nhận huy hiệu chiến công.'), { status: 409 });
            }
            if (progress.seasonDamage < 100) {
                throw Object.assign(new Error('Gây ít nhất 100 sát thương để ghi tên vào chiến công tuần này.'), { status: 409 });
            }
            if (progress.medals.includes(seasonKey)) {
                throw Object.assign(new Error('Bạn đã nhận huy hiệu chiến công của tuần này.'), { status: 409 });
            }
            const boss = BOSSES.find(item => item.id === event.bossId) ?? BOSSES[0];
            const medal = { id: `${seasonKey}:${boss.id}`, seasonKey, bossId: boss.id, bossName: boss.name,
                damage: progress.seasonDamage, claimedAt: now() };
            const caseReward = addCaseReward(stash, BOSS_VICTORY_REWARD.caseReward);
            state.taixiu ??= { balances: {}, round: null };
            state.taixiu.balances ??= {};
            const balance = readCoins(state.taixiu.balances[owner.userId] ?? 0);
            state.taixiu.balances[owner.userId] = serializeCoins(balance + BigInt(BOSS_VICTORY_REWARD.coins) * COIN_SCALE);
            const victoryReward = { label: BOSS_VICTORY_REWARD.label, coins: BOSS_VICTORY_REWARD.coins, case: caseReward };
            progress.medals = [...progress.medals, seasonKey].slice(-52);
            stash.bossHunt = progress;
            const timestamp = now();
            const response = { ...snapshot(event, progress, owner.userId, timestamp, currentCaseFuel(stash, timestamp)), medal, victoryReward, status: 'claimed', replayed: false };
            saveReceipt(state, stash, key, response, 'boss-medal');
            await save();
            return response;
        }, scope);
    }

    return { activityMissions, activityMissionClaim, recordAction, recordActionState,
        collectionBook, collectionBookClaim, bossHunt, bossHuntAttack, bossHuntClaim };
}

module.exports = { createPlayerActivities, bangkokDate, weekStart, bossHealth, DAILY_ATTACK_LIMIT, ATTACKS, BOSSES, RANKS,
    DAILY_ACTIVITY_MISSIONS, WEEKLY_ACTIVITY_MISSIONS, COLLECTION_MILESTONES, applyActivityAction };
