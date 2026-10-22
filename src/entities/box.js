import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../config.js';
import { COL, yawQuat } from '../physics.js';

// Shipping label for the box sides: a fake barcode with the 4-digit SKU printed under it.
// Canvas aspect matches the side face so the label isn't stretched on tall boxes.
function labelTexture(sku, color, w, h) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = Math.round((128 * h) / w);
  const g = c.getContext('2d');
  g.fillStyle = '#' + color.toString(16).padStart(6, '0');
  g.fillRect(0, 0, c.width, c.height);
  // Darker edge so neighbouring boxes read as separate (stands in for outline geometry)
  g.strokeStyle = 'rgba(60, 40, 15, 0.55)';
  g.lineWidth = 6;
  g.strokeRect(3, 3, c.width - 6, c.height - 6);
  const lw = 100;
  const lh = 66;
  const lx = (c.width - lw) / 2;
  const ly = (c.height - lh) / 2;
  g.fillStyle = '#f7f5ee';
  g.fillRect(lx, ly, lw, lh);
  // Barcode bars derived from the SKU so each box looks different
  let x = lx + 8;
  let seed = Number(sku) * 7919;
  g.fillStyle = '#111';
  while (x < lx + lw - 10) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const bar = 1 + (seed % 3);
    g.fillRect(x, ly + 6, bar, 26);
    x += bar + 1 + ((seed >> 4) % 3);
  }
  g.font = 'bold 28px ui-monospace, Menlo, Consolas, monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(sku), c.width / 2, ly + 49);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Shared geometry per box size, with the top/bottom UVs pinned to a plain corner of the label.
const geometries = new Map();
function boxGeometry(type) {
  if (geometries.has(type)) return geometries.get(type);
  const [sx, sy, sz] = CONFIG.objects[type].size;
  const geo = new THREE.BoxGeometry(sx, sy, sz);
  const uv = geo.attributes.uv;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z (4 vertices each); +y/-y are 8..15
  for (let i = 8; i < 16; i++) uv.setXY(i, 0.12 + (i % 2) * 0.02, 0.12 + (i % 4 > 1 ? 0.02 : 0));
  uv.needsUpdate = true;
  geometries.set(type, geo);
  return geo;
}

// type: 'small' | 'medium' | 'large'
// sku: 4-digit number printed on every side
// item: order line ('A' | 'B') when this is the box the order asks for, else null
export function createBox(game, { type = 'medium', sku, item = null, pos, yaw = 0 }) {
  const spec = CONFIG.objects[type];
  const [sx, sy, sz] = spec.size;
  const body = game.world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos[0], pos[1] + sy / 2, pos[2])
      .setRotation(yawQuat(yaw))
      .setCanSleep(true),
  );
  game.world.createCollider(
    RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2)
      .setMass(spec.mass)
      .setFriction(spec.friction)
      .setCollisionGroups(COL.dyn),
    body,
  );

  // One material per box (a single draw call): the label covers the four sides, and the top
  // and bottom sample a plain cardboard corner of the same texture. There are 300+ boxes.
  const mesh = new THREE.Mesh(boxGeometry(type), new THREE.MeshLambertMaterial({ map: labelTexture(sku, spec.color, sx, sy) }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  game.scene.add(mesh);

  const ent = {
    kind: 'box',
    type,
    sku,
    item,
    size: [sx, sy, sz],
    mass: spec.mass,
    body,
    mesh,
    // Shapes in body space, reused when wrapping into a compound body
    shapes: [{ half: [sx / 2, sy / 2, sz / 2], pos: [0, 0, 0], mass: spec.mass, friction: spec.friction }],
  };
  game.addEntity(ent);
  return ent;
}
