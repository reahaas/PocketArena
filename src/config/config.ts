export * from './constants';

function env(key: string): string {
  const raw = (import.meta.env as Record<string, string | undefined>)[key];
  return raw?.trim() ?? '';
}

function envNumber(key: string, fallback: number): number {
  const value = Number(env(key));
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Same origin as the page, so HTTPS implies WSS and there is nothing to configure per
 * environment. Vite proxies /ws to the signaling process in dev; in production the signaling
 * process serves the client itself.
 */
function defaultSignalingUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

export const SIGNALING_URL = env('VITE_SIGNALING_URL') || defaultSignalingUrl();

export const STUN_SERVERS = (env('VITE_STUN_SERVERS') || 'stun:stun.l.google.com:19302')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export const TURN_URL = env('VITE_TURN_URL');
export const TURN_USERNAME = env('VITE_TURN_USERNAME');
export const TURN_CREDENTIAL = env('VITE_TURN_CREDENTIAL');

export const DEBUG_NETWORK_LATENCY_MS = envNumber('VITE_DEBUG_NETWORK_LATENCY_MS', 0);
export const DEBUG_PACKET_LOSS_PERCENT = envNumber('VITE_DEBUG_PACKET_LOSS_PERCENT', 0);
