# i-d-KO

Can't decide where to eat? Fight about it. Each option is a team, everyone picks a side, and the last team standing wins the decision.

Top-down team brawler: Node.js + socket.io authoritative server, vanilla JS + canvas client.

## Run locally

```sh
npm install
npm run dev        # http://localhost:3000 (server also serves the client locally)
npm test
```

Open a few tabs (use DevTools device emulation for touch) and join the same room code.

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
