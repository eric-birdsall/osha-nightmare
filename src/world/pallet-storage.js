import * as THREE from 'three';
import { LAYOUT } from './layout.js';
import { CONFIG } from '../config.js';
import { quatToThree } from '../physics.js';
import { createFreight } from '../entities/freight.js';
import { createPallet } from '../entities/pallet.js';
import { createBox } from '../entities/box.js';
import { buildWrapped } from '../systems/wrapping.js';

// Slots are in the rack body's local frame, so guides and seating checks follow a tipped rack.
export function palletFitsSlot(pallet, slot) {
  if (pallet.removed || pallet.carried || !['pallet', 'wrapped', 'freight'].includes(pallet.kind)) return false;
  const rotation = quatToThree(slot.rack.body.rotation());
  const local = new THREE.Vector3().copy(pallet.body.translation()).sub(slot.rack.body.translation()).applyQuaternion(rotation.clone().invert());
  const relative = rotation.clone().invert().multiply(quatToThree(pallet.body.rotation()));
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(relative);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(relative);
  // Either fork-entry direction is valid; rotated sideways or leaning is not seated.
  const [w, , d] = CONFIG.objects.pallet.size;
  const halfX = Math.abs(right.x) * w / 2 + Math.abs(new THREE.Vector3(0, 0, 1).applyQuaternion(relative).x) * d / 2;
  const halfZ = Math.abs(right.z) * w / 2 + Math.abs(new THREE.Vector3(0, 0, 1).applyQuaternion(relative).z) * d / 2;
  return up.y > .985 && Math.abs(right.z) < .12 &&
    Math.abs(local.x - slot.x) + halfX < slot.bayW / 2 - .08 &&
    Math.abs(local.z) + halfZ < slot.depth / 2 - .015 && Math.abs(local.y - slot.y) < .065;
}

export class PalletStorage {
  constructor(game) { this.game = game; this.slots = []; this.timer = 0; }

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

  hint(forklift) {
    const p = forklift.carriage.translation();
    const near = this.slots.find(s => {
      const target = new THREE.Vector3(s.x, s.y, 0).applyQuaternion(quatToThree(s.rack.body.rotation())).add(s.rack.body.translation());
      return Math.abs(target.y - p.y) < .8 && Math.hypot(target.x - p.x, target.z - p.z) < 3.2;
    });
    return near ? near.seated ? `${near.location} · ${near.pallet.kind === 'freight' ? 'crate' : 'pallet'} seated · lower forks to leave it, or lift to retrieve` : `${near.location} · align pallet inside the yellow outline, lower onto the deck` : '';
  }
}
