// Presentation only: the server still settles and stores a Battle exactly once.
function createBattleWalletPresentation() {
  let held = null;
  const revealed = new Set();
  const amount = value => { try { return BigInt(value ?? 0); } catch { return 0n; } };
  const read = () => held ? (held.balance - held.fee < 0n ? 0n : held.balance - held.fee).toString() : null;
  return {
    watch(room, userId, balance, { pending = false } = {}) {
      const participant = room?.players?.some(player => player.userId === userId && !player.isBot);
      if (!participant) held = null;
      else if (room.status === 'waiting') {
        if (held?.roomId !== room.id) held = { roomId: room.id, balance: amount(balance), fee: 0n };
      } else if (room.status === 'finished' && held?.roomId === room.id) {
        if (!held.recovered) held.fee = amount(room.fee);
      } else if (room.status === 'finished' && pending && !revealed.has(room.id)) {
        const award = room.payoutType === 'coins' ? amount(room.payouts?.[userId]) : 0n;
        held = { roomId: room.id, balance: amount(balance) - award, fee: 0n, recovered: true, award };
      } else held = null;
      return read();
    },
    confirmSettledBalance(roomId, balance) {
      if (held?.roomId !== roomId || !held.recovered) return undefined;
      held.balance = amount(balance) - held.award;
      return read();
    },
    finish(roomId) {
      revealed.add(roomId);
      if (!held || held.roomId !== roomId) return false;
      held = null;
      return true;
    }
  };
}

module.exports = { createBattleWalletPresentation };
