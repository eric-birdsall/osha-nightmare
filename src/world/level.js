import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { COL } from '../physics.js';
import { CONFIG } from '../config.js';
import { boxMesh, flatMat, labelPlane } from '../util/meshes.js';
import { createBox } from '../entities/box.js';
import { createPallet } from '../entities/pallet.js';
import { createLadder } from '../entities/ladder.js';

export const ROOM = { halfX: 24, halfZ: 16, wallH: 6 };
export const SHELF_LEVELS = [1.5, 3.0, 4.5];
const BAY_W = 2.7;
const BAYS = 6;
const RACK_X0 = -20;
const UPRIGHT_H = 5.2;
const BEAM_H = 0.16; // shelf beam height (labels go on its face)
const BEAM_D = 0.06; // beam depth

// Five racks in the west half of the warehouse, laid out like a real one: Rack A against the
// north wall, B and C back to back, D and E back to back, with 4.4 m aisles between the pairs.
// Each rack is single-deep (1.2 m) and open on its aisle face. The aisles are narrower than the
// racks are tall, so a toppled rack falls onto its neighbour (dominoes).
export const RACKS = [
  { name: 'A', z0: -15.6, z1: -14.4, face: 'south' },
  { name: 'B', z0: -10.0, z1: -8.8, face: 'north' },
  { name: 'C', z0: -8.6, z1: -7.4, face: 'south' },
  { name: 'D', z0: -3.0, z1: -1.8, face: 'north' },
  { name: 'E', z0: -1.6, z1: -0.4, face: 'south' },
];

const bayX = (i) => RACK_X0 + (i + 0.5) * BAY_W;

// Locations read Rack-Bay-Shelf, e.g. "A-3-2". Bays count 1-6 from the west end;
// shelves count 1-3 upward (1.5 m, 3.0 m, 4.5 m). Indices here are 0-based.
export const locationCode = (rack, bay, shelf) => `${rack}-${bay + 1}-${shelf + 1}`;

// Small printed tag (canvas texture) used for rack location labels.
function tagPlane(text, w, h, { bg = '#ffffff', fg = '#111111', border = '#111111' } = {}) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = Math.round((256 * h) / w);
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = border;
  g.lineWidth = 8;
  g.strokeRect(4, 4, c.width - 8, c.height - 8);
  g.fillStyle = fg;
  g.font = `bold ${Math.floor(c.height * 0.62)}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, c.width / 2, c.height / 2 + c.height * 0.04);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
}

// Labels on the open (aisle) face of a rack, attached to the rack so they move with it: rack
// signs at both ends and a Rack-Bay-Shelf tag hanging under each shelf beam.
function labelRack(group, { name, z0, z1, face }, cx, cz) {
  const x0 = RACK_X0;
  const x1 = RACK_X0 + BAYS * BAY_W;
  // [face z, rotation so the label faces out of the rack]
  const faces = face === 'south' ? [[z1 + 0.012, 0]] : [[z0 - 0.012, Math.PI]];
  const add = (mesh, x, y, z, ry) => {
    mesh.position.set(x - cx, y, z - cz);
    mesh.rotation.y = ry;
    group.add(mesh);
  };
  for (const [z, ry] of faces) {
    for (const x of [x0 + 0.65, x1 - 0.65]) add(tagPlane(`RACK ${name}`, 1.2, 0.4, { bg: '#1d3f80', fg: '#fff', border: '#fff' }), x, 2.2, z, ry);
    for (let b = 0; b < BAYS; b++) {
      SHELF_LEVELS.forEach((y, sh) => {
        // Tag stuck on the beam face, a few mm proud of it
        add(tagPlane(locationCode(name, b, sh), 0.42, BEAM_H - 0.03), bayX(b), y - BEAM_H / 2, z + (ry ? 0.008 : -0.008), ry);
      });
    }
  }
}

function addStatic(game, half, pos, color, { mesh = true, edges = true } = {}) {
  game.world.createCollider(
    RAPIER.ColliderDesc.cuboid(...half).setTranslation(...pos).setFriction(0.8).setCollisionGroups(COL.static),
    game.staticBody,
  );
  if (mesh) {
    const m = boxMesh(half[0] * 2, half[1] * 2, half[2] * 2, color, { edges });
    m.position.set(...pos);
    game.scene.add(m);
    return m;
  }
  return null;
}

// One rack = one rigid body (uprights, decks, beams). It can be shoved, tipped
// over, and knocked into the next rack. Boxes on its shelves ride along.
function buildRack(game, rack) {
  const { name, z0, z1 } = rack;
  const x0 = RACK_X0;
  const x1 = RACK_X0 + BAYS * BAY_W;
  const len = x1 - x0;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const blue = 0x2f5fb3;
  const orange = 0xe86a1c;
  const deckGrey = 0x9aa1aa;
  const parts = []; // [half, local pos, color, edges]
  const uprightZs = [z0 + 0.05, z1 - 0.05];
  for (let i = 0; i <= BAYS; i++) {
    for (const z of uprightZs) parts.push([[0.045, UPRIGHT_H / 2, 0.045], [x0 + i * BAY_W - cx, UPRIGHT_H / 2, z - cz], blue, true]);
  }
  for (const y of SHELF_LEVELS) {
    // Deck fits between the beams (no coplanar faces with them, so no z-fighting flicker)
    const deckHalfZ = (z1 - z0) / 2 - BEAM_D;
    parts.push([[len / 2, 0.02, deckHalfZ], [0, y - 0.02, 0], deckGrey, false]); // deck (walkable)
    for (const z of [z0 + BEAM_D / 2, z1 - BEAM_D / 2]) {
      parts.push([[len / 2, BEAM_H / 2, BEAM_D / 2], [0, y - BEAM_H / 2, z - cz], orange, true]); // beams
    }
  }
  const cfg = CONFIG.racks;
  const totalMass = cfg.massPerBay * BAYS;
  const vol = parts.reduce((v, [h]) => v + h[0] * h[1] * h[2], 0);
  const body = game.world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(cx, 0, cz).setCanSleep(true).setAdditionalSolverIterations(4),
  );
  const group = new THREE.Group();
  for (const [half, pos, color, edges] of parts) {
    game.world.createCollider(
      RAPIER.ColliderDesc.cuboid(...half)
        .setTranslation(...pos)
        .setMass((totalMass * half[0] * half[1] * half[2]) / vol)
        .setFriction(cfg.friction)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max) // feet grip like they're bolted down
        .setCollisionGroups(COL.dyn),
      body,
    );
    const m = boxMesh(half[0] * 2, half[1] * 2, half[2] * 2, color, { edges });
    m.position.set(...pos);
    group.add(m);
  }
  labelRack(group, rack, cx, cz);
  game.scene.add(group);
  const ent = { kind: 'rack', name, body, mesh: group, mass: totalMass, z0, z1 };
  game.addEntity(ent);
  return ent;
}

function floorMarking(game, cx, cz, w, d, color, thickness = 0.12) {
  const mat = new THREE.MeshBasicMaterial({ color });
  const add = (x, z, sx, sz) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.006, z);
    game.scene.add(m);
  };
  add(cx, cz - d / 2, w, thickness);
  add(cx, cz + d / 2, w, thickness);
  add(cx - w / 2, cz, thickness, d);
  add(cx + w / 2, cz, thickness, d);
}

function floorText(game, text, x, z, w, h, rotY = 0, color = '#f5c518') {
  const p = labelPlane(text, w, h, { bg: 'rgba(0,0,0,0)', fg: color, transparent: true });
  p.rotation.set(-Math.PI / 2, 0, rotY);
  p.position.set(x, 0.008, z);
  game.scene.add(p);
}

function makeZone(game, name, cx, cz, w, d) {
  const body = game.staticBody;
  const collider = game.world.createCollider(
    RAPIER.ColliderDesc.cuboid(w / 2, 1.0, d / 2)
      .setTranslation(cx, 1.0, cz)
      .setSensor(true)
      .setCollisionGroups(COL.sensor),
    body,
  );
  return {
    name,
    center: new THREE.Vector3(cx, 0, cz),
    half: { x: w / 2, z: d / 2 },
    collider,
    contains(p) {
      return Math.abs(p.x - cx) <= w / 2 && Math.abs(p.z - cz) <= d / 2;
    },
  };
}

// Unique random 4-digit SKUs for every box in the warehouse.
class SkuPool {
  constructor() {
    this.used = new Set();
  }
  take(n) {
    if (n < 1000 || n > 9999 || this.used.has(n)) return null;
    this.used.add(n);
    return n;
  }
  next() {
    for (;;) {
      const n = this.take(1000 + Math.floor(Math.random() * 9000));
      if (n) return n;
    }
  }
  // A plausible misread of `sku`: two neighbouring digits swapped, or one digit off by one.
  nearMiss(sku) {
    const d = String(sku).split('');
    for (let tries = 0; tries < 20; tries++) {
      const t = [...d];
      const i = Math.floor(Math.random() * 3);
      if (Math.random() < 0.5 && t[i] !== t[i + 1]) [t[i], t[i + 1]] = [t[i + 1], t[i]];
      else {
        const j = Math.floor(Math.random() * 4);
        t[j] = String((Number(t[j]) + (Math.random() < 0.5 ? 1 : 9)) % 10);
      }
      const n = this.take(Number(t.join('')));
      if (n) return n;
    }
    return this.next();
  }
}

const pickOne = (list) => list[Math.floor(Math.random() * list.length)];

// Three boxes per shelf along the open face, in every bay of every rack. The two order lines:
//  A: shelf 2 of any rack (reachable from the forks or a rolling ladder)
//  B: shelf 3, the top, of a different rack (the forks at full height, or a ladder plus a stack)
// Each order slot also holds two other boxes; usually one is a near-miss SKU (a decoy).
function stockShelves(game) {
  const cfg = CONFIG.order;
  game.skus = new SkuPool();
  const names = RACKS.map((r) => r.name);
  const rackA = pickOne(names);
  const lines = {
    A: { row: rackA, bay: Math.floor(Math.random() * BAYS), shelf: 1 },
    B: { row: pickOne(names.filter((n) => n !== rackA)), bay: Math.floor(Math.random() * BAYS), shelf: 2 },
  };
  const order = [];
  const orderBoxes = {};
  for (const [line, slot] of Object.entries(lines)) {
    slot.sku = game.skus.next();
    order.push({ line, sku: slot.sku, location: locationCode(slot.row, slot.bay, slot.shelf) });
  }
  const types = ['small', 'medium', 'medium', 'large'];
  for (const rack of RACKS) {
    const { name, z0, z1, face: openFace } = rack;
    const facesFor = () => [openFace];
    for (let bay = 0; bay < BAYS; bay++) {
      for (let shelf = 0; shelf < SHELF_LEVELS.length; shelf++) {
        const target = Object.entries(lines).find(([, l]) => l.row === name && l.bay === bay && l.shelf === shelf);
        for (const face of facesFor(shelf)) {
          const decoySpot = target && Math.random() < cfg.decoyChance ? pickOne([0, 2]) : -1;
          [-0.85, 0, 0.85].forEach((dx, i) => {
            const isOrder = target && i === 1 && face === facesFor(shelf)[0];
            const type = isOrder ? 'medium' : pickOne(types);
            const half = CONFIG.objects[type].size[2] / 2;
            const z = typeof face === 'number' ? face : face === 'south' ? z1 - BEAM_D - 0.03 - half : z0 + BEAM_D + 0.03 + half;
            let sku;
            if (isOrder) sku = target[1].sku;
            else if (i === decoySpot) sku = game.skus.nearMiss(target[1].sku);
            else sku = game.skus.next();
            const box = createBox(game, {
              type,
              sku,
              item: isOrder ? target[0] : null,
              pos: [bayX(bay) + dx + (Math.random() - 0.5) * 0.12, SHELF_LEVELS[shelf] + 0.005, z],
            });
            if (isOrder) orderBoxes[target[0]] = box;
          });
        }
      }
    }
  }
  return { order, orderBoxes };
}

// Human-readable spot for incident reports: a rack, an aisle and bay, or a floor zone.
export function describeLocation(p) {
  const x1 = RACK_X0 + BAYS * BAY_W;
  if (Math.abs(p.x - 12) < 1.4 && Math.abs(p.z - 9) < 1.4) return 'The WRAP square';
  if (p.x > ROOM.halfX - 4 && Math.abs(p.z - 2) < 2.2) return 'Dock 1';
  if (p.x < RACK_X0 - 0.5) return 'West wall, behind the racking';
  const rows = [...RACKS].sort((a, b) => a.z0 - b.z0);
  if (p.x > x1 + 0.5) {
    // Just past the rack ends: name the aisle we're at the end of
    if (p.x < x1 + 4) {
      for (let i = 0; i < rows.length - 1; i++) {
        if (p.z > rows[i].z1 && p.z < rows[i + 1].z0) return `End of aisle ${rows[i].name}/${rows[i + 1].name}`;
      }
    }
    return 'Open floor, east side';
  }
  const bay = Math.min(BAYS, Math.max(1, Math.floor((p.x - RACK_X0) / BAY_W) + 1));
  const up = p.y > 0.5 ? `, ${p.y.toFixed(1)} m up` : '';
  for (const r of rows) if (p.z >= r.z0 - 0.2 && p.z <= r.z1 + 0.2) return `Rack ${r.name}, bay ${bay}${up}`;
  for (let i = 0; i < rows.length - 1; i++) {
    if (p.z > rows[i].z1 && p.z < rows[i + 1].z0) return `Aisle ${rows[i].name}/${rows[i + 1].name}, by bay ${bay}${up}`;
  }
  return p.z < rows[0].z0 ? 'Behind Rack A' : `South of Rack ${rows[rows.length - 1].name}`;
}

export function buildLevel(game) {
  const { scene } = game;
  const { halfX, halfZ, wallH } = ROOM;

  // Lighting
  scene.background = new THREE.Color(0x9fb3c8);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(8, 20, 6);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(3072, 3072);
  const sc = sun.shadow.camera;
  sc.left = -halfX - 4;
  sc.right = halfX + 4;
  sc.top = halfZ + 4;
  sc.bottom = -halfZ - 4;
  sc.near = 1;
  sc.far = 70;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  // Floor
  game.world.createCollider(
    RAPIER.ColliderDesc.cuboid(halfX, 0.5, halfZ).setTranslation(0, -0.5, 0).setFriction(0.8).setCollisionGroups(COL.static),
    game.staticBody,
  );
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(halfX * 2, halfZ * 2), flatMat(0x7d8187));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(40, 40, 0x5f636a, 0x6c7077);
  grid.position.y = 0.003;
  grid.scale.set((halfX * 2) / 40, 1, (halfZ * 2) / 40); // 1 m squares
  scene.add(grid);

  // Walls (inside faces at the room bounds)
  const wallC = 0xc9ced6;
  const t = 0.2;
  addStatic(game, [halfX + t * 2, wallH / 2, t], [0, wallH / 2, -halfZ - t], wallC, { edges: false });
  addStatic(game, [halfX + t * 2, wallH / 2, t], [0, wallH / 2, halfZ + t], wallC, { edges: false });
  addStatic(game, [t, wallH / 2, halfZ], [-halfX - t, wallH / 2, 0], wallC, { edges: false });
  addStatic(game, [t, wallH / 2, halfZ], [halfX + t, wallH / 2, 0], wallC, { edges: false });
  // Wainscot stripe for depth cues
  for (const [w, x, z, ry] of [
    [halfX * 2, 0, -halfZ + 0.01, 0],
    [halfX * 2, 0, halfZ - 0.01, Math.PI],
    [halfZ * 2, -halfX + 0.01, 0, Math.PI / 2],
    [halfZ * 2, halfX - 0.01, 0, -Math.PI / 2],
  ]) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.0), new THREE.MeshBasicMaterial({ color: 0xf5c518 }));
    s.position.set(x, 0.5, z);
    s.rotation.y = ry;
    scene.add(s);
  }

  // Racks
  const racks = RACKS.map((r) => buildRack(game, r));
  // Back-to-back pairs (B/C, D/E) share a 0.2 m flue
  for (const r of racks) r.partner = racks.find((o) => o !== r && (Math.abs(o.z0 - r.z1) < 0.5 || Math.abs(r.z0 - o.z1) < 0.5));
  // Aisle lines along every open rack face
  const yellow = 0xf5c518;
  const faceLines = RACKS.map((r) => (r.face === 'south' ? r.z1 + 0.2 : r.z0 - 0.2));
  for (const z of faceLines) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(BAYS * BAY_W, 0.1), new THREE.MeshBasicMaterial({ color: yellow }));
    line.rotation.x = -Math.PI / 2;
    line.position.set(RACK_X0 + (BAYS * BAY_W) / 2, 0.005, z);
    scene.add(line);
  }
  // Wrapper zone (open east half of the floor)
  const wrapZone = makeZone(game, 'wrap', 12, 9, 2.5, 2.5);
  floorMarking(game, 12, 9, 2.5, 2.5, 0xf5c518, 0.15);
  floorText(game, 'WRAP', 12, 10.65, 2.0, 0.6);
  // Wrapper mast (static pole just outside the corner)
  addStatic(game, [0.12, 1.4, 0.12], [13.55, 1.4, 7.45], 0x3a3f47);
  const arm = boxMesh(0.7, 0.15, 0.15, 0x3a3f47);
  arm.position.set(13.25, 2.7, 7.45);
  scene.add(arm);

  // Dock 1 on the east wall
  const dockZ = 2;
  const dockZone = makeZone(game, 'dock', halfX - 1.9, dockZ, 3.6, 4.0);
  floorMarking(game, halfX - 1.9, dockZ, 3.6, 4.0, 0x31d07a, 0.15);
  floorText(game, 'DOCK 1', halfX - 2.8, dockZ, 3.2, 0.9, Math.PI / 2, '#31d07a');
  const door = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.6), new THREE.MeshLambertMaterial({ color: 0x2b2f36 }));
  door.position.set(halfX - 0.02, 1.8, dockZ);
  door.rotation.y = -Math.PI / 2;
  scene.add(door);
  const sign = labelPlane('DOCK 1', 2.4, 0.8, { bg: '#31d07a', fg: '#0b1f12' });
  sign.position.set(halfX - 0.03, 4.3, dockZ);
  sign.rotation.y = -Math.PI / 2;
  scene.add(sign);
  // Dock bumpers
  for (const z of [dockZ - 1.9, dockZ + 1.9]) addStatic(game, [0.1, 0.25, 0.15], [halfX - 0.1, 0.4, z], 0x111111);

  // Wall-mounted incident sign (updated by the game)
  game.incidentSign = makeIncidentSign(scene);

  // Stock every shelf and pick this shift's order
  const { order, orderBoxes } = stockShelves(game);

  // Loose boxes on the open floor for stacking
  const loose = [
    ['medium', 1.0, 0, 2.2],
    ['small', 1.0, 0.6, 2.2],
    ['small', 2.0, 0, 2.6],
    ['large', 3.0, 0, -5.0],
    ['medium', 1.6, 0, -12.0],
    ['medium', 4.5, 0, 6.0],
    ['small', 5.2, 0, 6.4],
  ];
  for (const [type, x, y, z] of loose) createBox(game, { type, sku: game.skus.next(), pos: [x, y, z], yaw: (Math.random() - 0.5) * 0.3 });

  // Rolling ladders parked in the aisles, steps running along the aisle
  createLadder(game, { pos: [-8, 0, -12.2], yaw: Math.PI / 2 });
  createLadder(game, { pos: [-14, 0, -5.2], yaw: -Math.PI / 2 });

  // Empty pallets (fork pockets open toward ±local Z)
  createPallet(game, { pos: [2.6, 0, -12.2], yaw: Math.PI / 2 });
  createPallet(game, { pos: [2.6, 0, -4.8], yaw: Math.PI / 2 });
  createPallet(game, { pos: [1.5, 0, 9.5], yaw: 0 });
  createPallet(game, { pos: [3.3, 0, 9.5], yaw: 0 });

  return {
    wrapZone,
    dockZone,
    items: orderBoxes, // { A, B }: the box each order line wants (for debugging/tests)
    order, // [{ line, sku, location }]
    racks,
    climberSpawn: { pos: new THREE.Vector3(-2, 0, -5.2), yaw: Math.PI / 2 }, // aisle C/D, looking down it
    spawnPoints: [
      new THREE.Vector3(-2, 0, -5.2),
      new THREE.Vector3(-2, 0, -12.2),
      new THREE.Vector3(-2, 0, 1.5),
      new THREE.Vector3(-10, 0, 3),
      new THREE.Vector3(-10, 0, 10),
      new THREE.Vector3(-22, 0, -6),
      new THREE.Vector3(-22, 0, 5),
      new THREE.Vector3(6, 0, 0),
      new THREE.Vector3(10, 0, -10),
      new THREE.Vector3(16, 0, 13),
    ],
    forkliftSpawn: { pos: new THREE.Vector3(18, 0, 10), yaw: -Math.PI / 2 },
  };
}

function makeIncidentSign(scene) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshBasicMaterial({ map: tex }));
  mesh.position.set(4, 3.6, -ROOM.halfZ + 0.03);
  scene.add(mesh);
  let last = null;
  return {
    set(days) {
      if (days === last) return;
      last = days;
      const g = c.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, 512, 256);
      g.strokeStyle = '#1a7f37';
      g.lineWidth = 14;
      g.strokeRect(7, 7, 498, 242);
      g.fillStyle = '#1a7f37';
      g.font = 'bold 34px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText('DAYS SINCE LAST INCIDENT', 256, 62);
      g.fillStyle = days === 0 ? '#c62828' : '#111';
      g.font = 'bold 150px system-ui, sans-serif';
      g.fillText(String(days), 256, 210);
      tex.needsUpdate = true;
    },
  };
}
