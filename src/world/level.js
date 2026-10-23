import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { COL } from '../physics.js';
import { CONFIG } from '../config.js';
import { boxMesh, flatMat, labelPlane } from '../util/meshes.js';
import { createBox } from '../entities/box.js';
import { createPallet } from '../entities/pallet.js';
import { createLadderStand } from '../entities/ladder.js';
import { buildCorner } from './corner.js';

export const ROOM = { halfX: 24, halfZ: 16, wallH: 12 }; // wallH: up to the roof
// Lower level: the south-west of the floor sits 1 m down. Dave takes six steps down by the rack
// ends; the forklift has a fixed ramp along the south wall that runs down westward.
export const LOWER = { y: -1.0, x0: -ROOM.halfX, x1: 6, z0: 3.8, z1: ROOM.halfZ };
export const RAMP = { x0: 6, x1: 14, z0: 12, z1: ROOM.halfZ }; // top at x1, bottom at x0
export const STAIRS = { x0: -2.6, x1: -0.6, z0: LOWER.z0, steps: 6, tread: 0.3 };
const FLOOR_BOTTOM = -1.5; // floor slabs are solid down to here; their sides are the pit walls

export const inLowerLevel = (x, z) => x < LOWER.x1 && z > LOWER.z0;

// Height of the floor (not counting anything standing on it) at a spot.
export function floorHeightAt(x, z) {
  if (x >= RAMP.x0 && x <= RAMP.x1 && z >= RAMP.z0) return (LOWER.y * (RAMP.x1 - x)) / (RAMP.x1 - RAMP.x0);
  if (!inLowerLevel(x, z)) return 0;
  if (x >= STAIRS.x0 && x <= STAIRS.x1) {
    const step = Math.floor((z - STAIRS.z0) / STAIRS.tread) + 1; // step 1 is the first one down
    if (step < STAIRS.steps) return (LOWER.y * step) / STAIRS.steps;
  }
  return LOWER.y;
}
export const SHELF_LEVELS = [1.5, 3.0, 4.5];
const BAY_W = 2.7;
const BAYS = 6;
const RACK_X0 = -20;
const UPRIGHT_H = 5.2;
const BEAM_H = 0.16; // shelf beam height (labels go on its face)
const BEAM_D = 0.06; // beam depth

// Racks in the west half of the warehouse, laid out like a real one. Upstairs: Rack A against
// the north wall, B and C back to back, D and E back to back, with 4.4 m aisles between the
// pairs. Downstairs (base 1 m lower): F and G back to back, H against the south wall, with
// 4.2 m aisles. Each rack is single-deep (1.2 m) and open on its aisle face. The aisles are
// narrower than the racks are tall, so a toppled rack falls onto its neighbour (dominoes).
export const RACKS = [
  { name: 'A', z0: -15.6, z1: -14.4, face: 'south' },
  { name: 'B', z0: -10.0, z1: -8.8, face: 'north' },
  { name: 'C', z0: -8.6, z1: -7.4, face: 'south' },
  { name: 'D', z0: -3.0, z1: -1.8, face: 'north' },
  { name: 'E', z0: -1.6, z1: -0.4, face: 'south' },
  { name: 'F', z0: 8.0, z1: 9.2, face: 'north', base: LOWER.y },
  { name: 'G', z0: 9.4, z1: 10.6, face: 'south', base: LOWER.y },
  { name: 'H', z0: 14.75, z1: 15.95, face: 'north', base: LOWER.y },
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

// End-cap sign: "RACK" over a big letter, sized to span the rack's depth between the end uprights.
function endCapSign(name, w, h) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = Math.round((256 * h) / w);
  const g = c.getContext('2d');
  g.fillStyle = '#1d3f80';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#fff';
  g.lineWidth = 10;
  g.strokeRect(5, 5, c.width - 10, c.height - 10);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold ${Math.floor(c.height * 0.16)}px system-ui, sans-serif`;
  g.fillText('RACK', c.width / 2, c.height * 0.18);
  g.font = `bold ${Math.floor(c.height * 0.66)}px system-ui, sans-serif`;
  g.fillText(name, c.width / 2, c.height * 0.62);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
}

// Labels attached to the rack so they move with it: a rack sign on each end cap, and a
// Rack-Bay-Shelf tag on each shelf beam of the open (aisle) face.
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
  // End caps face west and east, mounted on the outside of the end uprights
  add(endCapSign(name, 1.0, 1.1), x0 - 0.05, 2.3, cz, -Math.PI / 2);
  add(endCapSign(name, 1.0, 1.1), x1 + 0.05, 2.3, cz, Math.PI / 2);
  for (const [z, ry] of faces) {
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
  const { name, z0, z1, base = 0 } = rack;
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
    RAPIER.RigidBodyDesc.dynamic().setTranslation(cx, base, cz).setCanSleep(true).setAdditionalSolverIterations(4),
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
  // home: where it stands (for resetting the racking); x0/x1: its ends; face: its open side
  const ent = { kind: 'rack', name, body, mesh: group, mass: totalMass, z0, z1, base, x0, x1, face: rack.face, home: { x: cx, y: base, z: cz }, stock: [] };
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

function floorText(game, text, x, z, w, h, rotY = 0, color = '#f5c518', y = 0) {
  const p = labelPlane(text, w, h, { bg: 'rgba(0,0,0,0)', fg: color, transparent: true });
  p.rotation.set(-Math.PI / 2, 0, rotY);
  p.position.set(x, y + 0.008, z);
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

// Unique random 3-digit SKUs for every box in the warehouse. Each SKU also has a "look" (box
// colour, brand logo, FRAGILE or not): its own, except a near-miss decoy copies the look of the
// SKU it imitates, so only the number tells them apart.
class SkuPool {
  constructor() {
    this.used = new Set();
    this.looks = new Map();
  }
  take(n, look = n) {
    if (n < 100 || n > 999 || this.used.has(n)) return null;
    this.used.add(n);
    this.looks.set(n, look);
    return n;
  }
  look(sku) {
    return this.looks.get(sku) ?? sku;
  }
  next() {
    for (;;) {
      const n = this.take(100 + Math.floor(Math.random() * 900));
      if (n) return n;
    }
  }
  // A plausible misread of `sku`: two neighbouring digits swapped, or one digit off by one.
  nearMiss(sku) {
    const d = String(sku).split('');
    for (let tries = 0; tries < 30; tries++) {
      const t = [...d];
      const i = Math.floor(Math.random() * 2);
      if (Math.random() < 0.5 && t[i] !== t[i + 1]) [t[i], t[i + 1]] = [t[i + 1], t[i]];
      else {
        const j = Math.floor(Math.random() * 3);
        t[j] = String((Number(t[j]) + (Math.random() < 0.5 ? 1 : 9)) % 10);
      }
      const n = this.take(Number(t.join('')), this.look(sku));
      if (n) return n;
    }
    return this.next();
  }
}

const pickOne = (list) => list[Math.floor(Math.random() * list.length)];

// Backstock placard hung under a short pick face's beam: where the rest of that SKU is kept.
function backstockSign(location) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#ff8a1f';
  g.fillRect(0, 0, 256, 96);
  g.strokeStyle = '#111';
  g.lineWidth = 6;
  g.strokeRect(3, 3, 250, 90);
  g.fillStyle = '#111';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 26px system-ui, sans-serif';
  g.fillText('BACKSTOCK', 128, 26);
  g.font = 'bold 44px system-ui, sans-serif';
  g.fillText(`→ ${location}`, 128, 66);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.23), new THREE.MeshBasicMaterial({ map: tex }));
}

// Three boxes per shelf along the open face, in every bay of every rack. The order has two
// lines, each a quantity of one SKU, picked from the upstairs racks:
//  A: 3 boxes from shelf 2 of any rack (reachable from the forks or an A-frame ladder). The pick
//     face is always one short: a BACKSTOCK sign on its beam says which lower-level slot holds the rest.
//  B: 1 or 2 boxes from shelf 3, the top, of a different rack; sometimes short as well.
// Backstock slots are on the bottom shelf of the lower-level racks, in reach from the floor, and
// hold a full row of the SKU. A short pick face has a gap where the missing box would be; other
// spare spots in an order slot usually hold a near-miss SKU (a decoy).
function stockShelves(game, racks) {
  const cfg = CONFIG.order;
  game.skus = new SkuPool();
  const upstairs = RACKS.filter((r) => !r.base).map((r) => r.name);
  const downstairs = RACKS.filter((r) => r.base).map((r) => r.name);
  const bay = () => Math.floor(Math.random() * BAYS);
  const rackA = pickOne(upstairs);
  const qtyB = Math.random() < 0.5 ? 1 : 2;
  const lines = {
    A: { rack: rackA, bay: bay(), shelf: 1, qty: 3, short: 1 },
    B: { rack: pickOne(upstairs.filter((n) => n !== rackA)), bay: bay(), shelf: 2, qty: qtyB, short: qtyB > 1 && Math.random() < cfg.backstockChance ? 1 : 0 },
  };
  const order = [];
  const slots = []; // [{ rack, bay, shelf, line, sku, count, gap, backstock }]
  for (const [line, l] of Object.entries(lines)) {
    l.sku = game.skus.next();
    slots.push({ rack: l.rack, bay: l.bay, shelf: l.shelf, line, sku: l.sku, count: l.qty - l.short, gap: l.short > 0, decoys: true });
    let backstock = null;
    if (l.short) {
      // A free bottom-shelf slot downstairs
      let b;
      do b = { rack: pickOne(downstairs), bay: bay(), shelf: 0 };
      while (slots.some((o) => o.rack === b.rack && o.bay === b.bay && o.shelf === b.shelf));
      backstock = locationCode(b.rack, b.bay, b.shelf);
      slots.push({ ...b, line, sku: l.sku, count: 3 });
      slots[slots.length - 2].backstock = backstock;
    }
    order.push({ line, sku: l.sku, qty: l.qty, location: locationCode(l.rack, l.bay, l.shelf), backstock });
  }
  // Other stock has backstock too: BACKSTOCK signs on more pick faces upstairs, each pointing to
  // a full row of that face's SKU on a lower-level bottom shelf (so a sign alone proves nothing)
  const taken = (r, b, s) => slots.some((o) => o.rack === r && o.bay === b && o.shelf === s);
  for (let n = 0; n < cfg.extraBackstock; n++) {
    let face;
    let store;
    let tries = 0;
    do face = { rack: pickOne(upstairs), bay: bay(), shelf: Math.floor(Math.random() * SHELF_LEVELS.length) };
    while (taken(face.rack, face.bay, face.shelf) && ++tries < 50);
    do store = { rack: pickOne(downstairs), bay: bay(), shelf: 0 };
    while (taken(store.rack, store.bay, store.shelf) && ++tries < 100);
    if (tries >= 100) break;
    const sku = game.skus.next();
    const short = Math.random() < 0.5;
    slots.push({ ...face, line: null, sku, count: short ? 1 : 2, gap: short, backstock: locationCode(store.rack, store.bay, store.shelf) });
    slots.push({ ...store, line: null, sku, count: 3 });
  }

  const orderBoxes = { A: [], B: [] };
  const types = ['small', 'medium', 'medium', 'large'];
  for (const rack of RACKS) {
    const { name, z0, z1, face, base = 0 } = rack;
    const ent = racks.find((r) => r.name === name);
    for (let b = 0; b < BAYS; b++) {
      for (let shelf = 0; shelf < SHELF_LEVELS.length; shelf++) {
        const slot = slots.find((o) => o.rack === name && o.bay === b && o.shelf === shelf);
        // What goes in each of the three spots: 'sku' (an order box), 'decoy', 'gap' or a random box
        const spots = [null, null, null];
        if (slot) {
          const fill = [1, 0, 2].slice(0, slot.count); // middle first, so a short face shows a gap at the end
          for (const i of fill) spots[i] = 'sku';
          const free = [0, 1, 2].filter((i) => !spots[i]);
          if (slot.gap && free.length) spots[free.shift()] = 'gap';
          if (slot.decoys && free.length && Math.random() < cfg.decoyChance) spots[pickOne(free)] = 'decoy';
        }
        [-0.85, 0, 0.85].forEach((dx, i) => {
          if (spots[i] === 'gap') return;
          const isOrder = spots[i] === 'sku';
          const type = isOrder ? 'medium' : pickOne(types);
          const half = CONFIG.objects[type].size[2] / 2;
          const z = face === 'south' ? z1 - BEAM_D - 0.03 - half : z0 + BEAM_D + 0.03 + half;
          let sku;
          if (isOrder) sku = slot.sku;
          else if (spots[i] === 'decoy') sku = game.skus.nearMiss(slot.sku);
          else sku = game.skus.next();
          const box = createBox(game, {
            type,
            sku,
            item: isOrder ? slot.line : null, // null for other stock's backstock rows
            pos: [bayX(b) + dx + (Math.random() - 0.5) * 0.12, base + SHELF_LEVELS[shelf] + 0.005, z],
          });
          if (isOrder && slot.line) orderBoxes[slot.line].push(box);
          // Where it was stocked, so resetting the racking can put it back
          const t = box.body.translation();
          const r = box.body.rotation();
          box.home = { rack: name, pos: { x: t.x, y: t.y, z: t.z }, rot: { x: r.x, y: r.y, z: r.z, w: r.w } };
          ent.stock.push(box);
        });
        if (slot?.backstock) {
          // Hung under this shelf's beam, beside the location tag, so it moves with the rack
          const sign = backstockSign(slot.backstock);
          const fz = face === 'south' ? z1 + 0.016 : z0 - 0.016;
          sign.position.set(bayX(b) + 0.62 - (RACK_X0 + (BAYS * BAY_W) / 2), SHELF_LEVELS[shelf] - BEAM_H - 0.13, fz - (z0 + z1) / 2);
          sign.rotation.y = face === 'south' ? 0 : Math.PI;
          ent.mesh.add(sign);
        }
      }
    }
  }
  return { order, orderBoxes };
}

// ---------------------------------------------------------------- ceiling

// Corrugated steel for the roof deck, repeated across it.
function roofMaterial(w, d) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 16;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 64, 0);
  grad.addColorStop(0, '#4a5058');
  grad.addColorStop(0.5, '#6b727b');
  grad.addColorStop(1, '#4a5058');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 16);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(w / 0.6, d / 4);
  // Faint glow: the scene's light comes from above, which would leave the underside black
  return new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide, emissive: 0x2c3138 });
}

// Many copies of one box shape in a single draw call. items: [[x, y, z, rotY?]]
function instancedBoxes(game, size, material, items) {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(...size), material, items.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  items.forEach(([x, y, z, ry = 0], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
    mesh.setMatrixAt(i, m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1)));
  });
  game.scene.add(mesh);
  return mesh;
}

// The underside of the building: corrugated roof deck on steel joists, rows of fluorescent
// fixtures hanging on chains, exposed ductwork, and giant slow ceiling fans. Nothing up here
// casts shadows (the sun is fake anyway). Returns the fan rotors.
function buildCeiling(game) {
  const { halfX, halfZ, wallH: H } = ROOM;
  const scene = game.scene;
  // Roof deck, seen from below
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(halfX * 2, halfZ * 2), roofMaterial(halfX * 2, halfZ * 2));
  roof.rotation.x = Math.PI / 2;
  roof.position.y = H - 0.01;
  scene.add(roof);
  // Steel joists across the width every 4 m, and a girder down the middle the long way
  const steel = new THREE.MeshLambertMaterial({ color: 0x3c4249, emissive: 0x23272c });
  const joists = [];
  for (let z = -halfZ + 2; z <= halfZ - 2; z += 4) joists.push([0, H - 0.35, z]);
  instancedBoxes(game, [halfX * 2, 0.5, 0.18], steel, joists);
  const girders = [];
  for (const z of [-6, 6]) girders.push([0, H - 0.75, z]);
  instancedBoxes(game, [halfX * 2, 0.3, 0.25], steel, girders);
  // Diagonal web bracing under the joists (simple Xs between joists, along the middle)
  const web = [];
  for (let z = -halfZ + 2; z < halfZ - 2; z += 4) {
    for (let x = -halfX + 3; x < halfX - 2; x += 6) web.push([x, H - 0.55, z + 2, Math.PI / 4], [x, H - 0.55, z + 2, -Math.PI / 4]);
  }
  instancedBoxes(game, [0.06, 0.06, 2.8], steel, web);

  // Giant fans' spots: lights and duct drops stay out of the blades' sweep
  const FANS = [[-12, -5], [10, -6], [10, 8]];
  const clearOfFans = (x, z) => FANS.every(([fx, fz]) => Math.hypot(x - fx, z - fz) > 4.3);

  // Fluorescent fixtures: two-tube strips hanging 3.5 m below the roof, in rows along the aisles
  const lightY = H - 3.5;
  const fixtures = [];
  for (let x = -21; x <= 21; x += 3.5) {
    for (let z = -14; z <= 14; z += 4) if (clearOfFans(x, z)) fixtures.push([x, lightY, z]);
  }
  instancedBoxes(game, [1.25, 0.08, 0.32], flatMat(0xdfe3e8), fixtures);
  const tubes = fixtures.map(([x, y, z]) => [x, y - 0.045, z]);
  instancedBoxes(game, [1.18, 0.02, 0.22], new THREE.MeshBasicMaterial({ color: 0xf2f8ff }), tubes);
  const chains = [];
  for (const [x, , z] of fixtures) chains.push([x - 0.5, (lightY + H) / 2, z], [x + 0.5, (lightY + H) / 2, z]);
  instancedBoxes(game, [0.015, H - lightY, 0.015], flatMat(0x8a9099), chains);

  // Exposed round ducts the long way, hung under the joists, with drops down to diffusers
  const ductMat = new THREE.MeshLambertMaterial({ color: 0xb4bcc6 });
  const duct = (x0, x1, y, z, r) => {
    const len = x1 - x0;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 20, 1, true), ductMat);
    m.rotation.z = Math.PI / 2;
    m.position.set((x0 + x1) / 2, y, z);
    scene.add(m);
    // Seams every 1.5 m
    const seams = [];
    for (let x = x0 + 0.75; x < x1; x += 1.5) seams.push([x, y, z]);
    const seam = new THREE.InstancedMesh(new THREE.CylinderGeometry(r + 0.02, r + 0.02, 0.05, 20), flatMat(0x8f97a1), seams.length);
    const mm = new THREE.Matrix4();
    const qq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    seams.forEach(([sx, sy, sz], i) => seam.setMatrixAt(i, mm.compose(new THREE.Vector3(sx, sy, sz), qq, new THREE.Vector3(1, 1, 1))));
    scene.add(seam);
    // Drops to square diffusers
    for (let x = x0 + 3; x < x1 - 1; x += 7) {
      if (!clearOfFans(x, z)) continue;
      const drop = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, 1.2, 14), ductMat);
      drop.position.set(x, y - r - 0.5, z);
      const diff = boxMesh(0.8, 0.15, 0.8, 0xc9d0d8, { edges: true, shadows: false });
      diff.position.set(x, y - r - 1.15, z);
      scene.add(drop, diff);
    }
  };
  duct(-halfX, halfX, H - 1.6, -10.5, 0.55);
  duct(-halfX, halfX, H - 1.6, 9.5, 0.55);
  duct(-halfX, 4, H - 1.3, 0.5, 0.35);

  // Giant HVLS fans: a motor hanging on a drop rod and eight long, slow blades
  const fans = [];
  for (const [x, z] of FANS) {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.8, 8), flatMat(0x1d1f23));
    rod.position.set(x, H - 0.9, z);
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.35, 0.5, 16), flatMat(0xf5c518));
    motor.position.set(x, H - 2.0, z);
    scene.add(rod, motor);
    const rotor = new THREE.Group();
    rotor.position.set(x, H - 2.3, z);
    for (let i = 0; i < 8; i++) {
      const blade = boxMesh(3.6, 0.04, 0.32, 0x2a2e33, { edges: false, shadows: false });
      blade.position.x = 2.0;
      blade.rotation.x = 0.12; // pitched
      const arm = new THREE.Group();
      arm.rotation.y = (i / 8) * Math.PI * 2;
      arm.add(blade);
      rotor.add(arm);
    }
    rotor.userData.speed = 1.2; // rad/s
    scene.add(rotor);
    fans.push(rotor);
  }
  // Nothing in the roof space casts or catches shadows
  return fans;
}

// ---------------------------------------------------------------- floors

// Ribbed metal wall panels: warm off-white with a seam every 1 m and lighter ribs between.
let wallCanvas = null;
function wallMaterial(w, h) {
  if (!wallCanvas) {
    wallCanvas = document.createElement('canvas');
    wallCanvas.width = 128;
    wallCanvas.height = 16;
    const g = wallCanvas.getContext('2d');
    g.fillStyle = '#e6dfcf';
    g.fillRect(0, 0, 128, 16);
    g.fillStyle = '#f4efe3';
    for (const x of [24, 56, 88]) g.fillRect(x, 0, 12, 16);
    g.fillStyle = '#b9b09c';
    g.fillRect(0, 0, 4, 16);
  }
  const tex = new THREE.CanvasTexture(wallCanvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(w, 1);
  tex.anisotropy = 8;
  return new THREE.MeshLambertMaterial({ map: tex });
}

// Concrete with a 1 m grid scored into it, repeated across each slab.
let floorCanvas = null;
function floorMaterial(w, d) {
  if (!floorCanvas) {
    floorCanvas = document.createElement('canvas');
    floorCanvas.width = floorCanvas.height = 128;
    const g = floorCanvas.getContext('2d');
    g.fillStyle = '#7d8187';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#6c7077';
    g.fillRect(0, 0, 128, 3);
    g.fillRect(0, 0, 3, 128);
  }
  const tex = new THREE.CanvasTexture(floorCanvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(w, d);
  tex.anisotropy = 8;
  return new THREE.MeshLambertMaterial({ map: tex });
}

// Diagonal black and yellow hazard stripes, about `pitch` metres per stripe pair.
let hazardCanvas = null;
function hazardMaterial(length, pitch = 0.5) {
  if (!hazardCanvas) {
    hazardCanvas = document.createElement('canvas');
    hazardCanvas.width = 64;
    hazardCanvas.height = 32;
    const g = hazardCanvas.getContext('2d');
    g.fillStyle = '#f5c518';
    g.fillRect(0, 0, 64, 32);
    g.fillStyle = '#16171a';
    for (const x0 of [-64, 0, 64]) {
      g.beginPath();
      g.moveTo(x0, 32);
      g.lineTo(x0 + 32, 0);
      g.lineTo(x0 + 64, 0);
      g.lineTo(x0 + 32, 32);
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(hazardCanvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(length / pitch, 1);
  return new THREE.MeshBasicMaterial({ map: tex });
}

// A solid floor slab from FLOOR_BOTTOM up to `top`, with a concrete top surface.
function floorSlab(game, x0, x1, z0, z1, top, { mesh = true } = {}) {
  const w = x1 - x0;
  const d = z1 - z0;
  addStatic(game, [w / 2, (top - FLOOR_BOTTOM) / 2, d / 2], [(x0 + x1) / 2, (top + FLOOR_BOTTOM) / 2, (z0 + z1) / 2], 0, { mesh: false });
  if (!mesh) return;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), floorMaterial(w, d));
  m.rotation.x = -Math.PI / 2;
  m.position.set((x0 + x1) / 2, top, (z0 + z1) / 2);
  m.receiveShadow = true;
  game.scene.add(m);
}

// The 1 m drop at the edge of the upper level: a concrete face with hazard paint along its lip.
// (x, z) is the middle of the edge; ry turns the face toward the lower side.
function pitWall(game, x, z, length, ry) {
  const face = new THREE.Mesh(new THREE.PlaneGeometry(length, -LOWER.y), flatMat(0x9a9fa6));
  face.position.set(x, LOWER.y / 2, z);
  face.rotation.y = ry;
  face.receiveShadow = true;
  const lip = new THREE.Mesh(new THREE.PlaneGeometry(length, 0.18), hazardMaterial(length));
  lip.position.set(x, -0.09, z);
  lip.rotation.y = ry;
  lip.translateZ(0.004);
  game.scene.add(face, lip);
}

// Safety railing: yellow posts and two rails from (x0, z0) to (x1, z1). Its collider is taller
// than the rails, so Dave can't jump and climb over it (the forks can still lift him past it).
function guardrail(game, x0, z0, x1, z1, y = 0) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const ry = Math.atan2(-(z1 - z0), x1 - x0);
  const mx = (x0 + x1) / 2;
  const mz = (z0 + z1) / 2;
  game.world.createCollider(
    RAPIER.ColliderDesc.cuboid(len / 2, 0.75, 0.05)
      .setTranslation(mx, y + 0.75, mz)
      .setRotation({ x: 0, y: Math.sin(ry / 2), z: 0, w: Math.cos(ry / 2) })
      .setCollisionGroups(COL.static),
    game.staticBody,
  );
  const yellow = 0xf5c518;
  const group = new THREE.Group();
  group.position.set(mx, y, mz);
  group.rotation.y = ry;
  const posts = Math.max(1, Math.ceil(len / 2));
  for (let i = 0; i <= posts; i++) {
    const post = boxMesh(0.07, 1.1, 0.07, yellow, { edges: false });
    post.position.set(-len / 2 + (i * len) / posts, 0.55, 0);
    group.add(post);
  }
  for (const h of [0.55, 1.08]) {
    const rail = boxMesh(len, 0.05, 0.05, yellow, { edges: false });
    rail.position.y = h;
    group.add(rail);
  }
  const toe = boxMesh(len, 0.12, 0.02, 0x16171a, { edges: false }); // toe board
  toe.position.y = 0.06;
  group.add(toe);
  game.scene.add(group);
}

function buildFloors(game) {
  const { halfX, halfZ } = ROOM;
  // Upper level: everything north of the pit, and east of it (the ramp is cut out of the latter)
  floorSlab(game, -halfX, halfX, -halfZ, LOWER.z0, 0);
  floorSlab(game, LOWER.x1, halfX, LOWER.z0, RAMP.z0, 0);
  floorSlab(game, RAMP.x1, halfX, RAMP.z0, halfZ, 0);
  // Lower level, and solid fill under the ramp
  floorSlab(game, LOWER.x0, LOWER.x1, LOWER.z0, LOWER.z1, LOWER.y);
  floorSlab(game, RAMP.x0, RAMP.x1, RAMP.z0, RAMP.z1, LOWER.y, { mesh: false });

  // Pit walls: the north and east edges of the lower level, and the side of the ramp cutting
  pitWall(game, (LOWER.x0 + LOWER.x1) / 2, LOWER.z0, LOWER.x1 - LOWER.x0, 0);
  pitWall(game, LOWER.x1, (LOWER.z0 + RAMP.z0) / 2, RAMP.z0 - LOWER.z0, -Math.PI / 2);
  pitWall(game, (RAMP.x0 + RAMP.x1) / 2, RAMP.z0, RAMP.x1 - RAMP.x0, 0);

  // Stairs: six risers down from the upper level, yellow nosing on every step
  const { x0: sx0, x1: sx1, steps, tread } = STAIRS;
  const sw = sx1 - sx0;
  for (let i = 1; i < steps; i++) {
    const top = (LOWER.y * i) / steps;
    const z0 = STAIRS.z0 + (i - 1) * tread;
    addStatic(game, [sw / 2, (top - FLOOR_BOTTOM) / 2, tread / 2], [(sx0 + sx1) / 2, (top + FLOOR_BOTTOM) / 2, z0 + tread / 2], 0, { mesh: false });
    const step = boxMesh(sw, top - LOWER.y, tread, 0x8a8f96);
    step.position.set((sx0 + sx1) / 2, (top + LOWER.y) / 2, z0 + tread / 2);
    game.scene.add(step);
    const nose = new THREE.Mesh(new THREE.PlaneGeometry(sw, 0.06), new THREE.MeshBasicMaterial({ color: 0xf5c518 }));
    nose.rotation.x = -Math.PI / 2;
    nose.position.set((sx0 + sx1) / 2, top + 0.004, z0 + 0.03);
    game.scene.add(nose);
  }
  // Handrails down both sides of the stairs (sloped rail on posts)
  const run = (steps - 1) * tread;
  for (const x of [sx0 + 0.04, sx1 - 0.04]) {
    for (const [z, y] of [[STAIRS.z0 + 0.05, 0], [STAIRS.z0 + run + 0.25, LOWER.y]]) {
      const post = boxMesh(0.06, 1.0, 0.06, 0xf5c518, { edges: false });
      post.position.set(x, y + 0.5, z);
      game.scene.add(post);
    }
    const slope = Math.hypot(run + 0.2, -LOWER.y);
    const rail = boxMesh(0.05, 0.05, slope, 0xf5c518, { edges: false });
    rail.position.set(x, 1.0 + LOWER.y / 2, STAIRS.z0 + 0.05 + (run + 0.2) / 2);
    rail.rotation.x = Math.atan2(-LOWER.y, run + 0.2);
    game.scene.add(rail);
  }

  // Forklift ramp: a sloped slab from the upper floor (east) down to the lower level (west)
  const rl = RAMP.x1 - RAMP.x0;
  const rw = RAMP.z1 - RAMP.z0;
  const angle = Math.atan2(-LOWER.y, rl);
  const thick = 0.3;
  const len = Math.hypot(rl, LOWER.y);
  const cx = (RAMP.x0 + RAMP.x1) / 2 + (Math.sin(angle) * thick) / 2;
  const cy = LOWER.y / 2 - (Math.cos(angle) * thick) / 2;
  const cz = (RAMP.z0 + RAMP.z1) / 2;
  game.world.createCollider(
    RAPIER.ColliderDesc.cuboid(len / 2, thick / 2, rw / 2)
      .setTranslation(cx, cy, cz)
      .setRotation({ x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) })
      .setFriction(0.8)
      .setCollisionGroups(COL.static),
    game.staticBody,
  );
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(len, thick, rw), [
    flatMat(0x8a8f96),
    flatMat(0x8a8f96),
    floorMaterial(len, rw),
    flatMat(0x8a8f96),
    flatMat(0x8a8f96),
    flatMat(0x8a8f96),
  ]);
  ramp.position.set(cx, cy, cz);
  ramp.rotation.z = angle;
  ramp.receiveShadow = true;
  game.scene.add(ramp);
  // Hazard edging down both sides of the ramp, and arrows pointing down it
  for (const z of [RAMP.z0 + 0.12, RAMP.z1 - 0.12]) {
    const edge = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.2), hazardMaterial(len, 0.6));
    edge.rotation.set(-Math.PI / 2, 0, angle, 'ZXY'); // lie flat, then tilt with the ramp
    edge.position.set((RAMP.x0 + RAMP.x1) / 2, LOWER.y / 2 + 0.006, z);
    game.scene.add(edge);
  }
  floorText(game, 'RAMP', RAMP.x1 + 1.2, cz, 2.4, 0.8, Math.PI / 2);
  floorText(game, 'LOWER LEVEL', 2.2, LOWER.z0 + 1.6, 3.6, 0.6, Math.PI, '#f5c518', LOWER.y); // reads coming down the stairs

  // Railings round the pit edges (gap at the top of the stairs) and along the ramp cutting
  const e = 0.06; // just on the upper side of each edge
  guardrail(game, LOWER.x0, LOWER.z0 - e, sx0, LOWER.z0 - e);
  guardrail(game, sx1, LOWER.z0 - e, LOWER.x1 + e, LOWER.z0 - e);
  guardrail(game, LOWER.x1 + e, LOWER.z0 - e, LOWER.x1 + e, RAMP.z0 - e);
  guardrail(game, LOWER.x1 + e, RAMP.z0 - e, RAMP.x1, RAMP.z0 - e);
}

// Human-readable spot for incident reports: a rack, an aisle and bay, or a floor zone.
export function describeLocation(p) {
  const x1 = RACK_X0 + BAYS * BAY_W;
  if (p.z < -12.3 && p.x > 6 && p.x < 11) return "The supervisor's office";
  if (p.z < -14.2 && p.x >= 11 && p.x < 17.1) return 'The safety station';
  if (p.z < -13.8 && p.x >= 17.1 && p.x < 19) return 'The propane cage';
  if (p.z < -10.2 && p.x > 19.4) return 'Forklift parking';
  if (Math.abs(p.x - 12) < 1.4 && Math.abs(p.z - 9) < 1.4) return 'The WRAP square';
  if (p.x > ROOM.halfX - 4 && Math.abs(p.z - 2) < 2.2) return 'Dock 1';
  if (p.x >= RAMP.x0 && p.x <= RAMP.x1 && p.z >= RAMP.z0) return 'The forklift ramp';
  if (p.x >= STAIRS.x0 - 0.3 && p.x <= STAIRS.x1 + 0.3 && Math.abs(p.z - (STAIRS.z0 + 0.6)) < 1.2) return 'The stairs to the lower level';
  const lower = inLowerLevel(p.x, p.z);
  const where = lower ? 'Lower level' : 'Upper level';
  if (p.x < RACK_X0 - 0.5) return `${where}, west wall behind the racking`;
  const rows = RACKS.filter((r) => !!r.base === lower).sort((a, b) => a.z0 - b.z0);
  if (p.x > x1 + 0.5) {
    // Just past the rack ends: name the aisle we're at the end of
    if (p.x < x1 + 4) {
      for (let i = 0; i < rows.length - 1; i++) {
        if (p.z > rows[i].z1 && p.z < rows[i + 1].z0) return `End of aisle ${rows[i].name}/${rows[i + 1].name}`;
      }
    }
    return lower ? 'Lower level, open floor' : 'Open floor, east side';
  }
  const bay = Math.min(BAYS, Math.max(1, Math.floor((p.x - RACK_X0) / BAY_W) + 1));
  const h = p.y - floorHeightAt(p.x, p.z);
  const up = h > 0.5 ? `, ${h.toFixed(1)} m up` : '';
  for (const r of rows) if (p.z >= r.z0 - 0.2 && p.z <= r.z1 + 0.2) return `Rack ${r.name}, bay ${bay}${up}`;
  for (let i = 0; i < rows.length - 1; i++) {
    if (p.z > rows[i].z1 && p.z < rows[i + 1].z0) return `Aisle ${rows[i].name}/${rows[i + 1].name}, by bay ${bay}${up}`;
  }
  if (p.z < rows[0].z0) return lower ? `Aisle by Rack ${rows[0].name}, bay ${bay}${up}` : 'Behind Rack A';
  return `Aisle south of Rack ${rows[rows.length - 1].name}, by bay ${bay}${up}`;
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

  // Floor: upper level slabs, the sunken lower level, its stairs and the forklift ramp
  buildFloors(game);

  // Walls (inside faces at the room bounds), down to the bottom of the lower level
  const wallC = 0xece6d8; // warm off-white metal panels, against the grey concrete floor
  const t = 0.2;
  const wallHalfY = (wallH - FLOOR_BOTTOM) / 2;
  const wallY = (wallH + FLOOR_BOTTOM) / 2;
  for (const [half, pos] of [
    [[halfX + t * 2, wallHalfY, t], [0, wallY, -halfZ - t]],
    [[halfX + t * 2, wallHalfY, t], [0, wallY, halfZ + t]],
    [[t, wallHalfY, halfZ], [-halfX - t, wallY, 0]],
    [[t, wallHalfY, halfZ], [halfX + t, wallY, 0]],
  ]) {
    // Tall walls would throw the (fake) sun's shadow across half the floor
    const wall = addStatic(game, half, pos, wallC, { edges: false });
    wall.castShadow = false;
    wall.material = wallMaterial(Math.max(half[0], half[2]) * 2, half[1] * 2);
  }
  // Roof: solid (a FRAGILE blast can't throw things out of the building), with the lights,
  // ducts and fans hanging under it
  addStatic(game, [halfX + t * 2, t, halfZ + t * 2], [0, wallH + t, 0], 0, { mesh: false });
  const fans = buildCeiling(game);
  // Wainscot stripe for depth cues, 1 m tall at floor level ([length, centre x, centre z, rotation, floor y])
  for (const [w, x, z, ry, y] of [
    [halfX * 2, 0, -halfZ + 0.01, 0, 0],
    [halfX - RAMP.x1, (halfX + RAMP.x1) / 2, halfZ - 0.01, Math.PI, 0],
    [LOWER.x1 + halfX, (LOWER.x1 - halfX) / 2, halfZ - 0.01, Math.PI, LOWER.y],
    [LOWER.z0 + halfZ, -halfX + 0.01, (LOWER.z0 - halfZ) / 2, Math.PI / 2, 0],
    [halfZ - LOWER.z0, -halfX + 0.01, (halfZ + LOWER.z0) / 2, Math.PI / 2, LOWER.y],
    [halfZ * 2, halfX - 0.01, 0, -Math.PI / 2, 0],
  ]) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.0), new THREE.MeshBasicMaterial({ color: 0xf5c518 }));
    s.position.set(x, y + 0.5, z);
    s.rotation.y = ry;
    scene.add(s);
  }
  // ...and along the ramp it slopes down with the floor
  const rampStripe = new THREE.PlaneGeometry(RAMP.x1 - RAMP.x0, 1.0);
  const pos = rampStripe.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) + (LOWER.y * (0.5 - pos.getX(i) / (RAMP.x1 - RAMP.x0))));
  const rs = new THREE.Mesh(rampStripe, new THREE.MeshBasicMaterial({ color: 0xf5c518, side: THREE.DoubleSide }));
  rs.position.set((RAMP.x0 + RAMP.x1) / 2, 0.5, halfZ - 0.01);
  scene.add(rs);

  // Racks
  const racks = RACKS.map((r) => buildRack(game, r));
  // Back-to-back pairs (B/C, D/E) share a 0.2 m flue
  const tied = (a, b) => a !== b && a.base === b.base && (Math.abs(b.z0 - a.z1) < 0.5 || Math.abs(a.z0 - b.z1) < 0.5);
  for (const r of racks) r.partner = racks.find((o) => tied(r, o));
  // Aisle lines along every open rack face
  const yellow = 0xf5c518;
  for (const r of RACKS) {
    const z = r.face === 'south' ? r.z1 + 0.2 : r.z0 - 0.2;
    const line = new THREE.Mesh(new THREE.PlaneGeometry(BAYS * BAY_W, 0.1), new THREE.MeshBasicMaterial({ color: yellow }));
    line.rotation.x = -Math.PI / 2;
    line.position.set(RACK_X0 + (BAYS * BAY_W) / 2, (r.base || 0) + 0.005, z);
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

  // North-east corner: supervisor's office, safety station, propane cage, forklift parking
  const corner = buildCorner(game);
  game.employeeBoard = corner.safety;
  game.propane = corner.propane;

  // Stock every shelf and pick this shift's order
  const { order, orderBoxes } = stockShelves(game, racks);

  // Loose boxes on the open floor for stacking
  const loose = [
    ['medium', 1.0, 0, 2.2],
    ['small', 1.0, 0.6, 2.2],
    ['small', 2.0, 0, 2.6],
    ['large', 3.0, 0, -5.0],
    ['medium', 1.6, 0, -12.0],
    ['medium', 16.0, 0, 5.5],
    ['small', 16.7, 0, 5.9],
    ['medium', 0.5, LOWER.y, 13.5],
  ];
  for (const [type, x, y, z] of loose) createBox(game, { type, sku: game.skus.next(), pos: [x, y, z], yaw: (Math.random() - 0.5) * 0.3 });

  // A-frame ladders: two on each LADDERS stand, upstairs and down
  createLadderStand(game, { pos: [1.0, 0, -halfZ + 0.3] }); // upstairs, north wall east of Rack A
  createLadderStand(game, { pos: [1.2, LOWER.y, LOWER.z0 + 0.3] }); // downstairs, by the foot of the stairs

  // Empty pallets (fork pockets open toward ±local Z)
  createPallet(game, { pos: [2.6, 0, -12.2], yaw: Math.PI / 2 });
  createPallet(game, { pos: [2.6, 0, -4.8], yaw: Math.PI / 2 });
  createPallet(game, { pos: [8.0, 0, 6.5], yaw: 0 });
  createPallet(game, { pos: [9.8, 0, 6.5], yaw: 0 });
  createPallet(game, { pos: [2.0, LOWER.y, 8.6], yaw: Math.PI / 2 });

  return {
    wrapZone,
    dockZone,
    items: orderBoxes, // { A: [...], B: [...] }: the boxes each order line wants (for debugging/tests)
    order, // [{ line, sku, location }]
    racks,
    fans, // giant ceiling fans (the game turns them)
    climberSpawn: { pos: new THREE.Vector3(-2, 0, -5.2), yaw: Math.PI / 2 }, // aisle C/D, looking down it
    spawnPoints: [
      new THREE.Vector3(-2, 0, -5.2),
      new THREE.Vector3(-2, 0, -12.2),
      new THREE.Vector3(-2, 0, 1.5),
      new THREE.Vector3(-10, 0, 2.2),
      new THREE.Vector3(-10, LOWER.y, 5.9),
      new THREE.Vector3(-10, LOWER.y, 12.6),
      new THREE.Vector3(2, LOWER.y, 12.6),
      new THREE.Vector3(-22, 0, -6),
      new THREE.Vector3(-22, LOWER.y, 8),
      new THREE.Vector3(6, 0, 0),
      new THREE.Vector3(10, 0, -10),
      new THREE.Vector3(16, 0, 13),
    ],
    forkliftSpawn: corner.parking, // the parking bay in the north-east corner
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
