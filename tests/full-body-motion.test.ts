import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createFallbackRobot } from '../src/robot/fallback';
import { collectBones } from '../src/robot/bones';
import { Retargeter } from '../src/retarget/Retargeter';
import { fallbackMapping, fallbackMotion } from '../src/retarget/rigMapping';
import { simulatedPose } from '../src/retarget/simulatedPose';
import { parseMotionConfig } from '../src/retarget/loadRigConfig';
import { isPoseMessage, isImageMotion } from '../src/communication/protocol';
import { imageMotion } from '../src/retarget/poseAdapter';
import type { RetargetFrame } from '../src/retarget/types';
const V = (x=0,y=0,z=0) => new THREE.Vector3(x,y,z);
function setup(transformed = false) {
  const root = createFallbackRobot();
  if (transformed) { root.rotation.set(.1,-.5,.08); root.scale.setScalar(1.4); }
  const bones = collectBones(root), configs = fallbackMapping(root,bones), config = fallbackMotion(root,bones)!;
  const r = new Retargeter(root,bones,[...configs].reverse(),config);
  assert.deepEqual(r.warnings,[]);
  const bone = (name:string) => bones.find(b=>b.name===name)!.bone;
  let time=0, seq=0;
  const tick = (frame:RetargetFrame) => {time+=20; assert.ok(r.accept({...frame,timestampMs:time,seq:++seq},time));r.update(time,.02);};
  const settle = (frame:RetargetFrame, n=160) => {for(let i=0;i<n;i++)tick(frame);};
  return {r,root,bones,bone,tick,settle,now:()=>time};
}
function rotate(frame:RetargetFrame, angle:number, indices?:number[]) {
  const q=new THREE.Quaternion().setFromAxisAngle(V(0,1,0),angle);
  return {...frame,worldLandmarks:frame.worldLandmarks.map((p,i)=>{
    if(indices&&!indices.includes(i))return p;
    const v=V(p.x,-p.y,-p.z).applyQuaternion(q);return {...p,x:v.x,y:-v.y,z:-v.z};
  })};
}
const neutral=()=>simulatedPose('neutral',0,0);

test('neutral head ignores nose offset; observable face pitch/yaw follows; face loss returns local neck to rest',()=>{
  const s=setup(), f=neutral();
  const nose={...f,worldLandmarks:f.worldLandmarks.map((p,i)=>i===0?{...p,z:-.5}:p)};
  s.settle(nose);
  assert.ok(s.bone('Neck').quaternion.angleTo(new THREE.Quaternion())<1e-5);
  const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(.3,.5,0));
  const pitched={...f,worldLandmarks:f.worldLandmarks.map((p,i)=>{
    if(![2,5,9,10].includes(i))return p;
    const v=V(p.x,-p.y-.84,-p.z).applyQuaternion(q).add(V(0,.84,0));return {...p,x:v.x,y:-v.y,z:-v.z};
  })};
  s.settle(pitched);
  assert.ok(s.bone('Neck').getWorldQuaternion(new THREE.Quaternion()).angleTo(q)<.002);
  s.settle({...nose,worldLandmarks:nose.worldLandmarks.map((p,i)=>[2,5,9,10].includes(i)?{...p,visibility:0}:p)});
  assert.ok(s.bone('Neck').quaternion.angleTo(new THREE.Quaternion())<1e-5);
});

test('hips track 90/180/360 degree turns across quaternion wrap; chest twists relative to pelvis',()=>{
  const s=setup();s.r.setFootLock(false);const f=neutral();
  for(const angle of [0,Math.PI/2,Math.PI,Math.PI*1.5,Math.PI*2]){
    s.settle(rotate(f,angle));
    const expected=new THREE.Quaternion().setFromAxisAngle(V(0,1,0),angle);
    assert.ok(s.bone('Hips').getWorldQuaternion(new THREE.Quaternion()).angleTo(expected)<.002);
    assert.ok(s.bone('Neck').getWorldQuaternion(new THREE.Quaternion()).angleTo(expected)<.002);
  }
  s.settle(rotate(f,.7,[0,2,5,9,10,11,12,13,14,15,16,17,18,19,20]));
  assert.ok(s.bone('Hips').quaternion.angleTo(new THREE.Quaternion())<.002);
  assert.ok(s.bone('Spine').quaternion.angleTo(new THREE.Quaternion())>.65);
});

test('observable leg bend plane changes axial roll without changing upper-leg direction',()=>{
  const s=setup();s.r.setFootLock(false);const f=neutral();
  const bend=(x:number,z:number)=>({...f,worldLandmarks:f.worldLandmarks.map((p,i)=>i===27||i===31?{...p,x:p.x+x,z:p.z+z}:p)});
  s.settle(bend(0,-.2));const q=s.bone('LeftUpperLeg').quaternion.clone();
  const d=V(0,-1,0).applyQuaternion(q);
  s.settle(bend(.2,0));
  assert.ok(s.bone('LeftUpperLeg').quaternion.angleTo(q)>.7);
  assert.ok(d.distanceTo(V(0,-1,0).applyQuaternion(s.bone('LeftUpperLeg').quaternion))<1e-4);
});

test('image motion enables bounded translation, rejects jumps, pause freezes root and recenter/reset restore origin',()=>{
  const s=setup(), f=neutral();s.r.setFootLock(false);
  const frame=(x:number,scale=.25)=>({...f,motion:{x,y:.6,scale}});
  s.settle(frame(.5));const start=s.bone('Hips').position.clone();
  for(let x=.5;x<=.6;x+=.002)s.tick(frame(x));s.settle(frame(.6));
  assert.ok(s.r.motionDebug()!.position[0]!>.15);
  const before=s.r.motionDebug()!.position;
  s.settle(frame(.98),50);
  assert.ok(Math.abs(s.r.motionDebug()!.position[0]!-before[0]!)<.002,'persistent jump must not become accepted with time');
  s.r.setPaused(true);const frozen=s.bone('Hips').position.clone();s.settle(frame(.58),10);
  assert.ok(frozen.distanceTo(s.bone('Hips').position)<1e-10);
  s.r.recenter();assert.ok(start.distanceTo(s.bone('Hips').position)<1e-4);
  s.r.reset();for(const e of s.bones){assert.ok(e.bone.position.distanceTo(e.initialPosition)<1e-8);assert.ok(e.bone.quaternion.angleTo(e.initialQuaternion)<1e-5);}
  const legacy=setup();legacy.settle(f);assert.equal(legacy.r.motionDebug()!.calibrated,false);
});

test('planted feet stay at world anchors under root jitter, release on lift/pivot/loss, IK preserves bone lengths',()=>{
  const s=setup(), f={...neutral(),motion:{x:.5,y:.6,scale:.25}};
  s.settle(f);let debug=s.r.motionDebug()!;
  assert.ok(debug.feet.every(l=>l.locked),JSON.stringify(debug));
  const anchors=debug.feet.map(l=>l.anchor!);
  const lengths=s.bones.map(e=>e.bone.position.length());
  for(let i=0;i<100;i++){
    s.tick({...f,motion:{...f.motion,x:.5+Math.sin(i*.1)*.005}});
    debug=s.r.motionDebug()!;
    assert.ok(debug.feet.every(l=>l.locked && l.error<.006),JSON.stringify(debug));
    debug.feet.forEach((l,j)=>assert.ok(V(...l.anchor as [number,number,number]).distanceTo(V(...anchors[j] as [number,number,number]))<1e-8));
  }
  s.bones.forEach((e,i)=>{if(e.name!=='Hips')assert.ok(Math.abs(e.bone.position.length()-lengths[i]!)<1e-8);});
  const lift={...f,worldLandmarks:f.worldLandmarks.map((p,i)=>[25,27,31].includes(i)?{...p,y:p.y-.22}:p)};
  s.tick(lift);assert.equal(s.r.motionDebug()!.feet[0]!.locked,false);
  s.settle(f);s.tick(rotate(f,1.2));assert.ok(s.r.motionDebug()!.feet.every(l=>!l.locked));
  s.settle(f);s.r.update(s.now()+300,.1);assert.ok(s.r.motionDebug()!.feet.every(l=>!l.locked));
  s.r.setFootLock(false);s.settle(f);assert.ok(s.r.motionDebug()!.feet.every(l=>!l.locked));
});

test('transformed root maps world turn correctly; invalid enhanced rig fails closed, legacy bindings remain',()=>{
  const s=setup(true);s.r.setFootLock(false);s.settle(rotate(neutral(),1.3));
  assert.ok(s.bone('Hips').getWorldQuaternion(new THREE.Quaternion()).angleTo(new THREE.Quaternion().setFromAxisAngle(V(0,1,0),1.3))<.002);
  const root=createFallbackRobot(),bones=collectBones(root);
  const r=new Retargeter(root,bones,fallbackMapping(root,bones),{version:1,hipsPath:[999],expectedHipsName:'Hips'});
  assert.equal(r.motionDebug(),undefined);assert.equal(r.debug().length,14);assert.equal(r.warnings.length,1);
});

test('optional motion protocol is strict and backward compatible; image observations require visible torso',()=>{
  const pose={type:'pose',version:1,room:'ABC234',sessionId:'motion_session_01',timestamp:0,seq:0,landmarks:neutral().worldLandmarks};
  assert.ok(isPoseMessage(pose));assert.ok(isPoseMessage({...pose,motion:{x:.5,y:.6,scale:.25}}));
  for(const motion of [{x:NaN,y:.5,scale:.2},{x:.5,y:.5,scale:0},{x:2,y:.5,scale:.2},{x:.5,y:.5,scale:.2,extra:1},null]){
    assert.equal(isImageMotion(motion),false);assert.equal(isPoseMessage({...pose,motion}),false);
  }
  const normalized=neutral().worldLandmarks.map((p,i)=>({...p,x:i===11||i===23?.6:.4,y:i===11||i===12?.3:.6}));
  assert.deepEqual(imageMotion({normalizedLandmarks:normalized,worldLandmarks:[]}),{x:.5,y:.6,scale:.3});
  normalized[11]!.visibility=0;assert.equal(imageMotion({normalizedLandmarks:normalized,worldLandmarks:[]}),undefined);
  assert.equal(parseMotionConfig(undefined),undefined);assert.throws(()=>parseMotionConfig({version:1,hipsPath:[-1],expectedHipsName:'Hips'}));
});
