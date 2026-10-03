---
name: ship-change
description: Commit and push a validated change to main and confirm CI and deployment. Use when the user says to commit/push/deploy.
---
# Ship a change

1. Run the `verify-change` skill; do not ship on red.
2. `git status` and review `git diff --stat`; make sure no secrets, `test-results/`, or stray files are staged.
3. Commit: `git -c user.name=reahaas -c user.email=reahaas@gmail.com commit -m "<imperative subject>" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"`.
4. `git push origin main`. This triggers CI (`ci.yml`) and the GitHub Pages deploy (`deploy-pages.yml`); the signaling server is on Render.
5. Tell the user the commit hash and that deployment follows the workflows; check run status if the GitHub tools are available.
