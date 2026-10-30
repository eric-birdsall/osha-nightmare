import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../config.js';
import { lowMemoryTexture } from '../util/meshes.js';
import { COL, yawQuat } from '../physics.js';

// Seeded random numbers, so a SKU's look comes out the same every time.
function rng(seed) {
  let t = (seed * 2654435761) >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, list) => list[Math.floor(r() * list.length)];

const BRAND_A = ['Zap', 'Glo', 'Mega', 'Nu', 'Bolt', 'Fizz', 'Krunch', 'Omni', 'Pixel', 'Snug', 'Turbo', 'Yum', 'Plum', 'Rok', 'Vex', 'Dandi', 'Soop', 'Hap', 'Brite', 'Kwik'];
const BRAND_B = ['co', 'ly', 'tron', 'mart', 'ify', 'box', 'works', 'labs', 'zone', 'o', 'ex', 'pop'];
const SHAPES = ['circle', 'triangle', 'diamond', 'star', 'hex', 'bolt'];

// A SKU's look: box colour, a made-up brand and logo, and whether it's FRAGILE.
export function boxLook(look) {
  const r = rng(look);
  const hue = Math.floor(r() * 360);
  const name = pick(r, BRAND_A) + pick(r, BRAND_B);
  return {
    color: `hsl(${hue}, ${45 + Math.floor(r() * 25)}%, ${42 + Math.floor(r() * 16)}%)`,
    accent: `hsl(${(hue + 150 + Math.floor(r() * 60)) % 360}, 80%, ${r() < 0.5 ? 85 : 22}%)`,
    name: r() < 0.5 ? name.toUpperCase() : name[0].toUpperCase() + name.slice(1),
    shape: pick(r, SHAPES),
    fragile: r() < CONFIG.objects.fragileChance,
  };
}

function drawShape(g, shape, x, y, s) {
  g.beginPath();
  if (shape === 'circle') g.arc(x, y, s, 0, Math.PI * 2);
  else if (shape === 'triangle') {
    g.moveTo(x, y - s);
    g.lineTo(x + s, y + s * 0.8);
    g.lineTo(x - s, y + s * 0.8);
  } else if (shape === 'diamond') {
    g.moveTo(x, y - s);
    g.lineTo(x + s, y);
    g.lineTo(x, y + s);
    g.lineTo(x - s, y);
  } else if (shape === 'star') {
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? s * 0.45 : s;
      g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
  } else if (shape === 'hex') {
    for (let i = 0; i < 6; i++) g.lineTo(x + Math.cos((i * Math.PI) / 3) * s, y + Math.sin((i * Math.PI) / 3) * s);
  } else {
    // lightning bolt
    const p = [[0.2, -1], [-0.5, 0.15], [-0.05, 0.15], [-0.25, 1], [0.5, -0.2], [0.05, -0.2]];
    for (const [px, py] of p) g.lineTo(x + px * s, y + py * s);
  }
  g.closePath();
  g.fill();
}

// Side artwork for a box: the brand logo on its colour, a FRAGILE stamp on some products, and a
// small shipping label with a barcode and the 3-digit SKU. Cached per SKU and box size.
const textures = new Map();
function labelTexture(sku, look, w, h) {
  const key = `${sku}:${look}:${w}x${h}`;
  if (textures.has(key)) return textures.get(key);
  const L = boxLook(look);
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = Math.round((256 * h) / w);
  const W = c.width;
  const H = c.height;
  const g = c.getContext('2d');
  g.fillStyle = L.color;
  g.fillRect(0, 0, W, H);
  // Darker edge so neighbouring boxes read as separate (stands in for outline geometry)
  g.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  g.lineWidth = 10;
  g.strokeRect(5, 5, W - 10, H - 10);
  // Logo: a shape and the brand name, upper middle
  g.fillStyle = L.accent;
  drawShape(g, L.shape, W / 2, H * 0.24, Math.min(W, H) * 0.12);
  g.font = `bold ${Math.round(W * 0.15)}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  g.strokeText(L.name, W / 2, H * 0.46, W * 0.86);
  g.fillText(L.name, W / 2, H * 0.46, W * 0.86);
  // FRAGILE stamp across the middle-left
  if (L.fragile) {
    g.save();
    g.translate(W * 0.36, H * 0.67);
    g.rotate(-0.12);
    g.fillStyle = '#fff';
    g.fillRect(-W * 0.3, -H * 0.06, W * 0.6, H * 0.12);
    g.strokeStyle = '#d0141b';
    g.lineWidth = 5;
    g.strokeRect(-W * 0.3, -H * 0.06, W * 0.6, H * 0.12);
    g.fillStyle = '#d0141b';
    g.font = `bold ${Math.round(H * 0.08)}px system-ui, sans-serif`;
    g.fillText('FRAGILE', 0, 2, W * 0.55);
    g.restore();
  }
  // Shipping label, bottom right: a small barcode over the 3-digit SKU
  const lw = W * 0.4;
  const lh = Math.min(H * 0.24, W * 0.3);
  const lx = W - lw - 16;
  const ly = H - lh - 16;
  g.fillStyle = '#f7f5ee';
  g.fillRect(lx, ly, lw, lh);
  let x = lx + 8;
  let seed = sku * 7919;
  g.fillStyle = '#111';
  while (x < lx + lw - 8) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const bar = 1 + (seed % 2);
    g.fillRect(x, ly + 5, bar, lh * 0.32);
    x += bar + 1 + ((seed >> 4) % 2);
  }
  g.font = `bold ${Math.round(lh * 0.5)}px ui-monospace, Menlo, Consolas, monospace`;
  g.fillText(String(sku), lx + lw / 2, ly + lh * 0.7);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  lowMemoryTexture(tex);
  textures.set(key, tex);
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
// sku: 3-digit number printed on every side
// item: order line ('A', 'B' or 'C') when this is one of the SKUs the order asks for, else null
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
  const look = game.skus?.look(sku) ?? sku;
  const mesh = new THREE.Mesh(boxGeometry(type), new THREE.MeshLambertMaterial({ map: labelTexture(sku, look, sx, sy) }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  game.scene.add(mesh);

  const ent = {
    kind: 'box',
    type,
    sku,
    item,
    fragile: boxLook(look).fragile, // dropped or thrown, it goes off
    size: [sx, sy, sz],
    mass: spec.mass,
    body,
    mesh,
    // Shapes in body space, reused when wrapping into a compound body
    shapes: [{ half: [sx / 2, sy / 2, sz / 2], pos: [0, 0, 0], mass: spec.mass, friction: spec.friction }],
  };
  game.damage?.identify(ent);
  game.addEntity(ent);
  return ent;
}
