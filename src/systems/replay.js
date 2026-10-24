import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { G, groups, castRay, quatToThree } from '../physics.js';
import { boxMesh, flatMat } from '../util/meshes.js';
import { LAYOUT } from '../world/layout.js';

// Security cameras mounted high on the warehouse walls: [id, label, position]
export const CCTV = LAYOUT.cctv;

// Camera housings on brackets, aimed at the middle of the floor.
export function buildCctvFixtures(scene) {
  const aim = new THREE.Vector3(0, 0.5, -1);
  for (const [, , p] of CCTV) {
    const g = new THREE.Group();
    g.position.set(...p);
    g.lookAt(aim);
    const housing = boxMesh(0.16, 0.14, 0.34, 0xe6e8ea, { shadows: false });
    const hood = boxMesh(0.2, 0.025, 0.38, 0xcfd3d7, { shadows: false, edges: false });
    hood.position.set(0, 0.08, 0.02);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 14), flatMat(0x111111));
    lens.rotation.x = Math.PI / 2;
    lens.position.z = 0.18;
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    led.position.set(0.05, -0.04, 0.171);
    const arm = boxMesh(0.04, 0.04, 0.3, 0x2b2f35, { shadows: false, edges: false });
    arm.position.set(0, 0, -0.3);
    g.add(housing, hood, lens, led, arm);
    scene.add(g);
  }
}

// Rolling buffer of every moving object's local transform and visibility.
export class Recorder {
  constructor(game) {
    this.game = game;
    this.frames = [];
    this.blasts = []; // [{ time, at }]: explosions, so the replay can redraw their fireballs
  }

  noteBlast(time, at) {
    this.blasts.push({ time, at: at.clone() });
    this.blasts = this.blasts.filter((b) => b.time > time - CONFIG.replay.bufferSeconds - 2);
  }

  trackedObjects() {
    const g = this.game;
    const c = g.climber;
    const f = g.forklift;
    const objs = [f.mesh, f.carriageMesh, c.bodyMesh, c.worker.body, c.worker.torso, c.blob];
    for (const w of f.wheelMeshes) objs.push(w.pivot, w.tire);
    for (const p of Object.values(c.worker.pivots)) objs.push(p);
    for (const e of g.entities) objs.push(e.mesh);
    if (c.ragdoll) objs.push(c.ragdoll.group, ...c.ragdoll.group.children);
    return objs;
  }

  snapshot(time) {
    const objs = this.trackedObjects();
    const data = new Float32Array(objs.length * 8);
    objs.forEach((o, i) => {
      const k = i * 8;
      data[k] = o.position.x;
      data[k + 1] = o.position.y;
      data[k + 2] = o.position.z;
      data[k + 3] = o.quaternion.x;
      data[k + 4] = o.quaternion.y;
      data[k + 5] = o.quaternion.z;
      data[k + 6] = o.quaternion.w;
      data[k + 7] = o.visible ? 1 : 0;
    });
    return { time, objs, data, subjects: this.subjects() };
  }

  // Things a replay camera can follow: Dave, the forklift, and the middle of each rack.
  subjects() {
    const g = this.game;
    const c = g.climber;
    const s = c.ragdoll ? c.ragdoll.pelvis.translation() : c.body.translation();
    const f = g.forklift.body.translation();
    const out = { climber: new THREE.Vector3(s.x, s.y, s.z), forklift: new THREE.Vector3(f.x, f.y + 1.2, f.z) };
    for (const r of g.level.racks) {
      const mid = new THREE.Vector3(0, r.uprightH / 2, 0).applyQuaternion(quatToThree(r.body.rotation())).add(r.body.translation());
      out[`rack:${r.name}`] = mid;
    }
    return out;
  }

  capture(time) {
    this.frames.push(this.snapshot(time));
    const keep = CONFIG.replay.bufferSeconds;
    while (this.frames.length && this.frames[0].time < time - keep) this.frames.shift();
  }

  // Pose every recorded object as it was at `time` (interpolating between captures).
  static apply(frames, time, key = 'climber') {
    if (!frames.length) return null;
    let i = frames.findIndex((f) => f.time >= time);
    if (i < 0) i = frames.length - 1;
    const b = frames[i];
    const a = frames[Math.max(0, i - 1)];
    const t = b.time > a.time ? Math.max(0, Math.min(1, (time - a.time) / (b.time - a.time))) : 1;
    const sameObjs = a.objs.length === b.objs.length && a.objs.every((o, j) => o === b.objs[j]);
    const qa = new THREE.Quaternion();
    const qb = new THREE.Quaternion();
    b.objs.forEach((o, j) => {
      const k = j * 8;
      const d = b.data;
      if (sameObjs && a !== b) {
        const e = a.data;
        o.position.set(e[k] + (d[k] - e[k]) * t, e[k + 1] + (d[k + 1] - e[k + 1]) * t, e[k + 2] + (d[k + 2] - e[k + 2]) * t);
        qa.set(e[k + 3], e[k + 4], e[k + 5], e[k + 6]);
        qb.set(d[k + 3], d[k + 4], d[k + 5], d[k + 6]);
        o.quaternion.slerpQuaternions(qa, qb, t);
      } else {
        o.position.set(d[k], d[k + 1], d[k + 2]);
        o.quaternion.set(d[k + 3], d[k + 4], d[k + 5], d[k + 6]);
      }
      o.visible = d[k + 7] > 0.5;
    });
    const sa = a.subjects[key] || a.subjects.climber;
    const sb = b.subjects[key] || b.subjects.climber;
    return sameObjs && a !== b ? sa.clone().lerp(sb, t) : sb.clone();
  }
}

// Plays the recorded incident back in slow motion, cutting between security cameras.
export class ReplayDirector {
  constructor(game, { incidentTime, incident }) {
    this.game = game;
    const cfg = CONFIG.replay;
    this.incident = incident;
    this.subjectKey = incident.subject || 'climber';
    const reason = incident.line;
    this.frames = game.recorder.frames.slice();
    this.live = game.recorder.snapshot(game.clock); // restored afterwards
    // Objects seen in the clip start hidden; each frame shows what was visible then.
    this.union = new Set(this.frames.flatMap((f) => f.objs));
    const t0 = this.frames.length ? this.frames[0].time : incidentTime;
    const t1 = this.frames.length ? this.frames[this.frames.length - 1].time : incidentTime;
    const T = incidentTime;
    const cams = this.pickCameras(this.subjectAt(T));
    const windows = [
      [T - 1.3, T + 0.4],
      [T - 0.5, T + 1.0],
      [T - 0.3, T + cfg.postSeconds],
    ];
    this.segments = cams.map((cam, i) => {
      const [a, b] = windows[i];
      return { cam, from: Math.max(t0, a), to: Math.min(t1, b) };
    });
    incident.cams = cams.map((c) => `CAM ${c.id}`);
    // Fireballs of any explosions in the clip (the live ones are long gone by now)
    this.blasts = game.recorder.blasts
      .filter((b) => b.time >= t0 - 1 && b.time <= t1 + 1)
      .map((b) => {
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(1, 20, 14),
          new THREE.MeshBasicMaterial({ color: 0xffa020, transparent: true, opacity: 0.9, depthWrite: false }),
        );
        mesh.position.copy(b.at);
        mesh.visible = false;
        game.scene.add(mesh);
        return { ...b, mesh };
      });
    this.seg = 0;
    this.t = this.segments[0]?.from ?? T;
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    this.camera.layers.enable(1); // the climber's body
    this.camera.layers.enable(2); // the forklift driver
    game.climber.armRig.visible = false; // first-person arms live on the climber camera
    this.look = null;
    this.done = this.segments.length === 0;
    this.overlay = overlay();
    this.overlay.reason.textContent = reason;
    this.overlay.root.classList.add('on');
    this.startCut();
  }

  subjectAt(time) {
    let best = this.frames[0];
    for (const f of this.frames) if (Math.abs(f.time - time) < Math.abs(best.time - time)) best = f;
    return best ? (best.subjects[this.subjectKey] || best.subjects.climber).clone() : new THREE.Vector3();
  }

  // Up to three cameras with a clear line of sight, nearest first.
  pickCameras(target) {
    const world = this.game.world;
    const blockers = groups(G.CLIMBER, G.STATIC | G.DYN); // walls and racks block the view
    const scored = CCTV.map(([id, label, p]) => {
      const pos = new THREE.Vector3(...p);
      const dir = target.clone().sub(pos);
      const dist = dir.length();
      dir.normalize();
      const hit = castRay(world, pos.clone().addScaledVector(dir, 0.3), dir, dist - 0.6, blockers);
      return { id, label, pos, dist, clear: !hit };
    });
    const clear = scored.filter((s) => s.clear).sort((a, b) => a.dist - b.dist);
    const rest = scored.filter((s) => !s.clear).sort((a, b) => a.dist - b.dist);
    return [...clear, ...rest].slice(0, Math.max(1, Math.min(3, clear.length || 1)));
  }

  startCut() {
    const s = this.segments[this.seg];
    if (!s) return;
    this.t = s.from;
    this.look = null;
    this.overlay.cam.textContent = `CAM ${s.cam.id} · ${s.cam.label}`;
    this.overlay.angle.textContent = `ANGLE ${this.seg + 1}/${this.segments.length}`;
  }

  // Returns false once the replay is over.
  update(dt, skip) {
    if (this.done) return false;
    if (skip) return this.finish();
    const s = this.segments[this.seg];
    this.t += dt * CONFIG.replay.speed;
    if (this.t > s.to) {
      this.seg++;
      if (this.seg >= this.segments.length) return this.finish();
      this.startCut();
    }
    for (const o of this.union) o.visible = false;
    const subject = Recorder.apply(this.frames, this.t, this.subjectKey) || this.subjectAt(this.t);
    const { radius, fireball, duration } = CONFIG.blast;
    for (const b of this.blasts) {
      const k = (this.t - b.time) / duration;
      b.mesh.visible = k >= 0 && k < 1;
      if (!b.mesh.visible) continue;
      b.mesh.scale.setScalar(0.2 + (1 - (1 - k) ** 3) * radius * fireball);
      b.mesh.material.opacity = 0.9 * (1 - k);
      b.mesh.material.color.setHSL(0.08 - k * 0.06, 1, 0.55 - k * 0.3);
    }
    // PTZ camera: follow the subject, zoomed so they fill the frame
    const cam = this.segments[this.seg].cam;
    if (!this.look) this.look = subject.clone();
    this.look.lerp(subject, 1 - Math.exp(-dt * 6));
    // Sit just in front of the lens so the housing itself isn't in shot
    this.camera.position.copy(cam.pos).addScaledVector(this.look.clone().sub(cam.pos).normalize(), 0.4);
    this.camera.lookAt(this.look);
    const d = cam.pos.distanceTo(this.look);
    this.camera.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(2.6 / d)), 16, 60);
    this.overlay.reason.textContent = this.incident.line;
    const stamp = new Date(Date.UTC(2026, 9, 22, 14, 32, 0) + this.t * 1000);
    this.overlay.time.textContent = stamp.toISOString().slice(0, 19).replace('T', '  ');
    return true;
  }

  finish() {
    for (const b of this.blasts) {
      this.game.scene.remove(b.mesh);
      b.mesh.geometry.dispose();
      b.mesh.material.dispose();
    }
    this.blasts = [];
    for (const o of this.union) o.visible = false;
    Recorder.apply([this.live], this.live.time);
    this.game.climber.armRig.visible = true;
    this.overlay.root.classList.remove('on');
    this.done = true;
    return false;
  }

  render(renderer, w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
    renderer.render(this.game.scene, this.camera);
  }
}

let overlayEl = null;
function overlay() {
  if (!overlayEl) {
    const root = document.createElement('div');
    root.id = 'replay';
    root.innerHTML = `
      <div class="rp-scan"></div>
      <div class="rp-top"><span class="rp-cam"></span><span class="rp-rec">● REC</span></div>
      <div class="rp-time"></div>
      <div class="rp-title">INCIDENT REPLAY <span>×${CONFIG.replay.speed}</span></div>
      <div class="rp-reason"></div>
      <div class="rp-bottom"><span class="rp-angle"></span><span>Press any button to skip</span></div>`;
    document.getElementById('app').appendChild(root);
    const q = (s) => root.querySelector(s);
    overlayEl = { root, cam: q('.rp-cam'), time: q('.rp-time'), reason: q('.rp-reason'), angle: q('.rp-angle') };
  }
  return overlayEl;
}
