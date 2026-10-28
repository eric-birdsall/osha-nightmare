import * as THREE from 'three';
import { LAYOUT } from '../world/layout.js';
import { createBox, boxLook } from '../entities/box.js';
import { Receiving } from './receiving.js';

export const timedOptions = options => ({
  minutes: Math.max(1, Math.min(120, Math.round(Number(options?.minutes) || 10))),
  difficulty: ['easy', 'standard', 'hard'].includes(options?.difficulty) ? options.difficulty : 'standard',
});

// Generate from the live warehouse, including stock that was received earlier this shift.
export class TimedShift {
  constructor(game, options) {
    this.game = game; this.options = timedOptions(options); this.duration = this.options.minutes * 60;
    this.counts = { shipping: 0, receiving: 0 }; this.serial = { shipping: 0, receiving: 0 };
    this.earnings = 0; this.fees = 0; this.penalty = 0; this.history = []; this.receipts = [];
  }
  get remaining() { return Math.max(0, this.duration - this.game.time - this.game.falls * 15 - this.penalty); }
  get net() { return this.earnings - this.game.damage.total - this.fees; }
  get tier() {
    const base = { easy: 0, standard: 1, hard: 2 }[this.options.difficulty];
    return Math.min(3, base + Math.floor((this.counts.shipping + this.counts.receiving) / 4));
  }
  slots(includeKnocked = false) {
    const g = this.game, slots = [];
    const stock = g.entities.filter(e => ['box', 'wrapped', 'freight', 'pallet'].includes(e.kind));
    for (const rack of LAYOUT.racks) {
      const body = g.level.racks.find(r => r.name === rack.name);
      if (!includeKnocked && g.rackKnocked(body)) continue;
      for (let bay = 0; bay < rack.bays; bay++) for (let shelf = 0; shelf < rack.shelves.length; shelf++) {
        const x0 = rack.x0 + bay * LAYOUT.racking.bayW, y = rack.base + rack.shelves[shelf];
        const ceiling = rack.base + (rack.shelves[shelf + 1] ?? rack.shelves[shelf] + 1.5);
        const items = stock.filter(e => { const p = e.body.translation(); return p.x > x0 && p.x < x0 + LAYOUT.racking.bayW && p.z > rack.z0 - .05 && p.z < rack.z1 + .05 && p.y > y - .1 && p.y < ceiling - .1; });
        slots.push({ location: `${rack.name}-${bay + 1}-${shelf + 1}`, rack, shelf, y, ceiling, x0, items,
          pallet: !!g.level.storage.slots.find(s => s.location === `${rack.name}-${bay + 1}-${shelf + 1}`) });
      }
    }
    return slots;
  }
  shipping() {
    const g = this.game, groups = new Map(), slots = this.slots();
    const add = (item, p, freight = false) => {
      if (item.incomingId && !g.receivedIds.has(item.incomingId)) return;
      if (p.y < -2 || Math.abs(p.x) > LAYOUT.room.halfX || Math.abs(p.z) > LAYOUT.room.halfZ) return;
      const slot = slots.find(s => p.x > s.x0 && p.x < s.x0 + 2.7 && p.z > s.rack.z0 - .1 && p.z < s.rack.z1 + .1 && p.y > s.y - .1 && p.y < s.ceiling);
      const location = slot?.location || 'A-6-1', key = `${location}:${item.sku}:${freight}`;
      const line = groups.get(key) || { sku: item.sku, qty: 0, location, freight, floorStock: !slot, type: item.type, height: slot?.y || 0 };
      line.qty++; groups.set(key, line);
    };
    for (const e of g.entities) {
      if (e.kind === 'box' || e.kind === 'freight') add(e, e.body.translation(), e.kind === 'freight');
      if (e.kind === 'wrapped') for (const r of e.contents) if (r.kind === 'box') {
        const p = new THREE.Vector3(...r.pos).applyQuaternion(e.body.rotation()).add(e.body.translation()); add(r.data, p);
      }
    }
    let choices = [...groups.values()].filter(l => this.tier >= 2 || (!l.freight && l.height < (this.tier ? 5 : 2)));
    if (!choices.length) choices = [...groups.values()];
    if (!choices.length) {
      // Supplier stock is a paid last resort if accidents exhaust all available stock.
      createBox(g, { sku: 355, type: 'small', pos: [6, .02, -5] }); this.fees += 75;
      choices = [{ sku: 355, qty: 1, location: 'A-6-1', floorStock: true, height: 0 }];
      g.toast('Emergency stock supplied beside OUTBOUND PREP · $75 fee', 4);
    }
    const count = Math.min(this.tier >= 2 ? 2 : 1, choices.length), lines = [];
    // Prefer a freight/high/fragile job periodically, but only when such stock exists.
    choices.sort((a, b) => (this.tier >= 2 ? Number(b.freight) + b.height / 10 + Number(boxLook(g.skus.look(b.sku)).fragile) : -b.qty) -
      (this.tier >= 2 ? Number(a.freight) + a.height / 10 + Number(boxLook(g.skus.look(a.sku)).fragile) : -a.qty));
    const offset = this.serial.shipping % Math.max(1, Math.min(choices.length, 12));
    for (let n = 0; n < choices.length && lines.length < count; n++) {
      const line = choices[(n + offset) % choices.length];
      if (lines.some(l => l.sku === line.sku)) continue;
      lines.push({ ...line, qty: line.freight ? 1 : Math.min(line.qty, this.tier >= 2 ? 3 : 2) });
    }
    return { id: ++this.serial.shipping, title: 'Timed shipment', dock: 'Dock 3', lines };
  }
  receiving() {
    const g = this.game, outbound = new Set(g.level.order.flatMap(l => [l.location, l.backstock]));
    const slots = this.slots().filter(s => !outbound.has(s.location));
    let choices = slots.filter(s => !s.items.length && (this.tier >= 2 || (!s.pallet && s.y < (this.tier ? 5 : 2))));
    if (this.tier >= 2 && this.serial.receiving % 2 === 1) {
      const high = choices.filter(s => s.pallet && s.y >= 4.8); if (high.length) choices = high;
    }
    if (!choices.length) choices = slots.filter(s => !s.items.length);
    // At full occupancy assign the least crowded low bay. Players may clear it to the floor;
    // stock is never deleted to manufacture storage space.
    if (!choices.length) choices = slots.filter(s => !s.pallet).sort((a, b) => a.items.length - b.items.length || a.y - b.y).slice(0, 1);
    if (!choices.length) choices = this.slots(true).filter(s => !s.pallet).slice(0, 1);
    const slot = choices[this.serial.receiving % choices.length];
    const heavy = slot.pallet && this.tier >= 2;
    const freight = heavy && this.serial.receiving % 4 === 3;
    const sku = slot.items.find(e => e.sku)?.sku || [355, 584, 874, 822, 754][this.serial.receiving % 5];
    const line = { sku: freight ? 1100 + this.serial.receiving : sku, qty: heavy && !freight ? 4 : freight ? 1 : 2,
      location: slot.location, type: freight ? 'freight' : 'small', pallet: heavy, freight,
      ...(freight ? { mass: 350, height: 1.05 } : {}), clearFirst: slot.items.length > 0, resetRack: g.rackKnocked(g.level.racks.find(r => r.name === slot.rack.name)) };
    const serial = ++this.serial.receiving;
    return { id: `timed-receiving-${serial}`, activity: 'receiving', number: `PO-T${String(serial).padStart(3, '0')}`,
      title: 'Timed receipt', dock: 'Dock 2', lines: [line], pallets: [[['A', line.qty]]] };
  }
  payout(job) {
    const lines = job === 'shipping' ? this.game.level.order : this.game.receivingSystem.order;
    return 80 + lines.reduce((sum, l) => sum + l.qty * (l.freight ? 180 : 35) + (Number(l.location.split('-')[2]) - 1) * 20, 0);
  }
  archive(job) {
    const g = this.game, view = g.taskView(job), key = `complete-${job}-${this.serial[job]}`;
    this.history.push({ key, job, order: structuredClone(view.level.order), dock: view.level.dock, orderId: view.orderId,
      receivingSpec: structuredClone(g.receivingSpec), status: { ...view.itemStatus } });
    g.jobDone[key] = true;
    if (this.history.length > 10) {
      const old = this.history.shift(); delete g.jobDone[old.key];
      for (const role of ['driver', 'climber']) if (g.trackedJobs[role] === old.key) g.trackedJobs[role] = job;
    }
  }
  replace(job) {
    const g = this.game;
    if (job === 'shipping') {
      const spec = this.shipping(); g.jobSpecs.shipping = spec; g.orderId = spec.id; g.level.setOrder(spec);
      g.itemStatus = Object.fromEntries(g.level.order.map(l => [l.line, 0])); g.dockRest.clear(); g.deliveredLoads.clear();
    } else {
      const previous = g.receivingSystem;
      // The old truck departs with anything left inside it, including empty pallets.
      for (const e of [...g.entities]) if (!e.removed && ['box', 'pallet', 'wrapped', 'freight'].includes(e.kind) && previous.dockZone.contains(e.body.translation())) g.shipLoad(e);
      g.receivingSpec = this.receiving(); g.jobSpecs.receiving = g.receivingSpec;
      g.receivingStatus = {}; g.receivingSystem = new Receiving(g); g.receivingSystem.read = true;
    }
    g.jobDone[job] = false; g.forklift.clipboard.key = null;
  }
  finish(job) {
    if (this.remaining <= 0) { this.end(); return; }
    const pay = this.payout(job); this.earnings += pay; this.counts[job]++;
    this.receipts.push({ job, pay, at: this.game.time }); this.archive(job);
    const other = job === 'shipping' ? 'receiving' : 'shipping';
    for (const role of ['driver', 'climber']) if (this.game.trackedJobs[role] === job) this.game.trackedJobs[role] = other;
    this.replace(job); this.game.toast(`${job === 'shipping' ? 'Shipped' : 'Received'} · +$${pay} · Next job ready`, 4);
  }
  abandon(job) {
    if (this.game.complete || this.remaining <= 0) return;
    this.fees += 100; this.penalty += 15;
    if (job === 'receiving') {
      // Abandoned stock left in the warehouse becomes ordinary stock, not an impossible PO.
      for (const e of this.game.entities) {
        const records = e.kind === 'wrapped' ? e.contents.map(r => r.data) : [e];
        for (const data of records) if (data.incomingId?.startsWith(this.game.receivingSpec.id + ':')) this.game.receivedIds.add(data.incomingId);
      }
    }
    if (this.remaining <= 0) this.end(); else this.replace(job);
    this.game.toast('Job replaced · $100 fee and 15 seconds lost', 4);
  }
  end() {
    if (this.game.complete) return;
    this.game.complete = true; this.game.onComplete?.({ time: this.game.time, falls: this.game.falls });
  }
}
