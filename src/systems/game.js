import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../config.js';
import { syncMesh } from '../physics.js';
import { buildLevel } from '../world/level.js';
import { Forklift } from '../entities/forklift.js';
import { Climber } from '../entities/climber.js';
import { WrapSystem, collectStack } from './wrapping.js';
import { Recorder, ReplayDirector, buildCctvFixtures } from './replay.js';
import { disposeTree } from '../util/meshes.js';
import { sfx } from './audio.js';

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
  rack: {
    first: ['Timber! (Dave was underneath)', 'Dave got flattened by the racking', 'The racking fell on Dave'],
    again: ['The racking fell on Dave... again', 'Dave and the racking: a rematch nobody wanted'],
  },
};
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// Owns one playthrough: physics world, scene, entities, order state, swap logic.
export class Game {
  constructor({ mode, hud }) {
    this.mode = mode; // 'single' | 'coop'
    this.hud = hud;
    this.world = new RAPIER.World({ x: 0, y: CONFIG.physics.gravity, z: 0 });
    this.world.timestep = CONFIG.physics.dt;
    this.world.integrationParameters.numSolverIterations = CONFIG.physics.solverIterations;
    this.scene = new THREE.Scene();
    this.staticBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
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

    this.active = 'climber'; // single player: who you control
    this.rolesSwapped = false; // co-op: players traded characters
    this.devices = { climber: [], driver: [] };
    this.deviceHints = { climber: '', driver: '' };
    this.time = 0;
    this.falls = 0;
    this.incidentCounts = {};
    this.days = CONFIG.hud.startDays;
    this.dayTimer = 0;
    this.itemStatus = { A: false, B: false };
    this.statusTimer = 0;
    this.dockRest = new Map();
    this.hintCooldown = 0;
    this.complete = false;
    this.onComplete = null;
    this.incidentSign.set(this.days);
  }

  // ---------------------------------------------------------------- entities

  addEntity(ent) {
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
    return this.devices[role].includes('kbm');
  }

  keyHint(role, action) {
    const kb = this.usesKeyboard(role);
    const pad = this.devices[role].some((d) => d.startsWith('pad'));
    const map = { interact: ['E', 'X'] };
    const [k, p] = map[action];
    if (kb && pad && this.mode === 'single') return `${k} / ${p}`;
    return kb ? k : p;
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
    this.forklift.preStep(actions.driver, dt, driverOn);
    this.forklift.look(actions.driver, driverOn);
    this.climber.preStep(actions.climber, dt, climberOn);
    this.world.step();
    this.climber.postStep(dt);
    this.wrap.step(dt);
    this.orderStep(dt);
    if (!this.complete) this.time += dt;
    this.dayTimer += dt;
    if (this.dayTimer >= CONFIG.hud.secondsPerDay) {
      this.dayTimer = 0;
      this.days++;
    }
  }

  orderStep(dt) {
    this.hintCooldown = Math.max(0, this.hintCooldown - dt);
    this.statusTimer -= dt;
    if (this.statusTimer <= 0) {
      this.statusTimer = 0.2;
      const onPallet = { A: false, B: false };
      for (const ent of this.entities) {
        if (ent.kind === 'wrapped') for (const i of ent.items) onPallet[i] = true;
        if (ent.kind === 'pallet') for (const e of collectStack(this, ent)) if (e.item) onPallet[e.item] = true;
      }
      for (const k of ['A', 'B']) {
        if (onPallet[k] && !this.itemStatus[k]) sfx.check();
        this.itemStatus[k] = onPallet[k];
      }
    }
    if (this.complete) return;

    const dock = this.level.dockZone;
    const cfg = CONFIG.dock;
    for (const ent of this.entities) {
      if (ent.kind !== 'wrapped' && ent.kind !== 'pallet') continue;
      const b = ent.body;
      const t = b.translation();
      const lv = b.linvel();
      const inDock = dock.contains(t) && t.y < 1.5;
      const still = Math.hypot(lv.x, lv.y, lv.z) < cfg.restSpeed;
      const r = inDock && still ? (this.dockRest.get(ent) || 0) + dt : 0;
      this.dockRest.set(ent, r);
      if (r < cfg.restTime) continue;
      if (ent.kind === 'wrapped') {
        if (ent.items.has('A') && ent.items.has('B')) {
          this.finishOrder();
          return;
        }
        const missing = ['A', 'B'].filter((i) => !ent.items.has(i)).map((i) => `Item ${i}`);
        this.hint(`Order incomplete: missing ${missing.join(' and ')}`);
      } else if (collectStack(this, ent).size > 1) {
        this.hint('Wrap it first.');
      }
    }
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

  finishOrder() {
    this.complete = true;
    sfx.complete();
    this.onComplete?.({ time: this.time, falls: this.falls });
  }

  incidentLine(reason) {
    const lines = INCIDENT_LINES[reason];
    if (!lines) return 'Dave had an incident';
    this.incidentCounts[reason] = (this.incidentCounts[reason] || 0) + 1;
    return pick(this.incidentCounts[reason] > 1 ? lines.again : lines.first);
  }

  onIncident(reason) {
    this.falls++;
    this.days = 0;
    this.dayTimer = 0;
    sfx.thud();
    setTimeout(sfx.incident, 250);
    const line = this.incidentLine(reason);
    this.hud?.banner(`⚠ INCIDENT ⚠<small>${line}</small>`);
    // Queue the CCTV replay once the ragdoll has had a moment to flail
    if (!this.replay && !this.pendingReplay) {
      this.pendingReplay = { incidentTime: this.clock, at: this.clock + CONFIG.replay.delay, reason: line };
    }
  }

  // Advance the replay; returns true while it is still showing.
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
    this.forklift.updateVisuals(dt);
    this.climber.updateTarget();
    this.climber.updateVisuals(dt);
    this.climber.updateCamera(dt);
    this.forklift.updateCamera();
    this.incidentSign.set(this.days);
    this.recorder.capture(this.clock);
    if (this.pendingReplay && this.clock >= this.pendingReplay.at) {
      this.replay = new ReplayDirector(this, this.pendingReplay);
      this.pendingReplay = null;
    }
  }

  render(renderer, w, h) {
    renderer.shadowMap.needsUpdate = true;
    if (this.replay) return this.replay.render(renderer, w, h);
    const views =
      this.mode === 'single'
        ? [[this.active === 'climber' ? this.climber.camera : this.forklift.camera, 0, 0, w, h]]
        : [
            [this.climber.camera, 0, h / 2, w, h / 2],
            [this.forklift.camera, 0, 0, w, h / 2],
          ];
    renderer.setScissorTest(true);
    for (const [cam, x, y, vw, vh] of views) {
      cam.aspect = vw / vh;
      cam.updateProjectionMatrix();
      renderer.setViewport(x, y, vw, vh);
      renderer.setScissor(x, y, vw, vh);
      renderer.render(this.scene, cam);
      renderer.shadowMap.needsUpdate = false;
    }
    renderer.setScissorTest(false);
  }

  dispose() {
    this.replay?.finish();
    disposeTree(this.scene);
    this.world.free();
  }
}
