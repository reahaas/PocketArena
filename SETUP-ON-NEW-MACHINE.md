# Pocket Arena — Setup on a New Machine

How to unpack and run this project from the transfer zip (`PocketArena-<date>.zip`).

## What's in the zip

Included: all source (`src/`, `server/`, `tests/`, `e2e/`), configs, `plan/`,
`README.md`, `SystemDescription.txt`, `.github/`, Docker files,
`package-lock.json`, `.env.example`.

Excluded on purpose: `node_modules/`, `.git/`, `dist/`, `test-results/`,
`playwright-report/`, `coverage/`, logs, `.DS_Store`, and any real `.env`.

## 1. Prerequisites

- **Node.js 20+** (22 recommended) and npm — https://nodejs.org
- **Docker Desktop** — optional, only for `npm run docker:*` and containerized e2e

Check:

```bash
node -v
npm -v
```

## 2. Unpack

macOS / Linux:

```bash
cd ~/Projects                                   # wherever you want it
unzip ~/Downloads/PocketArena-<date>.zip -d PocketArena
cd PocketArena
```

Windows (PowerShell):

```powershell
Expand-Archive -Path "$HOME\Downloads\PocketArena-<date>.zip" -DestinationPath "$HOME\Projects\PocketArena"
cd "$HOME\Projects\PocketArena"
```

Avoid unpacking into a cloud-synced folder (OneDrive/Dropbox) — sync churn on
`node_modules` slows builds down badly.

## 3. Install dependencies

```bash
npm ci
```

`npm ci` installs the exact versions from `package-lock.json`. Use `npm install`
only if you intend to update dependencies.

## 4. Optional configuration

Defaults work out of the box (same-Wi-Fi play over STUN). Only create a `.env`
if you need custom STUN/TURN servers, a different port, or network debug knobs:

```bash
cp .env.example .env
```

Key settings:

| Variable | Purpose |
| --- | --- |
| `VITE_SIGNALING_URL` | Leave empty — client uses `/ws` on its own origin |
| `VITE_STUN_SERVERS` | Comma-separated STUN URLs |
| `VITE_TURN_URL` / `_USERNAME` / `_CREDENTIAL` | Only needed for cross-network play |
| `PORT` | Signaling server port (default `8787`) |
| `STATIC_DIR` | Set to the built client dir to serve everything from one process |
| `ALLOWED_ORIGINS` | CORS/origin allowlist for the signaling server |

## 5. Run it

```bash
npm run dev:all      # Vite client + signaling server together
```

Open the URL Vite prints (default http://localhost:5173). Other devices on the
same Wi-Fi join via the invite link using this machine's LAN IP.

Other scripts:

```bash
npm run dev          # client only
npm run dev:server   # signaling server only
npm run build        # typecheck + production build into dist/
npm run serve        # run the signaling/static server (set STATIC_DIR first)
npm run docker:up    # build + start the container stack
```

## 6. Verify the move

```bash
npm run typecheck
npm run lint
npm test
```

For end-to-end tests (one-time browser download, then run):

```bash
npx playwright install
npm run test:e2e
```

## 7. Version control

The zip has no `.git/` — this is a fresh working copy with no history or remote.
If you want version control back:

```bash
git init
git add .
git commit -m "Import Pocket Arena"
```

## Troubleshooting

- **`npm ci` fails** — confirm Node 20+; delete `node_modules` and retry.
- **Port already in use** — change `PORT` in `.env`, or free port 5173/8787.
- **Other devices can't join** — both devices must be on the same Wi-Fi, and the
  host firewall must allow inbound connections to the Vite/signaling ports.
- **Playwright errors about missing browsers** — run `npx playwright install`.
