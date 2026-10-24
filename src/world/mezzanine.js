import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { COL } from '../physics.js';
import { boxMesh, flatMat, labelPlane } from '../util/meshes.js';
import { LAYOUT } from './layout.js';
import { prop } from './props.js';

// The mezzanine: a steel deck on columns along the south wall, holding the backstock racks H/I.
// Dave climbs the stairs at its east end; the forklift can lift a pallet (or Dave on one) up to the
// gap in its front railing, the pallet gate. The deck's east edge is railed except where it meets
// the top of the stairs. Under it is the break room: toilets, a water fountain, vending machines,
// a table and chairs and a microwave on a counter.

const YELLOW = 0xf5c518;
const STEEL = 0x5b636d;
const DECK_T = 0.2; // deck thickness
const STEPS = 18;
const TREAD = 0.22;
const STAIRS_W = 2.0;
const STAIRS_START = 0.6; // the bottom step starts this far north of the deck's front edge

function solid(game, size, pos) {
  game.world.createCollider(
    RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2).setTranslation(...pos).setFriction(0.8).setCollisionGroups(COL.static),
    game.staticBody,
  );
}

function add(game, mesh, x, y, z) {
  mesh.position.set(x, y, z);
  game.scene.add(mesh);
  return mesh;
}

// A yellow railing from (x0, z0) to (x1, z1) at height y: posts, two rails and a toe board, with
// a collider taller than the rails so nobody hops over it
function railing(game, x0, z0, x1, z1, y) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  if (len < 0.1) return;
  const ry = Math.atan2(-(z1 - z0), x1 - x0);
  const [mx, mz] = [(x0 + x1) / 2, (z0 + z1) / 2];
  game.world.createCollider(
    RAPIER.ColliderDesc.cuboid(len / 2, 0.75, 0.05)
      .setTranslation(mx, y + 0.75, mz)
      .setRotation({ x: 0, y: Math.sin(ry / 2), z: 0, w: Math.cos(ry / 2) })
      .setCollisionGroups(COL.static),
    game.staticBody,
  );
  const g = new THREE.Group();
  g.position.set(mx, y, mz);
  g.rotation.y = ry;
  const posts = Math.max(1, Math.ceil(len / 2));
  for (let i = 0; i <= posts; i++) {
    const post = boxMesh(0.07, 1.1, 0.07, YELLOW, { edges: false });
    post.position.set(-len / 2 + (i * len) / posts, 0.55, 0);
    g.add(post);
  }
  for (const h of [0.55, 1.08]) {
    const rail = boxMesh(len, 0.05, 0.05, YELLOW, { edges: false });
    rail.position.y = h;
    g.add(rail);
  }
  const toe = boxMesh(len, 0.12, 0.02, 0x16171a, { edges: false });
  toe.position.y = 0.06;
  g.add(toe);
  game.scene.add(g);
}

// A canvas-textured plane: draw(g, w, h) paints it
function canvasPlane(w, h, px, draw) {
  const c = document.createElement('canvas');
  c.width = px;
  c.height = Math.round((px * h) / w);
  draw(c.getContext('2d'), c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
}

// The mezzanine's stairs and the landing at their top: their footprint { x0, x1, z0, z1 }, east of
// the deck, climbing south to the wall. top: where the steps end and the landing starts.
export function mezzanineStairs() {
  const m = LAYOUT.mezzanine;
  const z0 = m.z0 - STAIRS_START;
  return { x0: m.x1, x1: m.x1 + STAIRS_W, z0, z1: m.z1, top: z0 + (STEPS - 1) * TREAD };
}

export function buildMezzanine(game) {
  const m = LAYOUT.mezzanine;
  const { x0, x1, z0, z1, y, gate } = m;
  const [cx, cz, w, d] = [(x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0];
  // Deck: a steel plate on the columns, with yellow paint along its front edge
  solid(game, [w, DECK_T, d], [cx, y - DECK_T / 2, cz]);
  const deck = add(game, boxMesh(w, DECK_T, d, 0x7d838a), cx, y - DECK_T / 2, cz);
  deck.receiveShadow = true;
  const lip = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.12), new THREE.MeshBasicMaterial({ color: YELLOW }));
  lip.rotation.x = -Math.PI / 2;
  add(game, lip, cx, y + 0.004, z0 + 0.06);
  // Columns along the front, and a beam under the front edge
  for (const x of [x0 + 5, x0 + 10, x0 + 15, x1 - 0.15]) {
    solid(game, [0.2, y - DECK_T, 0.2], [x, (y - DECK_T) / 2, z0 + 0.15]);
    add(game, boxMesh(0.2, y - DECK_T, 0.2, STEEL), x, (y - DECK_T) / 2, z0 + 0.15);
  }
  add(game, boxMesh(w, 0.3, 0.15, STEEL), cx, y - DECK_T - 0.15, z0 + 0.08);
  // Railings: along the front with the pallet gate left open, and down the east edge as far as
  // the top of the stairs
  const e = 0.06;
  railing(game, x0, z0 + e, gate.from, z0 + e, y);
  railing(game, gate.to, z0 + e, x1, z0 + e, y);
  const st = mezzanineStairs();
  railing(game, x1 - e, z0, x1 - e, st.top, y); // the landing joins the deck past here
  // The pallet gate: hazard stripes on the deck edge and a sign hanging over it
  const stripes = new THREE.Mesh(new THREE.PlaneGeometry(gate.to - gate.from, 0.3), new THREE.MeshBasicMaterial({ color: 0x16171a }));
  stripes.rotation.x = -Math.PI / 2;
  add(game, stripes, (gate.from + gate.to) / 2, y + 0.005, z0 + 0.25);
  for (let x = gate.from + 0.2; x < gate.to - 0.1; x += 0.5) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.3), new THREE.MeshBasicMaterial({ color: YELLOW }));
    s.rotation.set(-Math.PI / 2, 0, 0.6);
    add(game, s, x, y + 0.006, z0 + 0.25);
  }
  add(game, labelPlane('PALLET DROP · MAX 500 KG', 2.6, 0.3, { bg: '#f5c518', fg: '#16171a' }), (gate.from + gate.to) / 2, y - DECK_T - 0.25, z0 - 0.02).rotation.y = Math.PI;
  // Signs on the front of the deck
  add(game, labelPlane('MEZZANINE · BACKSTOCK', 3.2, 0.3, { bg: '#1d3f80', fg: '#ffffff' }), x0 + 6, y - DECK_T - 0.15, z0 - 0.02).rotation.y = Math.PI;
  add(game, labelPlane('BREAK ROOM', 2.0, 0.3, { bg: '#1a7f37', fg: '#ffffff' }), x0 + 11, y - DECK_T - 0.15, z0 - 0.02).rotation.y = Math.PI;

  // Stairs up the east end: steps solid to the floor, yellow nosing, a handrail on the open side,
  // and a landing at deck height at the top that joins the deck
  const sx = (st.x0 + st.x1) / 2;
  for (let i = 1; i < STEPS; i++) {
    const top = (y * i) / STEPS;
    const zc = st.z0 + (i - 0.5) * TREAD;
    solid(game, [STAIRS_W, top, TREAD], [sx, top / 2, zc]);
    add(game, boxMesh(STAIRS_W, top, TREAD, 0x8a8f96), sx, top / 2, zc);
    const nose = new THREE.Mesh(new THREE.PlaneGeometry(STAIRS_W, 0.06), new THREE.MeshBasicMaterial({ color: YELLOW }));
    nose.rotation.x = -Math.PI / 2;
    add(game, nose, sx, top + 0.004, st.z0 + (i - 1) * TREAD + 0.03);
  }
  const landing = st.z1 - st.top;
  solid(game, [STAIRS_W, DECK_T, landing], [sx, y - DECK_T / 2, st.top + landing / 2]);
  add(game, boxMesh(STAIRS_W, DECK_T, landing, 0x7d838a), sx, y - DECK_T / 2, st.top + landing / 2);
  add(game, boxMesh(0.15, y - DECK_T, 0.15, STEEL), st.x1 - 0.1, (y - DECK_T) / 2, st.z1 - 0.1); // its post
  const nose = new THREE.Mesh(new THREE.PlaneGeometry(STAIRS_W, 0.08), new THREE.MeshBasicMaterial({ color: YELLOW }));
  nose.rotation.x = -Math.PI / 2;
  add(game, nose, sx, y + 0.004, st.top + 0.04);
  const run = st.top - st.z0;
  const rail = boxMesh(0.05, 0.05, Math.hypot(run, y), YELLOW, { edges: false });
  rail.rotation.x = -Math.atan2(y, run);
  add(game, rail, st.x1 - 0.05, y / 2 + 1.0, st.z0 + run / 2);
  for (const [z, h] of [[st.z0 + 0.1, 0], [st.top - 0.1, y]]) add(game, boxMesh(0.06, 1.0, 0.06, YELLOW, { edges: false }), st.x1 - 0.05, h + 0.5, z);
  solid(game, [0.1, y + 1.0, run], [st.x1 - 0.05, (y + 1.0) / 2, st.z0 + run / 2]); // the handrail side is closed off
  railing(game, st.x1 - e, st.top, st.x1 - e, st.z1, y); // and the landing's open side

  buildBreakRoom(game);
}

// ---------------------------------------------------------------- the break room

function buildBreakRoom(game) {
  const { x0, x1, z0, z1, y } = LAYOUT.mezzanine;
  const wallZ = z1; // south wall
  // A warmer floor tint under the deck
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), new THREE.MeshBasicMaterial({ color: 0xc9a46a, transparent: true, opacity: 0.18, depthWrite: false }));
  floor.rotation.x = -Math.PI / 2;
  add(game, floor, (x0 + x1) / 2, 0.004, (z0 + z1) / 2);
  // Toilet doors on the south wall
  for (const [x, label, color] of [[x0 + 2, 'MEN', '#1d3f80'], [x0 + 3.6, 'WOMEN', '#9c1c5a']]) {
    add(game, boxMesh(0.95, 2.1, 0.05, 0x8e949b), x, 1.05, wallZ - 0.03);
    add(game, labelPlane(label, 0.6, 0.22, { bg: color, fg: '#ffffff' }), x, 1.75, wallZ - 0.06).rotation.y = Math.PI;
  }
  add(game, labelPlane('EMPLOYEES MUST WASH HANDS', 1.4, 0.18, { bg: '#ffffff', fg: '#16171a' }), x0 + 2.8, 2.35, wallZ - 0.03).rotation.y = Math.PI;
  // Water fountain, wall-mounted
  const fx = x0 + 6;
  solid(game, [0.55, 0.35, 0.45], [fx, 0.85, wallZ - 0.25]);
  add(game, boxMesh(0.55, 0.35, 0.45, 0xc9ced6), fx, 0.85, wallZ - 0.25);
  add(game, new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 8), flatMat(0x8a9099)), fx, 1.08, wallZ - 0.3);
  add(game, labelPlane('OUT OF ORDER', 0.5, 0.12, { bg: '#fffbe6', fg: '#d0141b' }), fx, 1.3, wallZ - 0.03).rotation.y = Math.PI;
  // Vending machines: heavy, top-heavy physics props facing north
  vending(game, x0 + 8.1, wallZ - 0.45, 'SNACKS', ['#e8532b', '#f5c518', '#31a24c', '#2f5fb3', '#9a4dff']);
  vending(game, x0 + 9.3, wallZ - 0.45, 'DRINKS', ['#d0141b', '#3ae8ff', '#f4f4f4', '#31d07a', '#ff8c1a']);
  // Table and two chairs
  const table = new THREE.Group();
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.04, 20), flatMat(0xe8e2d4));
  top.position.y = 0.74;
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.72, 8), flatMat(0x2b2f35));
  leg.position.y = 0.36;
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 16), flatMat(0x2b2f35));
  foot.position.y = 0.015;
  table.add(top, leg, foot);
  const tx = x0 + 13;
  const tz = z0 + 2.3;
  prop(game, 'table', table, [tx, 0.005, tz], 0, [{ cyl: [0.37, 0.55], pos: [0, 0.37, 0] }], 15);
  for (const s of [-1, 1]) {
    const chair = new THREE.Group();
    const seat = boxMesh(0.42, 0.05, 0.42, 0xe8532b, { edges: false });
    seat.position.y = 0.45;
    const back = boxMesh(0.42, 0.45, 0.04, 0xe8532b, { edges: false });
    back.position.set(0, 0.7, -0.2);
    chair.add(seat, back);
    for (const lx of [-0.18, 0.18]) for (const lz of [-0.18, 0.18]) {
      const l = boxMesh(0.03, 0.45, 0.03, 0x2b2f35, { edges: false });
      l.position.set(lx, 0.225, lz);
      chair.add(l);
    }
    prop(game, 'chair', chair, [tx + s * 0.85, 0.005, tz], (s * Math.PI) / 2, [{ half: [0.21, 0.24, 0.21], pos: [0, 0.24, 0] }, { half: [0.21, 0.22, 0.02], pos: [0, 0.7, -0.2] }], 5);
  }
  // Counter with a microwave and a coffee maker
  const kx = x0 + 17;
  solid(game, [1.8, 0.9, 0.6], [kx, 0.45, wallZ - 0.3]);
  add(game, boxMesh(1.8, 0.9, 0.6, 0x9c7a55), kx, 0.45, wallZ - 0.3);
  add(game, boxMesh(0.5, 0.3, 0.38, 0xe6e6e6), kx - 0.4, 1.05, wallZ - 0.32);
  add(game, boxMesh(0.32, 0.22, 0.02, 0x16171a, { edges: false }), kx - 0.45, 1.05, wallZ - 0.52);
  add(game, boxMesh(0.25, 0.35, 0.25, 0x16171a), kx + 0.45, 1.08, wallZ - 0.3);
  add(game, labelPlane('CLEAN UP AFTER YOURSELF', 1.4, 0.18, { bg: '#fffbe6', fg: '#16171a' }), kx, 1.7, wallZ - 0.03).rotation.y = Math.PI;
  // A light under the deck, so the break room isn't a cave
  const lamp = new THREE.PointLight(0xfff1d6, 6, 12);
  lamp.position.set((x0 + x1) / 2, y - 0.5, (z0 + z1) / 2);
  game.scene.add(lamp);
}

// A vending machine with its back to the south wall: a lit window of coloured rows
function vending(game, x, z, title, colors) {
  const g = new THREE.Group();
  const body = boxMesh(1.0, 1.85, 0.8, 0x2b2f35);
  body.position.y = 0.925;
  g.add(body);
  const front = canvasPlane(0.62, 1.2, 128, (c, w, h) => {
    c.fillStyle = '#dfe9f2';
    c.fillRect(0, 0, w, h);
    const rows = 5;
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < 4; k++) {
        c.fillStyle = colors[(r + k) % colors.length];
        c.fillRect(8 + k * 29, 12 + r * (h / rows), 22, h / rows - 20);
      }
      c.fillStyle = '#8a9099';
      c.fillRect(4, (r + 1) * (h / rows) - 6, w - 8, 3);
    }
  });
  front.position.set(-0.12, 1.05, -0.401);
  front.rotation.y = Math.PI;
  g.add(front);
  const sign = labelPlane(title, 0.9, 0.22, { bg: '#d0141b', fg: '#ffffff' });
  sign.position.set(0, 1.72, -0.402);
  sign.rotation.y = Math.PI;
  g.add(sign);
  const slot = boxMesh(0.62, 0.15, 0.02, 0x111111, { edges: false });
  slot.position.set(-0.12, 0.3, -0.41);
  g.add(slot);
  prop(game, title === 'SNACKS' ? 'snack machine' : 'drinks machine', g, [x, 0.005, z], 0, [{ half: [0.5, 0.925, 0.4], pos: [0, 0.925, 0] }], 250, { grip: true, kickTop: 1.6 });
}
