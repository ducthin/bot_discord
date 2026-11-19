# Player backend audit — 18 November 2026

## Implemented
- utils/playerService.js: opening counts 1, 2, 3, 4, 5 and 10 (previously 1, 3, 5, 10).
- tests/playerService.test.js: exact debit/result count/replay tests for x2/x4; invalid counts cannot mutate wallet.
- tests/playerWeb.test.js: replaces stale static HTML assertion with HTTP entrypoint asset coverage; adds public odds endpoint and bot/seat authenticated route binding.
- tests/playerBattles.test.js: bot ownership, seat swap, single settlement, sharing payout and bot wallet/inventory isolation regression.

## Verification
- playerService + playerBattles: 35 passed, 2 PostgreSQL tests skipped; subsequently bot test added and playerBattles alone passes 15 tests, 1 skipped.
- playerWeb + playerAudioRoutes + playerAssets: 37 passed, one failure for missing /play/app.css (HTTP 500 ENOENT).
- Original afterEach cleanup timed out at 5s once; reruns with --testTimeout=30000 passed relevant service tests.
- PostgreSQL tests require explicit TEST_DATABASE_URL; not run against production.

## Integration issues requiring parent frontend work
1. index.html links /play/app.css but file absent; build-play.mjs only bundles JS. Create stylesheet or remove invalid link.
2. Upgrade total expression adds preview.stake (string) to coinStake and double-counts coinStake. Use amount(preview.stake) alone when preview exists; otherwise add inventory total to parsed additional stake.
3. Case opening UI claims provably-fair receipt, but /open only uses crypto.randomInt and saved receipt. Battle and Upgrade expose commitment proofs; normal open does not.
4. main.jsx openingCounts must include new x2/x4 if controls should mirror reference.
5. Any new image/font/audio files require allowlisting in playerWeb static routes.

## Existing supported behavior
- Public catalogue: 169 cases, detail odds and cached current prices.
- Discord code login, wallet/inventory isolation by guild, item locks, exact sale quotes.
- Case opening uses transaction-backed idempotency; changed price or invalid amount rejects before debit.
- Upgrade shares Discord engine and supports pending/replayed attempts with proof.
- Battles: 2/3/4 seats, up to 20 rounds, regular/crazy/sharing, bot add/remove, seat switching, atomic settlement and deterministic proof.
- No backend support for Steam trades, money deposits/withdrawals, missions, daily cases, team 2v2. Avoid presenting these as functioning flows.

## Integrated recheck
After app.css was added, all five focused suites passed together: 74 tests passed, 2 PostgreSQL tests skipped, no failures. Command: node node_modules/jest/bin/jest.js --runInBand --testTimeout=30000 tests/playerWeb.test.js tests/playerService.test.js tests/playerBattles.test.js tests/playerAudioRoutes.test.js tests/playerAssets.test.js
