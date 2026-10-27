import * as THREE from 'three';
import { LAYOUT } from './layout.js';
import { CONFIG } from '../config.js';
import { quatToThree } from '../physics.js';
import { createFreight } from '../entities/freight.js';
import { createPallet } from '../entities/pallet.js';
import { createBox } from '../entities/box.js';
import { buildWrapped } from '../systems/wrapping.js';

// Slots are in the rack body's local frame, so guides and seating checks follow a tipped rack.
export function palletSlotIssue(pallet, slot) {
  if (pallet.removed || pallet.carried || !['pallet', 'wrapped', 'freight'].includes(pallet.kind)) return 'Use an upright pallet or strapped crate';
  const rotation = quatToThree(slot.rack.body.rotation());
  const local = new THREE.Vector3().copy(pallet.body.translation()).sub(slot.rack.body.translation()).applyQuaternion(rotation.clone().invert());
  const relative = rotation.clone().invert().multiply(quatToThree(pallet.body.rotation()));
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(relative);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(relative);
  // Either fork-entry direction is valid; rotated sideways or leaning is not seated.
  const [w, , d] = CONFIG.objects.pallet.size;
  const halfX = Math.abs(right.x) * w / 2 + Math.abs(new THREE.Vector3(0, 0, 1).applyQuaternion(relative).x) * d / 2;
  const halfZ = Math.abs(right.z) * w / 2 + Math.abs(new THREE.Vector3(0, 0, 1).applyQuaternion(relative).z) * d / 2;
  if (up.y <= .985) return 'Level the pallet before seating it';
  if (Math.abs(right.z) >= .12) return 'Straighten the pallet with the rack';
  if (Math.abs(local.x - slot.x) + halfX >= slot.bayW / 2 - .08) return 'Center the pallet between the uprights';
  if (Math.abs(local.z) + halfZ >= slot.depth / 2 - .015) return 'Move the whole pallet inside the shelf outline';
  if (Math.abs(local.y - slot.y) >= .065) return local.y > slot.y ? 'Lower the pallet onto the deck' : 'Raise the pallet to deck height';
  return null;
}

export function palletFitsSlot(pallet, slot) { return palletSlotIssue(pallet, slot) === null; }

export class PalletStorage {
  constructor(game) { this.game = game; this.slots = []; this.timer = 0; this.forkSupport = new WeakMap(); }

  stock(rack, spec, bay, shelf, spots, location, { reservedSku, freight, empty = false } = {}) {
    const bayW = LAYOUT.racking.bayW;
    const x = spec.x0 + (bay + .5) * bayW;
    const z = (spec.z0 + spec.z1) / 2, y = spec.base + spec.shelves[shelf];
    const pos = [x, y + .005, z];
    const pallet = empty ? null : freight ? createFreight(this.game, { ...freight, pos }) : spots.length ? createPallet(this.game, { pos }) : null;
    if (pallet) {
      pallet.storageLocation = location;
      pallet.home = { pos: { ...pallet.body.translation() }, rot: { ...pallet.body.rotation() } };
    }
    const load = new Set(pallet ? [pallet] : []);
    const slot = { rack, location, kind: freight ? 'freight' : 'wrapped', sku: reservedSku ?? freight?.sku ?? spots.find(Boolean)?.[0], x: x - rack.home.x, y: spec.shelves[shelf], bayW, depth: spec.z1 - spec.z0, pallet: null, seated: false };
    // A painted receiving outline on the deck: yellow when empty, green once resting on the rack.
    const guide = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xf5c518, side: THREE.DoubleSide });
    for (const [sx, sz, w, d] of [[-.59, 0, .035, 1.3], [.59, 0, .035, 1.3], [0, -.65, 1.18, .035], [0, .65, 1.18, .035]]) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
      line.rotation.x = -Math.PI / 2; line.position.set(sx, .008, sz); guide.add(line);
    }
    guide.position.set(slot.x, slot.y, 0); rack.mesh.add(guide); slot.material = mat;
    // Six cartons in a single 2-by-3 layer: inside the pallet edges, with ample lift clearance.
    (empty || freight ? [] : spots).filter(Boolean).forEach(([sku, , type], i) => {
      const box = createBox(this.game, { type, sku, pos: [x + (i % 2 ? .2 : -.2), y + .16, z + (Math.floor(i / 2) - 1) * .4] });
      box.storagePallet = pallet;
      box.storageOffset = new THREE.Vector3().copy(box.body.translation()).sub(pallet.body.translation());
      box.home = { rack: spec.name, pos: { ...box.body.translation() }, rot: { ...box.body.rotation() } };
      rack.stock.push(box); load.add(box);
    });
    if (pallet && !freight) buildWrapped(this.game, pallet, load);
    this.slots.push(slot);
  }

  step(dt) {
    this.timer -= dt; if (this.timer > 0) return; this.timer = .15;
    const pallets = this.game.entities.filter(e => ['pallet', 'wrapped', 'freight'].includes(e.kind) && !e.removed);
    for (const slot of this.slots) {
      slot.pallet = pallets.find(p => palletFitsSlot(p, slot)) || null;
      let contact = false;
      if (slot.pallet) for (let i = 0; i < slot.pallet.body.numColliders(); i++) {
        this.game.world.contactPairsWith(slot.pallet.body.collider(i), other => {
          if (other.parent()?.handle === slot.rack.body.handle) contact = true;
        });
      }
      slot.seated = contact;
      slot.material.color.setHex(contact ? 0x31d07a : 0xf5c518);
    }
  }

  pickupHint(forklift) {
    if (forklift.tipped) return '';
    const origin = forklift.carriage.translation(), inverse = quatToThree(forklift.body.rotation()).invert();
    const candidates = this.game.entities.filter(e => !e.removed && ['pallet', 'wrapped', 'freight'].includes(e.kind))
      .map(e => ({ e, local: new THREE.Vector3().copy(e.body.translation()).sub(origin).applyQuaternion(inverse) }))
      .filter(({ local }) => Math.abs(local.x) < .8 && local.z > .1 && local.z < 2.5 && Math.abs(local.y) < .5)
      .sort((a, b) => a.local.lengthSq() - b.local.lengthSq());
    const target = candidates[0];
    if (!target) return '';
    const { e, local } = target;
    // Contact flickers as a carried load bounces. Keep entry prompts suppressed across brief
    // gaps, but forget the support as soon as the load leaves the blade footprint.
    const overBlades = Math.abs(local.x) < .55 && local.z < 1.35 && local.y > -.22 && local.y < .03;
    let contact = false;
    if (overBlades) for (let i = 0; i < e.body.numColliders(); i++) {
      this.game.world.contactPairsWith(e.body.collider(i), other => {
        if (other.parent()?.handle === forklift.carriage.handle) contact = true;
      });
    }
    if (contact) this.forkSupport.set(e, this.game.clock);
    if (overBlades && this.game.clock - (this.forkSupport.get(e) ?? -Infinity) < .4) return '';
    if (!overBlades) this.forkSupport.delete(e);
    const relative = inverse.clone().multiply(quatToThree(e.body.rotation()));
    if (new THREE.Vector3(0, 1, 0).applyQuaternion(relative).y < .95) return 'Pallet tipped · Dave can flip it upright';
    if (Math.abs(new THREE.Vector3(1, 0, 0).applyQuaternion(relative).z) > .15) return 'Approach the open fork pockets squarely';
    if (Math.abs(local.x) > .12) return 'Center both fork blades with the pallet pockets';
    const forkHeight = -local.y;
    if (forkHeight < .045) return 'Raise forks slightly to enter the pallet pockets';
    if (forkHeight > .115) return 'Lower forks to enter the pallet pockets';
    return local.z > .85 ? 'Fork height aligned · ease forward into both pockets' : 'Forks inserted · lift clear before reversing';
  }

  hint(forklift) {
    const p = forklift.carriage.translation();
    const targets = this.slots.map(slot => ({ slot, target: new THREE.Vector3(slot.x, slot.y, 0)
      .applyQuaternion(quatToThree(slot.rack.body.rotation())).add(slot.rack.body.translation()) }))
      .filter(({ target }) => Math.abs(target.y - p.y) < .8 && Math.hypot(target.x - p.x, target.z - p.z) < 3.2)
      .sort((a, b) => a.target.distanceToSquared(p) - b.target.distanceToSquared(p));
    const near = targets[0]?.slot;
    if (!near) return '';
    if (near.seated) return `${near.location} · ${near.pallet.kind === 'freight' ? 'crate' : 'pallet'} seated · lower forks to leave it, or lift to retrieve`;
    const load = this.game.entities.filter(e => !e.removed && ['pallet', 'wrapped', 'freight'].includes(e.kind))
      .map(e => ({ e, distance: new THREE.Vector3().copy(e.body.translation()).distanceTo(p) }))
      .filter(e => e.distance < 1.8).sort((a, b) => a.distance - b.distance)[0]?.e;
    return `${near.location} · ${load ? palletSlotIssue(load, near) || 'Lower onto the deck, then withdraw the forks' : 'Align forks with the pallet pockets; lift clear before reversing'}`;
  }
}
