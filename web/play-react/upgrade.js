const TICKETS = 100000;

function normalizeStart(value) {
  return ((Math.round(value) % TICKETS) + TICKETS) % TICKETS;
}

function startTicketFor(plan) {
  if (Number.isInteger(plan?.startTicket) && plan.startTicket >= 0 && plan.startTicket < TICKETS) return plan.startTicket;
  return plan?.direction === 'over' ? TICKETS - Number(plan.winTickets ?? 0) : 0;
}

function ticketAtPoint(clientX, clientY, rect) {
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  const x = clientX - rect.left - rect.width / 2;
  const y = clientY - rect.top - rect.height / 2;
  if (Math.hypot(x, y) < 1) return null;
  return normalizeStart(Math.atan2(x, -y) * TICKETS / (2 * Math.PI));
}

function moveWinRegion(origin, pointerStart, pointerNow) {
  return normalizeStart(origin + pointerNow - pointerStart);
}

function winningRanges(start, count) {
  if (!Number.isInteger(count) || count <= 0 || count > TICKETS) return [];
  start = normalizeStart(start);
  const end = start + count;
  return end <= TICKETS ? [[start + 1, end]] : [[start + 1, TICKETS], [1, end - TICKETS]];
}

function suitableTarget(target, stake) {
  try { const value = BigInt(target?.value); return stake > 0n && value > stake && value <= stake * 95n; }
  catch { return false; }
}

module.exports = { TICKETS, normalizeStart, startTicketFor, ticketAtPoint, moveWinRegion, winningRanges, suitableTarget };
