# i-d-KO

Friend groups settle disagreements (dinner, movies, hot takes) by fighting instead of voting. Each option is a team, players pick the option they're fighting for, and the last team standing is the decision. Top-down team brawler (Brawl Stars-like). Characters are circles labeled with the option name, with little fists.

## Product rules (settled with the user, don't change without asking)
- No accounts and no DB. A host creates a room with a 4-char code, and friends join with a unique nickname. Max 10 players. The room locks when the match starts.
- Anyone adds options (2–10). The host removes options and starts. Options nobody picked are dropped at start, and unassigned players spectate.
- One life, one round, shrinking ring. Decisions should be quick. More game modes may come later, so keep mode logic pluggable.
- Majority advantage stays, but a heavily outnumbered team is a "dark horse" with small, capped HP/damage buffs.
- Combat is about combos and skill expression: jab string, charged heavy with wall bounces, dash-cancel, parry. Hitstun decays over a combo and ends in a burst, so there are no infinites. Friendly fire is knockback only.
- Mobile-first touch controls (joystick + drag-to-aim buttons), with desktop controls too.

## Stack
- Node 22 + socket.io server (`server/`), plain `node:http`, no Express.
- Vanilla JS ES modules + canvas client (`public/`). No framework, no bundler.
- `shared/` is imported by both sides. Every tunable number goes in `shared/constants.js`, with durations in ticks.
- Server-authoritative 30 Hz sim. Clients send inputs only, and predict their own player.

## Commands
```sh
npm run dev   # localhost:3000, server also serves public/, shared/, /vendor (socket.io client)
npm test      # node --test "test/**/*.test.js"
```
`test/helpers.js` has `startServer(t)`, `call()` and `nextEvent()` for socket tests.

## Hosting (Render free tier)
- Two services in `render.yaml`: the client is a static site (never sleeps) and the server is a free web service (sleeps, cold starts in 30–60s). The client shows "Waking server…" while it polls `/health`.
- `autoDeploy: false` on purpose: rooms live in memory, so a deploy kills live matches.
- Env vars: `GAME_SERVER_URL` (client build) and `CLIENT_ORIGIN` (server, required in production). Websocket Origin is enforced via `allowRequest`, because CORS doesn't cover upgrades.

## Conventions
- `server/rooms.js` is pure state (no sockets) and returns `{ error: 'CODE' }` on failure. `server/socket.js` wires the events. Client error text lives in `public/js/ui/dom.js`.
- Never trust the client: clean text with `cleanText`, rate-limit events, and validate every input.
- The client `call()` fails fast when offline. Don't let socket.io buffer emits.

## Workflow the user wants
- Build in small steps with one atomic commit each (`feat:`, `fix:`, `refactor:`, `chore:`). Don't push unless asked.
- After each major milestone, stop and run three review subagents: simplify, bug check (Sonnet), and networking (when relevant). Then apply the verified findings as separate commits and summarize for the user.
- The full build order and milestones are in the plan file `~/.claude/plans/1-yes-top-down-silly-rossum.md`.
