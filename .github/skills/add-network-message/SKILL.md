---
name: add-network-message
description: Add or change a peer/host protocol message safely (validation, channel choice, tests). Use when touching NetworkProtocol, NetworkHost or NetworkClient.
---
# Add a network message

1. Define the type in `src/networking/NetworkProtocol.ts` and a strict parser that rejects malformed/out-of-range values (finite numbers, bounded strings/arrays).
2. Pick the channel: high-rate and loss-tolerant (input/state/ping) -> unreliable; lifecycle and one-shot -> reliable.
3. Host handles it in `NetworkHost.ts` treating the sender as untrusted; client in `NetworkClient.ts`.
4. Put limits/rates in `src/config/constants.ts`.
5. Tests: parser cases in `tests/protocol.test.ts`; behavior in `tests/hostAuthority.test.ts` or `tests/multiplayer.test.ts` (headless harness in `tests/harness`).
6. Run `verify-change`.
