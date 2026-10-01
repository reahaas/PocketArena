/** Short, human "x ago" label — used for autosave notes and the draft-resume prompt. */
export function formatRelativeTime(pastMs: number, nowMs: number = Date.now()): string {
  const diffSeconds = Math.max(0, Math.round((nowMs - pastMs) / 1000));
  if (diffSeconds < 5) return 'just now';
  if (diffSeconds < 60) return `${diffSeconds}s ago`;

  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}
