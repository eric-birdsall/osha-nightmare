import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { COL } from '../physics.js';
import { boxMesh, flatMat } from '../util/meshes.js';
import { Sparks } from './hazards.js';

// Each hanging unit has a fixed contact body until the forklift knocks it loose.
export function buildHangingLights(game, fixtures, outIndices, faultyIndex, roofY, floorAt) {
  const sparks = new Sparks(game.scene, 48);
  const units = fixtures.map(([x, y, z], i) => {
    const group = new THREE.Group(); group.position.set(x, y, z);
    group.name = `Hanging light ${i + 1}`;
    group.add(boxMesh(1.25, .08, .32, 0xdfe3e8));
    const material = new THREE.MeshBasicMaterial({ color: i === faultyIndex || outIndices.includes(i) ? 0x44494f : 0xf2f8ff });
    const tube = boxMesh(1.18, .02, .22, 0, { material, edges: false });
    tube.position.y = -.045; group.add(tube);
    if (i === faultyIndex) tube.name = 'Sparking ceiling light';
    game.scene.add(group);
    const chains = new THREE.Group();
    for (const sx of [-.5, .5]) {
      const chain = boxMesh(.015, roofY - y, .015, 0x8a9099, { edges: false });
      chain.position.set(x + sx, (roofY + y) / 2, z); chains.add(chain);
    }
    game.scene.add(chains);
    const body = game.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
    const collider = game.world.createCollider(RAPIER.ColliderDesc.cuboid(.625, .055, .16).setCollisionGroups(COL.static).setMass(8).setFriction(.6), body);
    return { body, collider, mesh: group, chains, material, broken: false, burning: false, fire: null };
  });
  const faulty = units[faultyIndex];
  const sparkFlash = new THREE.PointLight(0xb4d7ff, 0, 6); sparkFlash.position.copy(faulty.mesh.position); game.scene.add(sparkFlash);
  let untilSpark = 1, flashing = 0, time = 0;
  function ignite(unit) {
    unit.burning = true;
    unit.material.color.setHex(0x292b2f);
    const fire = new THREE.Group();
    fire.name = 'Burning fallen light';
    for (let i = 0; i < 5; i++) {
      const flame = new THREE.Mesh(new THREE.ConeGeometry(.12, .55 + i * .05, 6), new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffcf36 : 0xff651b, transparent: true, opacity: .85, depthWrite: false }));
      flame.position.set((i - 2) * .18, .3, (i % 2 - .5) * .13); fire.add(flame);
    }
    const glow = new THREE.PointLight(0xff8b25, 2, 4); glow.position.y = .3; fire.add(glow);
    game.scene.add(fire); unit.fire = fire;
  }
  function detach(unit) {
    if (unit.broken) return;
    game.damage?.charge(`light:${units.indexOf(unit)}`, 200, 'Ceiling light broken');
    unit.broken = true; unit.chains.visible = false;
    unit.material.color.setHex(0x555960);
    unit.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    unit.collider.setCollisionGroups(COL.dyn);
    unit.body.enableCcd(true);
    unit.body.setLinvel({ x: game.forklift.body.linvel().x * .5, y: -.4, z: game.forklift.body.linvel().z * .5 }, true);
    unit.body.setAngvel({ x: .8, y: .3, z: .5 }, true);
    game.addEntity({ kind: 'prop', name: 'Fallen light', body: unit.body, mesh: unit.mesh, mass: 8 });
    sparks.burst(new THREE.Vector3().copy(unit.body.translation()), new THREE.Vector3(0, -1, 0), 24);
  }
  return {
    units,
    restore(records) {
      records.forEach((record, i) => {
        if (!record.broken) return;
        const unit = units[i]; detach(unit);
        unit.body.setTranslation(record.p, true); unit.body.setRotation(record.q, true);
        const ent = game.entities.find(e => e.body === unit.body); ent.runId = record.id;
        if (record.burning) ignite(unit);
      });
    },
    step() {
      for (const unit of units) {
        if (!unit.broken) {
          let hit = false;
          game.world.contactPairsWith(unit.collider, other => { if (game.forklift.ownsCollider(other)) hit = true; });
          if (!hit) continue;
          detach(unit);
        } else if (!unit.burning) {
          const p = unit.body.translation();
          if (p.y > floorAt(p.x, p.z) + .4) continue;
          let floorContact = false;
          game.world.contactPairsWith(unit.collider, other => {
            if (other.parent()?.handle === game.staticBody.handle) floorContact = true;
          });
          if (floorContact) ignite(unit);
        }
      }
    },
    update(dt) {
      time += dt; untilSpark -= dt; flashing = Math.max(0, flashing - dt);
      if (!faulty.broken && untilSpark <= 0) {
        sparks.burst(faulty.mesh.position.clone().add(new THREE.Vector3(.48, -.1, 0)), new THREE.Vector3(0, -1, 0), 22);
        flashing = .2; untilSpark = 1.5 + Math.random() * 3.5;
      }
      const on = !faulty.broken && flashing > 0 && Math.random() > .35;
      if (!faulty.broken) faulty.material.color.setHex(on ? 0xe6f3ff : 0x51575e);
      sparkFlash.position.copy(faulty.mesh.position); sparkFlash.intensity = on ? 5 : 0;
      sparks.update(dt);
      for (const unit of units) if (unit.fire) {
        unit.fire.position.copy(unit.body.translation());
        unit.fire.children.forEach((flame, i) => {
          if (flame.isMesh) { flame.scale.y = .8 + Math.sin(time * 16 + i * 2) * .25; flame.rotation.y = time + i; }
          else if (flame.isPointLight) flame.intensity = 1.7 + Math.sin(time * 19) * .4;
        });
      }
    },
  };
}
