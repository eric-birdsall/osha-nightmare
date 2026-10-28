import { CampaignWork } from './campaign-work.js';
import * as THREE from 'three';
import { campaignLevel, campaignProgress, saveCampaignProgress, reservedCampaignLocations } from '../world/campaign.js';
import { captureCheckpoint, restoreCheckpoint } from './checkpoint.js';
import { DamageLedger } from './damage.js';
import { forkViewBounds, showForkFeed } from './fork-view.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../config.js';
import { syncMesh } from '../physics.js';
import { buildLevel, ORDERS } from '../world/level.js';
import { Forklift } from '../entities/forklift.js';
import { Climber } from '../entities/climber.js';
import { WrapSystem, collectStack } from './wrapping.js';
import { Recorder, ReplayDirector, buildCctvFixtures } from './replay.js';
import { settings } from './settings.js';
import { Tutorial } from './tutorial.js';
import { Receiving } from './receiving.js';
import { receivingOrder } from '../world/receiving-orders.js';
import { describeLocation } from '../world/level.js';
import { quatToThree } from '../physics.js';
import { disposeTree } from '../util/meshes.js';
import { sfx } from './audio.js';

// The in-game incident banner: INCIDENT in the UI kit's red block lettering (src/ui/osha-ui.css), on its
// metal plate, with what happened underneath and the time it costs (not when a domino run of racks
// just grows: that's still the one incident)
const INCIDENT_BANNER = (line, penalty = true) =>
  `<span class="osha-text osha-text--red" data-text="INCIDENT">INCIDENT</span><small>${line}</small>` +
  (penalty ? `<small class="penalty">+${CONFIG.score.incidentPenalty} s</small>` : '');

// The crew: Dave climbs, Ralph drives. Each incident type has a few lines picked at random;
// 'again' lines are used once that same thing has already happened this shift.
const INCIDENT_LINES = {
  fell: {
    first: ['Dave tried to fly. Dave cannot fly.', 'Dave took the express route down', 'Dave forgot about gravity', 'Dave missed the jump. Dave hit the floor.'],
    again: ['Dave fell off something... again', 'Gravity: 2, Dave: 0', 'Dave has still not learned to fly'],
  },
  hit: {
    first: ['Ralph ran over Dave', 'Dave got impaled', 'Dave got forked', "Ralph didn't see Dave", 'Ralph says Dave "came out of nowhere"'],
    again: ['Ralph ran over Dave... again', 'Ralph and Dave need to talk', 'Dave got forked. Again.', 'Ralph still doesn\'t see Dave'],
  },
  thrown: {
    first: ['Ralph took that corner way too fast', 'Dave got yeeted off the load', 'Ralph floored it. Dave did not hold on.'],
    again: ['Ralph yeeted Dave... again', 'Dave forgot to hold on. Again.', 'Ralph drives like this on purpose'],
  },
  forkliftBlast: {
    first: ["Ralph's forklift exploded. Dave was nearby.", 'Dave caught the forklift blast', 'Ralph tipped the forklift. Dave left orbit.'],
    again: ['The forklift exploded again. Dave was nearby again.', 'Dave keeps standing near Ralph'],
  },
  fragile: {
    first: ['It said FRAGILE, Dave', 'Dave dropped the FRAGILE box', 'Dave found out what was in the FRAGILE box', 'FRAGILE: handle with Dave'],
    again: ['It said FRAGILE, Dave... again', 'Dave and the FRAGILE boxes: a rematch', 'Another FRAGILE box, another crater'],
  },
  legs: {
    first: ["Ralph dropped the forks. Dave's legs disagreed.", "Ralph broke Dave's legs", "Dave's knees have filed a complaint", 'Ralph found the down button'],
    again: ["Ralph broke Dave's legs... again", "Dave's knees are considering a union", 'Ralph dropped the forks. Again. Ow.'],
  },
  dropped: {
    first: ['Ralph dropped Dave', 'The pallet left. Dave stayed in the air.', 'Dave lost the floor'],
    again: ['Ralph dropped Dave... again', 'Dave keeps trusting Ralph', 'Ralph dropped Dave. Classic Ralph.'],
  },
  wrapped: {
    first: ['Dave got shrink-wrapped', 'Dave is now part of the order', 'Dave has been wrapped for freshness'],
    again: ['Dave got shrink-wrapped... again', 'Dave keeps standing in the wrapper'],
  },
  crushed: {
    first: ['Ralph lifted Dave into the racking', 'Dave headbutted the shelf. The shelf won.', 'Ralph found the ceiling. With Dave.'],
    again: ['Ralph lifted Dave into the racking... again', 'Dave and the top shelf, round two'],
  },
  forks: {
    first: ['Ralph lowered the forks onto Dave', 'Dave was under the forks. Ralph knew.', 'Ralph parked the forks on Dave'],
    again: ['Ralph lowered the forks onto Dave... again', 'Dave keeps standing under the forks'],
  },
  load: {
    first: ['A box fell on Dave', 'Dave caught a box. Face first.', 'Dave was hit by a falling load'],
    again: ['Another box fell on Dave', 'Dave is a box magnet'],
  },
  ladder: {
    first: ['Dave trusted the ladder', 'The ladder had other plans', 'Dave rode the ladder all the way down', 'Dave fell off the ladder. Three points of contact? Zero.'],
    again: ['Dave trusted the ladder... again', 'Ladder: 2, Dave: 0', 'Dave and the ladder are no longer speaking'],
  },
  ladderJump: {
    first: ['Dave tried to jump off the ladder', "Dave jumped. The ladder didn't stay.", 'Dave dismounted the ladder. Badly.', 'Dave: 0, ladder: 1'],
    again: ['Dave jumped off the ladder... again', 'Dave keeps jumping off ladders', 'The ladder saw that coming'],
  },
  ladderKnocked: {
    first: ["Ralph knocked Dave's ladder over", "Ralph forklifted Dave's ladder", 'Ralph took the ladder out from under Dave'],
    again: ["Ralph knocked Dave's ladder over... again", 'Ralph and the ladder: round two'],
  },
  ladderHit: {
    first: ['The ladder fell on Dave', 'Dave got laddered'],
    again: ['The ladder fell on Dave... again', 'Dave got laddered. Again.'],
  },
  tipped: {
    first: ['Ralph tipped the forklift', 'Ralph took that corner on two wheels. Then zero.', 'Ralph wore a seatbelt. The forklift did not.', "The forklift is lying down. Ralph says it's tired."],
    again: ['Ralph tipped the forklift... again', 'Ralph has now tipped more forklifts than orders shipped', 'The forklift is lying down again'],
  },
  rack: {
    first: ['Timber! (Dave was underneath)', 'Dave got flattened by the racking', 'The racking fell on Dave'],
    again: ['The racking fell on Dave... again', 'Dave and the racking: a rematch nobody wanted'],
  },
};
const pick = (list) => list[Math.floor(Math.random() * list.length)];

const listRows = (rows) => (rows.length === 1 ? rows[0] : `${rows.slice(0, -1).join(', ')} and ${rows[rows.length - 1]}`);

// A rack (or a domino run of racks) fell over. byRalph: the forklift touched one of them recently.
function rackDownLine(rows, byRalph, again) {
  const r = listRows(rows);
  if (rows.length > 1) {
    return byRalph
      ? pick([`Ralph took out Racks ${r}`, `Ralph started a domino show: Racks ${r}`, `Racks ${r} are now horizontal. Thanks, Ralph.`])
      : pick([`Racks ${r} went down like dominoes`, `Racks ${r} fell over. Nobody saw anything.`]);
  }
  if (byRalph) {
    return again
      ? pick([`Ralph knocked over Rack ${r}... again`, `Ralph and the racking: another one`])
      : pick([`Ralph knocked over Rack ${r}`, `Ralph found Rack ${r}. With the forklift.`, `Rack ${r} is now horizontal. Thanks, Ralph.`]);
  }
  return pick([`Rack ${r} fell over. Nobody saw anything.`, `Rack ${r} gave up`]);
}

// Owns one playthrough: physics world, scene, entities, order state, swap logic.
export class Game {
  // order: one of the fixed orders (its id in orders.json), or 'shift' for a Full Shift (all five
  // back to back in the same warehouse, one clock)
  constructor({ mode, hud, order = 1 }) {
    this.campaign = campaignLevel(order);
    this.phase = 'shipping';
    this.reservedLocations = this.campaign ? reservedCampaignLocations(this.campaign) : new Set();
    this.receivingSpec = receivingOrder(order);
    this.receiving = !!this.receivingSpec;
    this.levelId = order; // what was picked on the level screen: an order id or 'shift'
    this.shift = order === 'shift';
    this.orderId = this.receiving ? Number(order.split('-')[1]) : this.shift ? ORDERS[0].id : this.campaign ? this.campaign.shipping.id : order; // the order being picked now
    this.mode = mode; // 'single' | 'coop'
    this.hud = hud;
    this.world = new RAPIER.World({ x: 0, y: CONFIG.physics.gravity, z: 0 });
    this.world.timestep = CONFIG.physics.dt;
    this.world.integrationParameters.numSolverIterations = CONFIG.physics.solverIterations;
    this.scene = new THREE.Scene();
    this.staticBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.damage = new DamageLedger(this);
    this.nextEntityId = 1;
    this.entities = [];
    this.bodyMap = new Map();

    this.level = buildLevel(this);
    this.forklift = new Forklift(this, this.level.forkliftSpawn);
    this.climber = new Climber(this, this.level.climberSpawn);
    this.wrap = new WrapSystem(this);
    buildCctvFixtures(this.scene);
    this.clock = 0; // simulation time, for the replay buffer
    this.recorder = new Recorder(this);
    this.pendingReplay = null;
    this.replay = null;

    this.active = 'driver'; // single player: who you control (start in Ralph's seat, by the pick list)
    this.rolesSwapped = false; // co-op: players traded characters
    this.devices = { climber: [], driver: [] };
    this.deviceHints = { climber: '', driver: '' };
    this.time = 0;
    this.started = false; // the shift clock starts when someone first moves Dave or Ralph
    this.falls = 0;
    this.incidentCounts = {};
    this.days = CONFIG.hud.startDays;
    this.dayTimer = 0;
    this.itemStatus = Object.fromEntries(this.level.order.map((o) => [o.line, 0])); // confirmed quantities delivered to the active trailer
    this.statusTimer = 0;
    this.dockRest = new Map();
    this.deliveredLoads = new Set();
    this.hintCooldown = 0;
    this.complete = false;
    this.onComplete = null;
    this.receivingSystem = this.receiving ? new Receiving(this) : null;
    this.tutorial = this.receivingSystem || (!this.shift && this.orderId === 1 ? new Tutorial(this) : null);
    this.workGuide = this.campaign ? new CampaignWork(this) : null;
    this.workGuide?.update(0);
    this.damage.step(0, true);
    const checkpoint = this.campaign && campaignProgress(this.mode, this.levelId)?.checkpoint;
    if (checkpoint) {
      this.beginReceiving(false);
      restoreCheckpoint(this, checkpoint);
      this.toast('Receiving checkpoint restored · shipping complete', 3);
    }
  }

  // ---------------------------------------------------------------- entities

  addEntity(ent) {
    ent.runId ??= this.nextEntityId++;
    this.entities.push(ent);
    this.bodyMap.set(ent.body.handle, ent);
  }

  removeEntity(ent) {
    ent.removed = true;
    this.entities.splice(this.entities.indexOf(ent), 1);
    this.bodyMap.delete(ent.body.handle);
  }

  entityForCollider(c) {
    const b = c?.parent();
    return b ? this.bodyMap.get(b.handle) : undefined;
  }

  // ---------------------------------------------------------------- input routing

  assignDevices(input) {
    this.input = input;
    const pads = input.padCount();
    this.deviceHints = { climber: '', driver: '' };
    if (this.mode === 'single') {
      const all = ['kbm', 'pad0', 'pad1'];
      this.devices = this.active === 'climber' ? { climber: all, driver: [] } : { climber: [], driver: all };
      return;
    }
    // Co-op: Player 1 = first gamepad, Player 2 = second gamepad, or keyboard + mouse if only one pad.
    let p1 = 'pad0';
    let p2 = pads >= 2 ? 'pad1' : 'kbm';
    if (pads === 0) {
      p1 = 'kbm';
      p2 = null;
    }
    const [c, d] = this.rolesSwapped ? [p2, p1] : [p1, p2];
    this.devices = { climber: c ? [c] : [], driver: d ? [d] : [] };
    const label = (dev) => (dev === 'kbm' ? 'Keyboard + Mouse' : dev === 'pad0' ? 'Gamepad 1' : 'Gamepad 2');
    for (const role of ['climber', 'driver']) {
      const dev = this.devices[role][0];
      this.deviceHints[role] = dev ? label(dev) : 'Connect a gamepad to play this role';
    }
  }

  usesKeyboard(role) {
    if (this.mode === 'single') return !this.input || this.input.lastDevice === 'kbm';
    return this.devices[role].includes('kbm');
  }

  keyHint(role, action) {
    const map = { pause: ['Esc', 'Menu'], forkView: ['C', 'R3'], interact: ['E', 'X'], toss: ['R', 'RB'], swap: ['Tab', 'View'], lift: ['R', 'RB'], lower: ['F', 'LB'], crouch: ['Ctrl', 'L3'], reset: ['Q', 'Y'], jump: ['Space', 'A'], gas: ['W', 'A'], brake: ['S', 'B'], drift: ['Space', 'RT'] };
    const [key, button] = map[action];
    return this.usesKeyboard(role) ? key : `<span class="pad-button pad-${button.toLowerCase()}" role="img" aria-label="Controller ${button}">${button === 'View' ? '▱' : button}</span>`;
  }

  readClipboard() {
    this.forklift.drawClipboard();
    if (this.tutorial) this.tutorial.read = true;
  }

  swapCharacter() {
    if (this.mode !== 'single') return;
    this.active = this.active === 'climber' ? 'driver' : 'climber';
    sfx.swap();
  }

  swapRoles() {
    this.rolesSwapped = !this.rolesSwapped;
  }

  // ---------------------------------------------------------------- simulation

  step(dt, actions) {
    this.clock += dt;
    const singleActive = (role) => this.mode !== 'single' || this.active === role;
    const driverOn = singleActive('driver') && this.devices.driver.length > 0;
    const climberOn = singleActive('climber') && this.devices.climber.length > 0;
    if (!this.started) {
      const c = actions.climber;
      const d = actions.driver;
      const daveMoved = climberOn && (Math.abs(c.moveX) > 0.1 || Math.abs(c.moveY) > 0.1 || c.jump);
      const ralphMoved = driverOn && (d.throttle > 0.05 || d.brake > 0.05 || Math.abs(d.steer) > 0.1 || d.liftUp > 0 || d.liftDown > 0);
      this.started = daveMoved || ralphMoved;
    }
    // Holding Q / Y for a full second sends that character back to the start (the forklift to its
    // bay, upright even after tipping). Let go before holding again to do it again.
    this.respawnHold ||= { climber: 0, driver: 0 };
    for (const [role, on] of [['climber', climberOn], ['driver', driverOn]]) {
      if (!(on && actions[role].respawnHeld)) {
        this.respawnHold[role] = 0;
        continue;
      }
      if (this.respawnHold[role] < 0) continue; // done: waiting for the button to come up
      this.respawnHold[role] += dt;
      if (this.respawnHold[role] >= CONFIG.input.respawnHoldTime) {
        this.respawnHold[role] = -1;
        (role === 'climber' ? this.climber : this.forklift).resetToStart();
        if (role === 'climber') this.toast('Dave is back where he started', 2);
      }
    }
    if (driverOn && actions.driver.forkView) this.forklift.forkViewExpanded = !this.forklift.forkViewExpanded;
    if (this.forklift.tipped) this.forklift.forkViewExpanded = false;
    this.forklift.preStep(actions.driver, dt, driverOn);
    this.forklift.look(actions.driver, driverOn);
    this.climber.preStep(actions.climber, dt, climberOn);
    for (const c of this.level.conveyors) c.step(); // the belts carry whatever's on them
    this.world.step();
    this.level.lighting?.step();
    this.puntedStep(dt);
    this.climber.postStep(dt);
    this.damage.step(dt);
    this.watchRacks(dt);
    this.level.storage.step(dt);
    this.watchFragile(dt);
    this.wrap.step(dt);
    if (this.receiving) this.receivingSystem.step(dt);
    else this.orderStep(dt);
    if (this.started && !this.complete) this.time += dt;
    this.dayTimer += dt;
    if (this.dayTimer >= CONFIG.hud.secondsPerDay) {
      this.dayTimer = 0;
      this.days++;
    }
  }

  // A delivered load must be entirely inside the active trailer and resting on its floor.
  deliveryReady(ent) {
    const zone = this.level.dockZone, p = ent.body.translation();
    if (!zone.contains(p) || Math.abs(p.y - zone.floorY) > .12) return false;
    const q = new THREE.Quaternion().copy(ent.body.rotation());
    if (new THREE.Vector3(0, 1, 0).applyQuaternion(q).y < .95) return false;
    const v = ent.body.linvel(), a = ent.body.angvel();
    if (Math.hypot(v.x, v.y, v.z) >= CONFIG.dock.restSpeed || Math.hypot(a.x, a.y, a.z) >= .2) return false;
    const lo = ent.bounds?.min || { x: -.5, y: 0, z: -.6 };
    const hi = ent.bounds?.max || { x: .5, y: .15, z: .6 };
    for (const x of [lo.x, hi.x]) for (const y of [lo.y, hi.y]) for (const z of [lo.z, hi.z]) {
      const corner = new THREE.Vector3(x, y, z).applyQuaternion(q).add(p);
      if (!zone.contains(corner)) return false;
    }
    let onFloor = false;
    for (let i = 0; i < ent.body.numColliders(); i++) {
      const collider = ent.body.collider(i);
      this.world.contactPairsWith(collider, other => {
        if (other.isSensor() || other.parent()?.handle !== this.staticBody.handle) return;
        this.world.contactPair(collider, other, manifold => {
          if (manifold.numContacts() > 0 && Math.abs(manifold.normal().y) > .85) onFloor = true;
        });
      });
    }
    return onFloor;
  }

  // Secured cartons count only inside shrinkwrap; a strapped crate is one whole unit.
  securedCounts(ent) {
    return Object.fromEntries(this.level.order.map(line => [line.line,
      line.freight ? Number(ent.kind === 'freight' && ent.sku === line.sku)
        : ent.kind === 'wrapped' ? ent.skus[line.sku] || 0 : 0]));
  }

  orderStep(dt) {
    this.hintCooldown = Math.max(0, this.hintCooldown - dt);
    if (this.complete) return;
    const loads = [], counts = Object.fromEntries(this.level.order.map(line => [line.line, 0]));
    let looseAtDock = false;
    for (const ent of this.entities) {
      if (!['wrapped', 'pallet', 'freight'].includes(ent.kind)) continue;
      const resting = this.deliveryReady(ent);
      const time = resting ? (this.dockRest.get(ent) || 0) + dt : 0;
      this.dockRest.set(ent, time);
      if (time < CONFIG.dock.restTime) continue;
      if (ent.kind === 'pallet') { looseAtDock ||= collectStack(this, ent).size > 1; continue; }
      loads.push(ent);
      const secured = this.securedCounts(ent);
      for (const line of this.level.order) counts[line.line] += secured[line.line];
      looseAtDock ||= [...collectStack(this, ent)].some(e => e.kind === 'box');
    }
    for (const line of this.level.order) {
      const count = Math.min(counts[line.line], line.qty);
      if (count > this.itemStatus[line.line]) sfx.check();
      this.itemStatus[line.line] = count;
    }
    this.deliveredLoads = new Set(loads);
    if (this.level.order.every(line => counts[line.line] >= line.qty)) {
      this.finishOrder(loads);
      return;
    }
    if (looseAtDock) this.hint('Wrap loose cartons before shipping. Strapped crates ship as whole units.');
    else if (loads.length) {
      const remaining = this.level.order.filter(line => counts[line.line] < line.qty)
        .map(line => `${line.qty - counts[line.line]} × SKU ${line.sku}`);
      this.hint(`Delivered loads count together. Still needed: ${remaining.join(', ')}`);
    }
  }

  // Gathered stock on a load, used by the picking tutorial. Delivery counts are separate.
  lineCounts(ent) {
    const n = this.securedCounts(ent);
    for (const e of collectStack(this, ent)) {
      if (e.kind !== 'box') continue;
      const line = this.level.order.find(l => !l.freight && l.sku === e.sku);
      if (line) n[line.line]++;
    }
    return n;
  }

  hint(text) {
    if (this.hintCooldown > 0) return;
    this.hintCooldown = 4;
    this.toast(text, 3);
    sfx.hint();
  }

  toast(text, secs) {
    this.hud?.toast(text, secs);
  }

  // Delivered loads together fill the order. In a Full Shift, all of them leave and the next
  // order's pick list comes in (same warehouse, mess and all; the clock keeps running); otherwise,
  // or after the last order, the level's done.
  finishOrder(load) {
    sfx.complete();
    if (this.campaign && !this.receiving) {
      for (const ent of Array.isArray(load) ? load : load ? [load] : []) if (!ent.removed) this.shipLoad(ent);
      this.beginReceiving();
      return;
    }
    if (this.campaign) saveCampaignProgress(this.mode, this.levelId, { complete: true, shipping: true });
    const next = this.shift && ORDERS[ORDERS.findIndex((o) => o.id === this.orderId) + 1];
    if (!next) {
      this.complete = true;
      this.onComplete?.({ time: this.time, falls: this.falls });
      return;
    }
    for (const ent of Array.isArray(load) ? load : load ? [load] : []) if (!ent.removed) this.shipLoad(ent);
    this.orderId = next.id;
    this.level.setOrder(next);
    this.itemStatus = Object.fromEntries(this.level.order.map((o) => [o.line, 0]));
    this.dockRest = new Map();
    this.deliveredLoads = new Set();
    this.hud?.banner(
      `<span class="osha-text osha-text--yellow" data-text="ORDER ${next.id}">ORDER ${next.id}</span><small>Shipped! Next up: ${next.title} · ${next.dock}</small>`,
      3.5,
    );
  }

  beginReceiving(save = true) {
    this.phase = 'receiving';
    this.receiving = true;
    this.receivingSpec = this.campaign.receiving;
    this.climber.dropAll({ x: 0, y: 0, z: 0 });
    this.climber.dropLadder();
    if (this.tutorial?.marker) this.tutorial.marker.visible = false;
    this.level.setOrder(this.receivingSpec);
    this.itemStatus = Object.fromEntries(this.level.order.map(line => [line.line, 0]));
    this.statusTimer = 0; this.dockRest = new Map(); this.deliveredLoads = new Set();
    this.receivingSystem = new Receiving(this);
    this.receivingSystem.read = true; // movement and clipboard controls were taught during shipping
    this.receivingSystem.stage = 1;
    this.tutorial = this.receivingSystem;
    this.forklift.clipboard.key = null;
    if (save) saveCampaignProgress(this.mode, this.levelId, { shipping: true, checkpoint: captureCheckpoint(this) });
    this.hud?.banner(save ? `Shipping complete<small>Delivery arriving at ${this.receivingSpec.dock} · Receiving checkpoint saved</small>` : `Receiving checkpoint<small>Shipping complete · Continue at ${this.receivingSpec.dock}</small>`, 4);
  }

  // The truck pulls away with a delivered load: it's gone from the warehouse
  shipLoad(load) {
    if (this.climber.wrapped?.body === load.body) this.climber.resetToStart();
    const stack = collectStack(this, load);
    const handles = new Set([...stack].map(ent => ent.body.handle));
    this.climber.forgetBodies(handles);
    for (const ent of stack) {
      this.world.removeRigidBody(ent.body); this.scene.remove(ent.mesh); this.removeEntity(ent);
    }
  }

  incidentLine(reason) {
    const lines = INCIDENT_LINES[reason];
    if (!lines) return 'Dave had an incident';
    this.incidentCounts[reason] = (this.incidentCounts[reason] || 0) + 1;
    return pick(this.incidentCounts[reason] > 1 ? lines.again : lines.first);
  }

  // opts: { victim: 'Dave' | 'Ralph' | 'Nobody', culprit, subject: replay camera target, line, at: position }
  onIncident(reason, opts = {}) {
    this.falls++;
    this.days = 0;
    this.dayTimer = 0;
    sfx.thud();
    setTimeout(sfx.incident, 250);
    const subject = opts.subject || 'climber';
    const at = opts.at || (subject === 'forklift' ? this.forklift.body.translation() : this.climber.feet);
    const incident = {
      key: reason,
      number: this.falls,
      line: opts.line || this.incidentLine(reason),
      victim: opts.victim || 'Dave',
      culprit: opts.culprit,
      causes: opts.causes,
      subject,
      where: describeLocation(at),
    };
    this.lastIncident = incident;
    this.hud?.banner(INCIDENT_BANNER(incident.line));
    // Queue the CCTV replay once things have had a moment to fall over (if replays are switched on)
    if (settings.cctvReplays && !this.replay && !this.pendingReplay) {
      this.pendingReplay = { incidentTime: this.clock, at: this.clock + CONFIG.replay.delay, incident };
    }
    return incident;
  }

  // Racking is wobbly: when the forklift or a falling neighbour newly hits a rack, the impact also
  // rocks the top of the rack in the direction of travel, so medium-speed hits tip it over.
  // (The raw contact mostly pushes on the uprights' feet, which would only slide it.)
  rackImpacts(dt) {
    const cfg = CONFIG.racks;
    const now = new Set();
    const hit = (key, rack, velocity, mass, kick, minSpeed) => {
      // One kick per new contact: bodies touch through several collider pairs at once
      if (now.has(key)) return;
      now.add(key);
      if (this.rackContacts?.has(key) || rack.fallen) return;
      const speed = Math.hypot(velocity.x, velocity.z);
      if (speed < minSpeed) return;
      const dir = new THREE.Vector3(velocity.x, 0, velocity.z).normalize();
      // Back-to-back racks are tied together, so the hit rocks both
      for (const r of [rack, rack.partner]) {
        // Only rock racks that are still standing: one that's already going over needs no help,
        // and kicking it again would feed back into the next hit
        if (!r || r.fallen || this.rackTilted(r)) continue;
        // Size the kick for the rack plus the stock sitting on it (relative to an empty rack),
        // capped so no hit can launch a rack
        const loadedMass = this.loadedMass(r);
        const impulse = Math.min((mass * loadedMass * kick * speed) / rack.mass, loadedMass * cfg.maxKickSpeed);
        const top = new THREE.Vector3(0, r.uprightH - 0.2, 0).applyQuaternion(quatToThree(r.body.rotation())).add(r.body.translation());
        r.body.applyImpulseAtPoint(dir.clone().multiplyScalar(impulse), top, true);
      }
    };
    // The forklift (chassis or forks), using its velocity from before this step's collision
    const fl = this.forklift;
    const v = this.prevForkliftVel || { x: 0, z: 0 };
    for (const body of [fl.body, fl.carriage]) {
      for (let i = 0; i < body.numColliders(); i++) {
        this.world.contactPairsWith(body.collider(i), (other) => {
          const ent = this.entityForCollider(other);
          if (ent?.kind === 'rack') hit(`fl:${ent.name}`, ent, v, ent.mass, cfg.tipKick, cfg.tipImpactSpeed);
          // Top-heavy props (packing benches) get a push up high as well, so they topple
          // rather than skid along in front of the forks
          if (ent?.kind === 'prop' && ent.kickTop) {
            const key = `fp:${ent.body.handle}`;
            const speed = Math.hypot(v.x, v.z);
            if (now.has(key)) return;
            now.add(key);
            if (this.rackContacts?.has(key) || speed < 1.0) return;
            const dir = new THREE.Vector3(v.x, 0, v.z).normalize();
            // Back-to-back benches brace each other, so the push goes to both
            for (const p of [ent, ent.partner]) {
              if (!p) continue;
              const top = new THREE.Vector3(0, p.kickTop, 0).applyQuaternion(quatToThree(p.body.rotation())).add(p.body.translation());
              p.body.applyImpulseAtPoint(dir.clone().multiplyScalar(p.mass * Math.min(speed, 4)), top, true);
            }
          }
        });
      }
    }
    const lv = fl.body.linvel();
    this.prevForkliftVel = { x: lv.x, z: lv.z };
    // A falling rack hitting its neighbour (dominoes): use the speed of the falling rack's top
    for (const r of this.level.racks) {
      if (!this.rackTilted(r)) continue; // still standing
      const top = new THREE.Vector3(0, r.uprightH - 0.2, 0).applyQuaternion(quatToThree(r.body.rotation())).add(r.body.translation());
      const tv = r.body.velocityAtPoint(top);
      for (let i = 0; i < r.body.numColliders(); i++) {
        this.world.contactPairsWith(r.body.collider(i), (other) => {
          const ent = this.entityForCollider(other);
          if (ent?.kind === 'rack' && ent !== r) hit(`rk:${r.name}:${ent.name}`, ent, tv, r.mass, cfg.rackKick, cfg.fallImpactSpeed);
        });
      }
    }
    this.rackContacts = now;
  }

  // ---------------------------------------------------------------- Punted boxes

  // A punted box lands dead, so it ends up exactly where Dave's ghost showed: the first time
  // anything knocks it off its flight path it stops. Landing on top of something, it stays put;
  // hitting a wall or a panel side-on, it drops straight down (and then lands dead on whatever's
  // below). Climber.updatePuntGhost predicts the same thing.
  puntedStep(dt) {
    const g = CONFIG.physics.gravity;
    for (const box of this.entities) {
      const p = box.punted;
      if (!p) continue;
      if (box.carried || box.removed) {
        box.punted = null;
        continue;
      }
      p.time = (p.time || 0) + dt;
      if (p.time > 4) {
        box.punted = null; // came to rest somewhere without a clean landing
        continue;
      }
      const v = box.body.linvel();
      const dx = v.x - p.vel.x;
      const dy = v.y - (p.vel.y + g * dt);
      const dz = v.z - p.vel.z;
      if (Math.hypot(dx, dy, dz) < 0.5) {
        p.vel.set(v.x, v.y, v.z); // still flying free
        continue;
      }
      box.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      if (dy > Math.hypot(dx, dz)) {
        // Pushed up: it landed on something. The physics lets it skid on for the rest of that
        // step, so settle it on the spot the ghost showed (if that's where it came down)
        const t = box.body.translation();
        if (p.land && Math.hypot(t.x - p.land.x, t.z - p.land.z) < 0.4 && Math.abs(t.y - p.land.y) < 0.3) {
          box.body.setTranslation({ x: p.land.x, y: Math.max(t.y, p.land.y), z: p.land.z }, true);
          box.body.setRotation(p.rot ?? box.body.rotation(), true);
        }
        box.body.setLinvel({ x: 0, y: Math.min(0, v.y), z: 0 }, true);
        box.punted = null;
      } else {
        // Side-on into something: straight down from here, in line with the ghost's spot (the
        // physics may have nudged it up onto a corner the ghost had it dropping past)
        const t = box.body.translation();
        if (p.land && Math.hypot(t.x - p.land.x, t.z - p.land.z) < 0.4 && t.y > p.land.y - 0.05) {
          box.body.setTranslation({ x: p.land.x, y: t.y, z: p.land.z }, true);
          if (p.rot) box.body.setRotation(p.rot, true);
        }
        box.body.setLinvel({ x: 0, y: Math.min(0, v.y), z: 0 }, true);
        p.vel.set(0, Math.min(0, v.y), 0);
      }
    }
  }

  // ---------------------------------------------------------------- FRAGILE boxes

  // A FRAGILE box Dave punted or dropped is armed: the first thing it hits sets it off.
  watchFragile(dt) {
    for (const box of this.entities) {
      if (!box.armed || box.carried || box.removed) continue;
      box.armedTime = (box.armedTime || 0) + dt;
      if (box.armedTime < 0.08) continue; // clear of Dave's hands first
      let hit = false;
      for (let i = 0; i < box.body.numColliders() && !hit; i++) {
        const c = box.body.collider(i);
        this.world.contactPairsWith(c, (other) => {
          if (hit || other.handle === this.climber.collider.handle) return;
          this.world.contactPair(c, other, (m) => {
            if (m.numContacts() > 0) hit = true;
          });
        });
      }
      if (hit) this.explode(box);
    }
  }

  // A FRAGILE box went off: restock it on its shelf (or it's gone, if it was a loose one), so
  // an order box can't be lost for good, then the blast. It's on Dave either way.
  explode(box) {
    this.damage.package(box, 'Fragile package broken');
    const p = box.body.translation();
    const at = new THREE.Vector3(p.x, p.y, p.z);
    box.armed = false;
    box.armedTime = 0;
    if (box.home) {
      const pallet = box.storagePallet;
      if (pallet && !pallet.removed && new THREE.Vector3(0, 1, 0).applyQuaternion(pallet.body.rotation()).y > .8) {
        // High-storage stock returns to its pallet, even after Ralph has lowered it to staging.
        const pos = box.storageOffset.clone().applyQuaternion(pallet.body.rotation()).add(pallet.body.translation());
        box.body.setTranslation(pos, true);
        box.body.setRotation(pallet.body.rotation(), true);
      } else {
        box.body.setTranslation(box.home.pos, true);
        box.body.setRotation(box.home.rot, true);
      }
      box.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      box.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      box.handled = false;
    } else {
      this.world.removeRigidBody(box.body);
      this.scene.remove(box.mesh);
      this.removeEntity(box);
    }
    if (!this.blast(at, { exclude: box, daveReason: 'fragile' })) this.onIncident('fragile', { victim: 'Nobody', culprit: 'Dave', at });
  }

  // Like a grenade: everything loose within the blast radius is flung outward and up (racks,
  // pallets, boxes, ladders, the forklift a bit, and Dave). Returns true if Dave was caught in it
  // (that's an incident with daveReason).
  blast(at, { exclude = null, skipForklift = false, daveReason = 'fragile' } = {}) {
    const cfg = CONFIG.blast;
    const push = (body, mass, scale = 1, point = null) => {
      const t = body.translation();
      const d = new THREE.Vector3(t.x - at.x, 0, t.z - at.z);
      const dist = Math.hypot(d.x, t.y - at.y, d.z);
      if (dist > cfg.radius) return false;
      const k = (1 - dist / cfg.radius) * scale;
      if (d.lengthSq() < 1e-4) d.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      d.normalize().setY(cfg.upward).normalize();
      const j = d.multiplyScalar(mass * cfg.speed * k);
      body.enableCcd(true); // flung this fast, things would tunnel through the walls
      if (point) body.applyImpulseAtPoint(j, point, true);
      else body.applyImpulse(j, true);
      return true;
    };
    for (const e of this.entities) {
      if (e === exclude || e.removed || e.carried || !e.body.isDynamic()) continue;
      if (e.kind === 'rack') {
        // Rocks the whole rack: push up near its top so it goes over
        const top = new THREE.Vector3(0, e.uprightH * 0.67, 0).applyQuaternion(quatToThree(e.body.rotation())).add(e.body.translation());
        push(e.body, this.loadedMass(e), 0.45, top);
      } else if (push(e.body, e.body.mass())) {
        const s = cfg.spin;
        e.body.setAngvel({ x: (Math.random() - 0.5) * s, y: (Math.random() - 0.5) * s, z: (Math.random() - 0.5) * s }, true);
      }
    }
    if (!skipForklift) push(this.forklift.body, CONFIG.forklift.mass, cfg.forkliftScale);
    this.spawnBlast(at);
    // Dave inside the blast goes flying
    const feet = this.climber.feet;
    const dist = feet.distanceTo(at);
    if (this.climber.state === 'ragdoll' || dist >= cfg.radius) return false;
    const v = Math.min(cfg.daveSpeed, cfg.speed * (1 - dist / cfg.radius));
    const away = new THREE.Vector3(feet.x - at.x, 0, feet.z - at.z).normalize().multiplyScalar(v).setY(v * 0.8);
    this.climber.onLadder = null;
    this.climber.goRagdoll(daveReason, away);
    return true;
  }

  // Flash and fireball for an explosion (cosmetic). Also noted for the CCTV replay.
  spawnBlast(at) {
    this.recorder?.noteBlast(this.clock, at);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0xffa020, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    mesh.position.copy(at);
    mesh.scale.setScalar(0.2);
    const light = new THREE.PointLight(0xffb040, 400, CONFIG.blast.radius * 2);
    light.position.copy(at);
    this.scene.add(mesh, light);
    (this.blasts ||= []).push({ mesh, light, t: 0 });
  }

  updateBlasts(dt) {
    if (!this.blasts?.length) return;
    const { radius, fireball, duration } = CONFIG.blast;
    for (const b of this.blasts) {
      b.t += dt;
      const k = Math.min(1, b.t / duration);
      const grow = 1 - (1 - k) ** 3; // fast out, then hangs
      b.mesh.scale.setScalar(0.2 + grow * radius * fireball);
      b.mesh.material.opacity = 0.9 * (1 - k);
      b.mesh.material.color.setHSL(0.08 - k * 0.06, 1, 0.55 - k * 0.3);
      b.light.intensity = 400 * (1 - k);
    }
    for (const b of this.blasts.filter((x) => x.t >= duration)) {
      this.scene.remove(b.mesh, b.light);
      b.mesh.geometry.dispose();
      b.mesh.material.dispose();
    }
    this.blasts = this.blasts.filter((x) => x.t < duration);
  }

  // Knocked over, leaning, or shoved off its spot.
  rackKnocked(rack) {
    const t = rack.body.translation();
    const h = rack.home;
    return rack.fallen || this.rackTilted(rack, 3) || Math.hypot(t.x - h.x, t.z - h.z) > 0.2;
  }

  // A stocked box that fell off its shelf (not one Dave picked up and moved).
  boxFell(b) {
    if (b.handled || b.carried || b.removed) return false;
    if (b.storagePallet && !b.storagePallet.removed && collectStack(this, b.storagePallet).has(b)) return false;
    const t = b.body.translation();
    const h = b.home.pos;
    return Math.hypot(t.x - h.x, t.y - h.y, t.z - h.z) > 0.4;
  }

  // Knocked over or shoved, or some of its stock has fallen off.
  rackDisturbed(rack) {
    return this.rackKnocked(rack) || rack.stock.some((b) => this.boxFell(b));
  }

  // Stand every disturbed rack back up where it belongs and put the stock that fell off back on
  // its shelves. Boxes Dave has handled (holding, or moved somewhere), and anything on a pallet
  // or wrapped load, stay where they are.
  // Returns null if there's nothing to reset, else { forkliftMoved }.
  resetRacks() {
    const racks = this.level.racks.filter((r) => this.rackDisturbed(r));
    if (!racks.length) return null;
    const knocked = racks.filter((r) => this.rackKnocked(r));
    const world = this.world;
    const footprint = (r) => ({
      center: { x: r.home.x, y: r.home.y + r.uprightH / 2, z: r.home.z },
      shape: new RAPIER.Cuboid((r.x1 - r.x0) / 2 + 0.1, r.uprightH / 2, (r.z1 - r.z0) / 2 + 0.05),
    });
    const inside = (r, test) => {
      const { center, shape } = footprint(r);
      let hit = false;
      world.intersectionsWithShape(center, { x: 0, y: 0, z: 0, w: 1 }, shape, (c) => {
        if (test(c)) hit = true;
        return !hit;
      });
      return hit;
    };
    const fl = this.forklift;
    // The forklift parked (or lying) where a rack goes: the night shift drives it back to its bay
    const forkliftMoved = knocked.some((r) => inside(r, (c) => fl.ownsCollider(c)));
    if (forkliftMoved) {
      if (this.climber.holdingOn) this.climber.letGo();
      fl.height = CONFIG.forklift.liftMin;
      fl.liftVel = 0;
      fl.teleport(this.level.forkliftSpawn.pos, this.level.forkliftSpawn.yaw);
    }
    // Dave standing where a rack goes: step him out into its aisle
    const daveIn = knocked.find((r) => inside(r, (c) => c.handle === this.climber.collider.handle));
    if (daveIn) {
      const f = this.climber.feet;
      const z = daveIn.face === 'south' ? daveIn.z1 + 1.0 : daveIn.z0 - 1.0;
      this.climber.body.setTranslation({ x: f.x, y: daveIn.base + this.climber.centerOff + 0.05, z }, true);
    }

    const names = new Set(knocked.map((r) => r.name));
    // Stock that's been picked onto a pallet stays picked
    const onLoads = new Set();
    for (const e of this.entities) if (e.kind === 'pallet' || e.kind === 'wrapped') for (const s of collectStack(this, e)) onLoads.add(s);
    const zero = { x: 0, y: 0, z: 0 };
    for (const r of knocked) {
      r.body.setTranslation(r.home, true);
      r.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      r.body.setLinvel(zero, true);
      r.body.setAngvel(zero, true);
      r.fallen = false;
      r.ralphTouched = -Infinity;
    }
    for (const r of racks) {
      for (const e of r.stock) {
        if (onLoads.has(e) || !(this.boxFell(e) || this.rackKnocked(r))) continue;
        if (e.handled || e.carried || e.removed) continue;
        e.body.setTranslation(e.home.pos, true);
        e.body.setRotation(e.home.rot, true);
        e.body.setLinvel(zero, true);
        e.body.setAngvel(zero, true);
      }
    }
    // Anything else lying where a rack now stands goes out into its aisle
    for (const e of this.entities) {
      if (!['box', 'pallet', 'ladder'].includes(e.kind) || e.carried || e.removed || onLoads.has(e)) continue;
      if (e.kind === 'box' && e.home && names.has(e.home.rack) && !e.handled) continue;
      if (e.kind === 'ladder' && e.state !== 'open' && e.state !== 'dropped') continue;
      const t = e.body.translation();
      const r = knocked.find((k) => t.x > k.x0 - 0.3 && t.x < k.x1 + 0.3 && t.z > k.z0 - 0.3 && t.z < k.z1 + 0.3 && Math.abs(t.y - k.base) < 5.5);
      if (!r) continue;
      const z = r.face === 'south' ? r.z1 + 1.2 : r.z0 - 1.2;
      e.body.setTranslation({ x: Math.min(Math.max(t.x, r.x0 + 0.5), r.x1 - 0.5), y: r.base + 0.6, z }, true);
      e.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      e.body.setLinvel(zero, true);
      e.body.setAngvel(zero, true);
    }
    this.rackRun = null;
    this.rackContacts = new Set();
    return { forkliftMoved };
  }

  // Leaning more than 8 degrees: on its way over.
  rackTilted(rack, degrees = 8) {
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quatToThree(rack.body.rotation()));
    return up.y < Math.cos((degrees * Math.PI) / 180);
  }

  // A rack's own mass plus the stock resting on its shelves (not other racks or ladders leaning on it).
  loadedMass(rack) {
    let m = rack.mass;
    for (const e of collectStack(this, rack)) {
      if (['box', 'pallet', 'wrapped', 'freight'].includes(e.kind)) m += e.mass || 0;
    }
    return m;
  }

  // Racks: note when the forklift touches one, and raise an incident when a rack goes over.
  // Rows falling within a few seconds of each other are one domino incident.
  watchRacks(dt) {
    const fl = this.forklift;
    this.rackTouchTimer = (this.rackTouchTimer || 0) - dt;
    if (this.rackTouchTimer <= 0) {
      this.rackTouchTimer = 0.1;
      for (const body of [fl.body, fl.carriage]) {
        for (let i = 0; i < body.numColliders(); i++) {
          this.world.contactPairsWith(body.collider(i), (other) => {
            const ent = this.entityForCollider(other);
            if (ent?.kind === 'rack') ent.ralphTouched = this.clock;
          });
        }
      }
    }
    this.rackImpacts(dt);
    for (const r of this.level.racks) {
      if (r.fallen) continue;
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quatToThree(r.body.rotation()));
      if (up.y > Math.cos((40 * Math.PI) / 180)) continue;
      this.damage.rack(r);
      r.fallen = true;
      const byRalph = this.clock - (r.ralphTouched ?? -Infinity) < 4;
      const run = this.rackRun;
      if (run && this.clock - run.time < 6) {
        // Part of the same domino run: grow the existing incident instead of adding one
        run.rows.push(r.name);
        run.time = this.clock;
        run.byRalph ||= byRalph;
        run.incident.line = rackDownLine(run.rows, run.byRalph, false);
        run.incident.culprit = run.byRalph ? 'Ralph' : undefined;
        this.hud?.banner(INCIDENT_BANNER(run.incident.line, false));
        continue;
      }
      const again = (this.incidentCounts.rackDown = (this.incidentCounts.rackDown || 0) + 1) > 1;
      const t = r.body.translation();
      const incident = this.onIncident('rackDown', {
        victim: byRalph ? 'Ralph' : 'Nobody',
        culprit: byRalph ? 'Ralph' : undefined,
        subject: `rack:${r.name}`,
        line: rackDownLine([r.name], byRalph, again),
        at: { x: t.x, y: 0, z: t.z },
      });
      this.rackRun = { time: this.clock, rows: [r.name], byRalph, incident };
    }
  }

  // Advance the CCTV replay (the world and the clock stay frozen meanwhile). Returns true while
  // it's showing.
  updateReplay(dt, skip) {
    if (this.replay && !this.replay.update(dt, skip)) this.replay = null;
    return !!this.replay;
  }

  // ---------------------------------------------------------------- per frame

  frame(dt) {
    for (const ent of this.entities) {
      if (ent.carried) continue;
      syncMesh(ent.body, ent.mesh);
    }
    this.updateBlasts(dt);
    for (const fan of this.level.fans || []) fan.rotation.y += fan.userData.speed * dt;
    // Hazards spark and drip; the cameras in use hear the zaps
    const ears = this.mode === 'single' ? [this.active === 'driver' ? this.forklift.camera.position : this.climber.camera.position] : [this.forklift.camera.position, this.climber.camera.position];
    this.level.hazards?.update(dt, ears);
    this.level.lighting?.update(dt);
    for (const c of this.level.conveyors) c.update(dt);
    this.forklift.updateVisuals(dt);
    this.climber.updateTarget();
    this.climber.updateVisuals(dt);
    this.climber.updateCamera(dt);
    this.forklift.updateCamera();
    this.tutorial?.update(dt);
    this.workGuide?.update(dt);
    this.recorder.capture(this.clock);
    if (this.pendingReplay && this.clock >= this.pendingReplay.at) {
      this.replay = new ReplayDirector(this, this.pendingReplay);
      this.pendingReplay = null;
    }
  }

  render(renderer, w, h) {
    renderer.shadowMap.needsUpdate = true;
    if (this.replay) return this.replay.render(renderer, w, h);
    const driverCamera = this.forklift.forkViewExpanded ? this.forklift.forkCamera : this.forklift.camera;
    const views =
      this.mode === 'single'
        ? [[this.active === 'climber' ? this.climber.camera : driverCamera, 0, 0, w, h]]
        : [
            [this.climber.camera, 0, h / 2, w, h / 2],
            [driverCamera, 0, 0, w, h / 2],
          ];
    renderer.setScissorTest(true);
    for (const [cam, x, y, vw, vh] of views) {
      cam.aspect = vw / vh;
      cam.updateProjectionMatrix();
      renderer.setViewport(x, y, vw, vh);
      renderer.setScissor(x, y, vw, vh);
      renderer.render(this.scene, cam);
      renderer.shadowMap.needsUpdate = false;
      if (cam === driverCamera && showForkFeed(this.forklift)) {
        const b = forkViewBounds(vw, vh);
        const feed = this.forklift.forkCamera;
        feed.aspect = b.width / b.height;
        feed.updateProjectionMatrix();
        renderer.setViewport(x + b.left, y + vh - b.top - b.height, b.width, b.height);
        renderer.setScissor(x + b.left, y + vh - b.top - b.height, b.width, b.height);
        renderer.clearDepth();
        renderer.render(this.scene, feed);
      }
    }
    renderer.setViewport(0, 0, w, h);
    renderer.setScissorTest(false);
  }

  dispose() {
    this.replay?.finish();
    disposeTree(this.scene);
    this.world.free();
  }
}
