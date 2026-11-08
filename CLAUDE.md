# i-d-KO

Friend groups settle disagreements (dinner, movies, hot takes) by fighting instead of voting. Each option is a team, players pick the option they're fighting for, and the last team standing is the decision. Top-down team brawler (Brawl Stars-like). Characters are circles labeled with the option name, with little fists.

## Product rules (settled with the user, don't change without asking)
- No accounts and no DB. A host creates a room with a 4-char code, and friends join with a unique nickname. Max 10 players. The room locks when the match starts.
- Anyone adds options (2–10). The host removes options and starts. Options nobody picked are dropped at start, and unassigned players spectate.
- One life, one round, shrinking ring. Decisions should be quick. More game modes may come later, so keep mode logic pluggable (`Match` takes a `mode`; the interface is in `server/game/modes/elimination.js`).
- A tie goes to sudden death, up to 5 times. A tie after that goes to a random tied team, and the results screen doesn't say it was random.
- Majority advantage stays, but a heavily outnumbered team is a "dark horse" with small, capped HP/damage buffs.
- Combat is about combos and skill expression: jab string, charged heavy with wall bounces, dash-cancel, parry. Hitstun decays over a combo and ends in a burst, so there are no infinites. Friendly fire is knockback only.
- Mobile-first touch controls (floating move stick on the left half, floating aim stick on the right half, a diamond of action buttons top right), with desktop controls too.

## Stack
- Node 22 + socket.io server (`server/`), plain `node:http`, no Express.
- Vanilla JS ES modules + canvas client (`public/`). No framework, no bundler.
- `shared/` is imported by both sides. Every tunable number goes in `shared/constants.js`, with durations in ticks.
- Server-authoritative 30 Hz sim. Clients send inputs only, and predict their own player.

## Commands
```sh
npm run dev   # localhost:3000, server also serves public/, shared/, /vendor (socket.io client)
npm test      # node --test "test/**/*.test.js"
node scripts/bots.js <code> <count>   # fills a room with bots (flags in the file header); start the match from a browser
```
`test/helpers.js` has `startServer(t)`, `call()` and `nextEvent()` for socket tests, and `fakeMatch()` and `startedMatch(t)` for match tests.

## Hosting (Render free tier)
- Two services in `render.yaml`: the client is a static site (never sleeps) and the server is a free web service (sleeps, cold starts in 30–60s). The client shows a waking-up message while it probes the server with a bare websocket (browsers can get a 503 on cross-origin HTTP to it; `/health` is for Render's health check and curl).
- `autoDeploy: false` on purpose: rooms live in memory, so a deploy kills live matches.
- Env vars: `GAME_SERVER_URL` (client build) and `CLIENT_ORIGIN` (server, required in production). Websocket Origin is enforced via `allowRequest`, because CORS doesn't cover upgrades.

## Conventions
- `server/rooms.js` is pure state (no sockets) and returns `{ error: 'CODE' }` on failure. `server/socket.js` wires the events. Client error text lives in `public/js/ui/dom.js`.
- Never trust the client: clean text with `cleanText`, rate-limit events, and validate every input.
- The client `call()` fails fast when offline. Don't let socket.io buffer emits.
- `stepFighter` in `shared/combat-state.js` is the per-tick unit for both the server and prediction, so movement and combat timing changes go there. Hit detection is server-only.
- Snapshots are volatile emits, and a reliable event in the same tick goes out after the snapshot, because a reliable emit just before one can make clients drop it. Inputs are plain emits, because a volatile emit is dropped while a write is in flight.
- `public/js/net.js` and `public/js/juice.js` stay free of the DOM, so they can be tested under node.
- Touch buttons say "Light", but the code calls that move jab.

## Testing in a browser
- Check UI and netcode changes on real pages against a running server, using Claude in Chrome or Playwright. Playwright isn't a project dependency, so keep it and its scripts out of the repo.
- Touch feel and long-press behavior need a real phone, which only the user can test. Headless browsers don't run the long-press gesture.

## Workflow the user wants
- Build in small steps with one atomic commit each (`feat:`, `fix:`, `refactor:`, `chore:`). Don't push unless asked.
- Commit to the current branch, including `main`. Only create a branch when the user asks for one, whether for a small change or a milestone. Don't merge into `main` unless asked.
- After each major milestone, stop and run the review subagents: simplify, bug check (Sonnet), networking (when relevant), and game tester (Sonnet, when gameplay changed: judges, critiques and suggests improvements to movement, teamplay and attacks/combos). Each report stays under 300 words. Apply the verified simplify/bug/networking findings as separate commits; summarize the game tester's suggestions for the user without applying them, since they're design calls. Small follow-ups skip the review.
- `PLAN.md` holds the full design and its **Progress** section. All planned milestones are built, so new work is user requests and fixes. Give each one a Progress entry saying what changed, what was checked and what wasn't.
- Before changing behavior that looks wrong, search Progress for "kept on purpose" and "user decision". Its open decisions are the user's call.
