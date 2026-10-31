# i-d-KO — Decision Brawler

## Progress
- **Milestone A (steps 1–7): done.** Review pass done. Fixes are in the commits after `chore: render deployment config`.
- **Milestone B in progress.** Steps 8–9 done. **Next: step 10** (`feat: shared movement physics`).
  - Deviation: the arena lives in `shared/arena.js` (not `server/game/`), because client prediction collides with pillars too.
- Known open items:
  - SIGTERM handling is step 31.
  - Verify Render passes `cf-connecting-ip` (otherwise the rate-limit IP falls back to the spoofable X-Forwarded-For). Log the headers once after the first deploy.
  - A real phone test on Render needs the user's account.

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
- **Rejoin:** a random token is issued at join and stored in `sessionStorage`. Grace is **60s in the lobby, 20s mid-match**. In a match, the circle stays idle and hittable during grace, and when grace runs out it's a KO. A room is deleted only when it's empty and nobody is in grace.
- **Host migration:** host = earliest joiner still connected. Migrates when the host's grace runs out (not on a socket blip). If the old host rejoins, they don't get host back. Host-only actions check host status when the server handles them.
- **Waking server:** the static client loads instantly, polls the game server's `/health` with "Waking server…" UI, then connects. Clients ping `/health` every ~5 min while open, in case WebSocket traffic doesn't count against the idle timer.
- **Shutdown:** on SIGTERM, stop creating rooms and emit `server:restarting` to clients. Documented as a known limitation (in-memory rooms are lost on restart).

### Match (default mode: Elimination)
- One life, single round, shrinking ring. It starts closing at ~45s and fully closes by ~2:30. Outside the ring = damage over time.
- **Arena:** walled rectangle + 3–5 solid pillars (wall bounces, line-of-sight breaks).
- **Friendly fire:** knockback only.
- **Ties** (last players of all remaining teams die on the same tick, checked **after** the ring damage step): instant sudden death. The tied players revive at 1 HP in a tiny ring, and the first hit wins. Repeat if tied again.
- **Results:** the winner reveal only, then back to home.
- Mode interface (`onStart`, `onTick`, `checkWinner`) so more modes can be added later.

### Dark horse balancing
- A team is a dark horse if its size is ≤ 50% of the largest team. Per player it's short vs. the largest team: **+10% HP, +5% damage**, capped at **+40% / +20%**. 🐴 badge.

### Combat (shared kit; all frame data in **ticks** at 30 Hz, in `shared/constants.js`)
| Input | Behavior |
|---|---|
| **Jab** | 3-hit string, and the 3rd hit knocks back. Tap = auto-aim (nearest enemy in a ~60° facing cone). Drag = manual aim. |
| **Heavy** | Drag to aim, hold to charge, release to fire. A charged hit launches the target; hitting a wall or pillar = wall bounce. |
| **Dash** | Tap, in the joystick direction. Cancels jab/heavy recovery. Cooldown. Swept collision so it can't tunnel through pillars. |
| **Parry** | Tap. 3–4 tick active window, and a successful parry stuns the attacker. Whiff = punishable recovery. |

- **Anti-infinite:** hitstun decays per hit in a combo. After ~1.5s (45 ticks) of continuous combo the victim **bursts** out with brief invulnerability.
- **Input buffer:** actions are buffered for 5 ticks on the server and in the shared state machine, so an early dash or jab fires when the window opens (dash-cancel playable at mobile RTT).
- **Hitstop is in the simulation:** it freezes the involved players' state timers on the server and in prediction. Screen shake and damage numbers are client-only juice.

### Controls
- **Mobile (primary):** left virtual joystick. Right side: Jab and Heavy (drag-aim), Dash, Parry. Touches are tracked by `identifier`. Landscape prompt.
- **Desktop:** WASD, mouse aim, LMB jab, RMB-hold heavy, Space dash, Shift parry.

### Netcode
- **Transport:** socket.io with `transports: ['websocket']` on both ends, and `perMessageDeflate: false` set explicitly. Snapshots go out via `volatile.emit`. Discrete events (KO, match end, sudden death) are reliable emits, or tick-tagged inside snapshots.
- **Loop:** one global loop for all rooms. Accumulator on `performance.now()`, fixed 30 Hz sim, max 3 catch-up ticks (the rest are dropped). Each room's tick is wrapped in try/catch (a failing room is ended, not the process). Tick duration is measured per room.
- **Snapshots at 20 Hz:** encoded **once per room** and broadcast. Contents: tick, all players' public state, an `acks: {playerId: lastSeq}` map, and the **full combat state** for every player (state, ticks remaining, knockback velocity, hitstop).
- **Inputs:** `{seq, tick (server tick the client was viewing), move, aim, buttons}`. Validation: finite numbers, |move| ≤ 1, seq strictly increasing, capped send rate. The per-player queue keeps 1–2 ticks of buffer, and when there's excess the inputs are merged by OR-ing button edges and the rest dropped.
- **Clock:** the client estimates the server tick from snapshots (smoothed) and runs its own fixed 30 Hz step, not rAF-driven.
- **Prediction:** the own player is predicted through `shared/physics.js` **plus the shared combat state machine** (`shared/combat-state.js`), so hitstun, knockback, dash and hitstop predict correctly. Reconcile from the acked seq by replaying through that state machine. Small errors are smoothed out, large ones snap. Hit *detection* stays server-only. Player-player body collision isn't predicted. "Shared, not bit-exact": fixed dt and fixed collision order.
- **Interpolation:** other players render behind real time with an adaptive delay of 100–200ms based on measured jitter, extrapolating for up to 2 missing snapshots.
- **Lag compensation:** rewinds **positions only** (never combat state). The input tick is clamped to [now − 100ms, now]. Targets that are dashing, parrying or bursting *now* are never rewound. Parry is judged on the server timeline with a **2-tick grace window** (a parry input stamped up to 2 ticks before a hit landed still wins).

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
[ ] server/game/match.js     input queue/validation, sim step, 20 Hz snapshot encode+broadcast, position history
[ ] server/game/combat.js    hit detection + resolution (uses shared/combat-state.js), friendly knockback
[ ] server/game/lagcomp.js   position rewind rules
[x] shared/arena.js         walls, pillars, swept collision, wall-bounce reflection (shared: prediction needs it)
[ ] server/game/ring.js      shrink schedule + outside damage
[ ] server/game/balance.js   dark-horse multipliers
[ ] server/game/modes/elimination.js   win check, tie -> sudden death
[x] shared/constants.js      every tunable: ticks, frame data, room limits, ring, balance, net
[ ] shared/physics.js        shared movement/dash step (fixed dt, ordered collisions)
[ ] shared/combat-state.js   state machine timing: states, timers, input buffer, hitstop, hitstun decay, burst
[x] public/index.html        app shell; loads config.js + js/main.js
[x] public/config.js         GAME_SERVER_URL (overwritten at static build)
[x] public/js/main.js        screen state machine (waking/home/lobby/match/moved), rejoin flow
[x] public/js/connection.js  socket connect, call() with offline fail-fast, wake/keep-awake, session token
[x] public/js/ui/dom.js      h() element builder, logo(), error text table
[x] public/js/ui/home.js     nickname + create/join
[x] public/js/ui/lobby.js    options, team picking, host controls, share link
[ ] public/js/net.js         clock estimate, prediction/reconciliation, adaptive interpolation
[ ] public/js/render.js      circles w/ option names, fists, ring, pillars, juice
[ ] public/js/debug.js       overlay: RTT, snapshot gap, correction size, server tick time
[ ] public/js/input/touch.js joystick + drag-aim buttons
[ ] public/js/input/desktop.js keyboard + mouse
[x] test/*.test.js           node:test (helpers.js: startServer, call, nextEvent)
[ ] scripts/bots.js          headless bots with simulated latency
```

## Build order (one atomic commit per step, on `main`)
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
10. `feat: shared movement physics` — shared/physics.js + tests.
11. `feat: match loop, input validation, snapshots` — match.js (20 Hz, encode once, acks map).
12. `feat: canvas renderer` — render.js.
13. `feat: desktop input`.
14. `feat: touch controls` — joystick + drag-aim, landscape prompt.
15. `feat: debug overlay`.
16. `feat: shared combat state machine` — combat-state.js (timers, buffer, hitstop) + tests.
17. `feat: jab string and hit resolution` — combat.js, auto/manual aim, friendly knockback.
18. `feat: heavy charge, launch, wall bounce`.
19. `feat: dash and dash-cancel`.
20. `feat: parry`.
21. `feat: hitstun decay and combo burst` — + tests.
22. `feat: client prediction and reconciliation` — net.js using physics + combat-state + replay tests.
23. `feat: adaptive interpolation and clock sync`.
24. `feat: lag compensation` — lagcomp.js (positions only, parry grace) + tests.
25. `feat: shrinking ring` — + tests.
26. `feat: elimination mode and sudden death` — + tests (tie after ring damage).
27. `feat: dark horse balancing` — + badge + tests.
28. `feat: results screen`.
29. `feat: game juice` — shake, damage numbers, combo counter.
30. `feat: mid-match disconnect handling` — idle hittable circle, KO when grace runs out.
31. `feat: graceful shutdown` — SIGTERM → `server:restarting`.
32. `chore: bot clients script` — scripts/bots.js with latency injection.

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
