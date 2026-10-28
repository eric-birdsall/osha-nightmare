import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Tutorial } from '../src/systems/tutorial.js';

function setup() {
  let carried = [];
  const game = {
    scene: new THREE.Scene(), clock: 0, mode: 'single', active: 'driver', complete: false,
    level: {
      order: [{ line: 'A', sku: 355, qty: 1, location: 'A-6-1' }],
      dock: { name: 'Dock 3' }, dockZone: { center: { x: 0, z: -20 } },
      wrapZone: { center: { x: 5, z: 0 }, contains: p => p.x === 5 },
    },
    climber: { feet: new THREE.Vector3(), carriedBoxes: () => carried, camera: new THREE.PerspectiveCamera() },
    forklift: { camera: new THREE.PerspectiveCamera() },
    entities: [], lineCounts: load => ({ A: load.count || 0 }),
    usesKeyboard: () => true, keyHint: (_role, action) => ({ pause: 'Esc', swap: 'Tab', interact: 'E', lower: 'F', lift: 'R' })[action],
    wrap: { job: null, blockReason: load => { assert.ok(load); return null; } },
  };
  const tutorial = new Tutorial(game);
  const update = () => { tutorial.update(0.2); return tutorial.stage; };
  return { game, tutorial, update, carry: boxes => { carried = boxes; } };
}

test('guides the real pick-load-wrap-deliver flow and recovers after a lost load', () => {
  const { game, tutorial, update, carry } = setup();
  assert.equal(update(), 0);
  assert.match(tutorial.content('driver').detail, /clipboard/);
  carry([{ sku: 355 }]); assert.equal(update(), 2); // skip ahead without reading
  assert.match(tutorial.content('climber').detail, /<kbd>E<\/kbd>/);
  carry([]);
  const pallet = { kind: 'pallet', count: 1, body: { translation: () => ({ x: 0, y: 0, z: 0 }) } };
  game.entities.push(pallet); assert.equal(update(), 3);
  pallet.body.translation = () => ({ x: 5, y: 0, z: 0 }); assert.equal(update(), 4);
  game.wrap.job = {}; assert.match(tutorial.content('driver').detail, /Wrapping in progress/);
  game.wrap.job = null; pallet.count = 0; assert.equal(update(), 1);
  game.entities.push({ kind: 'wrapped', skus: { 355: 1 }, body: pallet.body });
  assert.equal(update(), 5); assert.match(tutorial.content('driver').detail, /Dock 3/);
  game.complete = true; tutorial.update(.2);
  assert.equal(tutorial.content('driver'), null); assert.equal(tutorial.marker.visible, false);
});

test('only matching stock counts, and incorrect wrapped loads do not advance', () => {
  const { game, update, carry } = setup();
  carry([{ sku: 999 }]); assert.equal(update(), 0);
  game.entities.push({ kind: 'wrapped', skus: { 999: 1 }, body: { translation: () => ({ x: 5, y: 0, z: 0 }) } });
  assert.equal(update(), 0);
});

test('the guide points to Pause and does not advance by looking at the former cab position', () => {
  const { game, tutorial, update } = setup();
  const clipboard = new THREE.Group(); clipboard.position.z = -1; clipboard.visible = false;
  game.scene.add(clipboard); game.forklift.clipboard = { group: clipboard };
  game.mode = 'coop';
  for (let i = 0; i < 5; i++) update();
  assert.equal(tutorial.read, false);
  assert.match(tutorial.content('climber').detail, /Open Pause/);
  tutorial.read = true; assert.equal(update(), 1);
  assert.doesNotMatch(tutorial.content('climber').detail, /Switch to/);
});

test('instructions follow the active controls without exposing keys to controller players', () => {
  const { game, tutorial, update, carry } = setup();
  game.usesKeyboard = () => false;
  game.keyHint = (_role, action) => ({ pause: 'Menu', swap: 'View', interact: 'X', lower: 'LB', lift: 'RB' })[action];
  carry([{ sku: 355 }]); update();
  assert.match(tutorial.content('climber').detail, /<kbd>X<\/kbd>/);
  assert.doesNotMatch(tutorial.content('climber').detail, /<kbd>E<\/kbd>/);
  tutorial.stage = 1; assert.match(tutorial.content('driver').detail, /left stick/);
});

test('removed pallets between scans cannot break wrapping instructions', () => {
  const { game, tutorial, update } = setup();
  const pallet = { kind: 'pallet', count: 1, body: { translation: () => ({ x: 5, y: 0, z: 0 }) } };
  game.entities.push(pallet); update(); assert.equal(tutorial.stage, 4);
  pallet.removed = true;
  game.wrap.blockReason = () => { throw new Error('Removed physics body'); };
  assert.doesNotThrow(() => tutorial.content('driver'));
});
