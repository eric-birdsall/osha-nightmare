import * as THREE from 'three';
import { createBox } from '../entities/box.js';
import { createPallet } from '../entities/pallet.js';
import { createFreight } from '../entities/freight.js';
import { buildWrapped } from './wrapping.js';
import { CONFIG } from '../config.js';

const fields = ['sku', 'type', 'damageId', 'home', 'handled', 'armed', 'fallen', 'incomingId', 'incomingPalletIds', 'receivingLine', 'storageLocation', 'storageOffset', 'basementStack'];
const pose = body => ({ p: { ...body.translation() }, q: { ...body.rotation() }, v: { ...body.linvel() }, w: { ...body.angvel() } });
function apply(body, record) {
  body.setTranslation(record.p, true); body.setRotation(record.q, true);
  body.setLinvel(record.v || { x: 0, y: 0, z: 0 }, true); body.setAngvel(record.w || { x: 0, y: 0, z: 0 }, true);
}
export function captureCheckpoint(game) {
  // A checkpoint starts receiving with free hands; loose stock stays where it was set down.
  const data = {
    entities: game.entities.map(e => ({ id: e.runId, kind: e.kind, ...pose(e.body),
      data: Object.fromEntries(fields.filter(k => e[k] !== undefined).map(k => [k, e[k]])),
      storagePallet: e.storagePallet?.runId, state: e.kind === 'ladder' ? e.state : undefined,
      contents: e.contents, mass: e.mass,
      height: e.kind === 'freight' ? e.bounds.max.y - .15 : undefined,
    })),
    lights: game.level.lighting.units.map(u => ({ broken: u.broken, burning: u.burning, ...pose(u.body), id: game.entities.find(e => e.body === u.body)?.runId })),
    conveyors: game.level.conveyors.map(c => !!c.powerSwitch?.high),
    forklift: { chassis: pose(game.forklift.body), carriage: pose(game.forklift.carriage), height: game.forklift.height, tilt: game.forklift.tilt, tiltTarget: game.forklift.tiltTarget, tiltLowered: game.forklift.tiltLowered, lookPitch: game.forklift.lookPitch },
    climber: { feet: game.climber.feet.toArray(), yaw: game.climber.yaw, pitch: game.climber.pitch },
    active: game.active, rolesSwapped: game.rolesSwapped,
    time: game.time, clock: game.clock, falls: game.falls,
    damage: { total: game.damage.total, nextId: game.damage.nextId, charged: [...game.damage.charged], entries: game.damage.entries },
  };
  return JSON.parse(JSON.stringify(data));
}
function createWrapped(game, record) {
  const q = new THREE.Quaternion().copy(record.q), origin = new THREE.Vector3().copy(record.p), load = new Set();
  let pallet;
  for (const part of record.contents) {
    const p = new THREE.Vector3(...part.pos).applyQuaternion(q).add(origin);
    const rotation = q.clone().multiply(new THREE.Quaternion(...part.rot));
    const ent = part.kind === 'pallet' ? createPallet(game, { pos: p.toArray() }) : createBox(game, { sku: part.data.sku, type: part.data.type, pos: [p.x, p.y - CONFIG.objects[part.data.type].size[1] / 2, p.z] });
    Object.assign(ent, part.data); ent.body.setRotation(rotation, true);
    if (part.kind === 'pallet') pallet = ent;
    load.add(ent);
  }
  return buildWrapped(game, pallet, load);
}
export function restoreCheckpoint(game, snapshot) {
  game.level.lighting.restore(snapshot.lights);
  const wanted = new Map(snapshot.entities.map(e => [e.id, e]));
  for (const ent of [...game.entities]) if (['box', 'pallet', 'wrapped', 'freight'].includes(ent.kind) || !wanted.has(ent.runId)) {
    game.world.removeRigidBody(ent.body); game.scene.remove(ent.mesh); game.removeEntity(ent);
  }
  const entities = new Map(game.entities.map(e => [e.runId, e]));
  for (const record of snapshot.entities) {
    let ent = entities.get(record.id);
    if (ent && (ent.kind !== record.kind || (record.kind === 'wrapped' && JSON.stringify(ent.contents) !== JSON.stringify(record.contents)))) {
      game.world.removeRigidBody(ent.body); game.scene.remove(ent.mesh); game.removeEntity(ent); ent = null;
    }
    if (!ent) {
      if (record.kind === 'wrapped') ent = createWrapped(game, record);
      else if (record.kind === 'pallet') ent = createPallet(game, { pos: Object.values(record.p) });
      else if (record.kind === 'box') ent = createBox(game, { sku: record.data.sku, type: record.data.type, pos: [record.p.x, record.p.y - CONFIG.objects[record.data.type].size[1] / 2, record.p.z] });
      else if (record.kind === 'freight') ent = createFreight(game, { sku: record.data.sku, mass: record.mass, height: record.height, pos: [record.p.x, record.p.y, record.p.z] });
      else throw new Error(`Cannot restore checkpoint entity ${record.kind}`);
      ent.runId = record.id; entities.set(record.id, ent);
    }
    Object.assign(ent, record.data);
    if (ent.storageOffset) ent.storageOffset = new THREE.Vector3().copy(ent.storageOffset);
    if (record.state && ent.setState) ent.setState(record.state === 'carried' ? 'dropped' : record.state);
    ent.carried = false;
    apply(ent.body, record); ent.mesh.position.copy(record.p); ent.mesh.quaternion.copy(record.q);
  }
  for (const ent of entities.values()) if (ent.kind === 'box' && ent.home?.rack) {
    const rack = game.level.racks.find(r => r.name === ent.home.rack);
    if (rack && !rack.stock.includes(ent)) rack.stock.push(ent);
  }
  for (const record of snapshot.entities) if (record.storagePallet) entities.get(record.id).storagePallet = entities.get(record.storagePallet);
  snapshot.conveyors.forEach((high, i) => { if (high) game.level.conveyors[i].powerSwitch?.activate(); });
  apply(game.forklift.body, snapshot.forklift.chassis); apply(game.forklift.carriage, snapshot.forklift.carriage);
  game.forklift.setTilt(snapshot.forklift.tilt ?? 0);
  game.forklift.tiltTarget = snapshot.forklift.tiltTarget ?? 0;
  game.forklift.tiltLowered = snapshot.forklift.tiltLowered ?? false;
  game.forklift.tiltReadyTime = game.forklift.tilt ? .4 : 0;
  game.forklift.height = snapshot.forklift.height; game.forklift.lookPitch = snapshot.forklift.lookPitch ?? 0; game.forklift.updateMast(game.forklift.measuredHeight());
  const [x, y, z] = snapshot.climber.feet;
  game.climber.body.setTranslation({ x, y: y + game.climber.centerOff, z }, true);
  game.climber.body.setNextKinematicTranslation({ x, y: y + game.climber.centerOff, z });
  game.climber.yaw = snapshot.climber.yaw; game.climber.pitch = snapshot.climber.pitch;
  game.active = snapshot.active || 'driver'; game.rolesSwapped = !!snapshot.rolesSwapped;
  game.time = snapshot.time; game.clock = snapshot.clock; game.falls = snapshot.falls; game.started = true;
  Object.assign(game.damage, snapshot.damage, { charged: new Set(snapshot.damage.charged), tracking: new Map(), inventory: new Map() });
  game.nextEntityId = Math.max(...snapshot.entities.map(e => e.id)) + 1;
  game.damage.step(0, true);
}
