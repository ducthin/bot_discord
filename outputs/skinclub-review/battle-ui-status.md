# Battle UI implementation

Files: web/play-react/battles.jsx and battles.css. Import default BattlePage from ./battles, remove old main.jsx inline Battle functions. Component uses shared.jsx exports and bundles CSS through esbuild.

- Correct public schema: API round entries use item (storage uses drop); totals computed individually from revealed rounds, heading uses room.mode.
- Poll waiting room every 4.5 s, stop polling finished room to avoid replay resets.
- Join, change seat, leave, add/remove bot, start/cancel confirmation.
- Creator 2–4 seats, regular/crazy/sharing, exclusive toggle, 1–20 case order, search, sort, selection, fresh fee check.
- Animated vertical reel per seat, deterministic decoration, fixed server winner, audio per round, running totals, winner payout, replay and skip animation.
- Desktop 4 cols and mobile 2x2; reduced-motion path.
- Proof detail panel uses backend commitment/server seed/outcome hash and verification flag.

Validation: isolated esbuild compilation passed; playerBattlePresentation + playerBattles tests 19 passed, 1 skipped (PostgreSQL). Parent browser QA after integration still needed. No production or environment configuration changed.
