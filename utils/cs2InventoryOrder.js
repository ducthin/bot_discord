const SORT_ORDERS = Object.freeze({
    'tier-desc': 'Tier cao → thấp', 'tier-asc': 'Tier thấp → cao', newest: 'Mới nhận trước',
    'float-asc': 'Float thấp → cao', 'float-desc': 'Float cao → thấp',
    'price-desc': 'Giá cao → thấp', 'price-asc': 'Giá thấp → cao'
});

function normalizeSort(order) {
    return Object.hasOwn(SORT_ORDERS, order) ? order : 'tier-desc';
}

function sortDrops(drops, order = 'tier-desc', priceOf = () => null) {
    order = normalizeSort(order);
    const [kind, direction] = order.split('-');
    const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
    const rows = drops.map((drop, index) => ({ drop, index, value: kind === 'price' ? priceOf(drop)
        : kind === 'float' ? (Number.isFinite(drop.float) ? drop.float : null) : drop.tier }));
    const newest = (left, right) => {
        const a = left.drop.acquiredAt;
        const b = right.drop.acquiredAt;
        const aValid = Number.isSafeInteger(a) && a > 0;
        const bValid = Number.isSafeInteger(b) && b > 0;
        if (aValid !== bValid) return aValid ? -1 : 1;
        return (aValid ? compare(b, a) : 0) || right.index - left.index;
    };
    rows.sort((left, right) => {
        if (kind === 'newest') return newest(left, right);
        if (left.value == null || right.value == null) {
            if (left.value == null && right.value != null) return 1;
            if (right.value == null && left.value != null) return -1;
            return newest(left, right);
        }
        return compare(left.value, right.value) * (direction === 'desc' ? -1 : 1) || newest(left, right);
    });
    return rows.map(({ drop }) => drop);
}

module.exports = { SORT_ORDERS, normalizeSort, sortDrops };
