# Skin.Club-inspired player web refresh

Completed on 2026-11-18 in the Happy house Scam Club workspace. The existing /play/ application now uses a dark purple/pink visual system, event hero artwork, compact bevel controls, image-led case catalogue, responsive three-column phone grid and fixed mobile navigation. The implementation keeps the Happy house name, CS2 data, Discord wallet and inventory, and existing Node service.

## User flows implemented

- Case catalogue: search, category and availability filters, sort, favorites, detail odds, x1/x2/x3/x4/x5/x10 openings, animated parallel reels, result summary, trial opening and quote-confirmed selling. Interrupted openings can retry the same server request.
- Inventory and Upgrade: search, sort, paging, selection, locking, sale quotes, target filters, server-calculated odds, committed result animation and proof details.
- Case Battle: create and join two-to-four-seat rooms, regular/crazy/sharing modes, ordered rounds, optional demo bots, vertical player reels, distinct totals, settlement and fairness receipt.
- Responsive behavior: tested on desktop and a 390px phone viewport; mobile uses two-by-two battle lanes, a three-column case grid and bottom navigation.

## Visual and audio scope

The page follows the reference broad composition and palette, with the public Grand Heist background image documented in [player-web.md](../../docs/player-web.md). Existing Happy house CS2 item artwork remains in use. Browser sounds use the project existing CS2 audio and synthesized fallbacks; they are not verified Skin.Club recordings. Skin.Club requires sign-in for its full opening flow, so its private opening animation/audio could not be inspected. This is a reference-inspired implementation, not a pixel-identical or fully feature-identical copy. Steam item trading, deposits/withdrawals, missions and other unsupported backend systems are not presented as working.

## Verification

- npm run build:play completed successfully after integrating the frontend.
- Seven focused Jest suites passed: **86 passed, 2 PostgreSQL tests skipped** (the test database URL was not configured). Suites: playerWeb, playerService, playerBattles, playerAudio, playerAudioRoutes, playerAssets, playerBattlePresentation.
- Browser testing used only a disposable preview store. Verified x2 and x4 case opens, no-charge trial opening, inventory lock/sell, a successful Upgrade, four-player battle settlement, mobile layout and reel landing alignment. No real player balance or production data was changed.
- The saved phone screenshot is [local-home-mobile.jpg](local-home-mobile.jpg). The preview can be started with node scripts/preview-player.js 4337 --scenes, then opened at http://127.0.0.1:4337/play/.

## Deployment

The VPS at teoteo.site was **not updated**. Read-only SSH could not run in this Windows tool environment: the installed ssh.exe returned exit code 255 without output, including for ssh -V. Source files and the build output are ready locally; deployment remains a separate step.

## Implementation files

- web/play-react/main.jsx, shared.jsx, cases.jsx, collection.jsx, battles.jsx and their CSS implement the React player experience.
- web/play/index.html, app.js and app.css are the player entry point and generated build assets.
- scripts/build-play.mjs builds the frontend; scripts/preview-player.js serves an isolated demo.
- utils/playerWeb.js serves the built assets and documented event background.
- utils/playerService.js and the player tests add/verify x2 and x4 openings and Battle bot behavior.
