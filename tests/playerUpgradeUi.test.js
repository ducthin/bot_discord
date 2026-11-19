const {
    TICKETS, normalizeStart, startTicketFor, ticketAtPoint,
    moveWinRegion, winningRanges, suitableTarget
} = require('../web/play-react/upgrade');

test('ring coordinates use the same top-origin clockwise tickets as the settled needle', () => {
    const rect = { left: 100, top: 50, width: 280, height: 280 };
    expect(TICKETS).toBe(100000);
    expect(ticketAtPoint(240, 50, rect)).toBe(0);
    expect(ticketAtPoint(380, 190, rect)).toBe(25000);
    expect(ticketAtPoint(240, 330, rect)).toBe(50000);
    expect(ticketAtPoint(100, 190, rect)).toBe(75000);
    expect(ticketAtPoint(240, 190, rect)).toBeNull();
    const radians = 359.99 * Math.PI / 180;
    expect(ticketAtPoint(240 + 140 * Math.sin(radians), 190 - 140 * Math.cos(radians), rect)).toBe(99997);
});

test('dragging a win region keeps the grab offset while crossing the zero seam in either direction', () => {
    expect(moveWinRegion(98000, 99000, 1000)).toBe(0);
    expect(moveWinRegion(1000, 1000, 99000)).toBe(99000);
    expect(moveWinRegion(42000, 50000, 60000)).toBe(52000);
    expect(moveWinRegion(42000, 50000, 50000)).toBe(42000);
    expect(normalizeStart(100000)).toBe(0);
    expect(normalizeStart(-1)).toBe(99999);
    expect(normalizeStart(200001)).toBe(1);
    expect(normalizeStart(123.6)).toBe(124);
});

test('pending and historical plans retain a custom region and legacy Under/Over positioning', () => {
    expect(startTicketFor({ startTicket: 98765, direction: 'over', winTickets: 47500 })).toBe(98765);
    expect(startTicketFor({ startTicket: 0, direction: 'over', winTickets: 47500 })).toBe(0);
    expect(startTicketFor({ direction: 'under', winTickets: 47500 })).toBe(0);
    expect(startTicketFor({ direction: 'over', winTickets: 47500 })).toBe(52500);
    expect(startTicketFor({ direction: 'over', winTickets: 1000 })).toBe(99000);
});

test('displayed winning ticket ranges include both boundaries and preserve exact count over wrap', () => {
    expect(winningRanges(0, 1000)).toEqual([[1, 1000]]);
    expect(winningRanges(99000, 1000)).toEqual([[99001, 100000]]);
    expect(winningRanges(99999, 1)).toEqual([[100000, 100000]]);
    expect(winningRanges(99999, 1000)).toEqual([[100000, 100000], [1, 999]]);
    expect(winningRanges(99000, 90000)).toEqual([[99001, 100000], [1, 89000]]);
    for (const [start, count] of [[0, 1000], [99000, 1000], [99999, 1], [99999, 1000], [99000, 90000]]) {
        const ranges = winningRanges(start, count);
        expect(ranges.reduce((sum, [first, last]) => sum + last - first + 1, 0)).toBe(count);
        expect(ranges.every(([first, last]) => first >= 1 && last <= TICKETS && first <= last)).toBe(true);
    }
});

test('automatic targets respect the engine upgrade and minimum-odds boundaries without number precision loss', () => {
    expect(suitableTarget({ value: '10000' }, 10000n)).toBe(false);
    expect(suitableTarget({ value: '10001' }, 10000n)).toBe(true);
    expect(suitableTarget({ value: '950000' }, 10000n)).toBe(true);
    expect(suitableTarget({ value: '950001' }, 10000n)).toBe(false);
    expect(suitableTarget({ value: '1' }, 0n)).toBe(false);
    const stake = 100000000000000000000000000000n;
    expect(suitableTarget({ value: (stake + 1n).toString() }, stake)).toBe(true);
    expect(suitableTarget({ value: stake.toString() }, stake)).toBe(false);
    expect(suitableTarget({ value: (stake * 95n).toString() }, stake)).toBe(true);
    expect(suitableTarget({ value: (stake * 95n + 1n).toString() }, stake)).toBe(false);
});
