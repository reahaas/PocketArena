import { MAX_SAVED_PLAYS } from '../config/constants';
import type { Play } from '../networking/NetworkProtocol';
import { parsePlay } from '../networking/NetworkProtocol';

const STORAGE_KEY = 'pocketarena.plays.v1';

/** The library lives on the host's device only; sharing a play means exporting/importing a file. */
export function loadPlays(): Play[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const plays: Play[] = [];
    for (const entry of parsed) {
      const play = parsePlay(entry);
      if (play) plays.push(play);
    }
    return plays;
  } catch {
    return [];
  }
}

export function savePlays(plays: readonly Play[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plays.slice(0, MAX_SAVED_PLAYS)));
  } catch {
    // Storage can be full or unavailable (e.g. private browsing) — losing the save beats crashing.
  }
}

/** Shared with the video exporter so a play's name becomes a safe filename either way. */
export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-z0-9-_]+/gi, '_') || 'play';
}

/** Downloads one play as a JSON file, so a coach can hand it to another device over any channel. */
export function exportPlay(play: Play): void {
  const blob = new Blob([JSON.stringify(play, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${sanitizeFilename(play.name)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

/** Reads and validates a play from a user-picked file. Resolves `null` on anything malformed. */
export async function importPlayFromFile(file: File): Promise<Play | null> {
  try {
    const text = await file.text();
    return parsePlay(JSON.parse(text));
  } catch {
    return null;
  }
}
