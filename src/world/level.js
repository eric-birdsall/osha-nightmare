import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { COL } from '../physics.js';
import { CONFIG } from '../config.js';
import { boxMesh, flatMat, labelPlane } from '../util/meshes.js';
import { createBox } from '../entities/box.js';
import { createPallet } from '../entities/pallet.js';
import { createLadderStand } from '../entities/ladder.js';
import { buildParking } from './parking.js';
import { buildSpills } from './spills.js';
import { LAYOUT, rackX1 } from './layout.js';
import { buildWrapper } from './wrapper.js';
import { buildPacking, packingSize } from './packing.js';
import { buildHazards, hazardZones } from './hazards.js';

// The layout's numbers live in layout.js; these are the parts other modules use by name
export const ROOM = LAYOUT.room;
export const LOWER = LAYOUT.lower; // the sunken part of the floor (the basement)
export const RAMP = LAYOUT.ramp; // the forklift's ramp down to it
const FLOOR_BOTTOM = -1.5; // floor slabs are solid down to here; their sides are the pit walls

// Downhill directions as [x, z]
const DIRS = { west: [-1, 0], east: [1, 0], north: [0, -1], south: [0, 1] };

// Dave's stairs down into the lower level from its edge: the steps' rectangle, plus the
// descent direction (dx, dz) and the top edge
export const STAIRS = (() => {
  const st = LAYOUT.stairs;
  const [dx, dz] = DIRS[st.down];
  const far = st.edge + (dx || dz) * st.steps * st.tread;
  const [a0, a1] = [Math.min(st.edge, far), Math.max(st.edge, far)];
  const rect = dz ? { x0: st.from, x1: st.to, z0: a0, z1: a1 } : { x0: a0, x1: a1, z0: st.from, z1: st.to };
  return { ...st, ...rect, dx, dz };
})();

// Loading docks on the east wall. Each order ships from one, picked at random: its roll-up door
// is open with a trailer backed up to it, and the order completes when the wrapped load is in
// the trailer. The others stay shut.
export const DOCKS = LAYOUT.docks;
const DOOR_HALF = LAYOUT.door.half; // half the door width
const DOOR_H = LAYOUT.door.h;
const TRAILER = LAYOUT.trailer; // inside dimensions
let openDock = DOCKS[1]; // this order's dock (set when the level is built)

const inRect = (r, x, z) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
export const inLowerLevel = (x, z) => inRect(LOWER, x, z);

// How far down the ramp a point is: 0 at the top, 1 at the bottom
function rampT(x, z) {
  const [dx, dz] = DIRS[RAMP.down];
  if (dx) return dx < 0 ? (RAMP.x1 - x) / (RAMP.x1 - RAMP.x0) : (x - RAMP.x0) / (RAMP.x1 - RAMP.x0);
  return dz < 0 ? (RAMP.z1 - z) / (RAMP.z1 - RAMP.z0) : (z - RAMP.z0) / (RAMP.z1 - RAMP.z0);
}

// Height of the floor (not counting anything standing on it) at a spot.
export function floorHeightAt(x, z) {
  if (inRect(RAMP, x, z)) return LOWER.y * rampT(x, z);
  if (!inLowerLevel(x, z)) return 0;
  if (inRect(STAIRS, x, z)) {
    const d = STAIRS.dx ? (x - STAIRS.edge) * STAIRS.dx : (z - STAIRS.edge) * STAIRS.dz;
    const step = Math.floor(d / STAIRS.tread) + 1; // step 1 is the first one down
    if (step < STAIRS.steps) return (LOWER.y * step) / STAIRS.steps;
  }
  return LOWER.y;
}
export const SHELF_LEVELS = LAYOUT.racking.shelves;
const BAY_W = LAYOUT.racking.bayW;
const UPRIGHT_H = LAYOUT.racking.uprightH;
const BEAM_H = 0.16; // shelf beam height (labels go on its face)
const BEAM_D = 0.06; // beam depth

// Racks, laid out like a real warehouse (see layout.js): { name, z0, z1, face, base, x0, bays }
export const RACKS = LAYOUT.racks;

// Middle of bay i of a rack
const bayX = (rack, i) => rack.x0 + (i + 0.5) * BAY_W;

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
function labelRack(group, rack, cx, cz) {
  const { name, z0, z1, face, x0 } = rack;
  const x1 = rackX1(rack);
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
    for (let b = 0; b < rack.bays; b++) {
      SHELF_LEVELS.forEach((y, sh) => {
        // Tag stuck on the beam face, a few mm proud of it
        add(tagPlane(locationCode(name, b, sh), 0.42, BEAM_H - 0.03), bayX(rack, b), y - BEAM_H / 2, z + (ry ? 0.008 : -0.008), ry);
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
  const { name, z0, z1, base, x0, bays } = rack;
  const x1 = rackX1(rack);
  const len = x1 - x0;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const blue = 0x2f5fb3;
  const orange = 0xe86a1c;
  const deckGrey = 0x9aa1aa;
  const parts = []; // [half, local pos, color, edges]
  const uprightZs = [z0 + 0.05, z1 - 0.05];
  for (let i = 0; i <= bays; i++) {
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
  const totalMass = cfg.massPerBay * bays;
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
  // A random bay of the named rack
  const bay = (name) => Math.floor(Math.random() * RACKS.find((r) => r.name === name).bays);
  // A random slot { rack, bay, shelf } on one of these racks
  const slotIn = (names, shelf) => {
    const rack = pickOne(names);
    return { rack, bay: bay(rack), shelf: shelf ?? Math.floor(Math.random() * SHELF_LEVELS.length) };
  };
  const rackA = pickOne(upstairs);
  const qtyB = Math.random() < 0.5 ? 1 : 2;
  const lines = {
    A: { rack: rackA, bay: bay(rackA), shelf: 1, qty: 3, short: 1 },
    B: { ...slotIn(upstairs.filter((n) => n !== rackA), 2), qty: qtyB, short: qtyB > 1 && Math.random() < cfg.backstockChance ? 1 : 0 },
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
      do b = slotIn(downstairs, 0);
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
    do face = slotIn(upstairs);
    while (taken(face.rack, face.bay, face.shelf) && ++tries < 50);
    do store = slotIn(downstairs, 0);
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
    const { name, z0, z1, face, base } = rack;
    const ent = racks.find((r) => r.name === name);
    for (let b = 0; b < rack.bays; b++) {
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
            pos: [bayX(rack, b) + dx + (Math.random() - 0.5) * 0.12, base + SHELF_LEVELS[shelf] + 0.005, z],
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
          sign.position.set(bayX(rack, b) + 0.62 - (rack.x0 + rackX1(rack)) / 2, SHELF_LEVELS[shelf] - BEAM_H - 0.13, fz - (z0 + z1) / 2);
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
  const { fans: FANS, girders: girderZs, ducts } = LAYOUT.ceiling;
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
  for (const z of girderZs) girders.push([0, H - 0.75, z]);
  instancedBoxes(game, [halfX * 2, 0.3, 0.25], steel, girders);
  // Diagonal web bracing under the joists (simple Xs between joists, along the middle)
  const web = [];
  for (let z = -halfZ + 2; z < halfZ - 2; z += 4) {
    for (let x = -halfX + 3; x < halfX - 2; x += 6) web.push([x, H - 0.55, z + 2, Math.PI / 4], [x, H - 0.55, z + 2, -Math.PI / 4]);
  }
  instancedBoxes(game, [0.06, 0.06, 2.8], steel, web);

  // Lights and duct drops stay out of the giant fans' sweep
  const clearOfFans = (x, z) => FANS.every(([fx, fz]) => Math.hypot(x - fx, z - fz) > 4.3);

  // Fluorescent fixtures: two-tube strips hanging 3.5 m below the roof, in rows along the aisles
  const lightY = H - 3.5;
  const fixtures = [];
  for (let x = -halfX + 3; x <= halfX - 3; x += 3.5) {
    for (let z = -halfZ + 2; z <= halfZ - 2; z += 4) if (clearOfFans(x, z)) fixtures.push([x, lightY, z]);
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
  for (const d of ducts) duct(d.x0, d.x1, H - d.drop, d.z, d.r);

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

// The floor cut into rectangles at every edge of the lower level and the ramp; each cell is
// 'upper', 'lower' or 'ramp'. at(i, j) is the cell between xs[i..i+1] and zs[j..j+1].
function floorGrid() {
  const { halfX, halfZ } = ROOM;
  const cuts = (lo, hi, vals) => [...new Set([lo, hi, ...vals.map((v) => Math.max(lo, Math.min(hi, v)))])].sort((a, b) => a - b);
  const xs = cuts(-halfX, halfX, [LOWER.x0, LOWER.x1, RAMP.x0, RAMP.x1]);
  const zs = cuts(-halfZ, halfZ, [LOWER.z0, LOWER.z1, RAMP.z0, RAMP.z1]);
  const cells = [];
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < zs.length - 1; j++) {
      const [x0, x1, z0, z1] = [xs[i], xs[i + 1], zs[j], zs[j + 1]];
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      cells.push({ x0, x1, z0, z1, type: inRect(RAMP, cx, cz) ? 'ramp' : inLowerLevel(cx, cz) ? 'lower' : 'upper' });
    }
  }
  return { xs, zs, cells, at: (i, j) => cells[i * (zs.length - 1) + j] };
}

// Where the upper floor drops away: round the lower level, and along the sides of the ramp
// (not its top end, which is level with the floor). n points from the upper side toward the drop.
function dropEdges({ xs, zs, at }) {
  const [rdx, rdz] = DIRS[RAMP.down];
  const edges = [];
  const check = (up, down, n, seg) => {
    if (up.type !== 'upper' || down.type === 'upper') return;
    if (down.type === 'ramp' && (n[0] ? rdx : rdz) !== 0) return; // the ramp's top end
    edges.push({ ...seg, n });
  };
  for (let i = 1; i < xs.length - 1; i++) {
    for (let j = 0; j < zs.length - 1; j++) {
      const seg = { line: xs[i], a: zs[j], b: zs[j + 1] };
      check(at(i - 1, j), at(i, j), [1, 0], seg);
      check(at(i, j), at(i - 1, j), [-1, 0], seg);
    }
  }
  for (let j = 1; j < zs.length - 1; j++) {
    for (let i = 0; i < xs.length - 1; i++) {
      const seg = { line: zs[j], a: xs[i], b: xs[i + 1] };
      check(at(i, j - 1), at(i, j), [0, 1], seg);
      check(at(i, j), at(i, j - 1), [0, -1], seg);
    }
  }
  // Join pieces that run on in a line
  edges.sort((p, q) => p.n[0] - q.n[0] || p.n[1] - q.n[1] || p.line - q.line || p.a - q.a);
  const joined = [];
  for (const e of edges) {
    const last = joined[joined.length - 1];
    if (last && last.n[0] === e.n[0] && last.n[1] === e.n[1] && last.line === e.line && Math.abs(last.b - e.a) < 1e-6) last.b = e.b;
    else joined.push({ ...e });
  }
  // As world points: an edge along z (n along x) sits at x = line
  return joined.map((e) => (e.n[0] ? { ...e, p0: [e.line, e.a], p1: [e.line, e.b] } : { ...e, p0: [e.a, e.line], p1: [e.b, e.line] }));
}

// Where a section of railing should be (from gap.from to gap.to along x or z, on the line `at`):
// just a strip of hazard tape sagging between the ends, with a tiny WATCH YOUR STEP sign hanging
// off it. The tape stops nothing.
function missingRailing(game, gap, at) {
  const tape = hazardMaterial(gap.to - gap.from, 0.3).clone();
  tape.side = THREE.DoubleSide;
  const mid = (gap.from + gap.to) / 2;
  const sag = 0.18;
  const half = (gap.to - gap.from) / 2;
  // Built running along local x, then turned to run along z if need be
  const g = new THREE.Group();
  if (gap.along === 'z') {
    g.position.set(at, 0, mid);
    g.rotation.y = -Math.PI / 2;
  } else g.position.set(mid, 0, at);
  for (const s of [-1, 1]) {
    const len = Math.hypot(half, sag);
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.07), tape);
    strip.position.set((s * half) / 2, 0.98 - sag / 2, 0);
    strip.rotation.z = s * Math.atan2(sag, half);
    g.add(strip);
  }
  const sign = labelPlane('WATCH YOUR STEP', 0.46, 0.09, { bg: '#f5c518', fg: '#16171a' });
  sign.material.side = THREE.DoubleSide;
  sign.position.set(0, 0.98 - sag - 0.06, 0);
  sign.rotation.z = 0.12;
  g.add(sign);
  game.scene.add(g);
}

function buildFloors(game) {
  const grid = floorGrid();
  // Slabs: upper floor, lower level, and solid fill under the ramp
  for (const c of grid.cells) floorSlab(game, c.x0, c.x1, c.z0, c.z1, c.type === 'upper' ? 0 : LOWER.y, { mesh: c.type !== 'ramp' });

  // Pit walls along every drop, facing the lower side
  const edges = dropEdges(grid);
  for (const e of edges) {
    const [[x0, z0], [x1, z1]] = [e.p0, e.p1];
    pitWall(game, (x0 + x1) / 2, (z0 + z1) / 2, Math.hypot(x1 - x0, z1 - z0), Math.atan2(e.n[0], e.n[1]));
  }

  // Stairs: risers down from the upper level, yellow nosing on every step. Positions are worked
  // out as (across the stairs, distance down from the top edge).
  const { steps, tread, dx, dz, edge, from, to } = STAIRS;
  const dir = dx || dz;
  const sw = to - from;
  const mid = (from + to) / 2;
  const at = (lat, d) => (dz ? [lat, edge + dir * d] : [edge + dir * d, lat]);
  const size = (across, along) => (dz ? [across, along] : [along, across]);
  for (let i = 1; i < steps; i++) {
    const top = (LOWER.y * i) / steps;
    const d0 = (i - 1) * tread;
    const [px, pz] = at(mid, d0 + tread / 2);
    const [sx, sz] = size(sw, tread);
    addStatic(game, [sx / 2, (top - FLOOR_BOTTOM) / 2, sz / 2], [px, (top + FLOOR_BOTTOM) / 2, pz], 0, { mesh: false });
    const step = boxMesh(sx, top - LOWER.y, sz, 0x8a8f96);
    step.position.set(px, (top + LOWER.y) / 2, pz);
    game.scene.add(step);
    const nose = new THREE.Mesh(new THREE.PlaneGeometry(...size(sw, 0.06)), new THREE.MeshBasicMaterial({ color: 0xf5c518 }));
    nose.rotation.x = -Math.PI / 2;
    const [nx, nz] = at(mid, d0 + 0.03);
    nose.position.set(nx, top + 0.004, nz);
    game.scene.add(nose);
  }
  // Handrails down both sides of the stairs (sloped rail on posts)
  const run = (steps - 1) * tread;
  const pitch = Math.atan2(-LOWER.y, run + 0.2);
  for (const lat of [from + 0.04, to - 0.04]) {
    for (const [d, y] of [[0.05, 0], [run + 0.25, LOWER.y]]) {
      const post = boxMesh(0.06, 1.0, 0.06, 0xf5c518, { edges: false });
      const [px, pz] = at(lat, d);
      post.position.set(px, y + 0.5, pz);
      game.scene.add(post);
    }
    const slope = Math.hypot(run + 0.2, -LOWER.y);
    const [rx, ry, rz] = dz ? [0.05, 0.05, slope] : [slope, 0.05, 0.05];
    const rail = boxMesh(rx, ry, rz, 0xf5c518, { edges: false });
    const [px, pz] = at(lat, 0.05 + (run + 0.2) / 2);
    rail.position.set(px, 1.0 + LOWER.y / 2, pz);
    if (dz) rail.rotation.x = dz * pitch;
    else rail.rotation.z = -dx * pitch;
    game.scene.add(rail);
  }

  // Forklift ramp: a sloped slab from the upper floor down to the lower level. Built running
  // downhill toward local -x, then turned to face its way down.
  const [rdx, rdz] = DIRS[RAMP.down];
  const rl = rdx ? RAMP.x1 - RAMP.x0 : RAMP.z1 - RAMP.z0; // length
  const rw = rdx ? RAMP.z1 - RAMP.z0 : RAMP.x1 - RAMP.x0; // width
  const angle = Math.atan2(-LOWER.y, rl);
  const thick = 0.3;
  const len = Math.hypot(rl, LOWER.y);
  const rcx = (RAMP.x0 + RAMP.x1) / 2;
  const rcz = (RAMP.z0 + RAMP.z1) / 2;
  const turn = new THREE.Group();
  turn.position.set(rcx, 0, rcz);
  turn.rotation.y = Math.atan2(rdz, -rdx);
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(len, thick, rw), [
    flatMat(0x8a8f96),
    flatMat(0x8a8f96),
    floorMaterial(len, rw),
    flatMat(0x8a8f96),
    flatMat(0x8a8f96),
    flatMat(0x8a8f96),
  ]);
  ramp.position.set((Math.sin(angle) * thick) / 2, LOWER.y / 2 - (Math.cos(angle) * thick) / 2, 0);
  ramp.rotation.z = angle;
  ramp.receiveShadow = true;
  turn.add(ramp);
  // Hazard edging down both sides of the ramp
  for (const z of [-rw / 2 + 0.12, rw / 2 - 0.12]) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.2), hazardMaterial(len, 0.6));
    stripe.rotation.set(-Math.PI / 2, 0, angle, 'ZXY'); // lie flat, then tilt with the ramp
    stripe.position.set(0, LOWER.y / 2 + 0.006, z);
    turn.add(stripe);
  }
  game.scene.add(turn);
  turn.updateMatrixWorld(true);
  const rp = ramp.getWorldPosition(new THREE.Vector3());
  const rq = ramp.getWorldQuaternion(new THREE.Quaternion());
  game.world.createCollider(
    RAPIER.ColliderDesc.cuboid(len / 2, thick / 2, rw / 2)
      .setTranslation(rp.x, rp.y, rp.z)
      .setRotation({ x: rq.x, y: rq.y, z: rq.z, w: rq.w })
      .setFriction(0.8)
      .setCollisionGroups(COL.static),
    game.staticBody,
  );
  // Floor words read by someone heading downhill (dx, dz)
  const facing = (fx, fz) => Math.atan2(-fx, -fz);
  floorText(game, 'RAMP', rcx - rdx * (rl / 2 + 1.2), rcz - rdz * (rl / 2 + 1.2), 2.4, 0.8, facing(rdx, rdz));
  const [lx, lz] = at(mid + 3.8, run + 0.1);
  floorText(game, LAYOUT.lower.label, lx, lz, 3.6, 0.6, facing(dx, dz), '#f5c518', LOWER.y); // reads coming down the stairs

  // Railings along every drop (with a gap at the top of the stairs), just on the upper side
  const e = 0.06;
  const gap = LAYOUT.hazards.railingGap; // a section someone took out
  const cutOut = (pieces, [c0, c1]) => pieces.flatMap(([a, b]) => [[a, Math.min(b, c0)], [Math.max(a, c1), b]]).filter(([a, b]) => b - a > 0.05);
  for (const d of edges) {
    const off = (p) => [p[0] - d.n[0] * e, p[1] - d.n[1] * e];
    let pieces = [[d.a, d.b]];
    // The stairs' top edge lies on this line, facing the same way down: leave it open
    if ((d.n[0] === dx && dx) || (d.n[1] === dz && dz)) {
      if (Math.abs(d.line - edge) < 1e-6) pieces = cutOut(pieces, [from, to]);
    }
    // An edge along z sits on a line of constant x (its normal is along x), and the other way round
    const gapHere = (gap.along === 'z') === !!d.n[0] && Math.abs(d.line - gap.line) < 1e-6 && gap.from < d.b && gap.to > d.a;
    if (gapHere) {
      pieces = cutOut(pieces, [gap.from, gap.to]);
      missingRailing(game, gap, d.line - (d.n[0] || d.n[1]) * e);
    }
    for (const [a, b] of pieces) {
      const [p0, p1] = d.n[0] ? [[d.line, a], [d.line, b]] : [[a, d.line], [b, d.line]];
      const [q0, q1] = [off(p0), off(p1)];
      guardrail(game, q0[0], q0[1], q1[0], q1[1]);
    }
  }
  return grid;
}

// Human-readable spot for incident reports: a rack, an aisle and bay, or a floor zone.
export function describeLocation(p) {
  const { parking } = LAYOUT;
  if (p.z < -ROOM.halfZ + parking.depth + 0.4 && p.x > parking.x0 - 0.2 && p.x < parking.x1 + 0.2) return 'Forklift parking';
  const wrap = LAYOUT.wrap;
  if (Math.abs(p.x - wrap.x) < wrap.size / 2 + 0.15 && Math.abs(p.z - wrap.z) < wrap.size / 2 + 0.15) return 'The WRAP square';
  if (Math.abs(p.x - wrap.x) < wrap.frame.half + 0.3 && Math.abs(p.z - wrap.z) < wrap.frame.half + 0.3) return 'The stretch wrapper';
  for (const h of hazardZones()) if (Math.hypot(p.x - h.x, p.z - h.z) < h.r) return h.name;
  const [pw, pd] = packingSize();
  if (Math.abs(p.x - LAYOUT.packing.x) < pw / 2 + 1.5 && Math.abs(p.z - LAYOUT.packing.z) < pd / 2 + 1.5) return 'The packing stations';
  for (const d of DOCKS) {
    if (Math.abs(p.z - d.z) > 2.2) continue;
    if (p.x > ROOM.halfX + 0.3) return `The truck at ${d.name}`;
    if (p.x > ROOM.halfX - 4) return d.name;
  }
  if (inRect(RAMP, p.x, p.z)) return 'The forklift ramp';
  const lowerName = LAYOUT.lower.label.toLowerCase();
  if (p.x >= STAIRS.x0 - 0.3 && p.x <= STAIRS.x1 + 0.3 && p.z >= STAIRS.z0 - 0.3 && p.z <= STAIRS.z1 + 0.3) return `The stairs to the ${lowerName}`;
  const lower = inLowerLevel(p.x, p.z);
  const h = p.y - floorHeightAt(p.x, p.z);
  const up = h > 0.5 ? `, ${h.toFixed(1)} m up` : '';
  const bayOf = (r) => Math.min(r.bays, Math.max(1, Math.floor((p.x - r.x0) / BAY_W) + 1));
  const alongside = (r, m = 0) => p.x >= r.x0 - m && p.x <= rackX1(r) + m;
  const rows = RACKS.filter((r) => !!r.base === lower).sort((a, b) => a.z0 - b.z0);
  for (const r of rows) if (alongside(r, 0.2) && p.z >= r.z0 - 0.2 && p.z <= r.z1 + 0.2) return `Rack ${r.name}, bay ${bayOf(r)}${up}`;
  // Pick aisles: between a rack and the next one south of it in the same block (not its
  // back-to-back partner across the flue)
  for (const a of rows) {
    const b = rows.find((o) => o !== a && o.z0 >= a.z1 - 0.01 && o.x0 < rackX1(a) && a.x0 < rackX1(o));
    if (!b || b.z0 - a.z1 < 1 || p.z <= a.z1 || p.z >= b.z0) continue;
    if (alongside(a)) return `Aisle ${a.name}/${b.name}, by bay ${bayOf(a)}${up}`;
    if (alongside(a, 4)) return `End of aisle ${a.name}/${b.name}`;
  }
  if (lower) {
    // An aisle between the backstock racks and the basement's walls
    const by = rows.filter((o) => alongside(o));
    const gap = (o) => Math.max(o.z0 - p.z, p.z - o.z1);
    const r = by.sort((a, b) => gap(a) - gap(b))[0];
    const name = lowerName[0].toUpperCase() + lowerName.slice(1);
    return r ? `${name}, aisle by Rack ${r.name}, bay ${bayOf(r)}${up}` : `${name}, open floor`;
  }
  const zone = LAYOUT.zones.find((zn) => p.x >= zn.x0 && p.x <= zn.x1 && p.z >= zn.z0 && p.z <= zn.z1);
  return zone ? zone.name : 'Open floor';
}

// Roll-up door slats (grey with horizontal ribs).
function doorMaterial(h) {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#8f969e';
  g.fillRect(0, 0, 16, 64);
  g.fillStyle = '#6f767e';
  for (let y = 0; y < 64; y += 8) g.fillRect(0, y, 16, 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, h / 1.6);
  return new THREE.MeshLambertMaterial({ map: tex });
}

// Wooden trailer floor boards.
function boardsMaterial(len) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#9a7650';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#7b5c3c';
  for (let y = 0; y < 64; y += 16) g.fillRect(0, y, 64, 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(len / 2, 1.3);
  return new THREE.MeshLambertMaterial({ map: tex });
}

// Three docks on the east wall, each with floor markings, bumpers, a sign and a lamp. The open
// one (this order's) has its door rolled up, a dock plate, a black shelter round the opening and
// a trailer backed up to it, floor level with the warehouse so the forklift can drive in.
// Returns the sensor zone inside that trailer.
function buildDocks(game) {
  const { halfX } = ROOM;
  const scene = game.scene;
  for (const d of DOCKS) {
    const open = d === openDock;
    const green = '#31d07a';
    floorMarking(game, halfX - 1.9, d.z, 3.6, 4.0, open ? 0x31d07a : 0x9aa0a8, 0.15);
    floorText(game, d.name.toUpperCase(), halfX - 2.8, d.z, 3.2, 0.9, Math.PI / 2, open ? green : '#9aa0a8');
    const sign = labelPlane(d.name.toUpperCase(), 2.6, 0.7, open ? { bg: green, fg: '#0b1f12' } : { bg: '#4a5058', fg: '#d9dde2' });
    sign.position.set(halfX - 0.03, DOOR_H + 0.75, d.z);
    sign.rotation.y = -Math.PI / 2;
    scene.add(sign);
    // Dock lamp: green when it's the one to load
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshBasicMaterial({ color: open ? 0x31ff7a : 0xd02020 }));
    lamp.position.set(halfX - 0.1, DOOR_H + 0.2, d.z + DOOR_HALF + 0.35);
    scene.add(lamp);
    for (const z of [d.z - DOOR_HALF - 0.2, d.z + DOOR_HALF + 0.2]) addStatic(game, [0.1, 0.25, 0.15], [halfX - 0.1, 0.4, z], 0x111111);
    if (!open) {
      const door = new THREE.Mesh(new THREE.PlaneGeometry(DOOR_HALF * 2, DOOR_H), doorMaterial(DOOR_H));
      door.position.set(halfX - 0.02, DOOR_H / 2, d.z);
      door.rotation.y = -Math.PI / 2;
      scene.add(door);
      const closed = labelPlane('CLOSED', 1.6, 0.5, { bg: '#d0141b', fg: '#ffffff' });
      closed.position.set(halfX - 0.04, 1.9, d.z);
      closed.rotation.y = -Math.PI / 2;
      scene.add(closed);
      continue;
    }
    // Rolled-up door: just the bottom slats showing under the hood
    const rolled = new THREE.Mesh(new THREE.PlaneGeometry(DOOR_HALF * 2, 0.35), doorMaterial(0.35));
    rolled.position.set(halfX + 0.05, DOOR_H - 0.17, d.z);
    rolled.rotation.y = -Math.PI / 2;
    scene.add(rolled);
    // Dock plate bridging into the trailer
    const plate = boxMesh(0.9, 0.04, 2.4, 0x7d838a, { shadows: false });
    plate.position.set(halfX + 0.05, 0.0, d.z);
    scene.add(plate);
    for (const z of [d.z - 1.22, d.z + 1.22]) {
      const edge = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.08), new THREE.MeshBasicMaterial({ color: 0xf5c518 }));
      edge.rotation.x = -Math.PI / 2;
      edge.position.set(halfX + 0.05, 0.025, z);
      scene.add(edge);
    }
    // Trailer, backed up to the outside of the wall (inside dimensions in TRAILER)
    const x0 = halfX + 0.4;
    const x1 = x0 + TRAILER.length;
    const cx = (x0 + x1) / 2;
    const { halfW, height } = TRAILER;
    const part = (size, pos, mat) => {
      game.world.createCollider(
        RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2).setTranslation(...pos).setFriction(0.8).setCollisionGroups(COL.static),
        game.staticBody,
      );
      const m = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
      m.position.set(...pos);
      m.receiveShadow = true;
      scene.add(m);
    };
    const inside = new THREE.MeshLambertMaterial({ color: 0xdfe3e8 });
    part([TRAILER.length, 0.3, halfW * 2 + 0.16], [cx, -0.15, d.z], boardsMaterial(TRAILER.length)); // floor, level with the warehouse
    part([TRAILER.length, height, 0.08], [cx, height / 2, d.z - halfW - 0.04], inside); // sides
    part([TRAILER.length, height, 0.08], [cx, height / 2, d.z + halfW + 0.04], inside);
    part([0.08, height, halfW * 2 + 0.16], [x1 + 0.04, height / 2, d.z], inside); // front (cab end)
    part([TRAILER.length, 0.08, halfW * 2 + 0.16], [cx, height + 0.04, d.z], new THREE.MeshLambertMaterial({ color: 0xc9ced6, emissive: 0x3a3f46 })); // roof
    // Ribs down the inside walls, every 1.2 m
    const ribs = [];
    for (let x = x0 + 0.6; x < x1; x += 1.2) ribs.push([x, height / 2, d.z - halfW + 0.02], [x, height / 2, d.z + halfW - 0.02]);
    instancedBoxes(game, [0.05, height, 0.04], flatMat(0xb9bec6), ribs);
    // Black dock shelter round the trailer, closing the gaps in the doorway
    const shelter = flatMat(0x16171a);
    const curtain = (size, pos) => {
      game.world.createCollider(
        RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2).setTranslation(...pos).setCollisionGroups(COL.static),
        game.staticBody,
      );
      const m = new THREE.Mesh(new THREE.BoxGeometry(...size), shelter);
      m.position.set(...pos);
      scene.add(m);
    };
    const sideW = DOOR_HALF - halfW;
    curtain([0.3, DOOR_H, sideW], [halfX + 0.25, DOOR_H / 2, d.z - halfW - sideW / 2]);
    curtain([0.3, DOOR_H, sideW], [halfX + 0.25, DOOR_H / 2, d.z + halfW + sideW / 2]);
    curtain([0.3, DOOR_H - height, DOOR_HALF * 2], [halfX + 0.25, (DOOR_H + height) / 2, d.z]);
    // Load here: green marking down the trailer floor
    const mark = new THREE.Mesh(new THREE.PlaneGeometry(TRAILER.length - 0.6, 0.1), new THREE.MeshBasicMaterial({ color: 0x31d07a }));
    for (const z of [d.z - halfW + 0.2, d.z + halfW - 0.2]) {
      const m = mark.clone();
      m.rotation.x = -Math.PI / 2;
      m.position.set(cx, 0.006, z);
      scene.add(m);
    }
    // A light inside so the far end isn't a black hole
    const light = new THREE.PointLight(0xfff4e0, 8, 16);
    light.position.set(cx, height - 0.3, d.z);
    scene.add(light);
  }
  const x0 = halfX + 0.4;
  return makeZone(game, 'dock', x0 + TRAILER.length / 2, openDock.z, TRAILER.length - 0.2, TRAILER.halfW * 2);
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
  sun.shadow.mapSize.set(4096, 4096);
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
  const grid = buildFloors(game);

  // Walls (inside faces at the room bounds), down to the bottom of the lower level
  const wallC = 0xece6d8; // warm off-white metal panels, against the grey concrete floor
  const t = 0.2;
  const wallHalfY = (wallH - FLOOR_BOTTOM) / 2;
  const wallY = (wallH + FLOOR_BOTTOM) / 2;
  // This order's dock (the east wall gets a doorway there)
  openDock = DOCKS[Math.floor(Math.random() * DOCKS.length)];
  const oz = openDock.z;
  const eastWall = (z0, z1, y0, y1) => [[t, (y1 - y0) / 2, (z1 - z0) / 2], [halfX + t, (y0 + y1) / 2, (z0 + z1) / 2]];
  for (const [half, pos] of [
    [[halfX + t * 2, wallHalfY, t], [0, wallY, -halfZ - t]],
    [[halfX + t * 2, wallHalfY, t], [0, wallY, halfZ + t]],
    [[t, wallHalfY, halfZ], [-halfX - t, wallY, 0]],
    eastWall(-halfZ, oz - DOOR_HALF, FLOOR_BOTTOM, wallH),
    eastWall(oz + DOOR_HALF, halfZ, FLOOR_BOTTOM, wallH),
    eastWall(oz - DOOR_HALF, oz + DOOR_HALF, DOOR_H, wallH), // over the door
    eastWall(oz - DOOR_HALF, oz + DOOR_HALF, FLOOR_BOTTOM, 0), // under the threshold
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
  // Along the foot of every wall: a charcoal kick plate, so the wall clearly meets the floor, and a
  // yellow rub-rail stripe higher up for depth cues. Both step down with the lower level, slope
  // down the ramp and stop at the open dock's doorway.
  const bands = [
    { y0: 0, h: 0.25, out: 0.015, mat: new THREE.MeshLambertMaterial({ color: 0x2b2f35, side: THREE.DoubleSide }) },
    { y0: 1.0, h: 0.3, out: 0.01, mat: new THREE.MeshLambertMaterial({ color: 0xf5c518, emissive: 0x5c4808, side: THREE.DoubleSide }) },
  ];
  const v = new THREE.Vector3();
  for (const w of [
    { on: (c) => c.z0 === -halfZ, z: -halfZ, ry: 0 },
    { on: (c) => c.z1 === halfZ, z: halfZ, ry: Math.PI },
    { on: (c) => c.x0 === -halfX, x: -halfX, ry: Math.PI / 2 },
    { on: (c) => c.x1 === halfX, x: halfX, ry: -Math.PI / 2, gap: [oz - DOOR_HALF, oz + DOOR_HALF] },
  ]) {
    const alongX = w.z !== undefined;
    const [nx, nz] = [Math.round(Math.sin(w.ry)), Math.round(Math.cos(w.ry))]; // into the room
    for (const c of grid.cells.filter(w.on)) {
      let spans = [alongX ? [c.x0, c.x1] : [c.z0, c.z1]];
      if (w.gap) spans = spans.flatMap(([a, b]) => [[a, Math.min(b, w.gap[0])], [Math.max(a, w.gap[1]), b]]).filter(([a, b]) => b - a > 0.01);
      for (const [a, b] of spans) {
        for (const band of bands) {
          const geo = new THREE.PlaneGeometry(b - a, band.h);
          const stripe = new THREE.Mesh(geo, band.mat);
          const m = (a + b) / 2;
          stripe.position.set(alongX ? m : w.x + nx * band.out, band.y0 + band.h / 2, alongX ? w.z + nz * band.out : m);
          stripe.rotation.y = w.ry;
          stripe.receiveShadow = true;
          stripe.updateMatrixWorld();
          // Drop each corner by the height of the floor beneath it
          const pos = geo.attributes.position;
          for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i).applyMatrix4(stripe.matrixWorld);
            const fx = Math.min(c.x1, Math.max(c.x0, v.x));
            const fz = Math.min(c.z1, Math.max(c.z0, v.z));
            pos.setY(i, pos.getY(i) + (c.type === 'upper' ? 0 : c.type === 'lower' ? LOWER.y : LOWER.y * rampT(fx, fz)));
          }
          scene.add(stripe);
        }
      }
    }
  }

  // Racks
  const racks = RACKS.map((r) => buildRack(game, r));
  // Back-to-back pairs share a 0.2 m flue
  const overlapX = (a, b) => a.x0 < b.x1 && b.x0 < a.x1;
  const tied = (a, b) => a !== b && a.base === b.base && overlapX(a, b) && (Math.abs(b.z0 - a.z1) < 0.5 || Math.abs(a.z0 - b.z1) < 0.5);
  for (const r of racks) r.partner = racks.find((o) => tied(r, o));
  // Aisle lines along every open rack face
  const yellow = 0xf5c518;
  for (const r of RACKS) {
    const z = r.face === 'south' ? r.z1 + 0.2 : r.z0 - 0.2;
    const line = new THREE.Mesh(new THREE.PlaneGeometry(r.bays * BAY_W, 0.1), new THREE.MeshBasicMaterial({ color: yellow }));
    line.rotation.x = -Math.PI / 2;
    line.position.set((r.x0 + rackX1(r)) / 2, r.base + 0.005, z);
    scene.add(line);
  }
  // The highway: a painted lane along to the docks, its edge line and arrows pointing the way
  const hw = LAYOUT.highway;
  const edgeLine = new THREE.Mesh(new THREE.PlaneGeometry(hw.x1 - hw.x0, 0.15), new THREE.MeshBasicMaterial({ color: yellow }));
  edgeLine.rotation.x = -Math.PI / 2;
  edgeLine.position.set((hw.x0 + hw.x1) / 2, 0.005, hw.z0);
  scene.add(edgeLine);
  const dash = new THREE.MeshBasicMaterial({ color: 0xe8ecf0 });
  for (let x = hw.x0 + 1; x < hw.x1 - 1; x += 4) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 0.12), dash);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x + 1, 0.005, (hw.z0 + hw.z1) / 2);
    scene.add(m);
  }
  for (let x = hw.x0 + 6; x < hw.x1 - 4; x += 14) floorText(game, 'DOCKS ▶', x, (hw.z0 + hw.z1) / 2 + 1.6, 3.2, 0.9, -Math.PI / 2, '#e8ecf0');

  // Wrapper zone (open east half of the floor)
  const { x: wx, z: wz, size: ws } = LAYOUT.wrap;
  const wrapZone = makeZone(game, 'wrap', wx, wz, ws, ws);
  floorMarking(game, wx, wz, ws, ws, 0xf5c518, 0.15);
  floorText(game, 'WRAP', wx, wz + ws / 2 + 0.4, 2.0, 0.6);
  // The stretch wrapper's gantry over it, and the packing stations
  const wrapper = buildWrapper(game);
  buildPacking(game);

  // Loading docks: this order's is open with a trailer backed up to it
  const dockZone = buildDocks(game);

  // Wall-mounted incident sign (updated by the game)
  game.incidentSign = makeIncidentSign(scene);

  // A big compass letter high up in the middle of each wall, so the walls are easy to name
  for (const [letter, x, z, ry] of [
    ['N', 0, -halfZ + 0.03, 0],
    ['S', 0, halfZ - 0.03, Math.PI],
    ['W', -halfX + 0.03, 0, Math.PI / 2],
    ['E', halfX - 0.03, 0, -Math.PI / 2],
  ]) {
    const badge = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), new THREE.MeshBasicMaterial({ map: compassTexture(letter), transparent: true }));
    badge.position.set(x, 7.5, z);
    badge.rotation.y = ry;
    scene.add(badge);
  }

  // The forklift's parking bay and charger
  const parking = buildParking(game);

  // Stock every shelf and pick this shift's order
  const { order, orderBoxes } = stockShelves(game, racks);

  // Loose boxes on the open floor for stacking
  for (const [type, x, y, z] of LAYOUT.looseBoxes) {
    const box = createBox(game, { type, sku: game.skus.next(), pos: [x, y, z], yaw: (Math.random() - 0.5) * 0.3 });
    // Home is where it started (no rack): a FRAGILE one that goes off turns up here again
    const t = box.body.translation();
    const r = box.body.rotation();
    box.home = { pos: { x: t.x, y: t.y, z: t.z }, rot: { x: r.x, y: r.y, z: r.z, w: r.w } };
  }

  // A-frame ladders: two on each LADDERS stand, upstairs and down
  for (const st of LAYOUT.ladderStands) createLadderStand(game, { pos: [st.x, st.y, st.z], yaw: st.yaw });

  // Spills (2-3, random), hard to see
  const climberStart = new THREE.Vector3(...LAYOUT.climberSpawn.pos);
  // OSHA violations: sparking outlet, dripping electrical panel, mystery barrels, blocked fire exits
  const hazards = buildHazards(game, { floorHeightAt });
  const spills = [
    ...buildSpills(game, { wrapZone, stairs: STAIRS, keepClear: hazardZones(), spawns: [climberStart, parking.pos], floorHeightAt }),
    ...hazards.spills, // the panel's puddle and the barrels' leaks are slippery too
  ];

  // Empty pallets (fork pockets open toward ±local Z)
  for (const [x, y, z, yaw] of LAYOUT.pallets) createPallet(game, { pos: [x, y, z], yaw });

  return {
    wrapZone,
    wrapper, // the stretch wrapper's arm (the wrap system swings it)
    hazards, // the hazards' per-frame update (sparks, drips, barrels gushing)
    dockZone, // inside the trailer at the open dock
    dock: openDock, // { name, z }: this order's dock
    items: orderBoxes, // { A: [...], B: [...] }: the boxes each order line wants (for debugging/tests)
    order, // [{ line, sku, location }]
    racks,
    fans, // giant ceiling fans (the game turns them)
    spills, // [{ x, y, z, r, liquid }]
    climberSpawn: { pos: climberStart, yaw: LAYOUT.climberSpawn.yaw },
    spawnPoints: LAYOUT.spawnPoints.map((p) => new THREE.Vector3(...p)),
    forkliftSpawn: parking, // the parking bay
  };
}

// A yellow disc with a black ring and a big black letter on it.
function compassTexture(letter) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#16171a';
  g.beginPath();
  g.arc(128, 128, 126, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#f5c518';
  g.beginPath();
  g.arc(128, 128, 112, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#16171a';
  g.font = 'bold 170px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(letter, 128, 140);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeIncidentSign(scene) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshBasicMaterial({ map: tex }));
  mesh.position.set(LAYOUT.incidentSign.x, LAYOUT.incidentSign.y, -ROOM.halfZ + 0.03);
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
