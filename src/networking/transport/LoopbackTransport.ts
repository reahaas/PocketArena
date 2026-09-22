import type { ChannelKind } from '../NetworkProtocol';
import type {
  ConnectionState,
  NetworkConditions,
  Transport,
  TransportHandlers,
} from './Transport';
import { PERFECT_CONDITIONS, deliverWithConditions } from './Transport';

/**
 * In-process Transport used to exercise the full netcode without a browser or a network.
 * This is how the 2/5/10/20-player scenarios in spec §38 are actually testable.
 */
export class LoopbackTransport implements Transport {
  private handlers: TransportHandlers = {};
  private peer: LoopbackTransport | null = null;
  private currentState: ConnectionState = 'CONNECTING';

  constructor(private conditions: NetworkConditions = PERFECT_CONDITIONS) {}

  static createPair(
    conditions: NetworkConditions = PERFECT_CONDITIONS,
  ): [LoopbackTransport, LoopbackTransport] {
    const a = new LoopbackTransport(conditions);
    const b = new LoopbackTransport(conditions);
    a.peer = b;
    b.peer = a;
    a.setState('CONNECTED');
    b.setState('CONNECTED');
    return [a, b];
  }

  get state(): ConnectionState {
    return this.currentState;
  }

  setConditions(conditions: NetworkConditions): void {
    this.conditions = conditions;
  }

  setHandlers(handlers: TransportHandlers): void {
    this.handlers = handlers;
  }

  send(channel: ChannelKind, payload: string): void {
    const peer = this.peer;
    if (!peer || this.currentState !== 'CONNECTED') return;
    deliverWithConditions(this.conditions, channel, () => peer.receive(payload));
  }

  close(): void {
    const peer = this.peer;
    this.peer = null;
    this.setState('DISCONNECTED');

    if (peer && peer.peer) {
      peer.peer = null;
      peer.setState('DISCONNECTED');
    }
  }

  private receive(payload: string): void {
    if (this.currentState !== 'CONNECTED') return;
    this.handlers.onMessage?.(payload);
  }

  private setState(next: ConnectionState): void {
    if (this.currentState === next) return;
    this.currentState = next;
    this.handlers.onStateChange?.(next);
  }
}
