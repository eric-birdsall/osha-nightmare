import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../config.js';
import { COL, G, groups, castRay, yawQuat, quatToThree } from '../physics.js';
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
    kcc.setApplyImpulsesToDynamicBodies(true);
    kcc.setCharacterMass(cfg.characterMass);
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
    this.hands = [-1, 1].map((side) => {
      const arm = firstPersonArm(side);
      arm.traverse((o) => o.layers.set(2));
      this.camera.add(arm);
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

    // Turn with a rotating platform (e.g. riding the forks through a turn)
    if (this.grounded && this.support && !this.support.body.isFixed()) this.yaw += this.support.body.angvel().y * dt;

    const mx = active ? a.moveX : 0;
    const my = active ? a.moveY : 0;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = fwd.multiplyScalar(my * cfg.walkSpeed).addScaledVector(right, mx * cfg.walkSpeed);

    const disp = new THREE.Vector3();
    let liftY = 0; // a rising platform carries us up directly (the controller can't push out of a surface)
    if (this.grounded) {
      approach(this.relVel, wish, cfg.groundAccel * dt);
      if (active && a.jump) {
        this.grounded = false;
        this.jumpedThisStep = true;
        this.vy = Math.sqrt(2 * cfg.gravity * cfg.jumpHeight) + Math.max(0, this.supportVel.y);
        this.airVel.set(this.relVel.x + this.supportVel.x, 0, this.relVel.z + this.supportVel.z);
        this.launchVel.set(this.supportVel.x, 0, this.supportVel.z);
        sfx.jump();
      }
    }
    if (this.grounded) {
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
    if (active && a.interact) {
      if (this.carried) this.putDown();
      else if (this.target) this.pickUp(this.target);
    }
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
    const supportSpeed = Math.max(this.supportVel.length(), this.prevSupportVel.length());
    if (sb && supportSpeed > 0.5) this.lastMovingSupportTime = 0.4;
    else this.lastMovingSupportTime = Math.max(0, this.lastMovingSupportTime - dt);

    if (sameSupport && this.supportTime > 0.2 && supportSpeed > cfg.throwMinSupportSpeed) {
      const horiz = Math.hypot(this.supportAccel.x, this.supportAccel.z);
      if (horiz > cfg.throwAccel) {
        return this.goRagdoll('thrown', this.supportAccel.clone().setY(0).multiplyScalar(0.12).add(new THREE.Vector3(0, 2, 0)));
      }
    }
    if (sb && this.supportVel.y < -cfg.dropSpeed) return this.goRagdoll('dropped');
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
        if (this.lostSupportTimer > cfg.supportLostTime) return this.goRagdoll('dropped');
      }
    }

    // Fall distance
    if (this.grounded) this.peakY = feet.y;
    else {
      this.peakY = Math.max(this.peakY, feet.y);
      if (this.peakY - feet.y > cfg.fallRagdollHeight) return this.goRagdoll('fell');
    }

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
    const onForklift = this.support && fl.ownsCollider(this.support.collider);
    if (this.graceTimer > 0) this.graceTimer -= dt;
    if (hitCol && !onForklift) {
      // Only the forklift's own motion toward us counts: walking into a parked truck is no incident.
      const pv = fl.pointVelocity(probeCenter, hitCol);
      const ft = fl.body.translation();
      const away = new THREE.Vector3(feet.x - ft.x, 0, feet.z - ft.z).normalize();
      const approach = pv.x * away.x + pv.z * away.z;
      if (approach > cfg.hitSpeed && !(this.graceTimer > 0)) {
        return this.goRagdoll('hit', new THREE.Vector3(pv.x * 1.5, 3 + approach * 0.4, pv.z * 1.5));
      }
      // Gentle nudge: get pushed along, plus a little separation
      this.pushVel.set(pv.x, 0, pv.z).addScaledVector(away, 1.2);
    }

  }

  // ---------------------------------------------------------------- carrying

  updateTarget() {
    this.target = null;
    if (this.state !== 'walk' || this.carried) return;
    const cfg = CONFIG.climber;
    const eye = this.eye;
    const dir = this.viewDir();
    const hit = castRay(this.game.world, eye, dir, cfg.reach + 1, COL.climberQuery, (c) => c.handle !== this.collider.handle);
    if (!hit) return;
    // Arm's reach, measured from the chest so boxes at your feet are grabbable
    const chest = eye.clone().setY(eye.y - cfg.chestDrop);
    if (chest.distanceTo(tmp.set(hit.point.x, hit.point.y, hit.point.z)) > cfg.reach) return;
    const ent = this.game.entityForCollider(hit.collider);
    if (ent && ent.kind === 'box') this.target = ent;
  }

  holdPose() {
    const ent = this.carried;
    const eye = this.eye;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
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
  }

  putDown() {
    const ent = this.carried;
    const cfg = CONFIG.climber;
    const world = this.game.world;
    const [hx, hy, hz] = ent.size.map((s) => s / 2);
    const ext = Math.max(hx, hz);
    const eye = this.eye;
    const dir = this.viewDir();
    const hit = castRay(world, eye, dir, cfg.placeReach, COL.climberQuery, (c) => c.handle !== this.collider.handle);
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
    let placed = null;
    let vel = { x: 0, y: 0, z: 0 };
    for (const lift of [0.3, 0.8]) {
      const start = { x: base.x, y: base.y + hy + lift, z: base.z };
      const sh = world.castShape(
        start, rot, { x: 0, y: -1, z: 0 }, shape, 0.005, 8, true,
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, COL.climberQuery, undefined, undefined,
        (c) => c.handle !== this.collider.handle,
      );
      if (!sh) {
        placed = start;
        break;
      }
      if (sh.time_of_impact > 1e-3) {
        placed = { x: start.x, y: start.y - sh.time_of_impact + 0.005, z: start.z };
        const sb = sh.collider.parent();
        if (sb && !sb.isFixed()) {
          const fl = this.game.forklift;
          vel = fl.ownsCollider(sh.collider) ? fl.pointVelocity(placed, sh.collider) : sb.velocityAtPoint(placed);
        }
        break;
      }
    }
    if (!placed) {
      // Nowhere sensible: just let go in front of us
      const { pos } = this.holdPose();
      placed = pos;
      vel = { x: this.velocity.x, y: this.velocity.y, z: this.velocity.z };
    }
    this.releaseCarried(placed, rot, vel);
    sfx.putdown();
  }

  // ---------------------------------------------------------------- ragdoll

  goRagdoll(reason, extraVel = null) {
    if (this.state === 'ragdoll') return;
    const vel = this.velocity.clone();
    if (this.state === 'wrapped') vel.set(0, 0, 0);
    if (extraVel) vel.add(extraVel);
    if (this.carried) {
      const { pos } = this.holdPose();
      this.releaseCarried(pos, yawQuat(this.yaw), { x: vel.x, y: vel.y, z: vel.z });
    }
    this.state = 'ragdoll';
    this.wrapped = null;
    this.mantle = null;
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
      carrying: !!this.carried,
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

    // Carried box follows the camera smoothly (its physics body collides with nothing)
    this.armPhase += dt * walkSpeed * 2.2;
    const bob = Math.sin(this.armPhase * 2) * 0.008 * Math.min(1, walkSpeed / 3.5);
    if (this.carried) {
      const { pos } = this.holdPose();
      this.carried.mesh.position.copy(pos);
      this.carried.mesh.quaternion.setFromAxisAngle(UP, this.yaw);
      const [sx] = this.carried.size;
      // Gloves flat against the sides of the box, palms in
      this.hands.forEach((arm, i) => {
        const side = i === 0 ? -1 : 1;
        arm.position.set(side * (sx / 2 + 0.035), HOLD_Y + 0.02 + bob, -(HOLD_Z + 0.05) + 0.375); // gloves wrap the front corners
        arm.rotation.set(0.1, side * 0.22, 0);
        arm.userData.glove.rotation.set(0, 0, -side * 1.25);
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
      want.x = Math.max(-14.6, Math.min(14.6, want.x));
      want.z = Math.max(-9.6, Math.min(9.6, want.z));
      want.y = Math.max(0.4, want.y);
      this.camPos.lerp(want, 1 - Math.exp(-dt * 6));
      cam.position.copy(this.camPos);
      cam.lookAt(target);
      return;
    }
    cam.position.copy(this.eye);
    cam.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
  }
}
