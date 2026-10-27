import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { COL } from '../physics.js';
import { boxMesh, flatMat, labelPlane } from '../util/meshes.js';
import { Sparks } from './hazards.js';
import { sfx } from '../systems/audio.js';
import { LAYOUT } from './layout.js';

// Powered roller conveyors (LAYOUT.conveyors): waist-high belts that carry anything resting on
// them north at their `speed`, and drop it off the north end. Boxes, pallets, ladders,
// and Dave if he climbs on (he rides it; see Climber's support velocity).

const YELLOW = 0xf5c518;
const STEEL = 0x5b636d;

// A belt texture of dark rubber with lighter cleats, scrolled to show it moving
function beltTexture(len) {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#2a2d31';
  g.fillRect(0, 0, 32, 64);
  g.fillStyle = '#4a4f56';
  g.fillRect(0, 0, 32, 6);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, len / 0.5);
  return tex;
}

export function buildConveyors(game) {
  return LAYOUT.conveyors.map((c) => buildConveyor(game, c));
}

function buildConveyor(game, c) {
  const { x0, x1, z0, z1, height: h, speed } = c;
  const [w, len, cx, cz] = [x1 - x0, z1 - z0, (x0 + x1) / 2, (z0 + z1) / 2];
  // The body: solid up to the belt
  const collider = game.world.createCollider(
    RAPIER.ColliderDesc.cuboid(w / 2, h / 2, len / 2).setTranslation(cx, h / 2, cz).setFriction(0.6).setCollisionGroups(COL.static),
    game.staticBody,
  );
  const scene = game.scene;
  const add = (mesh, x, y, z) => {
    mesh.position.set(x, y, z);
    scene.add(mesh);
    return mesh;
  };
  // Side frames (a little proud of the belt), legs, and rollers at the ends
  for (const sx of [x0 + 0.04, x1 - 0.04]) add(boxMesh(0.08, 0.22, len, STEEL), sx, h - 0.06, cz);
  for (let z = z0 + 0.4; z < z1; z += 2.2) {
    for (const sx of [x0 + 0.08, x1 - 0.08]) add(boxMesh(0.06, h - 0.15, 0.06, STEEL, { edges: false }), sx, (h - 0.15) / 2, z);
  }
  for (const z of [z0 + 0.12, z1 - 0.12]) {
    const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, w - 0.1, 14), flatMat(0x8a9099));
    roller.rotation.z = Math.PI / 2;
    add(roller, cx, h - 0.12, z);
  }
  // The belt itself, scrolling north
  const tex = beltTexture(len);
  const belt = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.16, len), new THREE.MeshLambertMaterial({ map: tex }));
  belt.rotation.x = -Math.PI / 2;
  add(belt, cx, h + 0.002, cz);
  // Motor housing at the south end, a hazard-striped guard and a warning sign on the wall
  add(boxMesh(w, 0.5, 0.6, 0x2f5fb3), cx, 0.35, z1 + 0.35);
  game.world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, 0.25, 0.3).setTranslation(cx, 0.35, z1 + 0.35).setCollisionGroups(COL.static), game.staticBody);
  add(boxMesh(w + 0.02, 0.12, 0.04, YELLOW, { edges: false }), cx, h + 0.1, z0 + 0.02);
  if (c.sign) {
    const sign = labelPlane('CONVEYOR · KEEP HANDS CLEAR · NO RIDING', 3.2, 0.3, { bg: '#f5c518', fg: '#16171a' });
    sign.rotation.y = -Math.PI / 2;
    add(sign, LAYOUT.room.halfX - 0.03, 1.7, cz + 4);
  }
  // A funnel over the last stretch: yellow guide rails angle in from the belt's sides to a
  // pallet-width (1.1 m) mouth at the north end, and the belt steers what's on it toward the middle,
  // so everything drops onto the pallet waiting there
  const FUNNEL = 2.0;
  const mouth = Math.min(w, 1.1) / 2; // wide enough for a box turned corner-on
  for (const side of [-1, 1]) {
    const [ax, az, bx, bz] = [cx + side * (w / 2 - 0.03), z0 + FUNNEL, cx + side * (mouth - 0.03), z0 + 0.05];
    const len = Math.hypot(bx - ax, bz - az);
    const ry = Math.atan2(bx - ax, bz - az);
    const rail = boxMesh(0.04, 0.12, len, YELLOW, { edges: false });
    rail.rotation.y = ry;
    add(rail, (ax + bx) / 2, h + 0.14, (az + bz) / 2);
    // Solid, so boxes are guided in rather than passing through (taller than it looks, so a
    // tumbling box can't ride over it)
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
    game.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.02, 0.2, len / 2)
        .setTranslation((ax + bx) / 2, h + 0.2, (az + bz) / 2)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setFriction(0.1)
        .setCollisionGroups(COL.static),
      game.staticBody,
    );
  }
  // A backstop past the pallet (on a fast belt): boxes flying off the end hit it and drop onto the
  // pallet instead of sailing over it
  if (c.backstop) {
    const bz = z0 - 0.75 - 0.5 - 0.06;
    // Build the stripe as its own section: overlapping boxes shared coplanar end faces,
    // making the black stripe flicker against the yellow panel when viewed from the side.
    add(boxMesh(1.3, 0.95, 0.08, YELLOW, { edges: false }), cx, 0.475, bz);
    add(boxMesh(1.3, 0.2, 0.08, 0x16171a, { edges: false }), cx, 1.05, bz);
    add(boxMesh(1.3, 0.05, 0.08, YELLOW, { edges: false }), cx, 1.175, bz);
    game.world.createCollider(RAPIER.ColliderDesc.cuboid(0.65, 0.6, 0.04).setTranslation(cx, 0.6, bz).setFriction(0.4).setCollisionGroups(COL.static), game.staticBody);
  }
  const velocity = new THREE.Vector3(0, 0, -speed); // north
  let powerSwitch = null;
  if (c.powerSwitch) {
    const position = new THREE.Vector3(LAYOUT.room.halfX - .10, 1.25, z1 + 1.1);
    const housing = add(boxMesh(.18, .5, .42, 0x434c57), position.x, position.y, position.z);
    housing.name = 'Conveyor power switch';
    const switchCollider = game.world.createCollider(RAPIER.ColliderDesc.cuboid(.09, .25, .21)
      .setTranslation(position.x, position.y, position.z).setCollisionGroups(COL.static), game.staticBody);
    const lever = add(boxMesh(.05, .22, .06, YELLOW), position.x - .12, 1.25, position.z);
    lever.rotation.x = -.6;
    for (const [text, offset] of [['LOW', -.56], ['HIGH', .56]]) {
      const label = labelPlane(text, .5, .18, { bg: '#f5c518', fg: '#16171a' });
      label.name = `Conveyor switch ${text}`;
      label.rotation.y = -Math.PI / 2;
      add(label, position.x - .11, 1.25, position.z + offset);
    }
    const sparks = new Sparks(scene, 30);
    const source = position.clone().add(new THREE.Vector3(-.15, .05, 0));
    const out = new THREE.Vector3(-1, .4, 0).normalize();
    const flash = new THREE.PointLight(0xffcf62, 0, 3);
    flash.position.copy(source); scene.add(flash);
    let sparkTime = 0, burstIn = 0, nextShort = 0;
    powerSwitch = {
      kind: 'conveyorSwitch', collider: switchCollider, position, high: false, speedMultiplier: (c.highSpeed || speed * 3) / speed,
      activate() {
        if (this.high) return false;
        this.high = true;
        velocity.z = -(c.highSpeed || speed * 3);
        lever.rotation.x = .6;
        lever.material.color.setHex(0x242424);
        sparkTime = 1.2; nextShort = 2 + Math.random() * 4;
        sparks.burst(source, out, 26); sfx.zap(.6);
        return true;
      },
      update(dt) {
        sparkTime = Math.max(0, sparkTime - dt); burstIn -= dt;
        if (this.high) {
          nextShort -= dt;
          if (nextShort <= 0) {
            sparkTime = .3; nextShort = 2 + Math.random() * 4;
            sparks.burst(source, out, 14);
          }
        }
        if (sparkTime > 0 && burstIn <= 0) { sparks.burst(source, out, 8); burstIn = .15; }
        flash.intensity = sparkTime > 0 ? 1 + Math.random() * 3 : 0;
        sparks.update(dt);
      },
    };
  }
  return {
    collider,
    velocity,
    powerSwitch,
    // Is this the belt (what Dave is standing on, say)?
    owns: (col) => col?.handle === collider.handle,
    // Before each physics step: drive everything resting on the belt along at belt speed
    step() {
      game.world.contactPairsWith(collider, (other) => {
        const ent = game.entityForCollider(other);
        if (!ent || ent.carried || ent.removed || !ent.body.isDynamic()) return;
        const t = ent.body.translation();
        if (t.y < h - 0.05) return; // touching the side, not riding on top
        const v = ent.body.linvel();
        // In the funnel, steer toward the middle; elsewhere just damp any sideways drift
        const vx = t.z < z0 + FUNNEL ? THREE.MathUtils.clamp((cx - t.x) * 3, -1.2, 1.2) : v.x * 0.8;
        ent.body.setLinvel({ x: vx, y: v.y, z: velocity.z }, true);
      });
    },
    // Each frame: scroll the belt
    update(dt) {
      powerSwitch?.update(dt);
      tex.offset.y += (velocity.z * dt) / 0.5; // texture v runs north here, so this slides the cleats north
    },
  };
}
