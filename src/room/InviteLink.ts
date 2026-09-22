import { isValidRoomId } from '../networking/SignalingProtocol';

export const JOIN_PATH_PREFIX = '/join/';

export function buildInviteUrl(roomId: string, origin: string): string {
  return `${origin.replace(/\/$/, '')}${JOIN_PATH_PREFIX}${roomId}`;
}

/** Returns the room id for a `/join/:gameId` path, or null for anything else. */
export function parseJoinPath(pathname: string): string | null {
  if (!pathname.startsWith(JOIN_PATH_PREFIX)) return null;

  const candidate = pathname.slice(JOIN_PATH_PREFIX.length).replace(/\/$/, '').toUpperCase();
  return isValidRoomId(candidate) ? candidate : null;
}

export function buildShareMessage(url: string): { title: string; text: string; url: string } {
  return {
    title: 'Pocket Arena',
    text: 'Join my Pocket Arena game!',
    url,
  };
}
