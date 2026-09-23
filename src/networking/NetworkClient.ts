import { DEFAULT_SPORT, INTERP_DELAY_MS, PING_INTERVAL_MS } from '../config/constants';
import type { SportType } from '../config/constants';
import type { GameSession, RenderPlayer } from '../game/RenderPlayer';
import type { PlayerId, PlayerState, Vector2 } from '../game/types';
import { RemoteInterpolator, ServerClock } from './Interpolation';
import type { DrawArrow, NetPlayer, ReservedNumber, RosterEntry } from './NetworkProtocol';
import { channelFor } from './NetworkProtocol';
import { decodeHostMessage, encode } from './NetworkSerializer';
import { Prediction } from './Prediction';
import { CorrectionSmoother, reconcile } from './Reconciliation';
import type { ConnectionState, Transport } from './transport/Transport';

interface RemotePlayer {
  slot: number;
  interpolator: RemoteInterpolator;
}

export interface NetworkClientEvents {
  onReady?: (playerId: PlayerId, slot: number) => void;
  onRejected?: (reason: 'full') => void;
  onPlayerCountChange?: (count: number) => void;
  onPaused?: (paused: boolean) => void;
  onSportChange?: (sport: SportType) => void;
  onRosterChange?: (entries: RosterEntry[], reserved: ReservedNumber[]) => void;
  onDrawEnabledChange?: (enabled: boolean) => void;
  onArrowsChange?: (arrows: DrawArrow[]) => void;
  onConnectionState?: (state: ConnectionState) => void;
}

/**
 * The non-host side: predicts locally, reconciles against the host, and interpolates everyone
 * else (spec §10-§13).
 */
export class NetworkClient implements GameSession {
  private readonly remotes = new Map<PlayerId, RemotePlayer>();
  private readonly serverClock = new ServerClock();
  private readonly smoother = new CorrectionSmoother();

  private prediction: Prediction | null = null;
  private playerId: PlayerId = '';
  private slot = 0;
  private lastInputAtMs = 0;
  private lastPingAtMs = 0;
  private rttMs = 0;
  private ready = false;
  private paused = false;
  private sport: SportType = DEFAULT_SPORT;
  private snapshotsReceived = 0;
  private lastAck = 0;
  private hostTick = 0;
  private roster: RosterEntry[] = [];
  private reserved: ReservedNumber[] = [];
  private drawEnabled = false;
  private arrows: DrawArrow[] = [];

  constructor(
    private readonly transport: Transport,
    private readonly events: NetworkClientEvents = {},
    private readonly now: () => number = () => performance.now(),
  ) {
    transport.setHandlers({
      onMessage: (raw) => this.onMessage(raw),
      onStateChange: (state) => this.events.onConnectionState?.(state),
    });
  }

  get localPlayerId(): PlayerId {
    return this.playerId;
  }

  get localSlot(): number {
    return this.slot;
  }

  get playerCount(): number {
    return this.remotes.size + (this.ready ? 1 : 0);
  }

  get isReady(): boolean {
    return this.ready;
  }

  get roundTripMs(): number {
    return this.rttMs;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get currentSport(): SportType {
    return this.sport;
  }

  get currentRoster(): readonly RosterEntry[] {
    return this.roster;
  }

  get currentReservedNumbers(): readonly ReservedNumber[] {
    return this.reserved;
  }

  get currentDrawEnabled(): boolean {
    return this.drawEnabled;
  }

  get currentArrows(): readonly DrawArrow[] {
    return this.arrows;
  }

  get pendingInputCount(): number {
    return this.prediction?.pendingCount ?? 0;
  }

  get lastSequence(): number {
    return this.prediction?.lastSequence ?? 0;
  }

  get lastAcknowledged(): number {
    return this.lastAck;
  }

  get snapshotCount(): number {
    return this.snapshotsReceived;
  }

  get currentTick(): number {
    return this.hostTick;
  }

  /** The locally predicted state, before render-time smoothing. Used by tests. */
  get localState(): PlayerState | null {
    return this.prediction?.current ?? null;
  }

  submitInput(input: Vector2, dtSeconds: number): void {
    if (!this.prediction || this.paused) return;

    const record = this.prediction.apply(input, dtSeconds);
    this.lastInputAtMs = this.now();

    this.transport.send(
      channelFor('input'),
      encode({
        type: 'input',
        sequence: record.sequence,
        x: record.input.x,
        y: record.input.y,
        dt: record.dt,
      }),
    );
  }

  /** Asks the host to switch this player to a different jersey number. The host has final say. */
  requestNumber(number: number): void {
    this.transport.send(channelFor('claimNumber'), encode({ type: 'claimNumber', number }));
  }

  /** Only takes effect if the host has opened the tactics board to everyone. */
  requestArrow(x1: number, y1: number, x2: number, y2: number): void {
    this.transport.send(channelFor('drawArrow'), encode({ type: 'drawArrow', x1, y1, x2, y2 }));
  }

  requestClearMyDrawings(): void {
    this.transport.send(channelFor('clearMyDrawings'), encode({ type: 'clearMyDrawings' }));
  }

  afterFrame(nowMs: number): void {
    if (nowMs - this.lastPingAtMs < PING_INTERVAL_MS) return;
    this.lastPingAtMs = nowMs;
    this.transport.send(channelFor('ping'), encode({ type: 'ping', t: nowMs }));
  }

  renderPlayers(nowMs: number): RenderPlayer[] {
    const players: RenderPlayer[] = [];

    if (this.prediction) {
      const state = this.prediction.current;
      const aheadSeconds = Math.max(0, nowMs - this.lastInputAtMs) / 1000;
      const offset = this.smoother.sample();

      players.push({
        id: this.playerId,
        slot: this.slot,
        x: state.x + state.vx * aheadSeconds + offset.x,
        y: state.y + state.vy * aheadSeconds + offset.y,
        isLocal: true,
      });
    }

    // Render remotes slightly in the past so there is always a sample on both sides.
    const renderTime = this.serverClock.now(nowMs) - INTERP_DELAY_MS;
    for (const [id, remote] of this.remotes) {
      if (!remote.interpolator.hasSamples) continue;
      const position = remote.interpolator.sample(renderTime);
      remote.interpolator.prune(renderTime);
      players.push({ id, slot: remote.slot, x: position.x, y: position.y, isLocal: false });
    }

    return players;
  }

  destroy(): void {
    this.transport.close();
    this.remotes.clear();
    this.prediction = null;
    this.ready = false;
  }

  private onMessage(raw: string): void {
    const message = decodeHostMessage(raw);
    if (!message) return;

    const now = this.now();

    switch (message.type) {
      case 'welcome': {
        this.playerId = message.playerId;
        this.slot = message.slot;
        this.serverClock.sync(message.serverTimeMs, now);
        this.sport = message.sport;
        this.events.onSportChange?.(message.sport);

        const self = message.players.find((p) => p.id === message.playerId);
        this.prediction = new Prediction(self ?? this.fallbackState(message.playerId, message.slot));
        this.lastInputAtMs = now;

        for (const player of message.players) {
          if (player.id === message.playerId) continue;
          this.upsertRemote(player, message.serverTimeMs);
        }

        this.ready = true;
        this.events.onReady?.(message.playerId, message.slot);
        this.events.onPlayerCountChange?.(this.playerCount);
        return;
      }

      case 'state': {
        this.serverClock.sync(message.serverTimeMs, now);
        this.snapshotsReceived += 1;
        this.hostTick = message.tick;

        const seen = new Set<PlayerId>();
        for (const player of message.players) {
          seen.add(player.id);
          if (player.id === this.playerId) this.applyAuthoritativeLocal(player);
          else this.upsertRemote(player, message.serverTimeMs);
        }

        for (const id of [...this.remotes.keys()]) {
          if (!seen.has(id)) this.remotes.delete(id);
        }
        return;
      }

      case 'playerJoined':
        this.upsertRemote(message.player, this.serverClock.now(now));
        this.events.onPlayerCountChange?.(this.playerCount);
        return;

      case 'playerLeft':
        this.remotes.delete(message.playerId);
        this.events.onPlayerCountChange?.(this.playerCount);
        return;

      case 'paused':
        this.paused = message.paused;
        this.events.onPaused?.(message.paused);
        return;

      case 'sport':
        this.sport = message.sport;
        this.events.onSportChange?.(message.sport);
        return;

      case 'roster':
        this.roster = message.entries;
        this.reserved = message.reserved;
        this.events.onRosterChange?.(message.entries, message.reserved);
        return;

      case 'drawEnabled':
        this.drawEnabled = message.enabled;
        this.events.onDrawEnabledChange?.(message.enabled);
        return;

      case 'arrows':
        this.arrows = message.arrows;
        this.events.onArrowsChange?.(message.arrows);
        return;

      case 'rejected':
        this.events.onRejected?.(message.reason);
        return;

      case 'pong':
        this.rttMs = Math.max(0, now - message.t);
        return;
    }
  }

  private applyAuthoritativeLocal(authoritative: NetPlayer): void {
    const prediction = this.prediction;
    if (!prediction) return;

    const predicted = prediction.current;
    this.lastAck = authoritative.ack;
    const pending = prediction.drainAcknowledged(authoritative.ack);
    const result = reconcile(authoritative, pending, predicted);

    this.smoother.absorb(predicted.x - result.state.x, predicted.y - result.state.y, result.snapped);
    prediction.setState(result.state);
  }

  private upsertRemote(player: NetPlayer, serverTimeMs: number): void {
    let remote = this.remotes.get(player.id);
    if (!remote) {
      remote = { slot: player.slot, interpolator: new RemoteInterpolator() };
      this.remotes.set(player.id, remote);
    }
    remote.slot = player.slot;
    remote.interpolator.push(serverTimeMs, player.x, player.y, player.vx, player.vy);
  }

  private fallbackState(id: PlayerId, slot: number): PlayerState {
    return { id, slot, x: 0, y: 0, vx: 0, vy: 0 };
  }
}
