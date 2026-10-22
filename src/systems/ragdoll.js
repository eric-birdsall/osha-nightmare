import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { COL, yawQuat } from '../physics.js';
import { boxMesh, flatMat } from '../util/meshes.js';

// Ten-body ragdoll (head, torso, upper/lower arms and legs) in a "standing, facing +Z" template; positions are from the feet.
const SKIN = 0xe0b48a;
const VEST = 0xff7a00;
const SHIRT = 0x3b6fd6;
const PANTS = 0x2a3550;
const PARTS = [
  { name: 'torso', half: [0.2, 0.34, 0.12], pos: [0, 1.2, 0], color: VEST },
  { name: 'head', ball: 0.12, pos: [0, 1.68, 0], color: SKIN },
  { name: 'uArmL', half: [0.05, 0.15, 0.05], pos: [0.27, 1.38, 0], color: SHIRT },
  { name: 'lArmL', half: [0.045, 0.15, 0.045], pos: [0.27, 1.07, 0], color: SKIN },
  { name: 'uArmR', half: [0.05, 0.15, 0.05], pos: [-0.27, 1.38, 0], color: SHIRT },
  { name: 'lArmR', half: [0.045, 0.15, 0.045], pos: [-0.27, 1.07, 0], color: SKIN },
  { name: 'uLegL', half: [0.075, 0.21, 0.075], pos: [0.1, 0.64, 0], color: PANTS },
  { name: 'lLegL', half: [0.065, 0.21, 0.065], pos: [0.1, 0.22, 0], color: PANTS },
  { name: 'uLegR', half: [0.075, 0.21, 0.075], pos: [-0.1, 0.64, 0], color: PANTS },
  { name: 'lLegR', half: [0.065, 0.21, 0.065], pos: [-0.1, 0.22, 0], color: PANTS },
];
const JOINTS = [
  ['torso', 'head', [0, 1.55, 0]],
  ['torso', 'uArmL', [0.26, 1.52, 0]],
  ['uArmL', 'lArmL', [0.27, 1.22, 0]],
  ['torso', 'uArmR', [-0.26, 1.52, 0]],
  ['uArmR', 'lArmR', [-0.27, 1.22, 0]],
  ['torso', 'uLegL', [0.1, 0.86, 0]],
  ['uLegL', 'lLegL', [0.1, 0.43, 0]],
  ['torso', 'uLegR', [-0.1, 0.86, 0]],
  ['uLegR', 'lLegR', [-0.1, 0.43, 0]],
];

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
    let mesh;
    if (p.ball) {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(p.ball, 14, 10), flatMat(p.color));
      const hat = new THREE.Mesh(
        new THREE.SphereGeometry(p.ball * 1.15, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        flatMat(0xffd400),
      );
      hat.position.y = 0.03;
      mesh.add(hat);
      const nose = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.05), flatMat(0xd09a70));
      nose.position.set(0, 0, p.ball);
      mesh.add(nose);
    } else {
      mesh = boxMesh(p.half[0] * 2, p.half[1] * 2, p.half[2] * 2, p.color);
    }
    mesh.castShadow = true;
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
