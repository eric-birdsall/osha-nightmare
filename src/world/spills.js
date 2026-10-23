import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../config.js';
import { COL } from '../physics.js';
import { LAYOUT, rackX1 } from './layout.js';
import { packingSize } from './packing.js';

// Spills: a few slick puddles on the floor each order, with no warning sign and only a slight
// tint and sheen on the concrete, so they're easy to run over by accident. On a spill Dave has
// almost no grip (he slides, but never falls), the forklift's tyres lose most of their traction,
// and loose things (boxes, pallets, ladders) slide on a thin low-friction patch.

// Close to the concrete (#7d8187): just a wet-looking tint
const LIQUIDS = [
  { name: 'water', color: '#6c7178', alpha: 0.45 },
  { name: 'oil', color: '#5d6066', alpha: 0.5 },
  { name: 'soda', color: '#857b6e', alpha: 0.4 },
  { name: 'goo', color: '#76817a', alpha: 0.4 },
];

// An irregular puddle: overlapping blobs with a glossy highlight, transparent round the edge.
function puddleTexture(liquid) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = liquid.color;
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = i ? 30 + Math.random() * 45 : 0;
    g.globalAlpha = liquid.alpha;
    g.beginPath();
    g.ellipse(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 40 + Math.random() * 40, 30 + Math.random() * 35, Math.random() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 0.08; // the faintest sheen
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.ellipse(105, 100, 30, 10, -0.5, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Somewhere a spill can go: flat floor on one level, clear of racks, ramps, stairs, docks,
// the wrap square, the parking bay, the north-east corner and the start spots.
function spotOk(level, x, z, r, spills, floorHeightAt, blocked) {
  const { halfX, halfZ } = level.room;
  if (Math.abs(x) > halfX - r - 1 || Math.abs(z) > halfZ - r - 1) return false;
  const y = floorHeightAt(x, z);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    if (Math.abs(floorHeightAt(x + Math.cos(a) * (r + 0.4), z + Math.sin(a) * (r + 0.4)) - y) > 0.01) return false;
  }
  if (blocked.some(([x0, z0, x1, z1]) => x + r > x0 && x - r < x1 && z + r > z0 && z - r < z1)) return false;
  if (spills.some((s) => Math.hypot(s.x - x, s.z - z) < s.r + r + 3)) return false;
  return true;
}

// Places the spills and returns them: [{ x, y, z, r, liquid }].
export function buildSpills(game, { wrapZone, stairs, keepClear = [], spawns, floorHeightAt }) {
  const cfg = CONFIG.spill;
  const { room, lower, ramp, corner } = LAYOUT;
  const level = { room };
  const grow = (r, m) => [r.x0 - m, r.z0 - m, r.x1 + m, r.z1 + m];
  // Rectangles [x0, z0, x1, z1] nothing may overlap
  const blocked = [
    ...LAYOUT.racks.map((r) => [r.x0 - 0.6, r.z0 - 0.6, rackX1(r) + 0.6, r.z1 + 0.6]),
    ...LAYOUT.docks.map((d) => [room.halfX - 5, d.z - 3, room.halfX + 20, d.z + 3]),
    // The stretch wrapper (its frame and control panel)
    grow({ x0: wrapZone.center.x, x1: wrapZone.center.x, z0: wrapZone.center.z, z1: wrapZone.center.z }, LAYOUT.wrap.frame.half + 1.4),
    // The packing stations and their pallet stack
    (() => {
      const [w, d] = packingSize();
      const { x, z } = LAYOUT.packing;
      return [x - w / 2 - 1.5, z - d / 2 - 1.5, x + w / 2 + 2.4, z + d / 2 + 1.5];
    })(),
    // Office, safety station, propane cage, parking bay
    [corner.office.x0 - 0.5, -room.halfZ, room.halfX, -room.halfZ + corner.parking.depth + 1.1],
    ...LAYOUT.ladderStands.map((st) => [st.x - 2, st.z - 2.2, st.x + 2, st.z + 2.2]), // LADDERS stands
    grow(stairs, 1.2),
    grow(ramp, 1.2),
    // The pit edges and their railings
    [lower.x0 - 1.5, lower.z0 - 1.5, lower.x1 + 1.5, lower.z0 + 1.5],
    [lower.x0 - 1.5, lower.z1 - 1.5, lower.x1 + 1.5, lower.z1 + 1.5],
    [lower.x0 - 1.5, lower.z0 - 1.5, lower.x0 + 1.5, lower.z1 + 1.5],
    [lower.x1 - 1.5, lower.z0 - 1.5, lower.x1 + 1.5, lower.z1 + 1.5],
    ...spawns.map((p) => [p.x - 2.5, p.z - 2.5, p.x + 2.5, p.z + 2.5]),
    ...keepClear.map((h) => [h.x - h.r - 1, h.z - h.r - 1, h.x + h.r + 1, h.z + h.r + 1]), // the hazards
  ];
  const count = cfg.count[0] + Math.floor(Math.random() * (cfg.count[1] - cfg.count[0] + 1));
  const spills = [];
  for (let tries = 0; spills.length < count && tries < 400; tries++) {
    const r = cfg.radius[0] + Math.random() * (cfg.radius[1] - cfg.radius[0]);
    const x = (Math.random() * 2 - 1) * room.halfX;
    const z = (Math.random() * 2 - 1) * room.halfZ;
    if (!spotOk(level, x, z, r, spills, floorHeightAt, blocked)) continue;
    const y = floorHeightAt(x, z);
    const liquid = LIQUIDS[Math.floor(Math.random() * LIQUIDS.length)];
    spills.push(addPuddle(game, { x, y, z, r, liquid }));
  }
  return spills;
}

// A puddle on the floor at (x, y, z), radius r: slick for Dave and the forklift's tyres (see
// onSpill), with a thin low-friction patch under it that loose things slide on. liquid: { name,
// color, alpha }. Returns the spill record.
export function addPuddle(game, { x, y, z, r, liquid }) {
  game.world.createCollider(
    RAPIER.ColliderDesc.cylinder(0.002, r * 0.95)
      .setTranslation(x, y + 0.002, z)
      .setFriction(CONFIG.spill.friction)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setCollisionGroups(COL.static),
    game.staticBody,
  );
  const puddle = new THREE.Mesh(
    new THREE.PlaneGeometry(r * 2.3, r * 2.3),
    new THREE.MeshPhongMaterial({ map: puddleTexture(liquid), transparent: true, depthWrite: false, shininess: 60, specular: 0x333333 }),
  );
  puddle.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
  puddle.position.set(x, y + 0.009, z);
  puddle.renderOrder = 1;
  game.scene.add(puddle);
  return { x, y, z, r, liquid: liquid.name };
}

// Is this point (feet, a wheel) standing in a spill?
export function onSpill(spills, p) {
  return !!spills?.some((s) => Math.abs(p.y - s.y) < 0.6 && Math.hypot(p.x - s.x, p.z - s.z) < s.r);
}
