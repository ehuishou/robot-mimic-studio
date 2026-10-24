import * as THREE from 'three';
import { isVisible } from '../pose/poseTypes';
import { isImageMotion } from '../communication/protocol';
import { resolvePath, supportedChain } from './rigMapping';
import type { BoneEntry } from '../robot/bones';
import type { ImageMotion, MotionRigConfig, RetargetFrame, RigBindingConfig } from './types';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const Q = () => new THREE.Quaternion();
function point(frame: RetargetFrame, index: number): THREE.Vector3 | undefined {
  const p = frame.worldLandmarks[index];
  return isVisible(p) ? V(p.x, -p.y, -p.z) : undefined;
}
function midpoint(a?: THREE.Vector3, b?: THREE.Vector3): THREE.Vector3 | undefined { return a && b ? a.clone().add(b).multiplyScalar(0.5) : undefined; }
/** Right-handed frame. Reject the unobservable/collinear case instead of inventing roll. */
function basis(x: THREE.Vector3, up: THREE.Vector3): THREE.Quaternion | undefined {
  if (x.lengthSq() < 1e-8 || up.lengthSq() < 1e-8) return;
  x = x.clone().normalize();
  const z = V().crossVectors(x, up);
  if (z.lengthSq() < 1e-6) return;
  z.normalize(); const y = V().crossVectors(z, x).normalize();
  return Q().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)).normalize();
}
function segmentBasis(direction: THREE.Vector3, forward: THREE.Vector3): THREE.Quaternion | undefined {
  if (direction.lengthSq() < 1e-8) return;
  const y = direction.clone().normalize(), z = forward.clone().addScaledVector(y, -forward.dot(y));
  if (z.lengthSq() < 1e-5) return;
  z.normalize(); return Q().setFromRotationMatrix(new THREE.Matrix4().makeBasis(V().crossVectors(y, z).normalize(), y, z));
}
interface Orientation { q: THREE.Quaternion; time: number }
interface Leg {
  upper: THREE.Bone; lower: THREE.Bone; foot: THREE.Bone; side: number;
  a: number; b: number; groundY: number; anchor?: THREE.Vector3; rotation?: THREE.Quaternion;
  previous?: THREE.Vector3; lastTime: number; stableSince?: number; contact: boolean; lift: number;
}
export interface MotionDebug {
  enabled: boolean; calibrated: boolean; position: number[]; rotation: number[]; yawDegrees: number;
  feet: { side: string; locked: boolean; error: number; anchor: number[] | null }[];
}

/** Opt-in authored rig extension. All roles resolve through verified paths, never name guessing. */
export class FullBodyMotion {
  private readonly hips: THREE.Bone;
  private readonly torso: THREE.Bone;
  private readonly neck: THREE.Bone;
  private readonly initialHip: THREE.Vector3;
  private readonly initialHipQ: THREE.Quaternion;
  private readonly rest = new Map<THREE.Object3D, THREE.Quaternion>();
  private readonly restDirection = new Map<THREE.Object3D, THREE.Vector3>();
  private readonly orientations = new Map<THREE.Object3D, Orientation>();
  private readonly legs: Leg[] = [];
  private readonly displacement = V();
  private readonly targetDisplacement = V();
  private reference?: ImageMotion;
  private lastMotion?: ImageMotion;
  private lastMotionTime = -Infinity;
  private lastPoseTime = -Infinity;
  private sourceScale = 1;
  private torsoLength = 0.7;
  private footLock = true;

  constructor(private readonly root: THREE.Object3D, bones: readonly BoneEntry[], private readonly configs: readonly RigBindingConfig[], config: MotionRigConfig) {
    const resolve = (c: RigBindingConfig | undefined) => {
      const b = c && resolvePath(root, c.bonePath);
      if (!c || c.enabled === false || !(b instanceof THREE.Bone) || b.name !== c.expectedBoneName || !supportedChain(b)) throw new Error('完整动作配置与骨架不匹配');
      return b;
    };
    const find = (segment: string, side: string) => configs.find(c => c.segment === segment && c.side === side && c.enabled !== false);
    const hips = resolvePath(root, config.hipsPath);
    if (!(hips instanceof THREE.Bone) || hips.name !== config.expectedHipsName || !supportedChain(hips)) throw new Error('骨盆路径无效');
    this.hips = hips; this.torso = resolve(find('torso', 'center')); this.neck = resolve(find('neck', 'center'));
    if (this.torso.parent !== hips) throw new Error('完整动作要求骨盆直接连接躯干');
    root.updateWorldMatrix(true, true);
    this.initialHip = hips.position.clone(); this.initialHipQ = hips.quaternion.clone();
    // Anatomical frame axes are specified by this authored mapping: +Y up, +Z forward.
    const rootInverse = root.getWorldQuaternion(Q()).invert();
    for (const e of bones) this.rest.set(e.bone, rootInverse.clone().multiply(e.bone.getWorldQuaternion(Q())));
    for (const c of configs) {
      const b = resolvePath(root, c.bonePath), end = c.endPath && resolvePath(root, c.endPath);
      if (b instanceof THREE.Bone && (end || c.referenceDirection)) this.restDirection.set(b,
        (end ? end.position.clone() : V(...c.referenceDirection!)).normalize().applyQuaternion(this.rest.get(b)!));
    }
    for (const [side, label] of ['left', 'right'].entries()) {
      const upper = resolve(find('upperLeg', label)), lower = resolve(find('lowerLeg', label)), foot = resolve(find('foot', label));
      if (upper.parent !== hips || lower.parent !== upper || foot.parent !== lower) throw new Error('腿部路径必须是骨盆→大腿→小腿→脚');
      const h = upper.getWorldPosition(V()), k = lower.getWorldPosition(V()), f = foot.getWorldPosition(V());
      this.legs.push({ upper, lower, foot, side, a: h.distanceTo(k), b: k.distanceTo(f), groundY: f.y, lastTime: -Infinity, contact: false, lift: Infinity });
    }
  }

  observe(frame: RetargetFrame): void {
    const time = frame.timestampMs;
    const lh = point(frame, 23), rh = point(frame, 24), ls = point(frame, 11), rs = point(frame, 12);
    const hip = midpoint(lh, rh), shoulder = midpoint(ls, rs);
    if (!hip || !shoulder || !lh || !rh || !ls || !rs) return;
    const up = shoulder.clone().sub(hip), pelvis = basis(lh.clone().sub(rh), up), chest = basis(ls.clone().sub(rs), up);
    if (!pelvis || !chest) return;
    this.lastPoseTime = time;
    const put = (bone: THREE.Object3D, q?: THREE.Quaternion) => { if (q) this.orientations.set(bone, { q: q.clone().multiply(this.rest.get(bone)!).normalize(), time }); };
    put(this.hips, pelvis); put(this.torso, chest);
    // Eye/mouth frame measures head orientation, NOT shoulder→nose position (the old permanent nod).
    const le = point(frame, 2), re = point(frame, 5), lm = point(frame, 9), rm = point(frame, 10);
    const eyes = midpoint(le, re), mouth = midpoint(lm, rm);
    const face = le && re && eyes && mouth ? basis(le.clone().sub(re), eyes.sub(mouth)) : undefined;
    if (face) put(this.neck, face);
    // Missing face: keep briefly, then neutral LOCAL neck, inheriting torso turn, not a forced downward vector.
    const forward = V(0, 0, 1).applyQuaternion(chest);
    for (const c of this.configs) {
      if (c.enabled === false || c.side === 'center') continue;
      const bone = resolvePath(this.root, c.bonePath), restDirection = bone && this.restDirection.get(bone);
      if (!(bone instanceof THREE.Bone) || !restDirection) continue;
      const average = (indices: readonly number[]) => {
        const ps = indices.map(i => point(frame, i));
        return ps.every(Boolean) ? ps.reduce<THREE.Vector3>((v, p) => v.add(p!), V()).divideScalar(ps.length) : undefined;
      };
      const start = average(c.sourceStart), end = average(c.sourceEnd);
      if (!start || !end) continue;
      const dir = end.sub(start), side = c.side === 'left' ? 0 : 1;
      let secondary = forward.clone();
      const foot = c.segment === 'foot';
      if (foot) secondary.set(0, 1, 0);
      if (c.segment === 'upperArm' || c.segment === 'forearm' || c.segment === 'upperLeg' || c.segment === 'lowerLeg') {
        const arm = c.segment === 'upperArm' || c.segment === 'forearm';
        const a = point(frame, (arm ? 11 : 23) + side), b = point(frame, (arm ? 13 : 25) + side), d = point(frame, (arm ? 15 : 27) + side);
        if (a && b && d) {
          const chain = d.clone().sub(a), bend = b.clone().sub(a);
          if (chain.lengthSq() > 1e-6) bend.addScaledVector(chain, -bend.dot(chain) / chain.lengthSq());
          // Elbow points opposite flexion; knees point along flexion. Straight limbs have no observable roll.
          if (bend.length() > 0.025) secondary.copy(bend).multiplyScalar(arm ? -1 : 1).normalize();
        }
      }
      if (c.segment === 'hand') {
        const pinky = point(frame, 17 + side), index = point(frame, 19 + side);
        if (pinky && index) {
          const normal = V().crossVectors(dir, index.sub(pinky)).multiplyScalar(side === 0 ? 1 : -1);
          if (normal.lengthSq() > 1e-6) secondary.copy(normal).normalize();
        }
      }
      const measured = segmentBasis(dir, secondary), reference = segmentBasis(restDirection, foot ? V(0, 1, 0) : V(0, 0, 1));
      if (measured && reference) this.orientations.set(bone, { q: measured.multiply(reference.invert()).multiply(this.rest.get(bone)!).normalize(), time });
    }
    const ankles = this.legs.map(l => point(frame, 27 + l.side));
    const knees = this.legs.map(l => point(frame, 25 + l.side));
    const sourceLength = knees[0] && ankles[0] ? lh.distanceTo(knees[0]) + knees[0].distanceTo(ankles[0]) : 0;
    if (sourceLength > 0.25 && sourceLength < 2.5) this.sourceScale = (this.legs[0]!.a + this.legs[0]!.b) / sourceLength;
    this.torsoLength = up.length() * this.sourceScale;
    const m = frame.motion;
    if (m && isImageMotion(m)) {
      if (!this.reference) { this.reference = { ...m }; this.lastMotion = { ...m }; this.lastMotionTime = time; }
      const dt = Math.min(0.15, Math.max(0, (time - this.lastMotionTime) / 1000));
      const jump = this.lastMotion && (Math.hypot(m.x - this.lastMotion.x, m.y - this.lastMotion.y) > Math.max(0.08, dt * 0.8)
        || Math.abs(Math.log(m.scale / this.lastMotion.scale)) > Math.max(0.2, dt));
      if (!jump) {
        const ref = this.reference, ratio = THREE.MathUtils.clamp(ref.scale / m.scale, 0.55, 1.8);
        // Approximate perspective from torso scale, not integration of hip-centred world coordinates.
        const depth = THREE.MathUtils.clamp((ratio - 1) * this.torsoLength / (ref.scale * 0.93), -2, 2);
        this.targetDisplacement.x = THREE.MathUtils.clamp((m.x - ref.x) * this.torsoLength / m.scale, -2.5, 2.5);
        this.targetDisplacement.z = -depth;
        this.lastMotion = { ...m }; this.lastMotionTime = time;
      }
    }
    // Vertical support solve is independent of head/torso. Preserve crouch without dragging the head.
    if (ankles.every(Boolean)) {
      const lowest = Math.min(...ankles.map(a => a!.y - hip.y));
      const restHip = this.hips.parent!.localToWorld(this.initialHip.clone());
      const upperOffset = this.legs.reduce((v, l) => v.add(l.upper.position), V()).multiplyScalar(1 / this.legs.length)
        .multiplyScalar(this.hips.getWorldScale(V()).x).applyQuaternion(this.orientations.get(this.hips)!.q);
      const desiredY = this.legs[0]!.groundY - lowest * this.sourceScale - upperOffset.y - restHip.y;
      this.targetDisplacement.y = THREE.MathUtils.clamp(desiredY, -0.65, 0.45);
      for (const leg of this.legs) {
        const a = ankles[leg.side]!;
        leg.lift = ((a.y - hip.y) - lowest) * this.sourceScale;
        const candidate = a.clone().sub(hip).multiplyScalar(this.sourceScale).add(this.targetDisplacement);
        const dt = (time - leg.lastTime) / 1000;
        const speed = leg.previous && dt > 0 && dt < 0.3 ? candidate.distanceTo(leg.previous) / dt : Infinity;
        leg.previous = candidate; leg.lastTime = time;
        leg.contact = leg.lift < 0.045 && speed < 0.3;
        if (!leg.contact) leg.stableSince = undefined;
        else leg.stableSince ??= time;
        if (leg.lift > 0.075 || speed > 0.65) this.release(leg);
      }
    } else for (const l of this.legs) { this.release(l); l.contact = false; l.stableSince = undefined; }
  }

  target(bone: THREE.Object3D, now: number): THREE.Quaternion | undefined {
    const o = this.orientations.get(bone);
    return o && now - o.time <= 250 ? o.q : undefined;
  }
  isNeck(bone: THREE.Object3D): boolean { return bone === this.neck; }
  before(now: number, alpha: number): void {
    if (!supportedChain(this.hips)) { this.clear(); return; }
    const active = now - this.lastPoseTime <= 250;
    if (!active) this.releaseFeet();
    this.displacement.lerp(active ? this.targetDisplacement : V(this.targetDisplacement.x, 0, this.targetDisplacement.z), alpha);
    const parent = this.hips.parent!;
    const base = parent.localToWorld(this.initialHip.clone());
    this.hips.position.copy(parent.worldToLocal(base.add(this.displacement)));
    const q = this.target(this.hips, now);
    const local = q ? parent.getWorldQuaternion(Q()).invert().multiply(q) : this.initialHipQ;
    this.hips.quaternion.slerp(local, alpha).normalize(); this.hips.updateWorldMatrix(true, true);
  }
  after(now: number): void {
    if (!this.footLock || now - this.lastPoseTime > 250 || !supportedChain(this.hips)) return;
    for (const leg of this.legs) {
      const actual = leg.foot.getWorldPosition(V());
      if (!leg.anchor && leg.contact && leg.stableSince !== undefined && now - leg.stableSince > 160 && Math.abs(actual.y - leg.groundY) < 0.12) {
        leg.anchor = actual.clone(); leg.anchor.y = leg.groundY; leg.rotation = leg.foot.getWorldQuaternion(Q());
      }
      if (!leg.anchor) continue;
      const h = leg.upper.getWorldPosition(V()), distance = h.distanceTo(leg.anchor);
      const drift = actual.distanceTo(leg.anchor);
      const desiredFoot = this.target(leg.foot, now);
      // Release on unreachable targets or a pivot; never pin both feet through a full turn.
      if (distance > (leg.a + leg.b) * 1.015 || drift > 0.28 || (desiredFoot && leg.rotation!.angleTo(desiredFoot) > 0.6)) { this.release(leg); continue; }
      const direction = leg.anchor.clone().sub(h).normalize();
      const d = THREE.MathUtils.clamp(distance, Math.abs(leg.a - leg.b) + 1e-5, leg.a + leg.b - 1e-5);
      const along = (leg.a * leg.a + d * d - leg.b * leg.b) / (2 * d);
      let pole = leg.lower.getWorldPosition(V()).sub(h);
      pole.addScaledVector(direction, -pole.dot(direction));
      if (pole.lengthSq() < 1e-8) { pole = V(0, 0, 1).applyQuaternion(this.hips.getWorldQuaternion(Q())); pole.addScaledVector(direction, -pole.dot(direction)); }
      if (pole.lengthSq() < 1e-8) pole = V(1, 0, 0).cross(direction);
      const knee = h.clone().addScaledVector(direction, along).addScaledVector(pole.normalize(), Math.sqrt(Math.max(0, leg.a * leg.a - along * along)));
      this.aim(leg.upper, leg.lower, knee); this.aim(leg.lower, leg.foot, leg.anchor);
      leg.foot.quaternion.copy(leg.foot.parent!.getWorldQuaternion(Q()).invert().multiply(leg.rotation!));
      leg.foot.updateWorldMatrix(false, true);
    }
  }
  private aim(bone: THREE.Bone, end: THREE.Bone, target: THREE.Vector3): void {
    const origin = bone.getWorldPosition(V()), current = end.getWorldPosition(V()).sub(origin).normalize(), desired = target.clone().sub(origin).normalize();
    const world = Q().setFromUnitVectors(current, desired).multiply(bone.getWorldQuaternion(Q()));
    bone.quaternion.copy(bone.parent!.getWorldQuaternion(Q()).invert().multiply(world)).normalize(); bone.updateWorldMatrix(false, true);
  }
  private release(leg: Leg): void { leg.anchor = undefined; leg.rotation = undefined; }
  releaseFeet(): void { for (const l of this.legs) { this.release(l); l.stableSince = undefined; l.contact = false; } }
  setFootLock(enabled: boolean): void { this.footLock = enabled; this.releaseFeet(); }
  recenter(): void {
    this.reference = undefined; this.lastMotion = undefined; this.lastMotionTime = -Infinity;
    this.targetDisplacement.set(0, 0, 0); this.displacement.set(0, 0, 0); this.hips.position.copy(this.initialHip);
    this.releaseFeet(); for (const l of this.legs) { l.previous = undefined; l.lastTime = -Infinity; }
  }
  clear(): void { this.orientations.clear(); this.lastPoseTime = -Infinity; this.recenter(); }
  reset(): void { this.clear(); this.hips.quaternion.copy(this.initialHipQ); this.root.updateWorldMatrix(true, true); }
  debug(): MotionDebug {
    const rotation = this.hips.getWorldQuaternion(Q()), forward = V(0, 0, 1).applyQuaternion(rotation);
    return { enabled: true, calibrated: !!this.reference, position: this.displacement.toArray(), rotation: rotation.toArray(), yawDegrees: THREE.MathUtils.radToDeg(Math.atan2(forward.x, forward.z)),
      feet: this.legs.map(l => ({ side: l.side === 0 ? 'left' : 'right', locked: !!l.anchor,
        error: l.anchor ? l.foot.getWorldPosition(V()).distanceTo(l.anchor) : 0, anchor: l.anchor?.toArray() ?? null })) };
  }
}
