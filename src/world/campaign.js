import shipping from './orders.json';
import { RECEIVING_ORDERS } from './receiving-orders.js';
import warehouse from './warehouse-v1.json';
import { FREIGHT_STOCK } from './freight-stock.js';

const receivingFor = i => i === 0 ? {
  ...RECEIVING_ORDERS[0], lines: [RECEIVING_ORDERS[0].lines[0]], pallets: [[['A', 2]]],
  medals: { gold: 180, silver: 270, bronze: 360 },
} : i === 1 ? {
  ...RECEIVING_ORDERS[1], lines: RECEIVING_ORDERS[1].lines.map(line => ({ ...line, qty: 2 })), pallets: [[['A', 2]], [['B', 2]]],
  medals: { gold: 300, silver: 420, bronze: 600 },
} : RECEIVING_ORDERS[i];
const challenges = ['Learn the whole shift', 'Reach and replenish', 'High picking / mixed receiving', 'Fragile orders / high storage', 'The whole warehouse'];
export const CAMPAIGN_LEVELS = shipping.orders.map((order, i) => ({
  id: `campaign-${i + 1}`, title: i === 0 ? 'Tutorial' : `Level ${i}`, challenge: challenges[i],
  shipping: order, receiving: receivingFor(i),
  medals: Object.fromEntries(['gold', 'silver', 'bronze'].map(k => [k, order.medals[k] + receivingFor(i).medals[k]])),
}));
export const campaignLevel = id => CAMPAIGN_LEVELS.find(l => l.id === id);
export const campaignVersion = `${warehouse.version}:combined-v1`;
export function reservedCampaignLocations(level) {
  const needed = new Set(level.shipping.lines.map(l => l.sku));
  return new Set(level.receiving.lines.filter(l => !(warehouse.faces[l.location] || []).some(b => b && needed.has(b[0])) && !needed.has(FREIGHT_STOCK[l.location]?.sku)).map(l => l.location));
}

const memory = new Map();
const key = (mode, id) => `osha.campaign.${mode}.${id}`;
export function campaignProgress(mode, id) {
  try { const data = JSON.parse(localStorage.getItem(key(mode, id))); if (data?.version === campaignVersion) return data; } catch {}
  const data = memory.get(key(mode, id));
  return data?.version === campaignVersion ? data : null;
}
export function saveCampaignProgress(mode, id, data) {
  const value = { ...data, version: campaignVersion };
  memory.set(key(mode, id), value);
  try { localStorage.setItem(key(mode, id), JSON.stringify(value)); } catch {}
}
