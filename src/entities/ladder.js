import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../config.js';
import { COL, yawQuat } from '../physics.js';
import { boxMesh, flatMat } from '../util/meshes.js';

// Rolling platform ladder. Local frame: steps climb toward +Z, origin on the floor under the
// middle of the base. Dave walks up the steps like stairs (each riser is low enough for the
// character controller's step-up); the top platform is level with shelf 2 (3.0 m).
export function createLadder(game, { pos, yaw = 0 }) {
  const cfg = CONFIG.ladder;
  const steps = Math.round((cfg.platformHeight - cfg.rise) / cfg.rise); // last step sits one rise below the platform
  const halfW = cfg.width / 2;
  const runStart = -((steps * cfg.tread + cfg.platformDepth) / 2);
  const platformZ0 = runStart + steps * cfg.tread;
  const platformZ1 = platformZ0 + cfg.platformDepth;
  const top = cfg.platformHeight;

  const steel = 0xc8ccd2;
  const tread = 0x8d939b;
  const yellow = 0xf5c518;
  // [half extents, position, color, rotation about X, isStep]
  const parts = [];
  for (let i = 0; i < steps; i++) {
    const y = (i + 1) * cfg.rise;
    parts.push([[halfW - 0.06, cfg.rise / 2, cfg.tread / 2], [0, y - cfg.rise / 2, runStart + (i + 0.5) * cfg.tread], tread, 0, true]);
  }
  // Platform (walkable) and its toe board
  parts.push([[halfW, 0.03, cfg.platformDepth / 2], [0, top - 0.03, (platformZ0 + platformZ1) / 2], tread, 0, false]);
  // Base rails on the floor and a cross bar at each end
  const baseLen = platformZ1 - runStart;
  for (const sx of [-1, 1]) parts.push([[0.03, 0.04, baseLen / 2], [sx * halfW, 0.04, (runStart + platformZ1) / 2], steel, 0, false]);
  for (const z of [runStart + 0.03, platformZ1 - 0.03]) parts.push([[halfW, 0.04, 0.03], [0, 0.04, z], steel, 0, false]);
  // Rear legs holding up the platform
  for (const sx of [-1, 1]) for (const z of [platformZ0 + 0.03, platformZ1 - 0.03]) parts.push([[0.025, top / 2, 0.025], [sx * halfW, top / 2, z], steel, 0, false]);
  // Stringers along the steps (sloped)
  const slope = Math.atan2(top - cfg.rise, steps * cfg.tread);
  const stringerLen = Math.hypot(steps * cfg.tread, top - cfg.rise);
  for (const sx of [-1, 1]) {
    parts.push([[0.025, 0.06, stringerLen / 2], [sx * (halfW - 0.03), (top - cfg.rise) / 2, runStart + (steps * cfg.tread) / 2], steel, -slope, false]);
  }
  // Handrails (round tubes, too thin to stand on): sloped along the steps, then around the platform
  for (const sx of [-1, 1]) {
    parts.push([[0.022, 0.022, stringerLen / 2], [sx * halfW, (top - cfg.rise) / 2 + 0.95, runStart + (steps * cfg.tread) / 2 + 0.05], yellow, -slope, false, 'z']);
    parts.push([[0.022, 0.5, 0.022], [sx * halfW, top + 0.5, platformZ0 + 0.02], yellow, 0, false, 'y']);
    parts.push([[0.022, 0.5, 0.022], [sx * halfW, top + 0.5, platformZ1 - 0.02], yellow, 0, false, 'y']);
    parts.push([[0.022, 0.022, cfg.platformDepth / 2], [sx * halfW, top + 1.0, (platformZ0 + platformZ1) / 2], yellow, 0, false, 'z']);
  }

  const body = game.world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(pos[0], pos[1], pos[2]).setRotation(yawQuat(yaw)).setCanSleep(true).setAdditionalSolverIterations(2),
  );
  const vol = parts.reduce((v, [h]) => v + h[0] * h[1] * h[2], 0);
  const stepHandles = new Set();
  const railHandles = new Set();
  const mesh = new THREE.Group();
  for (const [half, p, color, rotX, isStep, tube] of parts) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), rotX);
    const c = game.world.createCollider(
      RAPIER.ColliderDesc.cuboid(...half)
        .setTranslation(...p)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setMass((cfg.mass * half[0] * half[1] * half[2]) / vol)
        .setFriction(cfg.friction)
        .setCollisionGroups(COL.dyn),
      body,
    );
    if (isStep) stepHandles.add(c.handle);
    if (tube) railHandles.add(c.handle);
    let m;
    if (tube) {
      // Round tube along its long axis
      const len = (tube === 'y' ? half[1] : half[2]) * 2;
      m = new THREE.Mesh(new THREE.CylinderGeometry(half[0], half[0], len, 12), flatMat(color));
      const inner = new THREE.Group();
      if (tube === 'z') m.rotation.x = Math.PI / 2;
      inner.add(m);
      m = inner;
    } else {
      m = boxMesh(half[0] * 2, half[1] * 2, half[2] * 2, color, { edges: isStep || rotX === 0 });
    }
    m.position.set(...p);
    m.quaternion.copy(q);
    mesh.add(m);
  }
  // Casters (visual)
  for (const sx of [-1, 1]) {
    for (const z of [runStart + 0.08, platformZ1 - 0.08]) {
      const caster = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 12), flatMat(0x1a1a1a));
      caster.rotation.z = Math.PI / 2;
      caster.position.set(sx * halfW, 0.0, z);
      mesh.add(caster);
    }
  }
  mesh.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  game.scene.add(mesh);
  const ent = { kind: 'ladder', body, mesh, stepHandles, railHandles, mass: cfg.mass };
  game.addEntity(ent);
  return ent;
}
