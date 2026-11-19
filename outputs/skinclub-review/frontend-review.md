# Frontend runtime review (resolved)

The findings below were raised against the initial integrated frontend and have since been resolved in the implementation. The original review details are retained as a record; final verification is summarized in [final-report.md](final-report.md).

## P1 — Opening can stall on sound loading, then spend after leaving the page
Location: web/play-react/cases.jsx:32; supporting web/play/audio.js:125–128.
The open handler awaits audio.unlock() before entering try and before submitting /open. unlock() awaits every sound file fetch with no timeout. A slow/hung WAV leaves the entire opening indefinitely in requesting. More seriously, if the user navigates away during this wait, component cleanup sets mounted=false but after sound resolves the handler still submits /open; the first mounted guard comes only AFTER the server mutation. Reproduce on a fresh page by delaying audio/*.wav, click Open, navigate away, then release sound requests: wallet may be charged after leaving.
Resolution: audio unlock is non-blocking and does not gate the purchase; mounted state is checked before sending the request.

## P1 — Ambiguous /open failure cannot safely replay the existing purchase
Location: web/play-react/cases.jsx:32.
Each click allocates makeRequestId() inside api(/open). If server commits but response is lost (network error or 5xx after persistence), catch resets phase to ready and discards the request ID. Clicking Open again creates a new paid transaction rather than replaying the saved receipt. Backend already guarantees idempotency for identical requestId; current UI does not use it for recovery.
Resolution: the full request is kept in session storage after ambiguous transport/server failures. The player can retry the same request ID; success or definitive validation clears it.

## P2 — A delayed case detail request hijacks later navigation
Location: web/play-react/main.jsx:49–51 and 63.
selectCase always sets view and pushes a case hash when its fetch resolves. Click a case, then select Inventory/Battle before the response returns: the late case response takes the user back. Clicking two cases quickly may display the older request last and create unintended history entries.
Resolution: navigation sequence guards reject stale case requests and route changes invalidate prior selection.

## P2 — Browser Back to the initial empty hash leaves the wrong view
Location: web/play-react/main.jsx:63.
The hashchange handler handles known views and case hashes, but does nothing for an empty hash. Initial /play/ => click Inventory (#inventory) => Browser Back to /play/ leaves Inventory displayed despite home URL.
Resolution: empty or unknown hashes route to the case catalogue and clear case detail.

## P2 — Reel landing becomes incorrect on resize/orientation change
Location: web/play-react/cases.jsx:21–23.
ReelLane captures card width and window center once. CSS changes card width from 170 to 125 at mobile breakpoint; resizing/rotating mid-spin preserves the old offset and may stop with a non-winning card beneath the pointer until results replace the reel.
Resolution: reel viewports observe size changes and recompute the landing offset.

## Lower priority observations
- Opening lanes now share their spin duration so the tick/reveal timing stays aligned.
- Shared Modal can remain focusable only through children, but current call sites have close buttons; no blocking issue identified.
- Result-sale modal currently requires reopening the quote if the response is ambiguous; backend ownership checks prevent duplicate payout. The inventory page uses a stable quote-bound request ID.
- Existing x1/x2/x3/x4/x5/x10 backend routes and transaction tests pass.

## Remaining note

The quick-sale result modal does not retain its quote-bound request ID across an ambiguous network failure. Backend ownership validation prevents a second payout, but the user may need to reopen the quote to see the final status. This is a recovery UX limitation rather than a duplicate-credit risk.
