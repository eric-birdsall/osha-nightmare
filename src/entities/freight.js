import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { COL } from '../physics.js';
import { createPallet } from './pallet.js';
import { boxMesh, labelPlane } from '../util/meshes.js';

// One indivisible shipping unit. The crate and its pallet share a dynamic body, so
// the straps keep the load together while the normal fork pockets remain usable.
export function createFreight(game, { pos, yaw = 0, sku, mass, height = 1.35 }) {
  const freight = createPallet(game, { pos, yaw });
  const crate = { width: .96, height, depth: 1.12, bottom: .15 };
  const crateMass = mass - freight.mass;
  const shape = { half: [crate.width / 2, crate.height / 2, crate.depth / 2], pos: [0, crate.bottom + crate.height / 2, 0], mass: crateMass, friction: .7 };
  game.world.createCollider(RAPIER.ColliderDesc.cuboid(...shape.half)
    .setTranslation(...shape.pos).setMass(shape.mass).setFriction(shape.friction).setCollisionGroups(COL.dyn), freight.body);
  freight.shapes.push(shape);
  Object.assign(freight, { kind: 'freight', sku, mass, forkliftOnly: true,
    bounds: { min: new THREE.Vector3(-.5, 0, -.6), max: new THREE.Vector3(.5, crate.bottom + height, .6) } });
  freight.body.enableCcd(true);
  const add = (mesh, x, y, z) => { mesh.position.set(x, y, z); freight.mesh.add(mesh); return mesh; };
  add(boxMesh(crate.width, crate.height, crate.depth, 0xa77d49), 0, shape.pos[1], 0);
  for (const side of [-1, 1]) {
    const z = side * (crate.depth / 2 + .015);
    for (const x of [-.32, -.16, 0, .16, .32]) add(boxMesh(.008, crate.height - .1, .006, 0x76532e, { edges: false }), x, shape.pos[1], z);
    for (const x of [-.43, .43]) add(boxMesh(.09, crate.height, .045, 0xc39a63), x, shape.pos[1], z);
    for (const y of [crate.bottom + .055, crate.bottom + crate.height - .055]) add(boxMesh(crate.width, .11, .045, 0xc39a63), 0, y, z);
    const skuLabel = labelPlane(`SKU ${sku}`, .56, .18, { bg: '#f5f0df', fg: '#111111' });
    add(skuLabel, 0, crate.bottom + height * .65, side * .602).rotation.y = side > 0 ? 0 : Math.PI;
    const handling = labelPlane(`${mass} KG · FORKLIFT ONLY`, .82, .14, { bg: '#f5c518', fg: '#111111' });
    add(handling, 0, crate.bottom + height * .475, side * .603).rotation.y = side > 0 ? 0 : Math.PI;
    const units = labelPlane('1 UNIT · KEEP STRAPPED', .78, .11, { bg: '#e0bf8a', fg: '#33230f' });
    add(units, 0, crate.bottom + height * .326, side * .604).rotation.y = side > 0 ? 0 : Math.PI;
  }
  // Two continuous black bands go over the crate and under the pallet, with steel buckles.
  for (const x of [-.32, .32]) {
    for (const z of [-.585, .585]) add(boxMesh(.045, crate.bottom + height - .02, .018, 0x24282c, { edges: false }), x, (crate.bottom + height + .02) / 2, z);
    for (const y of [.025, crate.bottom + height + .015]) add(boxMesh(.045, .018, 1.19, 0x24282c, { edges: false }), x, y, 0);
    add(boxMesh(.065, .1, .025, 0x8a929b), x, .42, -.601);
  }
  freight.mesh.position.fromArray(pos);
  freight.mesh.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  return freight;
}
