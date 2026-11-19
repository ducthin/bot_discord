jest.mock('node:timers/promises', () => ({ setTimeout: jest.fn().mockResolvedValue() }));

const battle = require('../utils/cs2Battles');
const reel = require('../utils/cs2Reel');
const { customCases } = require('../utils/cs2BattleCases');
const { createBattleUi } = require('../utils/cs2BattleUi');
const { formatCoins } = require('../utils/coins');
const market = require('../utils/cs2Market');
const { items: blueGemArt } = require('../assets/cs2-blue-gems/manifest.json');

const caseId = customCases[0].id;
const users = ['101', '102', '103', '104'];

afterEach(() => { jest.restoreAllMocks(); });

function fixture({ mode = 'regular', winningSeat = 1, teams = false, legacy = false, split = false, size = teams ? 4 : 3 } = {}) {
    const seated = Array.from({ length: size }, (_, index) => ({ id: String(101 + index),
        ...(teams ? { team: index < 2 ? 'A' : 'B' } : {}) }));
    const players = legacy ? [seated[0], seated[2], seated[1], seated[3]] : seated;
    const values = teams ? (split ? [100n, 200n, 150n, 150n] : [100n, 400n, 200n, 200n])
        : seated.map((_player, index) => index + 1 === winningSeat ? (mode === 'crazy' ? 100n : 300n) : 200n);
    const totals = Object.fromEntries(seated.map((player, index) => [player.id, values[index] * 100n]));
    const winners = mode === 'sharing' || split ? players.map(player => player.id)
        : teams ? seated.filter(player => player.team === (mode === 'crazy' ? 'B' : 'A')).map(player => player.id)
            : [seated[winningSeat - 1].id];
    const pool = Object.values(totals).reduce((sum, value) => sum + value, 0n);
    const coinPayout = teams || mode === 'sharing' || split;
    const payouts = coinPayout ? Object.fromEntries(winners.map((id, index) => [id,
        (pool / BigInt(winners.length) + (BigInt(index) < pool % BigInt(winners.length) ? 1n : 0n)).toString()])) : {};
    return { id: '70001', channelId: '20', hostId: users[0], status: 'finished', format: teams ? 'teams' : size > 4 ? 'custom' : String(size),
        ...(size > 4 ? { playerLimit: size } : {}),
        mode, tieRule: 'split', tie: split, tieSplit: split, fee: '100', caseIds: [caseId], players,
        seats: Object.fromEntries(seated.map((player, index) => [player.id, index + 1])), winners, payouts,
        payoutType: coinPayout ? 'coins' : 'skins', pool: pool.toString(),
        totals: Object.fromEntries(Object.entries(totals).map(([id, value]) => [id, value.toString()])),
        rounds: [{ caseId, entries: players.map(player => ({ userId: player.id, value: totals[player.id].toString(),
            drop: { skinId: 'audit-skin', tag: `drop-for-${player.id}`, reelSeed: Number(player.id) } })) }] };
}

async function reveal(room, { renderBatch, editReply = jest.fn(), attachmentSizeLimit = 1_000_000 } = {}) {
    const render = jest.spyOn(reel, 'renderCaseBatch').mockResolvedValue({ gif: Buffer.from('audit-gif') });
    if (renderBatch) render.mockImplementation(renderBatch);
    jest.spyOn(battle, 'actOnRoom').mockResolvedValue({ room, started: true });
    jest.spyOn(battle, 'markResultPublished').mockResolvedValue(null);
    const ui = createBattleUi({ rollDrop: jest.fn(), dropName: drop => drop.tag, dropImage: jest.fn(),
        showResult: jest.fn(), reelRound: (_item, drop) => ({
            cards: [{ image: 'https://example.com/audit.png', color: '#4b69ff' }], selectedIndex: 0,
            result: { ...drop, title: drop.tag, detail: 'audit', color: '#4b69ff' }, landingSeed: drop.reelSeed
        }) });
    const interaction = { id: '80001', customId: `mg_hom_battle-join_${room.id}`, guild: { id: '1' }, guildId: '1',
        channelId: '20', user: { id: users.at(-1) }, message: { id: 'message-1' }, attachmentSizeLimit,
        deferUpdate: jest.fn(), editReply, followUp: jest.fn(), reply: jest.fn() };
    await ui.handle(interaction);
    const updates = editReply.mock.calls.map(([payload]) => payload);
    return { render, updates, panel: updates.at(-1) };
}

function expectMapping(room, render, panel) {
    expect(render).toHaveBeenCalledTimes(1);
    const batch = render.mock.calls[0][0];
    expect(batch.map(row => row.result.tag)).toEqual(room.rounds[0].entries.map(entry => entry.drop.tag));
    expect(batch.map(row => row.landingSeed)).toEqual(room.rounds[0].entries.map(entry => entry.drop.reelSeed));
    const fields = panel.embeds[0].toJSON().fields;
    const scores = fields.find(field => field.name === 'Bảng điểm').value.split('\n');
    const details = fields.filter(field => field.name.startsWith('Vòng 1 ·')).flatMap(field => field.value.split('\n'));
    for (const player of room.players) {
        const label = battle.seatLabel(room, room.seats[player.id]);
        const score = scores.find(line => line.includes(`<@${player.id}>`));
        expect(score).toContain(`${label} · <@${player.id}>`);
        expect(score).toContain(formatCoins(BigInt(room.totals[player.id])));
        const detail = details.find(line => line.includes(`<@${player.id}>`));
        expect(detail).toContain(`drop-for-${player.id}`);
        expect(detail).toContain(formatCoins(BigInt(room.totals[player.id])));
    }
    if (room.payoutType === 'skins') {
        const award = fields.find(field => field.name === 'Thắng trận').value;
        expect(award).toContain(`<@${room.winners[0]}>`);
        for (const player of room.players.filter(player => !room.winners.includes(player.id))) {
            expect(award).not.toContain(`<@${player.id}>`);
        }
    } else {
        const award = fields.find(field => ['Chia thưởng bằng xu', 'Thưởng đội bằng xu'].includes(field.name)).value;
        for (const [id, amount] of Object.entries(room.payouts)) {
            const line = award.split('\n').find(value => value.includes(`<@${id}>`));
            expect(line).toContain(formatCoins(BigInt(amount)));
        }
    }
}

test.each(['fresh', 'estimate', 'snapshot-missing', 'locked'])('the #363 result identifies %s seed pricing and links the exact pattern', async status => {
    const room = fixture();
    const { skinId, patternUrl } = blueGemArt.find(item => item.paintSeed === 363);
    const entry = room.rounds[0].entries[0];
    Object.assign(entry.drop, {
        skinId, float: 0.988009, paintSeed: 363, statTrak: false,
        tag: 'Five-SeveN | Case Hardened · Blue Gem #363',
        ...(status === 'locked' ? { priceVariant: 'blue-gem' } : {})
    });
    const price = jest.spyOn(market, 'peekMarketDisplay').mockReturnValue({
        status, quote: status === 'snapshot-missing' ? null : { priceVnd: 7_731_000 }
    });
    const { panel } = await reveal(room);
    const fields = panel.embeds[0].toJSON().fields;
    const detail = fields.find(field => field.name.startsWith('Vòng 1 ·')).value;
    expect(detail).toContain(`[Ảnh seed #363](${patternUrl})`);
    expect(detail).toContain(status === 'locked' ? 'CSFloat đã khóa' : 'điểm Battle');
    if (status === 'locked') expect(price).not.toHaveBeenCalled();
    else expect(price).toHaveBeenCalledWith('Five-SeveN | Case Hardened (Battle-Scarred)',
        { name: 'Five-SeveN | Case Hardened (Battle-Scarred)', phase: null, paintSeed: 363 });
    if (status === 'fresh' || status === 'estimate') {
        expect(detail).toContain(`CSFloat${status === 'estimate' ? ' đã lưu' : ''}: **7,731,000 xu**`);
    }
    if (status === 'snapshot-missing') expect(detail).toContain('CSFloat chưa có giá đúng seed');
    expect(fields.find(field => field.name === 'Bảng điểm').value).toContain(formatCoins(BigInt(entry.value)));
    expect(fields.find(field => field.name === 'Bảng điểm').value).not.toContain('7,731,000');
});

test.each(['regular', 'crazy'].flatMap(mode => [1, 2, 3].map(winningSeat => [mode, winningSeat])))
    ('three-seat %s maps a winner in position %s to the same reel, score, drop and award', async (mode, winningSeat) => {
        const room = fixture({ mode, winningSeat });
        const { render, panel } = await reveal(room);
        expectMapping(room, render, panel);
    });

test('Sharing retains each of three owners while displaying exact split amounts', async () => {
    const room = fixture({ mode: 'sharing' });
    const { render, panel } = await reveal(room);
    expectMapping(room, render, panel);
});

test.each(['regular', 'crazy'].flatMap(mode => [false, true].map(legacy => [mode, legacy])))
    ('team %s displays the right seats and owners with legacy order %s', async (mode, legacy) => {
        const room = fixture({ mode, teams: true, legacy });
        const { render, panel } = await reveal(room);
        expectMapping(room, render, panel);
        const teamScores = panel.embeds[0].toJSON().fields.find(field => field.name === 'Điểm theo đội').value;
        expect(teamScores).toContain(`Đội A · **${formatCoins(50000n)}**`);
        expect(teamScores).toContain(`Đội B · **${formatCoins(40000n)}**`);
    });

test('a tied team result keeps all four seat labels and awards the saved split amounts', async () => {
    const room = fixture({ teams: true, legacy: true, split: true });
    const { render, panel } = await reveal(room);
    expectMapping(room, render, panel);
});

test.each([
    [6, [3, 3], 1_000_000, 1_000_000],
    [7, [3, 2, 2], 1_000_000, 1_000_000],
    [10, [3, 3, 2, 2], 50_000_000, 5_000_000]
])('%i seats play in full-width groups in the saved entry order with one message update', async (size, groupSizes, attachmentSizeLimit, groupLimit) => {
    const room = fixture({ size });
    const { render, updates } = await reveal(room, { attachmentSizeLimit });
    const batches = render.mock.calls.map(([batch, limit, options]) => {
        expect(limit).toBe(groupLimit);
        expect(options).toEqual({ profile: 'battle', fullWidth: true });
        return batch;
    });
    expect(batches.map(batch => batch.length)).toEqual(groupSizes);
    expect(batches.flat().map(seat => seat.landingSeed)).toEqual(room.rounds[0].entries.map(entry => entry.drop.reelSeed));

    const uploads = updates.filter(update => update.files?.length);
    expect(uploads).toHaveLength(1);
    const [upload] = uploads;
    const filenames = groupSizes.map((_, index) => index === 0 ? 'cs2-battle.gif' : `cs2-battle-${index + 1}.gif`);
    expect(upload.files.map(file => file.name)).toEqual(filenames);
    expect(upload.embeds.map(embed => embed.toJSON().image.url))
        .toEqual(filenames.map(filename => `attachment://${filename}`));
    let firstSeat = 1;
    for (const [index, groupSize] of groupSizes.entries()) {
        const lastSeat = firstSeat + groupSize - 1;
        expect(upload.files[index].description).toBe(`Vị trí ${firstSeat}–${lastSeat}`);
        firstSeat = lastSeat + 1;
    }
});

test('a render failure falls back to the full round in one GIF', async () => {
    const room = fixture({ size: 6 });
    const { render, updates } = await reveal(room, {
        renderBatch: (_batch, _limit, options) => Promise.resolve(options.fullWidth ? null : { gif: Buffer.from('grid-gif') })
    });
    const [batch, , options] = render.mock.calls.at(-1);
    expect(options).toEqual({ profile: 'battle' });
    expect(batch.map(seat => seat.result.tag)).toEqual(room.rounds[0].entries.map(entry => entry.drop.tag));
    const uploads = updates.filter(update => update.files?.length);
    expect(uploads).toHaveLength(1);
    expect(uploads[0].files).toEqual([{ name: 'cs2-battle.gif', attachment: Buffer.from('grid-gif') }]);
});

test('a rejected GIF upload falls back to the text panel without empty image embeds', async () => {
    const room = fixture({ size: 6 });
    const rejected = Object.assign(new Error('Request entity too large'), { code: 40005 });
    const editReply = jest.fn(async payload => { if (payload.files?.length > 1) throw rejected; });
    const { updates } = await reveal(room, { editReply });
    const uploadIndex = updates.findIndex(update => update.files?.length === 2);
    expect(uploadIndex).toBeGreaterThanOrEqual(0);
    const upload = updates[uploadIndex];
    const fallback = updates[uploadIndex + 1];
    expect(fallback.files).toBeUndefined();
    expect(fallback.attachments).toEqual([]);
    expect(fallback.embeds).toHaveLength(1);
    const embed = fallback.embeds[0].toJSON();
    expect(embed.image).toBeUndefined();
    expect(embed.title).toBe(upload.embeds[0].toJSON().title);
    expect(embed.fields).toEqual(upload.embeds[0].toJSON().fields);
});
