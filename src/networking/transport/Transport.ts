import type { ChannelKind } from '../NetworkProtocol';

export type ConnectionState =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'FAILED';

export interface TransportHandlers {
  onMessage?: (raw: string) => void;
  onStateChange?: (state: ConnectionState) => void;
}

/**
 * The only surface gameplay code is allowed to see. WebRTC lives behind this so the simulation
 * stays portable and so the netcode can be tested in-process (spec §37).
 */
export interface Transport {
  readonly state: ConnectionState;
  send(channel: ChannelKind, payload: string): void;
  setHandlers(handlers: TransportHandlers): void;
  close(): void;
}

export interface NetworkConditions {
  latencyMs: number;
  jitterMs: number;
  lossPercent: number;
}

export const PERFECT_CONDITIONS: NetworkConditions = { latencyMs: 0, jitterMs: 0, lossPercent: 0 };

/**
 * Applies artificial latency and loss to a delivery callback. Both transports route incoming
 * traffic through this so prediction and reconciliation can be exercised without a bad network.
 */
export function deliverWithConditions(
  conditions: NetworkConditions,
  channel: ChannelKind,
  deliver: () => void,
): void {
  // Only the unreliable channel may drop; the reliable channel would have retransmitted.
  if (channel === 'unreliable' && conditions.lossPercent > 0) {
    if (Math.random() * 100 < conditions.lossPercent) return;
  }

  const jitter = conditions.jitterMs > 0 ? Math.random() * conditions.jitterMs : 0;
  const delay = conditions.latencyMs + jitter;

  if (delay <= 0) {
    deliver();
    return;
  }
  setTimeout(deliver, delay);
}
