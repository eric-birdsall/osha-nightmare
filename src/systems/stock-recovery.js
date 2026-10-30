import * as THREE from 'three';
import { createBox } from '../entities/box.js';
import { createPallet } from '../entities/pallet.js';
import { createFreight } from '../entities/freight.js';
import { packPallet } from '../world/pallet-packing.js';
import { buildWrapped, cutWrapped, collectStack } from './wrapping.js';
import { packageValue } from './damage.js';
import { labelPlane } from '../util/meshes.js';

const CELLS = [ -12, -14, -16 ].flatMap(z => [5.5, 7.2, 8.9].map(x => [x, .005, z]));

// Recovery replaces physical stock, never credits an order or resets warehouse damage.
export class StockRecovery {
  constructor(game) {
    this.game = game; this.cost = 0; this.penalty = 0; this.serial = 0; this.entries = [];
    this.free = game.jobSpecs.shipping.id === 1;
    const label = labelPlane('REPLACEMENT STOCK', 3.8, .45, { bg: 'rgba(0,0,0,0)', fg: '#f5c518', transparent: true });
    label.rotation.x = -Math.PI / 2; label.position.set(7.2, .013, -10.8); game.scene.add(label);
    for (const [w, d, x, z] of [[5, .06, 7.2, -10.5], [5, .06, 7.2, -17], [.06, 6.5, 4.7, -13.75], [.06, 6.5, 9.7, -13.75]]) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color: 0xf5c518 }));
      mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, .012, z); game.scene.add(mesh);
    }
  }
  quote(job) {
    const g = this.game;
    if (g.complete || g.timed || !['shipping', 'receiving'].includes(job) || g.jobDone[job]) return { lines: [], blocked: 'This task is complete.' };
    if (g.climber.wrapped) return { lines: [], blocked: 'Get Dave out of wrapped cargo before requesting replacements.' };
    const view = g.taskView(job);
    const lines = view.level.order.map(line => ({ ...line, qty: Math.max(0, line.qty - (view.itemStatus[line.line] || 0)) })).filter(l => l.qty);
    if (!lines.length) return { lines, blocked: 'All quantities are already counted. Let the task finish.' };
    if (g.climber.carriedBoxes().some(box => lines.some(l => job === 'receiving'
      ? box.incomingId?.startsWith(`${g.receivingSpec.id}:${l.line}:`) && !g.receivedIds.has(box.incomingId)
      : box.sku === l.sku))) return { lines, blocked: 'Put down the affected cartons before requesting replacements.' };
    if (g.entities.some(e => {
      if (!['box', 'wrapped', 'freight'].includes(e.kind)) return false;
      const p = e.body.translation();
      if (p.x < 4.7 || p.x > 9.7 || p.z < -17 || p.z > -10.5) return false;
      const records = e.kind === 'wrapped' ? e.contents.filter(r => r.kind === 'box').map(r => r.data) : [e];
      return records.some(r => r.replacementJob === job && lines.some(l => l.sku === r.sku) &&
        (job !== 'receiving' || !g.receivedIds.has(r.incomingId)));
    })) return { lines, blocked: 'Replacement stock is already waiting in the marked area near Rack A.' };
    const positions = CELLS.filter(([x, , z]) => {
      if ([g.climber.body.translation(), g.forklift.body.translation()].some(p => Math.hypot(p.x - x, p.z - z) < 1.4)) return false;
      return !g.entities.some(e => {
        if (!['box', 'pallet', 'wrapped', 'freight'].includes(e.kind)) return false;
        const p = e.body.translation(); return p.y > -.2 && p.y < 2.5 && Math.abs(p.x - x) < .95 && Math.abs(p.z - z) < 1;
      });
    });
    if (positions.length < lines.length) return { lines, blocked: 'Clear space in the marked REPLACEMENT STOCK area first.' };
    return { lines, positions: positions.slice(0, lines.length), cost: this.free ? 0 : lines.reduce((sum, l) => sum + packageValue(l.sku) * l.qty, 0), penalty: this.free ? 0 : 30 };
  }
  guide(job, content) {
    const g = this.game;
    const waiting = g.entities.some(e => {
      if (!['box', 'wrapped', 'freight'].includes(e.kind)) return false;
      const p = e.body.translation();
      return p.x >= 4.7 && p.x <= 9.7 && p.z >= -17 && p.z <= -10.5 &&
        (e.replacementJob === job || e.contents?.some(r => r.data.replacementJob === job));
    });
    if (!waiting) return content;
    const view = g.taskView(job);
    return { title: `${job.toUpperCase()} · Replacement stock ready`, detail:
      'Replacement stock is waiting in the marked area near Rack A. ' + (job === 'shipping'
        ? `Load and wrap the carton pallets, then deliver to ${view.level.dock.name}. Keep strapped crates secured.`
        : 'Dave cuts wrap on carton loads, then puts the cartons at their original destinations. Whole-pallet and crate lines stay secured.') };
  }
  remove(ent) {
    const g = this.game;
    if (ent.removed) return;
    if (g.wrap.job && collectStack(g, g.wrap.job.pallet).has(ent)) g.wrap.cancel();
    const handle = ent.body.handle;
    g.climber.forgetBodies(new Set([handle]));
    g.world.removeRigidBody(ent.body); g.scene.remove(ent.mesh); g.removeEntity(ent);
    if (g.climber.target === ent) g.climber.target = null;
  }
  eligible(ent, line, job, ids) {
    const g = this.game;
    if (ent.removed || !['box', 'freight'].includes(ent.kind)) return false;
    if (job === 'receiving') return ids.has(ent.incomingId);
    return ent.sku === line.sku && !!line.freight === (ent.kind === 'freight') &&
      (!ent.incomingId || g.receivedIds.has(ent.incomingId)) && !g.level.dockZone.contains(ent.body.translation());
  }
  request(job) {
    const plan = this.quote(job); if (plan.blocked) return plan;
    const g = this.game, serial = ++this.serial;
    for (const [i, line] of plan.lines.entries()) {
      const ids = new Set(job === 'receiving' ? Array.from({ length: g.receivingSystem.order.find(l => l.line === line.line).qty }, (_, n) => `${g.receivingSpec.id}:${line.line}:${n + 1}`).filter(id => !g.receivedIds.has(id)) : []);
      let retired = 0;
      // Prefer displaced/lost originals, and keep unrelated wrapped cargo secured.
      const candidates = g.entities.filter(e => ['box', 'freight', 'wrapped'].includes(e.kind)).map(ent => {
        const p = ent.body.translation(), home = ent.home?.pos;
        return { ent, rank: (p.y < -5 ? 1000 : 0) + (home && Math.hypot(p.x - home.x, p.y - home.y, p.z - home.z) > 2 ? 100 : 0) };
      }).sort((a, b) => b.rank - a.rank);
      for (const { ent } of candidates) {
        if (retired >= line.qty) break;
        if (ent.removed) continue;
        if (ent.kind !== 'wrapped') {
          if (this.eligible(ent, line, job, ids)) { this.remove(ent); retired++; }
          continue;
        }
        if (job === 'shipping' && g.level.dockZone.contains(ent.body.translation())) continue;
        const matches = ent.contents.some(r => r.kind === 'box' && (job === 'receiving' ? ids.has(r.data.incomingId) : r.data.sku === line.sku && (!r.data.incomingId || g.receivedIds.has(r.data.incomingId))));
        if (!matches || (job === 'shipping' && ent.contents.some(r => r.data.incomingId && !g.receivedIds.has(r.data.incomingId)))) continue;
        const restored = cutWrapped(g, ent);
        for (const item of restored) if (retired < line.qty && this.eligible(item, line, job, ids)) { this.remove(item); retired++; }
        const remaining = restored.filter(e => !e.removed), pallet = remaining.find(e => e.kind === 'pallet');
        if (pallet && remaining.some(e => e.kind === 'box')) buildWrapped(g, pallet, new Set(remaining));
      }
      const pos = plan.positions[i], type = line.type || 'small';
      let replacement;
      if (line.freight) {
        replacement = createFreight(g, { pos, sku: line.sku, mass: line.mass || 350, height: line.height || 1.15 });
        if (job === 'receiving') { replacement.incomingId = [...ids][0]; replacement.receivingLine = line.line; }
      } else {
        const pallet = createPallet(g, { pos });
        if (job === 'receiving') pallet.incomingPalletIds = [`${g.receivingSpec.id}:recovery-${serial}-${line.line}`];
        pallet.replacementJob = job;
        const load = new Set([pallet]), packing = packPallet(Array(line.qty).fill(type));
        for (let n = 0; n < line.qty; n++) {
          const box = createBox(g, { sku: line.sku, type, pos: packing[n].map((v, axis) => v + pos[axis]) });
          box.handled = true; box.replacementJob = job;
          if (job === 'receiving') { box.incomingId = [...ids][n]; box.receivingLine = line.line; }
          box.home = { pos: { ...box.body.translation() }, rot: { ...box.body.rotation() } }; load.add(box);
        }
        replacement = job === 'receiving' ? buildWrapped(g, pallet, load) : pallet;
      }
      replacement.replacementJob = job;
      if (job === 'receiving') replacement.incomingPalletIds = [`${g.receivingSpec.id}:recovery-${serial}-${line.line}`];
      replacement.home = { pos: { ...replacement.body.translation() }, rot: { ...replacement.body.rotation() } };
    }
    this.cost += plan.cost; this.penalty += plan.penalty;
    this.entries.push({ job, cost: plan.cost, penalty: plan.penalty, lines: plan.lines.map(l => ({ sku: l.sku, qty: l.qty })) });
    g.damage.step(0, true);
    g.forklift.clipboard.key = null;
    g.toast(`Replacement stock ready in the marked area near Rack A${this.free ? ' · tutorial: free' : ` · $${plan.cost} + ${plan.penalty}s`}`, 5);
    return plan;
  }
}
