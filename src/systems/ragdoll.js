import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { COL, yawQuat } from '../physics.js';
import { PARTS, JOINTS, partMesh } from '../entities/worker.js';

// Ten-body ragdoll (head, torso, upper/lower arms and legs) built from the shared worker parts.

// feet: THREE.Vector3, yaw: facing (camera yaw convention: 0 = facing -Z)
export function spawnRagdoll(game, { feet, yaw, velocity, spin = 3 }) {
  const world = game.world;
  // Template faces +Z; camera yaw 0 faces -Z, so add PI.
  const qThree = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw + Math.PI);
  const q = yawQuat(yaw + Math.PI);
  const bodies = {};
  const meshes = [];
  const group = new THREE.Group();
  for (const p of PARTS) {
    const off = new THREE.Vector3(...p.pos).applyQuaternion(qThree);
    const w = feet.clone().add(off);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(w.x, w.y, w.z)
        .setRotation(q)
        .setLinvel(velocity.x, velocity.y, velocity.z)
        .setAngvel({ x: (Math.random() - 0.5) * spin, y: (Math.random() - 0.5) * spin, z: (Math.random() - 0.5) * spin })
        .setAngularDamping(0.6)
        .setLinearDamping(0.05)
        .setCcdEnabled(true)
        .setAdditionalSolverIterations(4),
    );
    const desc = p.ball ? RAPIER.ColliderDesc.ball(p.ball) : RAPIER.ColliderDesc.cuboid(...p.half);
    world.createCollider(desc.setDensity(900).setFriction(0.8).setCollisionGroups(COL.ragdoll), body);
    const mesh = partMesh(p.name);
    group.add(mesh);
    bodies[p.name] = body;
    meshes.push({ body, mesh });
  }
  for (const [a, b, at] of JOINTS) {
    const pa = PARTS.find((p) => p.name === a).pos;
    const pb = PARTS.find((p) => p.name === b).pos;
    const a1 = { x: at[0] - pa[0], y: at[1] - pa[1], z: at[2] - pa[2] };
    const a2 = { x: at[0] - pb[0], y: at[1] - pb[1], z: at[2] - pb[2] };
    world.createImpulseJoint(RAPIER.JointData.spherical(a1, a2), bodies[a], bodies[b], true);
  }
  game.scene.add(group);

  return {
    bodies,
    group,
    pelvis: bodies.torso,
    sync() {
      for (const { body, mesh } of meshes) {
        const t = body.translation();
        const r = body.rotation();
        mesh.position.set(t.x, t.y, t.z);
        mesh.quaternion.set(r.x, r.y, r.z, r.w);
      }
    },
    dispose() {
      for (const { body } of meshes) world.removeRigidBody(body);
      game.scene.remove(group);
    },
  };
}
