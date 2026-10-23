import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { COL } from '../physics.js';
import { boxMesh, flatMat, labelPlane } from '../util/meshes.js';
import { LAYOUT } from './layout.js';

// Packing stations: an island of workbenches back to back, each with bubble wrap and kraft paper
// on a shelf overhead, a scale, a monitor, a half-packed box and a stack of flat cardboard.
// Set dressing for now: the benches are solid, but nothing here has a job yet.

const BENCH_W = 2.4;
const BENCH_D = 0.9;
const BENCH_H = 0.9;
const GAP = 0.8; // between benches in a row
const CARDBOARD = 0xc49a6c;
const STEEL = 0x6b7280;

// Island size: [width along x, depth along z]
export function packingSize() {
  const { perRow } = LAYOUT.packing;
  return [perRow * BENCH_W + (perRow - 1) * GAP, BENCH_D * 2 + 0.1];
}

function solidBox(game, size, pos, rotY = 0) {
  game.world.createCollider(
    RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2)
      .setTranslation(...pos)
      .setRotation({ x: 0, y: Math.sin(rotY / 2), z: 0, w: Math.cos(rotY / 2) })
      .setFriction(0.8)
      .setCollisionGroups(COL.static),
    game.staticBody,
  );
}

// One station, built facing +z (the packer stands on the +z side) and turned by `yaw`.
function station(game, n, x, z, yaw) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = yaw;
  const add = (mesh, px, py, pz) => {
    mesh.position.set(px, py, pz);
    g.add(mesh);
    return mesh;
  };
  const box = (size, pos, color, opts = {}) => add(boxMesh(...size, color, { edges: false, ...opts }), ...pos);
  // Bench: wooden top on steel legs, a shelf underneath with flat cardboard on it
  box([BENCH_W, 0.06, BENCH_D], [0, BENCH_H - 0.03, 0], 0xb98d5a, { edges: true });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box([0.06, BENCH_H - 0.06, 0.06], [sx * (BENCH_W / 2 - 0.05), (BENCH_H - 0.06) / 2, sz * (BENCH_D / 2 - 0.05)], STEEL);
  box([BENCH_W - 0.1, 0.04, BENCH_D - 0.1], [0, 0.2, 0], STEEL);
  box([1.6, 0.12, 0.7], [-0.2, 0.28, 0], CARDBOARD);
  // Upright at the back with a shelf: bubble wrap and a kraft paper roll
  for (const sx of [-1, 1]) box([0.06, 1.25, 0.06], [sx * (BENCH_W / 2 - 0.05), BENCH_H + 0.6, -BENCH_D / 2 + 0.05], STEEL);
  box([BENCH_W, 0.04, 0.4], [0, 2.1, -BENCH_D / 2 + 0.2], STEEL);
  const bubble = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.95, 18), new THREE.MeshLambertMaterial({ color: 0xdff3ff, transparent: true, opacity: 0.85 }));
  bubble.rotation.z = Math.PI / 2;
  add(bubble, -0.55, 2.38, -BENCH_D / 2 + 0.22);
  const kraft = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.9, 14), flatMat(0xb08a5a));
  kraft.rotation.z = Math.PI / 2;
  add(kraft, 0.6, 2.25, -BENCH_D / 2 + 0.22);
  // Station number on the shelf edge
  const sign = labelPlane(`PACK ${n}`, 0.6, 0.18, { bg: '#1a7f37', fg: '#ffffff' });
  add(sign, 0, 2.0, -BENCH_D / 2 + 0.41);
  // On the bench: a monitor, a scale, a tape gun and a half-packed box
  box([0.5, 0.32, 0.04], [0.75, BENCH_H + 0.3, -0.28], 0x16171a);
  box([0.06, 0.14, 0.06], [0.75, BENCH_H + 0.07, -0.3], 0x16171a);
  box([0.42, 0.05, 0.36], [-0.65, BENCH_H + 0.025, 0.05], 0x9aa0a8);
  box([0.12, 0.03, 0.02], [-0.65, BENCH_H + 0.04, 0.24], 0x7cf0a0);
  box([0.16, 0.12, 0.08], [0.35, BENCH_H + 0.06, 0.25], 0xb3261e);
  box([0.46, 0.3, 0.36], [0.05, BENCH_H + 0.15, 0.08], CARDBOARD, { edges: true });
  const flap = (px, rz) => {
    const f = box([0.2, 0.01, 0.36], [px, BENCH_H + 0.36, 0.08], CARDBOARD);
    f.rotation.z = rz;
  };
  flap(-0.27, 0.9);
  flap(0.37, -0.9);
  // Anti-fatigue mat where the packer stands, and a bin at the end of the bench
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(BENCH_W - 0.2, 0.8), flatMat(0x1d1f23));
  mat.rotation.x = -Math.PI / 2;
  add(mat, 0, 0.006, BENCH_D / 2 + 0.45);
  const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.22, 0.7, 16), flatMat(0x2f5fb3));
  add(bin, BENCH_W / 2 + 0.32, 0.35, 0.15);
  game.scene.add(g);
  // Solid: the bench and the upright, and the bin
  solidBox(game, [BENCH_W, BENCH_H, BENCH_D], [x, BENCH_H / 2, z], yaw);
  const bin2 = new THREE.Vector3(BENCH_W / 2 + 0.32, 0, 0.15).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  solidBox(game, [0.5, 0.7, 0.5], [x + bin2.x, 0.35, z + bin2.z]);
}

export function buildPacking(game) {
  const { x, z, perRow } = LAYOUT.packing;
  const [w, d] = packingSize();
  // Two rows back to back: the north row's packers face north, the south row's face south
  let n = 1;
  for (const [row, yaw] of [[-1, Math.PI], [1, 0]]) {
    for (let i = 0; i < perRow; i++) {
      const bx = x - w / 2 + BENCH_W / 2 + i * (BENCH_W + GAP);
      station(game, n++, bx, z + row * (BENCH_D / 2 + 0.05), yaw);
    }
  }
  // A stack of empty pallets and flat-packed boxes at the east end
  const stack = new THREE.Group();
  stack.position.set(x + w / 2 + 1.2, 0, z);
  for (let k = 0; k < 6; k++) {
    const p = boxMesh(1.0, 0.13, 1.2, 0x9a7650, { edges: true });
    p.position.y = 0.065 + k * 0.14;
    p.rotation.y = (k % 2) * 0.05;
    stack.add(p);
  }
  game.scene.add(stack);
  solidBox(game, [1.0, 0.84, 1.2], [x + w / 2 + 1.2, 0.42, z]);
  // Painted work area round the island, and its name on the floor
  const pad = 1.6; // working room round the benches
  const area = new THREE.Mesh(new THREE.PlaneGeometry(w + 2 * pad + 1.6, d + 2 * pad), new THREE.MeshBasicMaterial({ color: 0x2f5fb3, transparent: true, opacity: 0.18, depthWrite: false }));
  area.rotation.x = -Math.PI / 2;
  area.position.set(x + 0.8, 0.004, z);
  game.scene.add(area);
  const label = labelPlane('PACKING', 3.2, 0.8, { bg: 'rgba(0,0,0,0)', fg: '#7fa8e8', transparent: true });
  label.rotation.set(-Math.PI / 2, 0, 0);
  label.position.set(x, 0.008, z + d / 2 + pad + 0.7);
  game.scene.add(label);
}
