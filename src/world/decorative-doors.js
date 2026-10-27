import * as THREE from 'three';
import { boxMesh, labelPlane } from '../util/meshes.js';
import { LAYOUT } from './layout.js';

// Painted, non-interactive doors backed by the existing solid East wall.
export function buildDecorativeDoors(game) {
  for (const door of LAYOUT.decorativeDoors) {
    const group = new THREE.Group();
    group.name = `Decorative ${door.label} door`;
    group.position.set(door.at, 0, -LAYOUT.room.halfZ + .045);
    const add = (mesh, x, y, z) => { mesh.position.set(x, y, z); group.add(mesh); };
    add(boxMesh(door.width + .12, 2.3, .05, 0x343b45), 0, 1.15, 0);
    add(boxMesh(door.width, 2.18, .04, 0x87939c), 0, 1.09, .035);
    add(labelPlane(door.label, door.width * .82, .22, { bg: '#234568', fg: '#ffffff' }), 0, 1.75, .06);
    add(boxMesh(.17, .04, .06, 0xd5dce2), door.width * .33, 1.0, .085);
    game.scene.add(group);
  }
}
