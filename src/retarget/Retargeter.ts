import * as THREE from 'three';
import { resetBones } from '../robot/bones';
import type { BoneEntry } from '../robot/bones';
import { isVisible } from '../pose/poseTypes';
import { resolvePath, supportedChain } from './rigMapping';
import type { ArmDebug, RigBindingConfig, RetargetFrame, FollowState } from './types';

interface Binding {
  config: RigBindingConfig;
  entry: BoneEntry;
  reference: THREE.Vector3;
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

export class Retargeter {
  readonly warnings: string[] = [];
  private readonly bindings: Binding[] = [];
  private frame?: RetargetFrame;
  private consumedSeq = -1;
  private lastSeq = -1;
  private lastTimestamp = -Infinity;
  private paused = false;
  private disposed = false;
  private readonly worldDirection = new THREE.Vector3();
  private readonly parentDirection = new THREE.Vector3();
  private readonly cross = new THREE.Vector3();
  private readonly parentQuaternion = new THREE.Quaternion();
  private readonly swing = new THREE.Quaternion();

  constructor(private readonly root: THREE.Object3D, private readonly bones: BoneEntry[], configs: readonly RigBindingConfig[]) {
    root.updateWorldMatrix(true, true);
    const occupied = new Set<THREE.Bone>();
    for (const config of configs) {
      if (config.enabled === false) continue;
      if (config.segment === 'forearm') { this.warnings.push(config.expectedBoneName + '：前臂配置已记录，本版仅驱动上臂。'); continue; }
      const bone = resolvePath(root, config.bonePath), end = resolvePath(root, config.endPath);
      const entry = bones.find(e => e.bone === bone);
      if (!(bone instanceof THREE.Bone) || !(end instanceof THREE.Bone) || !entry || end.parent !== bone
        || bone.name !== config.expectedBoneName || end.name !== config.expectedEndName || occupied.has(bone)) {
        this.warnings.push(`${config.side}：骨骼路径、名称或直接关节链不匹配，已停用。`); continue;
      }
      if (!supportedChain(bone) || end.position.lengthSq() < 1e-10 || !Number.isFinite(end.position.lengthSq())
        || !Number.isFinite(config.maxSwingRadians) || config.maxSwingRadians <= 0 || config.maxSwingRadians > Math.PI
        || !config.axisCorrection.every(Number.isFinite) || Math.abs(new THREE.Quaternion(...config.axisCorrection).length() - 1) > 1e-5) {
        this.warnings.push(`${bone.name}：参考方向、限位或变换不受支持（需正均匀缩放），已停用。`); continue;
      }
      occupied.add(bone);
      const reference = end.position.clone().normalize();
      const restDirection = reference.clone().applyQuaternion(entry.initialQuaternion).normalize();
      // Stable, deterministic perpendicular at the antipode. No measured axial twist is inferred.
      const tangent = Math.abs(restDirection.x) < 0.8 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
      const antipodalAxis = new THREE.Vector3().crossVectors(restDirection, tangent).normalize();
      this.bindings.push({ config, entry, reference, restDirection, antipodalAxis, swingAxis: antipodalAxis.clone(),
        correction: new THREE.Quaternion(...config.axisCorrection), target: entry.initialQuaternion.clone(),
        direction: new THREE.Vector3(), lastValidMs: -Infinity, hasDirection: false, state: 'rest', limited: false, supported: true });
    }
    for (const side of ['left', 'right']) if (!this.bindings.some(b => b.config.side === side)) this.warnings.push(`${side} 上臂未绑定。`);
  }

  /** Ingest only new, timestamped world observations; render updates never refresh observation age. */
  accept(frame: RetargetFrame, nowMs: number): boolean {
    if (this.disposed || frame.coordinateSpace !== 'mediapipe-world' || !Number.isFinite(nowMs)
      || !Number.isSafeInteger(frame.seq) || frame.seq < 0 || frame.seq <= this.lastSeq || !Number.isFinite(frame.timestampMs)
      || frame.timestampMs <= this.lastTimestamp || frame.timestampMs > nowMs + 50 || nowMs - frame.timestampMs > MAX_FRAME_AGE_MS) return false;
    this.lastSeq = frame.seq; this.lastTimestamp = frame.timestampMs; this.frame = frame;
    return true;
  }
  clearInput(): void {
    this.frame = undefined; this.lastSeq = this.consumedSeq = -1; this.lastTimestamp = -Infinity;
    for (const binding of this.bindings) { binding.hasDirection = false; binding.lastValidMs = -Infinity; }
  }
  setPaused(paused: boolean): void { this.paused = paused; }

  update(nowMs: number, deltaSeconds: number): void {
    if (this.disposed || !Number.isFinite(nowMs) || !Number.isFinite(deltaSeconds) || deltaSeconds < 0) return;
    if (this.paused) { for (const b of this.bindings) b.state = b.supported ? 'paused' : 'disabled'; return; }
    const fresh = this.frame && this.frame.seq !== this.consumedSeq;
    const alpha = 1 - Math.exp(-Math.min(deltaSeconds, 0.1) / 0.12);
    for (const b of this.bindings) {
      if (!supportedChain(b.entry.bone)) {
        b.state = 'disabled';
        if (b.supported) this.warnings.push(`${b.entry.name}：运行中出现不支持的变换，已停用。`);
        b.supported = false; continue;
      }
      if (!b.supported) continue;
      if (fresh) {
        const [shoulder, elbow] = b.config.side === 'left' ? [11, 13] : [12, 14];
        const start = this.frame!.worldLandmarks[shoulder], end = this.frame!.worldLandmarks[elbow];
        b.hasDirection = false;
        if (isVisible(start) && isVisible(end)) {
          this.worldDirection.set(end.x - start.x, start.y - end.y, start.z - end.z).applyQuaternion(b.correction);
          const length = this.worldDirection.lengthSq();
          if (Number.isFinite(length) && length > 1e-10) {
            b.direction.copy(this.worldDirection).normalize();
            b.lastValidMs = this.frame!.timestampMs; b.hasDirection = true;
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
      b.entry.bone.quaternion.slerp(b.target, alpha).normalize();
      if (b.entry.bone.quaternion.angleTo(b.target) < 1e-5) {
        b.entry.bone.quaternion.copy(b.target);
        if (b.state === 'recovering') b.state = 'rest';
      }
      b.entry.bone.updateWorldMatrix(false, true);
    }
    if (fresh) this.consumedSeq = this.frame!.seq;
  }

  debug(): ArmDebug[] {
    return this.bindings.map(b => ({ side: b.config.side, name: b.entry.name, path: b.config.bonePath.join('/'), state: b.state,
      direction: Number.isFinite(b.lastValidMs) ? b.direction.toArray() : null, target: b.target.toArray(), actual: b.entry.bone.quaternion.toArray(),
      errorDegrees: THREE.MathUtils.radToDeg(b.entry.bone.quaternion.angleTo(b.target)), limited: b.limited,
      lastValidMs: Number.isFinite(b.lastValidMs) ? b.lastValidMs : null }));
  }
  reset(): void {
    resetBones(this.bones); this.root.updateWorldMatrix(true, true); this.clearInput(); this.paused = true;
    for (const b of this.bindings) { b.swingAxis.copy(b.antipodalAxis); b.target.copy(b.entry.initialQuaternion); b.state = b.supported ? 'paused' : 'disabled'; b.limited = false; }
  }
  dispose(): void { this.disposed = true; this.frame = undefined; this.bindings.length = 0; }
}
