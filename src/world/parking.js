import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { COL } from '../physics.js';
import { boxMesh, flatMat } from '../util/meshes.js';
import { LAYOUT } from './layout.js';

// The forklift parking bay with its charger on the wall behind it: Ralph's start spot, and where
// the night shift drops a tipped forklift. Placed by LAYOUT.parking: its back against a wall, and
// the truck parked nose-out.

// The bay's frame: origin on the wall at the middle of the bay, local +z out into the room, local
// x along the wall. `ry` turns local into world (a truck facing out of the bay has yaw ry).
function frame() {
  const { wall, at, y } = LAYOUT.parking;
  const { halfX, halfZ } = LAYOUT.room;
  const f = {
    north: { x: at, z: -halfZ, ry: 0 },
    south: { x: at, z: halfZ, ry: Math.PI },
    west: { x: -halfX, z: at, ry: Math.PI / 2 },
    east: { x: halfX, z: at, ry: -Math.PI / 2 },
  }[wall];
  const toWorld = (lx, lz) => new THREE.Vector3(lx, 0, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), f.ry).add(new THREE.Vector3(f.x, y, f.z));
  return { ...f, y, toWorld };
}

// The bay's floor rectangle in world x/z: { x0, x1, z0, z1 }
export function parkingRect() {
  const { width, depth } = LAYOUT.parking;
  const { toWorld } = frame();
  const a = toWorld(-width / 2, 0.2);
  const b = toWorld(width / 2, 0.2 + depth);
  return { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z) };
}

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
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
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

// Returns the truck's spot in the bay: { pos, yaw } (parked nose-out).
export function buildParking(game) {
  const { width, depth } = LAYOUT.parking;
  const f = frame();
  // Everything is built in the bay's frame, in a group standing on the wall
  const g = new THREE.Group();
  g.position.set(f.x, f.y, f.z);
  g.rotation.y = f.ry;
  game.scene.add(g);
  const x0 = -width / 2;
  const x1 = width / 2;
  const z0 = 0.2;
  const z1 = z0 + depth;
  const yellow = new THREE.MeshBasicMaterial({ color: 0xf5c518 });
  const line = (w, d, x, z) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), yellow);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.006, z);
    g.add(m);
  };
  line(0.15, z1 - z0, x0, (z0 + z1) / 2);
  line(0.15, z1 - z0, x1, (z0 + z1) / 2);
  line(x1 - x0, 0.15, 0, z0);
  // Hatching at the back of the bay
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 1.3), yellow);
    m.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
    m.position.set(x0 + 0.5 + i * 0.6, 0.006, z0 + 0.6);
    g.add(m);
  }
  const text = canvasPlane(3.6, 0.9, 512, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = '#f5c518';
    c.font = `bold ${Math.round(h * 0.42)}px system-ui, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('FORKLIFT', w / 2, h * 0.3);
    c.fillText('PARKING', w / 2, h * 0.75);
  });
  text.material.transparent = true;
  text.rotation.x = -Math.PI / 2;
  text.position.set(0, 0.008, z1 - 0.8);
  g.add(text);
  // Battery charger on the wall behind the bay, with its cable coiled on a hook
  const charger = boxMesh(0.8, 1.1, 0.4, 0x2b2f35);
  charger.position.set(0, 1.25, 0.2);
  g.add(charger);
  const cw = f.toWorld(0, 0.2);
  game.world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.4, 0.55, 0.2)
      .setTranslation(cw.x, f.y + 1.25, cw.z)
      .setRotation({ x: 0, y: Math.sin(f.ry / 2), z: 0, w: Math.cos(f.ry / 2) })
      .setFriction(0.8)
      .setCollisionGroups(COL.static),
    game.staticBody,
  );
  const screen = canvasPlane(0.6, 0.3, 256, (c, w, h) => {
    signText(c, w, h, { bg: '#16171a', fg: '#7cf0a0', lines: [['CHARGING', 0.32, 0.38], ['● 87%', 0.28, 0.72]] });
  });
  screen.position.set(0, 1.5, 0.41);
  g.add(screen);
  const coil = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.03, 8, 20), flatMat(0x111111));
  coil.position.set(0.6, 1.2, 0.15);
  g.add(coil);
  const sign = canvasPlane(1.6, 0.4, 512, (c, w, h) => signText(c, w, h, { bg: '#f5c518', fg: '#16171a', border: '#16171a', lines: [['FORKLIFT CHARGING', 0.5, 0.55]] }));
  sign.position.set(0, 2.2, 0.02);
  g.add(sign);
  const spot = f.toWorld(0, z0 + 3.0);
  return { pos: new THREE.Vector3(spot.x, f.y, spot.z), yaw: f.ry };
}
