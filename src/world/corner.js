import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { COL } from '../physics.js';
import { boxMesh, flatMat } from '../util/meshes.js';
import { LAYOUT } from './layout.js';

// The north-east corner of the upper floor, along the north wall from west to east: the
// supervisor's office, the safety station, the propane cage and the forklift parking bay.
// Everything here is static set dressing except the Employee of the Month board (updated by the
// game) and the propane cage (which a nearby blast can set off).

const NORTH = -LAYOUT.room.halfZ; // inside face of the north wall

// A canvas-textured plane: draw(g, w, h) paints it.
function canvasPlane(w, h, px, draw) {
  const c = document.createElement('canvas');
  c.width = px;
  c.height = Math.round((px * h) / w);
  const g = c.getContext('2d');
  draw(g, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
  mesh.userData.redraw = (fn) => {
    fn(g, c.width, c.height);
    tex.needsUpdate = true;
  };
  return mesh;
}

// A solid box: collider plus mesh. shadows: casts and catches shadows.
function solid(game, size, pos, color, { mesh = true, shadows = true, edges = true } = {}) {
  game.world.createCollider(
    RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2).setTranslation(...pos).setFriction(0.8).setCollisionGroups(COL.static),
    game.staticBody,
  );
  if (!mesh) return null;
  const m = boxMesh(...size, color, { edges, shadows });
  m.position.set(...pos);
  game.scene.add(m);
  return m;
}

function deco(game, size, pos, color, opts = {}) {
  const m = boxMesh(...size, color, { edges: false, shadows: false, ...opts });
  m.position.set(...pos);
  game.scene.add(m);
  return m;
}

function onWall(game, mesh, x, y, z = NORTH + 0.02) {
  mesh.position.set(x, y, z);
  game.scene.add(mesh);
  return mesh;
}

function signText(g, w, h, { bg, fg, lines, border }) {
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  if (border) {
    g.strokeStyle = border;
    g.lineWidth = Math.max(4, w * 0.02);
    g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, w - g.lineWidth, h - g.lineWidth);
  }
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach(([text, size, y]) => {
    g.font = `bold ${Math.round(size * h)}px system-ui, sans-serif`;
    g.fillText(text, w / 2, y * h, w * 0.92);
  });
}

// ---------------------------------------------------------------- supervisor's office

function buildOffice(game) {
  const { x0, x1, depth, height: H } = LAYOUT.corner.office;
  const z1 = NORTH + depth; // front of the booth
  const wall = 0xd9dde2;
  const trim = 0x2b2f35;
  const glass = new THREE.MeshLambertMaterial({ color: 0x9fd2ff, transparent: true, opacity: 0.3, depthWrite: false });
  const glassPane = (w, h, x, y, z, ry = 0) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glass);
    p.position.set(x, y, z);
    p.rotation.y = ry;
    game.scene.add(p);
  };
  // Side walls: solid below the windows, glass above, posts at the corners
  for (const x of [x0, x1]) {
    game.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.05, H / 2, depth / 2).setTranslation(x, H / 2, NORTH + depth / 2).setCollisionGroups(COL.static),
      game.staticBody,
    );
    deco(game, [0.1, 1.0, depth], [x, 0.5, NORTH + depth / 2], wall, { shadows: true });
    deco(game, [0.1, 0.5, depth], [x, H - 0.25, NORTH + depth / 2], wall);
    glassPane(depth, H - 1.5, x, 1.0 + (H - 1.5) / 2, NORTH + depth / 2, Math.PI / 2);
  }
  // Front wall with a door gap and a long window
  const doorA = x0 + 2.0;
  const doorB = x0 + 3.1;
  for (const [a, b] of [[x0, doorA], [doorB, x1]]) {
    const w = b - a;
    game.world.createCollider(
      RAPIER.ColliderDesc.cuboid(w / 2, H / 2, 0.05).setTranslation((a + b) / 2, H / 2, z1).setCollisionGroups(COL.static),
      game.staticBody,
    );
    deco(game, [w, 1.0, 0.1], [(a + b) / 2, 0.5, z1], wall, { shadows: true });
    deco(game, [w, 0.5, 0.1], [(a + b) / 2, H - 0.25, z1], wall);
    glassPane(w, H - 1.5, (a + b) / 2, 1.0 + (H - 1.5) / 2, z1);
  }
  // Header over the door
  deco(game, [doorB - doorA, 0.8, 0.1], [(doorA + doorB) / 2, H - 0.4, z1], wall);
  game.world.createCollider(
    RAPIER.ColliderDesc.cuboid((doorB - doorA) / 2, 0.4, 0.05).setTranslation((doorA + doorB) / 2, H - 0.4, z1).setCollisionGroups(COL.static),
    game.staticBody,
  );
  // Frame posts and roof (the roof catches no sun, or the office would be pitch black inside)
  for (const x of [x0, x1, doorA, doorB]) deco(game, [0.08, H, 0.1], [x, H / 2, z1], trim);
  solid(game, [x1 - x0 + 0.1, 0.12, depth + 0.1], [(x0 + x1) / 2, H + 0.06, NORTH + depth / 2], 0x8e949b, { shadows: false });
  // Sign over the door
  const sign = canvasPlane(2.2, 0.45, 512, (g, w, h) =>
    signText(g, w, h, { bg: '#1d3f80', fg: '#fff', border: '#fff', lines: [['SUPERVISOR', 0.62, 0.53]] }),
  );
  sign.position.set((doorA + doorB) / 2, H + 0.4, z1 + 0.06);
  game.scene.add(sign);

  // Inside: a desk with a monitor, a chair, and the overstuffed FORM 300s cabinet
  const desk = x0 + 2.0;
  solid(game, [1.6, 0.75, 0.75], [desk, 0.375, NORTH + 1.0], 0x8a6a48);
  deco(game, [0.55, 0.35, 0.05], [desk - 0.3, 0.98, NORTH + 0.85], 0x16171a); // monitor
  deco(game, [0.06, 0.2, 0.06], [desk - 0.3, 0.82, NORTH + 0.85], 0x16171a);
  deco(game, [0.45, 0.02, 0.15], [desk - 0.3, 0.76, NORTH + 1.15], 0x2b2f35); // keyboard
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.1, 12), flatMat(0xd02020));
  mug.position.set(desk + 0.5, 0.8, NORTH + 1.1);
  game.scene.add(mug);
  solid(game, [0.5, 0.5, 0.5], [desk, 0.25, NORTH + 1.75], 0x2b2f35); // chair seat
  deco(game, [0.5, 0.6, 0.08], [desk, 0.8, NORTH + 2.0], 0x2b2f35); // chair back
  // Filing cabinet: four drawers, every one jammed open with paper
  const cx = x1 - 0.65;
  solid(game, [0.6, 1.4, 0.65], [cx, 0.7, NORTH + 0.4], 0x8a9099);
  const paper = flatMat(0xf4f1e8);
  for (let i = 0; i < 4; i++) {
    const y = 0.2 + i * 0.34;
    deco(game, [0.56, 0.3, 0.12], [cx, y, NORTH + 0.8], 0x9aa0a8, { edges: true }); // drawer front, pulled out
    for (let k = 0; k < 5; k++) {
      const sheet = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.005, 0.3), paper);
      sheet.position.set(cx + (Math.random() - 0.5) * 0.12, y + 0.17 + k * 0.012, NORTH + 0.8 + (Math.random() - 0.3) * 0.1);
      sheet.rotation.set((Math.random() - 0.5) * 0.6, Math.random() * 0.8, (Math.random() - 0.5) * 0.5);
      game.scene.add(sheet);
    }
  }
  const label = canvasPlane(0.5, 0.12, 256, (g, w, h) => signText(g, w, h, { bg: '#f7f3e6', fg: '#b3261e', border: '#333', lines: [['FORM 300s', 0.7, 0.55]] }));
  label.position.set(cx, 1.47, NORTH + 0.73);
  game.scene.add(label);
  // ...and the overflow piled on top and on the floor
  for (let k = 0; k < 14; k++) {
    const sheet = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.01, 0.22), paper);
    const onTop = k < 8;
    sheet.position.set(cx + (Math.random() - 0.5) * (onTop ? 0.3 : 1.2), onTop ? 1.41 + k * 0.02 : 0.01, NORTH + (onTop ? 0.4 : 1.1 + Math.random() * 1.2));
    sheet.rotation.set(0, Math.random() * Math.PI, 0);
    game.scene.add(sheet);
  }
}

// ---------------------------------------------------------------- safety station

function buildSafety(game) {
  const { x0, x1 } = LAYOUT.corner.safety;
  // A strip you can't walk into, so nothing clips through the wall-mounted kit
  game.world.createCollider(
    RAPIER.ColliderDesc.cuboid((x1 - x0) / 2, 1.2, 0.2).setTranslation((x0 + x1) / 2, 1.2, NORTH + 0.2).setCollisionGroups(COL.static),
    game.staticBody,
  );
  // Painted green safety area on the floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, 1.6), new THREE.MeshBasicMaterial({ color: 0x1a7f37, transparent: true, opacity: 0.35 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((x0 + x1) / 2, 0.006, NORTH + 0.8);
  game.scene.add(floor);
  // OSHA RULES poster board
  onWall(
    game,
    canvasPlane(1.4, 1.0, 512, (g, w, h) => {
      signText(g, w, h, { bg: '#fffbe6', fg: '#111', border: '#1a7f37', lines: [['OSHA RULES', 0.13, 0.12]] });
      g.font = `${Math.round(h * 0.062)}px system-ui, sans-serif`;
      g.textAlign = 'left';
      ['1. Wear your hard hat.', '2. No riding on the forks.', '3. No jumping off ladders.', '4. FRAGILE means FRAGILE.', '5. Do not tip the forklift.', '6. See rules 1-5, Dave.'].forEach((t, i) =>
        g.fillText(t, w * 0.07, h * (0.3 + i * 0.11)),
      );
    }),
    x0 + 2.15,
    1.9,
  );
  // Employee of the Month (the game changes the name after incidents)
  const eotm = canvasPlane(1.0, 1.0, 512, () => {});
  onWall(game, eotm, x0 + 3.5, 1.9);
  const drawEotm = (name) =>
    eotm.userData.redraw((g, w, h) => {
      g.fillStyle = '#7b5a2e';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#fffbe6';
      g.fillRect(w * 0.05, h * 0.05, w * 0.9, h * 0.9);
      g.fillStyle = '#111';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `bold ${Math.round(h * 0.085)}px system-ui, sans-serif`;
      g.fillText('EMPLOYEE OF', w / 2, h * 0.14);
      g.fillText('THE MONTH', w / 2, h * 0.24);
      // Portrait: hard hat, face, hi-vis
      const cx = w / 2;
      const cy = h * 0.52;
      g.fillStyle = '#ff7a1a';
      g.fillRect(cx - w * 0.17, cy + h * 0.1, w * 0.34, h * 0.14);
      g.fillStyle = '#d9a46c';
      g.beginPath();
      g.arc(cx, cy, w * (name === 'Ralph' ? 0.13 : 0.11), 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#f5c518';
      g.beginPath();
      g.arc(cx, cy - h * 0.05, w * 0.13, Math.PI, 0);
      g.fill();
      g.fillStyle = '#111';
      g.fillRect(cx - w * 0.05, cy, w * 0.02, h * 0.02);
      g.fillRect(cx + w * 0.03, cy, w * 0.02, h * 0.02);
      g.fillRect(cx - w * 0.04, cy + h * 0.05, w * 0.08, h * 0.01);
      g.font = `bold ${Math.round(h * 0.11)}px system-ui, sans-serif`;
      g.fillStyle = '#b3261e';
      g.fillText(name.toUpperCase(), w / 2, h * 0.86);
    });
  drawEotm('Ralph');
  // First-aid cabinet
  onWall(game, canvasPlane(0.5, 0.5, 256, (g, w, h) => {
    signText(g, w, h, { bg: '#f4f4f4', fg: '#d0141b', border: '#999', lines: [['FIRST AID', 0.13, 0.85]] });
    g.fillStyle = '#d0141b';
    g.fillRect(w * 0.4, h * 0.15, w * 0.2, h * 0.55);
    g.fillRect(w * 0.22, h * 0.32, w * 0.56, h * 0.2);
  }), x1 - 0.8, 1.6, NORTH + 0.13);
  deco(game, [0.5, 0.5, 0.12], [x1 - 0.8, 1.6, NORTH + 0.06], 0xe6e6e6);
  // AED
  deco(game, [0.38, 0.42, 0.14], [x1 - 0.22, 1.5, NORTH + 0.07], 0x1a9a4a);
  onWall(game, canvasPlane(0.32, 0.34, 256, (g, w, h) => {
    signText(g, w, h, { bg: '#1a9a4a', fg: '#fff', lines: [['AED', 0.3, 0.75]] });
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(w * 0.38, h * 0.32, w * 0.12, 0, Math.PI * 2);
    g.arc(w * 0.62, h * 0.32, w * 0.12, 0, Math.PI * 2);
    g.moveTo(w * 0.27, h * 0.38);
    g.lineTo(w * 0.5, h * 0.6);
    g.lineTo(w * 0.73, h * 0.38);
    g.fill();
  }), x1 - 0.22, 1.5, NORTH + 0.145);
  // Eyewash station: a yellow pipe up the wall to two green spray heads
  const eye = x0 + 1.05;
  deco(game, [0.06, 1.0, 0.06], [eye, 0.5, NORTH + 0.2], 0xf5c518);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.12, 0.12, 16), flatMat(0xf5c518));
  bowl.position.set(eye, 1.0, NORTH + 0.3);
  game.scene.add(bowl);
  for (const dx of [-0.07, 0.07]) {
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.06, 10), flatMat(0x1a9a4a));
    head.position.set(eye + dx, 1.08, NORTH + 0.3);
    game.scene.add(head);
  }
  onWall(game, canvasPlane(0.5, 0.25, 256, (g, w, h) => signText(g, w, h, { bg: '#1a9a4a', fg: '#fff', lines: [['EYE WASH', 0.45, 0.55]] })), eye, 1.55);
  // Fire extinguishers on brackets, with their signs
  for (const x of [x0 + 0.3, x0 + 4.35]) {
    const ext = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.5, 14), flatMat(0xd0141b));
    ext.position.set(x, 1.0, NORTH + 0.15);
    const nozzle = boxMesh(0.12, 0.08, 0.06, 0x16171a, { edges: false, shadows: false });
    nozzle.position.set(x, 1.3, NORTH + 0.15);
    game.scene.add(ext, nozzle);
    onWall(game, canvasPlane(0.35, 0.35, 256, (g, w, h) => signText(g, w, h, { bg: '#d0141b', fg: '#fff', lines: [['FIRE', 0.26, 0.38], ['EXT.', 0.26, 0.66]] })), x, 1.75);
  }
  // Hard-hat rack: a bar with pegs and yellow hats
  deco(game, [1.0, 0.06, 0.06], [x0 + 2.15, 2.62, NORTH + 0.12], 0x2b2f35);
  for (let i = 0; i < 4; i++) {
    const hat = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), flatMat(i === 2 ? 0xffffff : 0xf5c518));
    hat.position.set(x0 + 1.75 + i * 0.27, 2.59, NORTH + 0.2);
    game.scene.add(hat);
  }
  return { setEmployee: drawEotm };
}

// ---------------------------------------------------------------- propane cage and parking

function buildPropane(game) {
  const { x: cx, w, d, h } = LAYOUT.corner.propane;
  const cz = NORTH + 0.15 + d / 2;
  solid(game, [w, h, d], [cx, h / 2, cz], 0, { mesh: false });
  // Yellow frame and wire-mesh panels
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) deco(game, [0.06, h, 0.06], [cx + (sx * w) / 2, h / 2, cz + (sz * d) / 2], 0xf5c518);
  for (const y of [0.05, h]) {
    deco(game, [w, 0.05, 0.05], [cx, y, cz + d / 2], 0xf5c518);
    deco(game, [0.05, 0.05, d], [cx - w / 2, y, cz], 0xf5c518);
    deco(game, [0.05, 0.05, d], [cx + w / 2, y, cz], 0xf5c518);
  }
  const meshMat = new THREE.MeshBasicMaterial({ color: 0x555a60, wireframe: true, transparent: true, opacity: 0.5 });
  const panel = (pw, ph, x, z, ry) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph, Math.round(pw * 10), Math.round(ph * 10)), meshMat);
    p.position.set(x, h / 2, z);
    p.rotation.y = ry;
    game.scene.add(p);
  };
  panel(w, h, cx, cz + d / 2, 0);
  panel(d, h, cx - w / 2, cz, Math.PI / 2);
  panel(d, h, cx + w / 2, cz, Math.PI / 2);
  // Tanks inside: six forklift-size cylinders, two rows
  for (let i = 0; i < 6; i++) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.75, 16), flatMat(i % 3 === 1 ? 0xc0c6cc : 0xe8ebee));
    tank.position.set(cx - 0.5 + (i % 3) * 0.5, 0.38, cz - 0.3 + Math.floor(i / 3) * 0.55);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.1, 10), flatMat(0x8a9099));
    cap.position.set(tank.position.x, 0.8, tank.position.z);
    game.scene.add(tank, cap);
  }
  // PROPANE diamond and NO SMOKING sign on the front
  const sign = canvasPlane(0.6, 0.6, 256, (g, W, H) => {
    g.fillStyle = 'rgba(0,0,0,0)';
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#d0141b';
    g.beginPath();
    g.moveTo(W / 2, 4);
    g.lineTo(W - 4, H / 2);
    g.lineTo(W / 2, H - 4);
    g.lineTo(4, H / 2);
    g.fill();
    g.fillStyle = '#fff';
    g.font = `bold ${Math.round(H * 0.13)}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('PROPANE', W / 2, H * 0.45);
    g.font = `bold ${Math.round(H * 0.1)}px system-ui, sans-serif`;
    g.fillText('FLAMMABLE', W / 2, H * 0.6);
  });
  sign.material.transparent = true;
  sign.position.set(cx - 0.35, 1.25, cz + d / 2 + 0.02);
  game.scene.add(sign);
  const nosmoke = canvasPlane(0.45, 0.3, 256, (g, W, H) => signText(g, W, H, { bg: '#fff', fg: '#d0141b', border: '#d0141b', lines: [['NO SMOKING', 0.24, 0.5]] }));
  nosmoke.position.set(cx + 0.45, 1.25, cz + d / 2 + 0.02);
  game.scene.add(nosmoke);
  return { center: new THREE.Vector3(cx, 0.8, cz) };
}

function buildParking(game) {
  // Bay in the corner: 4 m wide, 5.4 m deep, the truck parks nose-out (facing south)
  const { x0, x1, depth } = LAYOUT.corner.parking;
  const z0 = NORTH + 0.2;
  const z1 = z0 + depth;
  const yellow = new THREE.MeshBasicMaterial({ color: 0xf5c518 });
  const line = (w, d, x, z) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), yellow);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.006, z);
    game.scene.add(m);
  };
  line(0.15, z1 - z0, x0, (z0 + z1) / 2);
  line(0.15, z1 - z0, x1, (z0 + z1) / 2);
  line(x1 - x0, 0.15, (x0 + x1) / 2, z0);
  // Hatching at the back of the bay
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 1.3), yellow);
    m.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
    m.position.set(x0 + 0.5 + i * 0.6, 0.006, z0 + 0.6);
    game.scene.add(m);
  }
  const text = canvasPlane(3.6, 0.9, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#f5c518';
    g.font = `bold ${Math.round(h * 0.42)}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('FORKLIFT', w / 2, h * 0.3);
    g.fillText('PARKING', w / 2, h * 0.75);
  });
  text.material.transparent = true;
  text.rotation.x = -Math.PI / 2;
  text.position.set((x0 + x1) / 2, 0.008, z1 - 0.8);
  game.scene.add(text);
  // Battery charger on the wall behind the bay, with its cable coiled on a hook
  const cx = (x0 + x1) / 2;
  solid(game, [0.8, 1.1, 0.4], [cx, 1.25, NORTH + 0.2], 0x2b2f35);
  onWall(game, canvasPlane(0.6, 0.3, 256, (g, w, h) => {
    signText(g, w, h, { bg: '#16171a', fg: '#7cf0a0', lines: [['CHARGING', 0.32, 0.38], ['● 87%', 0.28, 0.72]] });
  }), cx, 1.5, NORTH + 0.41);
  const coil = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.03, 8, 20), flatMat(0x111111));
  coil.position.set(cx + 0.6, 1.2, NORTH + 0.15);
  game.scene.add(coil);
  const sign = canvasPlane(1.6, 0.4, 512, (g, w, h) => signText(g, w, h, { bg: '#f5c518', fg: '#16171a', border: '#16171a', lines: [['FORKLIFT CHARGING', 0.5, 0.55]] }));
  onWall(game, sign, cx, 2.2);
  return { pos: new THREE.Vector3(cx, 0, z0 + 3.0), yaw: 0 };
}

export function buildCorner(game) {
  buildOffice(game);
  const safety = buildSafety(game);
  const propane = buildPropane(game);
  const parking = buildParking(game);
  return { safety, propane, parking };
}
