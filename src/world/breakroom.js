import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { COL } from '../physics.js';
import { boxMesh, flatMat, labelPlane } from '../util/meshes.js';
import { LAYOUT } from './layout.js';
import { prop } from './props.js';

function solid(game, size, pos) {
  game.world.createCollider(RAPIER.ColliderDesc.cuboid(...size.map(v => v / 2))
    .setTranslation(...pos).setFriction(0.8).setCollisionGroups(COL.static), game.staticBody);
}
function add(game, mesh, x, y, z) {
  mesh.position.set(x, y, z);
  game.scene.add(mesh);
  return mesh;
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

export function buildBreakRoom(game) {
  const { x0, x1, z0, z1 } = LAYOUT.breakRoom;
  const wallZ = z1; // south wall
  // A compact ground-floor break area, clear of the high-storage aisle
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), new THREE.MeshBasicMaterial({ color: 0xc9a46a, transparent: true, opacity: 0.18, depthWrite: false }));
  floor.rotation.x = -Math.PI / 2;
  add(game, floor, (x0 + x1) / 2, 0.004, (z0 + z1) / 2);
  add(game, labelPlane('BREAK ROOM', 2, 0.3, { bg: '#1a7f37', fg: '#ffffff' }), x0 + 3.5, 2.8, wallZ - 0.06).rotation.y = Math.PI;
  // Toilet doors on the south wall
  for (const [x, label, color] of [[x0 + 0.7, 'MEN', '#1d3f80'], [x0 + 1.8, 'WOMEN', '#9c1c5a']]) {
    add(game, boxMesh(0.95, 2.1, 0.05, 0x8e949b), x, 1.05, wallZ - 0.03);
    add(game, labelPlane(label, 0.6, 0.22, { bg: color, fg: '#ffffff' }), x, 1.75, wallZ - 0.06).rotation.y = Math.PI;
  }
  add(game, labelPlane('EMPLOYEES MUST WASH HANDS', 1.4, 0.18, { bg: '#ffffff', fg: '#16171a' }), x0 + 1.25, 2.35, wallZ - 0.03).rotation.y = Math.PI;
  // Water fountain, wall-mounted
  const fx = x0 + 2.7;
  solid(game, [0.55, 0.35, 0.45], [fx, 0.85, wallZ - 0.25]);
  add(game, boxMesh(0.55, 0.35, 0.45, 0xc9ced6), fx, 0.85, wallZ - 0.25);
  add(game, new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 8), flatMat(0x8a9099)), fx, 1.08, wallZ - 0.3);
  add(game, labelPlane('OUT OF ORDER', 0.5, 0.12, { bg: '#fffbe6', fg: '#d0141b' }), fx, 1.3, wallZ - 0.03).rotation.y = Math.PI;
  // Vending machines: heavy, top-heavy physics props facing north
  vending(game, x0 + 3.7, wallZ - 0.45, 'SNACKS', ['#e8532b', '#f5c518', '#31a24c', '#2f5fb3', '#9a4dff']);
  vending(game, x0 + 4.9, wallZ - 0.45, 'DRINKS', ['#d0141b', '#3ae8ff', '#f4f4f4', '#31d07a', '#ff8c1a']);
  // Table and two chairs
  const table = new THREE.Group();
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.04, 20), flatMat(0xe8e2d4));
  top.position.y = 0.74;
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.72, 8), flatMat(0x2b2f35));
  leg.position.y = 0.36;
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 16), flatMat(0x2b2f35));
  foot.position.y = 0.015;
  table.add(top, leg, foot);
  const tx = x0 + 2;
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
    prop(game, 'chair', chair, [tx + s * 0.85, 0.005, tz], (-s * Math.PI) / 2, [{ half: [0.21, 0.24, 0.21], pos: [0, 0.24, 0] }, { half: [0.21, 0.22, 0.02], pos: [0, 0.7, -0.2] }], 5);
  }
  // Counter with a microwave and a coffee maker
  const kx = x0 + 6;
  solid(game, [1.8, 0.9, 0.6], [kx, 0.45, wallZ - 0.3]);
  add(game, boxMesh(1.8, 0.9, 0.6, 0x9c7a55), kx, 0.45, wallZ - 0.3);
  add(game, boxMesh(0.5, 0.3, 0.38, 0xe6e6e6), kx - 0.4, 1.05, wallZ - 0.32);
  add(game, boxMesh(0.32, 0.22, 0.02, 0x16171a, { edges: false }), kx - 0.45, 1.05, wallZ - 0.52);
  add(game, boxMesh(0.25, 0.35, 0.25, 0x16171a), kx + 0.45, 1.08, wallZ - 0.3);
  add(game, labelPlane('CLEAN UP AFTER YOURSELF', 1.4, 0.18, { bg: '#fffbe6', fg: '#16171a' }), kx, 1.7, wallZ - 0.03).rotation.y = Math.PI;
  // A warm light over the break area
  const lamp = new THREE.PointLight(0xfff1d6, 6, 12);
  lamp.position.set((x0 + x1) / 2, 3.2, (z0 + z1) / 2);
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
