import { LAYOUT } from '../world/layout.js';
import { collectStack } from './wrapping.js';
import { floorHeightAt } from '../world/level.js';

// Role-specific suggestions observe real progress; they never gate controls or completion.
export class CampaignWork {
  constructor(game) { this.game = game; this.timer = 0; this.cards = {}; }
  update(dt) {
    this.timer -= dt; if (this.timer > 0) return; this.timer = .25;
    if (!this.game.campaign || this.game.campaign.id === 'campaign-1' || this.game.complete) { this.cards = {}; return; }
    const details = this.game.receiving ? this.receiving() : this.shipping();
    this.cards = Object.fromEntries(['driver', 'climber'].map(role => [role, {
      title: `${this.game.campaign.theme} · ${role === 'driver' ? 'Ralph' : 'Dave'}`,
      detail: details[role],
    }]));
  }
  content(role) { return this.cards[role] || null; }
  shipping() {
    const g = this.game, lines = g.level.order, cartonLines = lines.filter(l => !l.freight);
    const packed = Object.fromEntries(lines.map(l => [l.line, 0]));
    for (const load of g.entities) {
      if (load.removed || !['pallet', 'wrapped'].includes(load.kind)) continue;
      if (load.kind === 'wrapped' && !load.contents.some(r => r.kind === 'box' && r.data.handled)) continue;
      const counts = load.kind === 'wrapped' ? g.lineCounts(load) : Object.fromEntries(lines.map(l => [l.line,
        [...collectStack(g, load)].filter(b => b.kind === 'box' && b.handled && b.sku === l.sku).length]));
      for (const line of cartonLines) packed[line.line] += counts[line.line] || 0;
    }
    for (const line of cartonLines) packed[line.line] = Math.max(packed[line.line], g.itemStatus[line.line] || 0);
    const next = cartonLines.find(l => packed[l.line] < l.qty);
    const reserves = cartonLines.filter(l => packed[l.line] < l.qty).map(line => {
      const [name, bayText, shelfText] = line.location.split('-');
      const rack = LAYOUT.racks.find(r => r.name === name), bay = Number(bayText) - 1, shelf = Number(shelfText) - 1;
      const x0 = rack.x0 + bay * LAYOUT.racking.bayW, y = rack.base + rack.shelves[shelf];
      const loose = g.entities.filter(e => {
        if (e.removed || e.kind !== 'box' || e.sku !== line.sku) return false;
        const p = e.body.translation(), home = e.home?.pos;
        const inPickFace = e.home?.rack === name && home.x > x0 && home.x < x0 + LAYOUT.racking.bayW &&
          home.y - e.size[1] / 2 >= y - .02 && home.y - e.size[1] / 2 < y + 1.2;
        return inPickFace || e.handled || p.y - e.size[1] / 2 < floorHeightAt(p.x, p.z) + .4;
      }).length;
      const load = g.entities.find(e => !e.removed && e.kind === 'wrapped' && e.skus?.[line.sku] && [line.location, line.backstock].includes(e.storageLocation));
      return loose < line.qty && load ? { line, load } : null;
    }).filter(Boolean);
    const onFloor = r => r.load.body.translation().y < floorHeightAt(r.load.body.translation().x, r.load.body.translation().z) + .7;
    const reserve = reserves.find(onFloor);
    const highReserve = reserves.find(r => !onFloor(r));
    const freight = lines.find(l => l.freight && (g.itemStatus[l.line] || 0) < l.qty);
    const fragile = g.campaign.theme === 'Fragile handling';
    let climber;
    if (reserve) {
      climber = `Cut the staged SKU ${reserve.line.sku} pallet, then pick ${reserve.line.qty} cartons for OUTBOUND PREP. Ralph can move the next load while you work.`;
    } else if (next) {
      const prep = g.campaign.workPallet.pos;
      const staged = g.entities.some(e => !e.removed && e.kind === 'box' && e.sku === next.sku && !e.carried &&
        Math.hypot(e.body.translation().x - prep[0], e.body.translation().z - prep[2]) < 4 &&
        e.body.translation().y - e.size[1] / 2 < .5);
      climber = `Pick ${Math.max(0, next.qty - packed[next.line])} × SKU ${next.sku} from ${staged ? 'the staged stock beside OUTBOUND PREP' : next.location} and load OUTBOUND PREP. ${fragile ? 'Keep FRAGILE cartons upright; place them gently instead of punting.' : 'Use your ladder where needed; Ralph handles the pallet and crate work.'}`;
    } else climber = `Cartons are loaded. Check the labels and keep clear while Ralph wraps and delivers to ${g.level.dock.name}.`;
    let driver;
    if (highReserve) {
      driver = `Retrieve the SKU ${highReserve.line.sku} pallet from ${highReserve.line.location}; lower it beside OUTBOUND PREP for Dave. He can pick the other carton line meanwhile.`;
    } else if (freight) {
      driver = `Move the strapped SKU ${freight.sku} crate from ${freight.location} to ${g.level.dock.name}. Dave can pick and load cartons independently.`;
    } else if (!next) {
      driver = `Take the completed carton pallet through WRAP, back out to let it finish, then deliver to ${g.level.dock.name}.`;
    } else driver = `Dave is preparing cartons. Stage needed stock within his reach and keep a clear route from OUTBOUND PREP to WRAP and ${g.level.dock.name}.`;
    return { driver, climber };
  }
  receiving() {
    const g = this.game, receiving = g.receivingSystem;
    const pending = g.level.order.filter(l => (g.itemStatus[l.line] || 0) < l.qty);
    const inTruck = receiving.pallets.filter(p => g.level.dockZone.contains(p.body.translation()));
    const cut = receiving.pallets.find(p => p.kind === 'wrapped' && !g.level.dockZone.contains(p.body.translation()) && p.contents.some(r => r.kind === 'box' && pending.some(l => !l.pallet && l.line === r.data.receivingLine)));
    const carton = pending.find(l => !l.pallet);
    const whole = pending.find(l => l.pallet);
    const driver = inTruck.length ? `Unload the next load from ${g.level.dock.name} (${inTruck.length} still in the trailer). Leave carton pallets for Dave; keep full-pallet and crate loads secured.`
      : whole ? `Put away ${whole.freight ? 'strapped crate' : 'wrapped pallet'} SKU ${whole.sku} at ${whole.location}. Dave can handle the loose cartons at the same time.`
        : 'All loads are unloaded. Help Dave reach upper destinations if needed; pallet cleanup and parking remain optional.';
    const climber = cut ? `Cut the staged carton pallet while Ralph unloads or stores the next load. ${g.campaign.theme === 'Sorting' ? 'Keep the SKUs separate and match each one to its listed destination.' : 'Leave whole-pallet and strapped-crate loads secured for Ralph.'}`
      : carton ? `Put away ${carton.qty - (g.itemStatus[carton.line] || 0)} × SKU ${carton.sku} at ${carton.location}. ${g.campaign.theme === 'Fragile handling' ? 'Place FRAGILE cartons gently; avoid drops and punts.' : 'Ralph can unload or store the next load while you work.'}`
        : whole ? 'Carton putaway is finished. Keep the high-storage aisle clear while Ralph seats the secured loads; cleanup is optional.' : 'Stock received. Cleanup and parking are optional.';
    return { driver, climber };
  }
}
