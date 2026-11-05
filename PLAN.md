# i-d-KO — Decision Brawler

## Progress
- **Milestone A (steps 1–7): done.** Review pass done. Fixes are in the commits after `chore: render deployment config`.
- **Milestone B (steps 8–15): done.** Review pass done. Fixes are in the commits after `feat: debug overlay`.
  - Deviation: the arena lives in `shared/arena.js` (not `server/game/`), because client prediction collides with pillars too.
  - Position history for lag comp moves to step 24 (nothing reads it before then).
  - Inputs send held `buttons`; the server derives presses on arrival, so merging/dropping inputs can't lose a press. After `NET.INPUT_STARVE_TICKS` with no input, a fighter stops walking; disconnect and rejoin reset the input stream.
  - A crashed match (or one that fails to start) sends its room back to the lobby (`rooms.endMatch`).
  - Checked in Chrome against a bot: rendering, WASD, mouse aim, debug overlay, reload-rejoin mid-match and leave all work. Touch controls are still untested on a real phone.
- **Milestone C (steps 16–21): done** on branch `milestone-c-combat` (not merged). Review pass done. Fixes are in the commits after `feat: hitstun decay and combo burst`.
  - Step 16: `shared/combat-state.js` is a plain-object state machine (`state`, `t` ticks in state, `hitstop`, one-slot `buffer`). Moves are added to its `ACTIONS` table step by step; jab timing (string + chain window) lives here, hit detection in step 17.
  - Step 17: `stepFighter(cs, body, input)` in `combat-state.js` is the shared per-tick unit (combat timing, then walking; hitstop freezes the body). `server/game/combat.js` collects every hit from pre-hit state and then applies them, so trades both land. Inputs carry `aimed` (mouse or drag); un-aimed jabs snap to the nearest enemy in the assist cone. Snapshots carry each fighter's full `cs`. A KO is `alive: false` in the snapshot; the win check is step 26.
  - Step 18: inputs get a `released` edge at arrival (OR-merged like `pressed`), and the fighter keeps the applied input's held `buttons`. Heavy = `charge` state (aim follows, slowed walk) → fires on release once `MIN_CHARGE` is reached (a merged tap still fires), or by itself after `MAX_HOLD` at full charge. Damage/knockback scale with charge; from `LAUNCH_CHARGE` the target is `launched` and bounces off the next wall once (shared in `stepFighter`, so prediction sees it) with extra hitstun and a short hitstop.
  - Step 19: dash = `dash` state along the stick (or facing if the stick is under `MIN_STICK`), from idle, from a heavy charge, or cancelling jab/heavy recovery after `cancelAfter` ticks. Cooldown runs from the dash start and a press on cooldown is buffered. No invulnerability: dodging is spacing; parry is the defensive tool.
  - Step 20: parry = `parry` state (active window, then whiff recovery), from idle only. An enemy hit on a target inside the window is parried: no damage or knockback, the parrier is idle at once, the attacker is `stunned`, and both get a short hitstop. Parrying is judged on pre-hit state, so it holds against simultaneous hits. Friendly hits ignore parries. The 2-tick input grace is still step 24.
  - Step 21: a combo lasts while the victim stays in hitstun; each hit's hitstun is multiplied by `HITSTUN_DECAY` per hit so far (floor `MIN_HITSTUN`). The combo clock counts real ticks (hitstop too); at `COMBO_BURST_TICKS` the victim enters `burst` (knockback stops, everyone within `BURST_RADIUS` is pushed) with `BURST_INVULN` that ends early on attacking. Jab 1–2 hitstun went 12 → 16 so the 3-jab string stays a true combo after decay (a test locks this in).
  - Review fixes: same-tick multi-hits on one target are one combo step (strongest hit stuns); a combo stays open through the tick its hitstun ends (no frame-perfect decay reset); wall bounce needs speed *into* the surface, and a burst push clears launches; touch heavy keeps its drag aim on release. Kept on purpose: the input buffer doesn't age during hitstop (presses during hitstop chain).
  - Checked in Chrome against a bot: jab string, heavy charge ring/launch, getting KO'd by a bot's jab strings (~6s standing still), spectator camera. Parry and touch weren't exercised in the browser (unit tests only).
- After the review (user request): dash cooldown 20 → 60 ticks (2s); heavy recovery can no longer be dash-cancelled (jab recovery still can, and so can a heavy *charge*); landing all 3 jabs of one string on enemies (`cs.stringHits`, counted in `applyLanded`) resets the dash cooldown. Parried and friendly hits don't count. Your own fighter shows the dash cooldown as a vertical bar beside it (bright when ready); other players' cooldowns aren't drawn.
- **Milestone D (steps 22–24): done** on branch `milestone-d-netcode` (not merged). Review pass done. Fixes are in the commits after `feat: lag compensation`.
  - Step 22: `public/js/net.js` `createPredictor()` (no DOM, tested under node). Each local input runs through `stepFighter` at once and is kept until acked; each snapshot resets the fighter to the server's body + full `cs` and replays the unacked inputs. Corrections up to `NET.SNAP_DISTANCE` ease out via a draw offset (`CORRECTION_DECAY` per tick), bigger ones snap. An ack going backwards (rejoin) clears pending; `sendInput` returns false offline and the predictor resets. Snapshot `cs.dir` is now rounded to 4 decimals (dash replays drifted ~0.6 units at 2). Not predicted: jab aim assist (the fist direction corrects on the next snapshot). Your fighter is drawn at the newest predicted tick (no sub-tick smoothing yet).
  - Step 23: `createClock()` eases an estimate of (server tick − local time) toward each snapshot's sample and takes jumps over `CLOCK_SNAP_TICKS` at once (dropped server ticks, coming back from away); `jitterMs` is the smoothed sample error. `createInterpolator()` keeps `INTERP_BUFFER_TICKS` of snapshots and shows others at `clock − delay`, delay = 2 ticks + `INTERP_JITTER_SCALE`×jitter clamped to 100–200ms and eased per snapshot; positions lerp, aim takes the short way, discrete state comes from the nearer snapshot; past the newest it extrapolates along velocity for 2 snapshots (3 ticks), then holds. `createTicker()` runs the input step at a fixed 30 Hz off `performance.now()` (polled at 4× rate, max 3 catch-up steps, longer stalls skipped), and your fighter is drawn between its last two predicted ticks. Inputs now send the rendered tick (integer). The debug overlay shows the delay and jitter.
  - Step 24: `server/game/lagcomp.js` keeps `MAX_REWIND_TICKS + 1` ticks of positions (recorded after body separation, before hits). Each applied input sets the attacker's `rewind` = server tick − input tick, clamped to [0, `LAG_COMP_MAX_MS`]; `resolveHits` checks reach against `seen(attacker, target)`, the rewound position unless the target is dashing, parrying or bursting now. Knockback direction uses current positions. **Parry grace (deviation from the plan's wording):** input stamps are render ticks (≥100ms in the past), so they can't be compared with the hit tick. Instead, enemy hits on an *idle* target keep an undo record (`target.grace`), and a parry press applied within `COMBAT.PARRY.grace` ticks undoes them (gives back their damage, restores combat state and knockback, keeps presses buffered since) and stuns every attacker in them, taking back their jab string credit. A KO is final.
  - Review fixes: inputs use a plain emit (socket.io dropped volatile emits while a write was in flight, losing catch-up inputs); a clock jump needs `CLOCK_JUMP_CONFIRM` snapshots in a row (a lone late one only counts toward jitter); grace parry fixes above. **Lag comp cap 100 → 200ms (user decision):** the view is always ≥100ms old from interpolation alone, so a 100ms cap compensated no ping at all; 200ms covers good and typical mobile connections, worse ones lead their targets. View ticks can't go backwards, jump more than `MAX_STAMP_STEP` per input, or pass the server tick, so a client can't pick its rewind.
  - Checked in Chrome against a bot: snapshots at 20/s, interp delay 100ms, no console errors. Zero prediction corrections while walking and dashing, on localhost and with ~97ms RTT simulated by delaying the page's WebSocket sends; a forced reconnect mid-match rejoined cleanly. Got KO'd by the bot's jabs. Corrections from server-only events (hits, body pushes) weren't observed: on localhost hitstop hides them, and with latency I didn't get into contact. Touch still untested on a real phone.
- **Milestone E (steps 25–29): done**, merged into `main` from `milestone-e-match-flow`. Review pass done. Fixes are in the commits after `feat: game juice`.
  - Step 25: `server/game/ring.js` is a schedule (`matchRing`) + `ringRadius(ring, tick)` + `applyRingDamage`, run after hits so ties can be checked after ring damage. Snapshots carry the radius (`ring`); the client tints outside it. `START_RADIUS` is now derived from the arena so the ring starts just covering the corners, instead of spending ~10s invisible. HP is fractional (rounded to 2 decimals in snapshots).
  - Step 26: `server/game/modes/elimination.js` is the mode interface (`onStart`, `onTick`, `checkWinner`, plus `publicState` for extra snapshot fields); `Match` takes `mode`. A tie is everyone alive at the last check falling on one tick, after ring damage. Revive = clean slate through `match.revive` (input stream reset and lag comp history cleared, so nobody is hit at their old position). **Added beyond the plan's wording:** the sudden death ring keeps closing (200 → 0 over 20s), so a stall can't last. The deciding KO holds on screen for `MATCH.END_DELAY_TICKS` (1.5s); ring damage stops then. The match end goes out after the tick's snapshot. A match with nobody left to win gives `{ teamId: null }`.
  - Step 27: `server/game/balance.js` `teamBuffs(size, largest)` from team sizes at the start. Fighters carry `maxHp` (rounded) and `damageMult`; a sudden death revive stays at 1 HP. Snapshots carry `maxHp`, and the client shows 🐴 beside the nickname when it's above base.
  - Step 28: a decided match puts the room in state `results` with `result: { optionId }` (`rooms.finishMatch`), sent via `room:update`, so it's reliable, arrives after the last snapshot, and a rejoin lands on the same screen. The room stays locked until everyone has left (Back to home = `room:leave`); a crash still goes to the lobby (`rooms.endMatch`).
  - Step 29: `public/js/juice.js` (no DOM, tested under node) works out effects from snapshot changes: damage numbers (HP lost ≥ `JUICE.DAMAGE_MIN`, so the ring's burn floats nothing) and KO pops, timed to the interpolated view; screen shake from hits (others' hits at `SHAKE_OTHERS`) and KOs, offsetting the camera. The combo counter under a fighter reads `cs.combo` from the snapshot. No new server data.
  - Review fixes: a tie revives on the tick of the KO, so no snapshot shows the fighters dead; the client spots the new `suddenDeath` count and shows a KO where they stood (not a big hit), and others teleport instead of gliding. A revive keeps the input stream (seq, acks, held buttons), so a button held through it doesn't fire. `hurt()` in combat.js is the one place HP drops, and a float crumb of HP counts as a KO. Kept on purpose: shake isn't applied to `toWorld`, so mouse aim stays steady under the cursor; results rooms live until everyone has left or lost their seat.
  - Checked in headless Chromium (Playwright driving real pages against `npm run dev`; the Chrome extension wasn't connected). Idle 1v1, one desktop page and one phone-sized touch page: ring tint and burn, tie at ~90s, 5 sudden deaths ~7s apart with the notice and KO pop, random winner on both pages, reload lands back on results, Back to home. Solo vs 2 with real keyboard and mouse: 🐴 and 110 HP, damage 5.25/9.45, combo counter, KO pops, spectator view, natural win. No page errors (only a missing favicon 404). Not exercised: pressing touch buttons, parry and heavy in this flow, how the shake feels (stills can't show it), a real phone. Cosmetic: a KO pop near the view's edge can clip, and a sudden death KO appears at the old position, which can be near the screen edge.
  - **Tie cap (user decision):** two connected players who both do nothing tied at equal distance from the ring forever, so sudden death is capped at `RING.MAX_SUDDEN_DEATHS` (5). A tie after the fifth goes to a random tied team, equal odds per team. The results screen doesn't say it was random.
  - Checked in real Chrome (extension connected) against scripted bots, no page errors: lobby, reload on results, Back to home. Solo vs 2: 🐴 badge, lost to a KO. 2v2: parries stunned a hunter 4 times, a charge was interrupted by a hit, full arena spectator view after my KO, ring tint, ring burn ending the match. 1v1: jab string 5/5/9 with combo 1→2→3, full-charge heavy 22, won by KO. Idle 1v1 with the tie cap: both fighters down at sudden death 5 (t=3743, ~125s), resolved to a winner; that run's sudden death notice and results screen weren't seen (the numbers come from a bot's snapshot log, and it only logged the last sudden death). Movement, parry timing, jab strings and the heavy hold were scripted DOM events on the game's own handlers, not trusted input. Not exercised: a wall bounce in this flow, how the shake feels, the KO pop on screen, touch buttons, a real phone. 
  - Fix from that check: the camera stopped flush with the arena's edge, so a wall could be off screen and a name clipped. Both views now show `RENDER.EDGE_MARGIN` (90) past the edge, enough for the widest label (16 W's and 🐴, 236 units wide with Chrome's system font on this machine). Seen in Chrome: portrait and landscape in a corner, and the spectator view.
- **Milestone F (steps 30–32): done**, merged into `main` from `milestone-f-resilience`. Review pass done. Fixes are in the commits after `chore: bot clients script`. **All planned steps are built.**
  - Step 30: the server already kept a dropped fighter idle and hittable and KO'd it when grace ran out (`rooms.sweep` removes the player, `Match.step` flags the KO); `test/disconnect.test.js` now locks that in. New on the client: a `disconnected` tag above the name, read from the room's `connected` flag. It's a tag rather than a see-through body, because see-through means hits pass. The match screen keeps leavers in its player map, since the room drops them before the delayed view reaches their KO (they'd draw as a grey "?"). Kept on purpose: a heavy being charged at the moment of the drop fires once (the held button resets to released).
  - Step 31: SIGTERM → `announceShutdown` (`rooms.closing` refuses new rooms with `SERVER_RESTARTING`, `server:restarting` goes to everyone), then exit after `NET.SHUTDOWN_FLUSH_MS` so the warning actually leaves. `test/shutdown.test.js` checks this on a spawned server process. The client shows the warning as a banner, keeps it through the disconnect, and on reconnect says the room is gone instead of "you were away too long". Rejoining stays open, since a live room isn't affected in the moment before exit.
  - Step 32: `scripts/bots.js <code> <count>` joins as ordinary players (no server changes) and leaves when the match is decided, so a results room can still die. They spread over the options or take `--team`, chase the nearest enemy and use the whole kit. `--latency`/`--jitter` delay each direction in order (a websocket never reorders); `--origin` is for a deployed server. The first bot logs the server's tick time. The host still starts the match from a browser.
  - Fix before the review: bots walked straight into pillars. Sudden death spawns tied fighters either side of the center pillar, so a tied bot pair stalled until the ring closed (hanging a test). They now sidestep when stuck.
  - Review fixes: connect attempts time out at `NET.CONNECT_TIMEOUT_MS` (5s, default 20s: one hung handshake could outlast the grace; the reviewer reproduced a lost seat through a stalling proxy). `tryRejoin` returns `seated`/`retry`/`none`/the error: a link flap mid-rejoin now keeps retrying rather than showing "lost your seat", only the newest run acts, and leaving cancels it. A retried rejoin on the already seated socket gets its seat back rather than `ALREADY_IN_ROOM` (a lost answer used to retry forever). The seat-gone message comes from the error code (`ROOM_NOT_FOUND` = room gone, `BAD_TOKEN` = seat lost), so it holds even if the restart warning was missed, and `?room=` is cleared on that path.
  - Checked in headless Chromium (Playwright, 3 real pages against a spawned server): the tag appears on a drop and clears on reload-rejoin; a socket drop plus a cut rejoin frame recovers with no false seat loss; no grey "?" pixels in ~1290 scanned frames across a grace KO; after a grace KO a reload lands on home; the restart banner shows within ~10ms of SIGTERM and stays while the server is down, then home with "Your room is gone". No page errors. CLI load run: 9 bots (50ms ±15 per direction) + spectating host, full match in ~20s, tick avg ~0.5ms, max 2.8ms, 20 snapshots/s, ~59 KB/s per client, every combat state seen across two runs (the second on the final code). Not exercised: Render itself, a real phone, touch buttons.
- **Silent drops (user request, branch `silent-drop`):** a connection can die with no socket close, leaving a fighter untagged for 11–15s.
  - Snapshots carry `away` (no input for `NET.AWAY_TICKS`, 1s), drawn as a `lagging` tag; `disconnected` wins once the server knows. Grace and KO timing don't change.
  - The player's own client: `createLinkWatch` in `net.js` watches for snapshots stopping. After `NET.LINK_STALL_MS` (1s) it shows the "Connection lost" banner, stops predicting and stops sending inputs (no walking around a frozen world, no stale burst afterwards). After `NET.LINK_RECONNECT_MS` (3s) it closes the transport so socket.io reconnects, without waiting for the 11–15s ping timeout. The wait doubles per forced reconnect up to `LINK_RECONNECT_MAX_MS`, so a weak link gets time to finish a rejoin; a gap between the watch's own checks (frozen tab) doesn't count as silence. `main.js` derives the banner from `restarting`, `linkLost` and `stalled`.
  - Checked in headless Chromium through a websocket route that black-holes one connection: inputs cut → `lagging` for other players and no banner for the player, clears when inputs return; everything cut → banner at ~1.3s, new connection at ~3.8s, back in the match at ~3.9s, walking normally. No false banner or reconnect in 3.5s of healthy play. No page errors. Not run on a real phone or real network, and no review subagents (a small follow-up, not a milestone).
- **Open decisions from the F review (user's call):**
  - The reviewer read Render's docs as giving a 30s default shutdown window (up to 300s via `maxShutdownDelaySeconds`), and possibly traffic moving to the new instance 60s before SIGTERM. That contradicts "Render's shutdown window is short", the reason for not draining matches. Not tested on Render.
  - Lag comp cap: a real client uses 4 of the 6 rewind ticks at zero latency, so it saturates at ~67ms RTT, which suggests the 200ms cap covers less than the notes claim. Most cellular players would lead their targets.
- Review notes to handle in later steps:
  - Reliable discrete events must be tick-tagged inside the snapshot or emitted after it: a reliable emit just before the volatile snapshot can make every client drop that snapshot.
  - Expect small prediction corrections when the server merges or starves inputs.
  - Later/optional (from the D review): a snapshot is ~3.3 KB at 10 players (~65 KB/s per client); others' `cs` only needs state/t/len/dir/hitstop/charge. `INPUT_QUEUE_MAX` 2 may starve-then-merge on 50–100ms mobile jitter (consider 3). Between reconnect and rejoin, inputs count as sent but the server drops them (a brief replay of phantom inputs; the ack-backwards reset cleans it up). Launched targets could join the no-rewind set. Jab aim assist isn't predicted (the fist direction corrects on the next snapshot).
  - Later/optional: trim the input queue back to 1 when it sits at 2 (a late packet adds a permanent +33ms); shrink snapshots (omit zero knockback, send velocities only for your own fighter) once combat state doubles their size (~24 KB/s per client now).
- Known open items:
  - Capacity (F review): `tickMs` times only `step()`, about 5x under real server CPU (1.5% implied vs 7.8% measured for one full room). `maxMs` never resets and dropped ticks aren't reported. With a 5% CPU cap the sim fell to ~26 ticks/s and 12.6 snapshots/s. If Render free really is ~0.1 CPU (unconfirmed), one full room nearly fills it, `ROOM.MAX_ROOMS` 300 protects nothing, and running matches need a cap. First measure on Render: report `process.cpuUsage()` and `loop.droppedTicks`.
  - One open tab may keep the free server awake all month: per Render's docs, websocket traffic counts, and pongs flow every 10s even in hidden tabs (~744 of 750 free hours). Consider dropping the connection after a long hidden spell outside a room.
  - Catch-up ticks in one `update()` lose a snapshot: the second volatile write finds the transport busy (5 of 5 stalls in a test). Emit only on the batch's last tick. Predates F.
  - Render deploys: a player who blips in the window where traffic has moved lands on the new instance and loses a live match with no warning. Keep deploying when nobody's playing.
  - Bots as a network test: their delay sits above the socket, so no real volatile drops, TCP stalls or late heartbeats (use `tc netem` or a proxy for those), no reconnects, and they stamp the newest snapshot, not a render tick, so they under-rewind at low latency. Fine for load.
  - Verify Render passes `cf-connecting-ip` (otherwise the rate-limit IP falls back to the spoofable X-Forwarded-For). Log the headers once after the first deploy.
  - A real phone test on Render needs the user's account.
- **First Render deploy (branch `fix-wake-check`):** in Chrome, every cross-origin HTTP request from the static site to the server gets a 503 (curl and same-origin get 200; the cause wasn't pinned down, possibly connection reuse across the shared `*.onrender.com` cert and IPs), while websockets open fine. The wake check now falls back to a bare websocket open when `/health` fails. Then the client dropped `/health` and uses only the websocket probe (branch `ws-wake-probe`).
- **Touch layout change (user request, branch `touch-aim-stick`):** a floating aim stick on the right half replaces drag-to-aim; all four buttons sit top right (Parry Dash / Heavy Jab). Jab presses on touch, the rest are held. The debug overlay moved to top center.
- **Match UI rework (user request, branch `ui-camera-touch`):**
  - Camera: your fighter is always at the window's center (no clamping at the arena's edge; the void shows past the walls). Zoom is `RENDER.FIGHTER_SCREEN_SHARE`, the fighter's on-screen width as a share of the window's shorter side, so the shorter side always shows 600 world units at the default 0.1. Fighter size in the world is unchanged. Spectators and KO'd players keep the arena-fit view.
  - Aim stick: fixed in the lower right and always visible, grabbed by a touch within `TOUCH.AIM_CATCH_RADIUS`; the first touch counts at once. Other touches on the right side do nothing. The move stick still floats on the left half.
  - Buttons: an arc from 180° to 90° (`TOUCH.ARC_*`), left to right Dash, Heavy, Light, Parry, rising toward the top-right corner. "Light" is only the label: the code still calls it jab.
  - Review fixes: mouse aim is now the angle from the screen center to the cursor (`renderer.aimAngle` replaces `toWorld`). The old sum mixed last frame's camera with this tick's fighter, which swung aim up to 18° while walking with the cursor 30px away (measured; now 0°). It still ignores shake on purpose, and it can't produce a NaN on a zero-size canvas.
  - Checked in headless Chromium (Playwright, real pages against a spawned server): centering and size at 844×390, 1280×720, 1920×1080 and 600×900, including at a wall and while walking; mouse aim; the KO view fits the arena; at 844×390 and 568×320 the arc order and stick clearance; each button's bit; heavy held and light tapped; the stick's first touch, clamp, recenter and catch ring; stray right-side touches ignored; the left stick floating; three fingers at once. Lifting one finger of several was tested with pointer events fired into the page with capture stubbed, because the DevTools protocol couldn't lift just one. Finger comfort still needs a real phone; tune with `TOUCH.ARC_*` and the stick's inset in `style.css`.
  - Input fixes after the review (user request, both predate this branch):
    - A press made while KO'd, spectating or stalled stayed in the button latch and fired on the first input sent afterward. `sendTick` now samples input before its early returns. Reproduced with a real stall (Light and Dash both fired on recovery; now neither). The KO path shares that code but wasn't run separately: it needs a sudden death revive.
    - Touch controls now release on `lostpointercapture`, window blur and a hidden tab, so a missing up or cancel can't leave one held. The finger has to touch again afterward. The review's scenario (`.touch` hidden mid-touch) didn't stick in Chromium: the control releases when the finger lifts. No real stuck control was reproduced, so this is a safety net, and iOS Safari is untested.
  - Stuck stick with text highlighted on the ✕ (user report, phone, holding both sticks): the ✕, the sudden death notice and the rotate hint were selectable, so a long press could select the nearest text and take the finger. The whole `.match` now has selection and callouts off, and `.touch` cancels `touchstart`, which stops long-press gestures. Separately, a stick whose finger's lift went missing ignored new touches; now the newest finger on a control takes it over and the old finger's events stop counting (so a second finger on the left half moves the stick to it). The stuck stick was reproduced with fired pointer events, and is fixed. Headless Chromium doesn't run the long-press gesture, so the highlight itself still needs confirming on the phone.
- **Button diamond (user request, branch `touch-diamond`):** the arc is replaced by an askew diamond at explicit offsets (`TOUCH.BUTTON_SPOTS`). Heavy and Light stay where the arc had them, Dash is directly left of Heavy and Parry directly left of Light. Rows are 100 apart rather than a true rhombus's 88, which would leave Parry and Heavy only 3px apart (now about 9px).
- **Button spacing (user request, branch `touch-buttons-closer`):** Parry and Dash moved closer to Light and Heavy (72 to the left, not 100) and half a button higher (32). Heavy and Light didn't move. Parry's top edge is now 3px from the top of the screen at the default 12px safe-area margin.

Update this section after every step.

## Context
Friend groups argue about where to eat, which movie is best, and so on. Voting is boring, and the loudest people win. i-d-KO settles it with a quick top-down team brawler. Each option ("Tacos", "Sushi"…) is a team, players pick the option they're fighting for, and the last team standing is the decision. The design should reward skill (combos, parries, spacing), but a dark-horse mechanic keeps a heavily outnumbered team in the fight. Started greenfield on 2026-10-29.

**Stack:** Node.js 22 + socket.io game server. Vanilla JS ES modules + HTML canvas client. No framework, no bundler, no DB.
**Hosting (Render free tier, 2 services):** the client (`public/` + `shared/`) is a **Render Static Site** (CDN, never sleeps). The game server is a **free Web Service** (sleeps, cold starts). The server allows CORS for the static-site origin. `autoDeploy: false`, so pushes don't kill live matches. One region, the closest to the group.

## Settled design

### Sessions & lobby
- No accounts. Host creates a room and gets a 4-char code (no 0/O/1/I). Others join with code + **unique** nickname. All state is in memory.
- **Max 10 players.** The room **locks on start** (except for rejoin tokens).
- Join attempts are rate-limited per IP (anti brute-force).
- Any player can add options (2–10; ≤ 20 chars; case-insensitive dedupe). The host can remove options. Each option gets a distinct team color.
- Free team picking in the lobby. At start, options with 0 players are dropped. At least 2 populated teams are needed.
- **Rejoin:** a random token is issued at join and stored in `sessionStorage`. Grace is **60s in the lobby, 20s mid-match**. In a match, the circle stays idle and hittable during grace, shows a disconnected indicator so nobody reads it as AFK, and when grace runs out it's a KO. A room is deleted only when it's empty and nobody is in grace.
- **Host migration:** host = earliest joiner still connected. Migrates when the host's grace runs out (not on a socket blip). If the old host rejoins, they don't get host back. Host-only actions check host status when the server handles them.
- **Waking server:** the static client loads instantly, probes the game server with a bare websocket handshake ("Waking server…" UI), then connects. Clients probe again every ~5 min while open, in case traffic on a long-lived WebSocket doesn't count against the idle timer. Not `/health`: on Render, Chrome gets a 503 on cross-origin HTTP to the server; `/health` stays for Render's health check.
- **Shutdown:** on SIGTERM, stop creating rooms, emit `server:restarting` so clients can warn players, and exit right away (no waiting for live matches to finish: Render's shutdown window is short and most would be cut off anyway). Documented as a known limitation (in-memory rooms are lost on restart).

### Match (default mode: Elimination)
- One life, single round, shrinking ring. It starts closing at ~45s and fully closes by ~2:30. Outside the ring = damage over time.
- **Arena:** walled rectangle + 3–5 solid pillars (wall bounces, line-of-sight breaks).
- **Friendly fire:** knockback only.
- **Ties** (last players of all remaining teams die on the same tick, checked **after** the ring damage step): instant sudden death. The tied players revive at 1 HP in a tiny ring, and the first hit wins. Repeat if tied again, up to 5 sudden deaths; a tie after that goes to a random tied team.
- **Results:** the winner reveal only, then back to home.
- Mode interface (`onStart`, `onTick`, `checkWinner`) so more modes can be added later.

### Dark horse balancing
- A team is a dark horse if its size is ≤ 50% of the largest team. Per player it's short vs. the largest team: **+10% HP, +5% damage**, capped at **+40% / +20%**. 🐴 badge.

### Combat (shared kit; all frame data in **ticks** at 30 Hz, in `shared/constants.js`)
| Input | Behavior |
|---|---|
| **Jab** | 3-hit string, and the 3rd hit knocks back. Tap = auto-aim (nearest enemy in a ~60° facing cone). Drag = manual aim. |
| **Heavy** | Drag to aim, hold to charge, release to fire. A charged hit launches the target; hitting a wall or pillar = wall bounce. |
| **Dash** | Tap, in the joystick direction. Cancels jab recovery (not heavy: a heavy commits you). 2s cooldown, fully recharged by landing all 3 jabs of a string on enemies. Swept collision so it can't tunnel through pillars. |
| **Parry** | Tap. 3–4 tick active window, and a successful parry stuns the attacker. Whiff = punishable recovery. |

- **Anti-infinite:** hitstun decays per hit in a combo. After ~1.5s (45 ticks) of continuous combo the victim **bursts** out with brief invulnerability.
- **Input buffer:** actions are buffered for 5 ticks on the server and in the shared state machine, so an early dash or jab fires when the window opens (dash-cancel playable at mobile RTT).
- **Hitstop is in the simulation:** it freezes the involved players' state timers on the server and in prediction. Screen shake and damage numbers are client-only juice.

### Controls
- **Mobile (primary):** floating move stick on the left half, fixed aim stick lower right, an askew diamond of buttons top right (Parry and Light (jab) above, Dash and Heavy below). Touches are tracked by pointer id. Landscape prompt.
- **Desktop:** WASD, mouse aim, LMB jab, RMB-hold heavy, Space dash, Shift parry.

### Netcode
- **Transport:** socket.io with `transports: ['websocket']` on both ends, and `perMessageDeflate: false` set explicitly. Snapshots go out via `volatile.emit`. Discrete events (KO, match end, sudden death) are reliable emits, or tick-tagged inside snapshots.
- **Loop:** one global loop for all rooms. Accumulator on `performance.now()`, fixed 30 Hz sim, max 3 catch-up ticks (the rest are dropped). Each room's tick is wrapped in try/catch (a failing room is ended, not the process). Tick duration is measured per room.
- **Snapshots at 20 Hz:** encoded **once per room** and broadcast. Contents: tick, all players' public state, an `acks: {playerId: lastSeq}` map, and the **full combat state** for every player (state, ticks remaining, knockback velocity, hitstop).
- **Inputs:** `{seq, tick (server tick the client was viewing), move, aim, buttons}`. Validation: finite numbers, |move| ≤ 1, seq strictly increasing, capped send rate. The per-player queue keeps 1–2 ticks of buffer, and when there's excess the inputs are merged by OR-ing button edges and the rest dropped.
- **Clock:** the client estimates the server tick from snapshots (smoothed) and runs its own fixed 30 Hz step, not rAF-driven.
- **Prediction:** the own player is predicted through `shared/physics.js` **plus the shared combat state machine** (`shared/combat-state.js`), so hitstun, knockback, dash and hitstop predict correctly. Reconcile from the acked seq by replaying through that state machine. Small errors are smoothed out, large ones snap. Hit *detection* stays server-only. Player-player body collision isn't predicted. "Shared, not bit-exact": fixed dt and fixed collision order.
- **Interpolation:** other players render behind real time with an adaptive delay of 100–200ms based on measured jitter, extrapolating for up to 2 missing snapshots.
- **Lag compensation:** rewinds **positions only** (never combat state). The input tick is clamped to [now − 200ms, now] (raised from 100ms with the user: the client's view is always ≥100ms old from interpolation alone, so 100ms compensated no network latency), never goes backwards and advances at most `MAX_STAMP_STEP` per input. Targets that are dashing, parrying or bursting *now* are never rewound. Parry is judged on the server timeline with a **2-tick grace window** (a parry input stamped up to 2 ticks before a hit landed still wins).

## File layout
`[x]` = exists, `[ ]` = planned.
```
[x] package.json             socket.io; start/dev/test scripts; engines node 22.x
[x] render.yaml              static site (client) + free web service (server), autoDeploy false, Node pinned
[x] scripts/build-static.js  public/ + shared/ + socket.io client -> dist/, injects GAME_SERVER_URL
[x] server/index.js          http + socket.io (websocket only, Origin check, 8KB payloads, fast ping), /health, local static
[x] server/rooms.js          pure room state: codes, tokens, nicknames, options/teams, grace, host migration, lock
[x] server/socket.js         socket event wiring, per-IP join limits, per-socket event limit, one socket per player
[x] server/loop.js           global accumulator loop, per-room try/catch + tick timing
[x] server/game/match.js     input queue/validation, spawns, sim step, 20 Hz snapshot broadcast
[x] server/game/combat.js    hit detection + resolution (uses shared/combat-state.js), friendly knockback
[x] server/game/lagcomp.js   position history + rewind rules (parry grace lives in combat.js)
[x] shared/arena.js         walls, pillars, swept collision, wall-bounce reflection (shared: prediction needs it)
[x] server/game/ring.js      shrink schedule + outside damage
[x] server/game/balance.js   dark-horse multipliers
[x] server/game/modes/elimination.js   win check, tie -> sudden death
[x] shared/constants.js      every tunable: ticks, frame data, room limits, ring, balance, net
[x] shared/physics.js        shared movement/dash step (fixed dt, ordered collisions), server-only body separation
[x] shared/combat-state.js   state machine timing: states, timers, input buffer, hitstop, hitstun decay, burst
[x] public/index.html        app shell; loads config.js + js/main.js
[x] public/config.js         GAME_SERVER_URL (overwritten at static build)
[x] public/js/main.js        screen state machine (waking/home/lobby/match/moved), rejoin flow
[x] public/js/connection.js  socket connect, call() with offline fail-fast, wake/keep-awake, session token
[x] public/js/ui/dom.js      h() element builder, logo(), error text table
[x] public/js/ui/home.js     nickname + create/join
[x] public/js/ui/lobby.js    options, team picking, host controls, share link
[x] public/js/net.js         clock estimate, prediction/reconciliation, adaptive interpolation
[x] public/js/render.js      circles w/ option names, fists, ring, pillars, juice
[x] public/js/juice.js       client-only effects from snapshot changes: damage numbers, KO pops, shake
[x] public/js/ui/match.js    match screen: canvas, latest snapshot -> view, leave button
[x] public/js/ui/results.js  winner reveal, back to home
[x] public/js/debug.js       overlay: RTT, snapshot gap, correction size, server tick time
[x] public/js/input/touch.js move stick (left half) + fixed aim stick (lower right) + top-right button diamond (Jab taps; facing follows the aim stick, else the move stick)
[x] public/js/input/desktop.js keyboard + mouse
[x] test/*.test.js           node:test (helpers.js: startServer, call, nextEvent)
[x] scripts/bots.js          headless bots with simulated latency
```

## Build order (one atomic commit per step, on a branch per milestone)
Each step ends with `npm test` passing and the app runnable, then a focused commit. Nothing is pushed unless asked.
1. [x] `chore: scaffold node project` — package.json, .gitignore, socket.io server with /health, empty client.
2. [x] `feat: shared constants` — shared/constants.js.
3. [x] `feat: room creation, joining, rejoin tokens` — rooms.js + tests.
4. [x] `feat: lobby options and team picking` — + tests.
5. [x] `feat: host migration and grace periods` — + tests.
6. [x] `feat: home and lobby UI` — main.js, ui/lobby.js, waking-server screen.
7. [x] `chore: render deployment config` — render.yaml (static site + web service, autoDeploy false), README deploy notes. Smoke test on a phone.
8. [x] `feat: global fixed-tick loop` — loop.js + tests.
9. [x] `feat: arena with walls and pillars` — shared/arena.js, swept collision + tests.
10. [x] `feat: shared movement physics` — shared/physics.js + tests.
11. [x] `feat: match loop, input validation, snapshots` — match.js (20 Hz, encode once, acks map).
12. [x] `feat: canvas renderer` — render.js, ui/match.js (camera follows you, fits the arena for spectators).
13. [x] `feat: desktop input`.
14. [x] `feat: touch controls` — joystick + drag-aim, landscape prompt.
15. [x] `feat: debug overlay`. `?debug` or the backquote key. Server tick time rides in one snapshot per second; RTT via `net:ping`.
16. [x] `feat: shared combat state machine` — combat-state.js (timers, buffer, hitstop) + tests.
17. [x] `feat: jab string and hit resolution` — combat.js, auto/manual aim, friendly knockback.
18. [x] `feat: heavy charge, launch, wall bounce`.
19. [x] `feat: dash and dash-cancel`.
20. [x] `feat: parry`.
21. [x] `feat: hitstun decay and combo burst` — + tests.
22. [x] `feat: client prediction and reconciliation` — net.js using physics + combat-state + replay tests.
23. [x] `feat: adaptive interpolation and clock sync`.
24. [x] `feat: lag compensation` — lagcomp.js (positions only, parry grace) + tests.
25. [x] `feat: shrinking ring` — + tests.
26. [x] `feat: elimination mode and sudden death` — + tests (tie after ring damage).
27. [x] `feat: dark horse balancing` — + badge + tests.
28. [x] `feat: results screen`.
29. [x] `feat: game juice` — shake, damage numbers, combo counter.
30. [x] `feat: mid-match disconnect handling` — idle hittable circle with a disconnected indicator (user decision; the client already gets each player's `connected` flag), KO when grace runs out.
31. [x] `feat: graceful shutdown` — SIGTERM → stop creating rooms, `server:restarting` → client warns players, exit right away (user decision).
32. [x] `chore: bot clients script` — scripts/bots.js with latency injection. Developer testing tool only (user decision): run by hand from the command line, connecting like ordinary players. Players can't add bots: no bot UI and no bot-specific server code.

## Review checkpoints
After each major milestone, stop implementing and run three review subagents in parallel over the code built so far (focused on that milestone's diff):
1. **Simplify agent** (general-purpose): reduce complexity, remove duplication and dead code, and simplify wherever behavior stays the same.
2. **Bug agent** (general-purpose, `model: sonnet`): find correctness bugs, edge cases and crashes, each with a concrete failure scenario.
3. **Networking agent** (general-purpose, when the milestone touches the network): act as a multiplayer game-server network designer and check transport, sync, prediction, lag comp, validation and room lifecycle.

Then verify each finding, apply the real ones as their own atomic commits (`refactor: …` / `fix: …`), confirm `npm test` passes, and give the user a short summary before continuing.

| Milestone | After step | Networking agent? |
|---|---|---|
| A. Lobby + rooms + deploy config | 7 | yes |
| B. Match loop, arena, rendering, input | 15 | yes |
| C. Combat kit | 21 | no (combat logic only) |
| D. Prediction, interpolation, lag comp | 24 | yes |
| E. Ring, modes, balance, results, juice | 29 | no |
| F. Disconnects, shutdown, bots | 32 | yes |

## Verification
- **Unit tests** (`npm test`): rooms/rejoin/host migration, dark-horse formula, combat state transitions (input buffer, dash-cancel, parry + grace, hitstop, hitstun decay → burst), swept collision, ring, ties → sudden death, reconciliation replay, lag-comp rewind rules, input validation (NaN rejection, queue merging).
- **Local:** `npm start` + serve `public/`, then several tabs (one in DevTools mobile emulation). Play a full flow: create → join → options → teams → fight → winner.
- **Network:** `tc netem` on loopback (latency + jitter + loss) and bots with injected latency. Watch the debug overlay for correction sizes and tick time.
- **Load:** `node scripts/bots.js <code> 9` fills a room to 10. Check per-room tick time against the free-tier CPU budget.
- **Deployed:** from step 7 on, test the cold start (static page loads instantly, waking screen, connect) and real matches on two phones over cellular.
