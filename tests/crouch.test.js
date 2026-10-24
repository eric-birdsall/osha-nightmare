import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../src/config.js';
import { COL } from '../src/physics.js';
// Match Vite's JSON-module support when loading the gameplay class in Node.
registerHooks({ load(url, context, next) {
  if (url.endsWith('.json')) return { format: 'module', source: `export default ${readFileSync(new URL(url), 'utf8')}`, shortCircuit: true };
  return next(url, context);
} });
const { Climber } = await import('../src/entities/climber.js');
await RAPIER.init();

test('crouch preserves feet, fits shelf clearance, and prevents standing into overhead shelves', () => {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const floor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(RAPIER.ColliderDesc.cuboid(2, .08, 1).setTranslation(0, 3, 0).setCollisionGroups(COL.static), floor);
  const dave = Object.create(Climber.prototype);
  Object.assign(dave, { state: 'walk', grounded: true, peakY: 1.58, crouched: false, crouchRequested: false, centerOff: .9, game: { world } });
  dave.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(4, 2.48, 0));
  dave.collider = world.createCollider(RAPIER.ColliderDesc.capsule(.55, .35).setCollisionGroups(COL.climber), dave.body);
  dave.crouchStep({ crouchHeld: true }, true);
  assert.equal(dave.crouched, true);
  assert.ok(Math.abs(dave.feet.y - 1.58) < .001);
  assert.ok(Math.abs(dave.eye.y - (1.58 + CONFIG.climber.crouchEyeHeight)) < .001);
  dave.body.setTranslation({ x: 0, y: 2.08, z: 0 }, true);
  dave.body.setNextKinematicTranslation({ x: 0, y: 2.08, z: 0 }); world.step();
  dave.crouchStep({ crouchHeld: false }, true);
  assert.equal(dave.crouched, true, 'Overhead shelf prevents standing');
  assert.equal(dave.crouchRequested, false);
  dave.body.setTranslation({ x: 4, y: 2.08, z: 0 }, true);
  dave.body.setNextKinematicTranslation({ x: 4, y: 2.08, z: 0 }); world.step();
  dave.crouchStep({}, true);
  assert.equal(dave.crouched, false, 'Stand once clear');
  assert.ok(Math.abs(dave.feet.y - 1.58) < .001);
  world.free();
});

test('side contact while airborne pushes a loose box instead of treating it as a platform', () => {
  let impulse;
  const box = { kind: 'box', body: { handle: 7, linvel: () => ({ x: 0, y: 0, z: 0 }), mass: () => 5,
    worldCom: () => ({ x: 0, y: 2, z: 0 }), applyImpulseAtPoint: value => { impulse = value.clone(); } } };
  const dave = { grounded: false, kcc: { numComputedCollisions: () => 1,
    computedCollision: () => ({ collider: {}, normal1: { y: 0 }, translationDeltaRemaining: new THREE.Vector3(.1, 0, 0), witness1: { x: 0, z: 0 } }) },
    game: { entityForCollider: () => box } };
  Climber.prototype.pushLoose.call(dave);
  assert.ok(impulse.x > 0);
  assert.equal(impulse.y, 0);
});

test('midair crouch tucks feet while preserving the head, momentum, and fall distance', () => {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const dave = Object.create(Climber.prototype);
  Object.assign(dave, { state: 'walk', grounded: false, crouched: false, crouchRequested: false,
    centerOff: .9, peakY: 2.5, vy: 2, game: { world } });
  dave.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 3.4, 0));
  dave.collider = world.createCollider(RAPIER.ColliderDesc.capsule(.55, .35).setCollisionGroups(COL.climber), dave.body);
  const eye = dave.eye.y, feet = dave.feet.y;
  dave.crouchStep({ crouchHeld: true }, true);
  assert.ok(Math.abs(dave.feet.y - (feet + .8)) < .001);
  assert.ok(dave.feet.y > 3.08, 'Tucked feet clear Shelf 2');
  assert.ok(Math.abs(dave.eye.y - eye) < .001, 'No upward head boost');
  assert.equal(dave.vy, 2);
  assert.ok(Math.abs(dave.peakY - dave.feet.y) < .001);
  dave.crouchStep({ crouchHeld: false }, true);
  assert.ok(Math.abs(dave.feet.y - feet) < .001, 'Untucking restores the original feet height');
  for (let i = 0; i < 10; i++) dave.crouchStep({ crouchHeld: i % 2 === 0 }, true);
  assert.ok(Math.abs(dave.eye.y - eye) < .001, 'Repeated toggles cannot create upward flight');
  assert.ok(Math.abs(dave.feet.y - feet) < .001);
  world.free();
});
