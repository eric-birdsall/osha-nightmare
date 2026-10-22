import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../config.js';
import { COL, yawQuat } from '../physics.js';
import { boxMesh } from '../util/meshes.js';

// Pallet local frame: X = 1.0 m width, Z = 1.2 m length (fork entry from ±Z), origin at bottom center.
// Three runners along Z leave two fork pockets under the deck.
export function palletShapes() {
  const { size, mass, friction } = CONFIG.objects.pallet;
  const [w, h, l] = size;
  const deckT = 0.035;
  const runnerH = h - deckT;
  const runnerW = 0.1;
  const parts = [
    { half: [w / 2, deckT / 2, l / 2], pos: [0, h - deckT / 2, 0] },
    ...[-1, 0, 1].map((i) => ({
      half: [runnerW / 2, runnerH / 2, l / 2],
      pos: [i * (w / 2 - runnerW / 2), runnerH / 2, 0],
    })),
  ];
  const vol = parts.reduce((s, p) => s + p.half[0] * p.half[1] * p.half[2], 0);
  for (const p of parts) {
    p.mass = (mass * p.half[0] * p.half[1] * p.half[2]) / vol;
    p.friction = friction;
  }
  return parts;
}

export function createPallet(game, { pos, yaw = 0 }) {
  const body = game.world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(pos[0], pos[1], pos[2]).setRotation(yawQuat(yaw)).setCanSleep(true),
  );
  const shapes = palletShapes();
  const mesh = new THREE.Group();
  const color = CONFIG.objects.pallet.color;
  for (const s of shapes) {
    game.world.createCollider(
      RAPIER.ColliderDesc.cuboid(...s.half)
        .setTranslation(...s.pos)
        .setMass(s.mass)
        .setFriction(s.friction)
        .setCollisionGroups(COL.dyn),
      body,
    );
    const m = boxMesh(s.half[0] * 2, s.half[1] * 2, s.half[2] * 2, color);
    m.position.set(...s.pos);
    mesh.add(m);
  }
  // Deck board gaps (visual only)
  for (const x of [-0.3, -0.1, 0.1, 0.3]) {
    const gap = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.002, CONFIG.objects.pallet.size[2]),
      new THREE.MeshBasicMaterial({ color: 0x6b4f2a }),
    );
    gap.position.set(x, CONFIG.objects.pallet.size[1] + 0.001, 0);
    mesh.add(gap);
  }
  game.scene.add(mesh);
  const ent = { kind: 'pallet', body, mesh, shapes, mass: CONFIG.objects.pallet.mass };
  game.addEntity(ent);
  return ent;
}
