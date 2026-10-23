import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../config.js';
import { COL, castRay, yawQuat, quatToThree } from '../physics.js';
import { floorHeightAt } from '../world/level.js';
import { boxMesh, flatMat } from '../util/meshes.js';
import { sfx } from '../systems/audio.js';
import { WorkerModel } from './worker.js';

// Body-local frame: forward = +Z, up = +Y, origin on the floor between the wheels.
const WHEEL_R = 0.28;
const WHEELS = [
  { pos: [0.48, WHEEL_R, 0.55], front: true },
  { pos: [-0.48, WHEEL_R, 0.55], front: true },
  { pos: [0.45, WHEEL_R, -0.85], front: false },
  { pos: [-0.45, WHEEL_R, -0.85], front: false },
];
const FRONT_AXLE_Z = 0.55;
const MAST_Z = 0.85;
const PLATE_Z = 0.95;
const FORK_X = 0.225;
const FORK_LEN = 1.1;
const FORK_W = 0.15;
const STEER_R = 0.17;
const FORK_T = 0.035;
const FORK_Z = PLATE_Z + 0.03 + FORK_LEN / 2;

// Static parts on the chassis body: [half extents, position, color, drawn?]
const PARTS = [
  [[0.55, 0.3, 0.525], [0, 0.55, -0.625], 0xf2b705], // rear chassis (under the seat)
  [[0.55, 0.15, 0.425], [0, 0.4, 0.325], 0xf2b705], // front chassis, lowered into a footwell
  [[0.06, 0.15, 0.32], [0.49, 0.7, 0.22], 0xf2b705], // footwell side walls
  [[0.06, 0.15, 0.32], [-0.49, 0.7, 0.22], 0xf2b705],
  [[0.55, 0.26, 0.17], [0, 1.1, -0.98], 0x3a3f47], // counterweight hump
  [[0.5, 0.25, 0.1], [0, 0.8, 0.64], 0xf2b705], // cowl / dash, down to the footwell floor (top kept low so the forks show)
  [[0.03, 0.66, 0.03], [0.53, 1.51, 0.66], 0x1d1f23], // guard posts
  [[0.03, 0.66, 0.03], [-0.53, 1.51, 0.66], 0x1d1f23],
  [[0.03, 0.66, 0.03], [0.53, 1.51, -0.78], 0x1d1f23],
  [[0.03, 0.66, 0.03], [-0.53, 1.51, -0.78], 0x1d1f23],
  [[0.57, 0.03, 0.76], [0, 2.19, -0.06], 0x1d1f23, false], // overhead guard roof (drawn as a bar grid)
  [[0.05, 2.05, 0.05], [0.38, 2.15, MAST_Z], 0x30343a], // mast uprights
  [[0.05, 2.05, 0.05], [-0.38, 2.15, MAST_Z], 0x30343a],
  [[0.43, 0.05, 0.05], [0, 4.15, MAST_Z], 0x30343a], // mast crossbar
];

export class Forklift {
  constructor(game, spawn) {
    this.game = game;
    const cfg = CONFIG.forklift;
    const world = game.world;
    this.height = cfg.liftMin;
    this.liftVel = 0;
    this.steer = 0;
    this.gear = 1;
    this.lookYaw = 0;
    this.lookPitch = -0.12;
    this.wheelSpin = 0;
    this.beepTimer = 0;
    this.groundFrac = 0;
    this.speed = 0;

    const [cx, cy, cz] = cfg.centerOfMass;
    const [ix, iy, iz] = cfg.inertia;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawn.pos.x, 0.02, spawn.pos.z)
        .setRotation(yawQuat(spawn.yaw))
        .setAdditionalMassProperties(cfg.mass, { x: cx, y: cy, z: cz }, { x: ix, y: iy, z: iz }, { x: 0, y: 0, z: 0, w: 1 })
        .setLinearDamping(0.05)
        .setAngularDamping(0.4)
        .setCanSleep(true),
    );
    this.collidersSet = new Set();
    const addCol = (desc) => {
      const c = world.createCollider(desc.setDensity(0).setCollisionGroups(COL.fork), this.body);
      this.collidersSet.add(c.handle);
      return c;
    };
    for (const [half, pos] of PARTS) addCol(RAPIER.ColliderDesc.cuboid(...half).setTranslation(...pos).setFriction(0.5));
    for (const w of WHEELS) {
      addCol(
        RAPIER.ColliderDesc.ball(WHEEL_R)
          .setTranslation(...w.pos)
          .setFriction(0)
          .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min),
      );
    }
    // Carriage: its own dynamic body on a motorized prismatic joint up the mast, so the
    // solver knows the fork velocity (loads lift smoothly) and loads/racks push back on the truck.
    const t0 = this.body.translation();
    const q0 = quatToThree(this.body.rotation());
    const c0 = new THREE.Vector3(0, this.height, PLATE_Z).applyQuaternion(q0).add(t0);
    this.carriage = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(c0.x, c0.y, c0.z)
        .setRotation(this.body.rotation())
        .setAdditionalSolverIterations(8)
        .setCanSleep(true),
    );
    const addCarriageCol = (desc, mass) => {
      const c = world.createCollider(desc.setMass(mass).setCollisionGroups(COL.fork), this.carriage);
      this.collidersSet.add(c.handle);
      return c;
    };
    addCarriageCol(RAPIER.ColliderDesc.cuboid(0.45, 0.5, 0.03).setTranslation(0, 0.45, 0).setFriction(0.6), 90); // carriage + load backrest
    for (const sx of [-1, 1]) {
      addCarriageCol(
        RAPIER.ColliderDesc.cuboid(FORK_W / 2, FORK_T / 2, FORK_LEN / 2)
          .setTranslation(sx * FORK_X, -FORK_T / 2, FORK_Z - PLATE_Z)
          .setFriction(0.7),
        35,
      );
    }
    const jd = RAPIER.JointData.prismatic({ x: 0, y: 0, z: PLATE_Z }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    jd.limitsEnabled = true;
    jd.limits = [cfg.liftMin - 0.02, cfg.liftMax + 0.02];
    this.liftJoint = world.createImpulseJoint(jd, this.body, this.carriage, true);
    this.liftJoint.setContactsEnabled(false);
    this.liftJoint.configureMotorModel(RAPIER.MotorModel.AccelerationBased);
    this.liftJoint.configureMotor(this.height, 0, cfg.liftStiffness, cfg.liftDamping);

    this.buildMesh();
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.05, 200);
    this.camera.layers.enable(1);
  }

  // Move the truck (and its carriage) somewhere, at rest. Used by debug tools.
  teleport(pos, yaw) {
    const q = yawQuat(yaw);
    const floor = floorHeightAt(pos.x, pos.z); // upper or lower level, or partway down the ramp
    this.body.setTranslation({ x: pos.x, y: floor + 0.02, z: pos.z }, true);
    this.body.setRotation(q, true);
    const c = new THREE.Vector3(0, this.height + 0.02, PLATE_Z).applyQuaternion(quatToThree(q)).add(new THREE.Vector3(pos.x, floor, pos.z));
    this.carriage.setTranslation(c, true);
    this.carriage.setRotation(q, true);
    for (const b of [this.body, this.carriage]) {
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  ownsCollider(c) {
    return this.collidersSet.has(c.handle);
  }

  // World velocity of a point on a forklift collider (chassis or carriage).
  pointVelocity(point, collider) {
    const b = collider ? collider.parent() : this.body;
    return b.velocityAtPoint(point);
  }

  // Actual fork height from the carriage's position along the mast.
  measuredHeight() {
    const t = this.body.translation();
    const c = this.carriage.translation();
    const inv = quatToThree(this.body.rotation()).invert();
    return new THREE.Vector3(c.x - t.x, c.y - t.y, c.z - t.z).applyQuaternion(inv).y;
  }

  buildMesh() {
    const root = new THREE.Group();
    for (const [half, pos, color, drawn = true] of PARTS) {
      if (!drawn) continue;
      const m = boxMesh(half[0] * 2, half[1] * 2, half[2] * 2, color);
      m.position.set(...pos);
      root.add(m);
    }
    // Overhead guard: a frame of bars the driver can see up through
    const guard = (w, h, d, x, y, z) => {
      const b = boxMesh(w, h, d, 0x1d1f23, { edges: false });
      b.position.set(x, y, z);
      root.add(b);
    };
    const [gx, , gz] = [0.57, 0.03, 0.76];
    const gy = 2.19;
    const gcz = -0.06;
    for (const sx of [-1, 1]) guard(0.06, 0.06, gz * 2, sx * (gx - 0.03), gy, gcz); // side rails
    for (const sz of [-1, 1]) guard(gx * 2, 0.06, 0.06, 0, gy, gcz + sz * (gz - 0.03)); // front/back rails
    for (let i = -2; i <= 2; i++) guard(0.03, 0.035, gz * 2 - 0.06, i * 0.19, gy + 0.005, gcz); // lengthwise slats
    for (const z of [-0.5, 0, 0.5]) guard(gx * 2 - 0.06, 0.03, 0.03, 0, gy - 0.01, gcz + z * (gz - 0.1)); // cross slats
    // Hazard stripes on the counterweight
    for (let i = -2; i <= 2; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.01), flatMat(0x111111));
      s.position.set(i * 0.22, 1.1, -1.155);
      s.rotation.z = 0.6;
      root.add(s);
    }
    // Seat and steering wheel
    const seat = boxMesh(0.5, 0.12, 0.45, 0x1d1f23);
    seat.position.set(0, 0.92, -0.3);
    root.add(seat);
    const back = boxMesh(0.5, 0.5, 0.1, 0x1d1f23);
    back.position.set(0, 1.2, -0.55);
    root.add(back);
    // Steering wheel on a column from the dash, top tilted toward the dash, within the driver's reach.
    // Local frame: the wheel lies in XY, +Z runs down the column to the dash.
    const wheelMount = new THREE.Group();
    wheelMount.position.set(0, 1.25, 0.12);
    wheelMount.rotation.x = 0.65;
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.42, 10), flatMat(0x1d1f23));
    column.rotation.x = Math.PI / 2;
    column.position.z = 0.21;
    const spinner = new THREE.Group(); // turns with the steering
    const rim = new THREE.Mesh(new THREE.TorusGeometry(STEER_R, 0.022, 8, 24), flatMat(0x111111));
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 12), flatMat(0x2b2f35));
    hub.rotation.x = Math.PI / 2;
    spinner.add(rim, hub);
    for (const a of [Math.PI / 2, Math.PI * 1.17, -Math.PI * 0.17]) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(STEER_R, 0.018, 0.012), flatMat(0x2b2f35));
      spoke.position.set(Math.cos(a) * STEER_R * 0.5, Math.sin(a) * STEER_R * 0.5, 0);
      spoke.rotation.z = a;
      spinner.add(spoke);
    }
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), flatMat(0xd02020)); // spinner knob
    knob.position.set(STEER_R * 0.71, -STEER_R * 0.71, -0.04);
    spinner.add(knob);
    wheelMount.add(column, spinner);
    root.add(wheelMount);
    this.wheelMount = wheelMount;
    // Lift lever (for show) on a pedestal beside the steering wheel, at the driver's right hand:
    // pull back to raise, push forward to lower. A black stick with the classic red ball knob.
    const leverBase = boxMesh(0.12, 0.36, 0.16, 0x1d1f23);
    leverBase.position.set(-0.42, 0.82, 0.12);
    const lever = new THREE.Group();
    lever.position.set(-0.42, 1.0, 0.12);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.3, 8), flatMat(0x16171a));
    stick.position.y = 0.15;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), flatMat(0xd02020));
    ball.position.y = 0.31;
    const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.05, 10), flatMat(0x111111));
    boot.position.y = 0.02;
    lever.add(stick, ball, boot);
    root.add(leverBase, lever);
    this.lever = lever;
    this.leverKnob = ball;
    this.leverTilt = 0;
    this.handOnLever = 0; // 0 = right hand on the wheel, 1 = on the lever knob
    this.buildDashboard(root);
    this.buildClipboard(root);
    this.steeringWheel = spinner;
    // Beacon
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff8800 }));
    beacon.position.set(0, 2.28, -0.7);
    root.add(beacon);
    this.beacon = beacon;
    // Wheels
    this.wheelMeshes = WHEELS.map((w) => {
      const pivot = new THREE.Group();
      pivot.position.set(...w.pos);
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.22, 16), flatMat(0x1a1a1a));
      tire.rotation.z = Math.PI / 2;
      const hub = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.12, 0.12), flatMat(0xbbbbbb));
      tire.add(hub);
      hub.rotation.z = -Math.PI / 2;
      pivot.add(tire);
      root.add(pivot);
      return { pivot, tire, front: w.front };
    });
    // Carriage (plate + forks), moved with lift height
    const carriage = new THREE.Group();
    // Open carriage frame: two fork bars plus a load backrest of vertical bars,
    // so the driver can see the pallet and what's on it
    const frame = (w, h, x, y, color = 0x30343a) => {
      const b = boxMesh(w, h, 0.05, color, { edges: false });
      b.position.set(x, y, PLATE_Z);
      carriage.add(b);
    };
    frame(0.9, 0.1, 0, 0.05, 0x444a52); // lower fork bar
    frame(0.9, 0.08, 0, 0.42, 0x444a52); // upper fork bar
    frame(0.9, 0.05, 0, 0.97); // backrest top rail
    for (const x of [-0.43, 0.43]) frame(0.05, 1.0, x, 0.5); // side frames
    for (let i = -3; i <= 3; i++) frame(0.025, 0.5, i * 0.12, 0.71); // backrest bars
    // Forged steel forks: an L-shaped blade (vertical shank up the carriage plate + flat blade)
    // with a bevelled tip and a small yellow mark so the tips read against the floor.
    const steel = new THREE.MeshLambertMaterial({ color: 0xc3c9d0 });
    const steelDark = new THREE.MeshLambertMaterial({ color: 0x9aa1a9 });
    const tipLen = 0.14;
    for (const s of [-1, 1]) {
      const blade = boxMesh(FORK_W, FORK_T, FORK_LEN - tipLen, 0, { material: steel });
      blade.position.set(s * FORK_X, -FORK_T / 2, FORK_Z - tipLen / 2);
      carriage.add(blade);
      const tip = boxMesh(FORK_W * 0.9, FORK_T * 0.55, tipLen, 0, { material: steel });
      tip.position.set(s * FORK_X, -FORK_T * 0.275, FORK_Z + FORK_LEN / 2 - tipLen / 2);
      carriage.add(tip);
      const mark = new THREE.Mesh(new THREE.BoxGeometry(FORK_W * 0.6, 0.003, 0.05), new THREE.MeshBasicMaterial({ color: 0xffd400 }));
      mark.position.set(s * FORK_X, 0.0015, FORK_Z + FORK_LEN / 2 - tipLen - 0.04);
      carriage.add(mark);
      const shank = boxMesh(FORK_W, 0.55, FORK_T, 0, { material: steelDark });
      shank.position.set(s * FORK_X, 0.24, PLATE_Z + 0.03 + FORK_T / 2);
      carriage.add(shank);
    }
    root.add(carriage);
    this.carriageMesh = carriage;
    // The driver: same worker as the climber, a bit heavier, seated at the wheel.
    // Layer 2 = seen by the climber's camera and the CCTV replays, not from the driver's own seat.
    this.driver = new WorkerModel({ heavy: true });
    this.driver.root.position.set(0, 0.2, -0.3); // hips just above the seat cushion
    this.driver.sit(0);
    this.driver.root.traverse((o) => {
      o.layers.set(2);
      if (o.isMesh) o.castShadow = true;
    });
    root.add(this.driver.root);

    root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.mesh = root;
    this.game.scene.add(root);
  }

  // a: driver actions; active: false when parked (single player, other character controlled)
  preStep(a, dt, active) {
    const cfg = CONFIG.forklift;
    const body = this.body;
    const q = quatToThree(body.rotation());
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    fwd.y = 0;
    fwd.normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(fwd, up);

    // Lift (always simulated; parked = no input)
    const liftDir = active ? a.liftUp - a.liftDown : 0;
    this.liftInput = liftDir; // drives the (cosmetic) lift lever
    let target = liftDir * (liftDir < 0 ? cfg.lowerSpeed : cfg.liftSpeed);
    const maxUp = Math.sqrt(2 * cfg.liftAccel * Math.max(0, cfg.liftMax - this.height));
    target = Math.min(maxUp, target); // no easing at the bottom: held down, the forks hit the ground at speed
    const dl = target - this.liftVel;
    // Going down: speed up gradually (tap to feather), stop hard; going up: ease in and out
    let rate = cfg.liftAccel;
    if (this.liftVel <= 0 && dl < 0) rate = cfg.lowerAccel;
    else if (this.liftVel < 0 && dl > 0) rate = cfg.lowerStop;
    this.liftVel += Math.sign(dl) * Math.min(Math.abs(dl), rate * dt);
    const prevH = this.height;
    const impact = this.liftVel; // speed as they reach the end of travel
    this.height = Math.max(cfg.liftMin, Math.min(cfg.liftMax, this.height + this.liftVel * dt));
    if (this.height === cfg.liftMin || this.height === cfg.liftMax) this.liftVel = (this.height - prevH) / dt;
    // Slam: the forks hit the ground at (nearly) full speed
    if (this.height === cfg.liftMin && prevH > cfg.liftMin && impact < -CONFIG.climber.legBreakSpeed) this.slammedAt = this.game.clock;
    this.lastImpact = this.height === cfg.liftMin && prevH > cfg.liftMin ? -impact : this.lastImpact;
    this.liftJoint.configureMotor(this.height, this.liftVel, cfg.liftStiffness, cfg.liftDamping);
    if (this.height !== prevH) {
      body.wakeUp();
      this.carriage.wakeUp();
    }

    // Steering (rear wheels)
    const steerIn = active ? a.steer : 0;
    const ds = steerIn * cfg.steerMax - this.steer;
    this.steer += Math.sign(ds) * Math.min(Math.abs(ds), cfg.steerRate * dt);

    // Ground contact per wheel
    const t = body.translation();
    let grounded = 0;
    for (const w of WHEELS) {
      const p = new THREE.Vector3(...w.pos).applyQuaternion(q).add(t);
      if (castRay(this.game.world, p, { x: 0, y: -1, z: 0 }, WHEEL_R + 0.08, COL.wheelQuery)) grounded++;
    }
    this.groundFrac = grounded / 4;

    const lv = body.linvel();
    const vel = new THREE.Vector3(lv.x, lv.y, lv.z);
    const vf = vel.dot(fwd);
    const vl = vel.dot(right);
    this.speed = vf;

    // Tipped over: after a few seconds the night shift sets it back on its wheels
    const upY = new THREE.Vector3(0, 1, 0).applyQuaternion(q).y;
    this.tippedTime = upY < 0.5 ? (this.tippedTime || 0) + dt : 0;
    if (this.tippedTime > 0.6 && !this.tipReported) {
      this.tipReported = true;
      this.game.onIncident('tipped', { victim: 'Ralph', culprit: 'Ralph', subject: 'forklift' });
    }
    if (upY > 0.9) this.tipReported = false;
    if (this.tippedTime > cfg.rightAfter) {
      this.tippedTime = 0;
      const yaw = Math.atan2(fwd.x, fwd.z);
      this.teleport({ x: t.x, z: t.z }, yaw);
      this.game.toast('The night shift put the forklift back on its wheels', 3);
      return;
    }
    if (this.groundFrac === 0) return;

    // Longitudinal
    let dv = 0;
    const toward0 = (decel) => -Math.sign(vf) * Math.min(Math.abs(vf), decel * dt);
    if (!active) {
      dv = toward0(cfg.parkDecel);
    } else {
      const thr = a.throttle;
      const brk = a.brake;
      if (this.gear === 1 && brk > 0.05 && thr < 0.05 && vf < 0.15) this.gear = -1;
      else if (this.gear === -1 && thr > 0.05 && brk < 0.05 && vf > -0.15) this.gear = 1;
      const drive = this.gear === 1 ? thr : brk;
      const stop = this.gear === 1 ? brk : thr;
      const sp = this.gear * vf;
      if (stop > 0.05) {
        dv = toward0(stop * cfg.brakeDecel);
      } else if (drive > 0.05) {
        const maxS = this.gear === 1 ? cfg.topSpeed : cfg.reverseSpeed;
        const acc = this.gear === 1 ? cfg.accel : cfg.reverseAccel;
        if (sp < maxS) dv = this.gear * Math.min(drive * acc * dt, maxS - sp);
      } else {
        dv = toward0(cfg.coastDecel);
      }
    }
    // On the ramp the drive holds the truck against the slope (hydrostatic drive, no freewheeling),
    // so it drives, brakes and coasts the same as on the flat
    const pitchY = new THREE.Vector3(0, 0, 1).applyQuaternion(q).y;
    if (this.groundFrac > 0 && this.tippedTime === 0) dv += 9.81 * pitchY * dt;
    const vfNew = vf + dv;

    // Rear-wheel steering, bicycle model around the front axle: the tail swings out.
    let yawTarget = (-vfNew * Math.tan(this.steer)) / cfg.wheelbase;
    yawTarget = Math.max(-cfg.maxYawRate, Math.min(cfg.maxYawRate, yawTarget));
    const comLocal = new THREE.Vector3(...cfg.centerOfMass);
    const rFront = new THREE.Vector3(0, 0, comLocal.z - FRONT_AXLE_Z).applyQuaternion(q); // front axle -> COM
    const swing = new THREE.Vector3(0, yawTarget, 0).cross(rFront);
    const vlTarget = swing.dot(right);

    const J = fwd
      .clone()
      .multiplyScalar(dv)
      .addScaledVector(right, vlTarget - vl)
      .multiplyScalar(cfg.mass);
    const maxJ = cfg.traction * cfg.mass * 9.81 * dt * this.groundFrac;
    if (J.length() > maxJ) J.setLength(maxJ);
    // Drive/brake acts through the centre of mass; the sideways tire grip acts at the floor,
    // so hard cornering rolls the truck toward the outside of the turn (and can tip it).
    const lat = right.clone().multiplyScalar(J.dot(right));
    const lon = J.clone().sub(lat);
    body.applyImpulse({ x: lon.x, y: 0, z: lon.z }, true);
    const com = body.worldCom();
    body.applyImpulseAtPoint({ x: lat.x, y: 0, z: lat.z }, { x: com.x, y: t.y + cfg.gripHeight, z: com.z }, true);

    const av = body.angvel();
    // Roll damping (tires and mast soak up the lurch): a quick flick of the wheel rocks the
    // truck instead of tipping it, but holding a hard turn at full speed still rolls it over.
    const rollRate = av.x * fwd.x + av.y * fwd.y + av.z * fwd.z;
    const roll = fwd.clone().multiplyScalar(-cfg.rollDamping * cfg.inertia[2] * rollRate * dt * this.groundFrac);
    body.applyTorqueImpulse({ x: roll.x, y: roll.y, z: roll.z }, true);
    const dw = Math.max(-cfg.yawAccel * dt, Math.min(cfg.yawAccel * dt, yawTarget - av.y));
    body.applyTorqueImpulse({ x: 0, y: cfg.inertia[1] * dw * this.groundFrac, z: 0 }, true);

    // Reverse beeper
    if (this.gear === -1 && vf < -0.1) {
      this.beepTimer -= dt;
      if (this.beepTimer <= 0) {
        this.beepTimer = 0.6;
        if (active) sfx.reverseBeep();
      }
    } else this.beepTimer = 0;
  }

  look(a, active) {
    if (!active) return;
    const cfg = CONFIG.forklift;
    this.lookYaw = Math.max(-cfg.lookYawLimit, Math.min(cfg.lookYawLimit, this.lookYaw - a.lookX));
    this.lookPitch = Math.max(-cfg.lookPitchLimit, Math.min(cfg.lookPitchLimit, this.lookPitch - a.lookY));
  }

  // Dashboard screen built into a sloped yellow binnacle on top of the dash, centred behind
  // the steering wheel and tilted up toward the driver: speedometer, D/R gear, fork height.
  buildDashboard(root) {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 300;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    // Slope rises toward the front: from the dash top (y 1.05, z 0.54) to (y 1.17, z 0.72)
    const back = new THREE.Vector3(0, 1.05, 0.54);
    const front = new THREE.Vector3(0, 1.17, 0.72);
    const along = front.clone().sub(back);
    const slopeLen = along.length();
    along.normalize();
    const normal = new THREE.Vector3(0, along.z, -along.y); // up and back, toward the driver
    // Screen axes: right = driver's right (-X), up = up the slope, out = normal
    const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(-1, 0, 0), along, normal);
    const q = new THREE.Quaternion().setFromRotationMatrix(basis);
    const mid = back.clone().add(front).multiplyScalar(0.5);
    const binnacle = boxMesh(0.64, slopeLen + 0.02, 0.14, 0xf2b705);
    binnacle.quaternion.copy(q);
    binnacle.position.copy(mid).addScaledVector(normal, -0.07);
    const bezel = boxMesh(0.47, 0.215, 0.012, 0x15181c, { edges: false });
    bezel.quaternion.copy(q);
    bezel.position.copy(mid).addScaledVector(normal, -0.004);
    const w = 0.44;
    const h = (w * canvas.height) / canvas.width;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
    screen.quaternion.copy(q);
    screen.position.copy(mid).addScaledVector(normal, 0.003);
    root.add(binnacle, bezel, screen);
    this.dash = { canvas, tex, key: null };
    this.drawDashboard();
  }

  // The pick list lives on a clipboard hung on the front-left guard post, angled at the driver:
  // Ralph reads it from the seat; Dave has to come and look (or ask).
  buildClipboard(root) {
    const canvas = document.createElement('canvas');
    canvas.width = 540;
    canvas.height = 720;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const group = new THREE.Group();
    const board = boxMesh(0.3, 0.4, 0.012, 0x9b6a3c, { edges: false });
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.36), new THREE.MeshBasicMaterial({ map: tex }));
    paper.position.set(0, -0.012, 0.0075);
    const clip = boxMesh(0.1, 0.035, 0.03, 0xb8bec6);
    clip.position.set(0, 0.19, 0.012);
    group.add(board, paper, clip);
    // On the inside of the left post, facing the driver's eye
    const pos = new THREE.Vector3(0.37, 1.52, 0.62);
    const eye = new THREE.Vector3(...CONFIG.forklift.seatEye);
    group.position.copy(pos);
    group.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(eye, pos, new THREE.Vector3(0, 1, 0)));
    root.add(group);
    this.clipboard = { canvas, tex, key: null };
  }

  drawClipboard() {
    const game = this.game;
    const order = game.level?.order;
    if (!order || !this.clipboard) return;
    const status = game.itemStatus || {};
    const key = order.map((o) => `${o.sku}:${o.qty}:${status[o.line] || 0}`).join('|');
    if (key === this.clipboard.key) return;
    this.clipboard.key = key;
    const { canvas, tex } = this.clipboard;
    const g = canvas.getContext('2d');
    const W = canvas.width;
    g.fillStyle = '#f7f3e6';
    g.fillRect(0, 0, W, canvas.height);
    // Ruled lines
    g.strokeStyle = '#d9e3ef';
    g.lineWidth = 2;
    for (let y = 300; y < 640; y += 56) {
      g.beginPath();
      g.moveTo(24, y);
      g.lineTo(W - 24, y);
      g.stroke();
    }
    g.textBaseline = 'middle';
    g.fillStyle = '#111';
    g.font = 'bold 44px system-ui, sans-serif';
    g.textAlign = 'left';
    g.fillText('PICK LIST', 28, 52);
    g.textAlign = 'right';
    g.fillText('ORDER #1', W - 28, 52);
    g.fillStyle = '#c62828';
    g.fillRect(28, 82, W - 56, 4);
    // Column headings on a yellow band
    g.fillStyle = '#f5c518';
    g.fillRect(28, 100, W - 56, 44);
    g.fillStyle = '#5a4a00';
    g.font = 'bold 28px system-ui, sans-serif';
    g.textAlign = 'left';
    g.fillText('SKU', 40, 123);
    g.fillText('QTY', 196, 123);
    g.fillText('LOCATION', 296, 123);
    order.forEach((o, i) => {
      const y = 188 + i * 84;
      const have = Math.min(o.qty, status[o.line] || 0);
      const done = have >= o.qty;
      g.fillStyle = done ? '#8a8a8a' : '#111';
      g.font = 'bold 52px ui-monospace, Menlo, Consolas, monospace';
      g.textAlign = 'left';
      g.fillText(String(o.sku), 36, y);
      g.fillStyle = done ? '#8a8a8a' : '#b3261e';
      g.fillText(have > 0 && !done ? `${have}/${o.qty}` : String(o.qty), 190, y);
      g.fillStyle = done ? '#8a8a8a' : '#111';
      g.font = 'bold 46px ui-monospace, Menlo, Consolas, monospace';
      g.fillText(o.location, 296, y);
      if (done) {
        g.strokeStyle = '#555';
        g.lineWidth = 5;
        g.beginPath();
        g.moveTo(30, y);
        g.lineTo(W - 30, y);
        g.stroke();
      }
    });
    g.fillStyle = '#333';
    g.font = '30px system-ui, sans-serif';
    g.textAlign = 'left';
    g.fillText('Wrap, then ship to', 30, 650);
    g.fillStyle = '#1a7f37';
    g.font = 'bold 30px system-ui, sans-serif';
    g.fillText('DOCK 1', 290, 650);
    tex.needsUpdate = true;
  }

  drawDashboard() {
    const mph = Math.abs(this.speed) * 2.237;
    const height = this.measuredHeight ? Math.max(0, this.measuredHeight()) : this.height;
    const key = `${mph.toFixed(1)}|${this.gear}|${height.toFixed(2)}`;
    if (key === this.dash.key) return;
    this.dash.key = key;
    const cfg = CONFIG.forklift;
    const g = this.dash.canvas.getContext('2d');
    const W = this.dash.canvas.width;
    const H = this.dash.canvas.height;
    g.fillStyle = '#0d1014';
    g.fillRect(0, 0, W, H);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const label = (text, x, y) => {
      g.font = 'bold 20px system-ui, sans-serif';
      g.fillStyle = '#7d8793';
      g.fillText(text, x, y);
    };

    // --- Speedometer: needle sweeps 0-10 mph across 240°
    const cx = 150;
    const cy = 150;
    const R = 128;
    const max = 10;
    const a0 = Math.PI * 0.833;
    const sweep = Math.PI * 1.333;
    const ang = (v) => a0 + (Math.min(v, max) / max) * sweep;
    g.strokeStyle = '#c62828';
    g.lineWidth = 12;
    g.beginPath();
    g.arc(cx, cy, R - 22, ang(8), ang(10));
    g.stroke();
    g.font = 'bold 24px system-ui, sans-serif';
    for (let v = 0; v <= max; v++) {
      const a = ang(v);
      const major = v % 2 === 0;
      g.strokeStyle = '#e8e8e8';
      g.lineWidth = major ? 5 : 3;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * (major ? R - 40 : R - 32), cy + Math.sin(a) * (major ? R - 40 : R - 32));
      g.lineTo(cx + Math.cos(a) * (R - 16), cy + Math.sin(a) * (R - 16));
      g.stroke();
      if (major) {
        g.fillStyle = '#e8e8e8';
        g.fillText(String(v), cx + Math.cos(a) * (R - 60), cy + Math.sin(a) * (R - 60));
      }
    }
    g.font = 'bold 40px system-ui, sans-serif';
    g.fillStyle = '#ffd400';
    g.fillText(mph.toFixed(1), cx, cy + 52);
    label('MPH', cx, cy + 86);
    const a = ang(mph);
    g.strokeStyle = '#ff5a1f';
    g.lineWidth = 7;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx - Math.cos(a) * 14, cy - Math.sin(a) * 14);
    g.lineTo(cx + Math.cos(a) * (R - 24), cy + Math.sin(a) * (R - 24));
    g.stroke();
    g.lineCap = 'butt';
    g.fillStyle = '#ff5a1f';
    g.beginPath();
    g.arc(cx, cy, 12, 0, Math.PI * 2);
    g.fill();

    // --- Gear: D and R lights, the active one lit
    const gx = 360;
    label('GEAR', gx, 40);
    for (const [txt, y, on, color] of [
      ['D', 115, this.gear === 1, '#31d07a'],
      ['R', 215, this.gear === -1, '#ff4040'],
    ]) {
      g.fillStyle = on ? color : '#1f252c';
      g.fillRect(gx - 44, y - 42, 88, 84);
      g.strokeStyle = on ? color : '#38414b';
      g.lineWidth = 3;
      g.strokeRect(gx - 44, y - 42, 88, 84);
      g.font = 'bold 64px system-ui, sans-serif';
      g.fillStyle = on ? '#0d1014' : '#4a535d';
      g.fillText(txt, gx, y + 3);
    }

    // --- Fork height: vertical bar from liftMin to liftMax, plus metres
    const fx = 520;
    label('FORKS', fx + 30, 40);
    const barX = fx - 30;
    const barTop = 66;
    const barH = 196;
    const frac = Math.min(1, Math.max(0, height / cfg.liftMax));
    g.strokeStyle = '#7d8793';
    g.lineWidth = 3;
    g.strokeRect(barX, barTop, 34, barH);
    g.fillStyle = '#ffd400';
    g.fillRect(barX + 3, barTop + 3 + (barH - 6) * (1 - frac), 28, (barH - 6) * frac);
    // Shelf heights as tick marks on the bar
    g.strokeStyle = '#e86a1c';
    g.lineWidth = 3;
    for (const y of [1.5, 3.0]) {
      const ty = barTop + barH * (1 - y / cfg.liftMax);
      g.beginPath();
      g.moveTo(barX - 8, ty);
      g.lineTo(barX + 42, ty);
      g.stroke();
    }
    g.textAlign = 'left';
    g.font = 'bold 44px system-ui, sans-serif';
    g.fillStyle = '#ffffff';
    g.fillText(height.toFixed(2), barX + 46, barTop + barH / 2 - 8);
    g.font = 'bold 22px system-ui, sans-serif';
    g.fillStyle = '#7d8793';
    g.fillText('m', barX + 46, barTop + barH / 2 + 28);
    this.dash.tex.needsUpdate = true;
  }

  updateVisuals(dt) {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.mesh.position.set(t.x, t.y, t.z);
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    this.carriageMesh.position.y = this.measuredHeight();
    this.wheelSpin += (this.speed * dt) / WHEEL_R;
    for (const w of this.wheelMeshes) {
      w.pivot.rotation.y = w.front ? 0 : this.steer;
      w.tire.rotation.x = this.wheelSpin;
    }
    this.steeringWheel.rotation.z = -this.steer * 3;
    // Lift lever: back to raise, forward to lower; Ralph's right hand moves over to work it
    const leverWant = -(this.liftInput || 0) * 0.45;
    this.leverTilt += (leverWant - this.leverTilt) * Math.min(1, dt * 12);
    this.lever.rotation.x = this.leverTilt;
    const handWant = this.liftInput ? 1 : 0;
    this.handOnLever += (handWant - this.handOnLever) * Math.min(1, dt * (handWant ? 10 : 4));
    this.drawDashboard();
    this.drawClipboard();
    // Driver's gloves on the rim at ten and two, following the wheel as it turns
    this.driver.sit();
    this.mesh.updateMatrixWorld(true);
    const spin = THREE.MathUtils.clamp(this.steeringWheel.rotation.z, -0.9, 0.9);
    for (const [side, base] of [['L', Math.PI / 6], ['R', (5 * Math.PI) / 6]]) {
      const a = base + spin;
      const grip = this.wheelMount.localToWorld(new THREE.Vector3(Math.cos(a) * STEER_R, Math.sin(a) * STEER_R, -0.02));
      if (side === 'R' && this.handOnLever > 0.01) grip.lerp(this.leverKnob.getWorldPosition(new THREE.Vector3()), this.handOnLever);
      this.driver.reach(side, grip);
    }
    this.beacon.visible = Math.floor(performance.now() / 400) % 2 === 0;
  }

  updateCamera() {
    const cfg = CONFIG.forklift;
    const q = quatToThree(this.body.rotation());
    const t = this.body.translation();
    // Looking down, the driver leans forward over the dash to see the fork tips
    const want = Math.max(0, Math.min(1, (-this.lookPitch - 0.15) / 0.45));
    this.lean = (this.lean || 0) + (want - (this.lean || 0)) * 0.15;
    const [lx, ly, lz] = cfg.leanOffset;
    const eye = new THREE.Vector3(cfg.seatEye[0] + lx * this.lean, cfg.seatEye[1] + ly * this.lean, cfg.seatEye[2] + lz * this.lean)
      .applyQuaternion(q)
      .add(t);
    this.camera.position.copy(eye);
    const look = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.lookPitch, Math.PI + this.lookYaw, 0, 'YXZ'));
    this.camera.quaternion.copy(q).multiply(look);
  }
}
