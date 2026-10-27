import * as THREE from 'three';
import { collectStack } from './wrapping.js';

export const packageValue = sku => 50 + (Math.abs(Number(sku) || 0) % 9) * 25;

// One charge per physical item across wrapping, unwrapping and rack resets.
export class DamageLedger {
  constructor(game) { this.game = game; this.total = 0; this.nextId = 1; this.charged = new Set(); this.entries = []; this.tracking = new Map(); this.inventory = new Map(); this.timer = 0; }
  identify(item) { item.damageId ??= `package:${this.nextId++}`; return item.damageId; }
  charge(id, amount, reason) {
    if (this.charged.has(id)) return 0;
    this.charged.add(id); this.total += amount;
    this.entries.push({ id, amount, reason });
    return amount;
  }
  package(item, reason) { return this.charge(this.identify(item), packageValue(item.sku), reason); }
  rack(rack) {
    let added = 0;
    for (const item of this.inventory.get(rack.name) || []) added += this.package(item, `Rack ${rack.name} knocked over`);
    return added;
  }
  step(dt, force = false) {
    this.timer -= dt; if (!force && this.timer > 0) return; this.timer = .1;
    const game = this.game, items = [], safe = new Set();
    // Loads on the forks can be deliberately lowered without counting as dropped stock.
    for (const ent of game.entities) {
      if (!['box', 'pallet', 'wrapped', 'freight'].includes(ent.kind)) continue;
      let onForks = false;
      for (let i = 0; i < ent.body.numColliders(); i++) game.world.contactPairsWith(ent.body.collider(i), other => { if (game.forklift.ownsCollider(other)) onForks = true; });
      if (onForks) for (const supported of collectStack(game, ent)) safe.add(supported);
    }
    for (const ent of game.entities) {
      if (ent.removed) continue;
      const p = ent.body.translation();
      if (ent.kind === 'box' || ent.kind === 'freight') items.push({ item: ent, p, safe: !!ent.carried || safe.has(ent) });
      if (ent.kind === 'wrapped') {
        const q = ent.body.rotation();
        for (const record of ent.contents) if (record.kind === 'box') {
          const point = new THREE.Vector3(...record.pos).applyQuaternion(q).add(p);
          items.push({ item: record.data, p: point, safe: safe.has(ent) });
        }
      }
    }
    const inventories = new Map(game.level.racks.filter(r => !r.fallen && new THREE.Vector3(0, 1, 0).applyQuaternion(r.body.rotation()).y > .995).map(r => [r.name, []]));
    for (const { item, p, safe: controlled } of items) {
      const id = this.identify(item), old = this.tracking.get(id);
      // A metre of uncontrolled vertical fall from shelf-2 height or higher damages a package.
      if (old && !controlled && old.highY >= 2.5 && p.y < old.highY - 1) this.package(item, 'Package dropped from height');
      const highY = controlled ? p.y : Math.max(p.y, old?.highY ?? p.y);
      this.tracking.set(id, { highY });
      for (const rack of game.level.racks) {
        if (!inventories.has(rack.name) || controlled) continue;
        const local = new THREE.Vector3(p.x, p.y, p.z).sub(rack.body.translation()).applyQuaternion(new THREE.Quaternion().copy(rack.body.rotation()).invert());
        if (Math.abs(local.x) < (rack.x1 - rack.x0) / 2 && Math.abs(local.z) < (rack.z1 - rack.z0) / 2 + .1 && local.y > .5 && local.y < rack.uprightH + 1) inventories.get(rack.name).push(item);
      }
    }
    for (const [name, inventory] of inventories) this.inventory.set(name, inventory);
  }
}
