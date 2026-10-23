import type { RigBindingConfig } from './types';

export function parseRigConfig(value: unknown): RigBindingConfig[] {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1
    || !('bindings' in value) || !Array.isArray(value.bindings) || value.bindings.length > 8) throw new Error('映射配置格式无效，需要 version: 1 和 bindings 数组。');
  return value.bindings.map((binding: unknown) => {
    if (!binding || typeof binding !== 'object') throw new Error('映射条目无效。');
    const b = binding as Record<string, unknown>;
    const validPath = (path: unknown) => Array.isArray(path) && path.length > 0 && path.length <= 64 && path.every(index => Number.isSafeInteger(index) && index >= 0);
    if ((b.side !== 'left' && b.side !== 'right') || (b.segment !== undefined && b.segment !== 'upperArm' && b.segment !== 'forearm')
      || (b.enabled !== undefined && typeof b.enabled !== 'boolean') || !validPath(b.bonePath) || !validPath(b.endPath)
      || typeof b.expectedBoneName !== 'string' || typeof b.expectedEndName !== 'string'
      || typeof b.maxSwingRadians !== 'number' || !Number.isFinite(b.maxSwingRadians) || b.maxSwingRadians <= 0 || b.maxSwingRadians > Math.PI
      || !Array.isArray(b.axisCorrection) || b.axisCorrection.length !== 4 || !b.axisCorrection.every(v => typeof v === 'number' && Number.isFinite(v))
      || Math.abs(Math.hypot(...b.axisCorrection) - 1) > 1e-5) throw new Error('映射条目的骨骼路径、限位或轴修正无效。');
    return { side: b.side, segment: b.segment, enabled: b.enabled, bonePath: [...b.bonePath as number[]], endPath: [...b.endPath as number[]],
      expectedBoneName: b.expectedBoneName, expectedEndName: b.expectedEndName, maxSwingRadians: b.maxSwingRadians, axisCorrection: [b.axisCorrection[0], b.axisCorrection[1], b.axisCorrection[2], b.axisCorrection[3]] };
  });
}

export async function loadRigConfig(signal: AbortSignal): Promise<{ bindings: RigBindingConfig[]; notice: string }> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}models/robot.mapping.json`, { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
    if (!response.ok) throw new Error('请在 models/robot.mapping.json 提供此 GLB 的专属映射配置。');
    return { bindings: parseRigConfig(await response.json()), notice: '' };
  } catch (error) {
    signal.throwIfAborted();
    return { bindings: [], notice: error instanceof Error ? error.message : '无法读取模型映射配置。' };
  }
}
