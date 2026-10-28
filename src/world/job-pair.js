import shipping from './orders.json';
import { RECEIVING_ORDERS } from './receiving-orders.js';
import { campaignLevel } from './campaign.js';
import warehouse from './warehouse-v1.json';
import { LAYOUT } from './layout.js';
import { FREIGHT_STOCK } from './freight-stock.js';

// A pair is immutable per run. Reserve inbound space without deleting any SKU
// required by the outbound order, so neither job depends on the other completing.
export function jobPair(id) {
  const campaign = campaignLevel(id);
  const index = campaign ? Number(id.split('-')[1]) - 1 : id === 'shift' ? 4 : typeof id === 'string' ? Number(id.split('-')[1]) - 1 : id - 1;
  const outgoing = structuredClone(campaign?.shipping || shipping.orders[index] || shipping.orders[0]);
  const incoming = structuredClone(campaign?.receiving || RECEIVING_ORDERS[index] || RECEIVING_ORDERS[0]);
  incoming.dock = ['Dock 3', 'Dock 2', 'Dock 1'].find(dock => dock !== outgoing.dock);
  const needed = new Set(outgoing.lines.map(line => line.sku)), reserved = new Set();
  const safe = at => !reserved.has(at) && !(warehouse.faces[at] || []).some(b => b && needed.has(b[0])) && !needed.has(FREIGHT_STOCK[at]?.sku);
  for (const line of incoming.lines) {
    if (!safe(line.location)) {
      const [name, , shelf] = line.location.split('-');
      const rack = LAYOUT.racks.find(r => r.name === name);
      const candidates = LAYOUT.racks.filter(r => !!r.palletFromShelf === !!rack.palletFromShelf)
        .flatMap(r => Array.from({ length: r.bays }, (_, b) => `${r.name}-${b + 1}-${shelf}`));
      const location = candidates.find(at => safe(at) && !(warehouse.faces[at] || []).some(Boolean) && !FREIGHT_STOCK[at]) || candidates.find(safe);
      if (!location) throw new Error(`No independent receiving space for ${line.sku}`);
      line.location = location;
    }
    reserved.add(line.location);
  }
  return { shipping: outgoing, receiving: incoming, reserved };
}
