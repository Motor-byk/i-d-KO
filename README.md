# i-d-KO

Can't decide where to eat? Fight about it. Each option is a team, everyone picks a side, and the last team standing wins the decision.

Top-down team brawler: Node.js + socket.io authoritative server, vanilla JS + canvas client. No accounts and no database.

## How to play

1. The host creates a room and shares its 4-letter code. Friends join with a nickname (up to 10 players).
2. Anyone adds options (2–10), and everyone picks the one they're fighting for. The host can remove options.
3. The host starts the match. The room locks, options nobody picked are dropped, and anyone without a team spectates.
4. Everyone has one life and the ring shrinks. The last team standing wins, and its option is the decision. A tie goes to sudden death.

The bigger team has the edge, but a heavily outnumbered team is a "dark horse" with a small HP and damage boost. Friendly fire only knocks back.

### Controls

| | Desktop | Mobile |
|---|---|---|
| Move | WASD / arrow keys | Drag anywhere on the left half |
| Aim | Mouse | Drag anywhere on the right half |
| Light | Left click / C | Tap while aiming |
| Spin | X | Tap Light without aiming |
| Heavy | Right click / V, hold to charge | Hold to charge |
| Dash | Space, in the direction you're moving | Tap |
| Parry | Shift, just before a hit lands | Tap |


## Run locally

```sh
npm install
npm run dev        # http://localhost:3000 (server also serves the client locally)
npm test
```

Open a few tabs (use DevTools device emulation for touch) and join the same room code.

To fill a room without more tabs, create it in a browser and add its options, then run:

```sh
node scripts/bots.js <code> 9 --latency=50 --jitter=15   # latency and jitter are per direction, in ms
```

Bots play like ordinary players and leave when the match is decided. You start the match from the browser.

## Project layout

| Path | What's in it |
|---|---|
| `server/` | `node:http` + socket.io server: rooms, socket events, the 30 Hz match loop, game modes |
| `public/` | Canvas client: rendering, input (keyboard/mouse and touch sticks), prediction, UI screens |
| `shared/` | Code both sides import: tunable constants, arena, physics and the per-tick fighter step |
| `scripts/bots.js` | Fills a room with bot players for load and network testing |
| `test/` | `node --test` suites |

`PLAN.md` has the full design and a progress log.

## Deploy (Render, free tier)

The repo has a `render.yaml` Blueprint with two services:

| Service | Type | Why |
|---|---|---|
| `idko-server` | Free web service | Game server. Sleeps after ~15 min idle and cold-starts in 30–60s. |
| `idko-client` | Static site | Loads instantly even while the server sleeps and shows a "Waking server…" screen. |

1. Push the repo to GitHub.
2. In Render: **New → Blueprint**, then pick the repo.
3. Fill in the two `sync: false` env vars when prompted:
   - `idko-client` → `GAME_SERVER_URL` = the server URL, e.g. `https://idko-server.onrender.com`
   - `idko-server` → `CLIENT_ORIGIN` = the client URL, e.g. `https://idko-client.onrender.com`
4. Share the client URL with your friends.

**Auto-deploy is off.** All rooms live in server memory, so any deploy or restart ends matches in progress. Deploy manually with **Manual Deploy** when nobody is playing.

**Known limitation: a restart loses every room.** On SIGTERM the server stops creating rooms, warns connected clients and exits right away, without waiting for live matches. Players see the warning and land back on the home screen once the server is up.
