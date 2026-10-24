import * as THREE from 'three';

// Puddles: scenery only (under the leaking electrical panel, round the mystery barrels). Nothing in
// the warehouse is slippery: the floor grips the same everywhere.

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
  g.globalAlpha = 0.08; // the faintest sheen
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.ellipse(105, 100, 30, 10, -0.5, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// A puddle drawn on the floor at (x, y, z), radius r, just for looks. liquid: { color, alpha }.
export function addPuddle(game, { x, y, z, r, liquid }) {
  const puddle = new THREE.Mesh(
    new THREE.PlaneGeometry(r * 2.3, r * 2.3),
    new THREE.MeshPhongMaterial({ map: puddleTexture(liquid), transparent: true, depthWrite: false, shininess: 60, specular: 0x333333 }),
  );
  puddle.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
  puddle.position.set(x, y + 0.009, z);
  puddle.renderOrder = 1;
  game.scene.add(puddle);
}
