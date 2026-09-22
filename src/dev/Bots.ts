import { INPUT_INTERVAL_MS } from '../config/constants';
import type { NetworkHost } from '../networking/NetworkHost';
import { channelFor } from '../networking/NetworkProtocol';
import { decodeHostMessage, encode } from '../networking/NetworkSerializer';
import { LoopbackTransport } from '../networking/transport/LoopbackTransport';

interface Bot {
  transport: LoopbackTransport;
  sequence: number;
  phase: number;
  ready: boolean;
  lastInputAtMs: number;
}

/**
 * Synthetic players driven over LoopbackTransport, so the render and simulation path can be
 * loaded to 20 players without 20 devices. Enabled with `?bots=N`.
 */
export class BotSwarm {
  private readonly bots: Bot[] = [];

  constructor(host: NetworkHost, count: number, nowMs: number) {
    for (let i = 0; i < count; i++) {
      const [hostSide, botSide] = LoopbackTransport.createPair();
      const bot: Bot = {
        transport: botSide,
        sequence: 0,
        phase: (i / count) * Math.PI * 2,
        ready: false,
        lastInputAtMs: nowMs,
      };

      botSide.setHandlers({
        onMessage: (raw) => {
          const message = decodeHostMessage(raw);
          if (message?.type === 'welcome') bot.ready = true;
        },
      });

      if (host.acceptPeer(hostSide, nowMs) === null) {
        botSide.close();
        break;
      }
      this.bots.push(bot);
    }
  }

  update(nowMs: number): void {
    for (const bot of this.bots) {
      if (!bot.ready || nowMs - bot.lastInputAtMs < INPUT_INTERVAL_MS) continue;

      const dt = (nowMs - bot.lastInputAtMs) / 1000;
      bot.lastInputAtMs = nowMs;
      bot.sequence += 1;

      const angle = bot.phase + nowMs / 1500;
      bot.transport.send(
        channelFor('input'),
        encode({
          type: 'input',
          sequence: bot.sequence,
          x: Math.cos(angle),
          y: Math.sin(angle),
          dt,
        }),
      );
    }
  }

  destroy(): void {
    for (const bot of this.bots) bot.transport.close();
    this.bots.length = 0;
  }
}
