const { collections, skins, containers } = require('./cs2Catalogue');
const { wearBounds } = require('./cs2MarketNames');

// Collection sources describe skin provenance; these are custom bot cases.
// The published four groups are item groups, not a claim of monetary profit.
const collectionSpecs = [
    ['cobblestone', 'Di Sản Cobblestone', 'AWP | Dragon Lore'],
    ['norse', 'Thần Thoại Norse', 'AWP | Gungnir'],
    ['gods-and-monsters', 'Thần Và Quái Vật', 'AWP | Medusa'],
    ['stmarc', 'Vườn St. Marc', 'AK-47 | Wild Lotus'],
    ['dust-2-2021', 'Kho Vàng Dust II', 'AK-47 | Gold Arabesque'],
    ['mirage-2021', 'Ốc Đảo Mirage', 'AWP | Desert Hydra'],
    ['vertigo-2021', 'Đỉnh Tháp Vertigo', 'M4A1-S | Imminent Danger'],
    ['canals', 'Hoàng Tử Canals', 'AWP | The Prince'],
    ['kimono', 'Mặt Trời Phương Đông', 'AUG | Akihabara Accept'],
    ['op10-t', 'Kho Báu Havoc', 'AK-47 | X-Ray'],
    ['op10-ct', 'Trung Tâm Control', 'AWP | Fade'],
    ['op10-ancient', 'Rừng Cổ Ancient', 'M4A1-S | Welcome to the Jungle'],
    ['chopshop', 'Xưởng Hot Rod', 'M4A1-S | Hot Rod'],
    ['bank', 'Két Sắt Bank', 'AK-47 | Emerald Pinstripe'],
    ['assault', 'Di Sản Glock Fade', 'Glock-18 | Fade'],
    ['dust', 'Ngọn Lửa Blaze', 'Desert Eagle | Blaze'],
    ['dust-2', 'Di Sản Dust II', 'P2000 | Amber Fade'],
    ['italy', 'Di Sản Italy', 'AWP | Pit Viper'],
    ['cache', 'Phóng Xạ Cache', 'Galil AR | Cerberus'],
    ['baggage', 'Hành Lý Jet Set', 'AK-47 | Jet Set'],
    ['overpass', 'Đường Hầm Overpass', 'M4A1-S | Master Piece'],
    ['nuke', 'Lõi Lò Phản Ứng', 'M4A4 | Radiation Hazard'],
    ['inferno', 'Di Sản Inferno', 'Dual Berettas | Anodized Navy'],
    ['anubis', 'Mắt Thần Horus', 'M4A4 | Eye of Horus'],
    ['overpass-2024', 'Quái Vật Overpass', 'AK-47 | B the Monster'],
    ['train-2021', 'Chuyến Tàu Emerald', 'Glock-18 | Gamma Doppler'],
    ['realism-camo', 'Sân Đấu Fade', 'M4A1-S | Fade'],
    ['graphic-design', 'Phòng Tranh CMYK', 'AWP | CMYK'],
    ['inferno-2', 'Đường Đua Integrale', 'SG 553 | Integrale'],
    ['mirage', 'Di Sản Hot Rod', 'MP9 | Hot Rod']
];
const profiles = [[6500, 2600, 750, 150], [7000, 2200, 650, 150],
    [5500, 3000, 1200, 300], [6000, 2700, 1100, 200], [5000, 3200, 1400, 400]];

function validWears(skin) {
    return [0, 1, 2, 3, 4].filter(wear => Math.round(skin.min * 1e6) <= Math.min(Math.round(skin.max * 1e6),
        Math.round(wearBounds[wear + 1] * 1e6) - Number(wear < 4)) && skin.max >= wearBounds[wear]);
}
function preferredWear(skin) {
    // Scarce collection finishes use their commonly traded wear as the anchor.
    // Other legal wears remain candidates and still need their own fresh quote.
    if (["MP9 | Dark Age", "MP9 | Pandora's Box", 'G3SG1 | Chronos',
        'Negev | Mjölnir', 'Five-SeveN | Neon Kimono'].includes(skin.name)) return 0;
    const wears = validWears(skin);
    return wears.includes(2) ? 2 : wears[0];
}
function sourceEntries(source) {
    return source.pools.flatMap((pool, tier) => pool.map(skinId => ({ source: source.id, skinId, tier })));
}
const catalogue = containers.flatMap(sourceEntries);
function reward(name, wear, statTrak = false) {
    const entry = catalogue.find(entry => skins[entry.skinId].name === name);
    if (!entry) throw new Error(`Missing iconic reward: ${name}`);
    return [entry.source, entry.skinId, wear ?? preferredWear(skins[entry.skinId]), statTrak];
}
const iconicMatches = new Map();
const iconicDefinitions = collectionSpecs.map(([suffix, name, featured], index) => {
    const source = collections.find(item => item.id === `collection-set-${suffix}`);
    if (!source) throw new Error(`Missing iconic collection: ${suffix}`);
    const entries = sourceEntries(source).sort((a, b) => a.tier - b.tier || a.skinId.localeCompare(b.skinId));
    const jackpot = entries.find(entry => skins[entry.skinId].name === featured &&
        (suffix !== 'train-2021' || skins[entry.skinId].phase === 'Emerald'));
    if (!jackpot) throw new Error(`Missing featured finish in ${suffix}: ${featured}`);
    const choices = entries.filter(entry => entry !== jackpot);
    // Pick distinct finishes first. Small historical collections fill with valid wears.
    const selected = choices.slice(0, 2);
    for (const entry of choices.slice(2).reverse()) if (selected.length < 5) selected.push(entry);
    const rewards = selected.map(entry => [source.id, entry.skinId, preferredWear(skins[entry.skinId]), false]);
    const taken = new Set(rewards.map(tuple => tuple.join('/')));
    const jackpotReward = [source.id, jackpot.skinId, preferredWear(skins[jackpot.skinId]), false];
    taken.add(jackpotReward.join('/'));
    for (const entry of [...choices, jackpot]) {
        for (const wear of validWears(skins[entry.skinId])) {
            const tuple = [source.id, entry.skinId, wear, false];
            if (rewards.length < 5 && !taken.has(tuple.join('/'))) {
                rewards.push(tuple); taken.add(tuple.join('/'));
            }
        }
    }
    if (rewards.length !== 5) throw new Error(`Insufficient collection variants: ${suffix}`);
    rewards.push(jackpotReward);
    if (suffix === 'assault') rewards.splice(0, 6,
        reward('Negev | Anodized Navy', 0), reward('AUG | Hot Rod', 0),
        reward('MP9 | Bulldozer', 2), reward('MP9 | Bulldozer', 1),
        reward('Glock-18 | Fade', 1), reward('Glock-18 | Fade', 0));
    if (suffix === 'nuke') rewards.splice(0, 6,
        reward('M4A4 | Radiation Hazard', 2), reward('M4A4 | Radiation Hazard', 3),
        reward('P250 | Nuclear Threat', 2), reward('Tec-9 | Nuclear Threat', 2),
        reward('P250 | Nuclear Threat', 0), reward('M4A4 | Radiation Hazard', 0));
    const id = `archive-${suffix}`;
    iconicMatches.set(id, entry => entry.drop.caseId === source.id);
    const profile = Object.freeze([...profiles[index % profiles.length]]);
    return [id, name, 'theme', `Hòm tự tạo từ ${source.name}; nổi bật ${featured}.`, source.id, rewards, profile];
});

const premiumSpecs = [
    ['howl', 'Howl Contraband', 'Chỉ M4A4 Howl thường và StatTrak™; giữ độ hiếm Contraband.', [5200, 3000, 1400, 400], [
        ['M4A4 | Howl', 2], ['M4A4 | Howl', 1], ['M4A4 | Howl', 0],
        ['M4A4 | Howl', 2, true], ['M4A4 | Howl', 1, true], ['M4A4 | Howl', 0, true]]],
    ['howl-hunt', 'Dấu Chân Sói', 'Chuyên M4A4, với Howl ở nhóm đặc biệt.', [8500, 1300, 100, 100], [
        ['M4A4 | Etch Lord', 2], ['M4A4 | Choppa', 2], ['M4A4 | Desolate Space', 2],
        ['M4A4 | Temukau', 2], ['M4A4 | The Emperor', 1], ['M4A4 | Howl', 2]]],
    ['awp-legends', 'Huyền Thoại AWP', 'Bộ AWP sưu tầm: Fade, Medusa, The Prince, Desert Hydra, Dragon Lore và Gungnir.', [5000, 3000, 1500, 500], [
        ['AWP | Fade', 0], ['AWP | Medusa', 2], ['AWP | The Prince', 2],
        ['AWP | Desert Hydra', 2], ['AWP | Dragon Lore', 2], ['AWP | Gungnir', 1]]],
    ['ak-collectors', 'Bảo Tàng AK-47', 'Hydroponic, Gold Arabesque, X-Ray và Wild Lotus cùng các AK sưu tầm.', [5500, 3000, 1200, 300], [
        ['AK-47 | Jet Set', 2], ['AK-47 | Panthera onca', 2], ['AK-47 | Hydroponic', 2],
        ['AK-47 | Gold Arabesque', 2], ['AK-47 | X-Ray', 2], ['AK-47 | Wild Lotus', 1]]],
    ['m4-collectors', 'Bảo Tàng M4', 'Icarus Fell, Hot Rod, Blue Phosphor, Knight, Welcome to the Jungle và Howl.', [5000, 3200, 1400, 400], [
        ['M4A1-S | Icarus Fell', 0], ['M4A1-S | Hot Rod', 0], ['M4A1-S | Blue Phosphor', 0],
        ['M4A1-S | Knight', 0], ['M4A1-S | Welcome to the Jungle', 2], ['M4A4 | Howl', 1]]],
    ['pistol-relics', 'Di Vật Súng Lục', 'Súng lục sưu tầm với Hand Cannon, Twilight Galaxy, Blaze và Glock Fade.', [6000, 2600, 1100, 300], [
        ['CZ75-Auto | Chalice', 0], ['Desert Eagle | Hand Cannon', 2], ['USP-S | Target Acquired', 2],
        ['Glock-18 | Twilight Galaxy', 0], ['Desert Eagle | Blaze', 0], ['Glock-18 | Fade', 0]]]
];
for (const [id, name, description, shares, items] of premiumSpecs) {
    const rewards = items.map(tuple => reward(...tuple));
    const allowed = new Set(rewards.map(tuple => tuple[1]));
    iconicMatches.set(id, entry => allowed.has(entry.drop.skinId));
    const profile = Object.freeze([...shares]);
    iconicDefinitions.push([id, name, 'theme', description, rewards.at(-1)[0], rewards, profile]);
}
const ICONIC_CASE_IDS = Object.freeze(iconicDefinitions.map(([id]) => `battle-${id}`));
module.exports = { iconicDefinitions, iconicMatches, ICONIC_CASE_IDS };
