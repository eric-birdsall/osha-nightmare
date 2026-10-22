import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../config.js';
import { COL, castRay, yawQuat, quatToThree } from '../physics.js';
import { boxMesh, flatMat } from '../util/meshes.js';
import { sfx } from '../systems/audio.js';

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
const FORK_T = 0.05;
const FORK_Z = PLATE_Z + 0.03 + FORK_LEN / 2;

// Static parts on the chassis body: [half extents, position, color]
const PARTS = [
  [[0.55, 0.3, 0.95], [0, 0.55, -0.2], 0xf2b705], // lower chassis
  [[0.55, 0.26, 0.17], [0, 1.1, -0.98], 0x3a3f47], // counterweight hump
  [[0.5, 0.1, 0.1], [0, 0.95, 0.64], 0xf2b705], // cowl / dash (kept low so the forks show)
  [[0.03, 0.66, 0.03], [0.53, 1.51, 0.66], 0x1d1f23], // guard posts
  [[0.03, 0.66, 0.03], [-0.53, 1.51, 0.66], 0x1d1f23],
  [[0.03, 0.66, 0.03], [0.53, 1.51, -0.78], 0x1d1f23],
  [[0.03, 0.66, 0.03], [-0.53, 1.51, -0.78], 0x1d1f23],
  [[0.57, 0.03, 0.76], [0, 2.19, -0.06], 0x1d1f23], // overhead guard roof
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
    addCarriageCol(RAPIER.ColliderDesc.cuboid(0.45, 0.3, 0.03).setTranslation(0, 0.25, 0).setFriction(0.6), 90);
    for (const sx of [-1, 1]) {
      addCarriageCol(
        RAPIER.ColliderDesc.cuboid(0.05, FORK_T / 2, FORK_LEN / 2)
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
    this.body.setTranslation({ x: pos.x, y: 0.02, z: pos.z }, true);
    this.body.setRotation(q, true);
    const c = new THREE.Vector3(0, this.height + 0.02, PLATE_Z).applyQuaternion(quatToThree(q)).add(new THREE.Vector3(pos.x, 0, pos.z));
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
    for (const [half, pos, color] of PARTS) {
      const m = boxMesh(half[0] * 2, half[1] * 2, half[2] * 2, color);
      m.position.set(...pos);
      root.add(m);
    }
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
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 8, 20), flatMat(0x111111));
    wheel.position.set(0, 1.3, 0.38);
    wheel.rotation.x = -0.9;
    root.add(wheel);
    this.steeringWheel = wheel;
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
    const plate = boxMesh(0.9, 0.6, 0.06, 0x444a52);
    plate.position.set(0, 0.25, PLATE_Z);
    carriage.add(plate);
    // Load backrest grille
    for (let i = -3; i <= 3; i++) {
      const bar = boxMesh(0.03, 0.45, 0.03, 0x30343a, { edges: false });
      bar.position.set(i * 0.13, 0.75, PLATE_Z);
      carriage.add(bar);
    }
    for (const s of [-1, 1]) {
      const fork = boxMesh(0.1, FORK_T, FORK_LEN, 0x222222);
      fork.position.set(s * FORK_X, -FORK_T / 2, FORK_Z);
      carriage.add(fork);
      // Hazard-painted fork tips so the driver can line them up with pallet pockets
      const tipLen = 0.22;
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.104, FORK_T + 0.004, tipLen), new THREE.MeshBasicMaterial({ color: 0xffd400 }));
      tip.position.set(s * FORK_X, -FORK_T / 2, FORK_Z + FORK_LEN / 2 - tipLen / 2 + 0.002);
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.106, FORK_T + 0.006, 0.05), new THREE.MeshBasicMaterial({ color: 0x111111 }));
      band.position.z = -0.03;
      tip.add(band);
      carriage.add(tip);
    }
    root.add(carriage);
    this.carriageMesh = carriage;
    // Driver dummy, seen only by the climber's camera (layer 2)
    const driver = new THREE.Group();
    const torso = boxMesh(0.4, 0.55, 0.25, 0xff7a00);
    torso.position.set(0, 1.28, -0.35);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), flatMat(0xe0b48a));
    head.position.set(0, 1.72, -0.3);
    const hat = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), flatMat(0xffd400));
    hat.position.set(0, 1.76, -0.3);
    driver.add(torso, head, hat);
    driver.traverse((o) => o.layers.set(2));
    root.add(driver);

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
    let target = liftDir * cfg.liftSpeed;
    const maxUp = Math.sqrt(2 * cfg.liftAccel * Math.max(0, cfg.liftMax - this.height));
    const maxDown = Math.sqrt(2 * cfg.liftAccel * Math.max(0, this.height - cfg.liftMin));
    target = Math.max(-maxDown, Math.min(maxUp, target));
    const dl = target - this.liftVel;
    this.liftVel += Math.sign(dl) * Math.min(Math.abs(dl), cfg.liftAccel * dt);
    const prevH = this.height;
    this.height = Math.max(cfg.liftMin, Math.min(cfg.liftMax, this.height + this.liftVel * dt));
    if (this.height === cfg.liftMin || this.height === cfg.liftMax) this.liftVel = (this.height - prevH) / dt;
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
    body.applyImpulse({ x: J.x, y: 0, z: J.z }, true);

    const av = body.angvel();
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
