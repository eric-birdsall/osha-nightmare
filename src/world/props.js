import RAPIER from '@dimforge/rapier3d-compat';
import { COL } from '../physics.js';

// A loose prop: one dynamic body at (x, y, z) turned by yaw, made of boxes { half, pos } (local)
// sharing `mass` by volume, or a cylinder { cyl: [halfHeight, radius] }. `mesh` is drawn at the
// body's origin and follows it. grip: feet that grip the floor, so a shove tips it rather than
// sliding it along.
export function prop(game, name, mesh, [x, y, z], yaw, shapes, mass, { grip = false, kickTop } = {}) {
  const body = game.world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
      .setCanSleep(true),
  );
  const vol = (sh) => (sh.cyl ? Math.PI * sh.cyl[1] ** 2 * sh.cyl[0] : sh.half[0] * sh.half[1] * sh.half[2]);
  const total = shapes.reduce((v, sh) => v + vol(sh), 0);
  for (const sh of shapes) {
    const desc = sh.cyl ? RAPIER.ColliderDesc.cylinder(...sh.cyl) : RAPIER.ColliderDesc.cuboid(...sh.half);
    game.world.createCollider(
      desc
        .setTranslation(...(sh.pos || [0, 0, 0]))
        .setMass((mass * vol(sh)) / total)
        .setFriction(grip ? 1.2 : 0.7)
        .setFrictionCombineRule(grip ? RAPIER.CoefficientCombineRule.Max : RAPIER.CoefficientCombineRule.Average)
        .setCollisionGroups(COL.dyn),
      body,
    );
  }
  mesh.position.set(x, y, z);
  mesh.rotation.y = yaw;
  game.scene.add(mesh);
  // kickTop: how high a forklift hit also pushes it (see Game.rackImpacts)
  const ent = { kind: 'prop', name, body, mesh, mass, kickTop };
  game.addEntity(ent);
  return ent;
}

