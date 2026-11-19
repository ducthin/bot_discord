// Appended catalogue series. Every case owns a strict matcher so added market
// variants stay within the advertised weapon family or finish collection.
// Profiles split 10,000 tickets across anchors 1–2 / 3–4 / 5 / 6. These are
// reward groups, not promises of profit or a different chance for any player.
const discoveryDefinitions = [
    ['mag7', 'MAG-7', 'weapon', 'Chuyên MAG-7, từ Insomnia và Sonar đến BI83 Spectrum, Justice và Memento.', 4695, [
        [4880, 'e6a7543c4187', 2], [4288, 'cc6ec471ea94', 1], [4698, '0fd1ba0e61e0', 1],
        [4790, 'fbe7862c26f8', 1], [4695, 'a71a424b6eb1', 0], [4002, 'ee167748ce8e', 0]
    ], [6500, 2600, 750, 150]],
    ['sawed-off', 'Sawed-Off', 'weapon', 'Chuyên Sawed-Off với Spirit Board, Apocalypto, Devourer, Kiss♥Love và The Kraken.', 4009, [
        [4818, '3da25779ee2d', 2], [4904, 'd0653c0aaf2f', 2], [4695, 'db4ae843fbd7', 1],
        [4482, '9d723cee972d', 1], [4846, '6f81f65a9d91', 0], [4009, 'eeeab72c939a', 0]
    ], [6200, 2700, 900, 200]],
    ['m249', 'M249', 'weapon', 'Chuyên M249, có System Lock, Downtown, Emerald Poison Dart và Nebula Crusader.', 4138, [
        [4717, '4c1d61428041', 2], [4061, '4c2aae5b0b8d', 1], [4846, '302f05527562', 1],
        [4669, '0ca39d6a9fe2', 1], [4351, '61f4c5cf38a6', 0], [4138, 'fe2ecdf6f921', 0]
    ], [5500, 3200, 1050, 250]],
    ['r8', 'R8 Revolver', 'weapon', 'R8 Revolver với Banana Cannon, Crazy 8, Skull Crusher, Llama Cannon và Fade.', 4186, [
        [7003, '3604c7754aa6', 2], [4880, 'f1184959b60b', 1], [4846, 'ab0f49fac59d', 1],
        [4598, '1a044032aec8', 2], [4403, '4cb968c36e88', 0], [4186, '3d5660b8b090', 0]
    ], [7500, 1900, 500, 100]],
    ['flip', 'Flip Knife', 'gold', 'Mỗi lượt là Flip Knife, từ Safari Mesh và Blue Steel đến Tiger Tooth, Fade và Doppler Sapphire.', 4233, [
        [4186, '60b115694045', 4], [4186, '202cf7145f74', 2], [4186, '66d8b7a8bda6', 1],
        [4233, '7a40ba207ae9', 0], [4186, 'c414cd2f0b52', 0], [4233, '513cb8f9233c', 0]
    ], [6500, 2400, 900, 200]],
    ['gut', 'Gut Knife', 'gold', 'Mỗi lượt là Gut Knife, gồm Blue Steel, Slaughter, Tiger Tooth, Fade và Gamma Doppler Emerald.', 4281, [
        [4186, '69e941b17b76', 4], [4186, '56da0f69874d', 2], [4186, '9505695d72d4', 1],
        [4233, 'bd3422fa907e', 0], [4186, 'dc8b0d73c0e6', 0], [4281, '09f3db24ac92', 0]
    ], [5800, 2800, 1100, 300]],
    ['navaja', 'Navaja Knife', 'gold', 'Mỗi lượt là Navaja Knife với Blue Steel, Slaughter, Tiger Tooth, Fade và Doppler Ruby.', 4695, [
        [4548, '884cb5d4bb22', 4], [4548, '536904f0cf99', 2], [4548, '4facadf19ddb', 1],
        [4695, 'f69247021864', 0], [4548, 'b9e7dc445655', 0], [4695, '3b5885a4c77d', 0]
    ], [5200, 3200, 1200, 400]],
    ['ursus', 'Ursus Knife', 'gold', 'Mỗi lượt là Ursus Knife, có Slaughter, Tiger Tooth, Fade và Doppler Sapphire.', 4695, [
        [4548, '8d75b8d5e231', 4], [4548, '2edd5b788f70', 2], [4548, '3bdc5f369061', 1],
        [4695, '4cb01f02c1e3', 0], [4548, '8512690f4f86', 0], [4695, '76be2f7e3241', 0]
    ], [6200, 2600, 950, 250]],
    ['stiletto', 'Stiletto Knife', 'gold', 'Mỗi lượt là Stiletto Knife, từ Safari Mesh và Blue Steel đến Marble Fade, Fade và Doppler Ruby.', 4695, [
        [4548, '4451af01dc3b', 4], [4548, 'b81b784b6f1f', 2], [4548, '05341f90a3cf', 1],
        [4695, '1c8f54fa853f', 0], [4548, '8416be60f992', 0], [4695, '92753788cfe5', 0]
    ], [6800, 2200, 800, 200]],
    ['kukri', 'Kukri Knife', 'gold', 'Mỗi lượt là Kukri Knife với Safari Mesh, Night Stripe, Blue Steel, Slaughter, Crimson Web và Fade.', 7003, [
        [7003, '76a854adcfa8', 4], [7003, 'eefa60947417', 2], [7003, 'bc9e87f3c013', 2],
        [7003, '0808024a639a', 1], [7003, '2f3b8c9ded18', 1], [7003, '6dbefc59c1b9', 0]
    ], [5000, 3200, 1400, 400]],
    ['tiger-tooth', 'Tiger Tooth', 'theme', 'Chỉ dao Tiger Tooth; Navaja và Gut mở màn, có Ursus, Bayonet, Talon và Butterfly.', 4403, [
        [4695, 'f69247021864', 0], [4233, 'bd3422fa907e', 0], [4695, '4cb01f02c1e3', 0],
        [4233, '65d7965e0e39', 0], [4695, '680a9e6c14da', 0], [4403, '9f5234d3821f', 0]
    ], [5500, 3000, 1200, 300]],
    ['marble-fade', 'Marble Fade', 'theme', 'Chỉ dao Marble Fade, từ Shadow Daggers và Navaja đến Bayonet, M9 Bayonet và Butterfly.', 4403, [
        [4403, '210ec6e164ee', 0], [4695, '39fd7c139081', 0], [4695, '3c8d6d2066c5', 0],
        [4233, '352633fab46b', 0], [4233, 'fd0ac7570eb0', 0], [4403, 'c14ef2ceee15', 0]
    ], [6500, 2500, 800, 200]],
    ['lore', 'Lore', 'theme', 'Chỉ dao Lore với Gut, Shadow Daggers, Huntsman, Bayonet, M9 Bayonet và Butterfly.', 4818, [
        [4281, '3dc72614017d', 3], [4818, 'fe0b2c425e83', 2], [4818, '687191040a39', 2],
        [4281, '41061f8a5cc4', 1], [4281, '56ef5fcd4d5e', 1], [4818, 'b083e3da3e03', 0]
    ], [7000, 2200, 650, 150]],
    ['autotronic', 'Autotronic', 'theme', 'Chỉ dao Autotronic, từ Gut và Shadow Daggers đến Huntsman, Bayonet, Karambit và Butterfly.', 4818, [
        [4281, '15218dde9913', 3], [4818, '07d536c6b5ee', 2], [4818, 'a14dff866da7', 2],
        [4281, 'e655cd4b41ee', 1], [4281, '3d2a30953c01', 1], [4818, '51688cf28133', 0]
    ], [6200, 2600, 1000, 200]],
    ['slaughter', 'Slaughter', 'theme', 'Chỉ dao Slaughter: Shadow Daggers, Navaja, Falchion, Stiletto, Talon và Butterfly.', 4018, [
        [4138, '7741632caeaf', 1], [4548, '4facadf19ddb', 1], [4091, 'a0e461882742', 1],
        [4548, '05341f90a3cf', 0], [4548, '39fd4dd08be3', 0], [4018, 'eae7c10fa54f', 0]
    ], [5800, 2900, 1000, 300]],
    ['freehand', 'Freehand', 'theme', 'Chỉ dao Freehand với Gut, Shadow Daggers, Huntsman, Flip, M9 Bayonet và Butterfly.', 4818, [
        [4281, '148940445bd3', 2], [4818, 'd77e177f35e2', 2], [4818, '37f576426c37', 2],
        [4281, '546d3bfe8243', 1], [4281, 'acb2333c3cd8', 0], [4818, '54da4d116a31', 0]
    ], [5000, 3300, 1300, 400]],
    ['silent-strike', 'Đột Kích Giảm Thanh', 'casual', 'USP-S, MP5-SD và M4A1-S phối hợp; có Cyrex, Black Lotus, Phosphor và Printstream.', 4717, [
        [4818, 'f3392bb443bc', 2], [4880, 'd87f89df4191', 1], [4904, '63c1d72b8501', 1],
        [4548, '9e44f13c59da', 1], [4548, 'aa2d649aeaf6', 0], [4717, '8e45a15cf7f5', 1]
    ], [5500, 3000, 1200, 300]],
    ['ct-loadout', 'Biệt Đội CT', 'casual', 'Trang bị CT gồm MP9, FAMAS, M4A4, USP-S, AUG và M4A1-S; có Chameleon và Printstream.', 4717, [
        [4880, '2f564d56b7ff', 2], [4288, 'ea2876c00b6b', 2], [4904, '0e160542d6d4', 1],
        [4471, '3901933d5e47', 1], [4011, '370dfd3911e0', 0], [4717, '8e45a15cf7f5', 1]
    ], [4500, 3500, 1600, 400]],
    ['t-loadout', 'Biệt Đội T', 'casual', 'MAC-10, Tec-9, Galil AR, SG 553, Glock-18 và AK-47; có Chromatic Aberration, Cyrex và Vulcan.', 4017, [
        [4904, '543d85d8ca60', 2], [4904, '80f2ee4e940f', 1], [4747, '69f2e17b78f2', 1],
        [4620, '5b6e17f145f5', 1], [4236, '73cc8d5fcd85', 0], [4017, 'b14c9f234bc5', 1]
    ], [5000, 3200, 1400, 400]],
    ['orange-white', 'Cam Trắng', 'casual', 'Hai bộ súng Asiimov và Mecha Industries hội tụ, gồm P250, FAMAS, Desert Eagle, P90, M4A4 và AK-47.', 4548, [
        [4288, 'ea2876c00b6b', 4], [4233, 'b10fdec34656', 4], [4548, 'a79b5b4ad623', 2],
        [4018, 'c01d561550ed', 2], [4009, '31a3a09d007d', 2], [4548, '09205674e246', 0]
    ], [4000, 3500, 2000, 500]],
    ['black-gold', 'Hắc Kim', 'casual', 'Bộ súng Cartel, Elite Build, Royal Legion, Fuel Injector và Legion of Anubis.', 4187, [
        [4187, 'df294c189613', 2], [4089, 'ea4e27f0cd16', 2], [4187, '71b2f3cff45c', 1],
        [4281, '23a0601d3273', 1], [4698, 'dfd42a079f44', 0], [4187, '8f7564b8b3eb', 0]
    ], [6500, 2500, 800, 200]],
    ['blue-purple', 'Lam Tím', 'casual', 'Các bộ súng Cobalt Core, Pulse, Neon Ply và Decimator; nhóm cuối có M4A1-S Decimator.', 4351, [
        [4138, '0bc881325706', 2], [4017, '47c5420fd212', 1], [4011, '205233b2ccee', 1],
        [4620, 'a16b386af5bb', 1], [4620, '0abab7de168d', 0], [4351, '7b3af96bd1e4', 0]
    ], [6000, 2800, 1000, 200]],
    ['pistol-premium', 'Súng Lục Cao Cấp', 'casual', 'Chỉ súng ngắn từ Restricted trở lên, có Royal Legion, Monkey Business, Mecha Industries, Kill Confirmed và Printstream.', 4138, [
        [4187, '71b2f3cff45c', 2], [4233, 'b10fdec34656', 2], [4089, 'b2a5203033ee', 1],
        [4548, 'a79b5b4ad623', 1], [4138, 'cf4c11689014', 1], [4846, 'be37abed2b4d', 0]
    ], [5000, 3500, 1200, 300]],
    ['heavy-assault', 'Đột Kích Hạng Nặng', 'casual', 'Súng máy và shotgun với Hypnosis, dev_texture, BI83 Spectrum, Tranquility, Kiss♥Love và Hyper Beast.', 4187, [
        [7003, 'c7c133807ad6', 2], [4747, 'bce9af58ff21', 1], [4790, 'fbe7862c26f8', 1],
        [4029, '24cc378ff450', 1], [4846, '6f81f65a9d91', 0], [4187, 'd0090217a5a4', 0]
    ], [5000, 3300, 1400, 300]]
].map(([id, name, group, description, imageCase, rewards, profile]) => [id, name, group,
    description,
    imageCase, rewards, profile]);

const weaponName = name => name.split(' | ')[0];
const weaponFamily = (names, minTier = 0, maxTier = 3) => {
    const allowed = new Set(names);
    return (name, tier) => tier >= minTier && tier <= maxTier && allowed.has(weaponName(name));
};
const knifeFamily = name => (candidate, tier) => tier === 4 && weaponName(candidate) === name;
const knifeFinish = finish => (name, tier) => tier === 4 && name.startsWith('★ ') &&
    !/Gloves|Hand Wraps/.test(weaponName(name)) && name.endsWith(` | ${finish}`);
const gunFinishes = finishes => {
    const allowed = new Set(finishes);
    return (name, tier) => tier >= 0 && tier <= 3 && allowed.has(name.split(' | ')[1]);
};

const discoveryMatches = new Map([
    ['mag7', weaponFamily(['MAG-7'])],
    ['sawed-off', weaponFamily(['Sawed-Off'])],
    ['m249', weaponFamily(['M249'])],
    ['r8', weaponFamily(['R8 Revolver'])],
    ['flip', knifeFamily('★ Flip Knife')],
    ['gut', knifeFamily('★ Gut Knife')],
    ['navaja', knifeFamily('★ Navaja Knife')],
    ['ursus', knifeFamily('★ Ursus Knife')],
    ['stiletto', knifeFamily('★ Stiletto Knife')],
    ['kukri', knifeFamily('★ Kukri Knife')],
    ['tiger-tooth', knifeFinish('Tiger Tooth')],
    ['marble-fade', knifeFinish('Marble Fade')],
    ['lore', knifeFinish('Lore')],
    ['autotronic', knifeFinish('Autotronic')],
    ['slaughter', knifeFinish('Slaughter')],
    ['freehand', knifeFinish('Freehand')],
    ['silent-strike', weaponFamily(['USP-S', 'MP5-SD', 'M4A1-S'])],
    ['ct-loadout', weaponFamily(['MP9', 'FAMAS', 'M4A4', 'USP-S', 'AUG', 'M4A1-S'])],
    ['t-loadout', weaponFamily(['MAC-10', 'Tec-9', 'Galil AR', 'SG 553', 'Glock-18', 'AK-47'])],
    ['orange-white', gunFinishes(['Asiimov', 'Mecha Industries'])],
    ['black-gold', gunFinishes(['Cartel', 'Elite Build', 'Royal Legion', 'Fuel Injector', 'Legion of Anubis', 'Gold Toof'])],
    ['blue-purple', gunFinishes(['Cobalt Core', 'Pulse', 'Neon Ply', 'Decimator'])],
    ['pistol-premium', weaponFamily(['Glock-18', 'USP-S', 'P2000', 'P250', 'Desert Eagle', 'Five-SeveN',
        'Tec-9', 'CZ75-Auto', 'Dual Berettas', 'R8 Revolver'], 1)],
    ['heavy-assault', weaponFamily(['M249', 'Negev', 'Nova', 'XM1014', 'MAG-7', 'Sawed-Off'])]
]);

const DISCOVERY_CASE_IDS = Object.freeze(discoveryDefinitions.map(([id]) => `battle-${id}`));

module.exports = { discoveryDefinitions, discoveryMatches, DISCOVERY_CASE_IDS };
