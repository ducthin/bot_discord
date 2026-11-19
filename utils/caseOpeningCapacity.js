const v8 = require('node:v8');

// Include transient roll objects, inventory copies and JSON/Discord result payloads.
const BYTES_PER_OUTCOME = 64 * 1024;
const MAX_ARRAY_LENGTH = 0xffffffff;
const CAPACITY_NOTICE = 'Lượt mở quá lớn so với bộ nhớ máy chủ hiện có. Hãy chia thành các lượt nhỏ hơn.';

function canFitCaseOpening(quantity, existingDropCount = 0) {
    if (!Number.isSafeInteger(quantity) || quantity < 1 ||
        !Number.isSafeInteger(existingDropCount) || existingDropCount < 0 ||
        quantity > MAX_ARRAY_LENGTH - existingDropCount) return false;
    const { heap_size_limit: limit, used_heap_size: used } = v8.getHeapStatistics();
    if (!Number.isFinite(limit) || !Number.isFinite(used) || limit <= 0 || used < 0) return false;
    const reserve = Math.min(128 * 1024 * 1024, Math.floor(limit / 8));
    const available = Math.max(0, limit - used - reserve);
    return quantity <= Math.floor(available / BYTES_PER_OUTCOME);
}

module.exports = { canFitCaseOpening, CAPACITY_NOTICE };
