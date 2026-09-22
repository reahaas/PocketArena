import type { ChannelKind } from '../NetworkProtocol';
import type {
  ConnectionState,
  NetworkConditions,
  Transport,
  TransportHandlers,
} from './Transport';
import { PERFECT_CONDITIONS, deliverWithConditions } from './Transport';

export type Role = 'offerer' | 'answerer';

export interface WebRTCConnectionOptions {
  role: Role;
  configuration: RTCConfiguration;
  conditions?: NetworkConditions;
  onLocalCandidate: (candidate: RTCIceCandidateInit) => void;
}

/**
 * Wraps a peer connection and its two data channels. The reliable channel carries lifecycle
 * messages; the unreliable one carries inputs and snapshots (decision D1).
 */
export class WebRTCConnection implements Transport {
  private readonly pc: RTCPeerConnection;
  private readonly conditions: NetworkConditions;
  private readonly pendingCandidates: RTCIceCandidateInit[] = [];

  private reliable: RTCDataChannel | null = null;
  private unreliable: RTCDataChannel | null = null;
  private handlers: TransportHandlers = {};
  private currentState: ConnectionState = 'CONNECTING';
  private remoteDescriptionSet = false;
  private closed = false;

  constructor(options: WebRTCConnectionOptions) {
    this.conditions = options.conditions ?? PERFECT_CONDITIONS;
    this.pc = new RTCPeerConnection(options.configuration);

    this.pc.onicecandidate = (event) => {
      if (event.candidate) options.onLocalCandidate(event.candidate.toJSON());
    };
    this.pc.onconnectionstatechange = () => this.syncStateFromPeerConnection();

    if (options.role === 'offerer') {
      this.attachChannel('reliable', this.pc.createDataChannel('reliable', { ordered: true }));
      this.attachChannel(
        'unreliable',
        this.pc.createDataChannel('unreliable', { ordered: false, maxRetransmits: 0 }),
      );
    } else {
      this.pc.ondatachannel = (event) => {
        const kind: ChannelKind = event.channel.label === 'unreliable' ? 'unreliable' : 'reliable';
        this.attachChannel(kind, event.channel);
      };
    }
  }

  get state(): ConnectionState {
    return this.currentState;
  }

  setHandlers(handlers: TransportHandlers): void {
    this.handlers = handlers;
  }

  send(channel: ChannelKind, payload: string): void {
    const target = channel === 'unreliable' ? this.unreliable : this.reliable;
    if (target?.readyState !== 'open') return;
    try {
      target.send(payload);
    } catch {
      // A channel can close between the readyState check and the send; drop the message.
    }
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    return offer;
  }

  async acceptOffer(sdp: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    await this.pc.setRemoteDescription(sdp);
    this.remoteDescriptionSet = true;
    await this.flushPendingCandidates();

    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return answer;
  }

  async acceptAnswer(sdp: RTCSessionDescriptionInit): Promise<void> {
    await this.pc.setRemoteDescription(sdp);
    this.remoteDescriptionSet = true;
    await this.flushPendingCandidates();
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    // Candidates can arrive before the remote description; buffer them until it lands.
    if (!this.remoteDescriptionSet) {
      this.pendingCandidates.push(candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(candidate);
    } catch {
      // Late or duplicate candidates are expected and harmless.
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;

    this.reliable?.close();
    this.unreliable?.close();
    this.pc.close();
    this.setState('DISCONNECTED');
  }

  private async flushPendingCandidates(): Promise<void> {
    const queued = this.pendingCandidates.splice(0);
    for (const candidate of queued) {
      try {
        await this.pc.addIceCandidate(candidate);
      } catch {
        // Ignore rejected candidates.
      }
    }
  }

  private attachChannel(kind: ChannelKind, channel: RTCDataChannel): void {
    if (kind === 'unreliable') this.unreliable = channel;
    else this.reliable = channel;

    channel.onopen = () => this.syncStateFromChannels();
    channel.onclose = () => {
      if (!this.closed) this.setState('DISCONNECTED');
    };
    channel.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      const raw = event.data;
      deliverWithConditions(this.conditions, kind, () => this.handlers.onMessage?.(raw));
    };
  }

  private syncStateFromChannels(): void {
    if (this.reliable?.readyState === 'open' && this.unreliable?.readyState === 'open') {
      this.setState('CONNECTED');
    }
  }

  private syncStateFromPeerConnection(): void {
    switch (this.pc.connectionState) {
      case 'failed':
        this.setState('FAILED');
        break;
      case 'disconnected':
        this.setState('RECONNECTING');
        break;
      case 'closed':
        this.setState('DISCONNECTED');
        break;
      case 'connected':
        this.syncStateFromChannels();
        break;
      default:
        break;
    }
  }

  private setState(next: ConnectionState): void {
    if (this.currentState === next) return;
    this.currentState = next;
    this.handlers.onStateChange?.(next);
  }
}
