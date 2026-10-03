# Decisions

Original decisions and approved spec deviations live in [`plan/decisions.md`](../plan/decisions.md). Add new decisions below (date, decision, why, rejected alternatives).

- **Playbook is offline and room-independent**: avoids coupling editor state to live games.
- **Per-step minimum duration derived from distance**: keeps plays physically achievable at `PLAYER_SPEED`.
- **Solo practice is client-only** (no host): scoring happens locally; sharing is via Web Share/download.
- **Single `AGENTS.md`** as the agent entry point; tool-specific files only point to it.
