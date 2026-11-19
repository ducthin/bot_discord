const { createBattleWalletPresentation } = require('../web/play-react/battle-wallet');

const waiting = { id: 'live', status: 'waiting', fee: '125', players: [{ userId: 'human' }, { userId: 'bot', isBot: true }] };
const settled = { ...waiting, status: 'finished', payoutType: 'coins', payouts: { human: '10000' } };

test('live participant balance hides settlement polling until playback completes and charges the fee once', () => {
    const wallet = createBattleWalletPresentation();
    expect(wallet.watch(waiting, 'human', '1000')).toBe('1000');
    // A /me poll can observe the final award before the waiting room poll observes its result.
    expect(wallet.watch(waiting, 'human', '10875')).toBe('1000');
    expect(wallet.watch(settled, 'human', '10875')).toBe('875');
    expect(wallet.watch(settled, 'human', '10875')).toBe('875');
    expect(wallet.finish('live')).toBe(true);
    expect(wallet.finish('live')).toBe(false);
    // A historical view or replay must not withhold the already revealed award again.
    expect(wallet.watch(settled, 'human', '10875')).toBeNull();
});

test('pending result recovery preserves exact large balances without inspecting payout amounts', () => {
    const wallet = createBattleWalletPresentation();
    const balance = 9007199254740993123456789n, fee = 1234567890123456789n;
    expect(wallet.watch({ ...waiting, fee: fee.toString() }, 'human', balance.toString())).toBe(balance.toString());
    expect(wallet.watch({ ...settled, fee: fee.toString() }, 'human', (balance + 999999999999999999999n).toString())).toBe((balance - fee).toString());
    expect(wallet.finish('other')).toBe(false);
    expect(wallet.finish('live')).toBe(true);
});

test('spectators, bots, cancellation, leaving and switching rooms release presentation holds', () => {
    const wallet = createBattleWalletPresentation();
    expect(wallet.watch(waiting, 'viewer', '1000')).toBeNull();
    expect(wallet.watch(waiting, 'bot', '1000')).toBeNull();
    wallet.watch(waiting, 'human', '1000');
    expect(wallet.watch({ ...waiting, status: 'cancelled' }, 'human', '1000')).toBeNull();
    wallet.watch(waiting, 'human', '1000');
    expect(wallet.watch({ ...waiting, players: [] }, 'human', '1000')).toBeNull();
    wallet.watch(waiting, 'human', '1000');
    expect(wallet.watch(null, 'human', '1000')).toBeNull();
    expect(wallet.watch({ ...waiting, id: 'next' }, 'human', '800')).toBe('800');
    expect(wallet.finish('live')).toBe(false);
    expect(wallet.watch({ ...settled, id: 'old' }, 'human', '1000')).toBeNull();
});

test('a reloaded participant hides already-settled awards until the shared live playback finishes', () => {
    const wallet = createBattleWalletPresentation();
    expect(wallet.watch(settled, 'human', '10875', { pending: true })).toBe('875');
    expect(wallet.confirmSettledBalance('live', '10975')).toBe('975');
    expect(wallet.watch(settled, 'human', '10975', { pending: true })).toBe('975');
    expect(wallet.finish('live')).toBe(true);
    expect(wallet.confirmSettledBalance('live', '10975')).toBeUndefined();
    expect(wallet.watch(settled, 'human', '10975', { pending: true })).toBeNull();
});

test('recovered holds preserve skin prizes and never update another room after a delayed balance response', () => {
    const wallet = createBattleWalletPresentation();
    expect(wallet.watch({ ...settled, payoutType: 'skins' }, 'human', '875', { pending: true })).toBe('875');
    wallet.watch({ ...waiting, id: 'next' }, 'human', '875');
    expect(wallet.confirmSettledBalance('live', '10875')).toBeUndefined();
    expect(wallet.finish('next')).toBe(true);
});
