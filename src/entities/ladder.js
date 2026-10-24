import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../config.js';
import { COL, yawQuat, quatToThree } from '../physics.js';
import { boxMesh, flatMat } from '../util/meshes.js';

// A-frame step ladder. Local frame: origin on the floor under the middle, the step side faces +Z
// (Dave climbs it facing -Z, so whatever he's working on is beyond the top cap).
//   'stored'  folded, hanging on a LADDERS stand (kinematic, can't be knocked off)
//   'carried' folded on Dave's shoulder (no collisions)
//   'dropped' folded, loose on the floor (dynamic)
//   'open'    set up as an A-frame (dynamic: the forklift can shove, tip or lift it)

const STEEL = 0xc8ccd2;
const TREAD = 0x8d939b;
const YELLOW = 0xf5c518;

// Front section (the steps) and back legs, as lines from the floor up to the top cap.
function frame() {
  const cfg = CONFIG.ladder;
  const h = cfg.capHeight;
  const frontZ = (y) => cfg.baseFront + ((cfg.topFront - cfg.baseFront) * y) / h;
  const backZ = (y) => cfg.baseBack + ((cfg.topBack - cfg.baseBack) * y) / h;
  return { h, frontZ, backZ };
}

// Collider/mesh parts of the open A-frame: [half extents, position, rotation about X, color, kind]
function openParts() {
  const cfg = CONFIG.ladder;
  const { h, frontZ, backZ } = frame();
  const halfW = cfg.width / 2;
  const parts = [];
  const leg = (z0, z1, x, color) => {
    const len = Math.hypot(z1 - z0, h);
    const tilt = Math.atan2(z1 - z0, h); // lean from vertical, about X (top toward z1)
    parts.push([[0.025, len / 2, 0.03], [x, h / 2 + 0.02, (z0 + z1) / 2], tilt, color, 'leg']);
  };
  for (const sx of [-1, 1]) {
    leg(frontZ(0), frontZ(h), sx * halfW, STEEL); // stiles carrying the steps
    leg(backZ(0), backZ(h), sx * (halfW - 0.02), STEEL); // rear legs
  }
  const steps = cfg.steps;
  for (let i = 1; i <= steps; i++) {
    const y = (cfg.topStep * i) / steps;
    parts.push([[halfW - 0.03, 0.02, cfg.tread / 2], [0, y - 0.02, frontZ(y) - cfg.tread / 2 + 0.02], 0, TREAD, 'tread']);
  }
  parts.push([[halfW + 0.03, 0.04, (cfg.topFront - cfg.topBack) / 2 + 0.06], [0, h + 0.02, (cfg.topFront + cfg.topBack) / 2], 0, YELLOW, 'cap']);
  // Low spreader tray between the two sections: holds them apart, and gives the forks
  // something flat to lift on
  const trayY = 0.26;
  parts.push([[halfW - 0.06, 0.015, (frontZ(trayY) - backZ(trayY)) / 2 - 0.04], [0, trayY, (frontZ(trayY) + backZ(trayY)) / 2], 0, 0x9aa0a8, 'tray']);
  return parts;
}

// Folded: both sections flat together, about as deep as one rail.
function foldedParts() {
  const cfg = CONFIG.ladder;
  const h = cfg.capHeight + 0.06;
  return [[[cfg.width / 2 + 0.03, h / 2, 0.07], [0, h / 2, 0], 0, STEEL, 'slab']];
}

function partMesh([half, pos, rotX, color, kind]) {
  const m = boxMesh(half[0] * 2, half[1] * 2, half[2] * 2, color, { edges: kind !== 'leg' });
  m.position.set(...pos);
  m.rotation.x = rotX;
  return m;
}

function buildOpenMesh() {
  const g = new THREE.Group();
  for (const p of openParts()) g.add(partMesh(p));
  // Spreader braces between the sections (visual) and rubber feet
  const cfg = CONFIG.ladder;
  const { frontZ, backZ } = frame();
  const y = cfg.capHeight * 0.45;
  for (const sx of [-1, 1]) {
    const len = frontZ(y) - backZ(y);
    const brace = boxMesh(0.015, 0.015, len, 0x888d94, { edges: false });
    brace.position.set(sx * (cfg.width / 2 - 0.01), y, (frontZ(y) + backZ(y)) / 2);
    g.add(brace);
    for (const z of [frontZ(0), backZ(0)]) {
      const foot = boxMesh(0.07, 0.03, 0.09, 0x1a1a1a, { edges: false });
      foot.position.set(sx * (cfg.width / 2), 0.015, z);
      g.add(foot);
    }
  }
  return g;
}

function buildFoldedMesh() {
  const cfg = CONFIG.ladder;
  const g = new THREE.Group();
  const h = cfg.capHeight + 0.06;
  const halfW = cfg.width / 2;
  for (const sx of [-1, 1]) {
    const rail = boxMesh(0.05, h, 0.12, STEEL);
    rail.position.set(sx * halfW, h / 2, 0);
    g.add(rail);
  }
  for (let i = 1; i <= cfg.steps; i++) {
    const tread = boxMesh(cfg.width - 0.05, 0.035, 0.08, TREAD);
    tread.position.set(0, (cfg.topStep * i) / cfg.steps, 0.02);
    g.add(tread);
  }
  const cap = boxMesh(cfg.width + 0.06, 0.08, 0.14, YELLOW);
  cap.position.set(0, h - 0.04, 0);
  g.add(cap);
  return g;
}

export class Ladder {
  constructor(game, { pos, yaw = 0, state = 'stored' }) {
    this.game = game;
    this.kind = 'ladder';
    this.mass = CONFIG.ladder.mass;
    this.body = game.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(...pos)
        .setRotation(yawQuat(yaw))
        .setCanSleep(true)
        .setAdditionalSolverIterations(2),
    );
    this.mesh = new THREE.Group();
    this.openMesh = buildOpenMesh();
    this.foldedMesh = buildFoldedMesh();
    this.mesh.add(this.openMesh, this.foldedMesh);
    this.mesh.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    game.scene.add(this.mesh);
    this.forkliftTouched = -Infinity;
    this.setState(state);
    game.addEntity(this);
  }

  setState(state, pose) {
    const { body } = this;
    this.state = state;
    if (pose) {
      body.setTranslation(pose.pos, true);
      body.setRotation(yawQuat(pose.yaw), true);
    }
    for (let i = body.numColliders() - 1; i >= 0; i--) this.game.world.removeCollider(body.collider(i), false);
    const open = state === 'open';
    // On Dave's shoulder it would fill his own view: only the other camera sees it there
    this.mesh.traverse((o) => o.layers.set(state === 'carried' ? 1 : 0));
    this.openMesh.visible = open;
    this.foldedMesh.visible = !open;
    const dynamic = state === 'open' || state === 'dropped';
    body.setBodyType(dynamic ? RAPIER.RigidBodyType.Dynamic : RAPIER.RigidBodyType.KinematicPositionBased, true);
    if (state !== 'carried') {
      const parts = open ? openParts() : foldedParts();
      const vol = parts.reduce((v, [h]) => v + h[0] * h[1] * h[2], 0);
      for (const [half, p, rotX] of parts) {
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), rotX);
        this.game.world.createCollider(
          RAPIER.ColliderDesc.cuboid(...half)
            .setTranslation(...p)
            .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
            .setMass((this.mass * half[0] * half[1] * half[2]) / vol)
            .setFriction(CONFIG.ladder.friction)
            .setCollisionGroups(COL.dyn),
          body,
        );
      }
    }
    if (dynamic) {
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      body.wakeUp();
    }
  }

  // How upright it is (1 = standing straight).
  get upY() {
    return new THREE.Vector3(0, 1, 0).applyQuaternion(quatToThree(this.body.rotation())).y;
  }

  // Set up and standing: Dave can climb it, and folding it needs a hold of E/X.
  get standing() {
    return this.state === 'open' && this.upY > CONFIG.ladder.climbableUp;
  }

  toWorld(x, y, z) {
    const t = this.body.translation();
    return new THREE.Vector3(x, y, z).applyQuaternion(quatToThree(this.body.rotation())).add(new THREE.Vector3(t.x, t.y, t.z));
  }

  // Horizontal direction the steps face.
  get front() {
    return new THREE.Vector3(0, 0, 1).applyQuaternion(quatToThree(this.body.rotation())).setY(0).normalize();
  }

  get heading() {
    const f = this.front;
    return Math.atan2(f.x, f.z);
  }

  // Where Dave's feet go when he's `h` metres up the steps (just in front of the treads).
  footPoint(h) {
    const { frontZ } = frame();
    return this.toWorld(0, h + 0.02, frontZ(h) + 0.06);
  }

  // Where Dave's feet go when he steps off the bottom.
  stepOffPoint() {
    return this.toWorld(0, 0, frame().frontZ(0) + 0.5);
  }

  topPoint() {
    return this.toWorld(0, CONFIG.ladder.capHeight, 0);
  }
}

// Translucent open A-frame showing where a carried ladder will be set up (climber's camera only).
export function buildLadderGhost() {
  const g = buildOpenMesh();
  const mat = new THREE.MeshBasicMaterial({ color: 0x7cf0a0, transparent: true, opacity: 0.35, depthWrite: false });
  g.traverse((o) => {
    if (o.isMesh) o.material = mat;
    if (o.isLineSegments) o.visible = false;
    o.layers.set(2);
    o.castShadow = false;
  });
  g.renderOrder = 4;
  g.userData.mat = mat;
  return g;
}

// Clearance box for setting a ladder up: half extents in its local frame, centred above the floor.
export function ladderFootprint() {
  const cfg = CONFIG.ladder;
  return {
    half: [cfg.width / 2 + 0.06, cfg.capHeight / 2, (cfg.baseFront - cfg.baseBack) / 2 + 0.04],
    centerZ: (cfg.baseFront + cfg.baseBack) / 2,
  };
}

// Yellow ladder stand with one or two folded ladders hanging on it. (x, z) is the middle of the stand,
// against a wall; the ladders face +Z rotated by `yaw`.
export function createLadderStand(game, { pos, yaw = 0, count = 2, showLabel = true }) {
  const [x, y, z] = pos;
  const q = yawQuat(yaw);
  const rot = quatToThree(q);
  const at = (lx, ly, lz) => new THREE.Vector3(lx, ly, lz).applyQuaternion(rot).add(new THREE.Vector3(x, y, z));
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.quaternion.copy(rot);
  const halfWidth = count / 2;
  for (const lx of count === 1 ? [-halfWidth, halfWidth] : [-halfWidth, 0, halfWidth]) {
    const post = boxMesh(0.08, 2.3, 0.08, YELLOW);
    post.position.set(lx, 1.15, -0.12);
    g.add(post);
  }
  const bar = boxMesh(count + 0.1, 0.08, 0.1, 0x16171a);
  bar.position.set(0, 1.7, -0.08);
  g.add(bar);
  if (showLabel) {
    // Sign across the top
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f5c518';
    ctx.fillRect(0, 0, 256, 64);
    ctx.strokeStyle = '#16171a';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, 250, 58);
    ctx.fillStyle = '#16171a';
    ctx.font = 'bold 40px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(count === 1 ? 'LADDER' : 'LADDERS', 128, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(count === 1 ? 1.0 : 1.6, 0.4), new THREE.MeshBasicMaterial({ map: tex }));
    sign.position.set(0, 2.5, -0.07);
    g.add(sign);
  }
  game.scene.add(g);
  // Posts are solid
  const p0 = at(0, 1.15, -0.12);
  game.world.createCollider(
    RAPIER.ColliderDesc.cuboid(halfWidth + 0.05, 1.15, 0.05).setTranslation(p0.x, p0.y, p0.z).setRotation(q).setCollisionGroups(COL.static),
    game.staticBody,
  );
  const yawOf = Math.atan2(new THREE.Vector3(0, 0, 1).applyQuaternion(rot).x, new THREE.Vector3(0, 0, 1).applyQuaternion(rot).z);
  return (count === 1 ? [0] : [-0.5, 0.5]).map((lx) => {
    const p = at(lx, 0.01, 0.0);
    return new Ladder(game, { pos: [p.x, p.y, p.z], yaw: yawOf, state: 'stored' });
  });
}
