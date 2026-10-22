import * as THREE from 'three';
import { flatMat } from '../util/meshes.js';

// The warehouse worker: one set of body parts shared by the posed/animated climber the driver
// sees, the ragdoll, and the first-person arms. Template stands on its feet facing +Z.

const C = {
  skin: 0xe0b48a,
  vest: 0xff7a00,
  stripe: 0xe8eef2,
  shirt: 0x3b6fd6,
  shirtDark: 0x2d58ad,
  pants: 0x2a3550,
  belt: 0x1a1a1a,
  boot: 0x4a3322,
  glove: 0xc9a066,
  gloveDark: 0xa98248,
  hat: 0xffd400,
};

export const PARTS = [
  { name: 'torso', half: [0.2, 0.34, 0.12], pos: [0, 1.2, 0] },
  { name: 'head', ball: 0.12, pos: [0, 1.68, 0] },
  { name: 'uArmL', half: [0.05, 0.15, 0.05], pos: [0.27, 1.38, 0] },
  { name: 'lArmL', half: [0.045, 0.15, 0.045], pos: [0.27, 1.07, 0] },
  { name: 'uArmR', half: [0.05, 0.15, 0.05], pos: [-0.27, 1.38, 0] },
  { name: 'lArmR', half: [0.045, 0.15, 0.045], pos: [-0.27, 1.07, 0] },
  { name: 'uLegL', half: [0.075, 0.21, 0.075], pos: [0.1, 0.64, 0] },
  { name: 'lLegL', half: [0.065, 0.21, 0.065], pos: [0.1, 0.22, 0] },
  { name: 'uLegR', half: [0.075, 0.21, 0.075], pos: [-0.1, 0.64, 0] },
  { name: 'lLegR', half: [0.065, 0.21, 0.065], pos: [-0.1, 0.22, 0] },
];

// [parent, child, joint position in the template]
export const JOINTS = [
  ['torso', 'head', [0, 1.55, 0]],
  ['torso', 'uArmL', [0.26, 1.52, 0]],
  ['uArmL', 'lArmL', [0.27, 1.22, 0]],
  ['torso', 'uArmR', [-0.26, 1.52, 0]],
  ['uArmR', 'lArmR', [-0.27, 1.22, 0]],
  ['torso', 'uLegL', [0.1, 0.86, 0]],
  ['uLegL', 'lLegL', [0.1, 0.43, 0]],
  ['torso', 'uLegR', [-0.1, 0.86, 0]],
  ['uLegR', 'lLegR', [-0.1, 0.43, 0]],
];

const part = (name) => PARTS.find((p) => p.name === name);

function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), flatMat(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

// Mesh for one body part, centered on the part's own origin (matches its ragdoll collider).
export function partMesh(name) {
  const p = part(name);
  const g = new THREE.Group();
  if (name === 'head') {
    const r = p.ball;
    const head = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), flatMat(C.skin));
    head.castShadow = true;
    const hat = new THREE.Mesh(new THREE.SphereGeometry(r * 1.12, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), flatMat(C.hat));
    hat.position.y = 0.025;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.18, r * 1.18, 0.012, 18), flatMat(C.hat));
    brim.position.set(0, 0.03, 0.02);
    const peak = box(0.14, 0.012, 0.07, C.hat, 0, 0.03, r + 0.02);
    const nose = box(0.03, 0.04, 0.04, 0xd09a70, 0, -0.01, r - 0.005);
    const eyes = [-1, 1].map((s) => box(0.022, 0.018, 0.01, 0x222222, s * 0.042, 0.022, r - 0.02));
    g.add(head, hat, brim, peak, nose, ...eyes);
  } else if (name === 'torso') {
    const [hx, hy, hz] = p.half;
    // Shirt core, hi-vis vest over the chest, belt, and the top of the pants
    g.add(box(hx * 2, hy * 2, hz * 2, C.shirt));
    g.add(box(hx * 2 + 0.01, 0.46, hz * 2 + 0.01, C.vest, 0, 0.09));
    for (const y of [0.0, 0.16]) g.add(box(hx * 2 + 0.02, 0.035, hz * 2 + 0.02, C.stripe, 0, y));
    g.add(box(hx * 2 + 0.015, 0.04, hz * 2 + 0.015, C.belt, 0, -0.165));
    g.add(box(hx * 2 + 0.005, 0.15, hz * 2 + 0.005, C.pants, 0, -0.265));
    g.add(box(0.045, 0.03, 0.01, 0xb0b0b0, 0, -0.165, hz + 0.01)); // buckle
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.06, 10), flatMat(C.skin));
    neck.position.y = hy + 0.02;
    g.add(neck);
  } else if (name.startsWith('uArm')) {
    const [hx, hy, hz] = p.half;
    g.add(box(hx * 2, hy * 2, hz * 2, C.shirt));
    g.add(box(hx * 2 + 0.01, 0.06, hz * 2 + 0.01, C.shirtDark, 0, hy - 0.03)); // shoulder seam
  } else if (name.startsWith('lArm')) {
    const [hx, hy, hz] = p.half;
    g.add(box(hx * 2, hy * 2 - 0.08, hz * 2, C.skin, 0, 0.04));
    g.add(box(hx * 2 + 0.012, 0.03, hz * 2 + 0.012, C.gloveDark, 0, -hy + 0.085)); // glove cuff
    g.add(box(hx * 2 + 0.006, 0.08, hz * 2 + 0.02, C.glove, 0, -hy + 0.035, 0.005)); // gloved hand
  } else if (name.startsWith('uLeg')) {
    const [hx, hy, hz] = p.half;
    g.add(box(hx * 2, hy * 2, hz * 2, C.pants));
  } else if (name.startsWith('lLeg')) {
    const [hx, hy, hz] = p.half;
    g.add(box(hx * 2, hy * 2 - 0.08, hz * 2, C.pants, 0, 0.04));
    g.add(box(hx * 2 + 0.02, 0.1, hz * 2 + 0.08, C.boot, 0, -hy + 0.05, 0.035)); // work boot
    g.add(box(hx * 2 + 0.024, 0.02, hz * 2 + 0.084, 0x1e1e1e, 0, -hy + 0.01, 0.035)); // sole
  }
  return g;
}

// Jointed, animated worker for when the climber is on their feet. Facing follows yaw
// (camera convention: yaw 0 faces -Z).
export class WorkerModel {
  constructor() {
    this.root = new THREE.Group();
    this.body = new THREE.Group(); // template space (faces +Z)
    this.root.add(this.body);
    this.phase = 0;
    this.pivots = {};
    const pos = (n) => new THREE.Vector3(...part(n).pos);
    const joint = (child) => new THREE.Vector3(...JOINTS.find((j) => j[1] === child)[2]);

    const torso = partMesh('torso');
    torso.position.copy(pos('torso'));
    this.body.add(torso);
    this.torso = torso;

    const neck = new THREE.Group();
    neck.position.copy(joint('head')).sub(pos('torso'));
    const head = partMesh('head');
    head.position.copy(pos('head')).sub(joint('head'));
    neck.add(head);
    torso.add(neck);
    this.pivots.neck = neck;

    // Shoulders/hips hang off the torso; elbows/knees off the upper limb.
    const limb = (upper, lower, parent, parentPos) => {
      const top = new THREE.Group();
      top.position.copy(joint(upper)).sub(parentPos);
      const um = partMesh(upper);
      um.position.copy(pos(upper)).sub(joint(upper));
      top.add(um);
      const mid = new THREE.Group();
      mid.position.copy(joint(lower)).sub(joint(upper));
      const lm = partMesh(lower);
      lm.position.copy(pos(lower)).sub(joint(lower));
      mid.add(lm);
      top.add(mid);
      parent.add(top);
      return [top, mid];
    };
    [this.pivots.shoulderL, this.pivots.elbowL] = limb('uArmL', 'lArmL', torso, pos('torso'));
    [this.pivots.shoulderR, this.pivots.elbowR] = limb('uArmR', 'lArmR', torso, pos('torso'));
    [this.pivots.hipL, this.pivots.kneeL] = limb('uLegL', 'lLegL', torso, pos('torso'));
    [this.pivots.hipR, this.pivots.kneeR] = limb('uLegR', 'lLegR', torso, pos('torso'));
  }

  // speed: walking speed over the ground (m/s). Rotations about X: negative swings a limb forward.
  update(dt, { yaw, pitch = 0, speed = 0, grounded = true, carrying = false }) {
    const P = this.pivots;
    this.body.rotation.y = yaw + Math.PI;
    const amp = grounded ? Math.min(1, speed / 3.5) * 0.65 : 0;
    this.phase += dt * (2.2 + speed * 2.0) * (amp > 0.02 ? 1 : 0);
    const s = Math.sin(this.phase);
    const lerp = (obj, key, target, k = 12) => (obj[key] += (target - obj[key]) * Math.min(1, dt * k));

    let hipL = -s * amp;
    let hipR = s * amp;
    let kneeL = Math.max(0, s) * amp * 1.4;
    let kneeR = Math.max(0, -s) * amp * 1.4;
    let shL = s * amp * 0.8;
    let shR = -s * amp * 0.8;
    let elL = -0.25 - Math.max(0, -s) * amp * 0.5;
    let elR = -0.25 - Math.max(0, s) * amp * 0.5;
    let armOut = 0.06;
    if (!grounded) {
      hipL = -0.6;
      hipR = -0.15;
      kneeL = 0.9;
      kneeR = 0.4;
      shL = shR = -0.35;
      armOut = 0.45;
    }
    if (carrying) {
      shL = shR = -1.15;
      elL = elR = -0.35;
      armOut = -0.12;
    }
    lerp(P.hipL.rotation, 'x', hipL);
    lerp(P.hipR.rotation, 'x', hipR);
    lerp(P.kneeL.rotation, 'x', kneeL);
    lerp(P.kneeR.rotation, 'x', kneeR);
    lerp(P.shoulderL.rotation, 'x', shL);
    lerp(P.shoulderR.rotation, 'x', shR);
    lerp(P.elbowL.rotation, 'x', elL);
    lerp(P.elbowR.rotation, 'x', elR);
    lerp(P.shoulderL.rotation, 'z', armOut);
    lerp(P.shoulderR.rotation, 'z', -armOut);
    lerp(P.neck.rotation, 'x', -pitch * 0.6);
    // Walking bob and a little lean into the stride
    this.body.position.y = grounded ? Math.abs(Math.cos(this.phase)) * amp * 0.05 - amp * 0.03 : 0;
    lerp(this.torso.rotation, 'x', amp * 0.12);
  }
}

// First-person forearm + work glove for the climber's own camera. side: -1 left, +1 right.
// Built pointing down camera -Z from roughly the elbow.
export function firstPersonArm(side) {
  const arm = new THREE.Group();
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.044, 0.32, 12), flatMat(C.shirt));
  sleeve.rotation.x = Math.PI / 2;
  sleeve.position.z = -0.14;
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.035, 12), flatMat(C.gloveDark));
  cuff.rotation.x = Math.PI / 2;
  cuff.position.z = -0.31;
  arm.add(sleeve, cuff);

  // Glove: palm, four slightly curled fingers and a thumb on the inner side.
  const glove = new THREE.Group();
  glove.position.z = -0.33;
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.032, 0.09), flatMat(C.glove));
  palm.position.z = -0.045;
  glove.add(palm);
  for (let i = 0; i < 4; i++) {
    const len = [0.06, 0.07, 0.068, 0.055][i];
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.017, 0.022, len), flatMat(C.glove));
    const knuckle = new THREE.Group();
    knuckle.position.set((i - 1.5) * 0.02 * side, 0, -0.09);
    knuckle.rotation.x = -0.7;
    f.position.z = -len / 2;
    knuckle.add(f);
    glove.add(knuckle);
  }
  const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.022, 0.055), flatMat(C.glove));
  thumb.position.set(-side * 0.048, -0.006, -0.04);
  thumb.rotation.y = side * 0.6;
  glove.add(thumb);
  arm.add(glove);
  arm.userData.glove = glove;
  return arm;
}
