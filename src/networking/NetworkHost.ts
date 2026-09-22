import {
  DISCONNECT_TIMEOUT_MS,
  DEFAULT_SPORT,
  EXTRAP_MAX_MS,
  MAX_INPUTS_PER_TICK,
  MAX_PLAYERS,
  SNAPSHOT_INTERVAL_MS,
} from '../config/constants';
import type { SportType } from '../config/constants';
import { GameSimulation } from '../game/GameSimulation';
import type { GameSession, RenderPlayer } from '../game/RenderPlayer';
import { spawnPointForSlot } from '../game/SpawnPoints';
import type { PlayerId, PlayerState, Vector2 } from '../game/types';
import { clamp } from '../utils/math';
import { generatePlayerId } from '../room/RoomId';
import type { HostMessage, NetPlayer } from './NetworkProtocol';
import { channelFor } from './NetworkProtocol';
import { decodeClientMessage, encode } from './NetworkSerializer';
import type { Transport } from './transport/Transport';

const MAX_QUEUED_INPUTS = MAX_INPUTS_PER_TICK * 8;

interface QueuedInput {
  sequence: number;
  input: Vector2;
  dt: number;
}

interface HostPeer {
  playerId: PlayerId;
  slot: number;
  /** null for the host's own player, which has no network connection. */
  transport: Transport | null;
  queue: QueuedInput[];
  ack: number;
  highestSequence: number;
  lastSeenMs: number;
  /** When this player's position last actually moved. Render extrapolates from here. */
  lastAdvanceAtMs: number;
}

export interface NetworkHostEvents {
  onPlayerCountChange?: (count: number) => void;
}

export type Clock = () => number;

/**
 * The authoritative simulation (spec §5). Clients send input; only this class decides where
 * anyone actually is.
 */
export class NetworkHost implements GameSession {
  private readonly simulation = new GameSimulation();
  private readonly peers = new Map<PlayerId, HostPeer>();
  private readonly hostPeer: HostPeer;

  private tick = 0;
  private lastBroadcastMs = 0;
  private paused = false;
  private snapshotsSent = 0;
  private sport: SportType;

  constructor(
    private readonly events: NetworkHostEvents = {},
    private readonly now: Clock = () => performance.now(),
    initialSport: SportType = DEFAULT_SPORT,
  ) {
    this.sport = initialSport;
    const playerId = generatePlayerId();
    const spawn = spawnPointForSlot(0);

    this.simulation.addPlayer(playerId, 0, spawn.x, spawn.y);
    this.hostPeer = {
      playerId,
      slot: 0,
      transport: null,
      queue: [],
      ack: 0,
      highestSequence: 0,
      lastSeenMs: Number.POSITIVE_INFINITY,
      lastAdvanceAtMs: 0,
    };
    this.peers.set(playerId, this.hostPeer);
  }

  get localPlayerId(): PlayerId {
    return this.hostPeer.playerId;
  }

  get localSlot(): number {
    return 0;
  }

  get playerCount(): number {
    return this.peers.size;
  }

  get isFull(): boolean {
    return this.peers.size >= MAX_PLAYERS;
  }

  get currentTick(): number {
    return this.tick;
  }

  get snapshotCount(): number {
    return this.snapshotsSent;
  }

  get currentSport(): SportType {
    return this.sport;
  }

  /** Only the host may change the field; every connected player is told immediately. */
  setSport(sport: SportType): void {
    if (this.sport === sport) return;
    this.sport = sport;
    this.broadcast({ type: 'sport', sport });
  }

  /** Authoritative state for a player, for tests and debug tooling. */
  getPlayerState(id: PlayerId): PlayerState | undefined {
    return this.simulation.getPlayer(id);
  }

  /** Accepts a connected peer into the game, or rejects it if the room is already full. */
  acceptPeer(transport: Transport, nowMs: number): PlayerId | null {
    if (this.isFull) {
      transport.send('reliable', encode({ type: 'rejected', reason: 'full' }));
      return null;
    }

    const slot = this.nextFreeSlot();
    if (slot === null) {
      transport.send('reliable', encode({ type: 'rejected', reason: 'full' }));
      return null;
    }

    const playerId = generatePlayerId();
    const spawn = spawnPointForSlot(slot);
    const player = this.simulation.addPlayer(playerId, slot, spawn.x, spawn.y);

    const peer: HostPeer = {
      playerId,
      slot,
      transport,
      queue: [],
      ack: 0,
      highestSequence: 0,
      lastSeenMs: nowMs,
      lastAdvanceAtMs: nowMs,
    };
    this.peers.set(playerId, peer);

    transport.setHandlers({
      onMessage: (raw) => this.onPeerMessage(peer, raw),
      onStateChange: (state) => {
        if (state === 'DISCONNECTED' || state === 'FAILED') this.removePeer(playerId);
      },
    });

    // The joiner gets the full picture before its first frame, so nobody flashes in at (0,0).
    this.sendTo(peer, {
      type: 'welcome',
      playerId,
      slot,
      tick: this.tick,
      serverTimeMs: nowMs,
      players: this.netPlayers(),
      sport: this.sport,
    });

    // A peer that joins while we are backgrounded must learn that immediately.
    if (this.paused) this.sendTo(peer, { type: 'paused', paused: true });

    this.broadcastExcept(playerId, { type: 'playerJoined', player: this.toNetPlayer(player, 0) });
    this.events.onPlayerCountChange?.(this.peers.size);

    return playerId;
  }

  removePeer(playerId: PlayerId): void {
    const peer = this.peers.get(playerId);
    if (!peer || peer === this.hostPeer) return;

    peer.transport?.close();
    this.peers.delete(playerId);
    this.simulation.removePlayer(playerId);

    this.broadcastExcept(playerId, { type: 'playerLeft', playerId });
    this.events.onPlayerCountChange?.(this.peers.size);
  }

  submitInput(input: Vector2, dtSeconds: number): void {
    this.hostPeer.highestSequence += 1;
    this.enqueue(this.hostPeer, {
      sequence: this.hostPeer.highestSequence,
      input: { ...input },
      dt: dtSeconds,
    });
  }

  /** One authoritative simulation step. */
  step(nowMs: number): void {
    if (this.paused) return;

    this.tick += 1;

    for (const peer of this.peers.values()) {
      let processed = 0;
      while (processed < MAX_INPUTS_PER_TICK && peer.queue.length > 0) {
        const queued = peer.queue.shift()!;
        this.simulation.step(peer.playerId, queued.input, queued.dt);
        peer.ack = queued.sequence;
        peer.lastAdvanceAtMs = nowMs;
        processed++;
      }
    }
  }

  /** Called once per frame: broadcasts on schedule and reaps silent peers. */
  afterFrame(nowMs: number): void {
    if (this.paused) return;

    for (const peer of [...this.peers.values()]) {
      if (!peer.transport) continue;
      if (nowMs - peer.lastSeenMs > DISCONNECT_TIMEOUT_MS) this.removePeer(peer.playerId);
    }

    if (nowMs - this.lastBroadcastMs < SNAPSHOT_INTERVAL_MS) return;
    this.lastBroadcastMs = nowMs;
    this.snapshotsSent += 1;

    this.broadcast({
      type: 'state',
      tick: this.tick,
      serverTimeMs: nowMs,
      players: this.netPlayers(),
    });
  }

  setPaused(paused: boolean, nowMs: number): void {
    if (this.paused === paused) return;
    this.paused = paused;

    if (!paused) {
      this.lastBroadcastMs = nowMs;
      // Nobody was heard from while we were asleep; that is not their fault.
      for (const peer of this.peers.values()) {
        peer.lastSeenMs = nowMs;
        peer.lastAdvanceAtMs = nowMs;
      }
    }
    this.broadcast({ type: 'paused', paused });
  }

  renderPlayers(nowMs: number): RenderPlayer[] {
    return [...this.simulation.values()].map((player) => {
      // Inputs arrive at INPUT_HZ but ticks run at SIM_TICK_HZ, so a tick often advances
      // nobody. Extrapolating from each player's own last move keeps motion continuous
      // instead of snapping back on every empty tick.
      const peer = this.peers.get(player.id);
      const sinceMs = peer ? clamp(nowMs - peer.lastAdvanceAtMs, 0, EXTRAP_MAX_MS) : 0;
      const aheadSeconds = sinceMs / 1000;

      return {
        id: player.id,
        slot: player.slot,
        x: player.x + player.vx * aheadSeconds,
        y: player.y + player.vy * aheadSeconds,
        isLocal: player.id === this.hostPeer.playerId,
      };
    });
  }

  destroy(): void {
    for (const peer of this.peers.values()) peer.transport?.close();
    this.peers.clear();
    this.simulation.clear();
  }

  private onPeerMessage(peer: HostPeer, raw: string): void {
    const message = decodeClientMessage(raw);
    if (!message) return;

    peer.lastSeenMs = this.now();

    switch (message.type) {
      case 'input':
        // Replays and reordered duplicates must never advance a player twice.
        if (message.sequence <= peer.highestSequence) return;
        peer.highestSequence = message.sequence;
        this.enqueue(peer, {
          sequence: message.sequence,
          input: { x: message.x, y: message.y },
          dt: message.dt,
        });
        return;

      case 'ping':
        this.sendTo(peer, { type: 'pong', t: message.t });
        return;
    }
  }

  private enqueue(peer: HostPeer, input: QueuedInput): void {
    peer.queue.push(input);
    // A flooding client fills its own queue and gains nothing: the tick drains a fixed amount.
    if (peer.queue.length > MAX_QUEUED_INPUTS) peer.queue.shift();
  }

  private nextFreeSlot(): number | null {
    const taken = new Set([...this.peers.values()].map((peer) => peer.slot));
    for (let slot = 0; slot < MAX_PLAYERS; slot++) {
      if (!taken.has(slot)) return slot;
    }
    return null;
  }

  private toNetPlayer(player: PlayerState, ack: number): NetPlayer {
    return { ...player, ack };
  }

  private netPlayers(): NetPlayer[] {
    return [...this.simulation.values()].map((player) =>
      this.toNetPlayer(player, this.peers.get(player.id)?.ack ?? 0),
    );
  }

  private sendTo(peer: HostPeer, message: HostMessage): void {
    peer.transport?.send(channelFor(message.type), encode(message));
  }

  private broadcast(message: HostMessage): void {
    const payload = encode(message);
    const channel = channelFor(message.type);
    for (const peer of this.peers.values()) peer.transport?.send(channel, payload);
  }

  private broadcastExcept(excludedId: PlayerId, message: HostMessage): void {
    const payload = encode(message);
    const channel = channelFor(message.type);
    for (const peer of this.peers.values()) {
      if (peer.playerId === excludedId) continue;
      peer.transport?.send(channel, payload);
    }
  }
}
