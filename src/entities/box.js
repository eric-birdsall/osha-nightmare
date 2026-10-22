import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../config.js';
import { COL, yawQuat } from '../physics.js';
import { boxMesh, textTexture } from '../util/meshes.js';

// type: 'small' | 'medium' | 'large'; item: 'A' | 'B' | null (order items)
export function createBox(game, { type = 'medium', item = null, pos, yaw = 0 }) {
  const spec = item ? CONFIG.objects.item : CONFIG.objects[type];
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

  let mesh;
  if (item) {
    const info = CONFIG.items[item];
    const hex = '#' + info.color.toString(16).padStart(6, '0');
    const mat = new THREE.MeshLambertMaterial({ map: textTexture(info.label, { bg: hex, fg: '#111' }) });
    mesh = boxMesh(sx, sy, sz, info.color, { material: mat });
  } else {
    mesh = boxMesh(sx, sy, sz, spec.color);
    // Packing-tape stripe so boxes read as boxes
    const tape = new THREE.Mesh(
      new THREE.BoxGeometry(sx * 0.18, 0.004, sz + 0.004),
      new THREE.MeshLambertMaterial({ color: 0xe8d9b0 }),
    );
    tape.position.y = sy / 2;
    mesh.add(tape);
  }
  game.scene.add(mesh);

  const ent = {
    kind: 'box',
    type,
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
