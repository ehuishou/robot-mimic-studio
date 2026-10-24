import * as THREE from 'three';
import { FullBodyMotion } from './FullBodyMotion';
import { resetBones } from '../robot/bones';
import type { BoneEntry } from '../robot/bones';
import { isVisible } from '../pose/poseTypes';
import { resolvePath, supportedChain } from './rigMapping';
import type { BindingDebug, RigBindingConfig, RetargetFrame, FollowState, MotionRigConfig } from './types';

interface Binding {
  config: RigBindingConfig;
  entry: BoneEntry;
  restDirection: THREE.Vector3;
  antipodalAxis: THREE.Vector3;
  swingAxis: THREE.Vector3;
  correction: THREE.Quaternion;
  target: THREE.Quaternion;
  direction: THREE.Vector3;
  lastValidMs: number;
  hasDirection: boolean;
  state: FollowState;
  limited: boolean;
  supported: boolean;
}
const HOLD_MS = 250;
const MAX_FRAME_AGE_MS = 1500;

function averageLandmarks(frame: RetargetFrame, indices: readonly number[], target: THREE.Vector3): boolean {
  if (indices.length === 0) return false;
  target.set(0, 0, 0);
  for (const index of indices) {
    const point = frame.worldLandmarks[index];
    if (!isVisible(point)) return false;
    target.x += point.x; target.y += point.y; target.z += point.z;
  }
  target.multiplyScalar(1 / indices.length);
  return Number.isFinite(target.x) && Number.isFinite(target.y) && Number.isFinite(target.z);
}

export class Retargeter {
  readonly warnings: string[] = [];
  private readonly bindings: Binding[] = [];
  private frame?: RetargetFrame;
  private motion?: FullBodyMotion;
  private consumedSeq = -1;
  private lastSeq = -1;
  private lastTimestamp = -Infinity;
  private paused = false;
  private disposed = false;
  private readonly worldStart = new THREE.Vector3();
  private readonly worldEnd = new THREE.Vector3();
  private readonly worldDirection = new THREE.Vector3();
  private readonly parentDirection = new THREE.Vector3();
  private readonly cross = new THREE.Vector3();
  private readonly parentQuaternion = new THREE.Quaternion();
  private readonly swing = new THREE.Quaternion();

  constructor(private readonly root: THREE.Object3D, private readonly bones: BoneEntry[], configs: readonly RigBindingConfig[], motionConfig?: MotionRigConfig) {
    root.updateWorldMatrix(true, true);
    const occupied = new Set<THREE.Bone>();
    for (const config of configs) {
      if (config.enabled === false) continue;
      const bone = resolvePath(root, config.bonePath);
      const end = config.endPath ? resolvePath(root, config.endPath) : undefined;
      const entry = bones.find(e => e.bone === bone);
      const reference = end instanceof THREE.Bone && end.parent === bone ? end.position.clone()
        : config.referenceDirection ? new THREE.Vector3(...config.referenceDirection) : undefined;
      if (!(bone instanceof THREE.Bone) || !entry || occupied.has(bone)
        || (config.endPath && (!(end instanceof THREE.Bone) || end.parent !== bone || end.name !== config.expectedEndName))
        || bone.name !== config.expectedBoneName || !reference) {
        this.warnings.push(`${config.expectedBoneName}：骨骼路径、名称或参考关节不匹配，已停用。`); continue;
      }
      if (!supportedChain(bone) || reference.lengthSq() < 1e-10 || !Number.isFinite(reference.lengthSq())
        || !Number.isFinite(config.maxSwingRadians) || config.maxSwingRadians <= 0 || config.maxSwingRadians > Math.PI
        || !config.axisCorrection.every(Number.isFinite) || Math.abs(new THREE.Quaternion(...config.axisCorrection).length() - 1) > 1e-5) {
        this.warnings.push(`${bone.name}：参考方向、限位或变换不受支持（需正均匀缩放），已停用。`); continue;
      }
      occupied.add(bone);
      const restDirection = reference.normalize().applyQuaternion(entry.initialQuaternion).normalize();
      // Stable, deterministic perpendicular at the antipode. No measured axial twist is inferred.
      const tangent = Math.abs(restDirection.x) < 0.8 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
      const antipodalAxis = new THREE.Vector3().crossVectors(restDirection, tangent).normalize();
      this.bindings.push({ config, entry, restDirection, antipodalAxis, swingAxis: antipodalAxis.clone(),
        correction: new THREE.Quaternion(...config.axisCorrection), target: entry.initialQuaternion.clone(),
        direction: new THREE.Vector3(), lastValidMs: -Infinity, hasDirection: false, state: 'rest', limited: false, supported: true });
    }
    this.bindings.sort((a, b) => a.entry.depth - b.entry.depth);
    if (motionConfig) {
      try { this.motion = new FullBodyMotion(root, bones, this.bindings.map(b => b.config), motionConfig); }
      catch (error) { this.warnings.push('完整动作已停用：' + (error instanceof Error ? error.message : String(error))); }
    }
    for (const side of ['left', 'right'] as const) if (!this.bindings.some(b => b.config.side === side && b.config.segment === 'upperArm')) this.warnings.push(`${side === 'left' ? '左' : '右'}上臂未绑定。`);
  }

  /** Ingest only new, timestamped world observations; render updates never refresh observation age. */
  accept(frame: RetargetFrame, nowMs: number): boolean {
    if (this.disposed || frame.coordinateSpace !== 'mediapipe-world' || !Number.isFinite(nowMs)
      || !Number.isSafeInteger(frame.seq) || frame.seq < 0 || frame.seq <= this.lastSeq || !Number.isFinite(frame.timestampMs)
      || frame.timestampMs <= this.lastTimestamp || frame.timestampMs > nowMs + 50 || nowMs - frame.timestampMs > MAX_FRAME_AGE_MS) return false;
    this.lastSeq = frame.seq; this.lastTimestamp = frame.timestampMs; this.frame = frame;
    return true;
  }
  clearInput(preserveMotion = false): void {
    if (!preserveMotion) this.motion?.clear();
    this.frame = undefined; this.lastSeq = this.consumedSeq = -1; this.lastTimestamp = -Infinity;
    for (const binding of this.bindings) { binding.hasDirection = false; binding.lastValidMs = -Infinity; }
  }
  setPaused(paused: boolean): void { this.paused = paused; if (paused) this.motion?.releaseFeet(); }
  recenter(): void { this.motion?.recenter(); }
  setFootLock(enabled: boolean): void { this.motion?.setFootLock(enabled); }
  motionDebug() { return this.motion?.debug(); }

  update(nowMs: number, deltaSeconds: number): void {
    if (this.disposed || !Number.isFinite(nowMs) || !Number.isFinite(deltaSeconds) || deltaSeconds < 0) return;
    if (this.paused) { for (const b of this.bindings) b.state = b.supported ? 'paused' : 'disabled'; return; }
    const fresh = this.frame && this.frame.seq !== this.consumedSeq;
    const alpha = 1 - Math.exp(-Math.min(deltaSeconds, 0.1) / 0.12);
    if (fresh) this.motion?.observe(this.frame!);
    this.motion?.before(nowMs, alpha);
    // Bindings are stored parent-before-child so torso updates are applied before neck and limb joints.
    for (const b of this.bindings) {
      if (!supportedChain(b.entry.bone)) {
        b.state = 'disabled';
        if (b.supported) this.warnings.push(`${b.entry.name}：运行中出现不支持的变换，已停用。`);
        b.supported = false; continue;
      }
      if (!b.supported) continue;
      if (fresh) {
        b.hasDirection = false;
        if (!this.motion?.isNeck(b.entry.bone) && averageLandmarks(this.frame!, b.config.sourceStart, this.worldStart)
          && averageLandmarks(this.frame!, b.config.sourceEnd, this.worldEnd)) {
          // MediaPipe image/world convention is x-right, y-down, z-away; Three.js target is y-up, +z toward the viewer (flip y AND z).
          this.worldDirection.set(this.worldEnd.x - this.worldStart.x, this.worldStart.y - this.worldEnd.y,
            this.worldStart.z - this.worldEnd.z).applyQuaternion(b.correction);
          const length = this.worldDirection.lengthSq();
          if (Number.isFinite(length) && length > 1e-10) {
            b.direction.copy(this.worldDirection).normalize(); b.lastValidMs = this.frame!.timestampMs; b.hasDirection = true;
          }
        }
      }
      const age = nowMs - b.lastValidMs;
      if (age <= HOLD_MS) {
        b.entry.bone.parent!.getWorldQuaternion(this.parentQuaternion).invert();
        this.parentDirection.copy(b.direction).applyQuaternion(this.parentQuaternion).normalize();
        const angle = Math.acos(THREE.MathUtils.clamp(b.restDirection.dot(this.parentDirection), -1, 1));
        this.cross.crossVectors(b.restDirection, this.parentDirection);
        // Near 180°, preserve a stable previous swing axis instead of amplifying tiny input noise.
        if (this.cross.lengthSq() < 1e-10 || angle > Math.PI - 0.1) this.cross.copy(b.swingAxis);
        else { this.cross.normalize(); b.swingAxis.copy(this.cross); }
        b.limited = angle > b.config.maxSwingRadians;
        this.swing.setFromAxisAngle(this.cross, Math.min(angle, b.config.maxSwingRadians));
        b.target.copy(this.swing).multiply(b.entry.initialQuaternion).normalize();
        b.state = b.hasDirection && age < 120 ? 'tracking' : 'holding';
      } else {
        b.target.copy(b.entry.initialQuaternion); b.limited = false; b.state = 'recovering';
      }
      const full = this.motion?.target(b.entry.bone, nowMs);
      if (full) {
        const desired = b.entry.bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(full);
        if (b.config.side === 'center') b.target.copy(desired);
        else {
          // Keep directional limits, but recover observable roll around the bone's own axis.
          const delta = b.target.clone().invert().multiply(desired);
          const axis = b.restDirection.clone().applyQuaternion(b.entry.initialQuaternion.clone().invert()).normalize();
          const projection = axis.multiplyScalar(delta.x * axis.x + delta.y * axis.y + delta.z * axis.z);
          const twist = new THREE.Quaternion(projection.x, projection.y, projection.z, delta.w);
          if (twist.lengthSq() > 1e-8) b.target.multiply(twist.normalize()).normalize();
        }
        b.state = fresh ? 'tracking' : 'holding';
      } else if (this.motion?.isNeck(b.entry.bone)) b.target.copy(b.entry.initialQuaternion);
      b.entry.bone.quaternion.slerp(b.target, alpha).normalize();
      if (b.entry.bone.quaternion.angleTo(b.target) < 1e-5) {
        b.entry.bone.quaternion.copy(b.target);
        if (b.state === 'recovering') b.state = 'rest';
      }
      b.entry.bone.updateWorldMatrix(false, true);
    }
    this.motion?.after(nowMs);
    if (fresh) this.consumedSeq = this.frame!.seq;
  }

  debug(): BindingDebug[] {
    return this.bindings.map(b => ({ side: b.config.side, segment: b.config.segment, name: b.entry.name, path: b.config.bonePath.join('/'), state: b.state,
      direction: Number.isFinite(b.lastValidMs) ? b.direction.toArray() : null, target: b.target.toArray(), actual: b.entry.bone.quaternion.toArray(),
      errorDegrees: THREE.MathUtils.radToDeg(b.entry.bone.quaternion.angleTo(b.target)), limited: b.limited,
      lastValidMs: Number.isFinite(b.lastValidMs) ? b.lastValidMs : null }));
  }
  reset(): void {
    this.motion?.reset();
    resetBones(this.bones); this.root.updateWorldMatrix(true, true); this.clearInput(); this.paused = true;
    for (const b of this.bindings) { b.swingAxis.copy(b.antipodalAxis); b.target.copy(b.entry.initialQuaternion); b.state = b.supported ? 'paused' : 'disabled'; b.limited = false; }
  }
  dispose(): void { this.motion?.reset(); this.disposed = true; this.frame = undefined; this.bindings.length = 0; }
}
