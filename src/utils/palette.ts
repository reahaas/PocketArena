import { MAX_PLAYERS } from '../config/constants';

/** 20 visually distinguishable hues, indexed by player slot. */
export const PALETTE: readonly number[] = [
  0xef4444, 0x3b82f6, 0x22c55e, 0xf59e0b, 0xa855f7, 0x06b6d4, 0xec4899, 0x84cc16, 0xf97316,
  0x14b8a6, 0x6366f1, 0xeab308, 0xf43f5e, 0x0ea5e9, 0x10b981, 0xd946ef, 0xfb7185, 0x8b5cf6,
  0x34d399, 0xfbbf24,
];

export function colorForSlot(slot: number): number {
  const index = ((slot % MAX_PLAYERS) + MAX_PLAYERS) % MAX_PLAYERS;
  return PALETTE[index] ?? 0xffffff;
}

export function cssColorForSlot(slot: number): string {
  return `#${colorForSlot(slot).toString(16).padStart(6, '0')}`;
}

export function labelForSlot(slot: number): string {
  return `P${slot + 1}`;
}
