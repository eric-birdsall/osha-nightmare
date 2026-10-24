import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { COL } from '../physics.js';
import { boxMesh, flatMat, labelPlane } from '../util/meshes.js';
import { LAYOUT } from './layout.js';

// A powered roller conveyor along the east wall: a waist-high belt that carries anything resting
// on it north at LAYOUT.conveyor.speed, and drops it off the north end. Boxes, pallets, barrels,
// ladders, and Dave if he climbs on (he rides it; see Climber's support velocity).

const YELLOW = 0xf5c518;
const STEEL = 0x5b636d;

// A belt texture of dark rubber with lighter cleats, scrolled to show it moving
function beltTexture(len) {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#2a2d31';
  g.fillRect(0, 0, 32, 64);
  g.fillStyle = '#4a4f56';
  g.fillRect(0, 0, 32, 6);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, len / 0.5);
  return tex;
}

export function buildConveyor(game) {
  const c = LAYOUT.conveyor;
  const { x0, x1, z0, z1, height: h, speed } = c;
  const [w, len, cx, cz] = [x1 - x0, z1 - z0, (x0 + x1) / 2, (z0 + z1) / 2];
  // The body: solid up to the belt
  const collider = game.world.createCollider(
    RAPIER.ColliderDesc.cuboid(w / 2, h / 2, len / 2).setTranslation(cx, h / 2, cz).setFriction(0.6).setCollisionGroups(COL.static),
    game.staticBody,
  );
  const scene = game.scene;
  const add = (mesh, x, y, z) => {
    mesh.position.set(x, y, z);
    scene.add(mesh);
    return mesh;
  };
  // Side frames (a little proud of the belt), legs, and rollers at the ends
  for (const sx of [x0 + 0.04, x1 - 0.04]) add(boxMesh(0.08, 0.22, len, STEEL), sx, h - 0.06, cz);
  for (let z = z0 + 0.4; z < z1; z += 2.2) {
    for (const sx of [x0 + 0.08, x1 - 0.08]) add(boxMesh(0.06, h - 0.15, 0.06, STEEL, { edges: false }), sx, (h - 0.15) / 2, z);
  }
  for (const z of [z0 + 0.12, z1 - 0.12]) {
    const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, w - 0.1, 14), flatMat(0x8a9099));
    roller.rotation.z = Math.PI / 2;
    add(roller, cx, h - 0.12, z);
  }
  // The belt itself, scrolling north
  const tex = beltTexture(len);
  const belt = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.16, len), new THREE.MeshLambertMaterial({ map: tex }));
  belt.rotation.x = -Math.PI / 2;
  add(belt, cx, h + 0.002, cz);
  // Motor housing at the south end, a hazard-striped guard and a warning sign on the wall
  add(boxMesh(w, 0.5, 0.6, 0x2f5fb3), cx, 0.35, z1 + 0.35);
  game.world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, 0.25, 0.3).setTranslation(cx, 0.35, z1 + 0.35).setCollisionGroups(COL.static), game.staticBody);
  add(boxMesh(w + 0.02, 0.12, 0.04, YELLOW, { edges: false }), cx, h + 0.1, z0 + 0.02);
  const sign = labelPlane('CONVEYOR · KEEP HANDS CLEAR · NO RIDING', 3.2, 0.3, { bg: '#f5c518', fg: '#16171a' });
  sign.rotation.y = -Math.PI / 2;
  add(sign, LAYOUT.room.halfX - 0.03, 1.7, cz + 4);
  const velocity = new THREE.Vector3(0, 0, -speed); // north
  return {
    collider,
    velocity,
    // Is this the belt (what Dave is standing on, say)?
    owns: (col) => col?.handle === collider.handle,
    // Before each physics step: drive everything resting on the belt along at belt speed
    step() {
      game.world.contactPairsWith(collider, (other) => {
        const ent = game.entityForCollider(other);
        if (!ent || ent.carried || ent.removed || !ent.body.isDynamic()) return;
        const t = ent.body.translation();
        if (t.y < h - 0.05) return; // touching the side, not riding on top
        const v = ent.body.linvel();
        ent.body.setLinvel({ x: v.x * 0.8, y: v.y, z: velocity.z }, true);
      });
    },
    // Each frame: scroll the belt
    update(dt) {
      tex.offset.y -= (speed * dt) / 0.5; // texture v runs north here, so this slides the cleats north
    },
  };
}
