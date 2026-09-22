import type { RenderPlayer } from './game/RenderPlayer';

declare global {
  interface Window {
    /** Present only when the game is running with ?debug=1. Used by the E2E suite. */
    __pocketArena?: {
      role: 'host' | 'client';
      localPlayerId: () => string;
      players: () => RenderPlayer[];
      cameraScroll: () => { x: number; y: number };
      /** Client only. Kills the peer connection the way a network failure would. */
      dropConnection?: () => void;
    };
  }
}

export {};
