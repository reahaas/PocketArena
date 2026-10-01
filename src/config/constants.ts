/**
 * Environment-free tunables. Shared by the browser client and the Node signaling server,
 * so this file must never reference `import.meta.env`, the DOM, or Node globals.
 */

// --- Simulation ---------------------------------------------------------
export const SIM_TICK_HZ = 30;
export const SIM_TICK_MS = 1000 / SIM_TICK_HZ;
export const MAX_CATCHUP_TICKS = 5;

// --- Networking rates ---------------------------------------------------
export const SNAPSHOT_HZ = 20;
export const SNAPSHOT_INTERVAL_MS = 1000 / SNAPSHOT_HZ;
export const INPUT_HZ = 20;
export const INPUT_INTERVAL_MS = 1000 / INPUT_HZ;
export const PING_INTERVAL_MS = 1000;

// --- Client-side smoothing ---------------------------------------------
export const INTERP_DELAY_MS = 100;
export const EXTRAP_MAX_MS = 250;
export const SNAP_THRESHOLD_PX = 120;
/** Fraction of the correction offset removed per 60fps frame. */
export const CORRECTION_DECAY_PER_FRAME = 0.18;
export const SNAPSHOT_BUFFER_SIZE = 32;

// --- Player / arena -----------------------------------------------------
export const PLAYER_SPEED = 320;
export const PLAYER_RADIUS = 24;
/** 16:9 so the whole board fits a landscape phone with no camera scrolling (spec §18). */
export const ARENA_WIDTH = 1600;
export const ARENA_HEIGHT = 900;
export const MAX_PLAYERS = 20;

// --- Input --------------------------------------------------------------
export const JOYSTICK_DEADZONE = 0.15;
export const JOYSTICK_RADIUS = 60;
export const INPUT_BUFFER_SIZE = 128;
export const MAX_INPUTS_PER_TICK = 4;
/** Upper bound on a client-reported frame delta. Caps how far one input can advance a player. */
export const MAX_INPUT_DT = 0.1;

// --- Connection lifecycle ----------------------------------------------
/**
 * Backstop only. A closed peer connection is detected immediately via WebRTC state changes;
 * this covers a wedged half-open channel. It must stay well above the time a player might
 * background the app for — input silence is not the same thing as having left.
 */
export const DISCONNECT_TIMEOUT_MS = 30_000;
/** Rooms expire on inactivity, never on age — a long game must not be swept mid-play. */
export const ROOM_IDLE_TTL_MS = 4 * 60 * 60 * 1000;
export const ROOM_EMPTY_TTL_MS = 60 * 1000;
/** How long a room survives its host losing signaling, so it can be reclaimed. */
export const ROOM_HOST_GRACE_MS = 5 * 60 * 1000;
export const MAX_ROOMS = 500;

// --- Signaling hardening ------------------------------------------------
/** Generous enough for an SDP offer, tight enough to make flooding expensive. */
export const WS_MSG_MAX_BYTES = 16_384;
export const WS_MSGS_PER_SEC = 30;
export const WS_HEARTBEAT_MS = 15_000;

// --- Room identity ------------------------------------------------------
export const ROOM_ID_LENGTH = 6;
/** Crockford base32 with ambiguous characters (I, L, O, U) removed. */
export const ROOM_ID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// --- Sports / field ------------------------------------------------------
/** Only the host may change this; it is broadcast to every connected player (spec §5). */
export type SportType = 'soccer' | 'basketball' | 'waterpolo';
export const SPORTS: SportType[] = ['soccer', 'basketball', 'waterpolo'];
export const DEFAULT_SPORT: SportType = 'soccer';
export const SPORT_LABELS: Record<SportType, string> = {
  soccer: 'SOCCER',
  basketball: 'BASKETBALL',
  waterpolo: 'WATER POLO',
};

// --- Teams / jersey numbers -----------------------------------------------
/** The host assigns both; balanced across teams and unique-per-team (spec-equivalent, new). */
export type TeamId = 'A' | 'B';
export const TEAMS: TeamId[] = ['A', 'B'];
export const TEAM_COLORS: Record<TeamId, number> = { A: 0x3b82f6, B: 0xef4444 };
export const TEAM_LABELS: Record<TeamId, string> = { A: 'BLUE', B: 'RED' };
export const NUMBER_MIN = 1;
export const NUMBER_MAX = 50;
/** A disconnected player keeps their number for a minute, in case it is a reconnect. */
export const NUMBER_RELEASE_GRACE_MS = 60_000;

// --- Tactics drawing ------------------------------------------------------
export const MAX_DRAW_ARROWS = 200;
/** Drags shorter than this are treated as accidental taps, not an arrow. */
export const MIN_ARROW_LENGTH_PX = 20;

// --- Playbook (coach-designed, auto-graded plays) --------------------------
/** One assignment per roster slot is the practical ceiling; keeps payloads bounded. */
export const MAX_PLAYBOOK_ASSIGNMENTS = MAX_PLAYERS;
export const MAX_WAYPOINTS_PER_ASSIGNMENT = 12;
export const MAX_PLAYBOOK_NAME_LENGTH = 40;
export const MAX_SAVED_PLAYS = 30;
/** Countdown shown to every player between "launch" and the play actually starting. */
export const PLAYBOOK_COUNTDOWN_MS = 3_000;
/** A play longer than this would make "practice it" tedious; also bounds host-side run state. */
export const PLAYBOOK_MAX_DURATION_MS = 60_000;
/** How often the host samples real-vs-expected position while a play is running. */
export const PLAYBOOK_ACCURACY_SAMPLE_MS = 200;
/** Distance (px) at which accuracy bottoms out at 0% — roughly half the arena width. */
export const PLAYBOOK_ACCURACY_MAX_DISTANCE_PX = 220;
/** Spacing the editor gives each newly-placed waypoint when the coach does not set one. */
export const DEFAULT_WAYPOINT_INTERVAL_MS = 1_500;
