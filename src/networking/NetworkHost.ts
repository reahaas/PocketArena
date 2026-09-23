import {
  DISCONNECT_TIMEOUT_MS,
  DEFAULT_SPORT,
  EXTRAP_MAX_MS,
  MAX_DRAW_ARROWS,
  MAX_INPUTS_PER_TICK,
  MAX_PLAYERS,
  NUMBER_MAX,
  NUMBER_MIN,
  NUMBER_RELEASE_GRACE_MS,
  SNAPSHOT_INTERVAL_MS,
  TEAMS,
} from '../config/constants';
import type { SportType, TeamId } from '../config/constants';
import { GameSimulation } from '../game/GameSimulation';
import type { GameSession, RenderPlayer } from '../game/RenderPlayer';
import { spawnPointForSlot } from '../game/SpawnPoints';
import type { PlayerId, PlayerState, Vector2 } from '../game/types';
import { clamp } from '../utils/math';
import { generatePlayerId } from '../room/RoomId';
import type { DrawArrow, HostMessage, NetPlayer, ReservedNumber, RosterEntry } from './NetworkProtocol';
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
  team: TeamId;
  number: number;
}

export interface NetworkHostEvents {
  onPlayerCountChange?: (count: number) => void;
  onRosterChange?: (entries: RosterEntry[], reserved: ReservedNumber[]) => void;
  onDrawEnabledChange?: (enabled: boolean) => void;
  onArrowsChange?: (arrows: DrawArrow[]) => void;
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
  /** team -> jersey number -> ms timestamp the number becomes fully free again. */
  private readonly reservations = new Map<TeamId, Map<number, number>>(TEAMS.map((t) => [t, new Map()]));
  private readonly arrows: DrawArrow[] = [];

  private tick = 0;
  private lastBroadcastMs = 0;
  private paused = false;
  private snapshotsSent = 0;
  private sport: SportType;
  private drawingEnabledForAll = false;

  constructor(
    private readonly events: NetworkHostEvents = {},
    private readonly now: Clock = () => performance.now(),
    initialSport: SportType = DEFAULT_SPORT,
  ) {
    this.sport = initialSport;
    const playerId = generatePlayerId();
    const spawn = spawnPointForSlot(0);

    this.simulation.addPlayer(playerId, 0, spawn.x, spawn.y);
    const team = this.pickTeam();
    const number = this.assignNumber(team);
    this.hostPeer = {
      playerId,
      slot: 0,
      transport: null,
      queue: [],
      ack: 0,
      highestSequence: 0,
      lastSeenMs: Number.POSITIVE_INFINITY,
      lastAdvanceAtMs: 0,
      team,
      number,
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

  get currentDrawEnabled(): boolean {
    return this.drawingEnabledForAll;
  }

  get currentArrows(): readonly DrawArrow[] {
    return this.arrows;
  }

  get currentRoster(): RosterEntry[] {
    return this.rosterEntries();
  }

  get currentReservedNumbers(): ReservedNumber[] {
    return this.reservedNumbers();
  }

  /** Only the host may change the field; every connected player is told immediately. */
  setSport(sport: SportType): void {
    if (this.sport === sport) return;
    this.sport = sport;
    this.broadcast({ type: 'sport', sport });
  }

  /** Only the host may open the tactics board up to everyone else. */
  setDrawEnabled(enabled: boolean): void {
    if (this.drawingEnabledForAll === enabled) return;
    this.drawingEnabledForAll = enabled;
    this.broadcast({ type: 'drawEnabled', enabled });
    this.events.onDrawEnabledChange?.(enabled);
  }

  /** The host draws locally (no network hop needed for its own arrow). */
  addArrow(x1: number, y1: number, x2: number, y2: number): void {
    this.recordArrow(this.hostPeer.playerId, x1, y1, x2, y2);
  }

  /** Removes only the host's own arrows. */
  clearMyDrawings(): void {
    this.clearDrawingsFor(this.hostPeer.playerId);
  }

  /** Lets the host's own player pick a new jersey number, same rules as everyone else. */
  claimNumberForSelf(number: number): void {
    this.handleClaimNumber(this.hostPeer, number);
  }

  /** Wipes the whole tactics board for everyone. */
  clearAllDrawings(): void {
    if (this.arrows.length === 0) return;
    this.arrows.length = 0;
    this.broadcast({ type: 'arrows', arrows: [] });
    this.events.onArrowsChange?.([]);
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

    const team = this.pickTeam();
    const number = this.assignNumber(team);

    const peer: HostPeer = {
      playerId,
      slot,
      transport,
      queue: [],
      ack: 0,
      highestSequence: 0,
      lastSeenMs: nowMs,
      lastAdvanceAtMs: nowMs,
      team,
      number,
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

    // A peer that joins while we are backgrounded, paused, or mid-tactics-talk must learn that
    // immediately rather than waiting for the next thing to change.
    if (this.paused) this.sendTo(peer, { type: 'paused', paused: true });
    this.sendTo(peer, { type: 'drawEnabled', enabled: this.drawingEnabledForAll });
    if (this.arrows.length > 0) this.sendTo(peer, { type: 'arrows', arrows: [...this.arrows] });

    this.broadcastExcept(playerId, { type: 'playerJoined', player: this.toNetPlayer(player, 0) });
    this.broadcastRoster();
    this.events.onPlayerCountChange?.(this.peers.size);

    return playerId;
  }

  removePeer(playerId: PlayerId): void {
    const peer = this.peers.get(playerId);
    if (!peer || peer === this.hostPeer) return;

    peer.transport?.close();
    this.peers.delete(playerId);
    this.simulation.removePlayer(playerId);

    // A reconnect within the grace window gets its old number back rather than a random one.
    this.reservations.get(peer.team)!.set(peer.number, this.now() + NUMBER_RELEASE_GRACE_MS);

    this.broadcastExcept(playerId, { type: 'playerLeft', playerId });
    this.broadcastRoster();
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

    // Numbers whose grace period just lapsed become selectable; tell everyone so an open
    // number picker updates without needing a fresh request.
    if (this.purgeExpiredReservations(nowMs)) this.broadcastRoster();

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

      case 'claimNumber':
        this.handleClaimNumber(peer, message.number);
        return;

      case 'drawArrow':
        // A player only gets to draw if the host has opened the board to everyone.
        if (!this.drawingEnabledForAll) return;
        this.recordArrow(peer.playerId, message.x1, message.y1, message.x2, message.y2);
        return;

      case 'clearMyDrawings':
        this.clearDrawingsFor(peer.playerId);
        return;
    }
  }

  private handleClaimNumber(peer: HostPeer, number: number): void {
    if (number === peer.number) return;
    if (this.takenNumbers(peer.team, peer.playerId).has(number)) return;

    peer.number = number;
    this.broadcastRoster();
  }

  private recordArrow(playerId: PlayerId, x1: number, y1: number, x2: number, y2: number): void {
    this.arrows.push({ id: generatePlayerId(), playerId, x1, y1, x2, y2 });
    // Bounded so a chatty room cannot grow the tactics board forever.
    if (this.arrows.length > MAX_DRAW_ARROWS) this.arrows.shift();
    this.broadcast({ type: 'arrows', arrows: [...this.arrows] });
    this.events.onArrowsChange?.([...this.arrows]);
  }

  private clearDrawingsFor(playerId: PlayerId): void {
    const before = this.arrows.length;
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      if (this.arrows[i]!.playerId === playerId) this.arrows.splice(i, 1);
    }
    if (this.arrows.length === before) return;
    this.broadcast({ type: 'arrows', arrows: [...this.arrows] });
    this.events.onArrowsChange?.([...this.arrows]);
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

  /** Keeps the two rosters balanced as people join, rather than filling one team first. */
  private pickTeam(): TeamId {
    const counts: Record<TeamId, number> = { A: 0, B: 0 };
    for (const peer of this.peers.values()) counts[peer.team]++;
    return counts.A <= counts.B ? 'A' : 'B';
  }

  private assignNumber(team: TeamId): number {
    const taken = this.takenNumbers(team, null);
    for (let n = NUMBER_MIN; n <= NUMBER_MAX; n++) {
      if (!taken.has(n)) return n;
    }
    return NUMBER_MIN;
  }

  /** Numbers held by an active player on this team, plus anything still in its grace window. */
  private takenNumbers(team: TeamId, excludePlayerId: PlayerId | null): Set<number> {
    this.purgeExpiredReservations(this.now());

    const taken = new Set<number>();
    for (const peer of this.peers.values()) {
      if (peer.team === team && peer.playerId !== excludePlayerId) taken.add(peer.number);
    }
    for (const number of this.reservations.get(team)!.keys()) taken.add(number);
    return taken;
  }

  /** Returns true if anything was actually freed, so callers know whether to tell clients. */
  private purgeExpiredReservations(nowMs: number): boolean {
    let changed = false;
    for (const perTeam of this.reservations.values()) {
      for (const [number, freeAtMs] of [...perTeam]) {
        if (freeAtMs > nowMs) continue;
        perTeam.delete(number);
        changed = true;
      }
    }
    return changed;
  }

  private toNetPlayer(player: PlayerState, ack: number): NetPlayer {
    return { ...player, ack };
  }

  private netPlayers(): NetPlayer[] {
    return [...this.simulation.values()].map((player) =>
      this.toNetPlayer(player, this.peers.get(player.id)?.ack ?? 0),
    );
  }

  private rosterEntries(): RosterEntry[] {
    return [...this.peers.values()].map((peer) => ({
      playerId: peer.playerId,
      slot: peer.slot,
      team: peer.team,
      number: peer.number,
    }));
  }

  private reservedNumbers(): ReservedNumber[] {
    const reserved: ReservedNumber[] = [];
    for (const [team, perTeam] of this.reservations) {
      for (const number of perTeam.keys()) reserved.push({ team, number });
    }
    return reserved;
  }

  private broadcastRoster(): void {
    const entries = this.rosterEntries();
    const reserved = this.reservedNumbers();
    this.broadcast({ type: 'roster', entries, reserved });
    this.events.onRosterChange?.(entries, reserved);
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
