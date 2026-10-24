import type { PosePoint } from '../pose/poseTypes';
import type { PoseMessage } from './protocol';

export interface AcceptedRemotePose {
  landmarks: readonly PosePoint[];
  timestampMs: number;
  seq: number;
}

export class RemotePoseBuffer {
  private activeSession: string | undefined;
  private lastSeq = -1;
  private lastTimestamp = -Infinity;
  private latest: AcceptedRemotePose | undefined;
  private localSeq = 0;

  start(sessionId: string): void {
    this.activeSession = sessionId;
    this.lastSeq = -1;
    this.lastTimestamp = -Infinity;
    this.latest = undefined;
  }

  stop(sessionId: string): boolean {
    if (this.activeSession !== sessionId) return false;
    this.clear();
    return true;
  }

  push(message: PoseMessage, receivedAt: number): boolean {
    if (message.sessionId !== this.activeSession || message.seq <= this.lastSeq || message.timestamp <= this.lastTimestamp) return false;
    this.lastSeq = message.seq;
    this.lastTimestamp = message.timestamp;
    this.latest = { landmarks: message.landmarks, timestampMs: receivedAt, seq: ++this.localSeq };
    return true;
  }

  take(): AcceptedRemotePose | undefined {
    const value = this.latest;
    this.latest = undefined;
    return value;
  }

  // Pausing the viewer must not invalidate the phone's still-running capture session.
  discardPending(): void { this.latest = undefined; }

  clear(): void {
    this.activeSession = undefined;
    this.latest = undefined;
    this.lastSeq = -1;
    this.lastTimestamp = -Infinity;
  }
}
