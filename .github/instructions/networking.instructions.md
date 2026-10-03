---
applyTo: "src/networking/**,server/**"
---
- Clients send input only; the host owns state. Never trust a field from a peer or the signaling channel.
- Add or change messages in `NetworkProtocol.ts` with a validating parser and a test in `tests/protocol.test.ts`.
- Unreliable channel: input/state/ping. Reliable channel: lifecycle messages. Do not move snapshots to the reliable channel.
- Tunables belong in `src/config/constants.ts`.
- See `.github/skills/add-network-message/SKILL.md`.
