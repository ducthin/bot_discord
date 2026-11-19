const crypto = require('node:crypto');
const { cases, collections, containersById, skins } = require('./cs2Catalogue');
const { COIN_SCALE } = require('./coins');
const { wearBounds } = require('./cs2MarketNames');
const { MAX_PAINT_SEED, isBlueGem, blueGemSeeds } = require('./cs2Patterns');
const market = require('./cs2Market');
const { discoveryDefinitions, discoveryMatches, DISCOVERY_CASE_IDS } = require('./cs2DiscoveryCases');
const { iconicDefinitions, iconicMatches, ICONIC_CASE_IDS } = require('./cs2IconicCases');

const TICKETS = 10_000;
const RETURN_PERCENT = 95n;
const FLOAT_SCALE = 1_000_000;
const SEED_COUNT = MAX_PAINT_SEED + 1;
const JOINT_TICKETS = BigInt(TICKETS * SEED_COUNT);
const GOLD_TIER = 4;
const ALTERNATIVES_PER_ANCHOR = 5;
const wearTicks = wearBounds.map(bound => Math.round(bound * FLOAT_SCALE));

// Farm cases publish a large cheap-item range and a small expensive-item range, rather than
// choosing a winner from the players. Examples: skin.club/en/cases/open/easy_knife and
// skin.club/en/cases/open/farm-gloves. This catalogue uses its own odds and a 95% return.

// Source case, finish, exterior, tickets. The source keeps inventory and Trade Up compatibility.
const originalCases = [
    ['battle-balance', 'Battle Cân Bằng', 'Nhiều mức giá, từ skin phổ thông đến dao.', 'crate-4904', 'casual', [
        ['crate-4904', 'skin-8d6879f0a2bc', 0, 3000],
        ['crate-4904', 'skin-2c04c0201892', 1, 2800],
        ['crate-4089', 'skin-ea4e27f0cd16', 1, 1790],
        ['crate-4904', 'skin-63c1d72b8501', 2, 1500],
        ['crate-4846', 'skin-f10cd3871578', 1, 800],
        ['crate-7007', 'skin-5a39103af835', 2, 100],
        ['crate-7003', 'skin-6dbefc59c1b9', 0, 10]
    ]],
    ['battle-rifles', 'Battle Hỏa Lực', 'AK, M4 và cơ hội ra Karambit Doppler.', 'crate-4846', 'theme', [
        ['crate-4089', 'skin-ea4e27f0cd16', 2, 3400],
        ['crate-4904', 'skin-63c1d72b8501', 1, 2600],
        ['crate-4846', 'skin-f10cd3871578', 0, 2000],
        ['crate-4011', 'skin-91a429af4a60', 2, 1200],
        ['crate-4904', 'skin-82dc98e09ba6', 1, 600],
        ['crate-4717', 'skin-8e45a15cf7f5', 2, 180],
        ['crate-4233', 'skin-a7465b45d267', 0, 20]
    ]],
    ['battle-farm', 'Battle Săn Vàng', 'Phí thấp hơn, phần lớn là skin rẻ và có cơ hội ra đồ vàng.', 'crate-4233', 'gold', [
        ['crate-4904', 'skin-8d6879f0a2bc', 2, 9300],
        ['crate-4471', 'skin-52971a3886a2', 1, 500],
        ['crate-4904', 'skin-63c1d72b8501', 1, 150],
        ['crate-4904', 'skin-82dc98e09ba6', 2, 45],
        ['crate-4233', 'skin-a7465b45d267', 0, 5]
    ]]
];

// Source case number, skin ID suffix, exterior index, tickets out of 10,000.
const extraCases = [
    ['starter', 'Khởi Động', 'casual', 'Skin phổ thông, phí thấp cho lượt mở đầu tiên.', 4904, [
        [4904, 'baa1adba3189', 2, 3000], [4904, 'c176fd51f6b9', 2, 2600], [4880, '2f564d56b7ff', 1, 2000],
        [7007, '5626422553f8', 1, 1400], [4904, '543d85d8ca60', 0, 800], [7007, '0fbe55711fa6', 0, 200]
    ]],
    ['quick-hit', 'Chớp Nhoáng', 'casual', 'Mở phí thấp để săn AWP Printstream.', 7007, [
        [4904, 'baa1adba3189', 2, 7600], [4846, '2a4119de0db9', 2, 1700], [7007, '4515a7cdcc74', 1, 500],
        [4904, '9eb2feb216c5', 1, 180], [7007, '5a39103af835', 2, 20]
    ]],
    ['mil-spec', 'Mil-Spec', 'rarity', 'Chỉ có skin xanh dương, với phần thưởng cao nhất ở độ mòn Factory New.', 4695, [
        [4904, '8d6879f0a2bc', 2, 2800], [7007, '0fbe55711fa6', 2, 2200], [7007, 'a8cc985f8710', 1, 1900],
        [4846, '35998e06d00e', 0, 1600], [4089, 'ea4e27f0cd16', 2, 1000], [4695, '29f83d73bb6a', 0, 500]
    ]],
    ['restricted', 'Restricted', 'rarity', 'Chỉ có skin tím, từ M4A4 Etch Lord đến AK-47 Slate.', 4747, [
        [4904, '0e160542d6d4', 2, 3000], [4818, 'f3392bb443bc', 1, 2400], [4471, '52971a3886a2', 1, 1800],
        [4695, 'e5f08d307bdd', 1, 1500], [4598, 'd6cf8565026b', 2, 1000], [4747, '48e1c7c5df5e', 0, 300]
    ]],
    ['classified', 'Classified', 'rarity', 'Chỉ có skin hồng. Có Redline và Decimator trong bảng thưởng.', 4011, [
        [4880, 'd42f9ca97ef6', 2, 3400], [4904, '63c1d72b8501', 2, 2600], [4548, 'a79b5b4ad623', 2, 1700],
        [4846, 'f10cd3871578', 1, 1300], [4351, '7b3af96bd1e4', 1, 800], [4011, '91a429af4a60', 1, 200]
    ]],
    ['covert', 'Covert', 'rarity', 'Chỉ có skin đỏ, từ Glock Gold Toof đến AK-47 Bloodsport.', 4351, [
        [4904, 'b986a2456e28', 2, 2900], [7003, '5bd16f2599cf', 2, 2400], [4471, 'e8144faeae9f', 2, 2100],
        [4846, 'be37abed2b4d', 1, 1400], [7007, '5a39103af835', 1, 900], [4351, 'ba052cf18c66', 1, 300]
    ]],
    ['zeus', 'Tia Sét Zeus', 'weapon', 'Zeus x27 Tosai và Olympus ở nhiều độ mòn.', 7007, [
        [7007, '27a11235665e', 2, 3400], [7007, '27a11235665e', 1, 3200], [7007, '27a11235665e', 0, 2300],
        [4904, '9eb2feb216c5', 2, 800], [4904, '9eb2feb216c5', 1, 250], [4904, '9eb2feb216c5', 0, 50]
    ]],
    ['glock', 'Glock-18', 'weapon', 'Từ Winterized và Block-18 đến Shinobu và Gold Toof.', 7003, [
        [4846, '2a4119de0db9', 2, 3400], [4880, '99526dbb85e6', 1, 2500], [4471, '52971a3886a2', 1, 1900],
        [4281, '0e48389f836a', 1, 1500], [7007, 'a7838b4ba71f', 1, 650], [7003, '5bd16f2599cf', 2, 50]
    ]],
    ['usp', 'USP-S', 'weapon', 'Ticket to Hell, Cyrex, Printstream và Kill Confirmed.', 4138, [
        [7007, '0fbe55711fa6', 1, 2900], [4818, 'f3392bb443bc', 2, 2300], [4548, '9e44f13c59da', 1, 2300],
        [4288, '95653cc7fb0e', 2, 1800], [4846, 'be37abed2b4d', 2, 600], [4138, 'cf4c11689014', 1, 100]
    ]],
    ['deagle', 'Desert Eagle', 'weapon', 'Từ Bronze Deco đến Printstream và Ocean Drive.', 4698, [
        [4089, '7698ea25d00a', 1, 2700], [4747, '337794166cad', 2, 2600], [4598, '2a0e222beb58', 1, 2200],
        [4548, 'a79b5b4ad623', 2, 1800], [4698, '32a30647e564', 2, 650], [4790, '55623b84dd72', 1, 50]
    ]],
    ['smg', 'Đội Cận Chiến', 'weapon', 'MAC-10 và MP9, có Disco Tech và Starlight Protector.', 4818, [
        [4904, '543d85d8ca60', 2, 2900], [7007, '038541568496', 1, 2400], [4880, '2f564d56b7ff', 0, 2300],
        [7003, '1328a63c72b5', 1, 1700], [4695, 'f5a050fa5280', 1, 650], [4818, 'feae180c4968', 2, 50]
    ]],
    ['scout', 'SSG 08', 'weapon', 'Dezastre, Ghost Crusader và Dragonfire cho người thích Scout.', 4288, [
        [4904, 'c176fd51f6b9', 1, 3000], [7007, 'a8cc985f8710', 1, 2500], [4695, 'e5f08d307bdd', 2, 2200],
        [4233, '896626717e7c', 1, 1700], [4138, '8d0a500e57c0', 1, 550], [4288, '318f343e125d', 2, 50]
    ]],
    ['ak', 'AK-47 Battle', 'weapon', 'Chuyên AK-47, với Redline, Neon Rider và Vulcan.', 4017, [
        [4598, '9a7c16468868', 2, 3000], [4089, 'ea4e27f0cd16', 1, 2400], [4747, '48e1c7c5df5e', 1, 2100],
        [4846, 'f10cd3871578', 0, 1500], [4011, '91a429af4a60', 2, 700], [4482, '74e670c4b279', 1, 250],
        [4017, 'b14c9f234bc5', 1, 50]
    ]],
    ['m4a4', 'M4A4', 'weapon', 'Etch Lord, Desolate Space, Temukau và Buzz Kill.', 4880, [
        [7007, '5626422553f8', 1, 2800], [4904, '0e160542d6d4', 1, 2500], [4698, '1e9229953491', 1, 2200],
        [4236, 'ca4eb6f53d0e', 2, 1600], [4880, '1aba3ea9ecc5', 1, 800], [4288, '01d7c60eddbb', 2, 100]
    ]],
    ['m4a1', 'M4A1-S', 'weapon', 'Black Lotus, Decimator, Vaporwave và Printstream.', 4717, [
        [4880, 'e4cd5a266934', 1, 2700], [4818, 'ec2dd0814c74', 0, 2400], [4904, '63c1d72b8501', 1, 2100],
        [4351, '7b3af96bd1e4', 2, 1900], [7003, 'aa9558c8a01f', 1, 800], [4717, '8e45a15cf7f5', 1, 100]
    ]],
    ['awp', 'AWP Battle', 'weapon', 'Từ Capillary và PAW đến Asiimov và Oni Taiji.', 4352, [
        [4695, '29f83d73bb6a', 2, 2800], [4482, '860a0652d07a', 2, 2500], [4880, 'd42f9ca97ef6', 1, 2100],
        [4904, 'b986a2456e28', 2, 1700], [4011, 'bb633c21fc25', 2, 800], [4352, 'cfaaa2fab447', 1, 100]
    ]],
    ['printstream', 'Printstream', 'theme', 'Bộ súng đen trắng với bốn mẫu Printstream.', 4698, [
        [7003, '48039a85c871', 1, 3400], [4818, 'f3392bb443bc', 1, 2600], [4698, '32a30647e564', 2, 1900],
        [4846, 'be37abed2b4d', 2, 1200], [7007, '5a39103af835', 1, 700], [4717, '8e45a15cf7f5', 1, 200]
    ]],
    ['neon', 'Phố Neon', 'theme', 'Saibā Oni, Disco Tech, Neon Rider, Vaporwave và dao Fade.', 4403, [
        [7003, '1328a63c72b5', 2, 3200], [4695, 'f5a050fa5280', 2, 2700], [4846, 'f10cd3871578', 1, 2200],
        [4482, '74e670c4b279', 2, 1200], [7003, 'aa9558c8a01f', 1, 600], [7003, '6dbefc59c1b9', 0, 100]
    ]],
    ['crimson', 'Đỏ Đen', 'theme', 'Redline, Code Red, Bloodsport và Butterfly Crimson Web.', 4482, [
        [7007, '4c2e3face5fd', 2, 3100], [4011, '91a429af4a60', 2, 2700], [4482, '87ee5eacc505', 2, 2200],
        [4351, 'ba052cf18c66', 2, 1500], [4003, '2599a8720f89', 2, 450], [4018, '6c3fbb89c658', 1, 50]
    ]],
    ['vintage', 'Kho Cổ Điển', 'theme', 'Skin đời đầu, từ Blue Laminate đến Fire Serpent.', 4003, [
        [4005, '1970fa831101', 2, 2800], [4005, 'b712400e97a9', 2, 2300], [4001, '795d725893f2', 2, 2100],
        [4003, '278adf18c50e', 0, 1800], [4001, '69390026d135', 0, 900], [4003, '2599a8720f89', 2, 100]
    ]],
    ['farm-knife', 'Săn Dao', 'gold', 'Hòm phí thấp, trượt dao sẽ nhận skin súng.', 4598, [
        [4904, '543d85d8ca60', 2, 9200], [4904, '0e160542d6d4', 2, 730], [4695, '7a113ccd4c2e', 4, 40],
        [4548, 'b9e7dc445655', 0, 20], [7003, '6dbefc59c1b9', 0, 10]
    ]],
    ['farm-glove', 'Săn Găng', 'gold', 'Hòm phí thấp với cơ hội ra găng Hydra, Fade hoặc Vice.', 4846, [
        [7007, '038541568496', 2, 9400], [7007, '4515a7cdcc74', 2, 550], [4880, 'fb73d424e4dd', 2, 30],
        [4880, '25bbf8e641c1', 2, 15], [4880, 'c1ae7186f829', 2, 5]
    ]],
    ['knife', 'Dao Tân Binh', 'gold', 'Mỗi lượt nhận một dao. Có Kukri Fade và Gut Tiger Tooth.', 4695, [
        [4695, '7a113ccd4c2e', 4, 3000], [4548, '884cb5d4bb22', 2, 2700], [7007, '0e190498bba1', 4, 2100],
        [4698, '252dd6c23b7d', 2, 1500], [4233, 'bd3422fa907e', 0, 600], [7003, '6dbefc59c1b9', 0, 100]
    ]],
    ['glove', 'Đấu Trường Găng', 'gold', 'Mỗi lượt nhận một đôi găng. Giải cao gồm Vice và Hedge Maze.', 4288, [
        [4880, '530add68f13a', 2, 3100], [4846, '7646a28247e0', 2, 2600], [4880, '56be8a3a2bb8', 2, 2100],
        [4880, 'ead101bfb2c9', 2, 1500], [4880, 'c1ae7186f829', 2, 650], [4352, 'b05ee2bf4f0d', 4, 50]
    ]],
    ['fade', 'Đấu Trường Fade', 'gold', 'Chỉ có dao Fade, từ Navaja đến Butterfly.', 4018, [
        [4548, 'b9e7dc445655', 0, 3350], [4186, 'dc8b0d73c0e6', 0, 2400], [4138, 'e3745c88f2ca', 0, 1850],
        [7003, '6dbefc59c1b9', 0, 1500], [4698, '29564901bab8', 1, 850], [4018, '6656ae9270b9', 0, 50]
    ]],
    ['doppler', 'Đấu Trường Doppler', 'gold', 'Dao Doppler có Phase 1–4, Sapphire và Ruby.', 4403, [
        [4403, 'c458ae57ce73', 0, 3450], [4403, 'b2a571ffd94e', 0, 2800], [4403, 'f76fab053a4b', 0, 2000],
        [4403, '7f6c571d7493', 0, 1400], [4233, 'e7fd9a1907bb', 0, 280], [4233, '18a2a3a04055', 0, 50],
        [4233, 'e9fb2b0e49e8', 0, 20]
    ]],
    ['gamma', 'Đấu Trường Gamma', 'gold', 'Dao Gamma Doppler với cơ hội ra Butterfly Emerald.', 4818, [
        [4818, '1af6b8b968de', 0, 2900], [4818, 'e70487f0da3a', 0, 2500], [4818, '21b617e52f11', 0, 2100],
        [4818, '7be9c42f587a', 0, 1500], [4818, '58bc8f68c5c5', 0, 850], [4818, '53e36cb13a7b', 0, 140],
        [4818, 'a07ae9bbbeff', 0, 10]
    ]],
    ['elite', 'Battle Đỉnh Cao', 'theme', 'Fire Serpent, Butterfly Fade, Crimson Kimono và Butterfly Ruby.', 4001, [
        [4003, '278adf18c50e', 0, 2500], [4717, '8e45a15cf7f5', 1, 2300], [4001, '69390026d135', 0, 2000],
        [4003, '2599a8720f89', 2, 1700], [4352, '5766610447f3', 2, 1100], [4018, '6656ae9270b9', 0, 350],
        [4403, 'e0c77218a563', 0, 50]
    ]]
];

function makeEntry(tuple) {
    if (!Array.isArray(tuple) || tuple.length < 4 || tuple.length > 6) return null;
    const [caseId, skinId, exterior, weight, statTrak = false, paintSeed] = tuple;
    const hasPaintSeed = tuple.length === 6;
    const skin = skins[skinId];
    const tier = containersById.get(caseId)?.pools.findIndex(pool => pool.includes(skinId)) ?? -1;
    if (!skin || tier < 0 || typeof statTrak !== 'boolean' || (statTrak && !skin.stattrak)) return null;
    if (hasPaintSeed && !isBlueGem(skinId, paintSeed)) return null;
    if (exterior === null ? skin.min != null || skin.max != null
        : !Number.isInteger(exterior) || exterior < 0 || exterior > 4 || skin.min == null || skin.max == null) return null;
    const min = exterior === null ? null : Math.max(Math.round(skin.min * FLOAT_SCALE), wearTicks[exterior]);
    const max = exterior === null ? null : Math.min(Math.round(skin.max * FLOAT_SCALE), wearTicks[exterior + 1] - Number(exterior < 4));
    const drop = { caseId, skinId, tier, float: min === null ? null : min / FLOAT_SCALE, statTrak };
    if (hasPaintSeed) Object.assign(drop, { paintSeed, priceVariant: 'blue-gem' });
    const ref = market.getDropMarketQuoteRef(drop);
    return min <= max && ref ? { drop, ref, min, max, weight, exterior } : null;
}

const entryKeys = new WeakMap();
const entryKey = entry => {
    if (!entryKeys.has(entry)) entryKeys.set(entry, market.marketQuoteKey(entry.ref.name, entry.ref.phase, entry.ref.paintSeed));
    return entryKeys.get(entry);
};
const revisionOf = entries => crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex');

function catalogueVariants(sources = cases) {
    const variants = [];
    const seen = new Set();
    for (const container of sources) {
        for (const skinId of container.pools.flat()) {
            if (seen.has(skinId)) continue;
            seen.add(skinId);
            const skin = skins[skinId];
            for (const exterior of skin.min == null ? [null] : [0, 1, 2, 3, 4]) {
                for (const statTrak of skin.stattrak ? [false, true] : [false]) {
                    const entry = makeEntry([container.id, skinId, exterior, 0, statTrak]);
                    if (entry) variants.push(entry);
                }
            }
        }
    }
    return variants;
}

const weapons = {
    zeus: ['Zeus x27'], glock: ['Glock-18'], usp: ['USP-S'], deagle: ['Desert Eagle'], smg: ['MAC-10', 'MP9'],
    scout: ['SSG 08'], ak: ['AK-47'], m4a4: ['M4A4'], m4a1: ['M4A1-S'], awp: ['AWP'],
    rifles: ['AK-47', 'M4A1-S', 'M4A4'],
    p250: ['P250'], 'five-seven': ['Five-SeveN'], tec9: ['Tec-9'], cz75: ['CZ75-Auto'],
    'dual-berettas': ['Dual Berettas'], ump45: ['UMP-45'], p90: ['P90'], 'pp-bizon': ['PP-Bizon'],
    mp7: ['MP7'], mp5: ['MP5-SD'], galil: ['Galil AR'], famas: ['FAMAS'],
    p2000: ['P2000'], sg553: ['SG 553'], aug: ['AUG'], g3sg1: ['G3SG1'], scar20: ['SCAR-20'],
    nova: ['Nova'], xm1014: ['XM1014'], negev: ['Negev']
};
const collectionFinishes = {
    asiimov: / \| Asiimov$/, 'mecha-industries': / \| Mecha Industries$/, bloodsport: / \| Bloodsport$/,
    'hyper-beast': / \| Hyper Beast$/, 'wasteland-rebel': / \| Wasteland Rebel$/, 'case-hardened': / \| Case Hardened$/,
    'neo-noir': / \| Neo-Noir$/, 'neon-rider': / \| Neon Rider$/, 'fuel-injector': / \| Fuel Injector$/,
    decimator: / \| Decimator$/, pulse: / \| Pulse$/,
    ember: /Flame|Fire|Heat|Blaze|Incinegator|Firefight/i,
    'night-safari': /Panther|Jaguar|Tiger|Leopard|Lion|Anolis|Chameleon/i,
    arcade: /Button Masher|Player Two|Player One|Game Over|K\.O\. Factory|BI83 Spectrum|Boost Protocol/i,
    botanical: /Bloomstick|Wild Lily|Petal|Rose|Flora|Lotus|Bloom|Arboreal/i,
    horror: /Night Terror|Monster|Apparition|Phobos|Necropos|Dream|Cortex|Grim/i,
    'street-art': /Graffiti|Street|Outbreak|In Living Color|Rebel|Snack Attack/i,
    engineering: /Torque|Power Loader|Control Panel|Lead Conduit|Circuit|Core Breach|Fuel Rod/i
};
const goldWeapons = {
    karambit: '★ Karambit', butterfly: '★ Butterfly Knife', 'm9-bayonet': '★ M9 Bayonet',
    bayonet: '★ Bayonet', talon: '★ Talon Knife', 'sport-gloves': '★ Sport Gloves',
    huntsman: '★ Huntsman Knife', bowie: '★ Bowie Knife', falchion: '★ Falchion Knife',
    'shadow-daggers': '★ Shadow Daggers', paracord: '★ Paracord Knife', survival: '★ Survival Knife',
    nomad: '★ Nomad Knife', skeleton: '★ Skeleton Knife'
};
const experienceWeapons = {
    'pistol-duel': ['P2000', 'USP-S', 'Glock-18', 'P250', 'Desert Eagle'],
    'eco-rush': ['MAC-10', 'MP9', 'MP5-SD', 'UMP-45', 'MP7'],
    'rifle-arena': ['AK-47', 'M4A4', 'M4A1-S', 'Galil AR', 'FAMAS'],
    'sniper-showdown': ['AWP', 'SSG 08', 'G3SG1', 'SCAR-20'],
    'shotgun-breach': ['Nova', 'XM1014', 'MAG-7', 'Sawed-Off'],
    'smg-overdrive': ['MAC-10', 'MP9', 'MP7', 'UMP-45', 'PP-Bizon', 'P90'],
    'arsenal-ascension': ['Glock-18', 'AK-47', 'AWP', '★ Butterfly Knife']
};
const themeFinishes = {
    printstream: /Printstream|Ticket to Hell|Calligraffiti|Mecha Industries|Cartel|Slate|Black Lotus|Black Sand|Road Rash/i,
    neon: /Neon|Vaporwave|Fade|Disco|Saibā|Ice Coaled|Chromatic|Hyper Beast|Cyber Security|In Living Color|Neo-Noir/i,
    crimson: /Redline|Crimson|Code Red|Blood|Fire Serpent|Searing Rage|Slaughter|Candy Apple|Kill Confirmed|The Traitor/i
};
const specialThemes = {
    dragon: /Dragon|Wildfire|Fire Serpent|The Empress/i,
    frost: /Ice Coaled|Coolant|Arctic|Winter|Blue|Decimator/i,
    cosmos: /Desolate Space|Moon|Nebula|Starlight|Supernova|Printstream/i,
    sakura: /Temukau|Shinobu|Saibā|Spider Lily|Oni Taiji|Kami/i,
    spectrum: /Fade|Choppa|Neon|Disco|Chromatic|Ocean Drive/i,
    cyber: /Cyber|Circuit|Statics|Mecha|Printstream|Motorized/i,
    desert: /Anubis|Sand|Desert|Wasteland|Asiimov|Gold Toof/i,
    abyss: /Deep|Ocean|Abyss|Aquamarine|Neo-Noir|Vaporwave/i,
    venom: /Poison|Atheris|Hyper Beast|Monkeyflage|Ensnared/i,
    royal: /Royal|Empress|Queen|Gold|Lore|Legion/i,
    treasure: /Gold|Lore|Fade|Case Hardened|Fire Serpent/i
};
const variants = catalogueVariants();
// Preserve the published candidates of older cases; collection finishes belong to
// the appended archive series and do not silently alter saved/public old odds.
const iconicVariants = catalogueVariants([...cases, ...collections]);

function matchesCase(id, group, entry, tiers) {
    if (iconicMatches.has(id)) return iconicMatches.get(id)(entry);
    const name = skins[entry.drop.skinId].name;
    if (discoveryMatches.has(id)) return discoveryMatches.get(id)(name, entry.drop.tier);
    const weapon = name.split(' | ')[0];
    const gold = entry.drop.tier === GOLD_TIER;
    const glove = /Gloves|Hand Wraps/.test(weapon);
    if (goldWeapons[id]) return gold && weapon === goldWeapons[id];
    if (collectionFinishes[id]) return collectionFinishes[id].test(name);
    if (experienceWeapons[id]) return experienceWeapons[id].includes(weapon);
    if (id === 'covert-vault') return entry.drop.tier === 3;
    if (!tiers.has(entry.drop.tier) && group === 'rarity') return false;
    if (id === 'glove') return gold && glove;
    if (id === 'farm-glove') return !gold || glove;
    if (id === 'knife') return gold && !glove;
    if (id === 'farm-knife') return !gold || !glove;
    if (id === 'fade') return gold && / \| Fade$/.test(name);
    if (id === 'doppler') return gold && / \| Doppler$/.test(name);
    if (id === 'gamma') return gold && / \| Gamma Doppler$/.test(name);
    if (id === 'vintage') return Number(entry.drop.caseId.slice(6)) <= 4029;
    if (id === 'starter') return entry.drop.tier <= 1;
    if (id === 'glove-vault') return gold && glove;
    if (id === 'pistol-lottery') return ['Glock-18', 'USP-S', 'P2000', 'P250', 'Desert Eagle', 'Five-SeveN', 'Tec-9'].includes(weapon);
    if (id === 'duel-storm') return entry.drop.tier === 0 || ['AK-47', 'AWP', 'M4A1-S', 'M4A4'].includes(weapon);
    if (specialThemes[id]) return entry.drop.tier === 0 || specialThemes[id].test(name);
    if (weapons[id]) return weapons[id].includes(weapon) || (id === 'rifles' && gold);
    return !themeFinishes[id] || themeFinishes[id].test(name);
}

const definitions = [
    ...originalCases,
    ...extraCases.map(([id, name, group, description, imageCase, items]) => [
        `battle-${id}`, name, description, `crate-${imageCase}`, group,
        items.map(([source, finish, exterior, weight]) => [`crate-${source}`, `skin-${finish}`, exterior, weight])
    ])
];

const jackpotRewards = [
    ['crate-4017', 'skin-b14c9f234bc5', 1, 4],
    ['crate-4717', 'skin-8e45a15cf7f5', 1, 3],
    ['crate-4233', 'skin-a7465b45d267', 0, 2],
    ['crate-4003', 'skin-2599a8720f89', 2, 1]
];
for (const chance of [1, 5, 10]) definitions.push([
    `battle-jackpot-${chance}`, `Jackpot ${({ 1: 'I', 5: 'II', 10: 'III' })[chance]}`,
    'Súng phổ thông xen kẽ nhóm giải lớn. Giá trị và tỷ lệ từng món theo bảng giá đã đồng bộ.',
    'crate-4233', 'casual', jackpotRewards
]);

const specialDefinitions = [
    ['dragon', 'Long Hỏa', 'theme', 'Lửa rồng, Wildfire và Fire Serpent trong cùng một hòm.', 4669, [
        [4904, '543d85d8ca60'], [4288, '318f343e125d'], [4669, 'db4de1c248fa'], [4003, '2599a8720f89']]],
    ['frost', 'Băng Cực', 'theme', 'Tông băng lam với Ice Coaled, Decimator và dao Sapphire.', 4846, [
        [4846, '2a4119de0db9'], [4846, 'f10cd3871578'], [4351, '7b3af96bd1e4'], [4233, '18a2a3a04055', 0]]],
    ['cosmos', 'Vũ Trụ', 'theme', 'Desolate Space, Starlight Protector và AWP Printstream.', 4236, [
        [4904, 'baa1adba3189'], [4236, 'ca4eb6f53d0e'], [4818, 'feae180c4968'], [7007, '5a39103af835']]],
    ['sakura', 'Anh Đào', 'theme', 'Sắc hồng Nhật Bản cùng Saibā Oni, Temukau và Oni Taiji.', 4880, [
        [4904, 'c176fd51f6b9'], [7003, '1328a63c72b5'], [4880, '1aba3ea9ecc5'], [4352, 'cfaaa2fab447']]],
    ['spectrum', 'Lăng Kính', 'theme', 'Ocean Drive, Neon Rider và ánh vàng Butterfly Fade.', 4790, [
        [7007, '5626422553f8'], [4790, '55623b84dd72'], [4482, '74e670c4b279'], [4018, '6656ae9270b9', 0]]],
    ['cyber', 'Mật Mã', 'theme', 'Cyberforce, Mecha Industries và M4A1-S Printstream.', 4717, [
        [4880, '79472cd37595'], [4880, 'e4cd5a266934'], [4846, 'be37abed2b4d'], [4717, '8e45a15cf7f5']]],
    ['desert', 'Cát Vàng', 'theme', 'Huyền thoại Anubis, Asiimov và AK-47 Fire Serpent.', 4698, [
        [4846, '8300d759e7a9'], [4698, 'dfd42a079f44'], [4548, '09205674e246'], [4003, '2599a8720f89']]],
    ['abyss', 'Vực Sâu', 'theme', 'Neo-Noir, Vaporwave và ánh xanh thẳm của Gamma Doppler.', 4548, [
        [7003, '63ed7bb762a0'], [4471, 'e8144faeae9f'], [7003, 'aa9558c8a01f'], [4818, 'a07ae9bbbeff', 0]]],
    ['venom', 'Nọc Độc', 'theme', 'Deadly Poison, Atheris và Hyper Beast ở đỉnh bảng thưởng.', 4091, [
        [4061, 'f982be094874'], [4598, 'd6cf8565026b'], [4352, '06e2ad662c73'], [4091, 'f787cc672771']]],
    ['royal', 'Hoàng Gia', 'theme', 'Royal Legion, Bullet Queen và The Empress.', 4403, [
        [4904, '80f2ee4e940f'], [4187, '71b2f3cff45c'], [4695, '3596d60709cc'], [4403, '1b3ca668024e']]],
    ['pistol-lottery', 'Xổ Số Súng Ngắn', 'weapon', 'Súng ngắn phổ thông với nhánh giải cao Gold Toof và Kill Confirmed.', 4138, [
        [4846, '2a4119de0db9'], [4471, '52971a3886a2'], [7003, '5bd16f2599cf'], [4138, 'cf4c11689014']]],
    ['duel-storm', 'Bão Đấu Tay Đôi', 'casual', 'Một loạt súng phổ thông, một cú nổ từ Bloodsport hoặc Vulcan.', 4017, [
        [4904, '806137e84f73'], [4747, '48e1c7c5df5e'], [4351, 'ba052cf18c66'], [4017, 'b14c9f234bc5']]],
    ['treasure', 'Kho Báu', 'theme', 'Skin súng phổ thông dẫn tới Case Hardened và Butterfly Fade.', 4018, [
        [4904, '8c2ae17ac090'], [4351, 'ba052cf18c66'], [4186, '974ea309f5e2', 1], [4018, '6656ae9270b9', 0]]],
    ['glove-vault', 'Hầm Găng', 'gold', 'Toàn bộ là găng với Vice, Crimson Kimono và Hedge Maze.', 4352, [
        [4880, '530add68f13a'], [4880, 'c1ae7186f829'], [4352, '5766610447f3'], [4352, 'b05ee2bf4f0d', 4]]]
];
const specialCaseIds = new Set(specialDefinitions.map(([id]) => id));
for (const [id, name, group, description, imageCase, rewards] of specialDefinitions) {
    definitions.push([`battle-${id}`, name, description, `crate-${imageCase}`, group,
        rewards.map(([source, skin, exterior = 2], index) => [`crate-${source}`, `skin-${skin}`, exterior, [7000, 2200, 700, 100][index]])]);
}

// Append new collections so every existing case keeps its published order and snapshots.
// These are catalogue identities and valid exteriors; prices still come only from BUFF quotes.
const expansionDefinitions = [
    ['p250', 'P250', 'weapon', 'Chuyên P250, có Asiimov, See Ya Later và Mehndi.', 4009, [
        [4880, 'db200bb3a1ef', 2], [4089, '4b8851edb204', 1], [4548, 'f0ba15d1b486', 1],
        [4233, 'b10fdec34656', 2], [4403, '491a70af3255', 1], [4009, '1a7c17796193', 0]]],
    ['five-seven', 'Five-SeveN', 'weapon', 'Five-SeveN với Monkey Business, Angry Mob và Hyper Beast.', 4352, [
        [4818, 'ee6dee51b1f5', 2], [4236, 'f4418cce494a', 1], [4790, 'df168db99441', 1],
        [4089, 'b2a5203033ee', 2], [4598, 'f971772d4996', 1], [4352, '06e2ad662c73', 0]]],
    ['tec9', 'Tec-9', 'weapon', 'Tec-9 từ Slag và Ice Cap đến Fuel Injector và Decimator.', 4620, [
        [4904, '80f2ee4e940f', 2], [4236, '82e19c21d6d0', 1], [4698, '609ca5fc7896', 1],
        [4186, '4a49656a91ca', 1], [4281, '23a0601d3273', 1], [4620, '0abab7de168d', 0]]],
    ['cz75', 'CZ75-Auto', 'weapon', 'Bộ CZ75-Auto có Xiangliu, Yellow Jacket và Victoria.', 4010, [
        [4695, '9a5ab653ba62', 2], [4089, 'e2e874d00715', 1], [4403, '0ba56fdaa179', 1],
        [4351, 'd1f0620f06f3', 2], [4091, 'e33988dc3569', 1], [4010, '5ca4267d0063', 0]]],
    ['dual-berettas', 'Dual Berettas', 'weapon', 'Súng đôi với Royal Consorts, Melondrama và Cobra Strike.', 4352, [
        [4904, '8d6879f0a2bc', 2], [4669, '2643362b3ca1', 1], [4846, '459ac0342b48', 1],
        [4288, '54963e630d31', 1], [4818, '53e4dc76b3e5', 1], [4352, '81ad76182a96', 0]]],
    ['ump45', 'UMP-45', 'weapon', 'UMP-45 với Primal Saber, Neo-Noir và K.O. Factory.', 7007, [
        [4846, 'de854ad43079', 2], [4904, '806137e84f73', 1], [4598, 'b720620ba156', 1],
        [4233, 'edb13cbc1a57', 2], [7003, '52c02605493f', 1], [7007, '5a6a2858b51d', 0]]],
    ['p90', 'P90', 'weapon', 'P90 với Nostalgia, Asiimov và Death by Kitty.', 4002, [
        [4698, '7e9cf6e60b9f', 2], [4880, '2e0afbc14204', 1], [4236, '31a18fdabe59', 1],
        [4669, '082000871d86', 2], [4018, 'c01d561550ed', 1], [4002, 'b8631ce3380d', 1]]],
    ['pp-bizon', 'PP-Bizon', 'weapon', 'PP-Bizon có Space Cat, High Roller và Judgement of Anubis.', 4233, [
        [4698, 'aba458e888aa', 2], [4790, '18341f97a949', 1], [4818, '10f8a820b8dc', 1],
        [4620, 'de365c1a71ad', 1], [4403, 'a0695188a122', 1], [4233, '8599a25e2c67', 0]]],
    ['mp7', 'MP7', 'weapon', 'Chuyên MP7, có Nemesis, Abyssal Apparition và Bloodsport.', 4471, [
        [4790, 'b40b6df277a2', 2], [4288, 'df49957ef56b', 1], [4620, 'a16b386af5bb', 1],
        [4091, '5b44cad3a5da', 1], [4818, '335f1a313262', 1], [4471, 'd11a70424dd7', 0]]],
    ['mp5', 'MP5-SD', 'weapon', 'MP5-SD từ Statics và Liquidation đến Kitbash và Phosphor.', 4548, [
        [7003, '63ed7bb762a0', 2], [4880, 'd87f89df4191', 1], [4598, '640691d10403', 1],
        [4669, '4ef86547d990', 1], [4698, '527de8ce168e', 1], [4548, 'aa2d649aeaf6', 0]]],
    ['galil', 'Galil AR', 'weapon', 'Galil AR với Chromatic Aberration, Sugar Rush và Chatterbox.', 4061, [
        [4846, '8300d759e7a9', 2], [7007, 'f2567cfebfb7', 1], [4138, '3d7cafe33cee', 1],
        [4747, '69f2e17b78f2', 1], [4352, '99def93a5fe2', 1], [4061, '94878071c8d9', 2]]],
    ['famas', 'FAMAS', 'weapon', 'FAMAS với Mecha Industries, Commemoration và Bad Trip.', 7007, [
        [4846, '14669f15615e', 2], [4790, '3a2e0cdd5472', 1], [4482, '5af9f375159d', 1],
        [4288, 'ea2876c00b6b', 1], [4669, 'c70df63bf30b', 1], [7007, 'f098f9b83e8b', 0]]],
    ['asiimov', 'Biệt Đội Asiimov', 'theme', 'Chỉ dòng Asiimov trên P250, P90, M4A4, AK-47 và AWP.', 4548, [
        [4233, 'b10fdec34656', 4], [4018, 'c01d561550ed', 3], [4009, '31a3a09d007d', 4],
        [4548, '09205674e246', 2], [4011, 'bb633c21fc25', 2], [4548, '09205674e246', 0]]],
    ['mecha-industries', 'Mecha Industries', 'theme', 'Cùng thiết kế Mecha Industries trên FAMAS, Desert Eagle và M4A1-S.', 4236, [
        [4288, 'ea2876c00b6b', 4], [4548, 'a79b5b4ad623', 3], [4288, 'ea2876c00b6b', 2],
        [4236, '102a47219b11', 2], [4548, 'a79b5b4ad623', 0], [4236, '102a47219b11', 0]]],
    ['bloodsport', 'Võ Đài Bloodsport', 'theme', 'Chỉ họa tiết Bloodsport trên SCAR-20, MP7 và AK-47.', 4351, [
        [4236, '9a2cefa49e12', 3], [4471, 'd11a70424dd7', 4], [4236, '9a2cefa49e12', 2],
        [4351, 'ba052cf18c66', 2], [4471, 'd11a70424dd7', 0], [4351, 'ba052cf18c66', 0]]],
    ['hyper-beast', 'Bầy Quái Thú', 'theme', 'Bộ Hyper Beast trên Nova, Five-SeveN, M4A1-S và AWP.', 4091, [
        [4187, 'd0090217a5a4', 4], [4352, '06e2ad662c73', 3], [4187, 'd0090217a5a4', 2],
        [4089, '7b1351c2adba', 2], [4352, '06e2ad662c73', 0], [4091, 'f787cc672771', 0]]],
    ['wasteland-rebel', 'Wasteland Rebel', 'theme', 'Hai khẩu Glock-18 và AK-47 Wasteland Rebel ở nhiều độ mòn.', 4029, [
        [4236, '73cc8d5fcd85', 4], [4029, 'ee1ab67b6434', 4], [4236, '73cc8d5fcd85', 2],
        [4029, 'ee1ab67b6434', 2], [4236, '73cc8d5fcd85', 0], [4029, 'ee1ab67b6434', 0]]],
    ['case-hardened', 'Sắc Thép Tôi', 'theme', 'Case Hardened trên Five-SeveN, AK-47, găng Hydra, Bayonet và Karambit.', 4186, [
        [4004, '133e4c36778f', 4], [4004, '133e4c36778f', 2], [4001, '5fd3ee42a6c4', 2],
        [4880, 'e8fa9ecb2fbe', 3], [4186, '1a4722df3bb9', 1], [4186, 'c187005d5542', 0]]],
    ['karambit', 'Karambit', 'gold', 'Mỗi lượt là Karambit, từ Safari Mesh và Night đến Fade và Doppler.', 4233, [
        [4186, '396b97d31af5', 4], [4186, '73516aae3abf', 2], [4233, 'd1da7a632cfe', 2],
        [4233, '672713e8a04e', 0], [4186, '657a59e6566b', 0], [4233, 'a7465b45d267', 0]]],
    ['butterfly', 'Butterfly', 'gold', 'Mỗi lượt là Butterfly Knife, có Slaughter, Fade và Doppler.', 4403, [
        [4018, 'c10084b67a2b', 4], [4018, 'c8f815e08499', 2], [4403, 'da19db61f316', 2],
        [4018, 'eae7c10fa54f', 1], [4018, '6656ae9270b9', 0], [4403, 'e0c77218a563', 0]]],
    ['m9-bayonet', 'M9 Bayonet', 'gold', 'Mỗi lượt là M9 Bayonet với Blue Steel, Tiger Tooth, Fade và Gamma Doppler.', 4281, [
        [4186, '68446ed62265', 4], [4186, '62ca63790424', 2], [4186, '50f7716ec9b0', 1],
        [4233, '3bc3ff53883a', 0], [4186, '68778cfbe46d', 0], [4281, '8f49a19645c9', 0]]],
    ['bayonet', 'Bayonet', 'gold', 'Mỗi lượt là Bayonet, có Slaughter, Fade và Gamma Doppler.', 4281, [
        [4186, '8fbd010b1f59', 4], [4186, 'd90370c635f2', 2], [4233, '6bf08149269b', 2],
        [4186, '8084beee1235', 1], [4186, '95831ce7c492', 0], [4281, '9af6c8a5a9c1', 0]]],
    ['talon', 'Talon', 'gold', 'Mỗi lượt là Talon Knife với Slaughter, Fade và Doppler.', 4695, [
        [4548, '6183e4ae1805', 4], [4548, 'dc96e35a7226', 2], [4695, '9eed82f3d27d', 2],
        [4548, '39fd4dd08be3', 1], [4548, 'b578d971da2a', 0], [4695, '88a12f8e17de', 0]]],
    ['sport-gloves', 'Găng Thể Thao', 'gold', 'Chỉ Sport Gloves với Bronze Morph, Omega, Amphibious, Vice và Hedge Maze.', 4352, [
        [4880, '24bd5ece81d7', 3], [4846, '9918998292c5', 2], [4880, 'b06ecb36172b', 2],
        [4880, 'e2344261c5cb', 1], [4880, 'c1ae7186f829', 1], [4352, 'b05ee2bf4f0d', 0]]]
];
for (const [id, name, group, description, imageCase, rewards] of expansionDefinitions) {
    definitions.push([`battle-${id}`, name, description, `crate-${imageCase}`, group,
        rewards.map(([source, skin, exterior], index) => [`crate-${source}`, `skin-${skin}`, exterior, [4000, 2500, 1700, 1000, 650, 150][index]])]);
}

// Distinct series appended after the first 72 cases; only these IDs use the new profiles.
const creativeDefinitions = [
    ['p2000', 'P2000', 'weapon', 'Chuyên P2000, gồm Fire Elemental và Ocean Foam.', 4003, [
        [7007, '8bda61ff439a', 2], [4695, 'dd7837484577', 1], [4620, '3c3bc3fa44dc', 1], [4880, 'c36fdc469906', 1], [4029, 'be569f85ce42', 1], [4003, 'b4a45f1fac9d', 0]]],
    ['sg553', 'SG 553', 'weapon', 'Chuyên SG 553, gồm Colony IV và Cyrex.', 4091, [
        [4880, '79472cd37595', 2], [4846, '9acc418fe0ad', 1], [4695, 'd00c49e52bd9', 1], [4186, '460926660df2', 1], [4620, '5b6e17f145f5', 1], [4091, 'f0772ea6839f', 0]]],
    ['aug', 'AUG', 'weapon', 'Chuyên AUG, gồm Syd Mead và Chameleon.', 4011, [
        [7003, 'f0c2d895b50d', 2], [4620, '11c6b11248f9', 1], [4236, 'd88fbf7ef8e1', 1], [4669, '29ac998e7985', 1], [4281, 'ba00fd57f9ef', 1], [4011, '370dfd3911e0', 0]]],
    ['g3sg1', 'G3SG1', 'weapon', 'Chuyên G3SG1, gồm The Executioner và Flux.', 4138, [
        [4790, '4b59a9ff63bf', 2], [4818, 'a5efcaeb15ee', 1], [4482, 'd08b1f9525cb', 1], [4288, '00b8673938d7', 1], [4186, 'b0c24d905a01', 2], [4138, '042695b22889', 0]]],
    ['scar20', 'SCAR-20', 'weapon', 'Chuyên SCAR-20, gồm Cyrex và Bloodsport.', 4236, [
        [4880, '05d5c801f287', 2], [4695, '803029f01b68', 1], [4281, '9c61185e3e75', 1], [4029, 'c43e6b146e94', 1], [4017, 'bc6a17b8b04c', 1], [4236, '9a2cefa49e12', 0]]],
    ['nova', 'Nova', 'weapon', 'Chuyên Nova, gồm Antique và Hyper Beast.', 4187, [
        [4904, 'baa1adba3189', 2], [7007, 'aef077455139', 1], [4717, 'be0f8a429ce6', 1], [4018, 'b029cb49c14f', 1], [4011, '064fed483cd7', 1], [4187, 'd0090217a5a4', 0]]],
    ['xm1014', 'XM1014', 'weapon', 'Chuyên XM1014, gồm XOXO và Tranquility.', 4029, [
        [7007, 'e0eec3353ea4', 2], [4904, '8c2ae17ac090', 1], [4818, '5f6eb8a4271e', 1], [4698, 'daae504f859c', 1], [4747, 'dad23c017c83', 1], [4029, '24cc378ff450', 0]]],
    ['negev', 'Negev', 'weapon', 'Chuyên Negev, gồm Power Loader và dev_texture.', 4747, [
        [4846, '128166c2642e', 2], [4698, '2c80164190d1', 1], [4089, 'fd5699e808a0', 1], [4471, '58651a482529', 1], [4186, '69c57b0e17a5', 1], [4747, 'bce9af58ff21', 0]]],
    ['huntsman', 'Huntsman', 'gold', 'Mỗi lượt là Huntsman Knife, có Slaughter, Fade và Doppler.', 4403, [
        [4017, 'b9e171c17faf', 4], [4017, 'cbcb5c1fdde0', 2], [4403, '929cf4619d5d', 2], [4017, '2cab831d314a', 1], [4017, '85ba0d17a1f9', 0], [4403, '255b6eff4914', 0]]],
    ['bowie', 'Bowie', 'gold', 'Mỗi lượt là Bowie Knife, có Slaughter, Fade và Doppler.', 4403, [
        [4187, 'fd9ff5748aa5', 4], [4187, '9197f4cece59', 2], [4403, '7243492200ab', 2], [4187, '5f746d4751f8', 1], [4187, '7c39e61388c9', 0], [4403, '3ca96a918c35', 0]]],
    ['falchion', 'Falchion', 'gold', 'Mỗi lượt là Falchion Knife, có Slaughter, Fade và Doppler.', 4403, [
        [4091, '49c24c94aee8', 4], [4091, '885343b7fb09', 2], [4403, 'ee8e81caeed3', 2], [4091, 'a0e461882742', 1], [4091, 'eb63179edd1a', 0], [4403, '04fb5d07991f', 0]]],
    ['shadow-daggers', 'Shadow Daggers', 'gold', 'Mỗi lượt là Shadow Daggers, có Slaughter, Fade và Doppler.', 4403, [
        [4138, '71ae1b479d78', 4], [4138, '0520196c680b', 2], [4403, '7672f2725a54', 2], [4138, '7741632caeaf', 1], [4138, 'e3745c88f2ca', 0], [4403, '6c1f2c508ea4', 0]]],
    ['paracord', 'Paracord', 'gold', 'Mỗi lượt là Paracord Knife, có Slaughter, Fade và Doppler.', 7007, [
        [4698, '50d62bccb9a1', 4], [4698, '72c748b5dc30', 2], [7007, 'a122a0880e40', 2], [4698, 'f04f7388bd8b', 1], [4698, '29564901bab8', 0], [7007, 'f86dbd0df1d8', 0]]],
    ['survival', 'Survival', 'gold', 'Mỗi lượt là Survival Knife, có Slaughter, Fade và Doppler.', 7007, [
        [4698, 'a2359eb57d47', 4], [4698, '3f663fae062e', 2], [7007, '4501a81b5f21', 2], [4698, '239162799f41', 1], [4698, '0786fd21a508', 0], [7007, '48064d096b19', 0]]],
    ['nomad', 'Nomad', 'gold', 'Mỗi lượt là Nomad Knife, có Slaughter, Fade và Doppler.', 7007, [
        [4698, 'b3faa3a53934', 4], [4698, '268f89c9e501', 2], [7007, 'b7627ae71f87', 2], [4698, '74f72ddc6769', 1], [4698, '47d49e017564', 0], [7007, '9a8c5bed7b73', 0]]],
    ['skeleton', 'Skeleton', 'gold', 'Mỗi lượt là Skeleton Knife, có Slaughter, Fade và Doppler.', 7007, [
        [4698, '2ee9ebfb2bf0', 4], [4698, '744fcb5c866c', 2], [7007, '509253231b92', 2], [4698, '6b5516a41499', 1], [4698, 'cde6adda102c', 0], [7007, '1e257d16f0fb', 0]]],
    ['neo-noir', 'Thành Phố Neo-Noir', 'theme', 'Bộ truyện tranh Neo-Noir trên UMP-45, Glock-18, M4A4, USP-S và AWP.', 4548, [
        [7003, '52c02605493f', 3], [4717, '7127818b09a6', 3], [4471, 'e8144faeae9f', 2], [4351, '0770dabcd885', 1], [7003, '52c02605493f', 0], [4548, '7b1ef066823d', 0]]],
    ['neon-rider', 'Tay Đua Neon', 'theme', 'AK-47 và MAC-10 Neon Rider ở nhiều độ mòn.', 4482, [
        [4089, 'bb6ba9602776', 3], [4482, '74e670c4b279', 4], [4089, 'bb6ba9602776', 2], [4482, '74e670c4b279', 2], [4089, 'bb6ba9602776', 0], [4482, '74e670c4b279', 0]]],
    ['fuel-injector', 'Bơm Nhiên Liệu', 'theme', 'Tec-9 và AK-47 Fuel Injector, cùng phong cách máy móc vàng đen.', 4187, [
        [4281, '23a0601d3273', 4], [4187, '8f7564b8b3eb', 4], [4281, '23a0601d3273', 2], [4187, '8f7564b8b3eb', 2], [4281, '23a0601d3273', 0], [4187, '8f7564b8b3eb', 0]]],
    ['decimator', 'Kẻ Hủy Diệt', 'theme', 'Tec-9 và M4A1-S Decimator trong một bộ sưu tập riêng.', 4351, [
        [4620, '0abab7de168d', 4], [4351, '7b3af96bd1e4', 4], [4620, '0abab7de168d', 2], [4351, '7b3af96bd1e4', 2], [4620, '0abab7de168d', 0], [4351, '7b3af96bd1e4', 0]]],
    ['pulse', 'Nhịp Xung', 'theme', 'Chỉ họa tiết Pulse trên P2000, SG 553 và FAMAS.', 4009, [
        [4017, '47c5420fd212', 3], [4009, '2930dffc8ea9', 3], [4011, '205233b2ccee', 2], [4017, '47c5420fd212', 1], [4011, '205233b2ccee', 1], [4009, '2930dffc8ea9', 0]]],
    ['ember', 'Hỏa Ngục', 'theme', 'Flame Test, Heat, Incinegator, Hellfire và Fire Serpent.', 4003, [
        [4471, '42a677e4f00a', 2], [4548, '0b23f3cc7633', 1], [4089, 'fadb57cf0d51', 1], [4598, 'ee5f48068381', 1], [4352, '12d0c696aacd', 0], [4003, '2599a8720f89', 1]]],
    ['night-safari', 'Safari Đêm', 'theme', 'Các họa tiết Panther, Tiger, Lionfish, Chameleon và Jaguar.', 4019, [
        [4010, 'c5fb77a6d76c', 2], [4019, '60bd7f6cf084', 1], [4471, '58651a482529', 1], [4019, '571dcb1f6c86', 2], [4011, '370dfd3911e0', 0], [4019, '0827f8a09022', 0]]],
    ['arcade', 'Phòng Arcade', 'theme', 'Button Masher, Boost Protocol, BI83 Spectrum, K.O. Factory và Player Two.', 4695, [
        [4747, 'd5acd24fcb47', 3], [4790, 'df168db99441', 2], [4790, 'fbe7862c26f8', 1], [7007, '5a6a2858b51d', 1], [4790, 'df168db99441', 0], [4695, '4dd5dccd2fdd', 0]]],
    ['botanical', 'Vườn Bí Mật', 'theme', 'Flora Carnivora, Rose Iron, Black Lotus, Bloomstick và Hand Wraps Arboreal.', 4880, [
        [4790, '9c09911caf5c', 2], [4846, '459ac0342b48', 1], [4009, '65b73b6b9f0a', 1], [4904, '63c1d72b8501', 1], [4019, 'f2779230030e', 1], [4880, '51c5ce405526', 2]]],
    ['horror', 'Ác Mộng', 'theme', 'Necropos, Grim, Night Terror, Abyssal Apparition, Cortex và Monster Mashup.', 4717, [
        [4187, 'f09be63883f9', 2], [4281, 'b15a3a34433b', 1], [4818, 'ec2dd0814c74', 1], [4818, '335f1a313262', 1], [4471, '3901933d5e47', 0], [4717, '8190f382bffd', 0]]],
    ['street-art', 'Nghệ Thuật Đường Phố', 'theme', 'Calligraffiti, Rebel, Snack Attack, In Living Color và Wasteland Rebel.', 4029, [
        [7003, '48039a85c871', 2], [4880, 'e5141cf036fa', 1], [4790, 'cf4887fb0502', 1], [4747, 'c62d08aa8da1', 1], [4236, '73cc8d5fcd85', 0], [4029, 'ee1ab67b6434', 1]]],
    ['engineering', 'Xưởng Cơ Khí', 'theme', 'Lead Conduit, Torque, Fuel Rod và Power Loader trong bộ sưu tập cơ khí.', 4091, [
        [4187, 'c5f4d564ca7e', 2], [4091, '982f2e59bfda', 2], [4186, '13af73ca7ca5', 1], [4017, '421b4d58b3c3', 1], [4186, '69c57b0e17a5', 0], [4091, '982f2e59bfda', 0]]],
    ['pistol-duel', 'Song Đấu Súng Ngắn', 'casual', 'Súng ngắn đối đầu, từ Winterized và Black Lotus đến Neo-Noir và Kill Confirmed.', 4138, [
        [4846, '2a4119de0db9', 2], [4790, '9c09911caf5c', 1], [4548, 'f0ba15d1b486', 1], [4548, 'a79b5b4ad623', 1], [4717, '7127818b09a6', 0], [4138, 'cf4c11689014', 1]]],
    ['eco-rush', 'Eco Rush', 'casual', 'Đội hình SMG, từ Statics và Motorized đến Primal Saber và Stalker.', 4620, [
        [7003, '63ed7bb762a0', 2], [4904, '806137e84f73', 1], [4904, '543d85d8ca60', 1], [4620, 'a16b386af5bb', 1], [4233, 'edb13cbc1a57', 1], [4620, '46bae9d6c6b0', 0]]],
    ['rifle-arena', 'Đấu Trường Rifle', 'casual', 'Galil và FAMAS mở màn, Black Lotus và Slate nối tiếp, Temukau và Vulcan ở hai nhóm cuối.', 4017, [
        [4846, '8300d759e7a9', 2], [4846, '14669f15615e', 1], [4904, '63c1d72b8501', 1], [4747, '48e1c7c5df5e', 1], [4880, '1aba3ea9ecc5', 0], [4017, 'b14c9f234bc5', 1]]],
    ['sniper-showdown', 'Đọ Sức Bắn Tỉa', 'casual', 'Các dòng bắn tỉa Necropos, Phobos, Dream Glade, Turbo Peek, Neo-Noir và Wildfire.', 4669, [
        [4187, 'f09be63883f9', 2], [4236, '78882aeeb9a7', 1], [4818, 'a5efcaeb15ee', 1], [4790, '32bcc9d7f929', 1], [4548, '7b1ef066823d', 0], [4669, 'db4de1c248fa', 1]]],
    ['shotgun-breach', 'Phá Cửa', 'casual', 'Nova, XM1014 và MAG-7 phối hợp, có Antique, Tranquility và Hyper Beast.', 4187, [
        [4904, 'baa1adba3189', 2], [4471, 'ae8080ca847c', 1], [4089, 'fadb57cf0d51', 1], [4011, '064fed483cd7', 1], [4029, '24cc378ff450', 0], [4187, 'd0090217a5a4', 0]]],
    ['smg-overdrive', 'SMG Tăng Tốc', 'casual', 'SMG nhiều màu với Runic, Grim, Neon Ply, Primal Saber, Food Chain và Neon Rider.', 4089, [
        [4698, 'aba458e888aa', 2], [4281, 'b15a3a34433b', 1], [4620, 'a16b386af5bb', 1], [4233, 'edb13cbc1a57', 1], [4747, '6d14d557c648', 0], [4089, 'bb6ba9602776', 0]]],
    ['covert-vault', 'Kho Đỏ', 'casual', 'Chỉ skin Covert: Bullet Queen, Bloodsport, Commemoration, Temukau, Neo-Noir và Vulcan.', 4017, [
        [4695, '3596d60709cc', 3], [4471, 'd11a70424dd7', 2], [4669, 'c70df63bf30b', 1], [4880, '1aba3ea9ecc5', 1], [4548, '7b1ef066823d', 0], [4017, 'b14c9f234bc5', 0]]],
    ['arsenal-ascension', 'Leo Tháp Vũ Khí', 'casual', 'Glock-18 mở màn, hai nhóm AK-47/AWP nối tiếp, nhóm cuối có Butterfly Fade.', 4018, [
        [4846, '2a4119de0db9', 2], [4747, '48e1c7c5df5e', 2], [4598, 'd6cf8565026b', 1], [4548, '09205674e246', 1], [4669, 'db4de1c248fa', 0], [4018, '6656ae9270b9', 0]]]
];
const CREATIVE_CASE_IDS = Object.freeze(creativeDefinitions.map(([id]) => `battle-${id}`));
const creativeProfiles = {
    'pistol-duel': Object.freeze([5000, 3500, 1300, 200]),
    'eco-rush': Object.freeze([8000, 1600, 350, 50]),
    'rifle-arena': Object.freeze([3500, 3500, 2500, 500]),
    'sniper-showdown': Object.freeze([6000, 2500, 1200, 300]),
    'shotgun-breach': Object.freeze([6500, 2500, 800, 200]),
    'smg-overdrive': Object.freeze([7000, 2200, 650, 150]),
    'covert-vault': Object.freeze([9500, 350, 130, 20]),
    'arsenal-ascension': Object.freeze([2000, 3000, 3500, 1500])
};
for (const [id, name, group, description, imageCase, rewards] of creativeDefinitions) {
    definitions.push([`battle-${id}`, name, description, `crate-${imageCase}`, group,
        rewards.map(([source, skin, exterior], index) => [`crate-${source}`, `skin-${skin}`, exterior, [4000, 2500, 1700, 1000, 650, 150][index]])]);
}

const farmCases = new Set(['farm', 'farm-knife', 'farm-glove']);
const steadierCases = new Set(['balance', 'starter', 'mil-spec', 'restricted', 'zeus', 'glock', 'smg', 'scout',
    'p250', 'tec9', 'dual-berettas', 'mp7', 'mp5', 'famas']);
const cheapGunSeeds = [
    ['crate-4904', 'skin-baa1adba3189'], // Nova | Dark Sigil
    ['crate-4904', 'skin-80f2ee4e940f'], // Tec-9 | Slag
    ['crate-4904', 'skin-806137e84f73'], // UMP-45 | Motorized
    ['crate-4904', 'skin-543d85d8ca60'], // MAC-10 | Light Box
    ['crate-4846', 'skin-128166c2642e'], // Negev | Drop Me
    ['crate-4846', 'skin-8300d759e7a9'], // Galil AR | Destroyer
    ['crate-7003', 'skin-63ed7bb762a0'], // MP5-SD | Statics
    ['crate-4880', 'skin-db200bb3a1ef'] // P250 | Re.built
].map(([caseId, skinId]) => makeEntry([caseId, skinId, 2, 1]));

// Allocate whole tickets with the largest-remainder method. No floating-point normalization
// is involved, so every advertised range is also a range the random draw can actually hit.
function allocateTickets(entries, total) {
    if (!entries.length || !total) return [];
    const denominator = entries.reduce((sum, entry) => sum + BigInt(entry.weight), 0n);
    const allocations = entries.map((entry, index) => {
        const numerator = BigInt(entry.weight) * BigInt(total);
        return { entry, index, weight: Number(numerator / denominator), remainder: numerator % denominator };
    });
    const remaining = total - allocations.reduce((sum, entry) => sum + entry.weight, 0);
    const ordered = allocations.toSorted((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
    for (let index = 0; index < remaining; index++) ordered[index].weight++;
    return allocations.filter(({ weight }) => weight > 0).map(({ entry, weight }) => ({ ...entry, weight }));
}

function caseDistribution(id, group, legacyEntries, candidates, ticketProfile) {
    const shortId = id.slice('battle-'.length);
    const jackpotChance = /^jackpot-(1|5|10)$/.exec(shortId)?.[1];
    const allGold = !jackpotChance && legacyEntries.every(entry => entry.drop.tier === GOLD_TIER);
    const farm = farmCases.has(shortId);
    const cheapestTier = Math.min(...legacyEntries.map(entry => entry.drop.tier));
    const topFinishes = new Set(legacyEntries.slice(-2).map(entry => entry.drop.skinId));
    const broadSpecial = specialCaseIds.has(shortId) && !allGold && shortId !== 'pistol-lottery';
    const baselineSeeds = (farm || jackpotChance || broadSpecial ? cheapGunSeeds : allGold ? legacyEntries.slice(0, 2) : candidates.filter(entry =>
        !entry.drop.statTrak && entry.exterior === 2 && entry.drop.tier <= (group === 'rarity' ? cheapestTier : 1) &&
        !topFinishes.has(entry.drop.skinId)))
        .filter((entry, index, entries) => entries.findIndex(other => other.drop.skinId === entry.drop.skinId) === index)
        .slice(0, 8).map(entry => ({ ...entry, weight: 1 }));
    // Broad farm/jackpot cases use actual inexpensive guns from several weapon families.
    // Weapon, rarity and themed cases obtain their seeds from their matching catalogue only.
    const baseline = baselineSeeds.length ? baselineSeeds : legacyEntries.slice(0, 2);
    let bands;
    const configured = ticketProfile ?? creativeProfiles[shortId];
    if (configured) {
        // The four advertised groups are explicit and disjoint for these experiences.
        bands = [
            ['common', configured[0], legacyEntries.slice(0, 2)],
            ['regular', configured[1], legacyEntries.slice(2, 4)],
            ['premium', configured[2], legacyEntries.slice(4, 5)],
            ['jackpot', configured[3], legacyEntries.slice(5)]
        ];
    } else if (jackpotChance || farm) {
        const jackpotTickets = jackpotChance ? Number(jackpotChance) * 100 : 100;
        bands = [
            ['common', TICKETS - jackpotTickets, baseline],
            ['jackpot', jackpotTickets, jackpotChance ? legacyEntries : legacyEntries.filter(entry => entry.drop.tier === GOLD_TIER)]
        ];
    } else {
        const low = steadierCases.has(shortId);
        const high = ['quick-hit', 'elite', 'cosmos', 'pistol-lottery', 'duel-storm', 'treasure', 'cz75', 'p90', 'bloodsport'].includes(shortId);
        const shares = allGold ? [7200, 1800, 800, 200] : low ? [7000, 2200, 700, 100]
            : high ? [9500, 350, 130, 20] : [8500, 1100, 350, 50];
        bands = [
            ['common', shares[0], [...baseline, { ...legacyEntries[0], weight: 1 }]],
            ['regular', shares[1], legacyEntries.slice(1, -2)],
            ['premium', shares[2], legacyEntries.slice(-2, -1)],
            ['jackpot', shares[3], legacyEntries.slice(-1)]
        ];
    }
    const used = new Set();
    bands = bands.map(([band, weight, entries]) => [band, weight, entries.filter(entry => {
        const key = entryKey(entry);
        if (used.has(key)) return false;
        used.add(key);
        return true;
    })]);
    // A theme can have only a few valid finishes. Its unused ranges stay with common drops.
    const emptyTickets = bands.reduce((sum, [, weight, entries]) => sum + (entries.length ? 0 : weight), 0);
    bands[0][1] += emptyTickets;
    const bandByKey = new Map();
    const entries = bands.flatMap(([band, total, pool]) => allocateTickets(pool, pool.length ? total : 0).map(entry => {
        bandByKey.set(entryKey(entry), band);
        return entry;
    }));
    return { entries, bandByKey, jackpotTickets: entries.reduce((sum, entry) =>
        sum + (bandByKey.get(entryKey(entry)) === 'jackpot' ? entry.weight : 0), 0) };
}

function makeCase([id, name, description, imageCase, group, items, ticketProfile], universe = variants) {
    const legacyEntries = items.map(makeEntry);
    if (legacyEntries.some(entry => !entry || !Number.isInteger(entry.weight) || entry.weight <= 0) ||
        (!id.startsWith('battle-jackpot-') && legacyEntries.reduce((sum, entry) => sum + entry.weight, 0) !== TICKETS)) {
        throw new Error(`Invalid Battle odds: ${id}`);
    }
    if (ticketProfile && (ticketProfile.length !== 4 || legacyEntries.length !== 6 ||
        ticketProfile.some(weight => !Number.isSafeInteger(weight) || weight <= 0) ||
        ticketProfile.reduce((sum, weight) => sum + weight, 0) !== TICKETS)) {
        throw new Error(`Invalid Battle ticket profile: ${id}`);
    }
    const tiers = new Set(legacyEntries.map(({ drop }) => drop.tier));
    const candidates = universe.filter(entry => matchesCase(id.slice('battle-'.length), group, entry, tiers));
    const { entries, bandByKey, jackpotTickets } = caseDistribution(id, group, legacyEntries, candidates, ticketProfile);
    const goldTickets = entries.reduce((sum, { drop, weight }) => sum + (drop.tier === GOLD_TIER ? weight : 0), 0);
    if (farmCases.has(id.slice('battle-'.length))) {
        const reward = id === 'battle-farm-glove' ? 'găng' : 'dao';
        description = `Súng phổ thông giá không quá 10.000 xu, xen kẽ nhóm ${reward}.`;
    }
    return { id, name, description, group, image: containersById.get(imageCase).image,
        entries, candidates, goldTickets, jackpotTickets, bandByKey, legacyEntries,
        commonPriceCap: farmCases.has(id.slice('battle-'.length)) || id.startsWith('battle-jackpot-') ? 10_000 : null,
        artId: id, ...((ticketProfile ?? creativeProfiles[id.slice('battle-'.length)])
            ? { ticketProfile: ticketProfile ?? creativeProfiles[id.slice('battle-'.length)] } : {}) };
}
const customCases = definitions.map(definition => makeCase(definition));

const BLUE_GEM_CASE_IDS = Object.freeze(['battle-blue-gem']);
const blueGemEntries = [
    ['crate-4004', 'skin-133e4c36778f', 4, 5000, false, 868],
    ['crate-4004', 'skin-133e4c36778f', 2, 3000, false, 868],
    ['crate-4001', 'skin-5fd3ee42a6c4', 2, 1200, false, 661],
    ['crate-4001', 'skin-d335b89fc7a5', 2, 500, false, 150],
    ['crate-4018', 'skin-688d607e4dec', 2, 250, false, 182],
    ['crate-4001', 'skin-c187005d5542', 2, 50, false, 955]
].map(makeEntry);
if (blueGemEntries.some(entry => !entry) || blueGemEntries.reduce((sum, entry) => sum + entry.weight, 0) !== TICKETS) {
    throw new Error('Invalid Battle odds: battle-blue-gem');
}
customCases.push({
    id: BLUE_GEM_CASE_IDS[0], name: 'Blue Gem', group: 'theme',
    description: 'Chỉ có pattern Blue Gem đã xác thực; giá riêng cho đúng seed và độ mòn.',
    image: containersById.get('crate-4001').image, artId: BLUE_GEM_CASE_IDS[0], blueOnly: true,
    entries: blueGemEntries, legacyEntries: blueGemEntries, candidates: [], commonPriceCap: null,
    goldTickets: 800, jackpotTickets: 50,
    bandByKey: new Map(blueGemEntries.map((entry, index) =>
        [entryKey(entry), index < 2 ? 'common' : index === 2 ? 'regular' : index < 5 ? 'premium' : 'jackpot']))
});
// Keep every published case at its original index, including Blue Gem and saved rooms.
customCases.push(...discoveryDefinitions.map(([id, name, group, description, imageCase, rewards, profile]) =>
    makeCase([`battle-${id}`, name, description, `crate-${imageCase}`, group,
        rewards.map(([source, skin, exterior], index) => [`crate-${source}`, `skin-${skin}`, exterior,
            [4000, 2500, 1700, 1000, 650, 150][index]]), Object.freeze([...profile])])));
customCases.push(...iconicDefinitions.map(([id, name, group, description, imageCase, rewards, profile]) =>
    makeCase([`battle-${id}`, name, description, imageCase, group,
        rewards.map(([source, skin, exterior, statTrak], index) => [source, skin, exterior,
            [4000, 2500, 1700, 1000, 650, 150][index], statTrak]), profile], iconicVariants)));
const customCasesById = new Map(customCases.map(item => [item.id, item]));

function cachedPrices() {
    const cached = new Map();
    return entry => {
        const key = entryKey(entry);
        if (!cached.has(key)) {
            const { ref } = entry;
            const value = market.peekMarketQuote(ref.name, ref)?.priceVnd;
            cached.set(key, Number.isSafeInteger(value) && value > 0 ? value : null);
        }
        return cached.get(key);
    };
}

function expandEntries(item, anchorValues, priceOf) {
    const taken = new Set(item.entries.map(entryKey));
    const finishes = new Set(item.entries.map(entry => entry.drop.skinId));
    const anchorOutcomes = () => item.entries.map((entry, index) => ({ entry,
        value: anchorValues[index], band: item.bandByKey?.get(entryKey(entry)) }));
    const results = anchorOutcomes();
    const anchorFee = pricingFee(weightedValue(results));
    const buckets = new Map();
    for (const entry of item.candidates) {
        const key = entryKey(entry);
        if (taken.has(key)) continue;
        const value = priceOf(entry);
        if (!Number.isSafeInteger(value) || value <= 0) continue;
        const bucket = `${entry.drop.tier === GOLD_TIER}/${compareValue(value, anchorFee)}`;
        if (!buckets.has(bucket)) buckets.set(bucket, []);
        buckets.get(bucket).push({ entry, key, value });
    }
    const closestByAnchor = new Map();
    for (const [index, anchor] of item.entries.entries()) {
        const value = anchorValues[index];
        const tickets = Math.floor(anchor.weight * 45 / 100);
        if (!tickets) continue;
        const targetGold = anchor.drop.tier === GOLD_TIER;
        const targetContraband = skins[anchor.drop.skinId].rarity === 'Contraband';
        const band = item.bandByKey?.get(entryKey(anchor));
        const classification = compareValue(value, anchorFee);
        // Values are safe integers. Compute the exact inclusive ratio bounds once in BigInt,
        // then compare integers in the candidate loop instead of multiplying every candidate.
        const minimum = Number((BigInt(value) * (band === 'jackpot' ? 80n : 60n) + 99n) / 100n);
        const upperBound = BigInt(value) * (band === 'common' ? 125n : 150n) / 100n;
        const maximum = Number(upperBound > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : upperBound);
        const signature = `${targetGold}/${targetContraband}/${classification}/${value}/${minimum}/${maximum}`;
        let closest = closestByAnchor.get(signature);
        if (!closest) {
            closest = (buckets.get(`${targetGold}/${classification}`) ?? [])
                .filter(candidate => candidate.value >= minimum && candidate.value <= maximum &&
                    (skins[candidate.entry.drop.skinId].rarity === 'Contraband') === targetContraband &&
                    (band !== 'common' || item.commonPriceCap == null || candidate.value <= item.commonPriceCap));
            closest.sort((a, b) => Math.abs(a.value - value) - Math.abs(b.value - value));
            closestByAnchor.set(signature, closest);
        }
        const selected = [];
        const count = Math.min(ALTERNATIVES_PER_ANCHOR, tickets);
        // Alternate new finishes and other wear/StatTrak variants when both are available.
        while (selected.length < count) {
            const freshFinish = selected.length % 2 === 0;
            let first;
            let next;
            for (const candidate of closest) {
                if (taken.has(candidate.key)) continue;
                first ??= candidate;
                if (finishes.has(candidate.entry.drop.skinId) !== freshFinish) {
                    next = candidate;
                    break;
                }
            }
            next ??= first;
            if (!next) break;
            selected.push(next);
            taken.add(next.key);
            finishes.add(next.entry.drop.skinId);
        }
        if (!selected.length) continue;
        results[index] = { entry: { ...anchor, weight: anchor.weight - tickets }, value, band };
        const base = Math.floor(tickets / selected.length);
        const remainder = tickets % selected.length;
        for (const [i, next] of selected.entries()) {
            results.push({ entry: { ...next.entry, weight: base + Number(i < remainder) }, value: next.value, band });
        }
    }
    // Market prices can move at either side of the fee. Never move tickets from a losing
    // range to a profitable one (or the reverse) merely to add more catalogue variants.
    const expandedFee = pricingFee(weightedValue(results));
    const originalByKey = new Map(item.entries.map((entry, index) => [entryKey(entry), anchorValues[index]]));
    if (item.entries.some((entry, index) => compareValue(anchorValues[index], anchorFee) !== compareValue(anchorValues[index], expandedFee)) ||
        results.some(({ entry, value }) => !originalByKey.has(entryKey(entry)) && compareValue(value, anchorFee) !== compareValue(value, expandedFee))) {
        return anchorOutcomes();
    }
    return results;
}

function compareValue(value, fee) {
    const amount = BigInt(value) * COIN_SCALE;
    return amount < fee ? -1 : amount > fee ? 1 : 0;
}

function weightedValue(outcomes) {
    return outcomes.reduce((sum, { entry, value }) => {
        const seedPrices = entry.seedPrices ?? [];
        const base = BigInt(value) * BigInt(SEED_COUNT - seedPrices.length);
        const supplements = seedPrices.reduce((total, [, seedPrice]) => total + BigInt(seedPrice), 0n);
        return sum + (base + supplements) * BigInt(entry.weight);
    }, 0n);
}

function pricingFee(weighted) {
    const denominator = JOINT_TICKETS * RETURN_PERCENT;
    return (weighted * COIN_SCALE * 100n + denominator - 1n) / denominator;
}

function validSeedPrices(entry, prices) {
    if (!Number.isInteger(entry?.exterior) || entry.drop?.priceVariant != null || !Array.isArray(prices) || !prices.length) return false;
    let previousSeed = -1;
    for (const row of prices) {
        if (!Array.isArray(row) || row.length !== 2 || row[0] <= previousSeed || !isBlueGem(entry.drop?.skinId, row[0]) ||
            !Number.isSafeInteger(row[1]) || row[1] <= 0) return false;
        previousSeed = row[0];
    }
    return true;
}

function riskMetrics(pricing, fee = pricing?.fee) {
    if (!pricing || !Array.isArray(pricing.entries) || !Array.isArray(pricing.values) ||
        pricing.entries.length !== pricing.values.length || !pricing.entries.length ||
        pricing.entries.some(entry => !Number.isSafeInteger(entry?.weight) || entry.weight <= 0 ||
            (entry.seedPrices !== undefined && !validSeedPrices(entry, entry.seedPrices))) ||
        pricing.entries.reduce((sum, entry) => sum + entry.weight, 0) !== TICKETS ||
        pricing.values.some(value => !Number.isSafeInteger(value) || value <= 0)) return null;
    const outcomes = pricing.entries.map((entry, index) => ({ entry, value: pricing.values[index] }));
    const weighted = weightedValue(outcomes);
    const actualFee = fee == null ? pricingFee(weighted) : BigInt(fee);
    if (actualFee <= 0n) return null;
    const tickets = { lossTickets: 0, profitTickets: 0, breakEvenTickets: 0 };
    let maxValue = 0;
    const count = (value, weight) => {
        const comparison = compareValue(value, actualFee);
        tickets[comparison < 0 ? 'lossTickets' : comparison > 0 ? 'profitTickets' : 'breakEvenTickets'] += weight;
        maxValue = Math.max(maxValue, value);
    };
    for (const { entry, value } of outcomes) {
        const seedPrices = entry.seedPrices ?? [];
        count(value, entry.weight * (SEED_COUNT - seedPrices.length));
        for (const [, seedPrice] of seedPrices) count(seedPrice, entry.weight);
    }
    for (const kind of Object.keys(tickets)) tickets[kind] /= SEED_COUNT;
    const riskLevel = tickets.lossTickets >= 9700 ? 'extreme' : tickets.lossTickets >= 8500 ? 'high'
        : tickets.lossTickets >= 6500 ? 'medium' : 'low';
    const riskLabel = { low: 'Thấp', medium: 'Vừa', high: 'Cao', extreme: 'Rất cao' }[riskLevel];
    return { ...tickets, maxValue: BigInt(maxValue) * COIN_SCALE,
        expected: weighted * COIN_SCALE / JOINT_TICKETS, fee: actualFee, riskLevel, riskLabel };
}

function withBlueGemQuotes(entry, quotes) {
    if (entry.exterior === null || entry.drop.priceVariant != null) return entry;
    const seeds = blueGemSeeds(entry.drop.skinId);
    if (!seeds.length) return entry;
    if (!quotes.has(entry.ref.name)) {
        const prices = [];
        for (const seed of [...seeds].sort((a, b) => a - b)) {
            const ref = market.getBlueGemMarketQuoteRef({ ...entry.drop, paintSeed: seed });
            if (!ref) continue;
            const quote = market.peekMarketQuote(ref.name, ref);
            if (quote?.source === 'csfloat' && quote.paintSeed === seed && Number.isSafeInteger(quote.priceVnd) && quote.priceVnd > 0) {
                prices.push([seed, quote.priceVnd]);
            }
        }
        quotes.set(entry.ref.name, prices);
    }
    const seedPrices = quotes.get(entry.ref.name);
    return seedPrices.length ? { ...entry, seedPrices } : entry;
}

// Assign the existing ticket sizes to prices only after catalogue expansion and quotation.
// A cheaper outcome must receive at least as many tickets as every more expensive outcome.
// Keep catalogue order and every outcome intact so existing indexes and snapshot rows remain stable.
function priceOrderedEntries(outcomes) {
    const weights = outcomes.map(({ entry }) => entry.weight).sort((left, right) => right - left);
    const byPrice = outcomes.map(({ value }, index) => ({ index, value: BigInt(value) }))
        .sort((left, right) => left.value === right.value ? left.index - right.index : left.value < right.value ? -1 : 1);
    const assigned = Array(outcomes.length);
    for (const [rank, { index }] of byPrice.entries()) assigned[index] = weights[rank];
    return outcomes.map(({ entry }, index) => entry.weight === assigned[index] ? entry : { ...entry, weight: assigned[index] });
}

function casePricing(item, priceOf = cachedPrices()) {
    if (!item?.entries?.length) return null;
    let anchorValues = item.entries.map(priceOf);
    if (item.commonPriceCap != null) {
        const unavailable = anchorValues.map((value, index) => item.bandByKey.get(entryKey(item.entries[index])) === 'common' &&
            (!Number.isSafeInteger(value) || value <= 0 || value > item.commonPriceCap) ? index : -1).filter(index => index >= 0);
        if (unavailable.length) {
            const taken = new Set(item.entries.map(entryKey));
            const replacements = item.candidates.filter(entry => !taken.has(entryKey(entry)) &&
                !entry.drop.statTrak && entry.drop.tier === 0 && entry.exterior >= 2).flatMap(entry => {
                const value = priceOf(entry);
                return Number.isSafeInteger(value) && value > 0 && value <= item.commonPriceCap ? [{ entry, value }] : [];
            }).sort((left, right) => left.value - right.value);
            const entries = [...item.entries];
            const bandByKey = new Map(item.bandByKey);
            const chosenFinishes = new Set(entries.filter((_, index) => !unavailable.includes(index)).map(entry => entry.drop.skinId));
            for (const index of unavailable) {
                const next = replacements.find(({ entry }) => !chosenFinishes.has(entry.drop.skinId));
                if (!next) return null;
                entries[index] = { ...next.entry, weight: entries[index].weight };
                anchorValues[index] = next.value;
                chosenFinishes.add(next.entry.drop.skinId);
                bandByKey.set(entryKey(entries[index]), 'common');
            }
            item = { ...item, entries, bandByKey };
        }
    }
    if (anchorValues.some(value => !Number.isSafeInteger(value) || value <= 0)) return null;
    const outcomes = expandEntries(item, anchorValues, priceOf);
    const blueGemQuotes = new Map();
    const entries = priceOrderedEntries(outcomes).map(entry => withBlueGemQuotes(entry, blueGemQuotes));
    const values = outcomes.map(({ value }) => value);
    const goldTickets = entries.reduce((sum, entry) => sum + (entry.drop.tier === GOLD_TIER ? entry.weight : 0), 0);
    const bands = ['common', 'regular', 'premium', 'jackpot'];
    const bandTickets = Object.fromEntries(bands.map(band => [band, 0]));
    const knownBands = outcomes.every(({ band }) => Object.hasOwn(bandTickets, band));
    if (knownBands) for (const [index, { band }] of outcomes.entries()) bandTickets[band] += entries[index].weight;
    return { entries, values, revision: revisionOf(entries), goldTickets,
        ...(knownBands ? { bandTickets, jackpotTickets: bandTickets.jackpot, ticketProfile: bands.map(band => bandTickets[band]) } : {}),
        ...riskMetrics({ entries, values }) };
}

function lockCasePricing(pricing) {
    const items = pricing.entries.map(({ drop, exterior, weight }) =>
        [drop.caseId, drop.skinId, exterior, weight, drop.statTrak,
            ...(drop.priceVariant === 'blue-gem' ? [drop.paintSeed] : [])]);
    const seedPrices = pricing.entries.map(entry => entry.seedPrices ?? null);
    return { revision: pricing.revision, values: pricing.values, items, ...(seedPrices.some(Boolean) ? { seedPrices } : {}) };
}

function lockedCase(item, pricing) {
    if (!item || !pricing || !Array.isArray(pricing.values)) return null;
    if (pricing.items != null && !Array.isArray(pricing.items)) return null;
    const { seedPrices } = pricing;
    if (seedPrices !== undefined && (!Array.isArray(seedPrices) || !Array.isArray(pricing.items) ||
        seedPrices.length !== pricing.items.length || !seedPrices.some(Array.isArray))) return null;
    const alternatives = pricing.items ? [pricing.items.map((tuple, index) => {
        const entry = makeEntry(tuple);
        const prices = seedPrices?.[index];
        if (!seedPrices || prices === null) return entry;
        return validSeedPrices(entry, prices) ? { ...entry, seedPrices: prices } : null;
    })] : [item.entries, item.legacyEntries].filter(Boolean);
    for (const entries of alternatives) {
        if (entries.length !== pricing.values.length || entries.some(entry => !entry || !Number.isSafeInteger(entry.weight) || entry.weight <= 0) ||
            entries.reduce((sum, entry) => sum + entry.weight, 0) !== TICKETS ||
            pricing.values.some(value => !Number.isSafeInteger(value) || value <= 0)) continue;
        if (item.blueOnly && entries.some(entry => entry.drop.priceVariant !== 'blue-gem' ||
            !isBlueGem(entry.drop.skinId, entry.drop.paintSeed))) continue;
        if (revisionOf(entries) === pricing.revision) return { ...item, entries };
    }
    return null;
}

function rollCustomCase(item, prices, id, acquiredAt, draw = crypto.randomInt) {
    let ticket = draw(TICKETS);
    const index = item.entries.findIndex(({ weight }) => (ticket -= weight) < 0);
    const entry = item.entries[index];
    const wear = entry.exterior === null ? {} : {
        float: draw(entry.min, entry.max + 1) / FLOAT_SCALE,
        paintSeed: entry.drop.priceVariant === 'blue-gem' ? entry.drop.paintSeed : draw(SEED_COUNT)
    };
    const seedPrice = entry.seedPrices?.find(([seed]) => seed === wear.paintSeed)?.[1];
    return { drop: { ...entry.drop, ...wear, id, acquiredAt, battleCaseId: item.id,
        ...(seedPrice !== undefined ? { priceVariant: 'blue-gem' } : {}),
        reelSeed: crypto.randomBytes(4).readUInt32BE() }, value: BigInt(seedPrice ?? prices[index]) * COIN_SCALE };
}

module.exports = { TICKETS, CREATIVE_CASE_IDS, BLUE_GEM_CASE_IDS, DISCOVERY_CASE_IDS, ICONIC_CASE_IDS, customCases, customCasesById, cachedPrices, casePricing, riskMetrics, lockCasePricing, lockedCase, rollCustomCase };
