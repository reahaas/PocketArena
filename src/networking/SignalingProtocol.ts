import { ROOM_ID_ALPHABET, ROOM_ID_LENGTH } from '../config/constants';

export type SignalingErrorReason =
  | 'full'
  | 'notFound'
  | 'hostOffline'
  | 'invalid'
  | 'rateLimited'
  | 'serverFull';

/** SDP and ICE payloads are relayed opaquely; the server never interprets them. */
export type SessionDescriptionPayload = { type: string; sdp?: string };
export type IceCandidatePayload = Record<string, unknown>;

export type SignalingClientMessage =
  | { type: 'createRoom' }
  | { type: 'reclaimRoom'; roomId: string; token: string }
  | { type: 'joinRoom'; roomId: string }
  | { type: 'offer'; to: string; sdp: SessionDescriptionPayload }
  | { type: 'answer'; to: string; sdp: SessionDescriptionPayload }
  | { type: 'ice'; to: string; candidate: IceCandidatePayload };

export type SignalingServerMessage =
  | { type: 'roomCreated'; roomId: string; peerId: string; hostToken: string }
  | { type: 'roomReclaimed'; roomId: string; peerId: string }
  | { type: 'roomJoined'; roomId: string; peerId: string; hostId: string }
  | { type: 'roomError'; reason: SignalingErrorReason }
  | { type: 'peerJoined'; peerId: string }
  | { type: 'peerLeft'; peerId: string }
  | { type: 'offer'; from: string; sdp: SessionDescriptionPayload }
  | { type: 'answer'; from: string; sdp: SessionDescriptionPayload }
  | { type: 'ice'; from: string; candidate: IceCandidatePayload };

const ROOM_ID_PATTERN = new RegExp(`^[${ROOM_ID_ALPHABET}]{${ROOM_ID_LENGTH}}$`);
const PEER_ID_PATTERN = /^[0-9a-f-]{36}$/;

export function isValidRoomId(value: unknown): value is string {
  return typeof value === 'string' && ROOM_ID_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPeerId(value: unknown): value is string {
  return typeof value === 'string' && PEER_ID_PATTERN.test(value);
}

function isSessionDescription(value: unknown): value is SessionDescriptionPayload {
  if (!isRecord(value)) return false;
  if (typeof value.type !== 'string' || value.type.length > 16) return false;
  return value.sdp === undefined || typeof value.sdp === 'string';
}

export function parseSignalingClientMessage(value: unknown): SignalingClientMessage | null {
  if (!isRecord(value)) return null;

  switch (value.type) {
    case 'createRoom':
      return { type: 'createRoom' };
    case 'reclaimRoom':
      if (!isValidRoomId(value.roomId)) return null;
      if (typeof value.token !== 'string' || value.token.length === 0 || value.token.length > 128) {
        return null;
      }
      return { type: 'reclaimRoom', roomId: value.roomId, token: value.token };
    case 'joinRoom':
      return isValidRoomId(value.roomId) ? { type: 'joinRoom', roomId: value.roomId } : null;
    case 'offer':
    case 'answer':
      if (!isPeerId(value.to) || !isSessionDescription(value.sdp)) return null;
      return { type: value.type, to: value.to, sdp: value.sdp };
    case 'ice':
      if (!isPeerId(value.to) || !isRecord(value.candidate)) return null;
      return { type: 'ice', to: value.to, candidate: value.candidate };
    default:
      return null;
  }
}

export function parseSignalingServerMessage(value: unknown): SignalingServerMessage | null {
  if (!isRecord(value)) return null;

  switch (value.type) {
    case 'roomCreated':
      if (!isValidRoomId(value.roomId) || !isPeerId(value.peerId)) return null;
      if (typeof value.hostToken !== 'string' || value.hostToken.length === 0) return null;
      return {
        type: 'roomCreated',
        roomId: value.roomId,
        peerId: value.peerId,
        hostToken: value.hostToken,
      };
    case 'roomReclaimed':
      if (!isValidRoomId(value.roomId) || !isPeerId(value.peerId)) return null;
      return { type: 'roomReclaimed', roomId: value.roomId, peerId: value.peerId };
    case 'roomJoined':
      if (!isValidRoomId(value.roomId) || !isPeerId(value.peerId) || !isPeerId(value.hostId)) {
        return null;
      }
      return {
        type: 'roomJoined',
        roomId: value.roomId,
        peerId: value.peerId,
        hostId: value.hostId,
      };
    case 'roomError':
      return typeof value.reason === 'string'
        ? { type: 'roomError', reason: value.reason as SignalingErrorReason }
        : null;
    case 'peerJoined':
    case 'peerLeft':
      return isPeerId(value.peerId) ? { type: value.type, peerId: value.peerId } : null;
    case 'offer':
    case 'answer':
      if (!isPeerId(value.from) || !isSessionDescription(value.sdp)) return null;
      return { type: value.type, from: value.from, sdp: value.sdp };
    case 'ice':
      if (!isPeerId(value.from) || !isRecord(value.candidate)) return null;
      return { type: 'ice', from: value.from, candidate: value.candidate };
    default:
      return null;
  }
}
