const percent = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });
const chance = tickets => `${percent.format(tickets / 100)}%`;
const seedOddsNote = pricing => pricing?.entries?.some(entry => entry.seedPrices?.length)
    ? 'Pattern quay riêng sau khi trúng skin: mỗi seed có cùng cơ hội 1/1001. Giá niêm yết là giá thường; Blue Gem có giá riêng theo seed.' : '';

function caseDescription(item, pricing, { showGold = false } = {}) {
    const lines = [item.description];
    if (!pricing) return lines.join('\n');
    if (item.id.startsWith('battle-jackpot-') && pricing.bandTickets) {
        lines.push(`${chance(pricing.bandTickets.common)} nhóm súng phổ thông, ${chance(pricing.bandTickets.jackpot)} nhóm giải lớn.`);
    } else if (pricing.ticketProfile) {
        lines.push(`Nhóm 1/2/3/đặc biệt: ${pricing.ticketProfile.map(chance).join(' / ')}.`);
    }
    if (showGold && pricing.goldTickets > 0) lines.push(`Dao/găng: ${chance(pricing.goldTickets)}.`);
    lines.push('Tỷ lệ skin/độ mòn theo giá đang hiển thị; nhóm không cam kết lời, mỗi lượt độc lập.');
    const seedNote = seedOddsNote(pricing);
    if (seedNote) lines.push(seedNote);
    return lines.join('\n');
}

module.exports = { caseDescription, seedOddsNote };
