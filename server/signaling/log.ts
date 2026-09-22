type Fields = Record<string, string | number | boolean | undefined>;

function format(fields: Fields): string {
  return Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
}

/**
 * Room lifecycle is the only thing worth logging here, and it is the thing you need when
 * someone reports "the game just stopped".
 */
export const log = {
  info(event: string, fields: Fields = {}): void {
    console.info(`[signaling] ${event} ${format(fields)}`.trimEnd());
  },
  warn(event: string, fields: Fields = {}): void {
    console.warn(`[signaling] ${event} ${format(fields)}`.trimEnd());
  },
};
