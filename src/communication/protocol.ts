import type { PosePoint } from '../pose/poseTypes';

export const PROTOCOL_VERSION = 1;
export const LANDMARK_COUNT = 33;
export const MAX_POSE_BYTES = 8_192;
export const MAX_POSES_PER_SECOND = 20;
export const MAX_COORDINATE = 10;

export interface PoseMessage {
  type: 'pose';
  version: typeof PROTOCOL_VERSION;
  room: string;
  sessionId: string;
  timestamp: number;
  seq: number;
  landmarks: PosePoint[];
}

export interface HelloMessage { type: 'hello'; version: typeof PROTOCOL_VERSION; role: 'mobile' | 'viewer'; room: string; token: string }
export interface CaptureMessage { type: 'capture'; version: typeof PROTOCOL_VERSION; room: string; sessionId: string; state: 'started' | 'stopped' }
export interface PingMessage { type: 'ping'; version: typeof PROTOCOL_VERSION; nonce: number }
export type ClientMessage = HelloMessage | PoseMessage | CaptureMessage | PingMessage;
export type RelayMessage = { type: 'ready'; version: typeof PROTOCOL_VERSION }
  | { type: 'peer'; connected: boolean }
  | { type: 'capture'; sessionId: string; state: 'started' | 'stopped' }
  | { type: 'pong'; nonce: number }
  | PoseMessage | { type: 'error'; code: string; message: string };

export const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

export function isCaptureMessage(value: unknown, room?: string): value is CaptureMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<CaptureMessage>;
  return hasExactKeys(value as Record<string, unknown>, ['type', 'version', 'room', 'sessionId', 'state'])
    && message.type === 'capture' && message.version === PROTOCOL_VERSION
    && typeof message.room === 'string' && (!room || message.room === room)
    && typeof message.sessionId === 'string' && SESSION_ID_PATTERN.test(message.sessionId)
    && (message.state === 'started' || message.state === 'stopped');
}

export function isPingMessage(value: unknown): value is PingMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<PingMessage>;
  return hasExactKeys(value as Record<string, unknown>, ['type', 'version', 'nonce'])
    && message.type === 'ping' && message.version === PROTOCOL_VERSION && Number.isSafeInteger(message.nonce);
}

export function isPoseMessage(value: unknown, room?: string): value is PoseMessage {
  if (!value || typeof value !== 'object') return false;
  const frame = value as Partial<PoseMessage>;
  return hasExactKeys(value as Record<string, unknown>, ['type', 'version', 'room', 'sessionId', 'timestamp', 'seq', 'landmarks'])
    && frame.type === 'pose' && frame.version === PROTOCOL_VERSION && typeof frame.room === 'string' && (!room || frame.room === room)
    && typeof frame.sessionId === 'string' && SESSION_ID_PATTERN.test(frame.sessionId)
    && Number.isFinite(frame.timestamp) && Number.isSafeInteger(frame.seq) && frame.seq! >= 0
    && Array.isArray(frame.landmarks) && frame.landmarks.length === LANDMARK_COUNT
    && frame.landmarks.every(point => !!point && hasExactKeys(point as unknown as Record<string, unknown>, ['x', 'y', 'z', 'visibility'])
      && [point.x, point.y, point.z, point.visibility].every(Number.isFinite)
      && Math.abs(point.x) <= MAX_COORDINATE && Math.abs(point.y) <= MAX_COORDINATE
      && Math.abs(point.z) <= MAX_COORDINATE && point.visibility >= 0 && point.visibility <= 1);
}

export function isHelloMessage(value: unknown): value is HelloMessage {
  if (!value || typeof value !== 'object') return false;
  const hello = value as Partial<HelloMessage>;
  return hasExactKeys(value as Record<string, unknown>, ['type', 'version', 'role', 'room', 'token'])
    && hello.type === 'hello' && hello.version === PROTOCOL_VERSION && (hello.role === 'mobile' || hello.role === 'viewer')
    && typeof hello.room === 'string' && /^[A-Z2-9]{6}$/.test(hello.room)
    && typeof hello.token === 'string' && /^[A-Za-z0-9_-]{40,}$/.test(hello.token);
}
