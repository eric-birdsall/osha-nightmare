import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import RAPIER from '@dimforge/rapier3d-compat';
import { fitsReceivingSlot } from '../src/systems/receiving.js';
import { RECEIVING_ORDER } from '../src/world/receiving-orders.js';

registerHooks({ load(url, context, next) {
  if (url.endsWith('.json')) return { format: 'module', source: `export default ${readFileSync(new URL(url), 'utf8')}`, shortCircuit: true };
  return next(url, context);
} });
// Canvas drawing is irrelevant to physics, but constructors still create their real meshes.
const context = new Proxy({}, { get: (object, key) => object[key] ?? (key.startsWith('create') ? () => ({ addColorStop() {} }) : () => {}), set: (object, key, value) => (object[key] = value, true) });
globalThis.document = { createElement: () => ({ getContext: () => context, width: 0, height: 0 }) };
const { Game } = await import('../src/systems/game.js');
const { Input } = await import('../src/systems/input.js');
const { best, submit, levelDef } = await import('../src/systems/records.js');
await RAPIER.init();

function createGame(mode = 'single') {
  const game = new Game({ mode, order: RECEIVING_ORDER.id });
  game.assignDevices({ padCount: () => 0, lastDevice: 'kbm' });
  return game;
}
function settle(game, seconds = 2) {
  const blank = Input.prototype.climberActions.call({ invertY: false }, []);
  for (let i = 0; i < seconds * 60; i++) game.step(1 / 60, { climber: blank, driver: blank });
}
function move(body, x, y, z) {
  body.setTranslation({ x, y, z }, true); body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  body.setLinvel({ x: 0, y: 0, z: 0 }, true); body.setAngvel({ x: 0, y: 0, z: 0 }, true);
}

test('receiving builds real inbound pallets and reserved empty shelf destinations in both modes', () => {
  for (const mode of ['single', 'coop']) {
    const game = createGame(mode), receiving = game.receivingSystem;
    assert.equal(game.receiving, true); assert.equal(game.level.dock.name, 'Dock 2');
    assert.equal(receiving.pallets.length, 2); assert.equal(receiving.boxes.length, 4);
    assert.ok(receiving.pallets.every(p => game.level.dockZone.contains(p.body.translation())));
    for (const slot of receiving.slots) {
      assert.equal(slot.rack.stock.filter(b => {
        const p = b.home.pos;
        return p.x > slot.x0 && p.x < slot.x1 && Math.abs(p.y - slot.y) < 1;
      }).length, 0);
    }
    settle(game, .5); game.frame(1 / 60);
    assert.equal(game.complete, false); assert.match(receiving.content('driver').detail, /PO-001/);
    game.dispose();
  }
});

test('stock must be stable on the correct shelf; cleanup and parking are mandatory', () => {
  const game = createGame(), receiving = game.receivingSystem;
  settle(game, 1);
  for (const slot of receiving.slots) {
    receiving.boxes.filter(b => b.receivingLine === slot.line.line).forEach((box, i) => {
      move(box.body, slot.x0 + .65 + i * .85, slot.y + .205, (slot.z0 + slot.z1) / 2);
    });
  }
  settle(game, 2);
  assert.deepEqual(game.itemStatus, { A: 2, B: 2 });
  assert.equal(receiving.stage, 3); assert.equal(game.complete, false);
  // Removing a correctly stocked box revokes its progress.
  const box = receiving.boxes[0], slot = receiving.slots[0];
  move(box.body, 5, .21, -5); settle(game, .4); assert.equal(game.itemStatus.A, 1);
  move(box.body, slot.x0 + .65, slot.y + .205, (slot.z0 + slot.z1) / 2);
  const r = receiving.returns;
  receiving.pallets.forEach((p, i) => move(p.body, r.x + (i ? .6 : -.6), -.98, r.z));
  const home = game.level.forkliftSpawn;
  game.forklift.teleport({ x: home.pos.x + 3, z: home.pos.z }, home.yaw);
  settle(game, 2); assert.equal(receiving.palletsReturned(), true);
  assert.equal(receiving.stage, 4); assert.equal(game.complete, false);
  game.forklift.height = .1;
  game.forklift.teleport(home.pos, home.yaw);
  settle(game, 2); assert.equal(game.complete, true);
  game.dispose();
});

test('shelf bounds reject a wrong bay, wrong shelf, and a box centered off the shelf', () => {
  const slot = { x0: 0, x1: 2.7, z0: 0, z1: 1.2, y: 1.5, ceiling: 3 };
  assert.equal(fitsReceivingSlot({ x: .5, y: 1.5, z: .2 }, { x: .9, y: 1.9, z: .6 }, slot), true);
  assert.equal(fitsReceivingSlot({ x: 2.5, y: 1.5, z: .2 }, { x: 2.9, y: 1.9, z: .6 }, slot), false);
  assert.equal(fitsReceivingSlot({ x: .5, y: 3, z: .2 }, { x: .9, y: 3.4, z: .6 }, slot), false);
  assert.equal(fitsReceivingSlot({ x: .5, y: 1.5, z: 1.1 }, { x: .9, y: 1.9, z: 1.5 }, slot), false);
  assert.equal(fitsReceivingSlot({ x: .5, y: 1.5, z: .9 }, { x: .9, y: 1.9, z: 1.3 }, slot), true);
});

test('receiving records are separate from picking and persist in both player modes', () => {
  const data = new Map(); globalThis.localStorage = { getItem: k => data.get(k), setItem: (k, v) => data.set(k, v) };
  assert.equal(levelDef('receiving-1').number, 'PO-001');
  submit('single', 'receiving-1', { time: 100, incidents: 2 });
  assert.equal(best('single', 'receiving-1').total, 130);
  assert.equal(best('coop', 'receiving-1'), null); assert.equal(best('single', 1), null);
});

test('picking still builds its original stock and tutorial without incoming pallets', () => {
  const game = new Game({ mode: 'single', order: 1 });
  assert.equal(game.receiving, false); assert.equal(game.receivingSystem, null);
  assert.ok(game.tutorial); assert.equal(game.level.order[0].sku, 355);
  assert.ok(game.entities.some(box => box.kind === 'box' && box.sku === 355 && box.home?.rack === 'A'));
  assert.equal(game.entities.filter(box => box.receivingLine).length, 0);
  game.dispose();
});

test('two boxes on the correct shelf count when one rests along the front beam', () => {
  const game = createGame(), receiving = game.receivingSystem;
  const slot = receiving.slots[0];
  const boxes = receiving.boxes.filter(box => box.receivingLine === slot.line.line);
  boxes.forEach((box, i) => move(box.body, slot.x0 + .65 + i * .85,
    slot.y + .205, i === 0 ? (slot.z0 + slot.z1) / 2 : slot.z1 - .08));
  settle(game, 2);
  assert.equal(game.itemStatus.A, 2, 'Stable front-beam placement must count alongside the other box');
  game.dispose();
});

test('parking accepts the marked bay beyond the old spawn radius and explains blockers', () => {
  const game = createGame(), receiving = game.receivingSystem, home = game.level.forkliftSpawn;
  const offset = { x: home.pos.x + 1, z: home.pos.z };
  game.forklift.teleport(offset, home.yaw);
  assert.equal(receiving.parked(), true, 'Clearly inside the bay, even one metre from spawn');
  game.forklift.height = 1;
  assert.match(receiving.parkingReason(), /Lower the forks/);
  game.forklift.height = .1;
  game.forklift.body.setLinvel({ x: .4, y: 0, z: 0 }, true);
  assert.match(receiving.parkingReason(), /complete stop/);
  game.forklift.teleport(offset, home.yaw + Math.PI);
  assert.match(receiving.parkingReason(), /face east/);
  game.forklift.teleport({ x: home.pos.x + 3, z: home.pos.z }, home.yaw);
  assert.match(receiving.parkingReason(), /inside the yellow parking lines/);
  game.dispose();
});

test('forklift can drive out after resetting to parking', () => {
  const game = createGame();
  settle(game, 1);
  game.forklift.teleport({ x: 6, z: -5 }, .8);
  game.forklift.height = 3.5;
  game.forklift.resetToStart();
  const start = { ...game.forklift.body.translation() };
  const blank = Input.prototype.climberActions.call({ invertY: false }, []);
  for (let i = 0; i < 120; i++) game.step(1 / 60, { climber: blank, driver: { ...blank, throttle: 1 } });
  const end = game.forklift.body.translation();
  assert.ok(Math.hypot(end.x - start.x, end.z - start.z) > 1.5, `Must drive clear after reset, moved ${Math.hypot(end.x - start.x, end.z - start.z)}`);
  game.dispose();
});

test('parking reset does not embed the forklift in a pallet left in its bay', () => {
  const game = createGame();
  settle(game, 1);
  const home = game.level.forkliftSpawn;
  game.forklift.teleport({ x: 6, z: -5 }, 0);
  const pallet = game.receivingSystem.pallets[0];
  move(pallet.body, home.pos.x, -1, home.pos.z);
  const box = game.receivingSystem.boxes[0];
  move(box.body, home.pos.x + .3, -.65, home.pos.z + .6);
  game.forklift.resetToStart();
  const blank = Input.prototype.climberActions.call({ invertY: false }, []);
  for (let i = 0; i < 60; i++) game.step(1 / 60, { climber: blank, driver: blank });
  assert.ok(Math.abs(game.forklift.body.translation().y + 1) < .12, 'Reset should settle with wheels on the floor');
  const start = { ...game.forklift.body.translation() };
  for (let i = 0; i < 120; i++) game.step(1 / 60, { climber: blank, driver: { ...blank, throttle: 1 } });
  const end = game.forklift.body.translation();
  assert.ok(Math.hypot(end.x - start.x, end.z - start.z) > 1.5);
  game.dispose();
});

test('both east-wall docks have usable doorways during Full Shift', () => {
  const game = new Game({ mode: 'single', order: 'shift' });
  const docks = game.level.docks;
  assert.equal(docks['Dock 1'].dock.wall, 'north');
  assert.equal(docks['Dock 2'].dock.wall, 'north');
  assert.ok(docks['Dock 1'].dock.at < docks['Dock 2'].dock.at);
  for (const name of ['Dock 1', 'Dock 2']) {
    for (const [dockName, dock] of Object.entries(docks)) dock.setOpen(dockName === name);
    game.world.step();
    const dock = docks[name].dock;
    const ray = new RAPIER.Ray({ x: dock.at, y: -.1, z: -22.7 }, { x: 0, y: 0, z: -1 });
    const hit = game.world.castRay(ray, 2, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
    assert.equal(hit, null, `${name} must have no wall collider across its open doorway`);
  }
  game.dispose();
});

test('tipping reports an incident without a blast; Ralph looks vertically and can read the clipboard', () => {
  const game = createGame(), forklift = game.forklift;
  forklift.lookYaw = .8;
  const pitch = forklift.lookPitch;
  forklift.look({ lookX: 1, lookY: .1 }, true);
  assert.equal(forklift.lookYaw, 0); assert.notEqual(forklift.lookPitch, pitch);
  forklift.lookPitch = -.36;
  game.frame(.8);
  assert.equal(game.receivingSystem.read, true, 'Clipboard stays readable with vertical look only');
  let blasts = 0; const incidents = [];
  game.blast = () => { blasts++; };
  game.onIncident = reason => incidents.push(reason);
  const blank = Input.prototype.climberActions.call({ invertY: false }, []);
  forklift.body.setRotation({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }, true);
  for (let i = 0; i < 60; i++) { game.clock += 1 / 60; forklift.preStep(blank, 1 / 60, true); }
  assert.equal(forklift.tipped, true); assert.equal(blasts, 0);
  assert.deepEqual(incidents, ['tipped']);
  game.dispose();
});

test('only Ralph can recover a tipped forklift by holding his reset control', () => {
  const game = createGame(), f = game.forklift;
  const blank = Input.prototype.climberActions.call({ invertY: false }, []);
  f.body.setRotation({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }, true);
  settle(game, 1); assert.equal(f.tipped, true);
  game.active = 'climber'; game.assignDevices({ padCount: () => 0, lastDevice: 'kbm' });
  const p = f.body.translation();
  game.climber.body.setTranslation({ x: p.x - 2, y: -.1, z: p.z }, true);
  for (let i = 0; i < 150; i++) game.step(1 / 60, { climber: { ...blank, interactHeld: true }, driver: blank });
  assert.equal(f.tipped, true, 'Dave cannot flip the truck with E/X');
  game.active = 'driver'; game.assignDevices({ padCount: () => 0, lastDevice: 'kbm' });
  for (let i = 0; i < 80; i++) game.step(1 / 60, { climber: blank, driver: { ...blank, respawnHeld: true } });
  assert.equal(f.tipped, false); assert.ok(1 - 2 * (f.body.rotation().x ** 2 + f.body.rotation().z ** 2) > .9);
  assert.ok(game.respawnHold.driver < 0, 'One reset per hold');
  game.dispose();
});
