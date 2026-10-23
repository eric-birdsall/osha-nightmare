import * as THREE from 'three';

// Drift effects for the forklift's rear wheels: dark skid marks left on the floor, puffs of tyre
// smoke while it slides, and sparks while a drift is charging its boost (orange) or charged (blue).
const MARKS = 500;
const PUFFS = 48;
const SPARKS = 40;

export class DriftFx {
  constructor(scene) {
    this.scene = scene;
    // Skid marks: a ring buffer of flat dark quads, faded by age
    this.marks = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.13, 0.3),
      new THREE.MeshBasicMaterial({ color: 0x1a1b1e, transparent: true, opacity: 0.45, depthWrite: false }),
      MARKS,
    );
    this.marks.count = 0;
    this.marks.renderOrder = 1;
    this.marks.frustumCulled = false;
    scene.add(this.marks);
    this.markNext = 0;
    this.markTimer = 0;
    // Smoke and sparks: small pools of sprites
    const puffMat = new THREE.SpriteMaterial({ color: 0xd9dde2, transparent: true, opacity: 0, depthWrite: false });
    this.puffs = Array.from({ length: PUFFS }, () => {
      const s = new THREE.Sprite(puffMat.clone());
      s.visible = false;
      scene.add(s);
      return { s, life: 0, vel: new THREE.Vector3() };
    });
    const sparkMat = new THREE.SpriteMaterial({ color: 0xffa020, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.sparks = Array.from({ length: SPARKS }, () => {
      const s = new THREE.Sprite(sparkMat.clone());
      s.scale.setScalar(0.06);
      s.visible = false;
      scene.add(s);
      return { s, life: 0, vel: new THREE.Vector3() };
    });
    this.puffNext = 0;
    this.sparkNext = 0;
  }

  // wheels: world positions of the rear wheels at the floor; heading: direction of travel (rad);
  // sliding: 0..1 how hard it's sliding; charge: 'none' | 'charging' | 'charged'
  update(dt, { wheels, heading, sliding, charge }) {
    // Skid marks every few centimetres of travel while sliding
    this.markTimer -= dt;
    if (sliding > 0.3 && this.markTimer <= 0) {
      this.markTimer = 0.03;
      const m = new THREE.Matrix4();
      // Lie flat, long side along the direction of travel
      const q = new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
      for (const w of wheels) {
        m.compose(new THREE.Vector3(w.x, w.y + 0.008, w.z), q, new THREE.Vector3(1, 1, 1));
        this.marks.setMatrixAt(this.markNext, m);
        this.markNext = (this.markNext + 1) % MARKS;
        this.marks.count = Math.min(MARKS, this.marks.count + 1);
      }
      this.marks.instanceMatrix.needsUpdate = true;
    }
    // Smoke puffs from the rear tyres
    if (sliding > 0.3 && Math.random() < sliding * 0.6) {
      for (const w of wheels) {
        const p = this.puffs[this.puffNext];
        this.puffNext = (this.puffNext + 1) % PUFFS;
        p.life = 1;
        p.s.visible = true;
        p.s.position.set(w.x + (Math.random() - 0.5) * 0.2, w.y + 0.1, w.z + (Math.random() - 0.5) * 0.2);
        p.vel.set((Math.random() - 0.5) * 0.4, 0.5 + Math.random() * 0.3, (Math.random() - 0.5) * 0.4);
      }
    }
    for (const p of this.puffs) {
      if (p.life <= 0) continue;
      p.life -= dt * 1.2;
      p.s.position.addScaledVector(p.vel, dt);
      p.s.scale.setScalar(0.3 + (1 - p.life) * 0.9);
      p.s.material.opacity = Math.max(0, p.life) * 0.45;
      if (p.life <= 0) p.s.visible = false;
    }
    // Sparks off the rear wheels while a drift charges: orange, then blue when the boost is ready
    if (charge !== 'none') {
      const color = charge === 'charged' ? 0x4aa8ff : 0xffa020;
      for (let k = 0; k < 2; k++) {
        const w = wheels[Math.floor(Math.random() * wheels.length)];
        const sp = this.sparks[this.sparkNext];
        this.sparkNext = (this.sparkNext + 1) % SPARKS;
        sp.life = 1;
        sp.s.visible = true;
        sp.s.material.color.setHex(color);
        sp.s.position.set(w.x, w.y + 0.05, w.z);
        sp.vel.set((Math.random() - 0.5) * 2.5, 1 + Math.random() * 1.5, (Math.random() - 0.5) * 2.5);
      }
    }
    for (const sp of this.sparks) {
      if (sp.life <= 0) continue;
      sp.life -= dt * 4;
      sp.vel.y -= 9 * dt;
      sp.s.position.addScaledVector(sp.vel, dt);
      sp.s.material.opacity = Math.max(0, sp.life);
      if (sp.life <= 0) sp.s.visible = false;
    }
  }
}
