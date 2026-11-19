jest.mock('../utils/managementStore', () => ({ read: jest.fn(), transact: jest.fn() }));

const store = require('../utils/managementStore');
const { collections } = require('../utils/cs2Catalogue');
const { createPlayerActivities, DAILY_ATTACK_LIMIT, BOSSES, bossHealth } = require('../utils/playerActivities');

const owner = { guildId: '1', userId: '13', displayName: 'Thợ săn', avatar: null };
const other = { guildId: '1', userId: '14', displayName: 'Đồng đội', avatar: null };
const collection = collections[0];
let state, service, timestamp, validateOwner, nextSequence;

function request(currentOwner, body, fingerprintBody) {
    return { id: body.requestId, fingerprint: JSON.stringify(fingerprintBody), section: `receipt:${currentOwner.userId}:${body.requestId}` };
}
function previous(currentState, key) {
    const entry = currentState[key.section];
    if (!entry) return null;
    if (entry.fingerprint !== key.fingerprint) throw Object.assign(new Error('request reused'), { status: 409 });
    return { ...structuredClone(entry.result), replayed: true };
}
function saveReceipt(currentState, stash, key, result, action) {
    currentState[key.section] = { fingerprint: key.fingerprint, result: structuredClone(result), action };
    stash.webRequestCount = (stash.webRequestCount ?? 0) + 1;
}
function nextRequestId() {
    nextSequence++;
    return `request-${nextSequence}`;
}

beforeEach(() => {
    timestamp = Date.UTC(2026, 10, 19, 3);
    nextSequence = 0;
    state = { skinCases: { 13: { drops: [] }, 14: { drops: [] } } };
    store.read.mockImplementation(async () => state);
    store.transact.mockImplementation(async (_guildId, operation) => operation(state, async () => {}));
    validateOwner = jest.fn(async () => ({ memberCount: 25 }));
    service = createPlayerActivities({ ownerGuild: validateOwner, request, previous, saveReceipt,
        checkQuota: jest.fn(), itemDTO: drop => ({ skinId: drop.skinId, name: drop.skinId }),
        now: () => timestamp, randomInt: minimum => minimum });
});
afterEach(() => jest.clearAllMocks());

test('the book counts unique currently owned finishes and tracks one-time collection badges', async () => {
    const skinId = collection.pools.flat()[0];
    state.skinCases[13].drops = [{ id: 'one', skinId }, { id: 'two', skinId }];
    const book = await service.collectionBook(owner);
    const set = book.sets.find(item => item.id === collection.id);
    expect(set).toMatchObject({ owned: 1, total: collection.pools.flat().length, claimed: false });
    expect(book.totals.collected).toBe(1);
    expect(book.totals.total).toBe(240);
    expect(book.sets).toHaveLength(31);
    expect(store.read).toHaveBeenCalledWith('1', { inventory: ['13'] });
});

test('a completed set grants coins, a usable case and its persistent cosmetic badge once', async () => {
    state.skinCases[13].drops = [...new Set(collection.pools.flat())].map((skinId, index) => ({ id: `item-${index}`, skinId }));
    const claimBody = { collectionId: collection.id, requestId: nextRequestId() };
    const response = await service.collectionBookClaim(owner, claimBody);
    expect(response).toMatchObject({ status: 'claimed', badge: { id: collection.id }, reward: 'Huy hiệu hồ sơ' });
    expect(response).toMatchObject({ rewardCoins: 5_000_000, rewardCase: { caseId: 'crate-4904', keyId: 'key-1394' } });
    expect(response.book.sets.find(item => item.id === collection.id)).toMatchObject({ complete: true, claimed: true });
    expect(state.skinCases[13].collectionBook.claimed).toContain(collection.id);
    expect(state.skinCases[13].cases['crate-4904']).toBe(1);
    expect(state.skinCases[13].keys['key-1394']).toBe(1);
    expect(state.taixiu.balances[13]).toBe(5_000_000);
    const replay = await service.collectionBookClaim(owner, claimBody);
    expect(replay).toMatchObject({ replayed: true, rewardCoins: 5_000_000 });
    expect(state.taixiu.balances[13]).toBe(5_000_000);
    await expect(service.collectionBookClaim(owner, { collectionId: collection.id, requestId: nextRequestId() }))
        .rejects.toMatchObject({ status: 409 });
});

test('activity missions connect cases, Battle, Upgrade and Boss progress with one-time cosmetic rewards', async () => {
    const actions = [
        { actionId: 'activity-cases', type: 'case_open', count: 15, skinIds: ['finish-a', 'finish-b', 'finish-c', 'finish-d', 'finish-e'] },
        { actionId: 'activity-battles', type: 'battle_complete', count: 5 },
        { actionId: 'activity-upgrades', type: 'upgrade_complete', count: 3 },
        { actionId: 'activity-boss', type: 'boss_attack', count: 1, damage: 1500 }
    ];
    for (const action of actions) await service.recordAction(owner, action);
    const quests = await service.activityMissions(owner);
    expect(quests.daily.every(mission => mission.complete)).toBe(true);
    expect(quests.weekly.every(mission => mission.complete)).toBe(true);
    expect(quests.daily.find(mission => mission.id === 'new-finish')).toMatchObject({ progress: 2 });
    expect(quests.weekly.find(mission => mission.id === 'new-finishes')).toMatchObject({ progress: 5 });

    const duplicate = await service.recordAction(owner, actions[0]);
    expect(duplicate.daily.find(mission => mission.id === 'open-cases').progress).toBe(3);

    let dailyResult;
    for (const mission of quests.daily) {
        dailyResult = await service.activityMissionClaim(owner, { requestId: nextRequestId(), type: 'daily', missionId: mission.id });
    }
    expect(dailyResult.reward.bonuses).toContain('Hòm tiếp tế hồ sơ');
    expect(state.skinCases[13].activityMissions.cosmetics['supply-cache']).toBe(1);
    expect(dailyResult.reward.completionCoins).toBe(10_000_000);
    await expect(service.activityMissionClaim(owner, { requestId: nextRequestId(), type: 'daily', missionId: quests.daily[0].id }))
        .rejects.toMatchObject({ status: 409 });

    let weeklyResult;
    for (const mission of quests.weekly) {
        weeklyResult = await service.activityMissionClaim(owner, { requestId: nextRequestId(), type: 'weekly', missionId: mission.id });
    }
    expect(weeklyResult.reward.bonuses).toContain('Khung Boss');
    expect(state.skinCases[13].activityMissions.cosmetics['boss-frame']).toBe(1);
    expect(weeklyResult.reward.completionCoins).toBe(10_000_000);
    expect(state.taixiu.balances[13]).toBe(125_000_000);
});

test('an old collection badge can still claim its new payout once', async () => {
    state.skinCases[13].drops = [...new Set(collection.pools.flat())].map((skinId, index) => ({ id: `old-item-${index}`, skinId }));
    state.skinCases[13].collectionBook = { claimed: [collection.id], claimedAt: { [collection.id]: timestamp - 1 } };
    expect((await service.collectionBook(owner)).sets.find(item => item.id === collection.id)).toMatchObject({ claimed: true, rewardClaimed: false });
    const reward = await service.collectionBookClaim(owner, { requestId: nextRequestId(), collectionId: collection.id });
    expect(reward).toMatchObject({ rewardCoins: 5_000_000, rewardCase: { caseId: 'crate-4904' } });
    expect(state.taixiu.balances[13]).toBe(5_000_000);
});

test('opening three cases creates one Boss fuel charge and an attack consumes it once', async () => {
    const first = await service.recordAction(owner, { actionId: 'fuel-one', type: 'case_open', count: 2 });
    expect(first.caseFuel).toBe(0);
    const charged = await service.recordAction(owner, { actionId: 'fuel-two', type: 'case_open', count: 1 });
    expect(charged.caseFuel).toBe(1);

    const body = { requestId: nextRequestId(), style: 'steady' };
    const attack = await service.bossHuntAttack(owner, body);
    expect(attack.lastAttack).toMatchObject({ caseFuelUsed: true, caseFuelBonus: 75 });
    expect(attack.caseFuel).toBe(0);
    const replay = await service.bossHuntAttack(owner, body);
    expect(replay).toMatchObject({ replayed: true, caseFuel: 0 });
    expect(state.skinCases[13].activityMissions.daily.caseFuel).toBe(0);
});

test('collection milestones grant bounded profile rewards once', async () => {
    const unique = [...new Set(collections.flatMap(item => item.pools.flat()))].slice(0, 60);
    state.skinCases[13].drops = unique.map((skinId, index) => ({ id: `milestone-${index}`, skinId }));
    const book = await service.collectionBook(owner);
    expect(book.totals.percent).toBe(25);
    expect(book.milestones.find(item => item.id === 'collection-25')).toMatchObject({ complete: true, claimed: false });
    const claimed = await service.collectionBookClaim(owner, { requestId: nextRequestId(), milestoneId: 'collection-25' });
    expect(claimed).toMatchObject({ status: 'claimed', milestone: { id: 'collection-25' }, reward: 'Danh hiệu Người mở khóa' });
    expect(claimed).toMatchObject({ rewardCoins: 5_000_000, rewardCase: { caseId: 'crate-7007', keyId: 'key-7008' } });
    expect(state.taixiu.balances[13]).toBe(5_000_000);
    expect(claimed.book.milestones.find(item => item.id === 'collection-25')).toMatchObject({ complete: true, claimed: true });
    await expect(service.collectionBookClaim(owner, { requestId: nextRequestId(), milestoneId: 'collection-25' }))
        .rejects.toMatchObject({ status: 409 });
});

test('a request retry replays the same shared Boss result without applying damage twice', async () => {
    const body = { requestId: nextRequestId(), style: 'precision' };
    const first = await service.bossHuntAttack(owner, body);
    const again = await service.bossHuntAttack(owner, body);
    expect(again).toMatchObject({ replayed: true, boss: first.boss, progress: first.progress });
    expect(first.lastAttack.critical).toBe(true);
    expect(first.lastAttack.damage).toBeGreaterThan(190);
    expect(first.missionRewards).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'daily-tactic', coins: 2_000_000 })]));
    expect(state.playerBossHunt.attacks).toBe(1);
    expect(state.taixiu.balances[13]).toBe(2_000_000);
    expect(state.skinCases[13].bossHunt.seasonAttacks).toBe(1);
    expect(state.playerBossHunt.participants).toBe(1);
    expect(state.taixiu.balances[13]).toBe(2_000_000);
});

test('Boss health and the support charge are shared across players, but attempts are per player', async () => {
    const before = (await service.bossHunt(owner)).boss.health;
    await service.bossHuntAttack(owner, { requestId: nextRequestId(), style: 'rally' });
    const rallied = await service.bossHuntAttack(other, { requestId: nextRequestId(), style: 'steady' });
    expect(rallied.lastAttack.teamBonus).toBe(75);
    expect(rallied.boss.health).toBeLessThan(before - 200);
    expect(rallied.daily).toEqual({ used: 1, limit: DAILY_ATTACK_LIMIT, remaining: 2 });
    expect(rallied.boss.participants).toBe(2);
});

test('daily attempts are capped and daily and weekly missions grant bounded XP only once', async () => {
    let latest;
    for (let index = 0; index < DAILY_ATTACK_LIMIT; index++) {
        latest = await service.bossHuntAttack(owner, { requestId: nextRequestId(), style: 'rally' });
    }
    expect(latest.dailyMissions.find(item => item.id === 'daily-veteran')).toMatchObject({ complete: true, claimed: true, rewardXp: 18 });
    expect(latest.dailyMissions.find(item => item.id === 'daily-tactic')).toMatchObject({ complete: true, claimed: true, rewardXp: 10 });
    expect(latest.missions.find(item => item.id === 'rally')).toMatchObject({ complete: true, claimed: true });
    expect(latest.missionRewards.map(item => item.id)).toContain('rally');
    expect(latest.missionRewards.find(item => item.id === 'daily-veteran').coins).toBe(5_000_000);
    expect(state.taixiu.balances[13]).toBe(15_000_000);
    expect(latest.lastAttack.xp).toBe(65); // attack + final daily mission + weekly rally mission
    expect(latest.progress.seasonXp).toBe(111);
    await expect(service.bossHuntAttack(owner, { requestId: nextRequestId(), style: 'steady' }))
        .rejects.toMatchObject({ status: 429 });
    expect(state.playerBossHunt.attacks).toBe(DAILY_ATTACK_LIMIT);
});

test('crossing a weekly Boss mission grants its large coin reward once', async () => {
    let latest;
    const initialTime = timestamp;
    for (let attack = 0; attack < 9; attack++) {
        timestamp = initialTime + Math.floor(attack / DAILY_ATTACK_LIMIT) * 24 * 60 * 60_000;
        latest = await service.bossHuntAttack(owner, { requestId: nextRequestId(), style: 'steady' });
    }
    expect(latest.missionRewards).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'attacks', coins: 10_000_000 }),
        expect.objectContaining({ id: 'damage', coins: 10_000_000 })
    ]));
    const balance = state.taixiu.balances[13];
    const replay = await service.bossHuntAttack(owner, { requestId: `request-${nextSequence}`, style: 'steady' });
    expect(replay.replayed).toBe(true);
    expect(state.taixiu.balances[13]).toBe(balance);
});

test('the weekly season rotates the Boss and resets weekly progress while preserving rank XP', async () => {
    const first = await service.bossHuntAttack(owner, { requestId: nextRequestId(), style: 'steady' });
    const earned = first.progress.lifetimeXp;
    timestamp += 7 * 24 * 60 * 60_000;
    const next = await service.bossHunt(owner);
    expect(next.season.key).not.toBe(first.season.key);
    expect(next.boss.name).not.toBe(first.boss.name);
    expect(BOSSES.map(item => item.name)).toContain(next.boss.name);
    expect(next.progress).toMatchObject({ attacks: 0, damage: 0, lifetimeXp: earned });
    expect(next.daily.remaining).toBe(DAILY_ATTACK_LIMIT);
});

test('Boss health scales gently with server size and has a reachable floor and ceiling', () => {
    expect(bossHealth({ memberCount: 0 })).toBe(1500);
    expect(bossHealth({ memberCount: 100 })).toBeGreaterThan(bossHealth({ memberCount: 25 }));
    expect(bossHealth({ memberCount: 1_000_000 })).toBe(8_000);
    expect(bossHealth({ memberCount: 100 }, 2)).toBe(Math.round(bossHealth({ memberCount: 100 }) * 1.18));
});

test('weekly Boss victory rewards a case, xu and one-time cosmetic medal after a meaningful contribution', async () => {
    await service.bossHuntAttack(owner, { requestId: nextRequestId(), style: 'steady' });
    state.playerBossHunt.health = 0;
    state.playerBossHunt.defeated = true;
    state.skinCases[13].bossHunt.seasonDamage = 120;
    expect((await service.bossHunt(owner)).victoryReward.coins).toBe(20_000_000);
    const claimed = await service.bossHuntClaim(owner, { requestId: nextRequestId() });
    expect(claimed).toMatchObject({ status: 'claimed', medal: { damage: 120 }, progress: { medals: [{ seasonKey: claimed.season.key }] } });
    await expect(service.bossHuntClaim(owner, { requestId: nextRequestId() })).rejects.toMatchObject({ status: 409 });
    expect(claimed.victoryReward).toMatchObject({ coins: 20_000_000, case: { caseId: 'crate-4018', keyId: 'key-1309' } });
    expect(state.skinCases[13].cases['crate-4018']).toBe(1);
    expect(state.skinCases[13].keys['key-1309']).toBe(1);
    expect(state.taixiu.balances[13]).toBe(20_000_000);
});
