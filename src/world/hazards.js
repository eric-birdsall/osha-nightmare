import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { COL } from '../physics.js';
import { boxMesh, flatMat, labelPlane } from '../util/meshes.js';
import { sfx } from '../systems/audio.js';
import { LAYOUT } from './layout.js';
import { addPuddle } from './puddles.js';

// OSHA violations dotted round the building (placed in LAYOUT.hazards):
//  - an electrical panel with a leaking pipe dripping on it: it zaps, into a puddle on the floor
//  - fire exits enclosed in locked steel cages
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

// Where each hazard is, for incident reports: [{ name, x, z, r }]
export function hazardZones() {
  const hz = LAYOUT.hazards;
  const wallSpot = (h, out) => {
    const w = onWall(h.wall, h.at);
    const n = new THREE.Vector3(0, 0, out).applyAxisAngle(new THREE.Vector3(0, 1, 0), w.ry);
    return { x: w.x + n.x, z: w.z + n.z };
  };
  const gap = hz.railingGap;
  return [
    { name: 'The leaking electrical panel', ...wallSpot(hz.panel, 1.0), r: 2.0 },
    {
      name: 'The missing railing',
      ...(gap.along === 'z' ? { x: gap.line, z: (gap.from + gap.to) / 2 } : { x: (gap.from + gap.to) / 2, z: gap.line }),
      r: (gap.to - gap.from) / 2 + 0.8,
    },
    ...hz.fireExits.map((e) => ({ name: 'The blocked fire exit', ...wallSpot(e, 0.9), r: 1.8 })),
  ];
}

// A pool of little additive sprites for cartoon spark bursts.
export class Sparks {
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
  pipe.name = 'Leaking conveyor pipe';
  put(g, pipe, 0, 3.4, 0.3);
  const joint = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.22, 14), flatMat(0xb8bcc2));
  joint.rotation.z = Math.PI / 2;
  put(g, joint, 0.1, 3.4, 0.3);
  // Connected supply/return runs, risers and branches rather than a floating lone pipe.
  const pipeRun = (a, b, radius = 0.06, color = 0x7d9db3) => {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const axis = end.clone().sub(start);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, axis.length(), 12), flatMat(color));
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize());
    mesh.position.copy(start.add(end).multiplyScalar(0.5));
    g.add(mesh);
  };
  for (const h of [3.4, 4.0]) {
    if (h === 3.4) {
      pipeRun([-4.5, h, 0.3], [-4.5, 7.5, 0.3]);
      pipeRun([4.5, h, 0.3], [4.5, 7.5, 0.3]);
    }
    if (h !== 3.4) pipeRun([-4.5, h, 0.3], [4.5, h, 0.3]);
    for (const x of [-4.5, 4.5]) put(g, new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), flatMat(0x7d9db3)), x, h, 0.3);
    for (const x of [-3.6, -1.8, 1.8, 3.6]) {
      pipeRun([x, h, 0.3], [x + 0.13, h, 0.3], 0.09, 0x9aa0a8);
      put(g, boxMesh(0.07, 0.25, 0.32, 0x555f68, { edges: false }), x, h, 0.14);
    }
  }
  pipeRun([2.6, 4.0, 0.3], [2.6, 1.0, 0.3], 0.045);
  pipeRun([2.6, 1.0, 0.3], [4.5, 1.0, 0.3], 0.045);
  pipeRun([4.5, 1.0, 0.3], [4.5, 3.4, 0.3], 0.045);
  const valve = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 8, 16), flatMat(0xb53127));
  put(g, valve, 2.6, 2.5, 0.45);
  pipeRun([2.6, 2.5, 0.3], [2.6, 2.5, 0.45], 0.025, 0x9aa0a8);
  pipeRun([2.44, 2.5, 0.45], [2.76, 2.5, 0.45], 0.015, 0xb53127);
  // Water streaking down the front of the panel
  const wet = new THREE.MeshBasicMaterial({ color: 0x8fc8ff, transparent: true, opacity: 0.45, depthWrite: false });
  put(g, new THREE.Mesh(new THREE.PlaneGeometry(0.1, 1.15), wet), 0.12, 1.5, 0.258);
  // ...and the puddle it makes (just for looks: nothing's slippery)
  const pp = g.localToWorld(new THREE.Vector3(0.1, 0, 0.9));
  addPuddle(game, { x: pp.x, y: 0, z: pp.z, r: 1.1, liquid: { color: '#4f86b0', alpha: 0.55 } });
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
  return { update };
}

// ---------------------------------------------------------------- blocked fire exits

function buildFireExit(game, { wall, at, y, width: cageWidth = 2.8, depth: cageDepth = 2.0 }) {
  const g = wallGroup(game, wall, at, y);
  // Keep the caged exit beside the leaking panel rather than painting both on one spot.
  const door = new THREE.Group();
  const doorOffset = cageWidth > 3 ? 1.8 : 0;
  door.position.x = doorOffset;
  g.add(door);
  // Door in its frame, with a push bar and a KEEP CLEAR sign
  put(door, boxMesh(1.2, 2.3, 0.05, 0x3c4249, { edges: false }), 0, 1.15, 0.025);
  put(door, boxMesh(1.0, 2.15, 0.04, 0x8c2b2b), 0, 1.08, 0.06);
  put(door, boxMesh(0.8, 0.06, 0.06, 0xc9ced6, { edges: false }), 0, 1.0, 0.11);
  const keep = labelPlane('FIRE EXIT · KEEP CLEAR', 0.86, 0.17, { bg: '#ffffff', fg: '#d0141b' });
  put(door, keep, 0, 2.0, 0.082); // visible through the cage
  // Lit EXIT sign over it
  put(door, boxMesh(0.55, 0.24, 0.08, 0xf4f4f4, { edges: false }), 0, 2.55, 0.04);
  const exit = labelPlane('EXIT ➜', 0.5, 0.2, { bg: '#0f8a3c', fg: '#ffffff' });
  put(door, exit, 0, 2.55, 0.082);
  // A welded steel cage surrounds the door: barred front, side panels and a roof.
  // Continuous panel colliders prevent Dave or the forklift slipping through the bars.
  const steel = 0x555f68;
  const minX = -cageWidth / 2, maxX = cageWidth / 2;
  const width = cageWidth, midX = 0;
  const depth = cageDepth, height = 3.1;
  const bar = (w, h, d, x, y, z) => put(g, boxMesh(w, h, d, steel, { edges: false }), x, y, z);
  for (const x of [minX, maxX]) {
    for (const z of [0.08, depth]) bar(0.08, height, 0.08, x, height / 2, z);
    for (const h of [0.06, 1.4, height]) bar(0.06, 0.06, depth, x, h, depth / 2);
    for (let z = 0.2; z < depth; z += 0.16) bar(0.025, height, 0.025, x, height / 2, z);
    solidIn(game, g, [0.1, height, depth], [x, height / 2, depth / 2]);
  }
  for (const h of [0.06, 1.4, height]) bar(width, 0.06, 0.06, midX, h, depth);
  for (let x = minX + 0.16; x < maxX; x += 0.16) {
    bar(0.025, height, 0.025, x, height / 2, depth);
    bar(0.025, 0.025, depth, x, height, depth / 2);
  }
  solidIn(game, g, [width, height, 0.1], [midX, height / 2, depth]);
  solidIn(game, g, [width, 0.1, depth], [midX, height, depth / 2]);
  // A chained, padlocked front makes the lack of access clear.
  bar(0.07, height, 0.07, 0, height / 2, depth + 0.02);
  put(g, boxMesh(0.24, 0.04, 0.04, 0xc9ced6, { edges: false }), 0, 1.25, depth + 0.07);
  put(g, boxMesh(0.1, 0.13, 0.06, YELLOW), 0.05, 1.18, depth + 0.1);
  // Stored junk blocks the door inside the cage, staying below the KEEP CLEAR lettering.
  const wood = 0x9a7650;
  for (let layer = 0; layer < 3; layer++) {
    const bottom = layer * 0.16;
    for (const x of [-0.48, 0, 0.48]) put(g, boxMesh(0.12, 0.11, 0.9, wood), x - 0.1, bottom + 0.055, 0.85);
    for (let i = 0; i < 5; i++) put(g, boxMesh(0.2, 0.05, 0.95, 0xb38c55), -0.58 + i * 0.24, bottom + 0.135, 0.85);
  }
  const cartons = [
    [-0.38, 0.73, 0.65, 0.65, 0.5, 0.55, -0.12],
    [0.27, 0.78, 0.88, 0.55, 0.6, 0.6, 0.15],
    [-0.15, 1.23, 0.7, 0.5, 0.5, 0.5, -0.07],
    [0.87, 0.55, 0.55, 0.4, 1.1, 0.45, 0.05],
  ];
  for (const [x, h, z, w, dh, d, turn] of cartons) {
    const carton = put(g, boxMesh(w, dh, d, 0xc49a6c), x, h, z);
    carton.rotation.y = turn;
    put(carton, boxMesh(0.07, 0.008, d + 0.01, 0xdcc49a, { edges: false }), 0, dh / 2 + 0.005, 0);
  }
  const plywood = put(g, boxMesh(0.42, 1.55, 0.04, 0xd8b98a), -0.93, 0.8, 0.58);
  plywood.rotation.x = -0.14;
  solidIn(game, g, [2.3, 1.6, 1.25], [0, 0.8, 0.75]);
  if (cageWidth > 3) {
    // Fixed varied storage piles fill the corner without changing on every restart.
    let pile = 0;
    for (let x = minX + 0.7; x < maxX - 0.5; x += 1.25) {
      for (const z of [0.72, 2.3]) {
        // The original pile already occupies the space directly in front of the door.
        if (z < 1 && Math.abs(x - doorOffset) < .7) continue;
        const layers = 2 + pile % 4;
        const stack = new THREE.Group();
        stack.position.set(x, 0, z);
        stack.rotation.y = (pile % 3 - 1) * 0.09;
        g.add(stack);
        for (let layer = 0; layer < layers; layer++) {
          const bottom = layer * 0.16;
          for (const sx of [-0.45, 0, 0.45]) put(stack, boxMesh(0.12, 0.11, 0.9, wood), sx, bottom + 0.055, 0);
          for (let i = 0; i < 5; i++) put(stack, boxMesh(0.2, 0.05, 0.95, 0xb38c55), -0.48 + i * 0.24, bottom + 0.135, 0);
        }
        let top = layers * 0.16;
        const boxes = 1 + pile % 3;
        for (let n = 0; n < boxes; n++) {
          const h = 0.3 + ((pile + n) % 3) * 0.1;
          // Keep the center below the KEEP CLEAR sign's sightline.
          if (Math.abs(x - doorOffset) < 0.8 && top + h > 1.55) break;
          const d = 0.48 + (n % 2) * 0.16;
          const carton = put(stack, boxMesh(0.65 + (pile % 2) * 0.15, h, d, [0xc49a6c, 0xa88050, 0xd1ae79][(pile + n) % 3]), (n % 2 ? 0.1 : -0.1), top + h / 2, 0);
          carton.rotation.y = (n % 3 - 1) * 0.16;
          put(carton, boxMesh(0.07, 0.008, d + 0.01, 0xdcc49a, { edges: false }), 0, h / 2 + 0.005, 0);
          top += h;
        }
        solidIn(game, g, [1.15, top, 1.05], [x, top / 2, z]);
        pile++;
      }
    }
    const boards = put(g, boxMesh(0.65, 1.75, 0.1, 0x997347), minX + 0.4, 0.9, 1.35);
    boards.rotation.z = -0.16;
  }

}

// Builds them all. Returns { update(dt, listeners) }: a per-frame update; listeners are the
// camera positions that hear the sparks.
export function buildHazards(game) {
  const sparks = new Sparks(game.scene);
  const panel = buildPanel(game, sparks);
  for (const e of LAYOUT.hazards.fireExits) buildFireExit(game, e);
  let listeners = [];
  // 0..1: how loud something at p is for the nearest listener
  const loud = (p) => Math.max(0, ...listeners.map((l) => 1 - l.distanceTo(p) / 16));
  return {
    update(dt, ears) {
      listeners = ears;
      panel.update(dt, loud);
      sparks.update(dt);

    },
  };
}
