import { SNAPSHOT_INTERVAL_MS } from '../../src/config/constants';
import type { Vector2 } from '../../src/game/types';
import { NetworkClient } from '../../src/networking/NetworkClient';
import { NetworkHost } from '../../src/networking/NetworkHost';
import { LoopbackTransport } from '../../src/networking/transport/LoopbackTransport';
import type { NetworkConditions } from '../../src/networking/transport/Transport';

export interface HarnessClient {
  client: NetworkClient;
  transport: LoopbackTransport;
}

/**
 * Runs a real host and real clients over in-process transports with a controllable clock.
 * This is what makes the 2/5/10/20-player requirements in spec §38 actually verifiable.
 */
export class Harness {
  readonly host: NetworkHost;
  readonly clients: HarnessClient[] = [];

  private nowMs = 0;

  constructor(private readonly conditions?: NetworkConditions) {
    this.host = new NetworkHost({}, () => this.nowMs);
  }

  get now(): number {
    return this.nowMs;
  }

  /** Both ends of every pair share one conditions object, so this retunes the whole network. */
  setLoss(lossPercent: number): void {
    if (this.conditions) this.conditions.lossPercent = lossPercent;
  }

  /** Returns null when the room is full. */
  addClient(): HarnessClient | null {
    const [hostSide, clientSide] = this.conditions
      ? LoopbackTransport.createPair(this.conditions)
      : LoopbackTransport.createPair();

    // The client must be listening before acceptPeer sends the welcome.
    const client = new NetworkClient(clientSide, {}, () => this.nowMs);

    if (this.host.acceptPeer(hostSide, this.nowMs) === null) {
      clientSide.close();
      return null;
    }

    const entry = { client, transport: clientSide };
    this.clients.push(entry);
    return entry;
  }

  removeClient(index: number): void {
    const entry = this.clients[index];
    if (!entry) return;

    this.host.removePeer(entry.client.localPlayerId);
    entry.transport.close();
    this.clients.splice(index, 1);
  }

  /** One networking step: everyone sends input, the host simulates, then it broadcasts. */
  advance(steps: number, inputFor: (clientIndex: number, step: number) => Vector2): void {
    const dtSeconds = SNAPSHOT_INTERVAL_MS / 1000;

    for (let step = 0; step < steps; step++) {
      this.nowMs += SNAPSHOT_INTERVAL_MS;

      this.host.submitInput(inputFor(-1, step), dtSeconds);
      this.clients.forEach((entry, index) => {
        entry.client.submitInput(inputFor(index, step), dtSeconds);
      });

      this.host.step(this.nowMs);
      this.host.afterFrame(this.nowMs);
    }
  }

  /** Largest gap between any client's prediction and the host's authoritative state. */
  maxDivergence(): number {
    let worst = 0;

    for (const { client } of this.clients) {
      const predicted = client.localState;
      const authoritative = this.host.getPlayerState(client.localPlayerId);
      if (!predicted || !authoritative) continue;

      worst = Math.max(worst, Math.hypot(predicted.x - authoritative.x, predicted.y - authoritative.y));
    }
    return worst;
  }

  destroy(): void {
    for (const entry of this.clients) entry.transport.close();
    this.clients.length = 0;
    this.host.destroy();
  }
}
