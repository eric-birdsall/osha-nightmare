import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { COL } from '../physics.js';
import { boxMesh, flatMat, labelPlane } from '../util/meshes.js';
import { LAYOUT } from './layout.js';

// The stretch wrapper: a rotary-arm wrapper over the WRAP square. Four yellow posts hold a steel
// gantry with a motor in the middle; the arm hangs from it and swings a film carriage round the
// pallet while the carriage rides up and down. The pallet stays put, so the forklift drives in
// between the posts, sets the load down and backs out. The posts and the gantry are solid: raise
// the forks too high in here and they hit the beams.

const YELLOW = 0xf5c518;
const STEEL = 0x3c4249;

function solid(game, size, pos) {
  game.world.createCollider(
    RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2).setTranslation(...pos).setFriction(0.8).setCollisionGroups(COL.static),
    game.staticBody,
  );
}

export function buildWrapper(game) {
  const { x, z } = LAYOUT.wrap;
  const { half, height: H, arm: R } = LAYOUT.wrap.frame;
  const scene = game.scene;
  const add = (mesh, px, py, pz) => {
    mesh.position.set(px, py, pz);
    scene.add(mesh);
    return mesh;
  };
  // Corner posts on base plates, with hazard-striped bollard guards
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const px = x + sx * half;
      const pz = z + sz * half;
      // A touch wider and taller than the beams that meet it, so no faces share a plane (flicker)
      add(boxMesh(0.24, H + 0.02, 0.24, YELLOW), px, (H + 0.02) / 2, pz);
      add(boxMesh(0.45, 0.04, 0.45, STEEL, { edges: false }), px, 0.02, pz);
      solid(game, [0.26, H, 0.26], [px, H / 2, pz]);
    }
  }
  // Gantry: beams round the top and two across to the motor in the middle
  const beam = 0.3;
  for (const s of [-1, 1]) {
    // The beams end inside the posts; the ones along z sit 5 mm lower than the ones along x
    add(boxMesh(half * 2, beam, 0.2, STEEL), x, H - beam / 2, z + s * half);
    add(boxMesh(0.2, beam - 0.01, half * 2, STEEL), x + s * half, H - beam / 2 - 0.005, z);
    solid(game, [half * 2 + 0.22, beam, 0.2], [x, H - beam / 2, z + s * half]);
    solid(game, [0.2, beam, half * 2 + 0.22], [x + s * half, H - beam / 2, z]);
  }
  add(boxMesh(half * 2, 0.22, 0.25, STEEL), x, H - 0.25, z);
  add(boxMesh(0.25, 0.2, half * 2, STEEL), x, H - 0.25, z); // a little slimmer where they cross
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.4, 20), flatMat(0x2b2f35)), x, H - 0.55, z);
  // Signs on the gantry, facing out both ways along x
  for (const s of [-1, 1]) {
    const sign = labelPlane('STRETCH WRAPPER', 2.4, 0.3, { bg: '#16171a', fg: '#f5c518' });
    sign.rotation.y = (s * Math.PI) / 2;
    add(sign, x + s * (half + 0.11), H - 0.15, z);
    const warn = labelPlane('KEEP CLEAR WHILE WRAPPING', 2.4, 0.22, { bg: '#d0141b', fg: '#ffffff' });
    warn.rotation.y = (s * Math.PI) / 2;
    add(warn, x + s * (half + 0.11), H - 0.45, z);
  }
  // The arm: a hub under the motor, a boom out to radius R and a mast down to the floor, with
  // the film carriage on it. Visual only (no collider), parked to the north-east between wraps.
  const arm = new THREE.Group();
  arm.position.set(x, H - 0.8, z);
  arm.rotation.y = Math.PI / 4;
  arm.add(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.3, 16), flatMat(0x2b2f35)));
  const boom = boxMesh(R + 0.15, 0.16, 0.16, YELLOW, { edges: false });
  boom.position.set(R / 2, 0, 0);
  arm.add(boom);
  const mastLen = H - 1.0;
  const mast = boxMesh(0.12, mastLen, 0.12, YELLOW, { edges: false });
  mast.position.set(R, -mastLen / 2, 0);
  arm.add(mast);
  const carriage = new THREE.Group();
  carriage.position.set(R - 0.12, -mastLen + 0.5, 0);
  carriage.add(boxMesh(0.16, 0.5, 0.3, 0x2b2f35, { edges: false }));
  const film = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.5, 14), new THREE.MeshLambertMaterial({ color: 0xe8f6ff, transparent: true, opacity: 0.9 }));
  film.position.x = -0.15;
  carriage.add(film);
  arm.add(carriage);
  scene.add(arm);
  // Control panel on a stand outside one post, with a big red stop button
  const px = x + half + 0.7;
  const pz = z + half - 0.4;
  add(boxMesh(0.12, 1.1, 0.12, STEEL, { edges: false }), px, 0.55, pz);
  add(boxMesh(0.4, 0.5, 0.18, 0xd9dde2), px, 1.3, pz);
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 14), flatMat(0xd0141b)), px - 0.21, 1.4, pz).rotation.z = Math.PI / 2;
  solid(game, [0.4, 1.55, 0.2], [px, 0.78, pz]);
  // Yellow lines on the floor between the posts
  const stripe = new THREE.MeshBasicMaterial({ color: YELLOW });
  for (const s of [-1, 1]) {
    for (const [w, d, ox, oz] of [[half * 2, 0.08, 0, s * half], [0.08, half * 2, s * half, 0]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), stripe);
      m.rotation.x = -Math.PI / 2;
      add(m, x + ox, 0.005, z + oz);
    }
  }
  const parkY = carriage.position.y;
  return {
    arm,
    // Put the film carriage at this height above the floor (kept on the mast)
    setCarriage(worldY) {
      carriage.position.y = Math.max(-mastLen + 0.3, Math.min(-0.4, worldY - (H - 0.8)));
    },
    park() {
      carriage.position.y = parkY;
    },
  };
}
