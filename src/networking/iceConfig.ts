import {
  DEBUG_NETWORK_LATENCY_MS,
  DEBUG_PACKET_LOSS_PERCENT,
  STUN_SERVERS,
  TURN_CREDENTIAL,
  TURN_URL,
  TURN_USERNAME,
} from '../config/config';
import type { NetworkConditions } from './transport/Transport';

export function buildIceConfiguration(): RTCConfiguration {
  const iceServers: RTCIceServer[] = [{ urls: STUN_SERVERS }];

  // TURN is unprovisioned for the MVP (decision D3) but requires no code change to enable.
  if (TURN_URL) {
    iceServers.push({ urls: TURN_URL, username: TURN_USERNAME, credential: TURN_CREDENTIAL });
  }

  return { iceServers };
}

export function debugConditions(): NetworkConditions {
  return {
    latencyMs: DEBUG_NETWORK_LATENCY_MS,
    jitterMs: 0,
    lossPercent: DEBUG_PACKET_LOSS_PERCENT,
  };
}
