import * as THREE from 'three';
import { settings } from '../systems/settings.js';

// On Low graphics, skip mipmaps (a third more GPU memory per texture): the hundreds of box labels add up
export function lowMemoryTexture(tex) {
  if (settings.graphics !== 'low') return;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.anisotropy = 1;
}

const edgeMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 });
const matCache = new Map();

export function flatMat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!opts.map && matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshLambertMaterial({ color, ...opts });
  if (!opts.map) matCache.set(key, m);
  return m;
}

// A box with dark outlines so greybox shapes read clearly.
export function boxMesh(sx, sy, sz, color, { edges = true, shadows = true, material } = {}) {
  const geo = new THREE.BoxGeometry(sx, sy, sz);
  const mesh = new THREE.Mesh(geo, material || flatMat(color));
  mesh.castShadow = shadows;
  mesh.receiveShadow = shadows;
  if (edges) mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat));
  return mesh;
}

export function textTexture(text, { bg = '#ffffff', fg = '#111111', size = 256, w = size, h = size, font } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = fg;
  g.font = font || `bold ${Math.floor(h * 0.7)}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + h * 0.04, w * 0.94); // squeezed to fit if it's too long
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  lowMemoryTexture(tex);
  return tex;
}

// Flat label plane (e.g. painted floor text, wall signs).
export function labelPlane(text, width, height, opts = {}) {
  const tex = textTexture(text, { w: 512, h: Math.round((512 * height) / width), ...opts });
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: !!opts.transparent });
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
}

export function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.map) m.map.dispose();
        if (![...matCache.values()].includes(m) && m !== edgeMat) m.dispose();
      }
    }
  });
}
