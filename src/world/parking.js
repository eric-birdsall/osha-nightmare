import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { COL } from '../physics.js';
import { boxMesh, flatMat } from '../util/meshes.js';
import { LAYOUT } from './layout.js';

// The forklift parking bay against the north wall, with its charger: Ralph's start spot, and where
// the night shift drops a tipped forklift.

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

function onWall(game, mesh, x, y, z = NORTH + 0.02) {
  mesh.position.set(x, y, z);
  game.scene.add(mesh);
  return mesh;
}

// Returns the truck's spot in the bay: { pos, yaw } (it parks nose-out, facing south).
export function buildParking(game) {
  const { x0, x1, depth } = LAYOUT.parking;
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
  game.world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.4, 0.55, 0.2).setTranslation(cx, 1.25, NORTH + 0.2).setFriction(0.8).setCollisionGroups(COL.static),
    game.staticBody,
  );
  const charger = boxMesh(0.8, 1.1, 0.4, 0x2b2f35);
  charger.position.set(cx, 1.25, NORTH + 0.2);
  game.scene.add(charger);
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
