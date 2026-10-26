import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import RAPIER from '@dimforge/rapier3d-compat';
import { LAYOUT as LAYOUT_FOR_TEST } from '../src/world/layout.js';
import { fitsReceivingSlot } from '../src/systems/receiving.js';
import { RECEIVING_ORDER, RECEIVING_ORDERS } from '../src/world/receiving-orders.js';

registerHooks({ load(url, context, next) {
  if (url.endsWith('.json')) return { format: 'module', source: `export default ${readFileSync(new URL(url), 'utf8')}`, shortCircuit: true };
  return next(url, context);
} });
// Canvas drawing is irrelevant to physics, but constructors still create their real meshes.
const context = new Proxy({}, { get: (object, key) => object[key] ?? (key.startsWith('create') ? () => ({ addColorStop() {} }) : () => {}), set: (object, key, value) => (object[key] = value, true) });
globalThis.document = { createElement: () => ({ getContext: () => context, width: 0, height: 0 }) };
const { Game } = await import('../src/systems/game.js');
const { Input } = await import('../src/systems/input.js');
const { cutWrapped, buildWrapped, collectStack } = await import('../src/systems/wrapping.js');
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
function openIncoming(game) {
  for (const load of [...game.receivingSystem.pallets]) if (load.kind === 'wrapped') cutWrapped(game, load);
}
const loadCartons = load => load.contents?.filter(r => r.kind === 'box') || [];

function move(body, x, y, z) {
  body.setTranslation({ x, y, z }, true); body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  body.setLinvel({ x: 0, y: 0, z: 0 }, true); body.setAngvel({ x: 0, y: 0, z: 0 }, true);
}

test('receiving builds real inbound pallets and reserved empty shelf destinations in both modes', () => {
  for (const mode of ['single', 'coop']) {
    const game = createGame(mode), receiving = game.receivingSystem;
    assert.equal(game.receiving, true); assert.equal(game.level.dock.name, 'Dock 2');
    assert.equal(receiving.pallets.length, 2);
    assert.ok(receiving.pallets.every(p => p.kind === 'wrapped'));
    assert.equal(receiving.pallets.flatMap(loadCartons).length, 4);
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

test('correct putaway completes without cleanup or parking, and unfinished progress is revoked when moved', () => {
  const game = createGame(), receiving = game.receivingSystem;
  openIncoming(game); settle(game, 1);
  for (const slot of receiving.slots) {
    receiving.boxes.filter(b => b.receivingLine === slot.line.line).forEach((box, i) => {
      if (slot.line.line === 'B' && i === 1) return;
      move(box.body, slot.x0 + .65 + i * .85, slot.y + .205, (slot.z0 + slot.z1) / 2);
    });
  }
  settle(game, 2);
  assert.deepEqual(game.itemStatus, { A: 2, B: 1 }); assert.equal(game.complete, false);
  const box = receiving.boxes[0], slot = receiving.slots[0];
  move(box.body, 5, .21, -5); settle(game, .4); assert.equal(game.itemStatus.A, 1);
  move(box.body, slot.x0 + .65, slot.y + .205, (slot.z0 + slot.z1) / 2);
  const other = receiving.slots[1], missing = receiving.boxes.filter(b => b.receivingLine === 'B')[1];
  move(missing.body, other.x0 + 1.5, other.y + .205, (other.z0 + other.z1) / 2);
  game.forklift.height = 2; game.forklift.teleport({ x: 5, z: -5 }, 0);
  settle(game, 2);
  assert.equal(receiving.palletsReturned(), false); assert.equal(receiving.parked(), false);
  assert.equal(game.complete, true); assert.equal(game.falls, 0);
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
  openIncoming(game);
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
  const game = createGame(); openIncoming(game);
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
  // Tip the chassis and its jointed carriage together, clear of the floor, so the
  // lift joint does not artificially right a chassis rotated on its own.
  const start = f.body.translation();
  const tip = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 };
  f.body.setTranslation({ x: start.x, y: -.3, z: start.z }, true);
  f.body.setRotation(tip, true);
  f.carriage.setTranslation({ x: start.x - f.height, y: -.3, z: start.z + .95 }, true);
  f.carriage.setRotation(tip, true);
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

test('Dave starts beside the main-floor ladder and can pick it up without moving', async () => {
  const { LAYOUT } = await import('../src/world/layout.js');
  for (const mode of ['single', 'coop']) for (const order of [1, RECEIVING_ORDER.id]) {
    const game = new Game({ mode, order }), dave = game.climber;
    game.assignDevices({ padCount: () => 0, lastDevice: 'kbm' });
    assert.equal(dave.holdingOn, false); assert.equal(dave.onBlades, false);
    assert.ok(Math.hypot(dave.feet.x - LAYOUT.climberSpawn.pos[0], dave.feet.z - LAYOUT.climberSpawn.pos[2]) < .01);
    assert.equal(dave.yaw, LAYOUT.climberSpawn.yaw);
    settle(game, .2);
    dave.updateTarget();
    assert.equal(dave.target?.kind, 'ladder');
    const ladder = dave.target;
    game.active = 'climber'; game.assignDevices({ padCount: () => 0, lastDevice: 'kbm' });
    const blank = Input.prototype.climberActions.call({ invertY: false }, []);
    game.step(1 / 60, { climber: { ...blank, interact: true }, driver: blank });
    assert.equal(dave.ladderCarry, ladder);
    game.dispose();
  }
});

test('five-shelf West-wall racks stock real loaded pallets and preserve backstock hints', async () => {
  const { CONFIG } = await import('../src/config.js');
  const { LAYOUT } = await import('../src/world/layout.js');
  const { collectStack } = await import('../src/systems/wrapping.js');
  const { floorHeightNear, orderLines, ORDERS } = await import('../src/world/level.js');
  const game = new Game({ mode: 'single', order: 3 });
  game.assignDevices({ padCount: () => 0, lastDevice: 'kbm' });
  assert.deepEqual(game.level.order.map(line => line.location), ['H-1-3', 'I-1-5']);
  assert.equal(LAYOUT.mezzanine, undefined);
  assert.equal(game.level.landingRailing, undefined);
  assert.equal(floorHeightNear(-12, 19, 3), 0, 'No invisible mezzanine floor');
  const high = LAYOUT.racks.filter(r => r.palletFromShelf != null);
  assert.equal(high.length, 2);
  for (const rack of high) {
    assert.equal(rack.shelves.length, 5);
    assert.equal(rack.base, 0);
    assert.ok(CONFIG.forklift.liftMax > rack.shelves[4] + .15);
  }
  assert.equal(game.level.storage.slots.length, 24);
  settle(game, 4);
  for (const slot of game.level.storage.slots) {
    assert.ok(slot.seated, `${slot.location} must rest squarely on its deck`);
    assert.equal(slot.pallet.kind, 'wrapped');
    const boxes = loadCartons(slot.pallet).map(r => r.data);
    assert.equal(boxes.length, 6, `${slot.location} holds six physical cartons`);
    assert.ok(boxes.every(b => b.sku === slot.sku), 'One SKU per storage pallet');
    assert.ok(!game.rackDisturbed(slot.rack), 'Stable wrapped stock does not need a rack reset');
  }
  assert.equal(orderLines(ORDERS.find(o => o.id === 4))[0].location, 'E-3-2');
  assert.match(orderLines(ORDERS.find(o => o.id === 4))[0].backstock, /^[HI]-[1-4]-[3-5]$/);
  game.dispose();
});

test('Ralph can lift a loaded storage pallet clear and back out without losing the cartons', async () => {
  const { collectStack } = await import('../src/systems/wrapping.js');
  for (const location of ['H-1-3', 'I-1-5']) {
    const game = new Game({ mode: 'single', order: 3 });
    game.assignDevices({ padCount: () => 0, lastDevice: 'kbm' });
    game.climber.resetToStart();
    settle(game, 2);
    const slot = game.level.storage.slots.find(s => s.location === location);
    const pallet = slot.pallet;
    const fl = game.forklift;
    const blank = Input.prototype.climberActions.call({ invertY: false }, []);
    fl.height = slot.y + .055;
    fl.teleport({ x: slot.rack.home.x + slot.x, z: 20.5 }, 0);
    settle(game, .5);
    for (let i = 0; i < 75; i++) game.step(1 / 60, { climber: blank, driver: { ...blank, liftUp: 1 } });
    assert.ok(pallet.body.translation().y > slot.y + .2, 'Pallet lifts clear of its deck');
    assert.equal(slot.seated, false);
    for (let i = 0; i < 120; i++) game.step(1 / 60, { climber: blank, driver: { ...blank, brake: 1 } });
    assert.ok(pallet.body.translation().z < 21.1, `Loaded pallet clears the rack front: pallet ${JSON.stringify(pallet.body.translation())}, truck ${JSON.stringify(fl.body.translation())}, tipped ${fl.tipped}`);
    assert.equal(loadCartons(pallet).length, 6, JSON.stringify([...collectStack(game, pallet)].map(e => [e.kind, e.sku, e.body.translation()])));
    assert.ok(!game.rackKnocked(slot.rack), 'The truck does not have to shove the rack to retrieve stock');
    // Ease back into the same bay, lower onto the shelf, then withdraw the blades.
    game.active = 'climber'; settle(game, 1.2); game.active = 'driver';
    for (let i = 0; i < 900 && pallet.body.translation().z < 22.12; i++) {
      game.step(1 / 60, { climber: blank, driver: { ...blank, throttle: fl.body.linvel().z < .5 ? .5 : 0 } });
    }
    // Park-deceleration stops the truck while lowering; its own fork motor does the placement.
    game.active = 'climber';
    settle(game, .4);
    game.active = 'driver';
    for (let i = 0; i < 240 && fl.carriage.translation().y > slot.y + .09; i++) {
      game.step(1 / 60, { climber: blank, driver: { ...blank, liftDown: .2 } });
    }
    settle(game, .8);
    assert.ok(slot.seated, `Returned pallet seats at ${JSON.stringify(pallet.body.translation())} truck ${JSON.stringify(fl.body.translation())} gear ${fl.gear} height ${fl.height}`);
    assert.equal(loadCartons(pallet).length, 6);
    for (let i = 0; i < 120; i++) game.step(1 / 60, { climber: blank, driver: { ...blank, brake: 1 } });
    settle(game, .5);
    assert.ok(slot.seated, `Pallet remains seated when forks withdraw: ${JSON.stringify(pallet.body.translation())} fork ${fl.measuredHeight()} target ${fl.height}`);
    assert.ok(!game.rackKnocked(slot.rack), `Return should leave ${location} upright: ${JSON.stringify(slot.rack.body.rotation())}`);
    game.dispose();
  }
});

test('all five POs build wrapped manifests, empty destinations and tutorial-only guidance in both modes', () => {
  assert.equal(RECEIVING_ORDERS.length, 5);
  for (const mode of ['single', 'coop']) for (const spec of RECEIVING_ORDERS) {
    const game = new Game({ mode, order: spec.id });
    game.assignDevices({ padCount: () => 0, lastDevice: 'kbm' });
    const receiving = game.receivingSystem;
    assert.equal(levelDef(spec.id), spec);
    assert.equal(game.level.dock.name, spec.dock);
    assert.equal(receiving.pallets.length, spec.pallets.length);
    const records = receiving.pallets.flatMap(loadCartons);
    for (const line of game.level.order) {
      assert.equal(records.filter(r => r.data.receivingLine === line.line).length, line.qty);
      const slot = receiving.slots.find(s => s.line === line);
      assert.equal(collectStack(game, slot.rack).size, 1); // no physics contacts before first step
      if (line.pallet) assert.equal(game.level.storage.slots.find(s => s.location === line.location).pallet, null);
    }
    assert.equal(receiving.putawaySigns.length, spec.tutorial ? spec.lines.length : 0);
    assert.equal(!!receiving.marker, !!spec.tutorial);
    assert.equal(!!receiving.content('driver'), !!spec.tutorial);
    settle(game, 1);
    game.frame(1 / 60);
    assert.equal(game.complete, false);
    assert.ok(receiving.pallets.every(p => p.kind === 'wrapped'));
    assert.ok(receiving.pallets.every(p => Math.abs(p.body.translation().y - LAYOUT_FOR_TEST.lower.y) < .1));
    game.dispose();
  }
});

test('every receiving level completes on correct putaway without parking or returning empty pallets', () => {
  for (const spec of RECEIVING_ORDERS) {
    const game = new Game({ mode: 'single', order: spec.id });
    game.assignDevices({ padCount: () => 0, lastDevice: 'kbm' });
    const receiving = game.receivingSystem;
    for (const load of [...receiving.pallets]) {
      if (load.contents.some(r => r.data.receivingLine && !game.level.order.find(l => l.line === r.data.receivingLine).pallet)) cutWrapped(game, load);
    }
    for (const slot of receiving.slots) {
      if (slot.line.pallet) {
        const load = receiving.pallets.find(p => p.kind === 'wrapped' && loadCartons(p).every(r => r.data.receivingLine === slot.line.line));
        move(load.body, (slot.x0 + slot.x1) / 2, slot.y + .005, (slot.z0 + slot.z1) / 2);
      } else {
        receiving.boxes.filter(b => b.receivingLine === slot.line.line).forEach((box, i) => {
          move(box.body, slot.x0 + .5 + i * .85, slot.y + .205, (slot.z0 + slot.z1) / 2);
        });
      }
    }
    game.forklift.height = 2; game.forklift.teleport({ x: 5, z: -5 }, .8);
    settle(game, 2.5);
    for (const line of game.level.order) assert.equal(game.itemStatus[line.line], line.qty, `${spec.number} ${line.location}`);
    assert.equal(receiving.parked(), false);
    assert.equal(receiving.palletsReturned(), false);
    assert.equal(game.complete, true, `${spec.number} completes with correct stock only`);
    game.dispose();
  }
});

test('high putaway rejects a wrong bay and unwrapped stock, then accepts the same cartons after rewrapping', () => {
  const game = new Game({ mode: 'single', order: 'receiving-4' });
  game.assignDevices({ padCount: () => 0, lastDevice: 'kbm' });
  const receiving = game.receivingSystem, slot = receiving.slots[0];
  let load = receiving.pallets.find(p => loadCartons(p)[0].data.receivingLine === 'A');
  const wrong = receiving.slots[1];
  move(load.body, (wrong.x0 + wrong.x1) / 2, wrong.y + .005, (wrong.z0 + wrong.z1) / 2);
  settle(game, 1.5); assert.equal(game.itemStatus.A, 0); assert.equal(game.falls, 0);
  const restored = cutWrapped(game, load), pallet = restored.find(e => e.kind === 'pallet');
  const oldPos = pallet.body.translation(), target = { x: (slot.x0 + slot.x1) / 2, y: slot.y + .005, z: (slot.z0 + slot.z1) / 2 };
  for (const ent of restored) {
    const p = ent.body.translation(); move(ent.body, target.x + p.x - oldPos.x, target.y + p.y - oldPos.y, target.z + p.z - oldPos.z);
  }
  settle(game, 1.5); assert.equal(game.itemStatus.A, 0, 'Loose stock in the correct high bay is incomplete');
  load = buildWrapped(game, pallet, collectStack(game, pallet));
  settle(game, 1.5); assert.equal(game.itemStatus.A, 6, 'The same incoming IDs count after rewrapping');
  move(load.body, 5, .01, -5); settle(game, .4); assert.equal(game.itemStatus.A, 0, 'Moving a completed line revokes progress before completion');
  assert.equal(game.complete, false); game.dispose();
});

test('Dave cuts wrap with a sustained hold on fork blades, cancels on release, and preserves picking stock', () => {
  const game = new Game({ mode: 'single', order: 3 });
  game.assignDevices({ padCount: () => 0, lastDevice: 'kbm' });
  settle(game, 1);
  const load = game.level.storage.slots.find(s => s.location === 'H-1-3').pallet;
  const originalIds = loadCartons(load).map(r => r.data.sku);
  game.forklift.height = .8; game.forklift.teleport({ x: 5, z: -5 }, 0);
  move(load.body, 5, .705, -3.4);
  game.active = 'climber'; game.assignDevices({ padCount: () => 0, lastDevice: 'kbm' });
  move(game.climber.body, 6.1, game.climber.centerOff + .02, -3.4);
  game.climber.body.setNextKinematicTranslation(game.climber.body.translation());
  game.climber.yaw = Math.PI / 2;
  settle(game, .2);
  let onForks = false;
  for (let i = 0; i < load.body.numColliders(); i++) game.world.contactPairsWith(load.body.collider(i), other => { if (other.parent()?.handle === game.forklift.carriage.handle) onForks = true; });
  assert.ok(onForks, 'The pallet is supported by the fork blades while Dave cuts');
  const blank = Input.prototype.climberActions.call({ invertY: false }, []);
  for (let i = 0; i < 30; i++) game.step(1 / 60, { climber: { ...blank, interactHeld: true }, driver: blank });
  assert.equal(load.removed, undefined, 'Half a second does not open the pallet');
  game.step(1 / 60, { climber: blank, driver: blank }); assert.equal(game.climber.cutTimer, 0);
  for (let i = 0; i < 70; i++) game.step(1 / 60, { climber: { ...blank, interactHeld: true }, driver: blank });
  assert.equal(load.removed, true, 'A full hold cuts the shrinkwrap');
  const boxes = game.entities.filter(e => e.kind === 'box' && originalIds.includes(e.sku));
  assert.equal(boxes.length, 6);
  assert.ok(boxes.every(b => !b.removed && b.body.isDynamic()));
  game.dispose();
});

test('the stretch wrapper accepts partial stock pallets in picking and receiving, with IDs surviving a second cut', () => {
  for (const order of [3, 'receiving-4']) {
    const game = new Game({ mode: 'single', order });
    game.assignDevices({ padCount: () => 0, lastDevice: 'kbm' }); settle(game, .5);
    const original = game.receiving ? game.receivingSystem.pallets[0] : game.level.storage.slots[0].pallet;
    const restored = cutWrapped(game, original), pallet = restored.find(e => e.kind === 'pallet');
    const cartons = restored.filter(e => e.kind === 'box'), zone = game.level.wrapZone.center;
    move(pallet.body, zone.x, .005, zone.z);
    cartons.forEach((box, i) => move(box.body, i < 3 ? zone.x + (i % 2 ? .2 : -.2) : 8 + i, i < 3 ? .365 : .205, i < 3 ? zone.z + (Math.floor(i / 2) - 1) * .4 : -4));
    game.forklift.teleport({ x: 8, z: -5 }, 0);
    settle(game, 5.5);
    const wrapped = game.entities.find(e => e.kind === 'wrapped' && Math.hypot(e.body.translation().x - zone.x, e.body.translation().z - zone.z) < .5);
    assert.ok(wrapped, 'A stock pallet can be wrapped without matching a shipping order');
    assert.equal(loadCartons(wrapped).length, 3);
    assert.equal(wrapped.skus[cartons[0].sku], 3);
    const ids = loadCartons(wrapped).map(r => r.data.incomingId);
    const reopened = cutWrapped(game, wrapped).filter(e => e.kind === 'box');
    assert.equal(reopened.length, 3);
    assert.deepEqual(reopened.map(e => e.incomingId), ids);
    assert.ok(reopened.every(e => !e.removed && e.body.isDynamic()));
    game.dispose();
  }
});
