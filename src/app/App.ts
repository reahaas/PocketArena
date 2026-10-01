import { SIGNALING_URL } from '../config/config';
import {
  DEFAULT_SPORT,
  DEFAULT_STEP_DURATION_MS,
  INPUT_INTERVAL_MS,
  MAX_CATCHUP_TICKS,
  MAX_PLAYBOOK_PLAYERS_PER_TEAM,
  MAX_STEPS_PER_ASSIGNMENT,
  NUMBER_MAX,
  NUMBER_MIN,
  PLAYBOOK_EXPORT_FPS,
  PLAYBOOK_EXPORT_TAIL_MS,
  PLAYBOOK_MAX_DURATION_MS,
  SIM_TICK_MS,
} from '../config/constants';
import type { SportType, TeamId } from '../config/constants';
import { BotSwarm } from '../dev/Bots';
import type { Game } from '../game/Game';
import { GameLoop } from '../game/GameLoop';
import type { GameSession } from '../game/RenderPlayer';
import { InputManager } from '../input/InputManager';
import { recordCanvasToVideo, downloadBlob } from '../media/PlaybookVideoExport';
import { NetworkClient } from '../networking/NetworkClient';
import { NetworkHost } from '../networking/NetworkHost';
import type {
  PlaybookAssignment,
  PlaybookGrade,
  Play,
  ReservedNumber,
  RosterEntry,
} from '../networking/NetworkProtocol';
import { SignalingClient, SignalingError } from '../networking/SignalingClient';
import { buildIceConfiguration, debugConditions } from '../networking/iceConfig';
import { fromCandidate, fromDescription, toCandidate, toDescription } from '../networking/sdp';
import type { ConnectionState } from '../networking/transport/Transport';
import { WebRTCConnection } from '../networking/transport/WebRTCConnection';
import { basePath, buildInviteUrl, parseJoinPath } from '../room/InviteLink';
import { generatePlayerId } from '../room/RoomId';
import {
  exportPlay,
  importPlayFromFile,
  loadPlays,
  sanitizeFilename,
  savePlays,
} from '../storage/PlaybookStorage';
import { ConnectionIndicator } from '../ui/ConnectionIndicator';
import { DebugOverlay, botCount, isDebugEnabled } from '../ui/DebugOverlay';
import { FullscreenButton } from '../ui/FullscreenButton';
import { renderHomeScreen } from '../ui/HomeScreen';
import { renderConnecting, renderJoinScreen } from '../ui/JoinGameScreen';
import { renderMessageScreen } from '../ui/MessageScreen';
import { NumberPane } from '../ui/NumberPane';
import { PlaybookButton } from '../ui/PlaybookButton';
import { PlaybookCountdownOverlay } from '../ui/PlaybookCountdownOverlay';
import type { PlaybookEditorPlayer, PlaybookStepStage } from '../ui/PlaybookEditor';
import { PlaybookEditor, teamNumberKey } from '../ui/PlaybookEditor';
import { PlaybookInstructions } from '../ui/PlaybookInstructions';
import { PlaybookPane } from '../ui/PlaybookPane';
import { PlaybookResultsPane } from '../ui/PlaybookResultsPane';
import { PlayerToolsButton } from '../ui/PlayerToolsButton';
import { PlayerToolsPane } from '../ui/PlayerToolsPane';
import { SettingsButton } from '../ui/SettingsButton';
import { SettingsPane } from '../ui/SettingsPane';
import { ShareOverlay } from '../ui/ShareOverlay';
import { clear, el } from '../ui/dom';
import { clamp } from '../utils/math';
import { ScreenWakeLock } from '../utils/wakeLock';

const WELCOME_TIMEOUT_MS = 20_000;

/**
 * Shared by host and client: once a play is launched, every device reacts the same way —
 * show the countdown, then the ghost path, then the results — regardless of who is authoring it.
 */
interface PlaybookViewController {
  handleRun(play: Play, startAtLocalMs: number, countdownMs: number): void;
  handleResult(playName: string, grades: PlaybookGrade[]): void;
  handleCancel(): void;
  /** Re-pushes the in-progress run to the game layer — for a `Game` that only just became ready. */
  reapply(): void;
  teardown(): void;
}

function createPlaybookViewController(
  uiRoot: HTMLElement,
  getGame: () => Game | null,
  getMyRosterEntry: () => RosterEntry | undefined,
): PlaybookViewController {
  let countdown: PlaybookCountdownOverlay | null = null;
  let results: PlaybookResultsPane | null = null;
  // Needed because a client's `Game` can finish initializing after a run already started.
  let activePlay: Play | null = null;
  let activeStartAtLocalMs: number | null = null;

  const clearCountdown = (): void => {
    countdown?.destroy();
    countdown = null;
  };
  const clearResults = (): void => {
    results?.destroy();
    results = null;
  };
  const pushLiveView = (): void => {
    const mine = getMyRosterEntry();
    getGame()?.setPlaybookLiveView(activePlay, activePlay ? mine?.team ?? null : null, activePlay ? mine?.number ?? null : null);
    getGame()?.setPlaybookLiveStart(activeStartAtLocalMs);
  };
  const clearLiveView = (): void => {
    activePlay = null;
    activeStartAtLocalMs = null;
    pushLiveView();
  };

  return {
    handleRun(play, startAtLocalMs) {
      clearResults();
      clearCountdown();
      activePlay = play;
      activeStartAtLocalMs = startAtLocalMs;
      pushLiveView();
      countdown = new PlaybookCountdownOverlay(uiRoot, play.name, startAtLocalMs, () => {
        countdown = null;
      });
    },
    handleResult(playName, grades) {
      clearCountdown();
      clearLiveView();
      clearResults();
      results = new PlaybookResultsPane(uiRoot, playName, grades, clearResults);
    },
    handleCancel() {
      clearCountdown();
      clearLiveView();
    },
    reapply() {
      pushLiveView();
    },
    teardown() {
      clearCountdown();
      clearResults();
    },
  };
}

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
    renderHomeScreen(this.uiRoot, {
      onCreateGame: () => void this.hostGame(),
      onOpenPlaybook: () => void this.runPlaybookStudio(),
    });
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
    let roster: RosterEntry[] = [];
    let reserved: ReservedNumber[] = [];
    let gameInstance: Game | null = null;
    let settingsPane: SettingsPane | null = null;
    let numberPane: NumberPane | null = null;
    let playerToolsPane: PlayerToolsPane | null = null;
    let input: InputManager | null = null;
    let inDrawMode = false;
    let drawEnabledForAll = false;

    let playbookLibrary: Play[] = loadPlays();
    let playbookPane: PlaybookPane | null = null;

    const host = new NetworkHost({
      // Event-driven so the counter stays correct even while the tab is backgrounded.
      onPlayerCountChange: (count) => share?.setPlayerCount(count),
      onRosterChange: (entries, reservedNumbers) => {
        roster = entries;
        reserved = reservedNumbers;
        gameInstance?.setRoster(roster);
        refreshNumberPane();
        refreshPlayerToolsPane();
      },
      onDrawEnabledChange: (enabled) => {
        drawEnabledForAll = enabled;
        settingsPane?.setDrawEnabled(enabled);
      },
      onArrowsChange: (arrows) => gameInstance?.setArrows(arrows),
      onPlaybookRun: (play, startAtMs, countdownMs) =>
        playbookView.handleRun(play, startAtMs, countdownMs),
      onPlaybookResult: (_playId, playName, grades) => playbookView.handleResult(playName, grades),
      onPlaybookCancel: () => playbookView.handleCancel(),
    });
    roster = host.currentRoster;
    reserved = host.currentReservedNumbers;
    drawEnabledForAll = host.currentDrawEnabled;

    const myRosterEntry = (): RosterEntry | undefined =>
      roster.find((entry) => entry.playerId === host.localPlayerId);

    const playbookView = createPlaybookViewController(this.uiRoot, () => gameInstance, myRosterEntry);

    const takenNumbers = (): Set<number> =>
      this.takenNumbersForMyTeam(host.localPlayerId, myRosterEntry()?.team ?? 'A', roster, reserved);

    const closeNumberPane = (): void => {
      numberPane?.destroy();
      numberPane = null;
    };
    const refreshNumberPane = (): void => {
      numberPane?.update(myRosterEntry()?.number ?? 0, takenNumbers());
    };
    const openNumberPane = (): void => {
      closeNumberPane();
      numberPane = new NumberPane(this.uiRoot, myRosterEntry()?.number ?? 0, takenNumbers(), {
        onSelect: (number) => host.claimNumberForSelf(number),
        onClose: closeNumberPane,
      });
    };

    const closePlayerTools = (): void => {
      closeNumberPane();
      playerToolsPane?.destroy();
      playerToolsPane = null;
    };
    const renderPlayerToolsPane = (): void => {
      const mine = myRosterEntry();
      playerToolsPane = new PlayerToolsPane(this.uiRoot, {
        team: mine?.team ?? 'A',
        number: mine?.number ?? 0,
        // The host can always open the tactics board, whether or not it is open to others.
        canDraw: true,
        inDrawMode,
        onChangeNumber: openNumberPane,
        onToggleDrawMode: () => setLocalDrawMode(!inDrawMode),
        onClearMine: () => host.clearMyDrawings(),
        onClose: closePlayerTools,
      });
    };
    const refreshPlayerToolsPane = (): void => {
      if (!playerToolsPane) return;
      playerToolsPane.destroy();
      renderPlayerToolsPane();
    };
    const togglePlayerTools = (): void => {
      if (playerToolsPane) {
        closePlayerTools();
        return;
      }
      renderPlayerToolsPane();
    };

    const setLocalDrawMode = (enabled: boolean): void => {
      inDrawMode = enabled;
      input?.setJoystickEnabled(!enabled);
      gameInstance?.setDrawMode(enabled, (x1, y1, x2, y2) => host.addArrow(x1, y1, x2, y2));
      playerToolsPane?.setDrawMode(enabled);
    };

    // --- Playbook (host-only: run a saved play against whoever is connected) -------------
    // Creating/editing a play happens entirely offline from the main menu's Playbook studio —
    // this in-room pane only lists the shared library and launches a run.

    const closePlaybookPane = (): void => {
      playbookPane?.destroy();
      playbookPane = null;
    };

    const openPlaybookPane = (): void => {
      closePlaybookPane();
      playbookLibrary = loadPlays();
      playbookPane = new PlaybookPane(this.uiRoot, playbookLibrary, {
        onRun: (play) => {
          closePlaybookPane();
          host.runPlaybook(play);
        },
        onExport: (play) => exportPlay(play),
        onImport: (file) => {
          void importPlayFromFile(file).then((play) => {
            if (!play) return;
            playbookLibrary = [play, ...playbookLibrary];
            savePlays(playbookLibrary);
            playbookPane?.update(playbookLibrary);
          });
        },
        onDelete: (play) => {
          playbookLibrary = playbookLibrary.filter((p) => p.id !== play.id);
          savePlays(playbookLibrary);
          playbookPane?.update(playbookLibrary);
        },
        onClose: closePlaybookPane,
      });
    };

    const togglePlaybookPane = (): void => {
      if (playbookPane) {
        closePlaybookPane();
        return;
      }
      openPlaybookPane();
    };

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
    const closeSettings = (): void => {
      settingsPane?.destroy();
      settingsPane = null;
    };
    const settingsButton = new SettingsButton(this.uiRoot, () => {
      if (settingsPane) {
        closeSettings();
        return;
      }
      settingsPane = new SettingsPane(this.uiRoot, sport, drawEnabledForAll, {
        onSelect: (next) => {
          sport = next;
          host.setSport(next);
          gameInstance?.setSport(next);
          settingsPane?.setActive(next);
        },
        onToggleDrawEnabled: (enabled) => host.setDrawEnabled(enabled),
        onClearAll: () => host.clearAllDrawings(),
        onClose: closeSettings,
      });
    });

    const playerToolsButton = new PlayerToolsButton(this.uiRoot, togglePlayerTools);
    const playbookButton = new PlaybookButton(this.uiRoot, togglePlaybookPane);

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
      () => closePlayerTools(),
      () => playerToolsButton.destroy(),
      () => closePlaybookPane(),
      () => playbookButton.destroy(),
      () => playbookView.teardown(),
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
        game.setRoster(roster);
        game.setArrows([...host.currentArrows]);
        playbookView.reapply();
      },
      onInputReady: (im) => {
        input = im;
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

  // --- Playbook studio (fully offline, no room/network involved) --------

  /**
   * Launches the coach's play designer straight from the main menu. It gets its own bare Phaser
   * field — no NetworkHost, no InputManager/joystick, no simulation loop — so building a play has
   * nothing to do with a live room. Saved plays land in the same localStorage library a host can
   * later open in-room to run against whoever is connected.
   */
  private async runPlaybookStudio(): Promise<void> {
    this.reset();

    let playbookLibrary: Play[] = loadPlays();
    let playbookPane: PlaybookPane | null = null;
    let playbookEditor: PlaybookEditor | null = null;
    let playbookInstructions: PlaybookInstructions | null = null;
    let editorPlayers: PlaybookEditorPlayer[] = [];
    let draftAssignments = new Map<string, PlaybookAssignment>();
    let armedTarget: PlaybookEditorPlayer | null = null;
    let pendingStage: PlaybookStepStage = 'start';
    let pendingStart: { x: number; y: number } | null = null;
    let pendingEnd: { x: number; y: number } | null = null;
    let previewTimer: ReturnType<typeof setTimeout> | null = null;
    let gameInstance: Game | null = null;

    const nextNumberForTeam = (team: TeamId): number | null => {
      const used = new Set(editorPlayers.filter((p) => p.team === team).map((p) => p.number));
      if (used.size >= MAX_PLAYBOOK_PLAYERS_PER_TEAM) return null;
      for (let number = NUMBER_MIN; number <= NUMBER_MAX; number++) {
        if (!used.has(number)) return number;
      }
      return null;
    };

    const refreshEditorPlayers = (): void => {
      playbookEditor?.setPlayers(editorPlayers, armedTarget, armPlaybookPlayer, removePlaybookPlayer);
      gameInstance?.setPlaybookEditPlayers(editorPlayers);
    };

    const refreshEditorPaths = (): void => {
      const assignments = [...draftAssignments.values()].filter((a) => a.steps.length > 0);
      gameInstance?.setPlaybookEditAssignments(assignments);
    };

    const lastStepOf = (target: PlaybookEditorPlayer) => {
      const steps = draftAssignments.get(teamNumberKey(target.team, target.number))?.steps ?? [];
      if (steps.length === 0) return null;
      return [...steps].sort((a, b) => a.startMs - b.startMs)[steps.length - 1]!;
    };

    const stepSummary = (target: PlaybookEditorPlayer | null): string => {
      if (!target) return 'Add a player, then arm them to start placing steps.';
      const steps = draftAssignments.get(teamNumberKey(target.team, target.number))?.steps ?? [];
      if (steps.length === 0) return `#${target.number}: no steps yet — tap the field to set Start, then End.`;
      const totalMs = Math.max(...steps.map((s) => s.startMs + s.durationMs));
      return `#${target.number}: ${steps.length} step${steps.length === 1 ? '' : 's'} · ${(totalMs / 1000).toFixed(1)}s total.`;
    };

    const refreshPendingUI = (): void => {
      playbookEditor?.setStage(pendingStage);
      playbookEditor?.setPendingReadout(pendingStart, pendingEnd);
      playbookEditor?.setCanAddStep(pendingStart !== null && pendingEnd !== null);
      gameInstance?.setPlaybookPendingPoints(pendingStart, pendingEnd);
    };

    const resetPending = (prefillStart: { x: number; y: number } | null): void => {
      pendingStage = prefillStart ? 'end' : 'start';
      pendingStart = prefillStart;
      pendingEnd = null;
      refreshPendingUI();
    };

    const onPlaybookFieldTap = (x: number, y: number): void => {
      if (!armedTarget) return;
      if (pendingStage === 'start') {
        pendingStart = { x, y };
        pendingStage = 'end';
      } else {
        pendingEnd = { x, y };
      }
      refreshPendingUI();
    };

    const setPlaybookStage = (stage: PlaybookStepStage): void => {
      pendingStage = stage;
      refreshPendingUI();
    };

    const armPlaybookPlayer = (target: PlaybookEditorPlayer | null): void => {
      armedTarget = target;
      playbookEditor?.setArmed(target);
      playbookEditor?.setSummary(stepSummary(target));
      playbookEditor?.setStatus('');

      const last = target ? lastStepOf(target) : null;
      resetPending(last ? { x: last.toX, y: last.toY } : null);
      const nextStartSeconds = last ? (last.startMs + last.durationMs) / 1000 : 0;
      playbookEditor?.setTimingDefaults(nextStartSeconds, DEFAULT_STEP_DURATION_MS / 1000);

      gameInstance?.setPlaybookEditMode(true, target, onPlaybookFieldTap);
      refreshEditorPlayers();
    };

    const addPlaybookPlayer = (team: TeamId): void => {
      const number = nextNumberForTeam(team);
      if (number === null) return;
      editorPlayers = [...editorPlayers, { team, number }];
      refreshEditorPlayers();
    };

    const removePlaybookPlayer = (target: PlaybookEditorPlayer): void => {
      editorPlayers = editorPlayers.filter((p) => !(p.team === target.team && p.number === target.number));
      draftAssignments.delete(teamNumberKey(target.team, target.number));
      if (armedTarget && armedTarget.team === target.team && armedTarget.number === target.number) {
        armPlaybookPlayer(null);
        return;
      }
      refreshEditorPlayers();
      refreshEditorPaths();
    };

    const addPlaybookStep = (startSeconds: number, durationSeconds: number): void => {
      if (!armedTarget || !pendingStart || !pendingEnd) return;
      const key = teamNumberKey(armedTarget.team, armedTarget.number);
      let assignment = draftAssignments.get(key);
      if (!assignment) {
        assignment = { team: armedTarget.team, number: armedTarget.number, steps: [] };
        draftAssignments.set(key, assignment);
      }
      if (assignment.steps.length >= MAX_STEPS_PER_ASSIGNMENT) {
        playbookEditor?.setStatus('This player already has the maximum number of steps.');
        return;
      }

      const startMs = clamp(Math.round(startSeconds * 1000), 0, PLAYBOOK_MAX_DURATION_MS);
      const durationMs = clamp(Math.round(durationSeconds * 1000), 100, PLAYBOOK_MAX_DURATION_MS);
      assignment.steps.push({
        startMs,
        durationMs,
        fromX: pendingStart.x,
        fromY: pendingStart.y,
        toX: pendingEnd.x,
        toY: pendingEnd.y,
      });

      refreshEditorPaths();
      playbookEditor?.setSummary(stepSummary(armedTarget));
      playbookEditor?.setStatus('Step added.');
      resetPending({ x: pendingEnd.x, y: pendingEnd.y });
      playbookEditor?.setTimingDefaults((startMs + durationMs) / 1000, durationSeconds || DEFAULT_STEP_DURATION_MS / 1000);
    };

    const undoPlaybookStep = (): void => {
      if (!armedTarget) return;
      const steps = draftAssignments.get(teamNumberKey(armedTarget.team, armedTarget.number))?.steps;
      steps?.sort((a, b) => a.startMs - b.startMs).pop();
      refreshEditorPaths();
      playbookEditor?.setSummary(stepSummary(armedTarget));
    };

    const clearPlaybookPath = (): void => {
      if (!armedTarget) return;
      draftAssignments.get(teamNumberKey(armedTarget.team, armedTarget.number))?.steps.splice(0);
      refreshEditorPaths();
      playbookEditor?.setSummary(stepSummary(armedTarget));
      resetPending(null);
      playbookEditor?.setTimingDefaults(0, DEFAULT_STEP_DURATION_MS / 1000);
    };

    const stopPlaybookPreview = (): void => {
      if (previewTimer !== null) {
        clearTimeout(previewTimer);
        previewTimer = null;
      }
      gameInstance?.setPlaybookPreview(null, null);
    };

    const buildDraftPlay = (name: string): Play | null => {
      const assignments = [...draftAssignments.values()].filter((a) => a.steps.length > 0);
      if (assignments.length === 0) return null;
      const maxEndMs = Math.max(...assignments.flatMap((a) => a.steps.map((s) => s.startMs + s.durationMs)));
      const durationMs = clamp(maxEndMs, DEFAULT_STEP_DURATION_MS, PLAYBOOK_MAX_DURATION_MS);
      return { id: generatePlayerId(), name: name || 'Untitled Play', durationMs, assignments };
    };

    const startPlaybookPreview = (record: boolean): void => {
      const play = buildDraftPlay(playbookEditor?.nameInput.value.trim() ?? '');
      if (!play) {
        playbookEditor?.setStatus('Add at least one step before previewing.');
        return;
      }

      stopPlaybookPreview();
      const startAtMs = performance.now();
      gameInstance?.setPlaybookPreview(play, startAtMs);
      const totalMs = play.durationMs + PLAYBOOK_EXPORT_TAIL_MS;

      if (!record) {
        playbookEditor?.setStatus('Previewing...');
        previewTimer = setTimeout(() => {
          stopPlaybookPreview();
          playbookEditor?.setStatus('');
        }, totalMs);
        return;
      }

      const canvas = gameInstance?.canvasElement;
      if (!canvas) {
        stopPlaybookPreview();
        playbookEditor?.setStatus('Video export is not supported on this device.');
        return;
      }

      playbookEditor?.setStatus('Recording video...');
      void recordCanvasToVideo(canvas, totalMs, PLAYBOOK_EXPORT_FPS).then((blob) => {
        stopPlaybookPreview();
        if (!blob) {
          playbookEditor?.setStatus('Video export is not supported on this device.');
          return;
        }
        downloadBlob(blob, `${sanitizeFilename(play.name)}.webm`);
        playbookEditor?.setStatus('Video saved — share it to show friends the play.');
      });
    };

    const closePlaybookInstructions = (): void => {
      playbookInstructions?.destroy();
      playbookInstructions = null;
    };

    const openPlaybookInstructions = (): void => {
      closePlaybookInstructions();
      playbookInstructions = new PlaybookInstructions(this.uiRoot, closePlaybookInstructions);
    };

    const closePlaybookEditor = (): void => {
      stopPlaybookPreview();
      closePlaybookInstructions();
      playbookEditor?.destroy();
      playbookEditor = null;
      armedTarget = null;
      pendingStart = null;
      pendingEnd = null;
      gameInstance?.setPlaybookEditMode(false, null, () => undefined);
      gameInstance?.setPlaybookEditAssignments([]);
      gameInstance?.setPlaybookEditPlayers([]);
      gameInstance?.setPlaybookPendingPoints(null, null);
      gameInstance?.setBottomInset(0);
    };

    const closePlaybookPane = (): void => {
      playbookPane?.destroy();
      playbookPane = null;
    };

    const openPlaybookEditor = (): void => {
      closePlaybookPane();
      closePlaybookEditor();
      editorPlayers = [];
      draftAssignments = new Map();
      armedTarget = null;
      pendingStage = 'start';
      pendingStart = null;
      pendingEnd = null;

      playbookEditor = new PlaybookEditor(this.uiRoot, {
        onAddPlayer: addPlaybookPlayer,
        onRemovePlayer: removePlaybookPlayer,
        onArm: armPlaybookPlayer,
        onSetStage: setPlaybookStage,
        onAddStep: addPlaybookStep,
        onUndoStep: undoPlaybookStep,
        onClearPath: clearPlaybookPath,
        onSave: (name) => savePlaybookDraft(name),
        onPreview: () => startPlaybookPreview(false),
        onExportVideo: () => startPlaybookPreview(true),
        onHelp: openPlaybookInstructions,
        onCancel: () => {
          closePlaybookEditor();
          openPlaybookPane();
        },
        onHeightChange: (heightPx) => gameInstance?.setBottomInset(heightPx),
      });

      refreshEditorPlayers();
      refreshEditorPaths();
      playbookEditor.setTimingDefaults(0, DEFAULT_STEP_DURATION_MS / 1000);
      gameInstance?.setPlaybookEditMode(true, null, onPlaybookFieldTap);
      gameInstance?.setPlaybookEditAssignments([]);
    };

    const savePlaybookDraft = (name: string): void => {
      const play = buildDraftPlay(name);
      if (!play) {
        playbookEditor?.setStatus('Add at least one step before saving.');
        return;
      }

      playbookLibrary = [play, ...playbookLibrary];
      savePlays(playbookLibrary);
      closePlaybookEditor();
      openPlaybookPane();
    };

    const openPlaybookPane = (): void => {
      closePlaybookEditor();
      closePlaybookPane();
      playbookPane = new PlaybookPane(this.uiRoot, playbookLibrary, {
        onNew: openPlaybookEditor,
        onExport: (play) => exportPlay(play),
        onImport: (file) => {
          void importPlayFromFile(file).then((play) => {
            if (!play) return;
            playbookLibrary = [play, ...playbookLibrary];
            savePlays(playbookLibrary);
            playbookPane?.update(playbookLibrary);
          });
        },
        onDelete: (play) => {
          playbookLibrary = playbookLibrary.filter((p) => p.id !== play.id);
          savePlays(playbookLibrary);
          playbookPane?.update(playbookLibrary);
        },
        onClose: () => this.showHome(),
      });
    };

    clear(this.uiRoot);

    // Phaser is only pulled in once a game actually starts, so the entry screens paint instantly.
    const { Game: GameClass } = await import('../game/Game');
    const game = new GameClass(this.gameRoot, { renderPlayers: () => [] });
    gameInstance = game;

    const fullscreen = game.isFullscreenSupported
      ? new FullscreenButton(this.uiRoot, () => game.toggleFullscreen())
      : null;

    this.teardowns.push(
      () => closePlaybookEditor(),
      () => closePlaybookPane(),
      () => fullscreen?.destroy(),
      () => game.destroy(),
    );

    openPlaybookPane();
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
    let input: InputManager | null = null;
    let roster: RosterEntry[] = [];
    let reserved: ReservedNumber[] = [];
    let drawEnabledForAll = false;
    let inDrawMode = false;
    let numberPane: NumberPane | null = null;
    let playerToolsPane: PlayerToolsPane | null = null;

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
      onRosterChange: (entries, reservedNumbers) => {
        roster = entries;
        reserved = reservedNumbers;
        gameInstance?.setRoster(roster);
        refreshNumberPane();
        refreshPlayerToolsPane();
      },
      onDrawEnabledChange: (enabled) => {
        drawEnabledForAll = enabled;
        // The host closed the board to everyone else; a client mid-drawing must stop too.
        if (!enabled && inDrawMode) setLocalDrawMode(false);
        refreshPlayerToolsPane();
      },
      onArrowsChange: (arrows) => gameInstance?.setArrows(arrows),
      onPlaybookRun: (play, localStartAtMs, countdownMs) =>
        playbookView.handleRun(play, localStartAtMs, countdownMs),
      onPlaybookResult: (_playId, playName, grades) => playbookView.handleResult(playName, grades),
      onPlaybookCancel: () => playbookView.handleCancel(),
      onReady: () => {
        if (started) return;
        started = true;
        clearTimeout(timeout);
        roster = [...client.currentRoster];
        reserved = [...client.currentReservedNumbers];
        drawEnabledForAll = client.currentDrawEnabled;
        void this.startClientGame(
          client,
          roomId,
          () => connectionState,
          connection,
          sport,
          (game) => {
            gameInstance = game;
            playbookView.reapply();
          },
          (im) => {
            input = im;
          },
          togglePlayerTools,
        );
      },
    });

    const myRosterEntry = (): RosterEntry | undefined =>
      roster.find((entry) => entry.playerId === client.localPlayerId);

    const playbookView = createPlaybookViewController(this.uiRoot, () => gameInstance, myRosterEntry);

    const takenNumbers = (): Set<number> =>
      this.takenNumbersForMyTeam(client.localPlayerId, myRosterEntry()?.team ?? 'A', roster, reserved);

    const closeNumberPane = (): void => {
      numberPane?.destroy();
      numberPane = null;
    };
    const refreshNumberPane = (): void => {
      numberPane?.update(myRosterEntry()?.number ?? 0, takenNumbers());
    };
    const openNumberPane = (): void => {
      closeNumberPane();
      numberPane = new NumberPane(this.uiRoot, myRosterEntry()?.number ?? 0, takenNumbers(), {
        onSelect: (number) => client.requestNumber(number),
        onClose: closeNumberPane,
      });
    };

    const closePlayerTools = (): void => {
      closeNumberPane();
      playerToolsPane?.destroy();
      playerToolsPane = null;
    };
    const renderPlayerToolsPane = (): void => {
      const mine = myRosterEntry();
      playerToolsPane = new PlayerToolsPane(this.uiRoot, {
        team: mine?.team ?? 'A',
        number: mine?.number ?? 0,
        canDraw: drawEnabledForAll,
        inDrawMode,
        onChangeNumber: openNumberPane,
        onToggleDrawMode: () => setLocalDrawMode(!inDrawMode),
        onClearMine: () => client.requestClearMyDrawings(),
        onClose: closePlayerTools,
      });
    };
    const refreshPlayerToolsPane = (): void => {
      if (!playerToolsPane) return;
      playerToolsPane.destroy();
      renderPlayerToolsPane();
    };
    const togglePlayerTools = (): void => {
      if (playerToolsPane) {
        closePlayerTools();
        return;
      }
      renderPlayerToolsPane();
    };

    const setLocalDrawMode = (enabled: boolean): void => {
      inDrawMode = enabled;
      input?.setJoystickEnabled(!enabled);
      gameInstance?.setDrawMode(enabled, (x1, y1, x2, y2) => client.requestArrow(x1, y1, x2, y2));
      playerToolsPane?.setDrawMode(enabled);
    };

    this.teardowns.push(() => closePlayerTools());
    this.teardowns.push(() => playbookView.teardown());

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
    onInputReady: (input: InputManager) => void,
    onOpenPlayerTools: () => void,
  ): Promise<void> {
    clear(this.uiRoot);

    const indicator = new ConnectionIndicator(this.uiRoot);
    indicator.set(connectionState());
    indicator.setRetryHandler(() => void this.joinGame(roomId));
    this.teardowns.push(() => indicator.destroy());

    const playerToolsButton = new PlayerToolsButton(this.uiRoot, onOpenPlayerTools);
    this.teardowns.push(() => playerToolsButton.destroy());

    await this.runGame(client, {
      role: 'client',
      initialSport,
      onGameReady: (game) => {
        onGameReady(game);
        game.setRoster([...client.currentRoster]);
        game.setArrows([...client.currentArrows]);
      },
      onInputReady,
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
      onInputReady?: (input: InputManager) => void;
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
    options.onInputReady?.(input);
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

  /** Numbers unavailable on `team` — teammates' current numbers, plus anything still in grace. */
  private takenNumbersForMyTeam(
    selfPlayerId: string,
    team: TeamId,
    roster: readonly RosterEntry[],
    reserved: readonly ReservedNumber[],
  ): Set<number> {
    const taken = new Set<number>();
    for (const entry of roster) {
      if (entry.team === team && entry.playerId !== selfPlayerId) taken.add(entry.number);
    }
    for (const entry of reserved) {
      if (entry.team === team) taken.add(entry.number);
    }
    return taken;
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
