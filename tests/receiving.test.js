import { emptyPalletSlots } from '../src/world/stock-profile.js';
import { CONFIG } from '../src/config.js';
import test from 'node:test';
import * as THREE_FOR_VIEW_TEST from 'three';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import RAPIER from '@dimforge/rapier3d-compat';
import { FREIGHT_STOCK } from '../src/world/freight-stock.js';
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
const { createPallet: createPalletForTest } = await import('../src/entities/pallet.js');
const { createFreight: createFreightForTest } = await import('../src/entities/freight.js');
const { createBox: createBoxForTest } = await import('../src/entities/box.js');
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
    assert.equal(game.receiving, false); assert.notEqual(receiving.dock.name, game.level.dock.name);
    assert.equal(receiving.pallets.length, 2);
    assert.ok(receiving.pallets.every(p => ['wrapped', 'freight'].includes(p.kind)));
    assert.equal(receiving.pallets.flatMap(loadCartons).length, 4);
    assert.ok(receiving.pallets.every(p => receiving.dockZone.contains(p.body.translation())));
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

test('correct putaway is credited permanently, without cleanup or parking', () => {
  const game = createGame(), receiving = game.receivingSystem;
  openIncoming(game); settle(game, 1);
  for (const slot of receiving.slots) {
    receiving.boxes.filter(b => b.receivingLine === slot.line.line).forEach((box, i) => {
      if (slot.line.line === 'B' && i === 1) return;
      move(box.body, slot.x0 + .65 + i * .85, slot.y + .205, (slot.z0 + slot.z1) / 2);
    });
  }
  settle(game, 2);
  assert.deepEqual(game.receivingStatus, { A: 2, B: 1 }); assert.equal(game.complete, false);
  const box = receiving.boxes[0], slot = receiving.slots[0];
  move(box.body, 5, .21, -5); settle(game, .4); assert.equal(game.receivingStatus.A, 2);
  move(box.body, slot.x0 + .65, slot.y + .205, (slot.z0 + slot.z1) / 2);
  const other = receiving.slots[1], missing = receiving.boxes.filter(b => b.receivingLine === 'B')[1];
  move(missing.body, other.x0 + 1.5, other.y + .205, (other.z0 + other.z1) / 2);
  game.forklift.height = 2; game.forklift.teleport({ x: 5, z: -5 }, 0);
  settle(game, 2);
  assert.equal(receiving.palletsReturned(), false); assert.equal(receiving.parked(), false);
  assert.equal(game.jobDone.receiving, true); assert.equal(game.falls, 0);
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

test('paired Practice preserves shipping stock and builds incoming pallets immediately', () => {
  const game = new Game({ mode: 'single', order: 1 });
  assert.equal(game.receiving, false); assert.ok(game.receivingSystem);
  assert.ok(game.tutorial); assert.equal(game.level.order[0].sku, 355);
  assert.ok(game.entities.some(box => box.kind === 'box' && box.sku === 355 && box.home?.rack === 'A'));
  assert.ok(game.receivingSystem.pallets.length > 0);
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
  assert.equal(game.receivingStatus.A, 2, 'Stable front-beam placement must count alongside the other box');
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
  assert.equal(docks['Dock 2'].dock.wall, 'north');
  assert.equal(docks['Dock 3'].dock.wall, 'north');
  assert.ok(docks['Dock 2'].dock.at < docks['Dock 3'].dock.at);
  for (const name of ['Dock 2', 'Dock 3']) {
    for (const [dockName, dock] of Object.entries(docks)) dock.setOpen(dockName === name);
    game.world.step();
    const dock = docks[name].dock;
    const ray = new RAPIER.Ray({ x: dock.at, y: -.1, z: -22.7 }, { x: 0, y: 0, z: -1 });
    const hit = game.world.castRay(ray, 2, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
    assert.equal(hit, null, `${name} must have no wall collider across its open doorway`);
  }
  game.dispose();
});

test('tipping reports an incident without a blast; Ralph looks vertically and reads the clipboard from Pause', () => {
  const game = createGame(), forklift = game.forklift;
  forklift.lookYaw = .8;
  const pitch = forklift.lookPitch;
  forklift.look({ lookX: 1, lookY: .1 }, true);
  assert.equal(forklift.lookYaw, 0); assert.notEqual(forklift.lookPitch, pitch);
  forklift.lookPitch = -.36;
  game.frame(.8);
  assert.equal(game.receivingSystem.read, false, 'Looking at the old clipboard position does not advance reading');
  assert.equal(forklift.clipboard.group.visible, false);
  game.readClipboard();
  assert.equal(game.receivingSystem.read, true, 'Pause clipboard advances the receiving guide');
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

test('Dave starts with a rack overview and can quickly walk to the main-floor ladder', async () => {
  const { LAYOUT } = await import('../src/world/layout.js');
  for (const mode of ['single', 'coop']) for (const order of [1, RECEIVING_ORDER.id]) {
    const game = new Game({ mode, order }), dave = game.climber;
    game.assignDevices({ padCount: () => 0, lastDevice: 'kbm' });
    assert.equal(dave.holdingOn, false); assert.equal(dave.onBlades, false);
    assert.ok(Math.hypot(dave.feet.x - LAYOUT.climberSpawn.pos[0], dave.feet.z - LAYOUT.climberSpawn.pos[2]) < .01);
    assert.equal(dave.yaw, LAYOUT.climberSpawn.yaw);
    const stand = LAYOUT.ladderStands[0];
    assert.ok(Math.hypot(dave.feet.x - stand.x, dave.feet.z - stand.z) < 7, 'ladder stays a short walk away');
    const facing = new THREE_FOR_VIEW_TEST.Vector3(0, 0, -1).applyAxisAngle(new THREE_FOR_VIEW_TEST.Vector3(0, 1, 0), dave.yaw);
    assert.ok(facing.x < -.5 && facing.z > .7, 'spawn faces across the aisle entrances');
    move(dave.body, stand.x + 1, dave.centerOff, stand.z);
    dave.body.setNextKinematicTranslation(dave.body.translation());
    dave.yaw = Math.PI / 2;
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
  assert.deepEqual(game.level.order.map(line => line.location), ['Z-1-3', 'Y-1-5', 'Z-1-5']);
  assert.equal(LAYOUT.mezzanine, undefined);
  assert.equal(game.level.landingRailing, undefined);
  assert.equal(floorHeightNear(-12, 19, 3), 0, 'No invisible mezzanine floor');
  const high = LAYOUT.racks.filter(r => r.palletFromShelf != null);
  assert.equal(high.length, 3);
  for (const rack of high) {
    assert.equal(rack.shelves.length, 5);
    assert.equal(rack.base, 0);
    assert.ok(CONFIG.forklift.liftMax > rack.shelves[4] + .15);
  }
  assert.equal(game.level.storage.slots.length, 38);
  assert.equal(game.level.storage.slots.filter(s => s.kind === 'freight').length, 10);
  assert.equal(game.level.storage.slots.filter(s => s.kind === 'wrapped').length, 28);
  settle(game, 4);
  let openSlots = 0;
  for (const slot of game.level.storage.slots) {
    if (emptyPalletSlots.includes(slot.location)) {
      assert.equal(slot.pallet, null); assert.equal(slot.seated, false); openSlots++; continue;
    }
    assert.ok(slot.seated, `${slot.location} must rest squarely on its deck`);
    assert.equal(slot.pallet.kind, slot.kind);
    if (slot.kind === 'freight') {
      assert.equal(slot.pallet.sku, FREIGHT_STOCK[slot.location].sku);
      assert.ok(Math.abs(slot.pallet.body.mass() - FREIGHT_STOCK[slot.location].mass) < .1);
      continue;
    }
    const boxes = loadCartons(slot.pallet).map(r => r.data);
    assert.equal(boxes.length, 6, `${slot.location} holds six physical cartons`);
    assert.ok(boxes.every(b => b.sku === slot.sku), 'One SKU per storage pallet');
    assert.ok(!game.rackDisturbed(slot.rack), 'Stable wrapped stock does not need a rack reset');
  }
  assert.equal(openSlots, 5);
  assert.equal(orderLines(ORDERS.find(o => o.id === 4))[0].location, 'E-3-2');
  assert.match(orderLines(ORDERS.find(o => o.id === 4))[0].backstock, /^[XYZ]-[1-4]-[3-5]$/);
  game.dispose();
});

test('Ralph can lift a loaded storage pallet clear and back out without losing the cartons', async () => {
  const { collectStack } = await import('../src/systems/wrapping.js');
  for (const location of ['Z-1-3', 'Y-1-5']) {
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
    assert.equal(levelDef(spec.id).receiving.id, spec.id);
    assert.equal(receiving.dock.name, game.receivingSpec.dock);
    assert.notEqual(receiving.dock.name, game.level.dock.name);
    assert.equal(receiving.pallets.length, spec.pallets.length);
    const records = [...receiving.pallets.flatMap(loadCartons), ...receiving.pallets.filter(p => p.kind === 'freight').map(p => ({ data: p }))];
    for (const line of receiving.order) {
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
    assert.ok(receiving.pallets.every(p => ['wrapped', 'freight'].includes(p.kind)));
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
      if (load.kind === 'wrapped' && load.contents.some(r => r.data.receivingLine && !receiving.order.find(l => l.line === r.data.receivingLine).pallet)) cutWrapped(game, load);
    }
    for (const slot of receiving.slots) {
      if (slot.line.pallet) {
        const load = receiving.pallets.find(p => slot.line.freight ? p.kind === 'freight' && p.receivingLine === slot.line.line : p.kind === 'wrapped' && loadCartons(p).every(r => r.data.receivingLine === slot.line.line));
        move(load.body, (slot.x0 + slot.x1) / 2, slot.y + .005, (slot.z0 + slot.z1) / 2);
      } else {
        receiving.boxes.filter(b => b.receivingLine === slot.line.line).forEach((box, i) => {
          move(box.body, slot.x0 + .5 + i * .85, slot.y + .205, (slot.z0 + slot.z1) / 2);
        });
      }
    }
    game.forklift.height = 2; game.forklift.teleport({ x: 5, z: -5 }, .8);
    settle(game, 2.5);
    for (const line of receiving.order) assert.equal(game.receivingStatus[line.line], line.qty, `${spec.number} ${line.location}`);
    assert.equal(receiving.parked(), false);
    assert.equal(receiving.palletsReturned(), false);
    assert.equal(game.jobDone.receiving, true, `${spec.number} completes with correct stock only`);
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
  settle(game, 1.5); assert.equal(game.receivingStatus.A, 0); assert.equal(game.falls, 0);
  const restored = cutWrapped(game, load), pallet = restored.find(e => e.kind === 'pallet');
  const oldPos = pallet.body.translation(), target = { x: (slot.x0 + slot.x1) / 2, y: slot.y + .005, z: (slot.z0 + slot.z1) / 2 };
  for (const ent of restored) {
    const p = ent.body.translation(); move(ent.body, target.x + p.x - oldPos.x, target.y + p.y - oldPos.y, target.z + p.z - oldPos.z);
  }
  settle(game, 1.5); assert.equal(game.receivingStatus.A, 0, 'Loose stock in the correct high bay is incomplete');
  load = buildWrapped(game, pallet, collectStack(game, pallet));
  settle(game, 1.5); assert.equal(game.receivingStatus.A, 6, 'The same incoming IDs count after rewrapping');
  move(load.body, 5, .01, -5); settle(game, .4); assert.equal(game.receivingStatus.A, 6, 'Accepted receiving credit survives later use of the stock');
  assert.equal(game.complete, false); game.dispose();
});

test('Dave cuts wrap with a sustained hold on fork blades, cancels on release, and preserves picking stock', () => {
  const game = new Game({ mode: 'single', order: 3 });
  game.assignDevices({ padCount: () => 0, lastDevice: 'kbm' });
  settle(game, 1);
  const load = game.level.storage.slots.find(s => s.location === 'Z-1-3').pallet;
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

test('strapped freight crates are forklift-only and Ralph can lift and transport their full weight', () => {
  for (const order of [1, 'receiving-1']) {
    const game = new Game({ mode: 'single', order });
    game.assignDevices({ padCount: () => 0, lastDevice: 'kbm' });
    settle(game, .5);
    const crates = game.entities.filter(e => e.kind === 'freight' && !e.storageLocation);
    assert.equal(crates.length, 0, 'no prototype crate spawns on the floor');
    const crate = createFreightForTest(game, { pos: [5.8, .005, 0], yaw: 0, sku: 980, mass: 350 }), start = { ...crate.body.translation() };
    assert.equal(crate.sku, 980); assert.ok(Math.abs(crate.body.mass() - 350) < .1);
    game.climber.pickUp(crate);
    assert.equal(game.climber.carried, null); assert.equal(crate.body.isDynamic(), true);
    assert.equal(game.climber.canDragPallet(crate), false);
    move(game.climber.body, start.x, game.climber.centerOff + .02, start.z - 1.6);
    game.climber.body.setNextKinematicTranslation(game.climber.body.translation());
    game.climber.yaw = Math.PI; game.climber.pitch = -.3;
    game.active = 'climber'; game.assignDevices({ padCount: () => 0, lastDevice: 'kbm' });
    settle(game, .2); game.climber.updateTarget();
    assert.equal(game.climber.target, crate, 'Dave can identify the crate');
    const blank = Input.prototype.climberActions.call({ invertY: false }, []);
    for (let i = 0; i < 75; i++) game.step(1 / 60, { climber: { ...blank, interact: i === 0, interactHeld: true }, driver: blank });
    assert.equal(game.climber.carried, null); assert.equal(game.climber.cutTarget, null);
    assert.ok(Math.abs(crate.body.translation().z - start.z) < .02);
    move(game.climber.body, 8, game.climber.centerOff + .02, 2);
    game.climber.body.setNextKinematicTranslation(game.climber.body.translation());
    const fl = game.forklift;
    fl.height = .1; fl.teleport({ x: start.x, z: start.z - 1.8 }, 0);
    game.active = 'driver'; game.assignDevices({ padCount: () => 0, lastDevice: 'kbm' });
    settle(game, .5);
    for (let i = 0; i < 150; i++) game.step(1 / 60, { climber: blank, driver: { ...blank, liftUp: 1 } });
    assert.ok(crate.body.translation().y > .5, 'Forks lift the loaded pallet clear of the floor');
    for (let i = 0; i < 120; i++) game.step(1 / 60, { climber: blank, driver: { ...blank, brake: 1 } });
    assert.ok(crate.body.translation().z < start.z - 1, 'The heavy load travels with the truck');
    assert.equal(crate.body.numColliders(), 5, 'Pallet and strapped crate remain one rigid load');
    assert.equal(fl.tipped, false); game.dispose();
  }
});

function shippingLoad(game, lines, wrapped = true) {
  const pallet = createPalletForTest(game, { pos: [8, .005, -3] });
  const set = new Set([pallet]);
  let index = 0;
  for (const line of lines) for (let i = 0; i < line.qty; i++, index++) {
    const box = createBoxForTest(game, { type: 'small', sku: line.sku,
      pos: [8 + (index % 2 ? .2 : -.2), .165 + Math.floor(index / 6) * .4, -3 + (Math.floor(index / 2) % 3 - 1) * .4] });
    set.add(box);
  }
  return wrapped ? buildWrapped(game, pallet, set) : { pallet, set };
}
function deliver(game, load, offset = 0) {
  const dock = game.level.dockZone;
  move(load.body, dock.center.x, dock.floorY + .005, dock.center.z + offset);
}

test('mixed picking orders count separate delivered loads, reject loose cartons, and revoke loads removed from the trailer', async () => {
  const game = new Game({ mode: 'single', order: 3 });
  game.assignDevices({ padCount: () => 0, lastDevice: 'kbm' });
  const [a, b, c] = game.level.order;
  assert.equal(c.freight, true); assert.equal(c.qty, 1);
  const crate = game.entities.find(e => e.kind === 'freight' && e.sku === c.sku);
  const zone = game.level.dockZone;
  crate.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
  move(crate.body, zone.center.x, zone.floorY + .08, zone.center.z);
  crate.body.setNextKinematicTranslation(crate.body.translation());
  settle(game, 1); assert.equal(game.itemStatus.C, 0, 'A load hovering above the trailer floor does not count');
  crate.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
  deliver(game, crate, 0); settle(game, 1);
  assert.deepEqual(game.itemStatus, { A: 0, B: 0, C: 1 }); assert.equal(game.complete, false);
  const loose = shippingLoad(game, [a], false);
  const old = { ...loose.pallet.body.translation() }, dock = game.level.dockZone;
  for (const ent of loose.set) {
    const p = ent.body.translation(); move(ent.body, dock.center.x + p.x - old.x, dock.floorY + .005 + p.y - old.y, dock.center.z - 2 + p.z - old.z);
  }
  settle(game, 1); assert.equal(game.itemStatus.A, 0, 'Unwrapped cartons do not count');
  const cartonLoad = buildWrapped(game, loose.pallet, collectStack(game, loose.pallet));
  settle(game, 1); assert.deepEqual(game.itemStatus, { A: 2, B: 0, C: 1 });
  move(crate.body, 5.8, .005, -3); settle(game, .3); assert.equal(game.itemStatus.C, 0);
  const fakeCrate = shippingLoad(game, [{ sku: c.sku, qty: 1 }]);
  deliver(game, fakeCrate, 4); settle(game, 1); assert.equal(game.itemStatus.C, 0, 'A carton with a crate SKU is not a heavy unit');
  deliver(game, crate, 0);
  const finalLoad = shippingLoad(game, [b]); deliver(game, finalLoad, 2);
  settle(game, 1);
  assert.equal(game.jobDone.shipping, true); assert.equal(game.complete, false); assert.deepEqual(game.itemStatus, { A: 2, B: 1, C: 1 });
  assert.equal(game.falls, 0); assert.equal(cartonLoad.kind, 'wrapped'); game.dispose();
});

test('completed shipping leaves its clipboard and counts intact while receiving remains active', () => {
  const game = new Game({ mode: 'single', order: 3 });
  game.assignDevices({ padCount: () => 0, lastDevice: 'kbm' });
  const cartons = shippingLoad(game, game.level.order.filter(line => !line.freight));
  deliver(game, cartons, -1.5);
  for (const line of game.level.order.filter(l => l.freight)) deliver(game, game.entities.find(e => e.kind === 'freight' && e.sku === line.sku), 1.5);
  settle(game, 1);
  assert.equal(game.jobDone.shipping, true); assert.equal(game.complete, false);
  const before = { ...game.itemStatus };
  settle(game, 1); assert.deepEqual(game.itemStatus, before);
  assert.equal(game.orderId, 3); assert.equal(cartons.removed, true);
  assert.ok(game.receivingSystem.pallets.length > 0);
  game.dispose();
});

test('Ralph can retrieve strapped crates from both low and high West-wall bays without snagging the rack', () => {
  for (const location of ['Z-4-1', 'Z-1-5', 'Z-4-4']) {
    const game = new Game({ mode: 'single', order: 1 });
    game.assignDevices({ padCount: () => 0, lastDevice: 'kbm' }); settle(game, 1);
    const slot = game.level.storage.slots.find(s => s.location === location), crate = slot.pallet;
    const fl = game.forklift, blank = Input.prototype.climberActions.call({ invertY: false }, []);
    assert.equal(crate.kind, 'freight');
    fl.height = slot.y + .055; fl.teleport({ x: slot.rack.home.x + slot.x, z: 20.5 }, 0);
    settle(game, .5);
    // Allow enough lift before release; upward coasting is now much shorter.
    for (let i = 0; i < 45; i++) game.step(1 / 60, { climber: blank, driver: { ...blank, liftUp: 1 } });
    settle(game, .3);
    assert.ok(crate.body.translation().y > slot.y + .08, `${location} clears its deck (${crate.body.translation().y} vs ${slot.y + .08})`);
    assert.equal(slot.seated, false);
    for (let i = 0; i < 120; i++) game.step(1 / 60, { climber: blank, driver: { ...blank, brake: 1 } });
    assert.ok(crate.body.translation().z < 21, `${location} leaves the bay on the forks`);
    assert.ok(!game.rackKnocked(slot.rack));
    assert.equal(fl.tipped, false); assert.equal(crate.body.numColliders(), 5);
    game.dispose();
  }
});

test('crate locations never replace a referenced carton reserve', async () => {
  const warehouse = (await import('../src/world/warehouse-v1.json')).default;
  for (const [pick, reserve] of Object.entries(warehouse.signs)) {
    assert.equal(FREIGHT_STOCK[reserve], undefined, `${pick} must still point to cartons`);
    const pickSkus = warehouse.faces[pick].filter(Boolean).map(spot => spot[0]);
    assert.ok(warehouse.faces[reserve].length === 6);
    assert.ok(warehouse.faces[reserve].every(spot => pickSkus.includes(spot[0])), 'The pointer leads to the matching SKU');
  }
});

test('heavy receiving counts only the incoming single unit in its assigned bay', () => {
  const game = new Game({ mode: 'single', order: 'receiving-4' });
  game.assignDevices({ padCount: () => 0, lastDevice: 'kbm' });
  const receiving = game.receivingSystem, slot = receiving.slots.find(s => s.line.freight);
  const pos = [(slot.x0 + slot.x1) / 2, slot.y + .005, (slot.z0 + slot.z1) / 2];
  const substitute = createFreightForTest(game, { ...slot.line, pos });
  settle(game, 1.5); assert.equal(game.receivingStatus[slot.line.line], 0, 'Existing warehouse stock with the same SKU cannot replace the shipment');
  game.world.removeRigidBody(substitute.body); game.scene.remove(substitute.mesh); game.removeEntity(substitute);
  const incoming = receiving.pallets.find(p => p.kind === 'freight');
  const wrong = receiving.slots.find(s => !s.line.freight);
  move(incoming.body, (wrong.x0 + wrong.x1) / 2, wrong.y + .005, (wrong.z0 + wrong.z1) / 2);
  settle(game, 1.5); assert.equal(game.receivingStatus[slot.line.line], 0);
  move(incoming.body, ...pos);
  settle(game, 1.5); assert.equal(game.receivingStatus[slot.line.line], 1);
  assert.equal(incoming.kind, 'freight'); assert.equal(game.falls, 0); game.dispose();
});

test('all five picking orders finish with their required secured cartons and whole freight units', async () => {
  const { ORDERS } = await import('../src/world/level.js');
  for (const order of ORDERS) {
    const game = new Game({ mode: 'single', order: order.id });
    game.assignDevices({ padCount: () => 0, lastDevice: 'kbm' });
    const cartons = shippingLoad(game, game.level.order.filter(line => !line.freight));
    deliver(game, cartons, -1.5);
    for (const line of game.level.order.filter(l => l.freight)) {
      const crate = game.entities.find(e => e.kind === 'freight' && e.sku === line.sku);
      assert.ok(crate, `Order ${order.id} has a fixed physical crate home`);
      deliver(game, crate, 1.5);
    }
    settle(game, 1);
    assert.equal(game.jobDone.shipping, true, `Order ${order.id} finishes shipping`);
    assert.equal(game.complete, false);
    for (const line of game.level.order) assert.equal(game.itemStatus[line.line], line.qty);
    game.dispose();
  }
});

test('fork camera follows the physical carriage independently of driver look and requested lift', () => {
  const game = createGame(), f = game.forklift;
  const p = f.carriage.translation();
  f.carriage.setTranslation({ ...p, y: p.y + 4 }, true);
  f.updateCamera();
  const position = f.forkCamera.position.clone(), rotation = f.forkCamera.quaternion.clone();
  f.lookPitch = 1; f.height = 7;
  f.updateCamera();
  assert.ok(position.distanceTo(f.forkCamera.position) < 1e-8);
  assert.ok(rotation.equals(f.forkCamera.quaternion));
  assert.ok(Math.abs(position.y - (p.y + 4.45)) < 1e-5);
  game.dispose();
});

test('high fork feed renders only for Ralph and stays inside his split-screen viewport', () => {
  const game = createGame(), f = game.forklift;
  f.measuredHeight = () => 4;
  let viewport, calls = [];
  const renderer = { shadowMap: {}, setScissorTest() {}, setScissor() {}, clearDepth() {},
    setViewport(...args) { viewport = args; }, render(scene, camera) { calls.push({ camera, viewport }); } };
  game.active = 'driver'; game.render(renderer, 1000, 800);
  assert.equal(calls.length, 2); assert.equal(calls[1].camera, f.forkCamera);
  calls = []; game.active = 'climber'; game.render(renderer, 1000, 800);
  assert.equal(calls.length, 1); assert.equal(calls[0].camera, game.climber.camera);
  calls = []; game.mode = 'coop'; game.render(renderer, 1000, 800);
  assert.equal(calls.length, 3);
  const [, y, , h] = calls[2].viewport;
  assert.ok(y >= 0 && y + h <= 400);
  calls = []; f.forkViewExpanded = true; game.render(renderer, 1000, 800);
  assert.equal(calls.length, 2); assert.equal(calls[1].camera, f.forkCamera);
  game.dispose();
});


test('sustained lifting reaches high racks quickly while taps and release stay precise', () => {
  const game = createGame(), f = game.forklift;
  const blank = Input.prototype.driverActions.call({ invertY: false }, []);
  const tick = (seconds, up) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) game.step(1 / 60, { driver: { ...blank, liftUp: up }, climber: blank });
  };
  tick(0.15, 1); tick(0.3, 0);
  assert.ok(f.height < 0.14, 'a short tap should only lift a few centimetres');
  tick(7.5, 1);
  assert.ok(f.measuredHeight() > 8, 'physical blades should reach the highest pallet pockets within eight seconds');
  const released = f.height;
  tick(0.3, 0);
  assert.ok(f.height - released < 0.1, 'release should arrest upward motion promptly');
  game.dispose();
});


test('Ralph sees both lowered fork tips looking level in single-player and split-screen', () => {
  const game = createGame(), f = game.forklift;
  settle(game, 0.5);
  assert.equal(f.lookPitch, 0);
  f.updateCamera();
  const { Vector3, Quaternion } = THREE_FOR_VIEW_TEST;
  const q = f.carriage.rotation(), t = f.carriage.translation();
  for (const aspect of [16 / 9, 32 / 9, 4 / 3]) {
    f.camera.aspect = aspect;
    f.camera.updateProjectionMatrix(); f.camera.updateMatrixWorld(true);
    for (const x of [-0.225, 0.225]) {
      const tip = new Vector3(x, 0, 1.06).applyQuaternion(new Quaternion(q.x, q.y, q.z, q.w)).add(t).project(f.camera);
      assert.ok(Math.abs(tip.x) < 0.9 && tip.y > -0.98 && tip.y < -0.4 && tip.z < 1, `tip remains comfortably inside forward view at aspect ${aspect}: ${tip.y}`);
    }
  }
  assert.equal(f.clipboard.group.scale.x, 0.82);
  game.dispose();
});

test('approved layout preserves rack, cage, conveyor and stair clearances', async () => {
  const { LAYOUT, rackX1 } = await import('../src/world/layout.js');
  const { STAIRS, floorHeightAt } = await import('../src/world/level.js');
  const [x, y, z] = LAYOUT.racks.filter(r => r.palletFromShelf != null);
  assert.deepEqual([x.name, y.name, z.name], ['Z', 'Y', 'X']);
  assert.ok(Math.abs(y.x0 - rackX1(x) - 2.6) < 1e-8);
  assert.ok(Math.abs(z.x0 - rackX1(y) - 2.6) < 1e-8);
  const gaps = LAYOUT.ladderStands.filter(s => s.z > 20);
  assert.deepEqual(gaps.map(s => s.x), [-6.7, 6.7]);
  const cage = LAYOUT.hazards.fireExits[0], belt = LAYOUT.conveyors[0];
  assert.equal(cage.wall, 'east');
  assert.ok(Math.abs(z.z0 - (cage.at + cage.width / 2) - 10) < 1e-8);
  assert.ok(belt.z1 < cage.at - cage.width / 2);
  assert.equal(belt.backstop, false);
  assert.equal(belt.z0 + LAYOUT.room.halfZ, 2);
  assert.equal(LAYOUT.pallets.length, LAYOUT.conveyors.length, 'only conveyor catch pallets remain on the main floor');
  assert.equal(LAYOUT.breakRoom, undefined);
  assert.deepEqual(LAYOUT.decorativeDoors.map(d => d.label), ['OFFICE', 'BATHROOM', 'BATHROOM']);
  assert.ok(LAYOUT.decorativeDoors.every(d => d.at > LAYOUT.ramp.x1 && d.at + d.width / 2 < belt.x0));
  assert.equal(STAIRS.from, -LAYOUT.room.halfX);
  assert.ok(Math.abs(STAIRS.to - LAYOUT.racks[0].x0) < 1e-8);
  const across = (STAIRS.from + STAIRS.to) / 2;
  assert.ok(floorHeightAt(across, STAIRS.edge - .15) < 0);
  assert.ok(floorHeightAt(across, STAIRS.edge - 1.7) <= -.8);
});


test('incident sign is removed and leaking pipe is beside the conveyor wall switch', () => {
  const game = createGame(), belt = LAYOUT_FOR_TEST.conveyors[0];
  assert.equal(game.incidentSign, undefined);
  assert.equal(LAYOUT_FOR_TEST.incidentSign, undefined);
  const pipe = game.scene.getObjectByName('Leaking conveyor pipe');
  assert.ok(pipe);
  game.scene.updateMatrixWorld(true);
  const point = pipe.getWorldPosition(new THREE_FOR_VIEW_TEST.Vector3());
  assert.ok(point.x > belt.x0 && point.x < belt.x1);
  const control = game.level.conveyors[0].powerSwitch;
  assert.ok(Math.abs(point.z - control.position.z) < 1.6, 'pipe and panel are at the switch end');
  const slow = game.scene.getObjectByName('Conveyor switch LOW');
  const fast = game.scene.getObjectByName('Conveyor switch HIGH');
  assert.ok(slow.position.z < control.position.z && fast.position.z > control.position.z);
  assert.equal(slow.visible, true); assert.equal(fast.visible, true);
  assert.ok(point.y > belt.height + 2);
  game.dispose();
});

test('Dave switches the long conveyor to permanent high power', () => {
  const game = createGame(), belt = game.level.conveyors[0], control = belt.powerSwitch;
  const low = belt.velocity.z;
  assert.ok(control); assert.equal(control.high, false);
  assert.equal(game.level.conveyors[1].powerSwitch, null);
  game.active = 'climber';
  game.assignDevices({ padCount: () => 0, lastDevice: 'kbm' });
  const c = game.climber, p = control.position;
  move(c.body, p.x - 1, c.centerOff, p.z);
  settle(game, .2);
  c.yaw = -Math.PI / 2;
  c.pitch = Math.atan2(p.y - c.eye.y, p.x - c.eye.x);
  c.grounded = true; c.updateTarget();
  assert.equal(c.target, control, 'real sightline and reach select the switch');
  const blank = Input.prototype.climberActions.call({ invertY: false }, []);
  game.step(1 / 60, { driver: blank, climber: { ...blank, interact: true } });
  assert.equal(control.high, true);
  assert.ok(Math.abs(belt.velocity.z - low * 10) < 1e-8);
  assert.equal(control.activate(), false, 'shorted switch cannot be toggled back');
  belt.update(2);
  assert.equal(control.high, true);
  assert.ok(Math.abs(belt.velocity.z - low * 10) < 1e-8);
  game.dispose();
  const next = createGame();
  assert.equal(next.level.conveyors[0].powerSwitch.high, false, 'new run starts at low power');
  next.dispose();
});

test('high conveyor throws Dave into the East wall and records one incident; low stays safe', () => {
  for (const high of [false, true]) {
    const game = createGame(), c = game.climber, belt = game.level.conveyors[0], spec = LAYOUT_FOR_TEST.conveyors[0];
    const control = belt.powerSwitch;
    assert.ok(control.position.x > spec.x1 - .1, 'switch is mounted on the wall');
    assert.ok(control.position.z > spec.z1 && control.position.z < spec.z1 + 1.5, 'switch is at the cage-side end');
    if (high) control.activate();
    game.active = 'climber'; game.assignDevices({ padCount: () => 0, lastDevice: 'kbm' });
    move(c.body, (spec.x0 + spec.x1) / 2, spec.height + c.centerOff + .02, spec.z0 + 5);
    let incidents = 0, hitAt;
    game.onIncident = () => { incidents++; hitAt = { ...c.body.translation() }; };
    const blank = Input.prototype.climberActions.call({ invertY: false }, []);
    for (let i = 0; i < 420 && !incidents; i++) game.step(1 / 60, { driver: blank, climber: blank });
    if (high) {
      assert.equal(c.state, 'ragdoll'); assert.equal(incidents, 1);
      assert.ok(hitAt.z < -LAYOUT_FOR_TEST.room.halfZ + .7, `impact occurs at the East wall: ${hitAt.z}`);
      let lateSpark = false;
      for (let i = 0; i < 90; i++) {
        belt.update(.1);
        if (i > 15 && game.scene.children.some(o => o.isPointLight && o.intensity > 0 && o.position.distanceTo(control.position) < .5)) lateSpark = true;
      }
      assert.ok(lateSpark, 'shorted switch continues sparking after initial burst');
    } else assert.equal(incidents, 0);
    game.dispose();
  }
});

test('ceiling keeps half its rows clear of ducts, with dead lights and one sparking light', () => {
  const game = createGame(), lighting = game.level.lighting;
  assert.equal(lighting.rows.length, Math.floor(lighting.originalRowCount / 2));
  assert.equal(new Set(lighting.fixtures.map(p => p[2])).size, lighting.rows.length);
  for (const z of lighting.rows) for (const duct of LAYOUT_FOR_TEST.ceiling.ducts) {
    assert.ok(Math.abs(z - duct.z) >= duct.r + .45, 'fixtures and chains clear exposed ducts');
  }
  assert.ok(lighting.outCount >= 2);
  assert.equal(lighting.faultyCount, 1);
  assert.ok(game.scene.getObjectByName('Sparking ceiling light'));
  let bursts = 0;
  const previousRandom = Math.random;
  try {
    Math.random = () => .5;
    const light = game.scene.children.find(o => o.isPointLight && o.position.y > 7);
    for (let i = 0; i < 100; i++) { lighting.update(.1); if (light.intensity > 0) bursts++; }
    assert.ok(bursts >= 3, 'faulty light repeatedly flashes and sparks');
  } finally { Math.random = previousRandom; game.dispose(); }
});

test('forklift knocks a hanging light down once and it ignites only on the floor', () => {
  const game = createGame(), f = game.forklift, lighting = game.level.lighting;
  settle(game, .4);
  assert.ok(lighting.units.every(u => !u.broken && !u.burning));
  const unit = lighting.units.find(u => u.mesh.position.x > 8 && u.mesh.position.z > 0 && u.mesh.position.z < 8);
  assert.ok(unit);
  const point = unit.body.translation();
  f.height = point.y - .45;
  f.teleport({ x: point.x, z: point.z - .95 }, 0);
  settle(game, .1);
  assert.equal(unit.broken, true, 'real forklift contact releases fixture');
  assert.ok(game.damage.entries.some(e => e.id.startsWith('light:') && e.amount === 200));
  assert.equal(unit.chains.visible, false);
  assert.equal(unit.burning, false, 'fixture does not burn while high above floor');
  assert.equal(game.entities.filter(e => e.body.handle === unit.body.handle).length, 1);
  f.height = .1; f.teleport({ x: 5, z: -5 }, 0);
  settle(game, 3);
  assert.equal(unit.burning, true);
  assert.ok(unit.fire);
  assert.ok(unit.body.translation().y < .4);
  assert.equal(game.entities.filter(e => e.body.handle === unit.body.handle).length, 1, 'fixture cannot detach twice');
  game.dispose();
});

test('single stretching mast stays connected without adding bars across Ralph’s view', () => {
  const game = createGame(), f = game.forklift;
  assert.equal(f.innerMast.length, 3, 'only two uprights and one top crossbar');
  for (const height of [.1, 1, 3.5, 5, 8.8]) {
    f.height = height; f.teleport({ x: 5, z: -5 }, 0); f.updateVisuals(0);
    const rails = f.innerMast.filter(p => p.pos[0] !== 0);
    for (const rail of rails) {
      const halfY = rail.half[1] * rail.mesh.scale.y;
      assert.ok(Math.abs(rail.mesh.position.y - halfY - .15) < 1e-6, 'rail base stays fixed');
      assert.ok(rail.mesh.position.y + halfY > height + .9);
      assert.ok(Math.abs(rail.collider.halfExtents().y - halfY) < 1e-5, 'collision shape matches stretched visual');
      assert.ok(Math.abs(rail.collider.translationWrtParent().y - rail.mesh.position.y) < 1e-5);
    }
  }
  game.dispose();
});

test('new North-wall Dock 1 clears the stairs; all three docks stay open across order changes', () => {
  const game = createGame(), specs = LAYOUT_FOR_TEST.docks;
  assert.deepEqual(specs.map(d => d.name), ['Dock 1', 'Dock 2', 'Dock 3']);
  const first = specs[0]; assert.equal(first.wall, 'west');
  assert.ok(first.at + LAYOUT_FOR_TEST.door.half < LAYOUT_FOR_TEST.lower.z1 - LAYOUT_FOR_TEST.stairs.steps * LAYOUT_FOR_TEST.stairs.tread, 'doorway clears stair run');
  const marks = specs.map(d => d.wall === 'west'
    ? { x: -LAYOUT_FOR_TEST.room.halfX + 2.8, z: d.at, hx: .45, hz: 1.6 }
    : { x: d.at, z: -LAYOUT_FOR_TEST.room.halfZ + 2.8, hx: 1.6, hz: .45 });
  for (let i = 1; i < marks.length; i++) assert.ok(Math.abs(marks[0].x - marks[i].x) > marks[0].hx + marks[i].hx || Math.abs(marks[0].z - marks[i].z) > marks[0].hz + marks[i].hz, 'new floor label does not overlap existing labels');
  for (const target of specs) {
    game.level.setOrder({ ...game.level.spec, dock: target.name });
    for (const dock of Object.values(game.level.docks)) dock.setOpen(false);
    game.world.step();
    for (const dock of specs) {
      const west = dock.wall === 'west';
      const origin = west ? { x: -LAYOUT_FOR_TEST.room.halfX + .5, y: -.1, z: dock.at } : { x: dock.at, y: -.1, z: -LAYOUT_FOR_TEST.room.halfZ + .5 };
      const direction = west ? { x: -1, y: 0, z: 0 } : { x: 0, y: 0, z: -1 };
      const hit = game.world.castRay(new RAPIER.Ray(origin, direction), 2, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
      assert.equal(hit, null, `${dock.name} stays physically open when ${target.name} is assigned`);
    }
  }
  game.dispose();
});

test('starts without random floor cartons and basement stacks are stable usable pallets', () => {
  const game = new Game({ mode: 'single', order: 1 });
  game.assignDevices({ padCount: () => 0, lastDevice: 'kbm' });
  assert.equal(LAYOUT_FOR_TEST.looseBoxes.length, 0);
  assert.ok(game.entities.filter(e => e.kind === 'box').every(e => e.home?.rack), 'all starting cartons belong to racks');
  const pallets = game.entities.filter(e => e.basementStack);
  assert.equal(pallets.length, 15);
  assert.ok(pallets.every(e => e.kind === 'pallet' && e.body.isDynamic()));
  settle(game, 3);
  for (const pile of LAYOUT_FOR_TEST.palletStacks) {
    const stack = pallets.filter(p => Math.abs(p.body.translation().x - pile.x) < .7);
    assert.equal(stack.length, pile.count);
    const heights = stack.map(p => p.body.translation().y).sort((a, b) => a - b);
    for (let i = 1; i < heights.length; i++) assert.ok(heights[i] - heights[i - 1] > .12, 'pallets stay stacked');
    assert.ok(stack.every(p => Math.abs(p.body.translation().z - pile.z) < .3));
  }
  game.dispose();
});

test('damage charges a fallen high-shelf package once and rack collapse adds only the remaining inventory', async () => {
  const { packageValue } = await import('../src/systems/damage.js');
  const game = createGame(), ledger = game.damage;
  settle(game, 1);
  assert.equal(ledger.total, 0, 'normal starting stock has no damage');
  const rack = game.level.racks.find(r => r.name === 'A');
  const box = rack.stock.find(b => b.home.pos.y > 3);
  const value = packageValue(box.sku);
  assert.ok(value >= 50 && value <= 250);
  const expected = ledger.inventory.get(rack.name).reduce((sum, item) => sum + packageValue(item.sku), 0);
  const pos = box.body.translation();
  move(box.body, pos.x, pos.y - 1.2, pos.z);
  ledger.step(0, true);
  assert.equal(ledger.total, value);
  box.body.setTranslation(box.home.pos, true);
  ledger.step(0, true);
  rack.body.setRotation(new THREE_FOR_VIEW_TEST.Quaternion().setFromAxisAngle(new THREE_FOR_VIEW_TEST.Vector3(0, 0, 1), 1), true);
  game.watchRacks(1 / 60);
  assert.equal(ledger.total, expected, 'collapse counts the rack contents without charging the dropped box twice');
  game.watchRacks(1 / 60);
  assert.equal(ledger.total, expected);
  game.dispose();
});

test('damage identities survive shrinkwrap and unwrapping and repeated light hits charge once', () => {
  const game = createGame(), ledger = game.damage;
  const load = game.receivingSystem.pallets[0];
  const record = load.contents.find(r => r.kind === 'box');
  const id = record.data.damageId;
  const value = ledger.package(record.data, 'Test package damage');
  const restored = cutWrapped(game, load);
  const box = restored.find(e => e.damageId === id);
  assert.ok(box);
  assert.equal(ledger.package(box, 'Same carton after cutting wrap'), 0);
  assert.equal(ledger.total, value);
  ledger.charge('light:test', 200, 'Ceiling light broken');
  ledger.charge('light:test', 200, 'Repeated light contact');
  assert.equal(ledger.total, value + 200);
  game.dispose();
});

test('combined tutorial hands off shipping to receiving in the same world and resumes its saved checkpoint', async () => {
  const { campaignProgress, saveCampaignProgress } = await import('../src/world/campaign.js');
  saveCampaignProgress('single', 'campaign-1', {});
  const game = new Game({ mode: 'single', order: 'campaign-1' });
  game.assignDevices({ padCount: () => 0, lastDevice: 'kbm' });
  assert.equal(game.receiving, false); assert.equal(game.orderId, 1);
  const world = game.world;
  const pallet = game.entities.find(e => e.basementStack);
  pallet.body.setTranslation({ x: -10, y: -.5, z: -14 }, true);
  game.damage.charge('light:checkpoint', 200, 'Test damage');
  game.time = 45; game.falls = 2;
  const removed = game.entities.find(e => e.kind === 'box' && e.sku === 355);
  const removedId = removed.damageId;
  game.shipLoad(removed);
  game.finishOrder(null);
  assert.equal(game.world, world); assert.equal(game.jobDone.shipping, true);
  assert.equal(game.phase, 'parallel'); assert.equal(game.jobDone.receiving, false);
  assert.equal(game.time, 45); assert.equal(game.damage.total, 200);
  assert.ok(campaignProgress('single', 'campaign-1').checkpoint);
  const incoming = game.receivingSystem.pallets.length;
  const count = game.entities.length;
  game.dispose();
  const resumed = new Game({ mode: 'single', order: 'campaign-1' });
  assert.equal(resumed.jobDone.shipping, true);
  assert.equal(resumed.time, 45); assert.equal(resumed.falls, 2); assert.equal(resumed.damage.total, 200);
  assert.equal(resumed.receivingSystem.pallets.length, incoming);
  assert.equal(resumed.entities.length, count, 'restore recreates exactly the saved physical stock');
  assert.ok(!resumed.entities.some(e => e.damageId === removedId), 'shipped stock stays gone');
  assert.ok(resumed.entities.some(e => e.basementStack && Math.abs(e.body.translation().z + 14) < .01), 'warehouse mess survives');
  let complete = false; resumed.onComplete = () => { complete = true; };
  resumed.finishJob('receiving');
  assert.equal(complete, true); assert.equal(campaignProgress('single', 'campaign-1').complete, true);
  assert.equal(campaignProgress('single', 'campaign-1').checkpoint, undefined);
  resumed.dispose();
});

test('five combined levels preserve shipping stock, prepare receiving bays, and keep practice separate', async () => {
  const { CAMPAIGN_LEVELS, saveCampaignProgress } = await import('../src/world/campaign.js');
  assert.equal(CAMPAIGN_LEVELS.length, 5);
  for (const definition of CAMPAIGN_LEVELS) {
    saveCampaignProgress('coop', definition.id, {});
    const game = new Game({ mode: 'coop', order: definition.id });
    assert.equal(game.level.order.length, definition.shipping.lines.length);
    for (const line of game.level.order) assert.ok(game.entities.some(e => e.sku === line.sku || e.skus?.[line.sku]), 'outgoing stock remains available');
    game.finishOrder(null);
    assert.equal(game.receivingSystem.spec.id, definition.receiving.id);
    assert.equal(game.receivingSystem.order.length, definition.receiving.lines.length);
    game.dispose();
  }
  const practice = createGame(); assert.equal(practice.campaign, undefined); assert.equal(practice.receiving, false); assert.ok(practice.receivingSystem); practice.dispose();
});

test('every combined shift completes shipping and receiving through the physical completion rules in single player and co-op', async () => {
  const { CAMPAIGN_LEVELS, saveCampaignProgress } = await import('../src/world/campaign.js');
  for (const mode of ['single', 'coop']) for (const definition of CAMPAIGN_LEVELS) {
    saveCampaignProgress(mode, definition.id, {});
    const game = new Game({ mode, order: definition.id });
    game.assignDevices({ padCount: () => 0, lastDevice: 'kbm' });
    const lines = [...game.level.order];
    for (const load of [...game.entities]) if (load.kind === 'wrapped' && lines.some(l => !l.freight && load.skus[l.sku])) cutWrapped(game, load);
    const pallet = createPalletForTest(game, { pos: [8, .005, -3] }), set = new Set([pallet]);
    let index = 0;
    for (const line of lines.filter(l => !l.freight)) {
      const boxes = game.entities.filter(e => e.kind === 'box' && e.sku === line.sku).slice(0, line.qty);
      assert.equal(boxes.length, line.qty);
      for (const box of boxes) {
        move(box.body, 8 + (index % 2 ? .3 : -.3), .16 + Math.floor(index / 4) * .95 + box.size[1] / 2, -3 + (Math.floor(index / 2) % 2 ? .3 : -.3));
        set.add(box); index++;
      }
    }
    deliver(game, buildWrapped(game, pallet, set), -1.5);
    for (const line of lines.filter(l => l.freight)) deliver(game, game.entities.find(e => e.kind === 'freight' && e.sku === line.sku), 1.5);
    settle(game, 1.2);
    assert.equal(game.jobDone.shipping, true, `${definition.title} finishes shipping`);
    assert.equal(game.complete, false);
    const receiving = game.receivingSystem;
    for (const load of [...receiving.pallets]) if (load.kind === 'wrapped' && load.contents.some(r => r.data.receivingLine && !receiving.order.find(l => l.line === r.data.receivingLine).pallet)) cutWrapped(game, load);
    for (const slot of receiving.slots) {
      if (slot.line.pallet) {
        const load = receiving.pallets.find(p => slot.line.freight ? p.kind === 'freight' && p.receivingLine === slot.line.line : p.kind === 'wrapped' && loadCartons(p).every(r => r.data.receivingLine === slot.line.line));
        move(load.body, (slot.x0 + slot.x1) / 2, slot.y + .005, (slot.z0 + slot.z1) / 2);
      } else receiving.boxes.filter(b => b.receivingLine === slot.line.line).forEach((box, i) => {
        // A dense retained pick face needs incoming cartons placed on existing stock,
        // rather than teleporting into the newly filled rear row.
        const supports = slot.rack.stock.filter(b => !b.removed && !b.carried && !b.incomingId &&
          b.body.translation().x > slot.x0 && b.body.translation().x < slot.x1 &&
          b.body.translation().y - b.size[1] / 2 >= slot.y - .05 &&
          b.body.translation().y + b.size[1] / 2 < slot.ceiling - .3).sort((a, b) => b.body.translation().y - a.body.translation().y);
        const support = supports[i];
        if (support) {
          const p = support.body.translation();
          move(box.body, p.x, p.y + support.size[1] / 2 + box.size[1] / 2 + .005, p.z);
        } else move(box.body, slot.x0 + .5 + i * .85, slot.y + box.size[1] / 2 + .005, (slot.z0 + slot.z1) / 2);
      });
    }
    settle(game, 2.5);
    assert.equal(game.complete, true, `${definition.title} finishes both tasks`);
    game.dispose();
  }
});

test('receiving checkpoint preserves custom wrapped loads, toppled racks, high conveyor and burning lights', async () => {
  const { saveCampaignProgress } = await import('../src/world/campaign.js');
  saveCampaignProgress('coop', 'campaign-3', {});
  const game = new Game({ mode: 'coop', order: 'campaign-3' });
  const custom = shippingLoad(game, [{ sku: 355, qty: 2 }]);
  const damageIds = loadCartons(custom).map(r => r.data.damageId);
  const rack = game.level.racks.find(r => r.name === 'B');
  rack.body.setRotation(new THREE_FOR_VIEW_TEST.Quaternion().setFromAxisAngle(new THREE_FOR_VIEW_TEST.Vector3(0, 0, 1), 1), true);
  game.watchRacks(1 / 60);
  game.level.conveyors[0].powerSwitch.activate();
  const id = game.nextEntityId;
  game.level.lighting.restore(game.level.lighting.units.map((u, i) => ({ broken: i === 0, burning: i === 0, id, p: { x: 6, y: .06, z: 5 }, q: { x: 0, y: 0, z: 0, w: 1 } })));
  game.finishOrder(null);
  const count = game.entities.length, damage = game.damage.total;
  game.dispose();
  const restored = new Game({ mode: 'coop', order: 'campaign-3' });
  assert.equal(restored.entities.length, count);
  assert.equal(new Set(restored.entities.map(e => e.runId)).size, count, 'every restored entity has a unique identity');
  assert.ok(restored.level.racks.find(r => r.name === 'B').fallen);
  assert.ok(restored.level.conveyors[0].powerSwitch.high);
  assert.ok(restored.level.lighting.units[0].burning);
  assert.equal(restored.damage.total, damage);
  assert.ok(restored.entities.some(e => e.kind === 'wrapped' && damageIds.every(id => e.contents.some(r => r.data.damageId === id))));
  restored.assignDevices({ padCount: () => 0, lastDevice: 'kbm' }); settle(restored, .2);
  restored.dispose();
  saveCampaignProgress('coop', 'campaign-3', {});
});

test('combined shift best times use both tasks and remain separate from Practice', async () => {
  const { CAMPAIGN_LEVELS } = await import('../src/world/campaign.js');
  const practiceBefore = best('single', 1);
  const definition = levelDef('campaign-1');
  assert.equal(definition.title, 'Tutorial');
  assert.equal(definition.medals.gold, definition.shipping.medals.gold + definition.receiving.medals.gold);
  assert.equal(CAMPAIGN_LEVELS[0].receiving.pallets.length, 1);
  assert.equal(CAMPAIGN_LEVELS[1].receiving.lines.filter(l => !l.pallet).reduce((sum, l) => sum + l.qty, 0), 2);
  assert.equal(CAMPAIGN_LEVELS[1].receiving.lines.filter(l => l.pallet).length, 1);
  submit('single', 'campaign-1', { time: 75, incidents: 1 });
  assert.equal(best('single', 'campaign-1').total, 90);
  assert.deepEqual(best('single', 1), practiceBefore);
});

test('main floor retains only conveyor catch pallets, with basement supplies and no prototype crate', () => {
  const game = new Game({ mode: 'single', order: 1 });
  assert.ok(!game.scene.children.some(o => o.name === 'Warehouse structural pillar'));
  const floorPallets = game.entities.filter(e => e.kind === 'pallet' && e.body.translation().y >= -.1);
  assert.equal(floorPallets.length, LAYOUT_FOR_TEST.conveyors.length);
  for (const belt of LAYOUT_FOR_TEST.conveyors) assert.ok(floorPallets.some(p => {
    const pos = p.body.translation();
    return Math.abs(pos.x - (belt.x0 + belt.x1) / 2) < .01 && Math.abs(pos.z - (belt.z0 - .75)) < .01;
  }), 'each conveyor keeps its catch pallet');
  assert.equal(game.entities.filter(e => e.kind === 'freight' && !e.storageLocation).length, 0);
  assert.equal(game.entities.filter(e => e.basementStack).length, 15);
  game.dispose();
});


test('putaway feedback explains wrap, destination, release, and confirmed quantity', () => {
  const game = createGame(), receiving = game.receivingSystem;
  const load = receiving.pallets[0], pos = load.body.translation();
  move(game.forklift.carriage, pos.x, pos.y, pos.z - 1);
  assert.match(receiving.placementHint('driver'), /cut the shrinkwrap/);
  openIncoming(game);
  const box = receiving.boxes[0], slot = receiving.slots.find(s => s.line.line === box.receivingLine);
  move(box.body, 7, .2, -4);
  move(game.climber.body, 7, 1, -4);
  assert.match(receiving.placementHint('climber'), /assigned bay/);
  box.carried = true;
  assert.match(receiving.placementHint('climber'), /Put the carton down/);
  box.carried = false;
  game.receivingStatus[slot.line.line] = slot.line.qty;
  assert.match(receiving.placementHint('climber'), /2\/2 put away/);
  move(game.climber.body, -18, 1, 18);
  assert.equal(receiving.placementHint('climber'), '', 'no distant stock prompts');
  game.dispose();
});

test('shelf alignment diagnostics agree with seating validation', async () => {
  const { palletSlotIssue, palletFitsSlot } = await import('../src/world/pallet-storage.js');
  const game = new Game({ mode: 'single', order: 3 });
  const slot = game.level.storage.slots[0];
  const pallet = game.entities.find(e => e.storageLocation === slot.location);
  const x = slot.rack.home.x + slot.x, z = slot.rack.home.z, y = slot.rack.home.y + slot.y;
  move(pallet.body, x, y, z);
  assert.equal(palletSlotIssue(pallet, slot), null);
  assert.equal(palletFitsSlot(pallet, slot), true);
  for (const [dx, dy, dz, message] of [[1, 0, 0, /Center/], [0, .2, 0, /Lower/], [0, -.2, 0, /Raise/], [0, 0, .25, /whole pallet/]]) {
    move(pallet.body, x + dx, y + dy, z + dz);
    assert.match(palletSlotIssue(pallet, slot), message);
    assert.equal(palletFitsSlot(pallet, slot), false);
  }
  game.dispose();
});

test('fork-entry guidance distinguishes height, centering, and insertion depth', () => {
  const game = new Game({ mode: 'single', order: 1 });
  const f = game.forklift, storage = game.level.storage;
  const pallet = createPalletForTest(game, { pos: [7, 0, -4] });
  move(f.body, 7, 0, -6.45);
  move(f.carriage, 7, .08, -5.5);
  assert.match(storage.pickupHint(f), /height aligned/);
  move(f.carriage, 7, .2, -5.5);
  assert.match(storage.pickupHint(f), /Lower forks/);
  move(f.carriage, 7, .02, -5.5);
  assert.match(storage.pickupHint(f), /Raise forks/);
  move(f.carriage, 7.3, .08, -5.5);
  assert.match(storage.pickupHint(f), /Center both/);
  move(f.carriage, 7, .08, -4.6);
  assert.match(storage.pickupHint(f), /inserted/);
  pallet.body.setRotation({ x: 0, y: Math.sin(Math.PI / 4), z: 0, w: Math.cos(Math.PI / 4) }, true);
  assert.match(storage.pickupHint(f), /squarely/);
  game.dispose();
});


test('carried pallets suppress entry prompts while driving, including brief contact gaps', () => {
  const game = new Game({ mode: 'single', order: 1 });
  game.assignDevices({ padCount: () => 0, lastDevice: 'kbm' });
  const f = game.forklift, storage = game.level.storage;
  f.height = .8; f.teleport({ x: 5, z: -5 }, 0);
  const pallet = createPalletForTest(game, { pos: [5, .705, -3.4] });
  settle(game, .4);
  assert.equal(storage.pickupHint(f), '', 'supported load has no pickup instructions');
  const blank = Input.prototype.climberActions.call({ invertY: false }, []);
  for (let i = 0; i < 90; i++) {
    game.step(1 / 60, { climber: blank, driver: { ...blank, throttle: .2 } });
    assert.equal(storage.pickupHint(f), '', 'driving does not alternate height/insertion prompts');
  }
  const origin = f.carriage.translation();
  move(pallet.body, origin.x, origin.y - .14, origin.z + .65);
  assert.equal(storage.pickupHint(f), '', 'brief bounce retains carried state');
  move(pallet.body, origin.x, origin.y - .2, origin.z + 1.6);
  assert.match(storage.pickupHint(f), /Lower forks/, 'entry guidance returns after unloading');
  game.dispose();
});

test('automatic tilt cradles lifted pallets, stays level while lowering, and resets without a load', () => {
  for (const kind of ['pallet', 'wrapped', 'freight']) {
    const game = new Game({ mode: 'single', order: 3 });
    game.assignDevices({ padCount: () => 0, lastDevice: 'kbm' });
    const f = game.forklift, blank = Input.prototype.climberActions.call({ invertY: false }, []);
    f.height = .8; f.teleport({ x: 5, z: -5 }, 0);
    const load = kind === 'wrapped' ? game.entities.find(e => e.kind === 'wrapped')
      : kind === 'freight' ? createFreightForTest(game, { pos: [5, .705, -3.4], sku: 980, mass: 350 })
      : createPalletForTest(game, { pos: [5, .705, -3.4] });
    move(load.body, 5, .705, -3.4);
    settle(game, 2);
    assert.ok(f.tilt > .05, `${kind} automatically tilts back: ${f.tilt} ready ${f.tiltReadyTime} origin ${JSON.stringify(f.carriage.translation())} load ${JSON.stringify(load.body.translation())} target ${f.tiltTarget}`);
    assert.ok(load.body.translation().y > .6, 'load remains on the raised blades');
    const forkUp = new THREE_FOR_VIEW_TEST.Vector3(0, 0, 1).applyQuaternion(f.forkQuaternion());
    assert.ok(forkUp.y > .05, 'backward tilt raises the blade tips');
    for (let i = 0; i < 110; i++) game.step(1 / 60, { climber: blank, driver: { ...blank, liftDown: .1 } });
    assert.equal(f.tilt, 0, 'lowering levels the forks');
    settle(game, .5);
    assert.equal(f.tilt, 0, 'releasing lower does not immediately tilt back');
    for (let i = 0; i < 120; i++) game.step(1 / 60, { climber: blank, driver: { ...blank, liftUp: .3 } });
    assert.ok(f.tilt > .05, 'a new lift re-enables backward tilt');
    move(load.body, 10, .01, -3);
    settle(game, 2);
    assert.equal(f.tilt, 0, 'unloaded forks return to level');
    game.dispose();
  }
});

test('automatic tilt leaves shelf-supported stock level and Dave follows the tilted fork frame', () => {
  const game = new Game({ mode: 'single', order: 3 });
  game.assignDevices({ padCount: () => 0, lastDevice: 'kbm' });
  settle(game, 1);
  const f = game.forklift, slot = game.level.storage.slots.find(s => s.location === 'Z-1-3');
  const load = slot.pallet;
  f.height = slot.y + .055; f.teleport({ x: slot.rack.home.x + slot.x, z: 20.5 }, 0);
  settle(game, .8);
  assert.equal(f.tilt, 0, 'do not tilt a pallet while it still rests on its shelf');
  const blank = Input.prototype.climberActions.call({ invertY: false }, []);
  for (let i = 0; i < 90; i++) game.step(1 / 60, { climber: blank, driver: { ...blank, liftUp: 1 } });
  assert.ok(f.tilt > .03, 'tilt begins only after lifting the pallet clear');
  for (let i = 0; i < 120; i++) game.step(1 / 60, { climber: blank, driver: { ...blank, brake: 1 } });
  game.active = 'climber'; settle(game, 1.5);
  const dave = game.climber;
  const top = load.body.translation();
  move(dave.body, top.x, top.y + .8 + dave.centerOff, top.z);
  dave.body.setNextKinematicTranslation(dave.body.translation());
  dave.grab();
  settle(game, 1);
  assert.ok(dave.holdingOn, 'Dave can still hold on to the tilted forks');
  const local = dave.carriageLocal(dave.feet);
  assert.ok(Math.abs(local.x) < .15 && Math.abs(local.z - .58) < .15 && local.y > CONFIG.objects.small.size[1], 'Dave rides the load in the actual tilted assembly');
  f.teleport({ x: 5, z: -5 }, 0);
  assert.equal(f.tilt, 0, 'reset/teleport levels the assembly');
  game.dispose();
});

test('pause-map destinations match physical shipping, backstock and receiving bays', async () => {
  const { orderDestinations } = await import('../src/world/navigation.js');
  for (const order of [3, 'receiving-4']) {
    const game = new Game({ mode: 'single', order });
    const targets = orderDestinations(game);
    assert.ok(targets.some(t => t.id === 'dock' && t.label.includes(game.level.dock.name)));
    for (const line of game.level.order) {
      const target = targets.find(t => t.id === `${line.line}:${line.location}`);
      assert.ok(target, `destination exists for ${line.location}`);
      const [name, bay, shelf] = line.location.split('-');
      const rack = LAYOUT_FOR_TEST.racks.find(r => r.name === name);
      assert.ok(Math.abs(target.x - (rack.x0 + (Number(bay) - .5) * LAYOUT_FOR_TEST.racking.bayW)) < 1e-8);
      assert.ok(target.z < rack.z0 || target.z > rack.z1, 'marker sits in the accessible aisle beside the destination');
      assert.match(target.detail, new RegExp(`Rack ${name} · Bay ${bay} · Shelf ${shelf}`));
      game.itemStatus[line.line] = line.qty;
      assert.ok(orderDestinations(game).find(t => t.id === target.id).complete);
      if (!game.receiving && line.backstock) assert.ok(targets.some(t => t.label.startsWith('Backstock') && t.id.endsWith(line.backstock)));
    }
    if (game.receiving) assert.ok(targets.every(t => !t.label.startsWith('Backstock')));
    game.dispose();
  }
});


test('resized cartons fit twelve small or four medium/large per pallet layer without overlap', async () => {
  const { packPallet } = await import('../src/world/pallet-packing.js');
  for (const [type, count] of [['small', 12], ['medium', 4], ['large', 4]]) {
    const types = Array(count).fill(type), offsets = packPallet(types);
    const [sx, sy, sz] = CONFIG.objects[type].size;
    const game = new Game({ mode: 'single', order: 1 });
    const pallet = createPalletForTest(game, { pos: [7, .005, -3] });
    const cartons = offsets.map(([x, y, z]) => createBoxForTest(game, { type, sku: 355, pos: [7 + x, .005 + y, -3 + z] }));
    for (const [x, y, z] of offsets) {
      assert.ok(Math.abs(x) + sx / 2 <= .5 && Math.abs(z) + sz / 2 <= .6, 'carton stays within the pallet');
      assert.equal(y, offsets[0][1], 'all cartons occupy one layer');
    }
    settle(game, 2);
    const stack = collectStack(game, pallet);
    assert.equal(cartons.filter(b => stack.has(b)).length, count, `${count} ${type} cartons rest on the pallet`);
    assert.ok(cartons.every(b => Math.abs(b.body.translation().y - (.005 + .15 + sy / 2)) < .03), 'cartons remain in one stable layer');
    const wrapped = buildWrapped(game, pallet, stack);
    assert.equal(loadCartons(wrapped).length, count);
    game.dispose();
  }
});

test('Rack A mixes empty and partially stocked locations with supported stacks and clear shelf bounds', () => {
  const game = new Game({ mode: 'single', order: 1 });
  const rack = game.level.racks.find(r => r.name === 'A');
  const spec = LAYOUT_FOR_TEST.racks.find(r => r.name === 'A');
  let empty = 0, partial = 0, nearFull = 0;
  for (let bay = 1; bay <= spec.bays; bay++) for (let shelf = 1; shelf <= spec.shelves.length; shelf++) {
    const x0 = spec.x0 + (bay - 1) * LAYOUT_FOR_TEST.racking.bayW, x1 = x0 + LAYOUT_FOR_TEST.racking.bayW;
    const boxes = rack.stock.filter(b => b.home.pos.x > x0 && b.home.pos.x < x1 && b.home.pos.y - b.size[1] / 2 >= spec.base + spec.shelves[shelf - 1] && b.home.pos.y + b.size[1] / 2 < (spec.base + (spec.shelves[shelf] ?? spec.shelves[shelf - 1] + 1.5)));
    if (!boxes.length) { empty++; continue; }
    assert.equal(new Set(boxes.map(b => b.sku)).size, 1);
    assert.equal(new Set(boxes.map(b => b.type)).size, 1);
    const layers = boxes[0].type === 'large' ? 1 : 2;
    const capacity = layers * 2 * { small: 5, medium: 4, large: 3 }[boxes[0].type];
    assert.ok(boxes.length <= capacity);
    if (boxes.length / capacity >= .8) nearFull++; else partial++;
    for (const box of boxes) if (box.home.pos.y - box.size[1] / 2 > spec.shelves[shelf - 1] + .05) {
      assert.ok(boxes.some(lower => lower !== box && Math.abs(lower.home.pos.x - box.home.pos.x) < .01 && Math.abs(lower.home.pos.z - box.home.pos.z) < .01 && Math.abs(lower.home.pos.y + lower.size[1] / 2 - (box.home.pos.y - box.size[1] / 2)) < .01), 'upper cartons have physical support');
    }
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      assert.ok(box.home.pos.x - box.size[0] / 2 > x0 + .05 && box.home.pos.x + box.size[0] / 2 < x1 - .05);
      assert.ok(box.home.pos.z - box.size[2] / 2 > spec.z0 && box.home.pos.z + box.size[2] / 2 < spec.z1);
      for (const other of boxes.slice(i + 1)) assert.ok(
        Math.abs(box.home.pos.x - other.home.pos.x) > (box.size[0] + other.size[0]) / 2 ||
        Math.abs(box.home.pos.z - other.home.pos.z) > (box.size[2] + other.size[2]) / 2 ||
        Math.abs(box.home.pos.y - other.home.pos.y) > (box.size[1] + other.size[1]) / 2, 'stacked cartons never overlap');
    }
  }
  assert.equal(empty, 4); assert.equal(partial, 11); assert.equal(nearFull, 3);
  assert.equal(rack.stock.length, 125);
  settle(game, 2);
  assert.ok(rack.stock.every(b => Math.abs(b.body.translation().y - b.home.pos.y) < .03), 'preview stock rests stably on its shelf');
  game.dispose();
});


test('warehouse-wide loose stock uses one SKU per location with empty bays and supported stacks', () => {
  const game = new Game({ mode: 'single', order: 1 });
  let empty = 0, populated = 0, upperCartons = 0;
  for (const spec of LAYOUT_FOR_TEST.racks) {
    const rack = game.level.racks.find(r => r.name === spec.name);
    for (let bay = 0; bay < spec.bays; bay++) for (let shelf = 0; shelf < spec.shelves.length; shelf++) {
      const location = `${spec.name}-${bay + 1}-${shelf + 1}`;
      if (FREIGHT_STOCK[location] || (spec.palletFromShelf != null && shelf >= spec.palletFromShelf)) continue;
      const x0 = spec.x0 + bay * LAYOUT_FOR_TEST.racking.bayW, x1 = x0 + LAYOUT_FOR_TEST.racking.bayW;
      const floor = spec.base + spec.shelves[shelf], ceiling = spec.base + (spec.shelves[shelf + 1] ?? spec.shelves[shelf] + 1.5);
      const boxes = rack.stock.filter(b => b.home.pos.x > x0 && b.home.pos.x < x1 && b.home.pos.y > floor && b.home.pos.y < ceiling);
      if (!boxes.length) { empty++; continue; } populated++;
      assert.equal(new Set(boxes.map(b => b.sku)).size, 1, location);
      assert.equal(new Set(boxes.map(b => b.type)).size, 1, location);
      for (const box of boxes) {
        const p = box.home.pos;
        assert.ok(p.x - box.size[0] / 2 > x0 + .04 && p.x + box.size[0] / 2 < x1 - .04, location);
        assert.ok(p.z - box.size[2] / 2 > spec.z0 && p.z + box.size[2] / 2 < spec.z1, location);
        assert.ok(p.y + box.size[1] / 2 < ceiling - .1, location);
        if (p.y - box.size[1] / 2 > floor + .05) {
          upperCartons++;
          assert.ok(boxes.some(lower => lower !== box && Math.abs(lower.home.pos.x - p.x) < .01 && Math.abs(lower.home.pos.z - p.z) < .01 && Math.abs(lower.home.pos.y + lower.size[1] / 2 - (p.y - box.size[1] / 2)) < .01), location);
        }
      }
    }
  }
  assert.ok(empty >= 25 && populated >= 100 && upperCartons > 0);
  settle(game, 2);
  assert.ok(game.level.racks.every(r => r.stock.filter(b => !b.storagePallet).every(b => Math.abs(b.body.translation().y - b.home.pos.y) < .04)), 'all loose stock remains on its intended shelf');
  game.dispose();
});


test('campaign themes create parallel carton/forklift jobs without changing Practice orders', async () => {
  const { CAMPAIGN_LEVELS, saveCampaignProgress } = await import('../src/world/campaign.js');
  const themes = ['Basics', 'Vertical access', 'Sorting', 'Fragile handling', 'Everything together'];
  assert.deepEqual(CAMPAIGN_LEVELS.map(l => l.theme), themes);
  for (const level of CAMPAIGN_LEVELS.slice(1)) {
    saveCampaignProgress('coop', level.id, {});
    const game = new Game({ mode: 'coop', order: level.id });
    game.assignDevices({ padCount: () => 0, lastDevice: 'kbm' });
    const prep = game.entities.find(e => e.campaignWorkPallet);
    assert.ok(prep && prep.kind === 'pallet');
    const line = game.level.order.find(l => !l.freight);
    assert.ok(line && game.entities.some(e => e.kind === 'box' && e.sku === line.sku), 'Dave has immediately available carton work');
    assert.ok(game.level.order.some(l => l.freight || /^[XYZ]-/.test(l.location)), 'Ralph has an independent crate or high-pallet job');
    assert.notEqual(game.workGuide.content('driver').detail, game.workGuide.content('climber').detail);
    if (level.theme === 'Fragile handling') {
      assert.ok(game.level.order.some(l => !l.freight && l.qty >= 2 && game.entities.some(e => e.kind === 'box' && e.sku === l.sku && e.fragile)));
    }
    const world = game.world;
    game.finishOrder(null);
    assert.equal(game.world, world);
    game.workGuide.update(1);
    game.trackJob('driver', 'receiving'); game.trackJob('climber', 'receiving'); game.workGuide.update(1);
    assert.notEqual(game.workGuide.content('driver').detail, game.workGuide.content('climber').detail);
    assert.ok(game.receivingSystem.pallets.length >= 2, 'Ralph can unload another unit while Dave processes the first');
    game.dispose(); saveCampaignProgress('coop', level.id, {});
  }
  const practice = new Game({ mode: 'single', order: 3 });
  assert.equal(practice.campaign, undefined);
  assert.equal(practice.workGuide, null);
  assert.equal(practice.level.order[0].sku, 929);
  assert.ok(!practice.entities.some(e => e.campaignWorkPallet));
  practice.dispose();
});

test('team task cards advance when cartons are packed and when a receiving load is staged', async () => {
  const { saveCampaignProgress } = await import('../src/world/campaign.js');
  saveCampaignProgress('coop', 'campaign-3', {});
  const game = new Game({ mode: 'coop', order: 'campaign-3' });
  game.assignDevices({ padCount: () => 0, lastDevice: 'kbm' });
  assert.match(game.workGuide.content('driver').detail, /strapped/);
  const prep = game.entities.find(e => e.campaignWorkPallet), p = prep.body.translation();
  let index = 0;
  for (const line of game.level.order.filter(l => !l.freight)) for (const box of game.entities.filter(e => e.kind === 'box' && e.sku === line.sku).slice(0, line.qty)) {
    box.handled = true;
    move(box.body, p.x + (index % 2 ? .21 : -.21), p.y + .155 + box.size[1] / 2, p.z + (index < 2 ? -.26 : .26)); index++;
  }
  settle(game, 1);
  game.workGuide.update(1);
  assert.match(game.workGuide.content('climber').detail, /Cartons are loaded/);
  game.finishOrder(null);
  game.trackJob('driver', 'receiving'); game.trackJob('climber', 'receiving');
  const first = game.receivingSystem.pallets[0];
  move(first.body, 4.8, .005, -5.3);
  game.workGuide.update(1);
  assert.match(game.workGuide.content('climber').detail, /Cut the staged/);
  assert.match(game.workGuide.content('driver').detail, /next load/);
  cutWrapped(game, first); game.workGuide.update(1);
  assert.match(game.workGuide.content('climber').detail, /Put away/);
  assert.match(game.workGuide.content('driver').detail, /next load/);
  game.dispose(); saveCampaignProgress('coop', 'campaign-3', {});
});

test('Ralph can fetch the next reserve while Dave opens the first staged pallet', async () => {
  const { saveCampaignProgress } = await import('../src/world/campaign.js');
  saveCampaignProgress('coop', 'campaign-5', {});
  const game = new Game({ mode: 'coop', order: 'campaign-5' });
  const first = game.entities.find(e => e.kind === 'wrapped' && e.skus?.[907]);
  assert.ok(first);
  move(first.body, 4.8, .005, -5.3);
  game.workGuide.update(1);
  assert.match(game.workGuide.content('climber').detail, /907/);
  assert.match(game.workGuide.content('driver').detail, /437/);
  game.dispose();
});


test('shipping tutorial reads its pause clipboard without starting time or showing a cab clipboard', async () => {
  const { saveCampaignProgress } = await import('../src/world/campaign.js');
  saveCampaignProgress('single', 'campaign-1', {});
  const game = new Game({ mode: 'single', order: 'campaign-1' });
  game.assignDevices({ padCount: () => 0, lastDevice: 'kbm' });
  assert.equal(game.forklift.clipboard.group.visible, false);
  assert.equal(game.tutorial.read, false);
  game.readClipboard();
  assert.equal(game.tutorial.read, true); assert.equal(game.started, false); assert.equal(game.time, 0);
  game.frame(.2); assert.equal(game.tutorial.stage, 1);
  game.dispose();
});

test('previewing the receiving clipboard preserves the active shipping task', async () => {
  const { orderLines } = await import('../src/world/level.js');
  const { saveCampaignProgress } = await import('../src/world/campaign.js');
  saveCampaignProgress('single', 'campaign-1', {});
  const game = new Game({ mode: 'single', order: 'campaign-1' });
  const order = game.level.order, status = game.itemStatus;
  const spec = game.campaign.receiving;
  game.forklift.drawClipboard({ receiving: true, receivingSpec: spec, orderId: spec.id,
    level: { order: orderLines(spec), dock: { name: spec.dock } }, itemStatus: {}, skus: game.skus });
  assert.equal(game.receiving, false);
  assert.equal(game.level.order, order);
  assert.equal(game.itemStatus, status);
  assert.equal(game.time, 0);
  const previewKey = game.forklift.clipboard.key;
  game.forklift.drawClipboard();
  assert.notEqual(game.forklift.clipboard.key, previewKey);
  game.dispose();
});

// Exercise the actual settling/contact checks, rather than setting completion flags.
function putAwayAll(game) {
  const receiving = game.receivingSystem;
  for (const load of [...receiving.pallets]) if (load.kind === 'wrapped' && load.contents.some(r => r.data.receivingLine && !receiving.order.find(l => l.line === r.data.receivingLine).pallet)) cutWrapped(game, load);
  for (const slot of receiving.slots) {
    if (slot.line.pallet) {
      const load = receiving.pallets.find(p => slot.line.freight ? p.kind === 'freight' && p.receivingLine === slot.line.line : p.kind === 'wrapped' && loadCartons(p).every(r => r.data.receivingLine === slot.line.line));
      move(load.body, (slot.x0 + slot.x1) / 2, slot.y + .005, (slot.z0 + slot.z1) / 2);
    } else receiving.boxes.filter(b => b.receivingLine === slot.line.line).forEach((box, i) => {
      move(box.body, slot.x0 + .5 + i % 3 * .8, slot.y + box.size[1] / 2 + .005, (slot.z0 + slot.z1) / 2);
    });
  }
  settle(game, 2.5);
}
function shipExistingStock(game) {
  const lines = game.level.order;
  for (const load of [...game.entities]) if (load.kind === 'wrapped' && !load.incomingPalletIds?.length && lines.some(l => !l.freight && load.skus[l.sku])) cutWrapped(game, load);
  const pallet = createPalletForTest(game, { pos: [8, .005, -3] }), set = new Set([pallet]);
  let index = 0;
  for (const line of lines.filter(l => !l.freight)) {
    const boxes = game.entities.filter(e => e.kind === 'box' && !e.incomingId && e.sku === line.sku).slice(0, line.qty);
    assert.equal(boxes.length, line.qty, `independent stock for SKU ${line.sku}`);
    for (const box of boxes) {
      move(box.body, 8 + (index % 2 ? .3 : -.3), .16 + Math.floor(index / 4) * .95 + box.size[1] / 2, -3 + (Math.floor(index / 2) % 2 ? .3 : -.3));
      set.add(box); index++;
    }
  }
  deliver(game, buildWrapped(game, pallet, set), -1.5);
  for (const line of lines.filter(l => l.freight)) deliver(game, game.entities.find(e => e.kind === 'freight' && !e.incomingId && e.sku === line.sku), 1.5);
  settle(game, 1.2);
}

test('all campaign and Practice pairs complete receiving first in both player modes', async () => {
  const { CAMPAIGN_LEVELS, saveCampaignProgress } = await import('../src/world/campaign.js');
  for (const mode of ['single', 'coop']) for (const id of [...CAMPAIGN_LEVELS.map(l => l.id), 1, 2, 3, 4, 5]) {
    if (typeof id === 'string') saveCampaignProgress(mode, id, {});
    const game = new Game({ mode, order: id });
    try {
      game.assignDevices({ padCount: () => 0, lastDevice: 'kbm' });
      assert.notEqual(game.level.dock.name, game.receivingSystem.dock.name);
      assert.ok(game.receivingSystem.pallets.every(p => game.receivingSystem.dockZone.contains(p.body.translation())));
      let finished = 0; game.onComplete = () => finished++;
      putAwayAll(game);
      assert.equal(game.jobDone.receiving, true, `${mode} ${id} receives`);
      assert.equal(game.jobDone.shipping, false); assert.equal(game.complete, false); assert.equal(finished, 0);
      const inboundCounts = { ...game.receivingStatus };
      shipExistingStock(game);
      assert.equal(game.jobDone.shipping, true, `${mode} ${id} ships`);
      assert.equal(game.complete, true); assert.equal(finished, 1);
      assert.deepEqual(game.receivingStatus, inboundCounts);
      game.finishJob('shipping'); game.finishJob('receiving'); assert.equal(finished, 1);
    } finally {
      game.dispose(); if (typeof id === 'string') saveCampaignProgress(mode, id, {});
    }
  }
});

test('receiving-first checkpoint restores both jobs and independent tracking without duplicating loads', async () => {
  const { saveCampaignProgress } = await import('../src/world/campaign.js');
  saveCampaignProgress('coop', 'campaign-1', {});
  const game = new Game({ mode: 'coop', order: 'campaign-1' });
  game.assignDevices({ padCount: () => 2, lastDevice: 'pad0' });
  game.trackJob('driver', 'receiving'); game.trackJob('climber', 'shipping');
  game.readClipboard(); game.frame(.2);
  assert.equal(game.tutorial.stage, 1, 'incoming SKU 355 does not impersonate an outgoing packed pallet');
  assert.match(game.guideFor('driver').title, /PO-001/);
  assert.match(game.guideFor('climber').title, /ORDER 1/);
  putAwayAll(game);
  const count = game.entities.length, ids = [...game.receivedIds]; game.dispose();
  const resumed = new Game({ mode: 'coop', order: 'campaign-1' });
  try {
    assert.deepEqual(resumed.jobDone, { shipping: false, receiving: true });
    assert.deepEqual(resumed.trackedJobs, { driver: 'shipping', climber: 'shipping' });
    assert.deepEqual([...resumed.receivedIds], ids); assert.equal(resumed.entities.length, count);
    assert.doesNotMatch(resumed.guideFor('driver').title, /COMPLETE/);
    shipExistingStock(resumed); assert.equal(resumed.complete, true);
  } finally { resumed.dispose(); saveCampaignProgress('coop', 'campaign-1', {}); }
});

test('incoming stock cannot ship before receipt but can ship after putaway without losing receiving credit', () => {
  const game = new Game({ mode: 'single', order: 1 });
  try {
    game.assignDevices({ padCount: () => 0, lastDevice: 'kbm' });
    const receiving = game.receivingSystem, load = receiving.pallets[0];
    assert.equal(game.securedCounts(load).A, 0);
    putAwayAll(game); assert.equal(game.jobDone.receiving, true);
    const pallet = createPalletForTest(game, { pos: [8, .005, -3] });
    const box = receiving.boxes.find(b => b.sku === game.level.order[0].sku);
    move(box.body, 8, .16 + box.size[1] / 2, -3);
    const shipment = buildWrapped(game, pallet, new Set([pallet, box]));
    assert.equal(game.securedCounts(shipment).A, 1);
    deliver(game, shipment, 0); settle(game, 1.2);
    assert.equal(game.complete, true); assert.equal(game.receivingStatus.A, 2);
  } finally { game.dispose(); }
});

test('pause-menu direction events retain the originating device for independent co-op tracking', () => {
  const input = Object.create(Input.prototype);
  input.pressed = new Set(['ArrowRight']); input.pads = [{ index: 2 }, { index: 7 }];
  input.padEdges = new Map([[2, new Set(['stickLeft'])], [7, new Set([15])]]);
  assert.deepEqual(input.menu().clipboards, [
    { device: 'kbm', direction: 1 }, { device: 'pad0', direction: -1 }, { device: 'pad1', direction: 1 },
  ]);
});

test('clipboard tracking follows the player when changing characters or swapping co-op roles', () => {
  const solo = new Game({ mode: 'single', order: 2 });
  solo.trackJob('driver', 'receiving'); solo.swapCharacter();
  assert.equal(solo.trackedJobs[solo.active], 'receiving'); solo.dispose();
  const coop = new Game({ mode: 'coop', order: 2 });
  coop.trackJob('driver', 'receiving');
  assert.deepEqual(coop.trackedJobs, { driver: 'receiving', climber: 'shipping' });
  coop.swapRoles();
  assert.deepEqual(coop.trackedJobs, { driver: 'shipping', climber: 'receiving' });
  coop.dispose();
});

test('finishing the other job never interrupts Dave carrying shipping stock', async () => {
  const { saveCampaignProgress } = await import('../src/world/campaign.js');
  saveCampaignProgress('coop', 'campaign-1', {});
  const game = new Game({ mode: 'coop', order: 'campaign-1' });
  try {
    const box = game.entities.find(e => e.kind === 'box' && e.sku === 355 && !e.incomingId);
    game.climber.pickUp(box);
    assert.ok(game.climber.carriedBoxes().includes(box));
    game.finishJob('receiving');
    assert.ok(game.climber.carriedBoxes().includes(box));
    assert.equal(box.carried, true);
    assert.equal(game.complete, false);
  } finally { game.dispose(); saveCampaignProgress('coop', 'campaign-1', {}); }
});


test('completed clipboards move behind open jobs and each affected player advances automatically', async () => {
  const { saveCampaignProgress } = await import('../src/world/campaign.js');
  for (const mode of ['single', 'coop']) for (const first of ['shipping', 'receiving']) {
    saveCampaignProgress(mode, 'campaign-1', {});
    const game = new Game({ mode, order: 'campaign-1' });
    try {
      const next = first === 'shipping' ? 'receiving' : 'shipping';
      game.trackedJobs = { driver: first, climber: mode === 'coop' ? next : first };
      assert.deepEqual(game.clipboardJobs(), ['shipping', 'receiving']);
      game.finishJob(first);
      assert.deepEqual(game.clipboardJobs(), [next, first]);
      assert.deepEqual(game.trackedJobs, { driver: next, climber: next });
      assert.equal(game.complete, false);
      assert.doesNotMatch(game.guideFor('driver').title, /COMPLETE/);
      // Completed pages can still be reviewed without changing their final state.
      game.trackJob('driver', first);
      assert.match(game.guideFor('driver').title, /COMPLETE/);
      game.trackJob('driver', next);
      let finished = 0; game.onComplete = () => finished++;
      game.finishJob(next);
      assert.equal(game.complete, true); assert.equal(finished, 1);
      assert.equal(game.trackedJobs.driver, next, 'no jump to a completed job when none remain open');
      assert.equal(game.clipboardJobs().length, 2);
    } finally { game.dispose(); saveCampaignProgress(mode, 'campaign-1', {}); }
  }
});

function timedGame(mode = 'single', options = {}) {
  const game = new Game({ mode, order: 'timed', timed: { minutes: 10, difficulty: 'standard', ...options } });
  game.assignDevices({ padCount: () => 0, lastDevice: 'kbm' });
  return game;
}

test('Timed Shift starts two live independent jobs, validates options, and preserves idle preparation time', async () => {
  const { timedOptions } = await import('../src/systems/timed-shift.js');
  assert.deepEqual(timedOptions({ minutes: -5, difficulty: 'oops' }), { minutes: 1, difficulty: 'standard' });
  assert.equal(timedOptions({ minutes: 999 }).minutes, 120);
  for (const mode of ['single', 'coop']) {
    const game = timedGame(mode);
    try {
      assert.equal(game.campaign, undefined); assert.equal(game.tutorial, null);
      assert.equal(game.timed.remaining, 600); assert.equal(game.receivingSystem.putawaySigns.length, 0);
      assert.notEqual(game.level.dock.name, game.receivingSystem.dock.name);
      assert.ok(game.receivingSystem.pallets.every(p => game.receivingSystem.dockZone.contains(p.body.translation())));
      settle(game, .3); assert.equal(game.time, 0); assert.equal(game.timed.remaining, 600);
      game.started = true; settle(game, .5); assert.ok(Math.abs(game.timed.remaining - 599.5) < .02);
      const remaining = game.timed.remaining; game.frame(.5); assert.equal(game.timed.remaining, remaining, 'drawing and Pause do not consume clock time');
    } finally { game.dispose(); }
  }
});

test('Timed Shift physically completes both jobs in either order and replaces each independently', () => {
  for (const mode of ['single', 'coop']) for (const first of ['shipping', 'receiving']) {
    const game = timedGame(mode, { difficulty: 'easy' });
    try {
      const world = game.world, receipt = game.receivingSystem.spec.id, shipping = game.orderId;
      game.damage.charge('test:damage', 200, 'Test damage');
      game.level.conveyors[0].powerSwitch.activate();
      if (first === 'shipping') shipExistingStock(game); else putAwayAll(game);
      assert.equal(game.timed.counts[first], 1, `${mode} ${first} completes through physical rules`);
      assert.equal(game.complete, false); assert.equal(game.world, world);
      assert.equal(game.damage.total, 200); assert.ok(game.level.conveyors[0].powerSwitch.high);
      if (first === 'shipping') { assert.equal(game.receivingSystem.spec.id, receipt); assert.notEqual(game.orderId, shipping); putAwayAll(game); }
      else { assert.equal(game.orderId, shipping); assert.notEqual(game.receivingSystem.spec.id, receipt); shipExistingStock(game); }
      assert.deepEqual(game.timed.counts, { shipping: 1, receiving: 1 });
      assert.equal(game.complete, false); assert.ok(game.timed.earnings > 0);
      assert.equal(game.timed.net, game.timed.earnings - 200);
      assert.equal(game.clipboardJobs().length, 4);
      const archived = game.clipboardJobs()[2]; assert.equal(game.jobDone[archived], true);
      const view = game.taskView(archived); assert.ok(view.level.order.every(l => view.itemStatus[l.line] === l.qty));
      assert.deepEqual(game.jobDone.shipping, false); assert.deepEqual(game.jobDone.receiving, false);
    } finally { game.dispose(); }
  }
});

test('Timed Shift ends exactly once at the deadline, awards no unfinished credit, and applies incident time', () => {
  const game = timedGame('single', { minutes: 1 });
  try {
    let calls = 0; game.onComplete = () => calls++; game.started = true; game.time = 44.99; game.falls = 1;
    assert.ok(game.timed.remaining < .02);
    settle(game, .1);
    assert.equal(game.complete, true); assert.equal(game.timed.remaining, 0); assert.equal(calls, 1);
    assert.deepEqual(game.timed.counts, { shipping: 0, receiving: 0 }); assert.equal(game.timed.earnings, 0);
    game.finishJob('shipping'); game.finishJob('receiving'); assert.equal(calls, 1); assert.equal(game.timed.earnings, 0);
    const time = game.time; settle(game, .1); assert.equal(game.time, time);
  } finally { game.dispose(); }
});

test('Timed Shift recovery charges fees without completion credit, bounds history, and increases difficulty', () => {
  const game = timedGame('coop', { difficulty: 'easy' });
  try {
    const before = game.orderId; game.timed.abandon('shipping');
    assert.notEqual(game.orderId, before); assert.equal(game.timed.fees, 100); assert.equal(game.timed.remaining, 585);
    assert.equal(game.timed.counts.shipping, 0); assert.equal(game.timed.net, -100);
    const receipt = game.receivingSystem.spec.id; game.timed.abandon('receiving');
    assert.notEqual(game.receivingSystem.spec.id, receipt); assert.equal(game.timed.fees, 200);
    assert.equal(game.timed.counts.receiving, 0);
    assert.equal(game.timed.tier, 0);
    // Finish callbacks are tested physically above; exercise the archive limit and generator here.
    for (let i = 0; i < 12; i++) {
      game.itemStatus = Object.fromEntries(game.level.order.map(l => [l.line, l.qty]));
      game.finishJob('shipping');
    }
    assert.equal(game.timed.tier, 3); assert.equal(game.timed.history.length, 10);
    assert.equal(game.clipboardJobs().length, 12);
    assert.ok(game.level.order.every(l => l.qty > 0 && l.location));
  } finally { game.dispose(); }
});

test('hard Timed Shift receives secured high pallets and crates into physically empty bays', () => {
  const game = timedGame('single', { difficulty: 'hard' });
  try {
    for (let i = 0; i < 4; i++) {
      const receiving = game.receivingSystem, line = receiving.order[0];
      if (i === 1) { assert.equal(line.pallet, true); assert.equal(line.freight, false); assert.ok(Number(line.location.split('-')[2]) >= 3); }
      if (i === 3) assert.equal(line.freight, true, JSON.stringify({ line, slots: game.timed.slots().filter(s => s.pallet && s.y >= 4.8 && !s.items.length).map(s => s.location) }));
      putAwayAll(game);
      assert.equal(game.timed.counts.receiving, i + 1);
      assert.equal(game.complete, false);
      assert.ok(game.entities.some(e => e.incomingId?.startsWith(receiving.spec.id) || e.contents?.some(r => r.data.incomingId?.startsWith(receiving.spec.id))), 'accepted stock persists');
    }
  } finally { game.dispose(); }
});

test('Timed Shift has recovery when all stock is lost or all racks are displaced', () => {
  const game = timedGame();
  try {
    for (const e of [...game.entities]) if (!e.removed && ['box', 'wrapped', 'freight'].includes(e.kind)) game.shipLoad(e);
    game.timed.replace('shipping');
    assert.equal(game.level.order[0].floorStock, true); assert.equal(game.timed.fees, 75);
    assert.ok(game.entities.some(e => e.kind === 'box' && e.sku === game.level.order[0].sku));
    for (const rack of game.level.racks) rack.body.setRotation(new THREE_FOR_VIEW_TEST.Quaternion().setFromAxisAngle(new THREE_FOR_VIEW_TEST.Vector3(0, 0, 1), 1), true);
    const receipt = game.timed.receiving(); assert.equal(receipt.lines[0].resetRack, true);
    assert.ok(receipt.lines[0].qty > 0);
  } finally { game.dispose(); }
});

test('successive timed clipboards redraw their new PO number and destination even with identical SKU quantities', () => {
  const game = timedGame(), calls = [], previous = context.fillText;
  try {
    context.fillText = text => calls.push(text);
    const view = game.taskView('receiving');
    game.forklift.drawClipboard(view); const key = game.forklift.clipboard.key;
    const next = { ...view, receivingSpec: { ...view.receivingSpec, number: 'PO-T999' },
      level: { ...view.level, order: view.level.order.map(l => ({ ...l, location: 'B-1-1' })) } };
    calls.length = 0; game.forklift.drawClipboard(next);
    assert.notEqual(game.forklift.clipboard.key, key);
    assert.ok(calls.includes('PO-T999')); assert.ok(calls.includes('B-1-1'));
  } finally { context.fillText = previous; game.dispose(); }
});
