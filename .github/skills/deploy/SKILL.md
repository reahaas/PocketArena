---
name: deploy
description: Deploy Pocket Arena (client on GitHub Pages, signaling server on Render), verify the release, set up a fresh deployment, and troubleshoot. Use when asked to deploy, release, check if something is live, or fix deployment/CORS/WebSocket issues.
---
# Deploy

Two independent pieces:

| Piece | Host | Trigger | Config |
| --- | --- | --- | --- |
| Client (static SPA) | GitHub Pages at `https://reahaas.github.io/PocketArena/` | push to `main` or manual `workflow_dispatch` of "Deploy client to GitHub Pages" | `.github/workflows/deploy-pages.yml` |
| Signaling server (WebSocket, `/healthz`) | Render web service `pocket-arena`, Docker, free plan, `wss://pocket-arena-l6q9.onrender.com/ws` | Render auto-deploy from the GitHub repo (verify in the Render dashboard; not controlled by this repo's workflows) | `render.yaml`, `Dockerfile` |

Gameplay is P2P; the server only brokers setup, so a client-only change needs just Pages. Server changes (`server/**`, `Dockerfile`) need Render to redeploy.

## Release steps
1. Run the `verify-change` skill. Never deploy on red.
2. Commit and `git push origin main` (see `ship-change`). CI (`ci.yml`) and the Pages workflow start.
3. Watch the workflows: GitHub MCP `actions_list`/`actions_get`, or `https://github.com/reahaas/PocketArena/actions`. The Pages workflow builds with `BASE_PATH=/PocketArena/` and `VITE_SIGNALING_URL=wss://pocket-arena-l6q9.onrender.com/ws`, copies `dist/index.html` to `404.html` (SPA deep links like `/join/ABC123`), then deploys.
4. Verify live:
   - `curl -I https://reahaas.github.io/PocketArena/` returns 200 and the page loads the new asset hash (compare with `dist/assets/index-*.js` from a local build).
   - `curl https://pocket-arena-l6q9.onrender.com/healthz` returns OK. The free plan sleeps when idle: the first request can take ~30-60s; retry before concluding it is down.
5. Report the commit hash and what was verified. Say plainly what you could not verify (Render dashboard state, real-device behavior).

## First-time / fresh setup
- Pages: repo Settings -> Pages -> Source = "GitHub Actions".
- Render: New Web Service from the repo (Blueprint uses `render.yaml`), runtime Docker, health check `/healthz`.
- Set `ALLOWED_ORIGINS` on Render to the Pages **origin** `https://reahaas.github.io` (origin only, no path) so the server enforces same-origin WebSockets. Blank = allow all (testing only).
- If the Render URL changes, update `VITE_SIGNALING_URL` in `deploy-pages.yml` and redeploy Pages.
- Optional TURN for restrictive cellular networks: set `VITE_TURN_URL`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL` as build env (use GitHub secrets, never commit values).

## Troubleshooting
- Blank page / 404 on assets: `BASE_PATH` wrong or Pages source not "GitHub Actions".
- Deep link `/join/XYZ` 404: `404.html` copy step missing.
- Cannot connect / WebSocket fails: Render asleep, wrong `VITE_SIGNALING_URL`, or `ALLOWED_ORIGINS` missing the Pages origin.
- Players cannot connect over cellular: needs TURN (see `docs/gotchas.md`).
- Old version still showing: hard reload; check the Pages workflow actually succeeded.
