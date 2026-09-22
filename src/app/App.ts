import { SIGNALING_URL } from '../config/config';
import {
  DEFAULT_SPORT,
  INPUT_INTERVAL_MS,
  MAX_CATCHUP_TICKS,
  SIM_TICK_MS,
} from '../config/constants';
import type { SportType } from '../config/constants';
import { BotSwarm } from '../dev/Bots';
import type { Game } from '../game/Game';
import { GameLoop } from '../game/GameLoop';
import type { GameSession } from '../game/RenderPlayer';
import { InputManager } from '../input/InputManager';
import { NetworkClient } from '../networking/NetworkClient';
import { NetworkHost } from '../networking/NetworkHost';
import { SignalingClient, SignalingError } from '../networking/SignalingClient';
import { buildIceConfiguration, debugConditions } from '../networking/iceConfig';
import { fromCandidate, fromDescription, toCandidate, toDescription } from '../networking/sdp';
import type { ConnectionState } from '../networking/transport/Transport';
import { WebRTCConnection } from '../networking/transport/WebRTCConnection';
import { basePath, buildInviteUrl, parseJoinPath } from '../room/InviteLink';
import { ConnectionIndicator } from '../ui/ConnectionIndicator';
import { DebugOverlay, botCount, isDebugEnabled } from '../ui/DebugOverlay';
import { FullscreenButton } from '../ui/FullscreenButton';
import { renderHomeScreen } from '../ui/HomeScreen';
import { renderConnecting, renderJoinScreen } from '../ui/JoinGameScreen';
import { renderMessageScreen } from '../ui/MessageScreen';
import { SettingsButton } from '../ui/SettingsButton';
import { SettingsPane } from '../ui/SettingsPane';
import { ShareOverlay } from '../ui/ShareOverlay';
import { clear, el } from '../ui/dom';
import { ScreenWakeLock } from '../utils/wakeLock';

const WELCOME_TIMEOUT_MS = 20_000;

interface Teardown {
  (): void;
}

export class App {
  private readonly teardowns: Teardown[] = [];
  private loop: GameLoop | null = null;

  constructor(
    private readonly uiRoot: HTMLElement,
    private readonly gameRoot: HTMLElement,
  ) {}

  start(): void {
    const base = basePath();
    const pathname = window.location.pathname.startsWith(base)
      ? window.location.pathname.slice(base.length)
      : window.location.pathname;
    const roomId = parseJoinPath(pathname);
    if (roomId) this.showJoin(roomId);
    else this.showHome();
  }

  // --- Screens ----------------------------------------------------------

  private showHome(): void {
    this.reset();
    history.replaceState(null, '', `${basePath()}/${window.location.search}`);
    renderHomeScreen(this.uiRoot, { onCreateGame: () => void this.hostGame() });
  }

  private showJoin(roomId: string): void {
    this.reset();
    renderJoinScreen(this.uiRoot, { onJoin: () => void this.joinGame(roomId) });
  }

  private showMessage(title: string, body: string, retry?: () => void): void {
    this.reset();
    renderMessageScreen(this.uiRoot, {
      title,
      body,
      ...(retry
        ? {
            actionLabel: 'TRY AGAIN',
            onAction: retry,
            secondaryLabel: 'BACK TO START',
            onSecondary: () => this.showHome(),
          }
        : { actionLabel: 'BACK TO START', onAction: () => this.showHome() }),
    });
  }

  // --- Host -------------------------------------------------------------

  private async hostGame(): Promise<void> {
    this.reset();
    renderConnecting(this.uiRoot, 'Creating game...');

    const signaling = new SignalingClient();
    let roomId: string;
    let hostToken: string;
    try {
      await signaling.connect(SIGNALING_URL);
      ({ roomId, hostToken } = await signaling.createRoom());
    } catch {
      signaling.close();
      this.showMessage('Could not create the game', 'The game service is unreachable right now.', () =>
        void this.hostGame(),
      );
      return;
    }

    // Losing signaling does not touch the running game, but without it nobody new can join.
    signaling.enableAutoReconnect(async () => {
      await signaling.reclaimRoom(roomId, hostToken);
    });

    try {
      await this.runHostSession(signaling, roomId);
    } catch (error) {
      // Anything thrown past this point would otherwise strand the player on "Creating game...".
      console.error('[host] failed to start', error);
      signaling.close();
      this.showMessage('Could not start the game', 'Something went wrong setting up the game.', () =>
        void this.hostGame(),
      );
    }
  }

  private async runHostSession(signaling: SignalingClient, roomId: string): Promise<void> {
    let share: ShareOverlay | null = null;
    const host = new NetworkHost({
      // Event-driven so the counter stays correct even while the tab is backgrounded.
      onPlayerCountChange: (count) => share?.setPlayerCount(count),
    });
    const connections = new Map<string, WebRTCConnection>();
    const configuration = buildIceConfiguration();
    const conditions = debugConditions();
    signaling.onMessage((message) => {
      switch (message.type) {
        case 'peerJoined': {
          const peerId = message.peerId;
          const connection = new WebRTCConnection({
            role: 'offerer',
            configuration,
            conditions,
            onLocalCandidate: (candidate) =>
              signaling.send({ type: 'ice', to: peerId, candidate: fromCandidate(candidate) }),
          });
          connections.set(peerId, connection);

          connection.setHandlers({
            onStateChange: (state) => {
              // Only admit the peer once both data channels are actually usable.
              if (state === 'CONNECTED') host.acceptPeer(connection, performance.now());
            },
          });

          void connection
            .createOffer()
            .then((offer) =>
              signaling.send({ type: 'offer', to: peerId, sdp: fromDescription(offer) }),
            );
          return;
        }

        case 'answer':
          void connections.get(message.from)?.acceptAnswer(toDescription(message.sdp));
          return;

        case 'ice':
          void connections.get(message.from)?.addIceCandidate(toCandidate(message.candidate));
          return;

        case 'peerLeft': {
          const connection = connections.get(message.peerId);
          connections.delete(message.peerId);
          // Losing a signaling socket says nothing about an established game, which is
          // peer-to-peer. Only abandon handshakes that never finished.
          if (connection && connection.state !== 'CONNECTED') connection.close();
          return;
        }

        default:
          return;
      }
    });

    clear(this.uiRoot);

    const inviteUrl = buildInviteUrl(roomId, `${window.location.origin}${basePath()}`);
    // Keep any ?debug=1 / ?bots=N flags alive across the rewrite.
    history.replaceState(null, '', `${basePath()}/join/${roomId}${window.location.search}`);

    share = new ShareOverlay(this.uiRoot, inviteUrl);
    share.setPlayerCount(host.playerCount);

    const indicator = new ConnectionIndicator(this.uiRoot);
    indicator.set('CONNECTED');

    // Only the host chooses the field; the choice is broadcast to every connected player.
    let sport: SportType = DEFAULT_SPORT;
    let gameInstance: Game | null = null;
    let settingsPane: SettingsPane | null = null;
    const closeSettings = (): void => {
      settingsPane?.destroy();
      settingsPane = null;
    };
    const settingsButton = new SettingsButton(this.uiRoot, () => {
      if (settingsPane) {
        closeSettings();
        return;
      }
      settingsPane = new SettingsPane(this.uiRoot, sport, {
        onSelect: (next) => {
          sport = next;
          host.setSport(next);
          gameInstance?.setSport(next);
          settingsPane?.setActive(next);
        },
        onClose: closeSettings,
      });
    });

    const wakeLock = new ScreenWakeLock();
    void wakeLock.acquire();

    const bots = new BotSwarm(host, botCount(), performance.now());

    const onVisibility = (): void => {
      const now = performance.now();
      // A backgrounded host cannot simulate; pause cleanly instead of freezing everyone.
      host.setPaused(document.hidden, now);
      if (!document.hidden) this.loop?.resetClock();
      indicator.setPaused(document.hidden);
    };
    document.addEventListener('visibilitychange', onVisibility);
    // No event fires if the tab was already hidden when the game started.
    onVisibility();

    this.teardowns.push(
      () => document.removeEventListener('visibilitychange', onVisibility),
      () => bots.destroy(),
      () => wakeLock.destroy(),
      () => share?.destroy(),
      () => indicator.destroy(),
      () => closeSettings(),
      () => settingsButton.destroy(),
      () => {
        for (const connection of connections.values()) connection.close();
      },
      () => signaling.close(),
      () => host.destroy(),
    );

    await this.runGame(host, {
      role: 'host',
      initialSport: sport,
      onGameReady: (game) => {
        gameInstance = game;
      },
      onTick: (_dt, now) => host.step(now),
      onFrame: (now) => {
        host.afterFrame(now);
        bots.update(now);
      },
      stats: () => ({
        connection: 'CONNECTED' as ConnectionState,
        tick: host.currentTick,
        rttMs: 0,
        sequence: 0,
        lastAck: 0,
        players: host.playerCount,
        snapshots: host.snapshotCount,
      }),
    });
  }

  // --- Client -----------------------------------------------------------

  private async joinGame(roomId: string): Promise<void> {
    this.reset();
    renderConnecting(this.uiRoot, 'Joining game...');

    const signaling = new SignalingClient();
    let hostId: string;
    try {
      await signaling.connect(SIGNALING_URL);
      ({ hostId } = await signaling.joinRoom(roomId));
    } catch (error) {
      signaling.close();
      const retry = (): void => void this.joinGame(roomId);

      if (error instanceof SignalingError && error.reason === 'full') {
        this.showMessage('Game is full', 'This game already has the maximum number of players.', retry);
      } else if (error instanceof SignalingError && error.reason === 'hostOffline') {
        this.showMessage(
          'Host is reconnecting',
          'The player who created this game briefly lost connection. Try again in a moment.',
          retry,
        );
      } else if (error instanceof SignalingError && error.reason === 'notFound') {
        this.showMessage('Game not found', 'This invite has expired or the game already ended.');
      } else {
        this.showMessage('Could not join', 'The game service is unreachable right now.', retry);
      }
      return;
    }

    const connection = new WebRTCConnection({
      role: 'answerer',
      configuration: buildIceConfiguration(),
      conditions: debugConditions(),
      onLocalCandidate: (candidate) =>
        signaling.send({ type: 'ice', to: hostId, candidate: fromCandidate(candidate) }),
    });

    const indicator = new ConnectionIndicator(this.uiRoot);
    let started = false;
    let connectionState: ConnectionState = 'CONNECTING';
    // Signaling can only hint that the host left; the peer connection is what proves it.
    let hostLeftSignaling = false;
    let sport: SportType = DEFAULT_SPORT;
    let gameInstance: Game | null = null;

    const client = new NetworkClient(connection, {
      onConnectionState: (state) => {
        connectionState = state;
        indicator.set(state);

        const lost = state === 'DISCONNECTED' || state === 'FAILED';
        if (lost && hostLeftSignaling) {
          this.showMessage('Host disconnected', 'The player who created this game has left.');
        }
      },
      onRejected: () => {
        this.showMessage('Game is full', 'This game already has the maximum number of players.');
      },
      onSportChange: (next) => {
        sport = next;
        gameInstance?.setSport(next);
      },
      onReady: () => {
        if (started) return;
        started = true;
        clearTimeout(timeout);
        void this.startClientGame(client, roomId, () => connectionState, connection, sport, (game) => {
          gameInstance = game;
        });
      },
    });

    const timeout = setTimeout(() => {
      if (started) return;
      this.showMessage(
        'Could not join',
        'We could not reach the host. Check they still have the game open.',
        () => void this.joinGame(roomId),
      );
    }, WELCOME_TIMEOUT_MS);

    signaling.onMessage((message) => {
      switch (message.type) {
        case 'offer':
          if (message.from !== hostId) return;
          void connection
            .acceptOffer(toDescription(message.sdp))
            .then((answer) =>
              signaling.send({ type: 'answer', to: hostId, sdp: fromDescription(answer) }),
            );
          return;

        case 'ice':
          if (message.from !== hostId) return;
          void connection.addIceCandidate(toCandidate(message.candidate));
          return;

        case 'peerLeft':
          if (message.peerId !== hostId) return;
          // Do not tear down a working game just because a websocket dropped.
          hostLeftSignaling = true;
          return;

        default:
          return;
      }
    });

    this.teardowns.push(
      () => clearTimeout(timeout),
      () => indicator.destroy(),
      () => signaling.close(),
      () => client.destroy(),
    );
  }

  private async startClientGame(
    client: NetworkClient,
    roomId: string,
    connectionState: () => ConnectionState,
    connection: WebRTCConnection,
    initialSport: SportType,
    onGameReady: (game: Game) => void,
  ): Promise<void> {
    clear(this.uiRoot);

    const indicator = new ConnectionIndicator(this.uiRoot);
    indicator.set(connectionState());
    indicator.setRetryHandler(() => void this.joinGame(roomId));
    this.teardowns.push(() => indicator.destroy());

    await this.runGame(client, {
      role: 'client',
      initialSport,
      onGameReady,
      onTick: () => {},
      onFrame: (now) => {
        client.afterFrame(now);
        indicator.set(connectionState());
        indicator.setPaused(client.isPaused);
      },
      stats: () => ({
        connection: connectionState(),
        tick: client.currentTick,
        rttMs: client.roundTripMs,
        sequence: client.lastSequence,
        lastAck: client.lastAcknowledged,
        players: client.playerCount,
        snapshots: client.snapshotCount,
      }),
    });

    if (window.__pocketArena) {
      window.__pocketArena.dropConnection = () => connection.close();
    }
  }

  // --- Shared game runtime ----------------------------------------------

  private async runGame(
    session: GameSession,
    options: {
      role: 'host' | 'client';
      initialSport?: SportType;
      onGameReady?: (game: Game) => void;
      onTick: (dt: number, nowMs: number) => void;
      onFrame: (nowMs: number) => void;
      stats: () => {
        connection: ConnectionState;
        tick: number;
        rttMs: number;
        sequence: number;
        lastAck: number;
        players: number;
        snapshots: number;
      };
    },
  ): Promise<void> {
    const input = InputManager.create(this.uiRoot);
    const debug = isDebugEnabled() ? new DebugOverlay(this.uiRoot) : null;

    const rotateHint = el('div', 'rotate-hint', 'Rotate your device for a bigger view');
    this.uiRoot.append(rotateHint);

    // Phaser is only pulled in once a game actually starts, so the entry screens paint instantly.
    const { Game: GameClass } = await import('../game/Game');
    const game = new GameClass(
      this.gameRoot,
      { renderPlayers: (nowMs) => session.renderPlayers(nowMs) },
      options.initialSport,
    );
    options.onGameReady?.(game);

    const fullscreen = game.isFullscreenSupported
      ? new FullscreenButton(this.uiRoot, () => game.toggleFullscreen())
      : null;

    let lastInputAtMs = performance.now();
    let statsWindowStart = performance.now();
    let statsWindowSnapshots = options.stats().snapshots;

    const loop = new GameLoop({
      tickMs: SIM_TICK_MS,
      maxCatchupTicks: MAX_CATCHUP_TICKS,
      onTick: (dt) => {
        options.onTick(dt, performance.now());
      },
      onFrame: () => {
        const now = performance.now();
        options.onFrame(now);

        // Paced off the wall clock, not the tick count: accumulating 33ms ticks against a
        // 50ms threshold only fires every second tick, which is 15Hz rather than INPUT_HZ.
        const sinceInputMs = now - lastInputAtMs;
        if (sinceInputMs >= INPUT_INTERVAL_MS) {
          session.submitInput(input.read(), sinceInputMs / 1000);
          lastInputAtMs = now;
        }

        if (!debug) return;
        const stats = options.stats();
        const elapsed = now - statsWindowStart;
        if (elapsed >= 1000) {
          statsWindowStart = now;
          statsWindowSnapshots = stats.snapshots;
        }
        debug.update({
          role: options.role,
          connection: stats.connection,
          tick: stats.tick,
          rttMs: stats.rttMs,
          sequence: stats.sequence,
          lastAck: stats.lastAck,
          players: stats.players,
          snapshotHz:
            elapsed > 0 ? ((stats.snapshots - statsWindowSnapshots) * 1000) / elapsed : 0,
        });
      },
    });

    loop.start();
    this.loop = loop;

    // Read-only view for end-to-end tests. Only exists behind ?debug=1.
    if (debug) {
      window.__pocketArena = {
        role: options.role,
        localPlayerId: () => session.localPlayerId,
        players: () => session.renderPlayers(performance.now()),
        cameraScroll: () => game.cameraScroll(),
      };
    }

    this.teardowns.push(
      () => loop.stop(),
      () => game.destroy(),
      () => input.destroy(),
      () => debug?.destroy(),
      () => fullscreen?.destroy(),
      () => rotateHint.remove(),
      () => delete window.__pocketArena,
    );
  }

  private reset(): void {
    while (this.teardowns.length > 0) {
      const teardown = this.teardowns.pop();
      try {
        teardown?.();
      } catch {
        // Teardown is best-effort; one failure must not block the rest.
      }
    }
    this.loop = null;
    clear(this.uiRoot);
    clear(this.gameRoot);
  }
}
