# Architecture

- **Topology**: one authoritative host browser; each other player has one WebRTC connection to the host (no mesh). A WebSocket signaling server (`server/`) only brokers connection setup, holds no persistent state, and carries no gameplay.
- **Channels**: unreliable+unordered for input/state/ping; reliable+ordered for lifecycle (join, welcome, playerJoined/Left, gameStarted, rejected).
- **Authority**: clients send input; host runs `GameSimulation` at a fixed tick and broadcasts snapshots. Clients predict (`Prediction.ts`), reconcile (`Reconciliation.ts`) and interpolate (`Interpolation.ts`). Movement is the single function `stepPlayer()`.
- **Layering**: `src/game/GameSimulation.ts` is pure (no Phaser/DOM/WebRTC). Rendering is Phaser (`GameScene`, `PlaybookLayer`, `DrawLayer`). UI is plain DOM in `src/ui/`. `src/app/App.ts` is the composition root.
- **Sessions**: `GameSession` (`RenderPlayer.ts`) abstracts "what to render"; network host/client and `PlaybookPracticeSession` implement it, so the scene is unaware of the source.
- **Transports**: WebRTC and an in-process loopback (used by the headless multiplayer tests in `tests/harness`).
- **Deployment**: client -> GitHub Pages on push to `main`; signaling -> Render (`render.yaml`) / Docker (`Dockerfile`, `docker-compose.yml`). CI in `.github/workflows/ci.yml` (typecheck, lint, tests, audit, e2e, docker).
- Original rationale and spec deviations: `plan/decisions.md`, `plan/README.md`, `SystemDescription.txt`.
