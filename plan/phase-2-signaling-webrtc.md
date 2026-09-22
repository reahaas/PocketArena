# Phase 2 — Signaling, Rooms & WebRTC

**Status:** Complete
**Depends on:** Phase 1
**Goal:** a host creates a game, shares a link, and a second device opens that link and connects
over WebRTC. Both players see each other as circles at their spawn points. No movement sync yet.

This phase is about connection establishment only. Deliberately stop before netcode — proving the
transport works in isolation is what makes Phase 3 debuggable.

---

## Tasks

### Signaling server (spec §6)

- [ ] `server/index.ts` — `ws` server on `SERVER_PORT`
- [ ] `server/signaling/RoomManager.ts` — in-memory `Map<roomId, Room>`, no persistence, no database
- [ ] `server/signaling/SignalingServer.ts` — message routing
- [ ] `server/signaling/protocol.ts` — signaling message types + validators

Message set:

| Client → Server | Server → Client |
| --- | --- |
| `createRoom` | `roomCreated { roomId }` |
| `joinRoom { roomId }` | `roomJoined { peerId }` / `roomError { reason: 'full' \| 'notFound' }` |
| `offer { to, sdp }` | `offer { from, sdp }` |
| `answer { to, sdp }` | `answer { from, sdp }` |
| `ice { to, candidate }` | `ice { from, candidate }` |
| — | `peerJoined { peerId }` / `peerLeft { peerId }` |

**The server must NOT** simulate, receive inputs or positions, broadcast gameplay state, or persist
anything (spec §6). Once the DataChannels open, gameplay traffic never touches it again.

**Hardening beyond spec §34** — a public WebSocket endpoint is trivially abusable:
- [ ] Reject messages over `WS_MSG_MAX_BYTES`
- [ ] Per-connection token-bucket rate limit at `WS_MSGS_PER_SEC`
- [ ] Origin allowlist
- [ ] `MAX_ROOMS` cap
- [ ] TTL sweeper removing empty/stale rooms at `ROOM_TTL_MS`
- [ ] Heartbeat ping/pong to reap half-open sockets
- [ ] Reject player 21 with `roomError { reason: 'full' }` (spec §3)

### Room identity & invite links

- [ ] `room/RoomManager.ts` — client-side room lifecycle
- [ ] `room/InviteLink.ts` — build and parse `/join/:gameId`
- [ ] Room IDs: `crypto.getRandomValues` → Crockford base32, `ROOM_ID_LENGTH` chars, ambiguous
      characters (I, L, O, U) removed. Never sequential (spec §33). No secrets encoded in the ID.
- [ ] Player IDs: `crypto.randomUUID()` (spec §16)

### Protocol & serialization (spec §8)

- [ ] `networking/NetworkProtocol.ts` — `ClientMessage` / `HostMessage` discriminated unions.
      Extend the spec's set with `ping` / `pong` (for RTT in the debug HUD) and `rejected`.
      `state` carries `serverTimeMs` so the client can build an interpolation timeline.
- [ ] `networking/NetworkSerializer.ts` — JSON encode/decode behind a seam so binary encoding can
      replace it later without touching call sites (spec §28).
- [ ] Hand-rolled type guards — no schema library, keeps the dependency list to spec §35.
      Every validator must: check the discriminant, reject unknown types, reject oversized payloads,
      reject `NaN`/`Infinity`, and clamp every numeric field to its legal range.

### Transport abstraction (spec §7, §37)

- [ ] `networking/transport/Transport.ts` — interface:
      `send(channel: 'reliable' | 'unreliable', msg)`, `onMessage`, `onStateChange`, `close()`
- [ ] `networking/transport/WebRTCConnection.ts` — wraps `RTCPeerConnection` + the two DataChannels
      per decision **D1**. Handles offer/answer/ICE, open detection, disconnect detection.
- [ ] `networking/transport/LoopbackTransport.ts` — in-process implementation with injectable
      latency, jitter, and packet loss. **This is not a throwaway** — it is how Phase 3's netcode and
      Phase 4's 20-player criterion get tested without 20 phones.
- [ ] `networking/iceConfig.ts` — builds `RTCConfiguration` from `VITE_STUN_SERVERS` and the unset
      `VITE_TURN_*` vars (decision **D3**)

> No file outside `networking/transport/` may reference `RTCPeerConnection` or `RTCDataChannel`.

### Client/host networking

- [ ] `networking/NetworkHost.ts` — accepts joiners, creates one `WebRTCConnection` per player
- [ ] `networking/NetworkClient.ts` — single connection to the host
- [ ] Connection state machine: `DISCONNECTED | CONNECTING | CONNECTED | RECONNECTING | FAILED`
      (spec §22), exposed as an observable the UI subscribes to

### UI & routing

- [ ] `ui/HomeScreen.ts` — `POCKET ARENA` / `2-20 PLAYER BROWSER GAME` / `[ CREATE GAME ]`
- [ ] `ui/ShareOverlay.ts` — renders **over the live game** per decision **A1**, not as a separate
      screen. Web Share API → `navigator.clipboard` → `execCommand` fallback chain (spec §31).
      Shares title + message + URL. No WhatsApp-specific APIs.
- [ ] `ui/JoinGameScreen.ts` — `JOIN GAME`, plus full/not-found/failed states
- [ ] `ui/ConnectionIndicator.ts` — subtle `● Connected` / `Connection lost` + retry
- [ ] `main.ts` routing for `/` and `/join/:gameId` via the History API
- [ ] SPA fallback rewrite configured in `vite.config.ts` dev server (production host config in
      Phase 5)

**No networking jargon in user-facing copy** (spec §30): never show WebRTC, ICE, STUN, SDP,
signaling, or DataChannel outside the debug overlay.

## Files created

```
server/index.ts
server/signaling/{SignalingServer,RoomManager,protocol}.ts
src/room/{RoomManager,InviteLink}.ts
src/networking/{NetworkProtocol,NetworkSerializer,NetworkHost,NetworkClient,iceConfig}.ts
src/networking/transport/{Transport,WebRTCConnection,LoopbackTransport}.ts
src/ui/{HomeScreen,ShareOverlay,JoinGameScreen,ConnectionIndicator}.ts
tests/{roomId,inviteLink,protocol,serializer}.test.ts
```

## Exit criteria

- [ ] Host presses Create Game and receives a shareable `/join/ABC123` URL
- [ ] A second device opens that URL and connects; both see two circles at distinct spawn points
- [ ] Both DataChannels open; `unreliable` reports `maxRetransmits === 0`
- [ ] Bogus game ID shows a clean "Game not found", not a crash
- [ ] Gameplay traffic is confirmed absent from the signaling socket after connect
- [ ] Nothing outside `networking/transport/` references `RTCPeerConnection`
- [ ] **The link works when opened from inside WhatsApp on both iOS and Android** — see risks

## Verification

**Automated:** room ID randomness/charset/length; invite URL build+parse round-trip; every message
type round-trips through the serializer; malformed, unknown-type, oversized, `NaN`, and
out-of-range messages are all rejected.

**Manual:**
- Two browser tabs on desktop, then two physical phones on the same WiFi
- `chrome://webrtc-internals` to confirm both channels and the ICE candidate pair
- Watch the signaling WebSocket frames after connection — should be idle
- Send the link through a real WhatsApp message and tap it on both platforms

## Risks / watch items

- **WhatsApp's in-app browser is the real runtime**, not Safari or Chrome. iOS opens links in a
  WKWebView, Android in a Custom Tab/WebView. WebRTC behaviour, autoplay policy, and secure-context
  handling all differ. This is an exit criterion, not an afterthought — if it fails, the fix is an
  "Open in browser" nudge on the join screen, and it is much cheaper to discover now.
- Local development is `http://localhost`, which is a secure context; a LAN IP over plain HTTP is
  not, and WebRTC will fail. Use a dev TLS certificate or a tunnel when testing across devices.
- Host-side ICE gathering for many peers is the untested scaling assumption. It only has to work for
  two peers in this phase; the real test is Phase 4.

## Deviations log

- **Signaling protocol lives in `src/networking/SignalingProtocol.ts`**, shared by browser and
  server, rather than being duplicated in `server/signaling/protocol.ts`.
- **`src/networking/sdp.ts` added** to convert between the opaque relay payloads and the browser's
  `RTCSessionDescriptionInit` / `RTCIceCandidateInit`, keeping the casts in one place.
- **`SignalingServer.ready`** resolves with the bound port so tests can use an ephemeral one.
- **Race condition found by the E2E suite and fixed.** The server notifies the host inside
  `joinRoom`, so the host's offer could reach the joiner *before* `App.joinGame` had finished
  subscribing to signaling messages — the offer was dropped and the joiner sat until the 20s welcome
  timeout. Intermittent, load-dependent, and invisible to the unit tests. `SignalingClient` now
  buffers messages that arrive with no subscriber and replays them on the first subscription.
  Covered by `tests/signalingClient.test.ts`.
- Verified in a real browser: create → share link → join → offer/answer/ICE → both channels open →
  welcome delivered, plus movement crossing the connection in both directions. The WhatsApp in-app
  browser check remains outstanding (needs a real device).
