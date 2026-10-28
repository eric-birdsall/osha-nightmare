import shipping from './orders.json';
import { RECEIVING_ORDERS } from './receiving-orders.js';
import warehouse from './warehouse-v1.json';
import { FREIGHT_STOCK } from './freight-stock.js';

const cartonType = location => warehouse.faces[location]?.find(Boolean)?.[2] || 'small';
const receipt = (index, title, lines, pallets, medals) => ({ ...RECEIVING_ORDERS[index], title, lines, pallets, medals });
const presets = [
  { theme: 'Basics', shipping: shipping.orders[0], receiving: {
    ...RECEIVING_ORDERS[0], lines: [RECEIVING_ORDERS[0].lines[0]], pallets: [[['A', 2]]],
    medals: { gold: 180, silver: 270, bronze: 360 },
  } },
  { theme: 'Vertical access',
    shipping: { ...shipping.orders[1], title: 'Reach and replenish', lines: [{ sku: 584, qty: 2 }, { sku: 929, qty: 2 }], medals: { gold: 210, silver: 300, bronze: 420 } },
    receiving: receipt(1, 'Low cartons and a high pallet', [
      { sku: 822, qty: 2, location: 'A-6-2', type: cartonType('A-6-2') },
      { sku: 907, qty: 6, location: 'X-1-3', type: 'small', pallet: true },
    ], [[['A', 2]], [['B', 6]]], { gold: 300, silver: 420, bronze: 600 }),
  },
  { theme: 'Sorting',
    shipping: { ...shipping.orders[2], title: 'Sort and stage', lines: [{ sku: 355, qty: 2 }, { sku: 584, qty: 2 }, { sku: 1009, qty: 1, freight: true }], medals: { gold: 210, silver: 300, bronze: 420 } },
    receiving: receipt(2, 'Two mixed pallets, three destinations', [
      { sku: 806, qty: 2, location: 'A-2-1', type: cartonType('A-2-1') },
      { sku: 584, qty: 2, location: 'C-4-2', type: cartonType('C-4-2') },
      { sku: 754, qty: 2, location: 'E-4-1', type: cartonType('E-4-1') },
    ], [[['A', 1], ['B', 1], ['C', 1]], [['A', 1], ['B', 1], ['C', 1]]], { gold: 330, silver: 450, bronze: 630 }),
  },
  { theme: 'Fragile handling',
    shipping: { ...shipping.orders[3], title: 'Careful cartons, heavy lifting', lines: [{ sku: 874, qty: 2 }, { sku: 825, qty: 1 }, { sku: 1003, qty: 1, freight: true }], medals: { gold: 240, silver: 330, bronze: 450 } },
    receiving: receipt(3, 'Careful putaway', [
      { sku: 874, qty: 2, location: 'F-5-1', type: cartonType('F-5-1') },
      { sku: 825, qty: 2, location: 'E-3-2', type: cartonType('E-3-2') },
      { sku: 1002, qty: 1, location: 'Z-2-4', type: 'freight', freight: true, pallet: true, mass: 450, height: 1.15 },
    ], [[['A', 2]], [['B', 2]], [['C', 1]]], { gold: 360, silver: 480, bronze: 660 }),
  },
  { theme: 'Everything together',
    shipping: { ...shipping.orders[4], medals: { gold: 420, silver: 540, bronze: 720 } },
    receiving: receipt(4, 'Everything together', [
      { sku: 407, qty: 2, location: 'A-4-2', type: cartonType('A-4-2') },
      { sku: 919, qty: 2, location: 'C-2-1', type: cartonType('C-2-1') },
      { sku: 622, qty: 6, location: 'Z-3-4', type: 'small', pallet: true },
      { sku: 1009, qty: 1, location: 'Z-4-1', type: 'freight', freight: true, pallet: true, mass: 350, height: 1.15 },
    ], [[['A', 2], ['B', 2]], [['C', 6]], [['D', 1]]], { gold: 540, silver: 720, bronze: 900 }),
  },
];
export const CAMPAIGN_LEVELS = presets.map((level, i) => ({
  ...level, id: `campaign-${i + 1}`, title: i === 0 ? 'Tutorial' : `Level ${i}`, challenge: level.theme,
  workPallet: i > 0 ? { pos: [2.6, .005, -5.3], yaw: 0 } : null,
  medals: Object.fromEntries(['gold', 'silver', 'bronze'].map(k => [k, level.shipping.medals[k] + level.receiving.medals[k]])),
}));
export const campaignLevel = id => CAMPAIGN_LEVELS.find(l => l.id === id);
export const campaignVersion = `${warehouse.version}:combined-v2`;
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
