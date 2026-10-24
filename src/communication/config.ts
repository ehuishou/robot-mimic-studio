export const COMMUNICATION_CONFIG = Object.freeze({
  wsPath: '/ws',
  roomsPath: '/api/rooms',
  sendIntervalMs: 1000 / 15,
  maxBufferedBytes: 16_384,
  maxRetries: 5,
  maxBackoffMs: 10_000,
  heartbeatIntervalMs: 15_000,
  heartbeatTimeoutMs: 10_000,
});
