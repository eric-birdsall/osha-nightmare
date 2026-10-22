import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../config.js';
import { COL, quatToThree } from '../physics.js';
import { sfx } from './audio.js';

// Every box/pallet resting on rootEnt, directly or stacked.
export function collectStack(game, rootEnt) {
  const world = game.world;
  const set = new Set([rootEnt]);
  const queue = [rootEnt];
  while (queue.length) {
    const ent = queue.shift();
    const b = ent.body;
    const by = b.translation().y;
    for (let i = 0; i < b.numColliders(); i++) {
      const c = b.collider(i);
      world.contactPairsWith(c, (other) => {
        const oe = game.entityForCollider(other);
        if (!oe || set.has(oe) || oe.carried || (oe.kind !== 'box' && oe.kind !== 'pallet')) return;
        if (oe.body.translation().y <= by + 0.02) return;
        let touching = false;
        world.contactPair(c, other, (m) => {
          if (m.numContacts() > 0) touching = true;
        });
        if (!touching) return;
        set.add(oe);
        queue.push(oe);
      });
    }
  }
  return set;
}

export class WrapSystem {
  constructor(game) {
    this.game = game;
    this.rest = new Map();
    this.job = null;
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.7 });
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.035, 8, 40), ringMat);
    this.ring.rotation.x = Math.PI / 2;
    this.ringPivot = new THREE.Group();
    this.ringPivot.add(this.ring);
    // A "film roll" riding the ring
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.35, 10), new THREE.MeshLambertMaterial({ color: 0xe8f6ff }));
    roll.position.set(0.95, 0, 0);
    this.ringPivot.add(roll);
    this.ringPivot.visible = false;
    game.scene.add(this.ringPivot);

    // Countdown ring on the floor around a pallet in the square: an outline while it's in the
    // square, filling up while it sits still. Red outline = too high or tipped to wrap.
    this.countdown = new THREE.Group();
    this.countdown.rotation.x = -Math.PI / 2;
    this.ringBack = new THREE.Mesh(
      new THREE.RingGeometry(0.86, 0.98, 48),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    this.ringFill = new THREE.Mesh(
      new THREE.RingGeometry(0.84, 1.0, 48, 1, 0, 0.01),
      new THREE.MeshBasicMaterial({ color: 0xffd400, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.ringFill.position.z = 0.002;
    this.countdown.add(this.ringBack, this.ringFill);
    this.countdown.renderOrder = 3;
    this.countdown.visible = false;
    this.fillShown = -1;
    game.scene.add(this.countdown);
    this.hinted = false;
  }

  // Draw the countdown for the pallet closest to wrapping (progress 0..1; blocked = can't wrap there).
  showCountdown(pallet, progress, blocked) {
    if (!pallet) {
      this.countdown.visible = false;
      return;
    }
    const t = pallet.body.translation();
    this.countdown.visible = true;
    this.countdown.position.set(t.x, 0.015, t.z);
    this.ringBack.material.color.setHex(blocked ? 0xff4040 : 0xffffff);
    const steps = Math.round(progress * 48);
    if (steps !== this.fillShown) {
      this.fillShown = steps;
      this.ringFill.geometry.dispose();
      // Fills clockwise from 12 o'clock
      const len = Math.max(0.01, (steps / 48) * Math.PI * 2);
      this.ringFill.geometry = new THREE.RingGeometry(0.84, 1.0, 48, 1, Math.PI / 2 - len, len);
      this.ringFill.visible = steps > 0;
    }
  }

  // Is any part of the forklift (body or fork tips) inside the wrap square?
  forkliftInStation() {
    const zone = this.game.level.wrapZone;
    const f = this.game.forklift;
    const near = (p) => Math.abs(p.x - zone.center.x) <= zone.half.x + 0.3 && Math.abs(p.z - zone.center.z) <= zone.half.z + 0.3;
    const q = quatToThree(f.body.rotation());
    const t = f.body.translation();
    const pts = [[0, 0, -1.2], [0, 0, 0], [0, 0, 1.0], [0.225, 0, 2.1], [-0.225, 0, 2.1]];
    return pts.some((p) => near(new THREE.Vector3(...p).applyQuaternion(q).add(t)));
  }

  // Why a load in the square can't be wrapped yet (or null when it can).
  blockReason(ent) {
    const b = ent.body;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quatToThree(b.rotation()));
    if (up.y <= 0.9) return 'Stand the pallet upright to wrap it';
    if (b.translation().y > 0.05) return 'Set the pallet down on the floor to wrap it';
    if (this.forkliftInStation()) return 'Back the forklift out of the wrap station';
    return null;
  }

  step(dt) {
    if (this.job) {
      this.countdown.visible = false;
      return this.updateJob(dt);
    }
    const cfg = CONFIG.wrap;
    const zone = this.game.level.wrapZone;
    let shown = null;
    let shownProgress = -1;
    let shownBlocked = false;
    for (const ent of this.game.entities) {
      // Pallets, and wrapped loads with boxes added on top since (they get re-wrapped)
      if (ent.kind !== 'pallet' && ent.kind !== 'wrapped') continue;
      const b = ent.body;
      const t = b.translation();
      if (!zone.contains(t) || (ent.kind === 'wrapped' && collectStack(this.game, ent).size < 2)) {
        this.rest.set(ent, 0);
        continue;
      }
      const lv = b.linvel();
      const av = b.angvel();
      const reason = this.blockReason(ent);
      const blocked = !!reason;
      const still = Math.hypot(lv.x, lv.y, lv.z) < cfg.restSpeed && Math.hypot(av.x, av.y, av.z) < 0.3;
      const r = !blocked && still ? (this.rest.get(ent) || 0) + dt : 0;
      this.rest.set(ent, r);
      const progress = Math.min(1, r / cfg.restTime);
      if (progress > shownProgress) {
        shown = ent;
        shownProgress = progress;
        shownBlocked = blocked;
      }
      // Say what's in the way whenever it changes (and once to explain holding still)
      const hint = reason || (still ? null : 'Hold the pallet still to wrap it');
      if (hint && hint !== this.lastHint && this.game.clock - (this.lastHintAt ?? -99) > 2.5) {
        this.lastHint = hint;
        this.lastHintAt = this.game.clock;
        this.game.toast(hint, 2.5);
      }
      if (r >= cfg.restTime) {
        this.startJob(ent);
        break;
      }
    }
    this.showCountdown(this.job ? null : shown, shownProgress, shownBlocked);
  }

  startJob(pallet) {
    const t = pallet.body.translation();
    const stack = collectStack(this.game, pallet);
    let top = t.y + 0.2;
    for (const e of stack) top = Math.max(top, e.body.translation().y + 0.5);
    this.job = { pallet, t: 0, start: new THREE.Vector3(t.x, t.y, t.z), top };
    this.ringPivot.visible = true;
    sfx.wrapStart();
    this.game.toast('Wrapping…', 3);
  }

  updateJob(dt) {
    const job = this.job;
    const b = job.pallet.body;
    const t = b.translation();
    const moved = Math.hypot(t.x - job.start.x, t.z - job.start.z);
    if (job.pallet.removed || moved > 0.4 || !this.game.level.wrapZone.contains(t) || this.forkliftInStation()) {
      this.cancel();
      this.game.toast('Wrap interrupted', 2);
      return;
    }
    job.t += dt;
    const k = job.t / CONFIG.wrap.duration;
    this.ringPivot.position.set(t.x, t.y + 0.1 + (job.top - t.y) * (0.5 - 0.5 * Math.cos(k * Math.PI * 3)), t.z);
    this.ringPivot.rotation.y += dt * 9;
    if (job.t >= CONFIG.wrap.duration) this.finish();
  }

  cancel() {
    if (this.job) this.rest.set(this.job.pallet, 0);
    this.job = null;
    this.ringPivot.visible = false;
  }

  finish() {
    const game = this.game;
    const pallet = this.job.pallet;
    this.cancel();
    const set = collectStack(game, pallet);
    const climber = game.climber;
    const climberOn =
      climber.state === 'walk' && climber.grounded && climber.support && set.has(game.entityForCollider(climber.support.collider));
    const wrapped = buildWrapped(game, pallet, set);
    if (climberOn) climber.wrapInto(wrapped.body);
    sfx.wrapDone();
    game.toast(climberOn ? 'You got wrapped. Classic.' : 'Pallet wrapped!', 2.5);
  }
}

// Merge a pallet and its load into one compound rigid body.
function buildWrapped(game, pallet, set) {
  const world = game.world;
  const pb = pallet.body;
  const pPos = new THREE.Vector3().copy(pb.translation());
  const pRot = quatToThree(pb.rotation());
  const inv = pRot.clone().invert();
  const lv = pb.linvel();

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pPos.x, pPos.y, pPos.z)
      .setRotation({ x: pRot.x, y: pRot.y, z: pRot.z, w: pRot.w })
      .setLinvel(lv.x, lv.y, lv.z)
      .setCanSleep(true)
      .setAdditionalSolverIterations(2),
  );
  const group = new THREE.Group();
  group.position.copy(pPos);
  group.quaternion.copy(pRot);
  const items = {}; // order line -> boxes of it wrapped into this load
  const shapes = [];
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const removed = new Set();
  let totalMass = 0;

  for (const ent of set) {
    const t = ent.body.translation();
    const relPos = new THREE.Vector3(t.x, t.y, t.z).sub(pPos).applyQuaternion(inv);
    const relRot = inv.clone().multiply(quatToThree(ent.body.rotation()));
    for (const s of ent.shapes) {
      const pos = new THREE.Vector3(...s.pos).applyQuaternion(relRot).add(relPos);
      // Shapes from an earlier wrap carry their own rotation within that load
      const rot = s.rot ? relRot.clone().multiply(new THREE.Quaternion(...s.rot)) : relRot;
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(...s.half)
          .setTranslation(pos.x, pos.y, pos.z)
          .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w })
          .setMass(s.mass)
          .setFriction(s.friction)
          .setCollisionGroups(COL.dyn),
        body,
      );
      shapes.push({ ...s, pos: pos.toArray(), rot: rot.toArray() });
      totalMass += s.mass;
      for (const sx of [-1, 1])
        for (const sy of [-1, 1])
          for (const sz of [-1, 1]) {
            const c = new THREE.Vector3(sx * s.half[0], sy * s.half[1], sz * s.half[2]).applyQuaternion(rot).add(pos);
            min.min(c);
            max.max(c);
          }
    }
    if (ent.item) items[ent.item] = (items[ent.item] || 0) + 1;
    if (ent.items) for (const [line, n] of Object.entries(ent.items)) items[line] = (items[line] || 0) + n;
    // Re-wrapping: the old film comes off, a new one goes round everything
    const oldFilm = ent.mesh.children.find((c) => c.userData.film);
    if (oldFilm) ent.mesh.remove(oldFilm);
    game.scene.remove(ent.mesh);
    ent.mesh.position.copy(relPos);
    ent.mesh.quaternion.copy(relRot);
    group.add(ent.mesh);
    removed.add(ent.body.handle);
    world.removeRigidBody(ent.body);
    game.removeEntity(ent);
  }
  game.climber.forgetBodies(removed);

  // Translucent stretch wrap (stops just above the pallet runners)
  const lo = min.clone();
  lo.y = Math.max(min.y, 0.05);
  const size = new THREE.Vector3().subVectors(max, lo).addScalar(0.04);
  const center = new THREE.Vector3().addVectors(max, lo).multiplyScalar(0.5);
  const film = new THREE.Mesh(
    new THREE.BoxGeometry(size.x, size.y, size.z),
    new THREE.MeshLambertMaterial({ color: 0xd8efff, transparent: true, opacity: 0.38, depthWrite: false }),
  );
  film.position.copy(center);
  film.renderOrder = 3;
  film.userData.film = true;
  film.add(
    new THREE.LineSegments(
      new THREE.EdgesGeometry(film.geometry),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }),
    ),
  );
  group.add(film);
  game.scene.add(group);

  const ent = { kind: 'wrapped', body, mesh: group, items, shapes, mass: totalMass };
  game.addEntity(ent);
  return ent;
}
