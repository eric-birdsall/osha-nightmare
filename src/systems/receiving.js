import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { LAYOUT } from '../world/layout.js';
import { createBox } from '../entities/box.js';
import { createFreight } from '../entities/freight.js';
import { createPallet } from '../entities/pallet.js';
import { collectStack, buildWrapped } from './wrapping.js';
import { labelPlane } from '../util/meshes.js';
import { palletFitsSlot } from '../world/pallet-storage.js';
import { parkingRect } from '../world/parking.js';

export function fitsReceivingSlot(min, max, slot) {
  // The front/back beams are valid shelf support. A box can safely overhang them;
  // require its center over the shelf depth, rather than every corner tucked behind the beam.
  const centerZ = (min.z + max.z) / 2;
  return min.x >= slot.x0 + .06 && max.x <= slot.x1 - .06
    && centerZ >= slot.z0 + .03 && centerZ <= slot.z1 - .03
    && min.y >= slot.y - .06 && max.y <= slot.ceiling - .08;
}

// Real stock, physical unloading, and putaway validation. No delivered stock is auto-snapped.
export class Receiving {
  constructor(game) {
    this.game = game;
    this.spec = game.receivingSpec;
    this.putawaySigns = [];
    this.timers = new Map();
    this.stage = 0;
    this.read = false;
    this.readTime = 0;
    this.finishTime = 0;
    this.scanIn = 0;
    const dock = game.level.dockZone;
    const floor = LAYOUT.lower.y;
    const serials = {};
    this.spec.pallets.forEach((manifest, index) => {
      const pos = [dock.center.x, floor + .025, dock.center.z + dock.half.z - 1.1 - index * 1.7];
      const unit = game.level.order.find(line => line.line === manifest[0][0]);
      if (unit.freight) {
        const crate = createFreight(game, { ...unit, pos });
        crate.receivingLine = unit.line; crate.incomingId = `${this.spec.id}:${unit.line}:1`;
        crate.incomingPalletIds = [`${this.spec.id}:pallet-${index}`];
        crate.home = { pos: { ...crate.body.translation() }, rot: { ...crate.body.rotation() } };
        return;
      }
      const pallet = createPallet(game, { pos });
      pallet.incomingPalletIds = [`${this.spec.id}:pallet-${index}`];
      pallet.home = { pos: { ...pallet.body.translation() }, rot: { ...pallet.body.rotation() } };
      const load = new Set([pallet]);
      let spot = 0;
      for (const [letter, quantity] of manifest) {
        const line = game.level.order.find(l => l.line === letter);
        for (let i = 0; i < quantity; i++, spot++) {
          const box = createBox(game, { type: line.type, sku: line.sku,
            pos: [pos[0] + (spot % 2 ? .2 : -.2), pos[1] + CONFIG.objects.pallet.size[1] + .01 + Math.floor(spot / 6) * .4, pos[2] + (Math.floor(spot / 2) % 3 - 1) * .4] });
          box.receivingLine = line.line;
          box.incomingId = `${this.spec.id}:${line.line}:${serials[line.line] = (serials[line.line] || 0) + 1}`;
          box.home = { pos: { ...box.body.translation() }, rot: { ...box.body.rotation() } };
          load.add(box);
        }
      }
      buildWrapped(game, pallet, load);
    });
    // A dedicated empty-pallet return area on the lower floor, clear of the dock and parking.
    this.returns = { ...LAYOUT.emptyPalletReturn };
    const { x, z, half } = this.returns;
    for (const [w, d, dx, dz] of [[half * 2, .08, 0, -half], [half * 2, .08, 0, half], [.08, half * 2, -half, 0], [.08, half * 2, half, 0]]) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color: 0x31d07a }));
      mesh.rotation.x = -Math.PI / 2; mesh.position.set(x + dx, floor + .012, z + dz); game.scene.add(mesh);
    }
    const sign = labelPlane('EMPTY PALLETS', 2.8, .45, { bg: 'rgba(0,0,0,0)', fg: '#31d07a', transparent: true });
    sign.rotation.x = -Math.PI / 2; sign.position.set(x, floor + .014, z); game.scene.add(sign);
    if (this.spec.tutorial) {
      const marker = new THREE.Mesh(new THREE.ConeGeometry(.13, .3, 4), new THREE.MeshBasicMaterial({ color: 0xffdc35 }));
      marker.rotation.z = Math.PI; game.scene.add(marker); this.marker = marker;
    }
    this.slots = game.level.order.map((line) => this.makeSlot(line));
    // Only the tutorial identifies destinations with extra PUTAWAY signs.
    for (const slot of this.spec.tutorial ? this.slots : []) {
      const label = labelPlane(`PUTAWAY · ${slot.line.location} · SKU ${slot.line.sku}`, 2.3, .2, { bg: '#f5c518', fg: '#16171a' });
      label.position.set((slot.x0 + slot.x1) / 2, slot.y - .28, slot.spec.face === 'south' ? slot.spec.z1 + .03 : slot.spec.z0 - .03);
      label.rotation.y = slot.spec.face === 'south' ? 0 : Math.PI;
      game.scene.add(label); this.putawaySigns.push(label);
    }
  }

  get boxes() { return this.game.entities.filter(e => e.kind === 'box' && e.incomingId?.startsWith(`${this.spec.id}:`)); }
  get pallets() { return this.game.entities.filter(e => e.incomingPalletIds?.some(id => id.startsWith(`${this.spec.id}:`)) || (e.kind === 'wrapped' && e.contents.some(r => r.data.incomingId?.startsWith(`${this.spec.id}:`)))); }

  makeSlot(line) {
    const [name, bayText, shelfText] = line.location.split('-');
    const spec = LAYOUT.racks.find((r) => r.name === name);
    const shelf = Number(shelfText) - 1, bay = Number(bayText) - 1;
    return { line, spec, rack: this.game.level.racks.find((r) => r.name === name),
      x0: spec.x0 + bay * LAYOUT.racking.bayW, x1: spec.x0 + (bay + 1) * LAYOUT.racking.bayW,
      z0: spec.z0, z1: spec.z1, y: spec.base + spec.shelves[shelf],
      ceiling: spec.base + (spec.shelves[shelf + 1] ?? spec.shelves[shelf] + 1.5) };
  }

  correctlyPlaced(box, slot, supported) {
    if (!box.incomingId?.startsWith(`${this.spec.id}:`) || box.removed || box.carried || box.armed || !supported.has(box)) return false;
    const rack = slot.rack, rq = new THREE.Quaternion().copy(rack.body.rotation());
    if (new THREE.Vector3(0, 1, 0).applyQuaternion(rq).y < .95) return false;
    if (new THREE.Vector3().copy(rack.body.translation()).distanceTo(new THREE.Vector3().copy(rack.home)) > .4) return false;
    const v = box.body.linvel(), a = box.body.angvel();
    if (Math.hypot(v.x, v.y, v.z) > .2 || Math.hypot(a.x, a.y, a.z) > .4) return false;
    // Test all corners in the rack's original frame, allowing any box orientation.
    const min = new THREE.Vector3(Infinity, Infinity, Infinity), max = min.clone().negate();
    const rotation = new THREE.Quaternion().copy(box.body.rotation()), inverse = rq.invert();
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const point = new THREE.Vector3(sx * box.size[0] / 2, sy * box.size[1] / 2, sz * box.size[2] / 2)
        .applyQuaternion(rotation).add(box.body.translation()).sub(rack.body.translation()).applyQuaternion(inverse).add(rack.home);
      min.min(point); max.max(point);
    }
    return fitsReceivingSlot(min, max, slot);
  }

  palletsReturned() {
    const { x, z, half } = this.returns;
    return this.pallets.every((pallet) => {
      if (pallet.removed || pallet.kind !== 'pallet' || collectStack(this.game, pallet).size > 1) return false;
      const p = pallet.body.translation(), v = pallet.body.linvel();
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion().copy(pallet.body.rotation()));
      return Math.abs(p.x - x) < half - .7 && Math.abs(p.z - z) < half - .7
        && Math.abs(p.y - LAYOUT.lower.y) < .12 && up.y > .9 && Math.hypot(v.x, v.y, v.z) < .15;
    });
  }

  parkingReason() {
    const f = this.game.forklift, home = this.game.level.forkliftSpawn;
    if (f.tipped) return 'Ralph needs to reset the tipped forklift from his seat.';
    const p = f.body.translation(), rotation = new THREE.Quaternion().copy(f.body.rotation());
    const bay = parkingRect();
    // Accept the visible parking area, rather than an invisible radius around the spawn.
    // Check the chassis footprint; the lowered fork tips can extend beyond the open bay end.
    for (const x of [-.65, .65]) for (const z of [-1.3, 1]) {
      const corner = new THREE.Vector3(x, 0, z).applyQuaternion(rotation).add(p);
      if (corner.x < bay.x0 - .08 || corner.x > bay.x1 + .08 || corner.z < bay.z0 - .08 || corner.z > bay.z1 + .08) {
        return 'Move the whole forklift chassis inside the yellow parking lines.';
      }
    }
    if (Math.abs(p.y - LAYOUT.lower.y) > .35) return 'Set the forklift on the lower-level parking floor.';
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(rotation);
    if (forward.dot(new THREE.Vector3(Math.sin(home.yaw), 0, Math.cos(home.yaw))) < Math.cos(Math.PI / 6)) {
      return 'Turn the forklift to face east, the same direction as at the start.';
    }
    if (f.height >= .3) return 'Lower the forks fully.';
    const velocity = f.body.linvel(), spin = f.body.angvel();
    if (Math.hypot(velocity.x, velocity.y, velocity.z) >= .2 || Math.hypot(spin.x, spin.y, spin.z) >= .2) {
      return 'Release the driving controls and come to a complete stop.';
    }
    return null;
  }

  parked() {
    return this.parkingReason() === null;
  }

  palletAtSlot(load, slot, supported) {
    if (!supported.has(load)) return false;
    if (slot.line.freight) {
      if (load.kind !== 'freight' || load.sku !== slot.line.sku || load.receivingLine !== slot.line.line || !load.incomingId?.startsWith(`${this.spec.id}:`)) return false;
    } else {
      if (load.kind !== 'wrapped' || load.contents.filter(r => r.kind === 'pallet').length !== 1) return false;
      const records = load.contents.filter(r => r.kind === 'box');
      if (records.length !== slot.line.qty || records.some(r => r.data.receivingLine !== slot.line.line || r.data.sku !== slot.line.sku || !r.data.incomingId?.startsWith(`${this.spec.id}:`))) return false;
      if (new Set(records.map(r => r.data.incomingId)).size !== slot.line.qty) return false;
    }
    const storage = this.game.level.storage.slots.find(s => s.location === slot.line.location);
    if (!storage || !palletFitsSlot(load, storage)) return false;
    const rq = new THREE.Quaternion().copy(slot.rack.body.rotation());
    if (new THREE.Vector3(0, 1, 0).applyQuaternion(rq).y < .95 || new THREE.Vector3().copy(slot.rack.body.translation()).distanceTo(new THREE.Vector3().copy(slot.rack.home)) > .4) return false;
    const min = new THREE.Vector3(Infinity, Infinity, Infinity), max = min.clone().negate();
    const inverse = rq.clone().invert(), rotation = new THREE.Quaternion().copy(load.body.rotation());
    for (const x of [load.bounds.min.x, load.bounds.max.x]) for (const y of [load.bounds.min.y, load.bounds.max.y]) for (const z of [load.bounds.min.z, load.bounds.max.z]) {
      const point = new THREE.Vector3(x, y, z).applyQuaternion(rotation).add(load.body.translation()).sub(slot.rack.body.translation()).applyQuaternion(inverse).add(slot.rack.home);
      min.min(point); max.max(point);
    }
    if (!fitsReceivingSlot(min, max, slot)) return false;
    const v = load.body.linvel(), a = load.body.angvel();
    if (Math.hypot(v.x, v.y, v.z) > .2 || Math.hypot(a.x, a.y, a.z) > .4) return false;
    return true;
  }

  step(dt) {
    if (this.game.complete) return;
    this.scanIn -= dt; if (this.scanIn > 0) return;
    const elapsed = .15; this.scanIn = elapsed;
    const g = this.game;
    for (const ent of [...this.boxes, ...this.pallets]) {
      if (ent.carried || ent.body.translation().y >= -5 || !ent.home) continue;
      ent.body.setTranslation(ent.home.pos, true); ent.body.setRotation(ent.home.rot, true);
      ent.body.setLinvel({ x: 0, y: 0, z: 0 }, true); ent.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    for (const slot of this.slots) {
      const supported = collectStack(g, slot.rack);
      let count = 0;
      const candidates = slot.line.pallet ? this.pallets : this.boxes.filter(b => b.receivingLine === slot.line.line);
      for (const ent of candidates) {
        const stable = slot.line.pallet ? this.palletAtSlot(ent, slot, supported) : this.correctlyPlaced(ent, slot, supported);
        const key = `${slot.line.line}:${ent.body.handle}`;
        const time = stable ? (this.timers.get(key) || 0) + elapsed : 0;
        this.timers.set(key, time);
        if (time >= .75) count += slot.line.pallet ? slot.line.qty : 1;
      }
      count = Math.min(count, slot.line.qty);
      if (count > (g.itemStatus[slot.line.line] || 0)) g.toast(`${slot.line.location}: ${count}/${slot.line.qty} put away`, 2);
      g.itemStatus[slot.line.line] = count;
    }
    const stocked = g.level.order.every(line => g.itemStatus[line.line] >= line.qty);
    const unloaded = this.pallets.every(p => !g.level.dockZone.contains(p.body.translation()));
    const needsCut = this.pallets.some(p => p.kind === 'wrapped' && p.contents.some(r => r.data.receivingLine && !g.level.order.find(l => l.line === r.data.receivingLine)?.pallet));
    this.stage = stocked ? 4 : !unloaded ? (this.read ? 1 : 0) : needsCut ? 2 : 3;
    this.finishTime = stocked ? this.finishTime + elapsed : 0;
    if (this.finishTime >= 1) g.finishOrder(null);
  }

  update(dt) {
    if (!this.spec.tutorial) return;
    const g = this.game;
    if (!this.read) {
      const point = g.forklift.clipboard.group.getWorldPosition(new THREE.Vector3());
      const cameras = g.mode === 'single' ? [g.active === 'driver' ? g.forklift.camera : g.climber.camera] : [g.forklift.camera, g.climber.camera];
      const looking = cameras.some(camera => {
        const delta = point.clone().sub(camera.getWorldPosition(new THREE.Vector3()));
        return delta.length() < 3 && delta.normalize().dot(camera.getWorldDirection(new THREE.Vector3())) > .94;
      });
      this.readTime = looking ? this.readTime + dt : 0;
      if (this.readTime > .7 || this.boxes.some(b => b.carried)) this.read = true;
    }
    let target;
    if (this.stage < 2) target = this.pallets.find(p => g.level.dockZone.contains(p.body.translation()))?.body.translation();
    else if (this.stage === 2) target = this.pallets.find(p => p.kind === 'wrapped')?.body.translation();
    else {
      const carrying = g.climber.carriedBoxes().find(b => b.incomingId);
      const slot = this.slots.find(s => s.line.line === carrying?.receivingLine) || this.slots.find(s => g.itemStatus[s.line.line] < s.line.qty);
      if (slot) target = { x: (slot.x0 + slot.x1) / 2, y: slot.y + .4, z: (slot.z0 + slot.z1) / 2 };
    }
    this.marker.visible = !!target && !g.complete;
    if (target) this.marker.position.set(target.x, target.y + .65 + Math.sin(g.clock * 4) * .08, target.z);
  }

  content(role) {
    const g = this.game;
    if (!this.spec.tutorial || g.complete) return null;
    const button = (action, who = role) => `<kbd>${g.keyHint(who, action)}</kbd>`;
    const swap = who => g.mode === 'single' && role !== who ? `Switch to ${who === 'driver' ? 'Ralph' : 'Dave'} with ${button('swap')}. ` : '';
    const list = g.level.order.map(line => `${g.itemStatus[line.line] || 0}/${line.qty} × SKU ${line.sku} → ${line.location}`).join(' · ');
    const details = [
      `Read ${this.spec.number} on the forklift clipboard: ${list}. The wrapped incoming pallets are in ${this.spec.dock}. Look at the clipboard briefly, or begin unloading.`,
      `${swap('driver')}Drive into ${this.spec.dock} with forks low. Slide into the pallet pockets, raise with ${button('lift', 'driver')}, then reverse out. Bring both pallets up the ramp. Wrap keeps the cartons together.`,
      `${swap('climber')}Dave: empty your hands, stand close to a pallet and hold ${button('interact', 'climber')} for one second to cut its shrinkwrap. You can cut while Ralph holds the pallet on his forks.`,
      `${swap('climber')}Take cartons with ${button('interact', 'climber')} and tap again to place them at the labelled locations. Wrong locations stay incomplete. ${list}. Cleanup and parking are optional.`,
      'All stock is put away. Cleanup and parking are optional.',
    ];
    return { title: `${this.spec.number} · ${['Read the purchase order', 'Unload the truck', 'Cut the shrinkwrap', 'Put away the stock', 'Stock received'][this.stage]}`, detail: details[this.stage] };
  }
}
