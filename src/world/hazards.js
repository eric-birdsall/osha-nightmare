import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { COL } from '../physics.js';
import { boxMesh, flatMat, labelPlane } from '../util/meshes.js';
import { sfx } from '../systems/audio.js';
import { LAYOUT } from './layout.js';
import { addPuddle } from './spills.js';

// OSHA violations dotted round the building (placed in LAYOUT.hazards):
//  - an overloaded outlet with power strips daisy-chained off it, which shoots cartoon sparks
//  - an electrical panel with a leaking pipe dripping on it: it zaps, and its puddle is slippery
//  - unlabelled barrels leaking brightly coloured, slippery liquids; knock one over and it gushes
//  - fire exits blocked by junk
// (The missing section of railing is in level.js, where the railings are built.)

const YELLOW = 0xf5c518;

// A spot on a wall: { x, z } on its inside face, the turn `ry` that makes local +z point into the
// room and local x run along the wall.
function onWall(wall, at) {
  const { halfX, halfZ } = LAYOUT.room;
  return {
    north: { x: at, z: -halfZ, ry: 0 },
    south: { x: at, z: halfZ, ry: Math.PI },
    west: { x: -halfX, z: at, ry: Math.PI / 2 },
    east: { x: halfX, z: at, ry: -Math.PI / 2 },
  }[wall];
}

// A group standing on a wall at floor height y (local x along the wall, +z into the room)
function wallGroup(game, wall, at, y = 0) {
  const w = onWall(wall, at);
  const g = new THREE.Group();
  g.position.set(w.x, y, w.z);
  g.rotation.y = w.ry;
  game.scene.add(g);
  g.updateMatrixWorld(true);
  return g;
}

// A static collider for a box in a wall group's local frame
function solidIn(game, g, size, pos) {
  const p = g.localToWorld(new THREE.Vector3(...pos));
  const ry = g.rotation.y;
  game.world.createCollider(
    RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2)
      .setTranslation(p.x, p.y, p.z)
      .setRotation({ x: 0, y: Math.sin(ry / 2), z: 0, w: Math.cos(ry / 2) })
      .setFriction(0.8)
      .setCollisionGroups(COL.static),
    game.staticBody,
  );
}

function put(parent, mesh, x, y, z) {
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Where each hazard is, for incident reports and keeping random spills off them: [{ name, x, z, r }]
export function hazardZones() {
  const hz = LAYOUT.hazards;
  const wallSpot = (h, out) => {
    const w = onWall(h.wall, h.at);
    const n = new THREE.Vector3(0, 0, out).applyAxisAngle(new THREE.Vector3(0, 1, 0), w.ry);
    return { x: w.x + n.x, z: w.z + n.z };
  };
  const gap = hz.railingGap;
  return [
    { name: 'The overloaded outlet', ...wallSpot(hz.outlet, 1.2), r: 1.8 },
    { name: 'The leaking electrical panel', ...wallSpot(hz.panel, 1.0), r: 2.0 },
    { name: 'The missing railing', x: (gap.from + gap.to) / 2, z: gap.line, r: (gap.to - gap.from) / 2 + 0.8 },
    { name: 'The mystery barrels', x: hz.barrels.x + 0.4, z: hz.barrels.z, r: 2.2 },
    ...hz.fireExits.map((e) => ({ name: 'The blocked fire exit', ...wallSpot(e, 0.9), r: 1.8 })),
  ];
}

// A pool of little additive sprites for cartoon spark bursts.
class Sparks {
  constructor(scene, n = 80) {
    // A soft round glow for each spark
    const dot = canvasTexture(32, 32, (g) => {
      const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.35, 'rgba(255,255,255,0.8)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 32, 32);
    });
    this.pool = Array.from({ length: n }, () => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: 0xffd040, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      s.visible = false;
      scene.add(s);
      return { s, life: 0, max: 1, vel: new THREE.Vector3() };
    });
    this.next = 0;
    // A cartoon "zap" star flashed at the source
    const star = canvasTexture(128, 128, (g) => {
      g.translate(64, 64);
      g.fillStyle = '#fff6a0';
      g.beginPath();
      for (let i = 0; i < 16; i++) {
        const r = i % 2 ? 22 : 62;
        const a = (i / 16) * Math.PI * 2;
        g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.fill();
    });
    this.stars = [];
    this.starTex = star;
    this.scene = scene;
  }

  // A star at `at`, and n sparks flying out round `dir` (a unit vector)
  burst(at, dir, n = 18) {
    for (let i = 0; i < n; i++) {
      const p = this.pool[this.next];
      this.next = (this.next + 1) % this.pool.length;
      p.life = p.max = 0.35 + Math.random() * 0.4;
      p.s.visible = true;
      p.s.position.copy(at);
      p.s.scale.setScalar(0.08 + Math.random() * 0.06);
      p.vel.set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).multiplyScalar(3).addScaledVector(dir, 2 + Math.random() * 2);
    }
    let star = this.stars.find((s) => !s.s.visible);
    if (!star) {
      star = { s: new THREE.Sprite(new THREE.SpriteMaterial({ map: this.starTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })), life: 0 };
      this.scene.add(star.s);
      this.stars.push(star);
    }
    star.s.visible = true;
    star.s.position.copy(at);
    star.s.material.rotation = Math.random() * Math.PI;
    star.life = 0.18;
  }

  update(dt) {
    for (const p of this.pool) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.vel.y -= 9.8 * dt;
      p.s.position.addScaledVector(p.vel, dt);
      const k = Math.max(0, p.life / p.max);
      p.s.material.opacity = k;
      p.s.material.color.setHex(k > 0.5 ? 0xfff2a0 : 0xff9a1f);
      if (p.life <= 0) p.s.visible = false;
    }
    for (const st of this.stars) {
      if (!st.s.visible) continue;
      st.life -= dt;
      st.s.scale.setScalar(0.3 + (0.18 - st.life) * 4);
      st.s.material.opacity = Math.max(0, st.life / 0.18);
      if (st.life <= 0) st.s.visible = false;
    }
  }
}

// ---------------------------------------------------------------- the overloaded outlet

function buildOutlet(game, sparks) {
  const { wall, at } = LAYOUT.hazards.outlet;
  const g = wallGroup(game, wall, at);
  // Scorched wall round a twin outlet with cube taps stacked in it
  const scorch = new THREE.Mesh(
    new THREE.PlaneGeometry(0.7, 0.7),
    new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      map: canvasTexture(128, 128, (c) => {
        const grad = c.createRadialGradient(64, 64, 4, 64, 64, 64);
        grad.addColorStop(0, 'rgba(20,16,12,0.85)');
        grad.addColorStop(1, 'rgba(20,16,12,0)');
        c.fillStyle = grad;
        c.fillRect(0, 0, 128, 128);
      }),
    }),
  );
  put(g, scorch, 0, 0.5, 0.012);
  put(g, boxMesh(0.12, 0.2, 0.02, 0xf4f1e8, { edges: false }), 0, 0.42, 0.015);
  put(g, boxMesh(0.09, 0.09, 0.08, 0xf4f1e8, { edges: false }), 0, 0.44, 0.06);
  put(g, boxMesh(0.09, 0.09, 0.08, 0xd9d4c4, { edges: false }), 0.04, 0.47, 0.13).rotation.z = 0.3;
  const sign = labelPlane('DO NOT UNPLUG!!', 0.7, 0.16, { bg: '#fffbe6', fg: '#d0141b' });
  put(g, sign, 0, 0.82, 0.014).rotation.z = -0.08;
  // Cords down to a chain of power strips on the floor, and from those off to the packing stations
  const cord = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const c = boxMesh(0.02, 0.012, len, 0x16171a, { edges: false, shadows: false });
    c.position.set((x0 + x1) / 2, 0.008, (z0 + z1) / 2);
    c.rotation.y = Math.atan2(x1 - x0, z1 - z0);
    g.add(c);
  };
  put(g, boxMesh(0.02, 0.4, 0.02, 0x16171a, { edges: false }), 0.02, 0.22, 0.12);
  const strips = [[0.25, 0.5, 0.4], [-0.35, 1.3, -0.5], [0.4, 2.2, 0.2]];
  let [px, pz] = [0.02, 0.12];
  for (const [sx, sz, ry] of strips) {
    cord(px, pz, sx, sz);
    const s = put(g, boxMesh(0.45, 0.05, 0.08, 0xf4f1e8, { edges: false }), sx, 0.025, sz);
    s.rotation.y = ry;
    put(g, boxMesh(0.04, 0.03, 0.03, 0xd0141b, { edges: false }), sx, 0.06, sz);
    [px, pz] = [sx, sz];
  }
  for (const [x1, z1] of [[-2.5, 5.6], [-0.8, 5.8], [1.2, 5.7], [3.0, 5.5], [5.4, 5.8]]) cord(0.4, 2.2, x1, z1);
  // Sparks: every few seconds, out of the outlet
  const at3 = g.localToWorld(new THREE.Vector3(0, 0.45, 0.12));
  const out = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), g.rotation.y);
  const light = new THREE.PointLight(0xffc040, 0, 4);
  light.position.copy(at3);
  game.scene.add(light);
  let next = 2 + Math.random() * 3;
  let flash = 0;
  return (dt, loud) => {
    next -= dt;
    if (next <= 0) {
      next = 2.5 + Math.random() * 5;
      sparks.burst(at3, out, 22);
      flash = 0.2;
      const v = loud(at3);
      if (v > 0) sfx.zap(v);
    }
    flash = Math.max(0, flash - dt);
    light.intensity = flash * 15;
  };
}

// ---------------------------------------------------------------- the electrical waterfall

function buildPanel(game, sparks) {
  const { wall, at } = LAYOUT.hazards.panel;
  const g = wallGroup(game, wall, at);
  // The panel, its DANGER sign, and conduits up the wall
  put(g, boxMesh(0.9, 1.2, 0.25, 0x9aa0a8), 0, 1.5, 0.125);
  put(g, boxMesh(0.02, 1.1, 0.01, 0x6b7280, { edges: false }), 0, 1.5, 0.255);
  const danger = new THREE.Mesh(
    new THREE.PlaneGeometry(0.6, 0.3),
    new THREE.MeshBasicMaterial({
      map: canvasTexture(256, 128, (c, w, h) => {
        c.fillStyle = '#f5c518';
        c.fillRect(0, 0, w, h);
        c.fillStyle = '#16171a';
        c.fillRect(0, 0, w, 38);
        c.fillStyle = '#f5c518';
        c.font = 'bold 28px system-ui, sans-serif';
        c.textAlign = 'center';
        c.fillText('⚡ DANGER ⚡', w / 2, 29);
        c.fillStyle = '#16171a';
        c.font = 'bold 30px system-ui, sans-serif';
        c.fillText('HIGH VOLTAGE', w / 2, 82);
        c.font = 'bold 18px system-ui, sans-serif';
        c.fillText('KEEP DRY', w / 2, 112);
      }),
    }),
  );
  put(g, danger, -0.18, 1.78, 0.257);
  for (const x of [-0.25, 0.25]) put(g, boxMesh(0.05, 1.2, 0.05, 0x8a9099, { edges: false }), x, 2.7, 0.1);
  solidIn(game, g, [0.9, 1.2, 0.25], [0, 1.5, 0.125]);
  // The water pipe along the wall over it, with a duct-taped joint right above the panel
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 9, 14), flatMat(0x7d9db3));
  pipe.rotation.z = Math.PI / 2;
  put(g, pipe, 0, 3.4, 0.3);
  const joint = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.22, 14), flatMat(0xb8bcc2));
  joint.rotation.z = Math.PI / 2;
  put(g, joint, 0.1, 3.4, 0.3);
  // Water streaking down the front of the panel
  const wet = new THREE.MeshBasicMaterial({ color: 0x8fc8ff, transparent: true, opacity: 0.45, depthWrite: false });
  put(g, new THREE.Mesh(new THREE.PlaneGeometry(0.1, 1.15), wet), 0.12, 1.5, 0.258);
  // ...and the puddle it makes: properly slippery
  const pp = g.localToWorld(new THREE.Vector3(0.1, 0, 0.9));
  const puddle = addPuddle(game, { x: pp.x, y: 0, z: pp.z, r: 1.1, liquid: { name: 'water', color: '#4f86b0', alpha: 0.55 } });
  // A bucket nearby, catching none of it
  const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.13, 0.3, 14), flatMat(YELLOW));
  put(g, bucket, 0.9, 0.15, 0.45);
  // Drips: from the joint onto the panel top, and off the bottom of the panel to the floor
  const dripMat = new THREE.SpriteMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.9, depthWrite: false });
  const drops = [
    { from: g.localToWorld(new THREE.Vector3(0.1, 3.3, 0.3)), to: 2.1, every: 0.45, zaps: true },
    { from: g.localToWorld(new THREE.Vector3(0.12, 0.88, 0.27)), to: 0.02, every: 0.6, zaps: false },
  ].map((d) => {
    const s = new THREE.Sprite(dripMat);
    s.scale.set(0.035, 0.06, 1);
    s.position.copy(d.from);
    game.scene.add(s);
    return { ...d, s, vy: 0, t: Math.random() * d.every };
  });
  const top = g.localToWorld(new THREE.Vector3(0.1, 2.12, 0.15));
  const out = new THREE.Vector3(0, 0.5, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), g.rotation.y).normalize();
  const light = new THREE.PointLight(0x9fd0ff, 0, 5);
  light.position.copy(top);
  game.scene.add(light);
  let flash = 0;
  let zapIn = 3;
  const update = (dt, loud) => {
    zapIn -= dt;
    for (const d of drops) {
      if (d.t > 0) {
        d.t -= dt;
        d.s.visible = false;
        continue;
      }
      d.s.visible = true;
      d.vy -= 9.8 * dt;
      d.s.position.y += d.vy * dt;
      if (d.s.position.y > d.to) continue;
      // Landed: start the next one
      d.s.position.copy(d.from);
      d.vy = 0;
      d.t = d.every * (0.7 + Math.random() * 0.6);
      if (d.zaps && zapIn <= 0 && Math.random() < 0.35) {
        zapIn = 1.5;
        sparks.burst(top, out, 26);
        flash = 0.25;
        const v = loud(top);
        if (v > 0) sfx.zap(v);
      } else if (!d.zaps) {
        const v = loud(d.from) * 0.6;
        if (v > 0.3) sfx.drip(v);
      }
    }
    flash = Math.max(0, flash - dt);
    light.intensity = flash * 20;
  };
  return { update, puddle };
}

// ---------------------------------------------------------------- mystery barrels

const MYSTERY = [
  { name: 'mystery (green)', color: '#7dff3a', alpha: 0.8 },
  { name: 'mystery (pink)', color: '#ff3ad1', alpha: 0.75 },
  { name: 'mystery (orange)', color: '#ff8c1a', alpha: 0.8 },
  { name: 'mystery (blue)', color: '#3ae8ff', alpha: 0.75 },
  { name: 'mystery (purple)', color: '#9a4dff', alpha: 0.8 },
];
const DRUMS = [0x2f5fb3, 0x9a4b23, 0x2f6b3a, 0x6b7280, 0x23262b];
const R = 0.29;
const HALF_H = 0.44;

function barrelMesh(color, liquid, mark) {
  const g = new THREE.Group();
  const mat = flatMat(color);
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(R, R, HALF_H * 2, 20), mat);
  drum.castShadow = drum.receiveShadow = true;
  g.add(drum);
  for (const y of [-0.15, 0.15, -HALF_H + 0.02, HALF_H - 0.02]) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(R + 0.005, 0.015, 6, 24), mat);
    rib.rotation.x = Math.PI / 2;
    rib.position.y = y;
    g.add(rib);
  }
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.02, R - 0.02, 0.01, 20), flatMat(0x16171a));
  lid.position.y = HALF_H + 0.003;
  g.add(lid);
  if (mark) {
    // A hand-sprayed question mark: no label, no idea
    const q = labelPlane('???', 0.32, 0.2, { bg: 'rgba(0,0,0,0)', fg: '#f4f1e8', transparent: true });
    q.position.set(0, 0.05, R + 0.004);
    g.add(q);
  }
  // A thin stream leaking out of a hole near the bottom, down to the floor
  const stream = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.26, 0.03), new THREE.MeshBasicMaterial({ color: liquid.color, transparent: true, opacity: 0.85 }));
  stream.position.set(0, -HALF_H + 0.13, R + 0.02);
  g.add(stream);
  g.userData.stream = stream;
  return g;
}

function buildBarrels(game) {
  const { x, z, y } = LAYOUT.hazards.barrels;
  const spots = [[0, 0], [0.66, 0.12], [0.2, 0.64], [0.12, -0.66], [0.78, -0.52]];
  const barrels = [];
  const puddles = [];
  spots.forEach(([dx, dz], i) => {
    const liquid = MYSTERY[i % MYSTERY.length];
    const mesh = barrelMesh(DRUMS[i % DRUMS.length], liquid, i % 2 === 0);
    // Leak toward the room (east), turned a little each
    const yaw = Math.PI / 2 + (Math.random() - 0.5) * 0.8;
    const body = game.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x + dx, y + HALF_H + 0.01, z + dz)
        .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
        .setCanSleep(true),
    );
    game.world.createCollider(RAPIER.ColliderDesc.cylinder(HALF_H, R).setMass(90).setFriction(0.6).setCollisionGroups(COL.dyn), body);
    game.scene.add(mesh);
    const ent = { kind: 'barrel', body, mesh, mass: 90, liquid, gushed: false };
    game.addEntity(ent);
    barrels.push(ent);
    // The puddle each one has made already, in front of its leak
    const px = x + dx + Math.sin(yaw) * 0.75;
    const pz = z + dz + Math.cos(yaw) * 0.75;
    puddles.push(addPuddle(game, { x: px, y, z: pz, r: 0.45 + Math.random() * 0.35, liquid }));
  });
  return { barrels, puddles };
}

// ---------------------------------------------------------------- blocked fire exits

function buildFireExit(game, { wall, at, y }) {
  const g = wallGroup(game, wall, at, y);
  // Door in its frame, with a push bar and a KEEP CLEAR sign
  put(g, boxMesh(1.2, 2.3, 0.05, 0x3c4249, { edges: false }), 0, 1.15, 0.025);
  put(g, boxMesh(1.0, 2.15, 0.04, 0x8c2b2b), 0, 1.08, 0.06);
  put(g, boxMesh(0.8, 0.06, 0.06, 0xc9ced6, { edges: false }), 0, 1.0, 0.11);
  const keep = labelPlane('FIRE EXIT · KEEP CLEAR', 0.86, 0.17, { bg: '#ffffff', fg: '#d0141b' });
  put(g, keep, 0, 2.0, 0.082); // just showing over the junk
  // Lit EXIT sign over it
  put(g, boxMesh(0.55, 0.24, 0.08, 0xf4f4f4, { edges: false }), 0, 2.55, 0.04);
  const exit = labelPlane('EXIT ➜', 0.5, 0.2, { bg: '#0f8a3c', fg: '#ffffff' });
  put(g, exit, 0, 2.55, 0.082);
  // ...blocked by a pile of junk: pallets, boxes, and a sheet of plywood leaning on the door
  const card = 0xc49a6c;
  for (let k = 0; k < 3; k++) put(g, boxMesh(1.2, 0.14, 1.0, 0x9a7650), -0.15, 0.07 + k * 0.15, 0.85).rotation.y = (k - 1) * 0.06;
  put(g, boxMesh(0.6, 0.5, 0.5, card), -0.4, 0.7, 0.75).rotation.y = 0.2;
  put(g, boxMesh(0.5, 0.45, 0.45, card), 0.15, 0.68, 0.95).rotation.y = -0.15;
  put(g, boxMesh(0.45, 0.4, 0.4, 0xb08a5a), -0.15, 1.13, 0.8).rotation.y = 0.4;
  put(g, boxMesh(0.5, 1.5, 0.5, card), 0.75, 0.75, 0.5);
  put(g, boxMesh(0.4, 0.4, 0.4, 0xb08a5a), 0.75, 1.7, 0.5).rotation.y = 0.3;
  const ply = put(g, boxMesh(1.1, 1.9, 0.03, 0xd8b98a), 0.05, 0.92, 0.3);
  ply.rotation.x = -0.12;
  solidIn(game, g, [1.9, 1.6, 1.4], [0.15, 0.8, 0.75]);
}

// Builds them all. Returns { spills, update(dt, listeners) }: spills to add to the level's, and a
// per-frame update; listeners are the camera positions that hear the sparks.
export function buildHazards(game, { floorHeightAt }) {
  const sparks = new Sparks(game.scene);
  const outlet = buildOutlet(game, sparks);
  const panel = buildPanel(game, sparks);
  const { barrels, puddles } = buildBarrels(game);
  for (const e of LAYOUT.hazards.fireExits) buildFireExit(game, e);
  const up = new THREE.Vector3();
  let listeners = [];
  // 0..1: how loud something at p is for the nearest listener
  const loud = (p) => Math.max(0, ...listeners.map((l) => 1 - l.distanceTo(p) / 16));
  return {
    spills: [panel.puddle, ...puddles],
    update(dt, ears) {
      listeners = ears;
      outlet(dt, loud);
      panel.update(dt, loud);
      sparks.update(dt);
      // A barrel knocked over gushes the rest of its contents where it lands
      for (const b of barrels) {
        if (b.gushed || b.removed) continue;
        up.set(0, 1, 0).applyQuaternion(b.body.rotation());
        if (up.y > 0.4 || b.body.linvel().y < -0.5) continue;
        b.gushed = true;
        b.mesh.userData.stream.visible = false;
        const t = b.body.translation();
        game.level.spills.push(addPuddle(game, { x: t.x, y: floorHeightAt(t.x, t.z), z: t.z, r: 1.0, liquid: b.liquid }));
      }
    },
  };
}
