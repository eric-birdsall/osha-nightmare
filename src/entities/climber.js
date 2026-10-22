import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../config.js';
import { COL, G, groups, castRay, yawQuat, quatToThree } from '../physics.js';
import { floorHeightAt, ROOM } from '../world/level.js';
import { buildLadderGhost, ladderFootprint } from './ladder.js';
import { flatMat } from '../util/meshes.js';
import { spawnRagdoll } from '../systems/ragdoll.js';
import { WorkerModel, firstPersonArm } from './worker.js';
import { sfx } from '../systems/audio.js';

const UP = new THREE.Vector3(0, 1, 0);
// Carried box position in camera space: its near face sits HOLD_Z in front of the eye
const HOLD_Y = -0.4;
const HOLD_Z = 0.58;
const tmp = new THREE.Vector3();

function approach(v, target, maxDelta) {
  tmp.subVectors(target, v);
  const d = tmp.length();
  if (d <= maxDelta || d === 0) v.copy(target);
  else v.addScaledVector(tmp, maxDelta / d);
}

export class Climber {
  constructor(game, spawn) {
    this.game = game;
    const cfg = CONFIG.climber;
    const world = game.world;
    this.halfH = (cfg.height - 2 * cfg.radius) / 2;
    this.centerOff = this.halfH + cfg.radius; // feet -> capsule center

    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.pos.x, spawn.pos.y + this.centerOff, spawn.pos.z),
    );
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(this.halfH, cfg.radius)
        .setCollisionGroups(COL.climber)
        .setSolverGroups(groups(G.CLIMBER, 0)), // query-only: never pushes or blocks bodies in the solver
      this.body,
    );
    const kcc = world.createCharacterController(0.02);
    kcc.setUp({ x: 0, y: 1, z: 0 });
    kcc.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    kcc.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    kcc.enableAutostep(0.22, 0.12, true);
    kcc.enableSnapToGround(0.12);
    kcc.setSlideEnabled(true);
    // Pushing is done by pushLoose() so walking into the forklift or a rack can't shove it
    kcc.setApplyImpulsesToDynamicBodies(false);
    this.kcc = kcc;

    this.state = 'walk'; // 'walk' | 'ragdoll' | 'wrapped'
    this.yaw = spawn.yaw;
    this.pitch = 0;
    this.relVel = new THREE.Vector3(); // horizontal walk velocity relative to the support
    this.airVel = new THREE.Vector3(); // horizontal absolute velocity in the air
    this.launchVel = new THREE.Vector3();
    this.vy = 0;
    this.grounded = false;
    this.velocity = new THREE.Vector3(); // actual world velocity last step
    this.support = null; // { body, collider, point }
    this.supportVel = new THREE.Vector3();
    this.prevSupportVel = new THREE.Vector3();
    this.prevSupportBody = null;
    this.supportAccel = new THREE.Vector3();
    this.supportTime = 0;
    this.lastMovingSupportTime = 0;
    this.lostSupportTimer = -1;
    this.peakY = spawn.pos.y;
    this.jumpedThisStep = false;
    this.pushVel = new THREE.Vector3();
    this.carried = null;
    this.target = null;
    this.mantle = null;
    this.onBlades = false;
    this.holdingOn = false;
    this.lastOnLadder = -Infinity;
    this.ladderCarry = null; // folded ladder on the shoulder
    this.onLadder = null; // { ent, h: metres up the steps, heading }
    this.foldTimer = 0;
    this.holdLocal = new THREE.Vector3();
    this.ragdoll = null;
    this.ragdollTimer = 0;
    this.fade = 0;
    this.fadeIn = 0;
    this.wrapped = null;

    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 200);
    this.camera.layers.enable(2);
    this.camera.layers.disable(1);
    game.scene.add(this.camera);
    this.buildMeshes();
  }

  get feet() {
    const t = this.body.translation();
    return new THREE.Vector3(t.x, t.y - this.centerOff, t.z);
  }

  get eye() {
    const t = this.body.translation();
    return new THREE.Vector3(t.x, t.y - this.centerOff + CONFIG.climber.eyeHeight, t.z);
  }

  viewDir(out = new THREE.Vector3()) {
    return out.set(0, 0, -1).applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
  }

  buildMeshes() {
    const cfg = CONFIG.climber;
    // Jointed worker seen by the driver (layer 1 = hidden from the climber's own camera)
    this.worker = new WorkerModel();
    this.worker.root.traverse((o) => {
      o.layers.set(1);
      if (o.isMesh) o.castShadow = true;
    });
    this.bodyMesh = this.worker.root;
    this.game.scene.add(this.bodyMesh);

    // First-person forearms and gloves (layer 2 = only the climber camera)
    // Arms hang off a rig at the eye that follows the carry pitch, not the raw view pitch
    this.armRig = new THREE.Group();
    this.camera.add(this.armRig);
    this.hands = [-1, 1].map((side) => {
      const arm = firstPersonArm(side);
      arm.traverse((o) => o.layers.set(2));
      this.armRig.add(arm);
      return arm;
    });
    this.armPhase = 0;

    // Blob shadow
    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(0.34, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    blob.renderOrder = 2;
    this.blob = blob;
    this.game.scene.add(blob);
  }

  // ---------------------------------------------------------------- per physics step

  preStep(a, dt, active) {
    const cfg = CONFIG.climber;
    this.jumpedThisStep = false;
    if (this.state === 'ragdoll') return this.ragdollStep(dt);
    if (this.fadeIn > 0) this.fadeIn = Math.max(0, this.fadeIn - dt);
    if (active) {
      this.yaw -= a.lookX;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - a.lookY));
    }
    if (this.state === 'wrapped') return this.wrappedStep(dt);
    if (this.mantle) return this.mantleStep(dt);
    if (this.onLadder) return this.ladderStep(a, dt, active);

    // Turn with a rotating platform (e.g. riding the forks through a turn)
    if (this.grounded && this.support && !this.support.body.isFixed()) this.yaw += this.support.body.angvel().y * dt;

    // Holding on to the forklift: no walking or jumping, only looking around
    const free = active && !this.holdingOn;
    const mx = free ? a.moveX : 0;
    const my = free ? a.moveY : 0;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const speed = this.ladderCarry ? cfg.walkSpeed * CONFIG.ladder.carrySpeedFactor : cfg.walkSpeed;
    const wish = fwd.multiplyScalar(my * speed).addScaledVector(right, mx * speed);

    // Walking into the steps of a set-up ladder: climb on
    if (free && this.grounded && my > 0.3 && !this.ladderCarry) {
      const lad = this.ladderToClimb();
      if (lad) return this.mountLadder(lad);
    }

    const disp = new THREE.Vector3();
    let liftY = 0; // a rising platform carries us up directly (the controller can't push out of a surface)
    if (this.grounded) {
      approach(this.relVel, wish, cfg.groundAccel * dt);
      if (free && a.jump) {
        this.grounded = false;
        this.jumpedThisStep = true;
        this.vy = Math.sqrt(2 * cfg.gravity * cfg.jumpHeight) + Math.max(0, this.supportVel.y);
        this.airVel.set(this.relVel.x + this.supportVel.x, 0, this.relVel.z + this.supportVel.z);
        this.launchVel.set(this.supportVel.x, 0, this.supportVel.z);
        sfx.jump();
      }
    }
    if (this.grounded && this.holdingOn) {
      // Holding on to the carriage: ride it rigidly. Aim for where our grip point on the
      // carriage will be after this step, so hard turns can't slowly walk us off the blades.
      const carry = this.carriageCarry(dt);
      disp.copy(this.relVel).multiplyScalar(dt).add(carry);
      disp.y = Math.min(0, carry.y) - 0.5 * dt;
      liftY = Math.max(0, carry.y);
      this.vy = 0;
    } else if (this.grounded) {
      disp.copy(this.relVel).add(this.supportVel).multiplyScalar(dt);
      disp.y = (Math.min(0, this.supportVel.y) - 0.5) * dt;
      liftY = Math.max(0, this.supportVel.y) * dt;
      this.vy = 0;
    } else {
      approach(this.airVel, tmp.copy(this.launchVel).add(wish), cfg.airAccel * dt);
      this.vy -= cfg.gravity * dt;
      disp.set(this.airVel.x * dt, this.vy * dt, this.airVel.z * dt);
    }
    // Shove from a slow forklift
    disp.addScaledVector(this.pushVel, dt);
    this.pushVel.set(0, 0, 0);

    this.kcc.computeColliderMovement(this.collider, disp, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, COL.climberQuery);
    const mv = this.kcc.computedMovement();
    this.pushLoose();
    const wasGrounded = this.grounded;
    this.grounded = this.kcc.computedGrounded() && !this.jumpedThisStep;
    if (!wasGrounded && this.grounded) {
      this.relVel.set(this.airVel.x - this.launchVel.x, 0, this.airVel.z - this.launchVel.z);
      if (this.relVel.length() > cfg.walkSpeed) this.relVel.setLength(cfg.walkSpeed);
    }
    if (!this.grounded && this.vy > 0 && mv.y < disp.y - 1e-4) this.vy = 0; // bonk head
    if (!this.grounded && wish.lengthSq() > 0.01) this.tryMantle(wish, disp, mv);
    if (wasGrounded && !this.grounded && !this.jumpedThisStep) {
      // Walked off an edge: keep the support's motion as momentum
      this.airVel.set(this.relVel.x + this.supportVel.x, 0, this.relVel.z + this.supportVel.z);
      this.launchVel.set(this.supportVel.x, 0, this.supportVel.z);
      this.vy = Math.min(0, this.supportVel.y);
    }
    const t = this.body.translation();
    mv.y += liftY;
    this.body.setNextKinematicTranslation({ x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z });
    this.velocity.set(mv.x / dt, mv.y / dt, mv.z / dt);

    if (this.carried) this.holdCarried();
    if (this.ladderCarry) this.holdLadder();
    this.foldStep(a, dt, active);
    if (active && a.interact) {
      if (this.holdingOn) this.letGo();
      else if (this.ladderCarry) this.setUpLadder();
      else if (this.carried) this.putDown();
      else if (this.target?.kind === 'ladder') {
        if (!this.target.standing) this.pickUpLadder(this.target); // a set-up one folds on a hold
      } else if (this.target) this.pickUp(this.target);
      else if (this.onBlades) this.grab();
    }
  }

  // Feet position in the fork carriage's frame.
  carriageLocal(feet) {
    const car = this.game.forklift.carriage;
    const ct = car.translation();
    return feet
      .clone()
      .sub(new THREE.Vector3(ct.x, ct.y, ct.z))
      .applyQuaternion(quatToThree(car.rotation()).invert());
  }

  // ---------------------------------------------------------------- A-frame ladders

  ladders() {
    return this.game.entities.filter((e) => e.kind === 'ladder');
  }

  // A set-up ladder whose steps Dave is walking into: near the foot of the steps, facing them.
  ladderToClimb() {
    const feet = this.feet;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    for (const lad of this.ladders()) {
      if (!lad.standing) continue;
      const foot = lad.footPoint(0);
      if (Math.abs(foot.y - feet.y) > 0.3) continue;
      if (Math.hypot(foot.x - feet.x, foot.z - feet.z) < 0.55 && fwd.dot(lad.front) < -0.5) return lad;
    }
    return null;
  }

  mountLadder(lad) {
    this.onLadder = { ent: lad, h: 0, heading: lad.heading };
    this.relVel.set(0, 0, 0);
    this.airVel.set(0, 0, 0);
    this.vy = 0;
    this.support = null;
    this.prevSupportBody = null;
    this.lostSupportTimer = -1;
    sfx.pickup();
  }

  // On the ladder: W/S climbs, the view is free, E/X still picks and places boxes. Any jump
  // sends the ladder over. Dave's feet are pinned to the steps, so he rides along if the
  // forklift shoves or lifts the ladder.
  ladderStep(a, dt, active) {
    const L = this.onLadder;
    const lad = L.ent;
    const cfg = CONFIG.ladder;
    if (active && a.jump) return this.jumpOffLadder();
    const heading = lad.heading;
    this.yaw += Math.atan2(Math.sin(heading - L.heading), Math.cos(heading - L.heading)); // turn with it
    L.heading = heading;
    const my = active ? a.moveY : 0;
    if (L.h <= 0 && my < -0.3) return this.stepOffLadder();
    L.h = THREE.MathUtils.clamp(L.h + my * cfg.climbSpeed * dt, 0, cfg.topStep);
    const p = lad.footPoint(L.h);
    const t = this.body.translation();
    const next = { x: p.x, y: p.y + this.centerOff, z: p.z };
    this.velocity.set((next.x - t.x) / dt, (next.y - t.y) / dt, (next.z - t.z) / dt);
    this.body.setNextKinematicTranslation(next);
    this.grounded = true;
    this.lastOnLadder = this.game.clock;
    if (this.carried) this.holdCarried();
    if (active && a.interact) {
      if (this.carried) this.putDown();
      else if (this.target) this.pickUp(this.target);
    }
  }

  stepOffLadder() {
    const p = this.onLadder.ent.stepOffPoint();
    this.onLadder = null;
    this.body.setNextKinematicTranslation({ x: p.x, y: p.y + this.centerOff + 0.02, z: p.z });
    this.grounded = false;
    this.vy = 0;
    this.peakY = p.y;
    this.airVel.set(0, 0, 0);
    this.launchVel.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
  }

  // Jumping on a ladder: Dave pushes off backwards and the ladder kicks over the other way.
  jumpOffLadder() {
    const lad = this.onLadder.ent;
    const back = lad.front; // out of the step side, toward where Dave came from
    // Over sideways (across its narrow width), a little away from Dave
    const side = new THREE.Vector3(back.z, 0, -back.x).multiplyScalar(Math.random() < 0.5 ? -1 : 1);
    const kick = side.addScaledVector(back, -0.3).normalize().multiplyScalar(lad.mass * CONFIG.ladder.jumpKick);
    lad.body.applyImpulseAtPoint(kick, lad.topPoint(), true);
    this.onLadder = null;
    sfx.jump();
    this.goRagdoll('ladderJump', back.multiplyScalar(2.2).add(new THREE.Vector3(0, 2.5, 0)));
  }

  // While on a ladder: it going over (or being knocked out from under him) ends in an incident.
  ladderPostStep() {
    const lad = this.onLadder.ent;
    const fl = this.game.forklift;
    for (let i = 0; i < lad.body.numColliders(); i++) {
      this.game.world.contactPairsWith(lad.body.collider(i), (o) => {
        if (fl.ownsCollider(o)) lad.forkliftTouched = this.game.clock;
      });
    }
    const v = lad.body.linvel();
    const fast = Math.hypot(v.x, v.z) > CONFIG.ladder.maxRideSpeed; // shoved or driven off with Dave on it
    if (lad.state !== 'open' || lad.removed || lad.upY < CONFIG.ladder.fallUp || fast) {
      const byRalph = this.game.clock - lad.forkliftTouched < 2;
      this.onLadder = null;
      return this.goRagdoll(byRalph ? 'ladderKnocked' : 'ladder', fast ? new THREE.Vector3(v.x * 0.6, 1.5, v.z * 0.6) : null);
    }
    const feet = this.feet;
    const cfg = CONFIG.climber;
    // Riding the forks up into something overhead
    if (lad.body.linvel().y > 0.05) {
      const head = { x: feet.x, y: feet.y + cfg.height - 0.15, z: feet.z };
      const hit = castRay(this.game.world, head, { x: 0, y: 1, z: 0 }, 0.2, COL.climberQuery, (c) => c.handle !== this.collider.handle && c.parent()?.handle !== lad.body.handle);
      if (hit) return this.goRagdoll('crushed', new THREE.Vector3(0, -1, 0));
    }
    const headHit = this.overheadHit(feet);
    if (headHit) return this.goRagdoll(headHit, new THREE.Vector3(0, -1.5, 0));
    const probeHalf = this.halfH - 0.05;
    const probeR = cfg.radius + 0.05;
    const rackHit = this.rackSweep({ x: feet.x, y: feet.y + 0.12 + probeR + probeHalf, z: feet.z }, probeHalf, probeR);
    if (rackHit) return this.goRagdoll('rack', rackHit);
  }

  pickUpLadder(lad) {
    lad.setState('carried');
    this.ladderCarry = lad;
    this.target = null;
    if (!this.ladderGhost) {
      this.ladderGhost = buildLadderGhost();
      this.ladderGhost.visible = false;
      this.game.scene.add(this.ladderGhost);
    }
    sfx.pickup();
  }

  // Folded ladder on the right shoulder, running fore and aft (its long axis along our view).
  shoulderPose() {
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const up = new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().crossVectors(up, fwd);
    const quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(up, fwd, side));
    const pos = this.feet.add(new THREE.Vector3(0, 1.28, 0)).addScaledVector(right, 0.34).addScaledVector(fwd, -0.8);
    return { pos, quat };
  }

  holdLadder() {
    const { pos, quat } = this.shoulderPose();
    this.ladderCarry.body.setNextKinematicTranslation(pos);
    this.ladderCarry.body.setNextKinematicRotation(quat);
  }

  // Where a carried ladder would be set up: in front of Dave, steps facing him. ok only on flat,
  // clear floor at Dave's own level (not stairs, the ramp, shelves, pallets or the forks).
  ladderPlacement() {
    const cfg = CONFIG.ladder;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const feet = this.feet;
    const c = feet.clone().addScaledVector(fwd, cfg.setupDistance);
    const y = floorHeightAt(c.x, c.z);
    const q = yawQuat(this.yaw); // local +Z (the steps) = -fwd, back toward Dave
    const rot = quatToThree(q);
    const level = (x, z) => {
      const p = new THREE.Vector3(x, 0, z).applyQuaternion(rot).add(c);
      return Math.abs(floorHeightAt(p.x, p.z) - y) < 0.01;
    };
    const w = cfg.width / 2 + 0.05;
    let ok = level(-w, cfg.baseBack) && level(w, cfg.baseBack) && level(-w, cfg.baseFront) && level(w, cfg.baseFront);
    ok &&= Math.abs(feet.y - y) < 0.15;
    if (ok) {
      const { half, centerZ } = ladderFootprint();
      const center = new THREE.Vector3(0, half[1] + 0.05, centerZ).applyQuaternion(rot).add(new THREE.Vector3(c.x, y, c.z));
      const carried = this.ladderCarry?.body.handle;
      this.game.world.intersectionsWithShape(
        center,
        q,
        new RAPIER.Cuboid(...half),
        () => {
          ok = false;
          return false;
        },
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
        COL.climberQuery,
        undefined,
        undefined,
        (col) => col.handle !== this.collider.handle && col.parent()?.handle !== carried,
      );
    }
    return { pos: { x: c.x, y: y + 0.005, z: c.z }, yaw: this.yaw, ok };
  }

  setUpLadder() {
    const p = this.ladderPlacement();
    if (!p.ok) {
      this.game.toast("Can't set the ladder up here", 1.5);
      return;
    }
    this.ladderCarry.setState('open', { pos: p.pos, yaw: p.yaw });
    this.ladderCarry = null;
    if (this.ladderGhost) this.ladderGhost.visible = false;
    sfx.putdown();
  }

  // Let go of a carried ladder (e.g. Dave went flying): it drops folded where it was.
  dropLadder() {
    const lad = this.ladderCarry;
    if (!lad) return;
    this.ladderCarry = null;
    const { pos, quat } = this.shoulderPose();
    lad.setState('dropped');
    lad.body.setTranslation(pos, true);
    lad.body.setRotation(quat, true);
    lad.body.setLinvel({ x: this.velocity.x, y: this.velocity.y, z: this.velocity.z }, true);
    if (this.ladderGhost) this.ladderGhost.visible = false;
  }

  // Holding E/X on a set-up ladder folds it onto the shoulder (a tap does nothing, so picking
  // boxes nearby can't fold it by accident).
  foldStep(a, dt, active) {
    const lad = this.target?.kind === 'ladder' && this.target.standing ? this.target : null;
    if (active && a.interactHeld && lad && !this.carried && !this.ladderCarry) {
      this.foldTimer += dt;
      if (this.foldTimer >= CONFIG.ladder.foldHoldTime) {
        this.foldTimer = 0;
        this.pickUpLadder(lad);
      }
    } else this.foldTimer = 0;
  }

  updateLadderGhost() {
    if (!this.ladderGhost) return;
    const show = !!this.ladderCarry && this.state === 'walk';
    this.ladderGhost.visible = show;
    if (!show) return;
    const p = this.ladderPlacement();
    this.ladderGhost.position.set(p.pos.x, p.pos.y, p.pos.z);
    this.ladderGhost.quaternion.copy(quatToThree(yawQuat(p.yaw)));
    this.ladderGhost.userData.mat.color.setHex(p.ok ? 0x7cf0a0 : 0xff5a4a);
    this.ladderPlaceOk = p.ok;
  }

  // Grab the carriage: from now on we ride it rigidly and can't be thrown off.
  grab() {
    this.holdingOn = true;
    this.holdLocal.copy(this.carriageLocal(this.feet));
    this.relVel.set(0, 0, 0);
    sfx.pickup();
  }

  letGo() {
    this.holdingOn = false;
    sfx.putdown();
  }

  // Displacement that keeps our grip point fixed on the fork carriage through this step,
  // predicting the carriage pose one step ahead from its current velocity.
  carriageCarry(dt) {
    const car = this.game.forklift.carriage;
    const t = car.translation();
    const v = car.linvel();
    const w = car.angvel();
    const q = quatToThree(car.rotation());
    const wl = Math.hypot(w.x, w.y, w.z);
    if (wl > 1e-6) q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(w.x / wl, w.y / wl, w.z / wl), wl * dt));
    const target = this.holdLocal.clone().applyQuaternion(q).add(new THREE.Vector3(t.x + v.x * dt, t.y + v.y * dt, t.z + v.z * dt));
    return target.sub(this.feet);
  }

  // Shove loose boxes and pallets we walk into (not the forklift, racks or wrapped loads).
  pushLoose() {
    const mass = CONFIG.climber.characterMass;
    for (let i = 0; i < this.kcc.numComputedCollisions(); i++) {
      const hit = this.kcc.computedCollision(i);
      const ent = hit?.collider && this.game.entityForCollider(hit.collider);
      if (!ent || ent.carried) continue;
      if (ent.kind !== 'box' && ent.kind !== 'pallet') continue;
      // Only shove things we walk into from the side: never the one we're standing on or
      // landing on top of (that kicked boxes out from under Dave's feet)
      if (this.support?.body.handle === ent.body.handle || hit.normal1.y > 0.5) continue;
      const rem = hit.translationDeltaRemaining;
      const push = new THREE.Vector3(rem.x, 0, rem.z);
      if (push.lengthSq() < 1e-8) continue;
      // Leaning into it: our blocked movement this step, as an impulse from a person-sized mass,
      // but never faster than walking pace
      const dir = push.clone().normalize();
      const v = ent.body.linvel();
      const room = CONFIG.climber.walkSpeed - (v.x * dir.x + v.z * dir.z);
      if (room <= 0) continue;
      const impulse = Math.min(push.length() * mass * CONFIG.climber.pushStrength, room * ent.body.mass());
      // Push through its middle height so it slides rather than flips
      const com = ent.body.worldCom();
      ent.body.applyImpulseAtPoint(dir.multiplyScalar(impulse), { x: hit.witness1.x, y: com.y, z: hit.witness1.z }, true);
    }
  }

  // Height above the warehouse floor (upper or lower level, stairs or ramp). Boxes, pallets,
  // forks and racks are all things that can move or fall away, so only the floor counts as ground.
  heightAboveGround(feet) {
    return feet.y - floorHeightAt(feet.x, feet.z);
  }

  // In the air and pushing into a ledge just above our feet: climb onto it.
  tryMantle(wish, disp, mv) {
    const cfg = CONFIG.climber;
    const want = Math.hypot(disp.x, disp.z);
    if (this.mantle || want < 1e-4 || Math.hypot(mv.x, mv.z) > want * 0.5) return;
    const dir = wish.clone().setY(0).normalize();
    const feet = this.feet;
    const reach = cfg.radius + 0.12;
    const probe = { x: feet.x + dir.x * reach, y: feet.y + cfg.mantleHeight + 0.05, z: feet.z + dir.z * reach };
    const hit = castRay(this.game.world, probe, { x: 0, y: -1, z: 0 }, cfg.mantleHeight + 0.05, COL.climberQuery, (c) => c.handle !== this.collider.handle);
    if (!hit || hit.normal.y < 0.7) return;
    const dh = hit.point.y - feet.y;
    if (dh <= 0.02) return;
    this.mantle = { topY: hit.point.y + 0.04, dir, forward: 0 };
  }

  // Scripted mantle: rise until clear of the ledge, then step forward onto it.
  mantleStep(dt) {
    const m = this.mantle;
    const feet = this.feet;
    const disp = new THREE.Vector3();
    if (feet.y < m.topY) disp.set(0, Math.min(3.2 * dt, m.topY - feet.y + 0.005), 0);
    else {
      disp.copy(m.dir).multiplyScalar(2.2 * dt);
      m.forward += 2.2 * dt;
    }
    this.kcc.computeColliderMovement(this.collider, disp, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, COL.climberQuery);
    const mv = this.kcc.computedMovement();
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z });
    this.velocity.set(mv.x / dt, mv.y / dt, mv.z / dt);
    m.time = (m.time || 0) + dt;
    const stuck = feet.y < m.topY && mv.y < disp.y * 0.3;
    if (m.forward > CONFIG.climber.radius + 0.1 || stuck || m.time > 0.8) {
      this.mantle = null;
      this.vy = 0;
      this.airVel.set(0, 0, 0);
      this.launchVel.set(0, 0, 0);
      this.relVel.set(0, 0, 0);
      this.peakY = this.feet.y;
    }
    if (this.carried) this.holdCarried();
  }

  postStep(dt) {
    if (this.state !== 'walk') return;
    if (this.onLadder) return this.ladderPostStep(dt);
    const cfg = CONFIG.climber;
    const feet = this.feet;

    // Find what we're standing on
    this.support = null;
    const center = this.body.translation();
    const probes = [
      [0, 0],
      [0.22, 0],
      [-0.22, 0],
      [0, 0.22],
      [0, -0.22],
    ];
    if (this.grounded) {
      for (const [ox, oz] of probes) {
        const hit = castRay(
          this.game.world,
          { x: center.x + ox, y: center.y, z: center.z + oz },
          { x: 0, y: -1, z: 0 },
          this.centerOff + 0.2,
          COL.climberQuery,
          (c) => c.handle !== this.collider.handle,
        );
        if (hit) {
          this.support = { collider: hit.collider, body: hit.collider.parent(), point: hit.point };
          break;
        }
      }
    }

    // Support velocity and acceleration (thrown-off check)
    this.prevSupportVel.copy(this.supportVel);
    if (this.support && !this.support.body.isFixed()) {
      const fl = this.game.forklift;
      const v = fl.ownsCollider(this.support.collider)
        ? fl.pointVelocity(this.support.point, this.support.collider)
        : this.support.body.velocityAtPoint(this.support.point);
      this.supportVel.set(v.x, v.y, v.z);
    } else {
      this.supportVel.set(0, 0, 0);
    }
    const sb = this.support?.body || null;
    const sameSupport = sb && this.prevSupportBody && sb.handle === this.prevSupportBody.handle;
    if (sameSupport) {
      this.supportTime += dt;
      const raw = tmp.subVectors(this.supportVel, this.prevSupportVel).divideScalar(dt);
      this.supportAccel.lerp(raw, cfg.throwAccelSmoothing);
    } else {
      this.supportTime = 0;
      this.supportAccel.set(0, 0, 0);
    }
    this.prevSupportBody = sb;
    if (sb && this.game.entityForCollider(this.support.collider)?.kind === 'ladder') this.lastOnLadder = this.game.clock;
    // Scooped: the forks/truck slid under our feet while moving fast (we didn't step on)
    const nowOnTruck = !!(sb && this.game.forklift.ownsCollider(this.support.collider));
    if (nowOnTruck && !this.wasOnTruck && !(this.graceTimer > 0)) {
      const sv = Math.hypot(this.supportVel.x, this.supportVel.z);
      if (sv > cfg.hitSpeed) {
        this.wasOnTruck = true;
        return this.goRagdoll('hit', new THREE.Vector3(this.supportVel.x * 1.3, 3, this.supportVel.z * 1.3));
      }
    }
    this.wasOnTruck = nowOnTruck;

    // On the fork blades? (E/X there grabs the carriage.) While holding on, stay holding as
    // long as our feet are over the blades: the ground rays can slip between them mid-turn.
    const fl0 = this.game.forklift;
    const car = fl0.carriage;
    const local = this.carriageLocal(feet);
    const overBlades = Math.abs(local.x) < 0.38 && local.z > 0 && local.z < 1.2 && Math.abs(local.y) < 0.12;
    this.onBlades = !!(sb && sb.handle === car.handle) || (this.holdingOn && overBlades);
    if (this.holdingOn && (!this.onBlades || this.carried || this.state !== 'walk')) this.holdingOn = false;
    if (this.holdingOn) {
      if (!sb || sb.handle !== car.handle) {
        this.support = { body: car, collider: car.collider(0), point: feet.clone() };
        this.grounded = true;
      }
      this.supportAccel.set(0, 0, 0);
      this.lastMovingSupportTime = 0;
      this.lostSupportTimer = -1;
    }
    const supportSpeed = Math.max(this.supportVel.length(), this.prevSupportVel.length());
    if (sb && supportSpeed > 0.5) this.lastMovingSupportTime = 0.4;
    else this.lastMovingSupportTime = Math.max(0, this.lastMovingSupportTime - dt);

    // A box sliding along the floor can't really throw or drop Dave: only count it when he's
    // high enough off the floor for the fall to hurt.
    const highUp = this.heightAboveGround(feet) > cfg.lowSupportHeight;
    if (highUp && !this.holdingOn && sameSupport && this.supportTime > 0.2 && supportSpeed > cfg.throwMinSupportSpeed) {
      const horiz = Math.hypot(this.supportAccel.x, this.supportAccel.z);
      if (horiz > cfg.throwAccel) {
        return this.goRagdoll('thrown', this.supportAccel.clone().setY(0).multiplyScalar(0.12).add(new THREE.Vector3(0, 2, 0)));
      }
    }
    if (sb && highUp && !this.holdingOn && this.supportVel.y < -cfg.dropSpeed) return this.goRagdoll('dropped');
    // Lifted into something overhead (rack beam, mast crossbar): crushed
    if (sb && this.supportVel.y > 0.05) {
      const head = { x: center.x, y: center.y + this.centerOff - 0.15, z: center.z };
      const hit = castRay(this.game.world, head, { x: 0, y: 1, z: 0 }, 0.2, COL.climberQuery, (c) => c.handle !== this.collider.handle);
      if (hit) return this.goRagdoll('crushed', new THREE.Vector3(0, -1, 0));
    }

    // Support vanished (pallet slid off the forks, load dumped)
    if (!this.grounded && !this.jumpedThisStep && this.lostSupportTimer < 0 && this.lastMovingSupportTime > 0 && this.vy <= 0) {
      this.lostSupportTimer = 0;
    }
    if (this.lostSupportTimer >= 0) {
      if (this.grounded) this.lostSupportTimer = -1;
      else {
        this.lostSupportTimer += dt;
        if (this.lostSupportTimer > cfg.supportLostTime) {
          this.lostSupportTimer = -1;
          if (this.heightAboveGround(feet) > cfg.lowSupportHeight) return this.goRagdoll('dropped');
        }
      }
    }

    // Fall distance
    if (this.grounded) this.peakY = feet.y;
    else {
      this.peakY = Math.max(this.peakY, feet.y);
      if (this.peakY - feet.y > cfg.fallRagdollHeight) return this.goRagdoll('fell');
    }

    // Something coming down on our head: lowered forks, or a falling box/pallet
    const headHit = this.overheadHit(feet);
    if (headHit) return this.goRagdoll(headHit, new THREE.Vector3(0, -1.5, 0));

    // Forklift collisions: an ankle-and-up capsule so standing on the forks isn't a "hit",
    // but lowered forks (top at 0.1 m) still sweep the legs.
    const fl = this.game.forklift;
    const probeHalf = this.halfH - 0.05;
    const probeR = cfg.radius + 0.05;
    const probeCenter = { x: feet.x, y: feet.y + 0.12 + probeR + probeHalf, z: feet.z };
    let hitCol = null;
    this.game.world.intersectionsWithShape(
      probeCenter,
      { x: 0, y: 0, z: 0, w: 1 },
      new RAPIER.Capsule(probeHalf, probeR),
      (c) => {
        if (fl.ownsCollider(c)) {
          hitCol = c;
          return false;
        }
        return true;
      },
      undefined,
      groups(G.CLIMBER, G.FORK),
    );
    // A toppling rack sweeping into us
    const rackHit = this.rackSweep(probeCenter, probeHalf, probeR);
    if (rackHit) return this.goRagdoll('rack', rackHit);

    const onForklift = this.holdingOn || (this.support && fl.ownsCollider(this.support.collider));
    if (this.graceTimer > 0) this.graceTimer -= dt;
    if (hitCol && !onForklift) {
      // The forklift's own speed at the contact counts (head-on, sideswipe or tail swing);
      // walking into a parked or crawling truck is no incident.
      const pv = fl.pointVelocity(probeCenter, hitCol);
      const ft = fl.body.translation();
      const away = new THREE.Vector3(feet.x - ft.x, 0, feet.z - ft.z).normalize();
      const speed = Math.hypot(pv.x, pv.z);
      if (speed > cfg.hitSpeed && !(this.graceTimer > 0)) {
        return this.goRagdoll('hit', new THREE.Vector3(pv.x * 1.5, 3 + speed * 0.4, pv.z * 1.5));
      }
      // Gentle nudge: get pushed along, plus a little separation
      this.pushVel.set(pv.x, 0, pv.z).addScaledVector(away, 1.2);
    }

  }

  // If a rack is moving into our body fast (it's falling over), returns its velocity.
  rackSweep(center, half, r) {
    const cfg = CONFIG.racks;
    let hit = null;
    this.game.world.intersectionsWithShape(
      center,
      { x: 0, y: 0, z: 0, w: 1 },
      new RAPIER.Capsule(half, r),
      (c) => {
        const ent = this.game.entityForCollider(c);
        if (!ent || ent.kind !== 'rack') return true;
        if (this.support && this.support.body.handle === ent.body.handle) return true; // standing on it
        const v = ent.body.velocityAtPoint(center);
        if (Math.hypot(v.x, v.y, v.z) > cfg.crushSpeed) hit = new THREE.Vector3(v.x, v.y, v.z).multiplyScalar(1.2);
        return !hit;
      },
      undefined,
      groups(G.CLIMBER, G.DYN),
    );
    return hit;
  }

  // Returns an incident reason if the forks or a load is moving down into our head.
  overheadHit(feet) {
    const cfg = CONFIG.climber;
    const fl = this.game.forklift;
    let reason = null;
    this.game.world.intersectionsWithShape(
      { x: feet.x, y: feet.y + cfg.height - 0.12, z: feet.z },
      { x: 0, y: 0, z: 0, w: 1 },
      new RAPIER.Ball(0.2),
      (c) => {
        const b = c.parent();
        if (!b || b.isFixed()) return true;
        const vy = b.linvel().y;
        if (b === fl.carriage || b.handle === fl.carriage.handle) {
          if (vy < -cfg.crushForkSpeed) reason = 'forks';
        } else {
          const ent = this.game.entityForCollider(c);
          if (ent && !ent.carried && vy < -cfg.fallingLoadSpeed) reason = ent.kind === 'rack' ? 'rack' : ent.kind === 'ladder' ? 'ladderHit' : 'load';
        }
        return !reason;
      },
      undefined,
      groups(G.CLIMBER, G.FORK | G.DYN),
    );
    return reason;
  }

  // ---------------------------------------------------------------- carrying

  updateTarget() {
    this.target = null;
    if (this.state !== 'walk' || this.carried || this.ladderCarry) return;
    const cfg = CONFIG.climber;
    const eye = this.eye;
    const dir = this.viewDir();
    const hit = castRay(this.game.world, eye, dir, cfg.reach + 1, COL.climberQuery, (c) => c.handle !== this.collider.handle);
    // Arm's reach, measured from the chest so boxes at your feet are grabbable
    const chest = eye.clone().setY(eye.y - cfg.chestDrop);
    if (hit && chest.distanceTo(tmp.set(hit.point.x, hit.point.y, hit.point.z)) <= cfg.reach) {
      const ent = this.game.entityForCollider(hit.collider);
      if (ent && ent.kind === 'box') this.target = ent;
      else if (ent && ent.kind === 'ladder' && !this.onLadder && ent.state !== 'carried' && this.support?.body.handle !== ent.body.handle) this.target = ent;
    }
    if (!this.target && !this.onLadder) this.target = this.nearbyLadder(chest, dir);
  }

  // A ladder in arm's reach and roughly in front of Dave, wherever the crosshair is: standing
  // at its foot or beside it, you can grab it without aiming at a rail.
  nearbyLadder(chest, dir) {
    const reach = CONFIG.climber.reach;
    const fwd = new THREE.Vector3(dir.x, 0, dir.z).normalize();
    let best = null;
    let bestD = reach;
    for (const ent of this.game.entities) {
      if (ent.kind !== 'ladder' || ent.state === 'carried' || this.support?.body.handle === ent.body.handle) continue;
      for (let i = 0; i < ent.body.numColliders(); i++) {
        const p = ent.body.collider(i).projectPoint(chest, true)?.point;
        if (!p) continue;
        const to = new THREE.Vector3(p.x - chest.x, p.y - chest.y, p.z - chest.z);
        const d = to.length();
        if (d >= bestD) continue;
        const flat = to.setY(0);
        // Within ~75 degrees of where Dave faces (or right up against it)
        if (flat.length() > 0.35 && flat.normalize().dot(fwd) < 0.25) continue;
        best = ent;
        bestD = d;
      }
    }
    return best;
  }

  // Carried boxes tilt with the view only within a natural range, so looking at your
  // feet doesn't swing the box under and behind you.
  holdPitch() {
    return Math.max(-0.5, Math.min(0.45, this.pitch));
  }

  holdPose() {
    const ent = this.carried;
    const eye = this.eye;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.holdPitch(), this.yaw, 0, 'YXZ'));
    const off = new THREE.Vector3(0, HOLD_Y, -(HOLD_Z + ent.size[2] / 2)).applyQuaternion(q);
    return { pos: eye.add(off), quat: q };
  }

  holdCarried() {
    const { pos } = this.holdPose();
    this.carried.body.setNextKinematicTranslation(pos);
    this.carried.body.setNextKinematicRotation(yawQuat(this.yaw));
  }

  pickUp(ent) {
    if (ent.removed) return;
    const body = ent.body;
    body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    for (let i = 0; i < body.numColliders(); i++) body.collider(i).setCollisionGroups(COL.carried);
    this.carried = ent;
    this.target = null;
    ent.carried = true;
    this.makeGhost(ent);
    this.makeHeldView(ent);
    sfx.pickup();
    this.game.onPickup?.(ent);
  }

  releaseCarried(pos, rot, vel) {
    const ent = this.carried;
    if (!ent) return;
    const body = ent.body;
    body.setTranslation(pos, true);
    body.setRotation(rot, true);
    body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    for (let i = 0; i < body.numColliders(); i++) body.collider(i).setCollisionGroups(COL.dyn);
    body.setLinvel(vel, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    body.wakeUp();
    ent.carried = false;
    this.carried = null;
    if (this.ghost) this.ghost.visible = false;
    this.dropHeldView(ent);
  }

  // In our own view the carried box is see-through so the placement ghost shows through it.
  // The real mesh moves to layer 1 (everyone but us); a translucent copy goes on layer 2 (only us).
  makeHeldView(ent) {
    ent.mesh.traverse((o) => o.layers.set(1));
    const view = ent.mesh.clone(true);
    view.traverse((o) => {
      o.layers.set(2);
      if (o.material) {
        // Labelled boxes use one material per face
        const see = (m) => {
          const c = m.clone();
          c.transparent = true;
          c.opacity *= 0.35;
          c.depthWrite = false;
          return c;
        };
        o.material = Array.isArray(o.material) ? o.material.map(see) : see(o.material);
      }
      o.castShadow = false;
    });
    this.heldView = view;
    this.game.scene.add(view);
  }

  dropHeldView(ent) {
    ent.mesh.traverse((o) => o.layers.set(0));
    if (!this.heldView) return;
    this.game.scene.remove(this.heldView);
    this.heldView.traverse((o) => [o.material].flat().forEach((m) => m?.dispose()));
    this.heldView = null;
  }

  // Translucent box showing where the carried box will land (climber's camera only).
  makeGhost(ent) {
    if (this.ghost) {
      this.game.scene.remove(this.ghost);
      this.ghost.traverse((o) => o.geometry?.dispose());
    }
    const geo = new THREE.BoxGeometry(...ent.size);
    const ghost = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: 0x7cf0a0, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    ghost.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xffffff })));
    // Drop line from the ghost down to where it lands is implied; mark the footprint on the surface
    const foot = new THREE.Mesh(
      new THREE.PlaneGeometry(ent.size[0], ent.size[2]),
      new THREE.MeshBasicMaterial({ color: 0x7cf0a0, transparent: true, opacity: 0.45, depthWrite: false }),
    );
    foot.rotation.x = -Math.PI / 2;
    foot.position.y = -ent.size[1] / 2 + 0.006;
    ghost.add(foot);
    ghost.renderOrder = 4;
    ghost.traverse((o) => o.layers.set(2));
    ghost.visible = false;
    this.ghost = ghost;
    this.game.scene.add(ghost);
  }

  updateGhost() {
    if (!this.ghost) return;
    if (!this.carried || this.state !== 'walk') {
      this.ghost.visible = false;
      return;
    }
    const p = this.computePlacement();
    const [, sy] = this.carried.size;
    this.ghost.visible = true;
    this.ghost.position.set(p.pos.x, p.pos.y, p.pos.z);
    this.ghost.quaternion.set(p.rot.x, p.rot.y, p.rot.z, p.rot.w);
    // Green: it will sit on that surface. Orange: nothing under it, it'll just be dropped.
    const color = p.onSurface ? 0x7cf0a0 : 0xffa040;
    this.ghost.material.color.setHex(color);
    this.ghost.children[1].material.color.setHex(color);
    this.ghost.children[1].visible = p.onSurface && sy > 0;
  }

  // Where the carried box would land if put down now: aimed point, nudged off walls and out
  // of our own capsule, then dropped straight down onto whatever is below.
  // onSurface is false when there's nowhere sensible and it would just be let go.
  computePlacement() {
    const ent = this.carried;
    const cfg = CONFIG.climber;
    const world = this.game.world;
    const [hx, hy, hz] = ent.size.map((s) => s / 2);
    const ext = Math.max(hx, hz);
    const eye = this.eye;
    const dir = this.viewDir();
    const notMe = (c) => c.handle !== this.collider.handle;
    const hit = castRay(world, eye, dir, cfg.placeReach, COL.climberQuery, notMe);
    const base = new THREE.Vector3();
    if (hit) {
      base.set(hit.point.x, hit.point.y, hit.point.z);
      if (hit.normal.y < 0.7) base.add(new THREE.Vector3(hit.normal.x, 0, hit.normal.z).normalize().multiplyScalar(ext + 0.03));
    } else {
      base.copy(eye).addScaledVector(dir, 1.4);
    }
    // Keep it out of our own capsule
    const feet = this.feet;
    const flat = new THREE.Vector3(base.x - feet.x, 0, base.z - feet.z);
    const minD = cfg.radius + ext * 1.42 + 0.05;
    if (flat.length() < minD && base.y < feet.y + CONFIG.climber.height) {
      const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      if (flat.lengthSq() < 1e-4 || flat.dot(f) < 0) flat.copy(f);
      flat.setLength(minD);
      base.set(feet.x + flat.x, base.y, feet.z + flat.z);
    }
    const rot = yawQuat(this.yaw);
    const shape = new RAPIER.Cuboid(hx, hy, hz);
    for (const lift of [0.3, 0.8]) {
      const start = { x: base.x, y: base.y + hy + lift, z: base.z };
      const sh = world.castShape(
        start, rot, { x: 0, y: -1, z: 0 }, shape, 0.005, 8, true,
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, COL.climberQuery, undefined, undefined, notMe,
      );
      if (!sh) return { pos: start, rot, vel: { x: 0, y: 0, z: 0 }, onSurface: false };
      if (sh.time_of_impact > 1e-3) {
        const pos = { x: start.x, y: start.y - sh.time_of_impact + 0.005, z: start.z };
        let vel = { x: 0, y: 0, z: 0 };
        const sb = sh.collider.parent();
        if (sb && !sb.isFixed()) {
          const fl = this.game.forklift;
          vel = fl.ownsCollider(sh.collider) ? fl.pointVelocity(pos, sh.collider) : sb.velocityAtPoint(pos);
        }
        return { pos, rot, vel, onSurface: true };
      }
    }
    // Nowhere sensible: just let go in front of us
    return {
      pos: this.holdPose().pos,
      rot,
      vel: { x: this.velocity.x, y: this.velocity.y, z: this.velocity.z },
      onSurface: false,
    };
  }

  putDown() {
    const { pos, rot, vel } = this.computePlacement();
    this.releaseCarried(pos, rot, vel);
    sfx.putdown();
  }


  // ---------------------------------------------------------------- ragdoll

  goRagdoll(reason, extraVel = null) {
    if (this.state === 'ragdoll') return;
    // Came off a ladder (or it went over with us on it): blame the ladder
    if (['thrown', 'dropped', 'fell'].includes(reason) && this.game.clock - this.lastOnLadder < 1.5) reason = 'ladder';
    const vel = this.velocity.clone();
    if (this.state === 'wrapped') vel.set(0, 0, 0);
    if (extraVel) vel.add(extraVel);
    if (this.carried) {
      const { pos } = this.holdPose();
      this.releaseCarried(pos, yawQuat(this.yaw), { x: vel.x, y: vel.y, z: vel.z });
    }
    this.dropLadder();
    this.onLadder = null;
    this.state = 'ragdoll';
    this.wrapped = null;
    this.mantle = null;
    this.holdingOn = this.onBlades = false;
    this.ragdoll = spawnRagdoll(this.game, { feet: this.feet, yaw: this.yaw, velocity: vel });
    this.ragdollYaw = this.yaw;
    this.ragdollTimer = 0;
    this.body.setEnabled(false);
    this.bodyMesh.visible = false;
    this.hands.forEach((h) => (h.visible = false));
    this.grounded = false;
    this.support = null;
    this.prevSupportBody = null;
    this.lostSupportTimer = -1;
    this.camPos = this.eye;
    this.game.onIncident(reason);
  }

  ragdollStep(dt) {
    const cfg = CONFIG.climber;
    this.ragdollTimer += dt;
    const fadeStart = cfg.ragdollTime - cfg.ragdollFade;
    this.fade = Math.max(0, Math.min(1, (this.ragdollTimer - fadeStart) / cfg.ragdollFade));
    if (this.ragdollTimer >= cfg.ragdollTime) this.respawn();
  }

  respawn() {
    const p = this.ragdoll.pelvis.translation();
    this.ragdoll.dispose();
    this.ragdoll = null;
    // Nearest spawn point, skipping any the forklift is parked on or about to run over
    const spawns = this.game.level.spawnPoints;
    const clear = spawns.filter((sp) => this.forkliftClearance(sp) > CONFIG.climber.respawnClearance);
    let best = (clear.length ? clear : spawns)[0];
    let bestD = Infinity;
    for (const sp of clear.length ? clear : spawns) {
      const d = Math.hypot(sp.x - p.x, sp.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = sp;
      }
    }
    this.body.setEnabled(true);
    this.body.setTranslation({ x: best.x, y: best.y + this.centerOff + 0.05, z: best.z }, true);
    this.state = 'walk';
    this.relVel.set(0, 0, 0);
    this.airVel.set(0, 0, 0);
    this.launchVel.set(0, 0, 0);
    this.vy = 0;
    this.velocity.set(0, 0, 0);
    this.supportVel.set(0, 0, 0);
    this.peakY = best.y;
    this.pitch = 0;
    this.bodyMesh.visible = true;
    this.hands.forEach((h) => (h.visible = true));
    this.fade = 0;
    this.fadeIn = 0.5;
    this.graceTimer = CONFIG.climber.respawnGrace;
  }

  // Distance from a floor point to the forklift, looking a little ahead along its motion.
  forkliftClearance(sp) {
    const fl = this.game.forklift;
    let d = Infinity;
    for (const b of [fl.body, fl.carriage]) {
      const t = b.translation();
      const v = b.linvel();
      for (const ahead of [0, 1]) {
        d = Math.min(d, Math.hypot(t.x + v.x * ahead - sp.x, t.z + v.z * ahead - sp.z));
      }
    }
    return d;
  }

  // Bodies were removed from the world (merged by wrapping): drop stale references.
  forgetBodies(handles) {
    if (this.support && handles.has(this.support.body.handle)) this.support = null;
    if (this.prevSupportBody && handles.has(this.prevSupportBody.handle)) this.prevSupportBody = null;
    if (this.target?.removed) this.target = null;
  }

  // ---------------------------------------------------------------- wrapped into a pallet

  wrapInto(body) {
    if (this.carried) {
      const { pos } = this.holdPose();
      this.releaseCarried(pos, yawQuat(this.yaw), { x: 0, y: 0, z: 0 });
    }
    const t = this.body.translation();
    const bt = body.translation();
    const inv = quatToThree(body.rotation()).invert();
    this.wrapped = {
      body,
      local: new THREE.Vector3(t.x - bt.x, t.y - bt.y, t.z - bt.z).applyQuaternion(inv),
      timer: 0,
    };
    this.state = 'wrapped';
    this.grounded = false;
  }

  wrappedStep(dt) {
    const w = this.wrapped;
    w.timer += dt;
    const bt = w.body.translation();
    const p = w.local.clone().applyQuaternion(quatToThree(w.body.rotation())).add(bt);
    const t = this.body.translation();
    this.velocity.set((p.x - t.x) / dt, (p.y - t.y) / dt, (p.z - t.z) / dt);
    this.body.setNextKinematicTranslation(p);
    const lv = w.body.linvel();
    if (w.timer > CONFIG.climber.wrappedLockTime || Math.hypot(lv.x, lv.z) > 0.6) {
      this.goRagdoll('wrapped', new THREE.Vector3((Math.random() - 0.5) * 3, 5, (Math.random() - 0.5) * 3));
    }
  }

  // ---------------------------------------------------------------- per render frame

  updateVisuals(dt = 1 / 60) {
    if (this.state === 'ragdoll') {
      this.ragdoll.sync();
      this.blob.visible = false;
      return;
    }
    const f = this.feet;
    this.bodyMesh.position.copy(f);
    const walkSpeed = this.grounded ? Math.hypot(this.relVel.x, this.relVel.z) : 0;
    this.worker.update(dt, {
      yaw: this.yaw,
      pitch: this.pitch,
      speed: walkSpeed,
      grounded: this.grounded || !!this.mantle || this.state === 'wrapped',
      carrying: !!this.carried || !!this.ladderCarry,
      holding: this.holdingOn || !!this.onLadder,
      holdPitch: this.holdPitch(),
    });

    // Blob shadow on whatever is below us
    const c = this.body.translation();
    const hit = castRay(this.game.world, c, { x: 0, y: -1, z: 0 }, 12, COL.climberQuery, (col) => col.handle !== this.collider.handle);
    if (hit) {
      const n = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
      this.blob.visible = true;
      this.blob.position.set(hit.point.x, hit.point.y, hit.point.z).addScaledVector(n, 0.012);
      this.blob.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      const h = f.y - hit.point.y;
      this.blob.material.opacity = 0.5 * Math.max(0.15, 1 - h / 6);
      this.blob.scale.setScalar(1 - Math.min(0.5, h / 12));
    } else this.blob.visible = false;

    this.updateGhost();
    this.updateLadderGhost();
    if (this.ladderCarry) {
      const { pos, quat } = this.shoulderPose();
      this.ladderCarry.mesh.position.copy(pos);
      this.ladderCarry.mesh.quaternion.copy(quat);
    }

    // Carried box follows the camera smoothly (its physics body collides with nothing)
    this.armPhase += dt * walkSpeed * 2.2;
    const bob = Math.sin(this.armPhase * 2) * 0.008 * Math.min(1, walkSpeed / 3.5);
    this.armRig.rotation.x = this.carried ? this.holdPitch() - this.pitch : 0;
    if (this.carried) {
      const { pos } = this.holdPose();
      this.carried.mesh.position.copy(pos);
      this.carried.mesh.quaternion.setFromAxisAngle(UP, this.yaw);
      this.heldView?.position.copy(pos);
      this.heldView?.quaternion.copy(this.carried.mesh.quaternion);
      const [sx] = this.carried.size;
      // Gloves flat against the sides of the box, palms in
      this.hands.forEach((arm, i) => {
        const side = i === 0 ? -1 : 1;
        arm.position.set(side * (sx / 2 + 0.035), HOLD_Y + 0.02 + bob, -(HOLD_Z + 0.05) + 0.375); // gloves wrap the front corners
        arm.rotation.set(0.1, side * 0.22, 0);
        arm.userData.glove.rotation.set(0, 0, -side * 1.25);
      });
    } else if (this.holdingOn || this.onLadder || this.ladderCarry) {
      // Both hands up, gripping the carriage backrest, the ladder or the one on our shoulder
      this.hands.forEach((arm, i) => {
        const side = i === 0 ? -1 : 1;
        arm.position.set(side * 0.22, -0.3, -0.2);
        arm.rotation.set(0.7, side * 0.12, 0);
        arm.userData.glove.rotation.set(0, 0, -side * 0.15);
      });
    } else {
      this.hands.forEach((arm, i) => {
        const side = i === 0 ? -1 : 1;
        arm.position.set(side * 0.27, -0.36 + bob * (i ? 1 : -1), -0.24);
        arm.rotation.set(0.14, side * 0.16, 0);
        arm.userData.glove.rotation.set(0, 0, -side * 0.35);
      });
    }
  }

  updateCamera(dt) {
    const cam = this.camera;
    if (this.state === 'ragdoll') {
      // Chase cam on the flailing body
      const p = this.ragdoll.pelvis.translation();
      const target = new THREE.Vector3(p.x, p.y, p.z);
      const back = new THREE.Vector3(Math.sin(this.ragdollYaw), 0, Math.cos(this.ragdollYaw)).multiplyScalar(3.2);
      const want = target.clone().add(back).add(new THREE.Vector3(0, 1.8, 0));
      want.x = Math.max(-ROOM.halfX + 0.6, Math.min(ROOM.halfX - 0.6, want.x));
      want.z = Math.max(-ROOM.halfZ + 0.6, Math.min(ROOM.halfZ - 0.6, want.z));
      want.y = Math.max(floorHeightAt(want.x, want.z) + 0.4, want.y);
      this.camPos.lerp(want, 1 - Math.exp(-dt * 6));
      cam.position.copy(this.camPos);
      cam.lookAt(target);
      return;
    }
    cam.position.copy(this.eye);
    cam.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
  }
}
