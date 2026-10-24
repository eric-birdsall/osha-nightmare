import * as THREE from 'three';
import { boxMesh, flatMat, labelPlane } from '../util/meshes.js';
import { LAYOUT } from './layout.js';
import { prop } from './props.js';

// Packing stations: an island of workbenches in two rows back to back, with the packing line (a
// conveyor, see conveyor.js) running between them up to the wrapper. Each bench has bubble wrap and kraft paper
// on a shelf overhead, a scale, a monitor, a half-packed box and a stack of flat cardboard.
// Set dressing for now: nothing here has a job yet. The benches, the bins and the pallet stack
// are physics props, so the forklift or a blast can shove them about and knock them over.

const BENCH_W = 2.4;
const BENCH_D = 0.9;
const BENCH_H = 0.9;
const GAP = LAYOUT.packing.gap; // between benches in a row
const STAGGER = (BENCH_W + GAP) / 2; // the east row is shifted half a bench along, so its benches face the west row's gaps
const BOARD_TOP = 2.8; // top of the solid back panel: a backboard for boxes thrown at the packing line
const CARDBOARD = 0xc49a6c;
const STEEL = 0x6b7280;

// Island size before it's turned: [length along the rows, depth across them]
export function packingSize() {
  const { perRow } = LAYOUT.packing;
  return [perRow * BENCH_W + (perRow - 1) * GAP + STAGGER, BENCH_D * 2 + LAYOUT.packing.belt + 0.2];
}

// The island's floor rectangle in world x/z, with `pad` round it: { x0, x1, z0, z1 }
export function packingRect(pad = 0) {
  const { x, z, yaw = 0 } = LAYOUT.packing;
  const [w, d] = packingSize();
  const across = Math.abs(Math.sin(yaw)) > 0.5; // turned a quarter: rows run along z
  const [hx, hz] = across ? [d / 2, w / 2] : [w / 2, d / 2];
  return { x0: x - hx - pad, x1: x + hx + pad, z0: z - hz - pad, z1: z + hz + pad };
}

// One station, built facing +z (the packer stands on the +z side) and turned by `yaw`: a bench
// (with everything on it, as one body), the floor mat in front of it and a bin at its end.
function station(game, n, x, z, yaw) {
  const g = new THREE.Group();
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
  // Uprights at the back with a solid pegboard panel between them (facing the belt, it's a
  // backboard: boxes thrown at it drop onto the packing line), and a shelf with bubble wrap and a
  // kraft paper roll
  for (const sx of [-1, 1]) box([0.06, BOARD_TOP - BENCH_H, 0.06], [sx * (BENCH_W / 2 - 0.05), (BOARD_TOP + BENCH_H) / 2, -BENCH_D / 2 + 0.05], STEEL);
  box([BENCH_W - 0.04, BOARD_TOP - BENCH_H - 0.04, 0.03], [0, (BOARD_TOP + BENCH_H) / 2, -BENCH_D / 2 + 0.03], 0xd8cfb8, { edges: true });
  box([BENCH_W, 0.06, 0.06], [0, BOARD_TOP, -BENCH_D / 2 + 0.05], 0xf5c518);
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
  // The bench and the upright behind it: about 90 kg, a fair bit of it up high, so a good shove
  // tips it over
  const bench = prop(game, `PACK ${n}`, g, [x, 0.005, z], yaw, [
    { half: [BENCH_W / 2, BENCH_H / 2, BENCH_D / 2], pos: [0, BENCH_H / 2, 0] },
    { half: [BENCH_W / 2, (BOARD_TOP - BENCH_H) / 2, 0.2], pos: [0, (BOARD_TOP + BENCH_H) / 2, -BENCH_D / 2 + 0.2] },
  ], 90, { grip: true, kickTop: 2.0 });
  const at = (lx, lz) => new THREE.Vector3(lx, 0, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(new THREE.Vector3(x, 0, z));
  // Anti-fatigue mat where the packer stands (painted on, it stays put)
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(BENCH_W - 0.2, 0.8), flatMat(0x1d1f23));
  mat.rotation.set(-Math.PI / 2, 0, yaw);
  mat.position.copy(at(0, BENCH_D / 2 + 0.45)).setY(0.006);
  game.scene.add(mat);
  // A bin at the end of the bench
  const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.22, 0.7, 16), flatMat(0x2f5fb3));
  bin.castShadow = true;
  const b = at(BENCH_W / 2 + 0.32, 0.15);
  prop(game, 'bin', bin, [b.x, 0.355, b.z], 0, [{ cyl: [0.35, 0.24] }], 6);
  return bench;
}

export function buildPacking(game) {
  const { x, z, perRow, yaw: turn = 0 } = LAYOUT.packing;
  const [w, d] = packingSize();
  // Laid out with the rows along local x, then the whole island is turned by `turn`
  const at = (lx, lz) => new THREE.Vector3(lx, 0, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), turn).add(new THREE.Vector3(x, 0, z));
  // Two rows back to back, the packers facing out
  let n = 1;
  const rows = [];
  for (const [row, yaw] of [[-1, Math.PI], [1, 0]]) {
    const benches = [];
    for (let i = 0; i < perRow; i++) {
      const p = at(-w / 2 + BENCH_W / 2 + i * (BENCH_W + GAP) + (row > 0 ? STAGGER : 0), row * (d / 2 - BENCH_D / 2));
      benches.push(station(game, n++, p.x, p.z, yaw + turn));
    }
    rows.push(benches);
  }
  // A stack of empty pallets at the south end, clear of the belt
  const stack = new THREE.Group();
  for (let k = 0; k < 6; k++) {
    const p = boxMesh(1.0, 0.13, 1.2, 0x9a7650, { edges: true });
    p.position.y = 0.065 + k * 0.14;
    p.rotation.y = (k % 2) * 0.05;
    stack.add(p);
  }
  const sp = at(-w / 2 - 2.0, 0);
  prop(game, 'pallet stack', stack, [sp.x, 0.005, sp.z], turn, [{ half: [0.5, 0.42, 0.6], pos: [0, 0.42, 0] }], 120);
  // Painted work area round the island, and its name on the floor
  const pad = 1.6; // working room round the benches
  const area = new THREE.Mesh(new THREE.PlaneGeometry(w + 2 * pad + 1.6, d + 2 * pad), new THREE.MeshBasicMaterial({ color: 0x2f5fb3, transparent: true, opacity: 0.18, depthWrite: false }));
  area.rotation.set(-Math.PI / 2, 0, turn);
  area.position.copy(at(-0.8, 0)).setY(0.004);
  game.scene.add(area);
  const label = labelPlane('PACKING', 3.2, 0.8, { bg: 'rgba(0,0,0,0)', fg: '#7fa8e8', transparent: true });
  label.rotation.set(-Math.PI / 2, 0, turn);
  label.position.copy(at(0, d / 2 + pad + 0.7)).setY(0.008);
  game.scene.add(label);
}
