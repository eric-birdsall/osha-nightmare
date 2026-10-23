import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../config.js';
import { COL } from '../physics.js';

// Spills: a few slick puddles on the floor each order, each with a CAUTION WET FLOOR sign.
// On a spill Dave has almost no grip (he slides, but never falls), the forklift's tyres lose
// most of their traction, and loose things (boxes, pallets, ladders) slide on a thin
// low-friction patch. The signs are light physics props; moving one doesn't move its spill.

const LIQUIDS = [
  { name: 'water', color: '#7cc8ff', alpha: 0.5 },
  { name: 'oil', color: '#17171c', alpha: 0.85 },
  { name: 'soda', color: '#ff8a1f', alpha: 0.6 },
  { name: 'goo', color: '#62d45a', alpha: 0.6 },
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
  g.globalAlpha = 0.35;
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.ellipse(105, 100, 30, 10, -0.5, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// The sign's face: yellow, CAUTION across the top, a slipping stick figure, WET FLOOR below.
let signTex = null;
function signTexture() {
  if (signTex) return signTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 384;
  const g = c.getContext('2d');
  g.fillStyle = '#f5c518';
  g.fillRect(0, 0, 256, 384);
  g.fillStyle = '#16171a';
  g.fillRect(0, 0, 256, 70);
  g.fillStyle = '#f5c518';
  g.font = 'bold 54px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('CAUTION', 128, 38);
  // Slipping figure
  g.strokeStyle = '#16171a';
  g.fillStyle = '#16171a';
  g.lineWidth = 12;
  g.lineCap = 'round';
  g.beginPath();
  g.arc(150, 125, 18, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(140, 148);
  g.lineTo(110, 215); // body, leaning back
  g.moveTo(132, 165);
  g.lineTo(175, 150); // arm up
  g.moveTo(125, 175);
  g.lineTo(85, 160); // arm back
  g.moveTo(110, 215);
  g.lineTo(165, 235); // leg kicked out
  g.moveTo(110, 215);
  g.lineTo(80, 262); // leg down
  g.stroke();
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(50, 280);
  g.lineTo(206, 280);
  g.stroke();
  g.font = 'bold 50px system-ui, sans-serif';
  g.fillText('WET', 128, 318);
  g.fillText('FLOOR', 128, 360);
  signTex = new THREE.CanvasTexture(c);
  signTex.colorSpace = THREE.SRGBColorSpace;
  return signTex;
}

// A yellow A-frame sign: two panels leaning together, a light dynamic body.
function createSign(game, pos, yaw) {
  const body = game.world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
      .setCanSleep(true),
  );
  const mesh = new THREE.Group();
  const lean = 0.22;
  const face = new THREE.MeshLambertMaterial({ map: signTexture() });
  const edge = new THREE.MeshLambertMaterial({ color: 0xe0ad00 });
  for (const side of [-1, 1]) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -side * lean);
    const p = new THREE.Vector3(0, 0.33, side * 0.08);
    game.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.15, 0.33, 0.01)
        .setTranslation(p.x, p.y, p.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setMass(0.8)
        .setFriction(0.6)
        .setCollisionGroups(COL.dyn),
      body,
    );
    // Box faces: +x, -x, +y, -y, +z, -z; the printed face points outward
    const mats = [edge, edge, edge, edge, side > 0 ? face : edge, side > 0 ? edge : face];
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.66, 0.02), mats);
    panel.position.copy(p);
    panel.quaternion.copy(q);
    panel.castShadow = true;
    mesh.add(panel);
  }
  game.scene.add(mesh);
  const ent = { kind: 'sign', body, mesh, mass: 1.6 };
  game.addEntity(ent);
  return ent;
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

// Places the spills (and their signs) and returns them: [{ x, y, z, r, liquid }].
export function buildSpills(game, { racks, room, rackX0, rackX1, docks, wrapZone, spawns, floorHeightAt }) {
  const cfg = CONFIG.spill;
  const level = { room };
  // Rectangles [x0, z0, x1, z1] nothing may overlap
  const blocked = [
    ...racks.map((r) => [rackX0 - 0.6, r.z0 - 0.6, rackX1 + 0.6, r.z1 + 0.6]),
    ...docks.map((d) => [room.halfX - 5, d.z - 3, room.halfX + 20, d.z + 3]),
    [wrapZone.center.x - 2.5, wrapZone.center.z - 2.5, wrapZone.center.x + 2.5, wrapZone.center.z + 2.5],
    [5.5, -room.halfZ, room.halfX, -9.5], // office, safety station, propane cage, parking bay
    [-1, -room.halfZ, 3, -13.5], // LADDERS stand upstairs
    [-0.3, 3.3, 3, 5.6], // LADDERS stand downstairs
    [-3.5, 2.8, 0.5, 6.5], // stairs
    [-room.halfX, 2.2, 7.5, 5.0], // the pit edge and its railing
    [4.5, 3.8, 7.6, 13], // east pit edge
    ...spawns.map((p) => [p.x - 2.5, p.z - 2.5, p.x + 2.5, p.z + 2.5]),
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
    // Slick patch: a thin disc on the floor that loose things slide on
    game.world.createCollider(
      RAPIER.ColliderDesc.cylinder(0.002, r * 0.95)
        .setTranslation(x, y + 0.002, z)
        .setFriction(cfg.friction)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setCollisionGroups(COL.static),
      game.staticBody,
    );
    const puddle = new THREE.Mesh(
      new THREE.PlaneGeometry(r * 2.3, r * 2.3),
      new THREE.MeshPhongMaterial({ map: puddleTexture(liquid), transparent: true, depthWrite: false, shininess: 90, specular: 0xffffff }),
    );
    puddle.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
    puddle.position.set(x, y + 0.009, z);
    puddle.renderOrder = 1;
    game.scene.add(puddle);
    // The sign stands at the edge of the puddle
    const a = Math.random() * Math.PI * 2;
    const sx = x + Math.cos(a) * (r + 0.45);
    const sz = z + Math.sin(a) * (r + 0.45);
    createSign(game, new THREE.Vector3(sx, floorHeightAt(sx, sz) + 0.02, sz), Math.random() * Math.PI * 2);
    spills.push({ x, y, z, r, liquid: liquid.name });
  }
  return spills;
}

// Is this point (feet, a wheel) standing in a spill?
export function onSpill(spills, p) {
  return !!spills?.some((s) => Math.abs(p.y - s.y) < 0.6 && Math.hypot(p.x - s.x, p.z - s.z) < s.r);
}
