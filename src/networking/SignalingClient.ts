import type {
  SignalingClientMessage,
  SignalingErrorReason,
  SignalingServerMessage,
} from './SignalingProtocol';
import { parseSignalingServerMessage } from './SignalingProtocol';

export class SignalingError extends Error {
  constructor(readonly reason: SignalingErrorReason) {
    super(`Signaling rejected the request: ${reason}`);
    this.name = 'SignalingError';
  }
}

type MessageHandler = (message: SignalingServerMessage) => void;

const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000];

const MAX_BUFFERED_MESSAGES = 64;

/** Thin WebSocket client. It only exists to get peers connected; gameplay never touches it. */
export class SignalingClient {
  private socket: WebSocket | null = null;
  private readonly handlers = new Set<MessageHandler>();
  /** Messages that arrived before anyone subscribed. See dispatch(). */
  private readonly buffered: SignalingServerMessage[] = [];
  private pending: {
    match: (m: SignalingServerMessage) => boolean;
    resolve: (m: SignalingServerMessage) => void;
    reject: (error: Error) => void;
  } | null = null;

  onClose: (() => void) | null = null;

  private url = '';
  private closed = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private onReconnected: (() => Promise<void>) | null = null;

  async connect(url: string): Promise<void> {
    this.url = url;
    this.closed = false;
    await this.open();
  }

  /**
   * Keeps trying to get the socket back and re-establishes the session afterwards. Gameplay is
   * peer-to-peer and unaffected, but without this a host could never accept another player.
   */
  enableAutoReconnect(onReconnected: () => Promise<void>): void {
    this.onReconnected = onReconnected;
  }

  private open(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;

      socket.onopen = () => {
        this.reconnectAttempt = 0;
        resolve();
      };
      socket.onerror = () => reject(new Error('Could not reach the game service.'));
      socket.onmessage = (event) => this.onRawMessage(event.data);
      socket.onclose = () => {
        this.pending?.reject(new Error('Connection to the game service was lost.'));
        this.pending = null;
        this.onClose?.();
        this.scheduleReconnect();
      };
    });
  }

  private scheduleReconnect(): void {
    if (this.closed || !this.onReconnected) return;

    const delay =
      RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)]!;
    this.reconnectAttempt += 1;

    this.reconnectTimer = setTimeout(() => {
      void this.open()
        .then(() => this.onReconnected?.())
        .catch(() => {
          // open() rejects on failure; the socket's onclose queues the next attempt.
        });
    }, delay);
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);

    const queued = this.buffered.splice(0);
    for (const message of queued) handler(message);

    return () => this.handlers.delete(handler);
  }

  send(message: SignalingClientMessage): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }

  async createRoom(): Promise<{ roomId: string; peerId: string; hostToken: string }> {
    const reply = await this.request({ type: 'createRoom' }, (m) => m.type === 'roomCreated');
    if (reply.type !== 'roomCreated') throw new Error('Unexpected reply');
    return { roomId: reply.roomId, peerId: reply.peerId, hostToken: reply.hostToken };
  }

  async reclaimRoom(roomId: string, token: string): Promise<{ peerId: string }> {
    const reply = await this.request(
      { type: 'reclaimRoom', roomId, token },
      (m) => m.type === 'roomReclaimed',
    );
    if (reply.type !== 'roomReclaimed') throw new Error('Unexpected reply');
    return { peerId: reply.peerId };
  }

  async joinRoom(roomId: string): Promise<{ roomId: string; peerId: string; hostId: string }> {
    const reply = await this.request({ type: 'joinRoom', roomId }, (m) => m.type === 'roomJoined');
    if (reply.type !== 'roomJoined') throw new Error('Unexpected reply');
    return { roomId: reply.roomId, peerId: reply.peerId, hostId: reply.hostId };
  }

  close(): void {
    this.closed = true;
    this.onReconnected = null;
    this.onClose = null;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close();
    this.socket = null;
    this.handlers.clear();
    this.buffered.length = 0;
  }

  private request(
    message: SignalingClientMessage,
    match: (m: SignalingServerMessage) => boolean,
  ): Promise<SignalingServerMessage> {
    return new Promise((resolve, reject) => {
      this.pending = { match, resolve, reject };
      this.send(message);
    });
  }

  private onRawMessage(data: unknown): void {
    if (typeof data !== 'string') return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }

    const message = parseSignalingServerMessage(parsed);
    if (!message) return;

    if (this.pending) {
      if (message.type === 'roomError') {
        const { reject } = this.pending;
        this.pending = null;
        reject(new SignalingError(message.reason));
        return;
      }
      if (this.pending.match(message)) {
        const { resolve } = this.pending;
        this.pending = null;
        resolve(message);
        return;
      }
    }

    this.dispatch(message);
  }

  /**
   * The host is told about a joiner the instant joinRoom succeeds, so its offer can arrive
   * before the caller has finished wiring up its handler. Hold anything unclaimed rather
   * than dropping it on the floor.
   */
  private dispatch(message: SignalingServerMessage): void {
    if (this.handlers.size === 0) {
      this.buffered.push(message);
      if (this.buffered.length > MAX_BUFFERED_MESSAGES) this.buffered.shift();
      return;
    }

    for (const handler of this.handlers) handler(message);
  }
}
