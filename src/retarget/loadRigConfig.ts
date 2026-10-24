import type { BodySegment, RigBindingConfig, MotionRigConfig } from './types';
import { sourceFor } from './sourceMapping';

const segmentSet = new Set<BodySegment>(['torso', 'neck', 'upperArm', 'forearm', 'hand', 'upperLeg', 'lowerLeg', 'foot']);
export function parseRigConfig(value: unknown): RigBindingConfig[] {
  if (!value || typeof value !== 'object' || !('version' in value) || (value.version !== 1 && value.version !== 2)
    || !('bindings' in value) || !Array.isArray(value.bindings) || value.bindings.length > 32) throw new Error('映射配置格式无效，需要 version: 1/2 和 bindings 数组。');
  const version = value.version;
  return value.bindings.map((binding: unknown) => {
    if (!binding || typeof binding !== 'object') throw new Error('映射条目无效。');
    const b = { ...binding } as Record<string, unknown>;
    if (version === 1 && b.segment === undefined) b.segment = 'upperArm';
    const validPath = (path: unknown) => Array.isArray(path) && path.length > 0 && path.length <= 64 && path.every(index => Number.isSafeInteger(index) && index >= 0);
    const sideValid = b.side === 'left' || b.side === 'right' || (version === 2 && b.side === 'center');
    const segmentValid = typeof b.segment === 'string' && segmentSet.has(b.segment as BodySegment)
      && (version === 2 || b.segment === 'upperArm' || b.segment === 'forearm')
      && ((b.segment === 'torso' || b.segment === 'neck') === (b.side === 'center'));
    const validReference = b.referenceDirection === undefined || (Array.isArray(b.referenceDirection)
      && b.referenceDirection.length === 3 && b.referenceDirection.every(v => typeof v === 'number' && Number.isFinite(v))
      && Math.hypot(...b.referenceDirection) > 1e-8);
    if (!sideValid || !segmentValid || !validReference || (b.enabled !== undefined && typeof b.enabled !== 'boolean') || !validPath(b.bonePath)
      || (b.endPath !== undefined && !validPath(b.endPath)) || (version === 1 && !validPath(b.endPath))
      || typeof b.expectedBoneName !== 'string' || (b.expectedEndName !== undefined && typeof b.expectedEndName !== 'string')
      || (b.endPath !== undefined && typeof b.expectedEndName !== 'string')
      || (b.endPath === undefined && (!Array.isArray(b.referenceDirection) || b.referenceDirection.length !== 3
        || !b.referenceDirection.every(v => typeof v === 'number' && Number.isFinite(v)) || Math.hypot(...b.referenceDirection) < 1e-8))
      || typeof b.maxSwingRadians !== 'number' || !Number.isFinite(b.maxSwingRadians) || b.maxSwingRadians <= 0 || b.maxSwingRadians > Math.PI
      || !Array.isArray(b.axisCorrection) || b.axisCorrection.length !== 4 || !b.axisCorrection.every(v => typeof v === 'number' && Number.isFinite(v))
      || Math.abs(Math.hypot(...b.axisCorrection) - 1) > 1e-5) throw new Error('映射条目的骨骼路径、参考方向、限位或轴修正无效。');
    const source = sourceFor(b.side as 'left' | 'right' | 'center', b.segment as BodySegment);
    const sourceStart = b.sourceStart ?? source.start, sourceEnd = b.sourceEnd ?? source.end;
    const validLandmarks = (indices: unknown) => Array.isArray(indices) && indices.length > 0 && indices.length <= 4
      && indices.every(index => Number.isSafeInteger(index) && index >= 0 && index < 33);
    if (!validLandmarks(sourceStart) || !validLandmarks(sourceEnd)) throw new Error('映射来源关键点无效（MediaPipe Pose 索引范围为 0–32）。');
    return {
      side: b.side as RigBindingConfig['side'], segment: b.segment as BodySegment, enabled: b.enabled as boolean | undefined,
      sourceStart: [...sourceStart as number[]], sourceEnd: [...sourceEnd as number[]], bonePath: [...b.bonePath as number[]],
      endPath: b.endPath === undefined ? undefined : [...b.endPath as number[]], expectedBoneName: b.expectedBoneName,
      expectedEndName: b.expectedEndName as string | undefined,
      referenceDirection: Array.isArray(b.referenceDirection) ? [...b.referenceDirection as number[]] as [number, number, number] : undefined,
      maxSwingRadians: b.maxSwingRadians as number,
      axisCorrection: [b.axisCorrection[0], b.axisCorrection[1], b.axisCorrection[2], b.axisCorrection[3]],
    };
  });
}

export function parseMotionConfig(value: unknown): MotionRigConfig | undefined {
  if (value === undefined) return;
  if (!value || typeof value !== 'object') throw new Error('完整动作配置无效');
  const m = value as Record<string, unknown>;
  if (m.version !== 1 || !Array.isArray(m.hipsPath) || !m.hipsPath.length || m.hipsPath.length > 64
    || !m.hipsPath.every(i => Number.isSafeInteger(i) && i >= 0)
    || typeof m.expectedHipsName !== 'string' || !m.expectedHipsName.trim()) throw new Error('完整动作骨盆路径无效');
  return { version: 1, hipsPath: [...m.hipsPath], expectedHipsName: m.expectedHipsName };
}

export async function loadRigConfig(signal: AbortSignal): Promise<{ bindings: RigBindingConfig[]; notice: string; motion?: MotionRigConfig }> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}models/robot.mapping.json`, { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
    if (!response.ok) throw new Error('请在 models/robot.mapping.json 提供此 GLB 的专属映射配置。');
    const value = await response.json();
    const bindings = parseRigConfig(value);
    try { return { bindings, motion: parseMotionConfig(value.motion), notice: '' }; }
    catch (error) { return { bindings, notice: String(error) }; }
  } catch (error) {
    signal.throwIfAborted();
    return { bindings: [], notice: error instanceof Error ? error.message : '无法读取模型映射配置。' };
  }
}
