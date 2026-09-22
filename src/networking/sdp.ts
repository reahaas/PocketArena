import type {
  IceCandidatePayload,
  SessionDescriptionPayload,
} from './SignalingProtocol';

/** Bridges the opaque signaling payloads and the browser's WebRTC types. */
export function toDescription(payload: SessionDescriptionPayload): RTCSessionDescriptionInit {
  return { type: payload.type as RTCSdpType, ...(payload.sdp ? { sdp: payload.sdp } : {}) };
}

export function fromDescription(description: RTCSessionDescriptionInit): SessionDescriptionPayload {
  return { type: description.type, ...(description.sdp ? { sdp: description.sdp } : {}) };
}

export function toCandidate(payload: IceCandidatePayload): RTCIceCandidateInit {
  return payload as RTCIceCandidateInit;
}

export function fromCandidate(candidate: RTCIceCandidateInit): IceCandidatePayload {
  return candidate as IceCandidatePayload;
}
