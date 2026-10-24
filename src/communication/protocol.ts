import type { PosePoint } from '../pose/poseTypes';

export const LANDMARK_COUNT = 33;
export const MAX_POSE_BYTES = 8_192;
export const MAX_POSES_PER_SECOND = 20;
export const MAX_COORDINATE = 10;

export interface PoseMessage {
  type: 'pose';
  room: string;
  timestamp: number;
  seq: number;
  landmarks: PosePoint[];
}

export interface HelloMessage { type: 'hello'; role: 'mobile' | 'viewer'; room: string; token: string }
export type ClientMessage = HelloMessage | PoseMessage;
export type RelayMessage = { type: 'ready' } | { type: 'peer'; connected: boolean } | PoseMessage | { type: 'error'; message: string };

export function isPoseMessage(value: unknown, room?: string): value is PoseMessage {
  if (!value || typeof value !== 'object') return false;
  const frame = value as Partial<PoseMessage>;
  return frame.type === 'pose' && typeof frame.room === 'string' && (!room || frame.room === room)
    && Number.isFinite(frame.timestamp) && Number.isSafeInteger(frame.seq) && frame.seq! >= 0
    && Array.isArray(frame.landmarks) && frame.landmarks.length === LANDMARK_COUNT
    && frame.landmarks.every(point => !!point && [point.x, point.y, point.z, point.visibility].every(Number.isFinite)
      && Math.abs(point.x) <= MAX_COORDINATE && Math.abs(point.y) <= MAX_COORDINATE
      && Math.abs(point.z) <= MAX_COORDINATE && point.visibility >= 0 && point.visibility <= 1);
}

export function isHelloMessage(value: unknown): value is HelloMessage {
  if (!value || typeof value !== 'object') return false;
  const hello = value as Partial<HelloMessage>;
  return hello.type === 'hello' && (hello.role === 'mobile' || hello.role === 'viewer')
    && typeof hello.room === 'string' && /^[A-Z2-9]{6}$/.test(hello.room)
    && typeof hello.token === 'string' && /^[A-Za-z0-9_-]{40,}$/.test(hello.token);
}
