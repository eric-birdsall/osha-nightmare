// Bakes the fixed warehouse stock (src/world/warehouse-v1.json) and the five orders
// (src/world/orders.json). Run it once, in the browser on the dev server, and save what it returns:
//
//   const { bake } = await import('/tools/bake-warehouse.js');
//   const { warehouse, orders } = await bake();   // then write both to src/world/
//
// It's seeded, so it bakes the same thing every time. Change ORDER_SPECS or the seed only when you
// mean to: that's a new warehouse version, and saved best times for it are reset.

import { FREIGHT_STOCK } from '/src/world/freight-stock.js';
import { LAYOUT } from '/src/world/layout.js';
import { boxLook } from '/src/entities/box.js';
import { CONFIG } from '/src/config.js';

export const VERSION = 7;
const SEED = 20261024;

// What each order asks for: rack, bay (1-6 from the west end), shelf (1 = bottom), quantity, how
// many short at the pick face (the rest is pallet backstock along the West wall), FRAGILE or not, and whether
// a look-alike decoy may sit beside it. Five rising in difficulty; no two share a SKU or a slot.
const ORDER_SPECS = [
  {
    id: 1,
    medals: { gold: 60, silver: 90, bronze: 120 }, // placeholder targets (s): set from playtests
    title: 'Tutorial',
    dock: 'Dock 3',
    lines: [{ rack: 'A', bay: 6, shelf: 1, qty: 1, short: 0, fragile: false, decoy: false }],
  },
  {
    id: 2,
    medals: { gold: 120, silver: 180, bronze: 240 }, // placeholder targets (s): set from playtests
    title: 'Reach for it',
    dock: 'Dock 3',
    lines: [{ rack: 'C', bay: 4, shelf: 2, qty: 3, short: 0, fragile: false, decoy: true }],
  },
  {
    id: 3,
    medals: { gold: 300, silver: 360, bronze: 450 }, // placeholder targets (s): set from playtests
    title: 'Top shelf',
    dock: 'Dock 2',
    lines: [
      { rack: 'Z', bay: 1, shelf: 3, qty: 2, short: 0, fragile: false, decoy: true },
      { rack: 'Y', bay: 1, shelf: 5, qty: 1, short: 0, fragile: false, decoy: true },
      { rack: 'Z', bay: 1, shelf: 5, qty: 1, freight: true },
    ],
  },
  {
    id: 4,
    medals: { gold: 360, silver: 450, bronze: 540 }, // placeholder targets (s): set from playtests
    title: 'Handle with care',
    dock: 'Dock 3',
    lines: [
      { rack: 'E', bay: 3, shelf: 2, qty: 3, short: 1, fragile: false, decoy: true },
      { rack: 'F', bay: 5, shelf: 1, qty: 2, short: 0, fragile: true, decoy: true },
      { rack: 'Z', bay: 4, shelf: 1, qty: 1, freight: true },
    ],
  },
  {
    id: 5,
    medals: { gold: 480, silver: 600, bronze: 720 }, // placeholder targets (s): set from playtests
    title: 'The whole nightmare',
    dock: 'Dock 2',
    lines: [
      { rack: 'G', bay: 1, shelf: 3, qty: 3, short: 1, fragile: false, decoy: true },
      { rack: 'F', bay: 2, shelf: 2, qty: 2, short: 0, fragile: true, decoy: true },
      { rack: 'C', bay: 1, shelf: 3, qty: 2, short: 1, fragile: false, decoy: true },
      { rack: 'Y', bay: 2, shelf: 5, qty: 1, freight: true },
    ],
  },
];

function mulberry(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export async function bake() {
  const rand = mulberry(SEED);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const cfg = CONFIG.order;
  const racks = LAYOUT.racks;
  const code = (rack, bay, shelf) => `${rack}-${bay + 1}-${shelf + 1}`;
  const used = new Set(Object.values(FREIGHT_STOCK).map(item => item.sku));
  const takeSku = (n) => (n >= 100 && n <= 999 && !used.has(n) ? (used.add(n), n) : null);
  const newSku = (fragile) => {
    for (;;) {
      const n = takeSku(100 + Math.floor(rand() * 900));
      if (!n) continue;
      if (fragile === undefined || boxLook(n).fragile === fragile) return n;
      used.delete(n);
    }
  };
  // A plausible misread of `sku` (two digits swapped, or one off by one), wearing its look
  const nearMiss = (sku) => {
    const d = String(sku).split('');
    for (let tries = 0; tries < 30; tries++) {
      const t = [...d];
      const i = Math.floor(rand() * 2);
      if (rand() < 0.5 && t[i] !== t[i + 1]) [t[i], t[i + 1]] = [t[i + 1], t[i]];
      else {
        const j = Math.floor(rand() * 3);
        t[j] = String((Number(t[j]) + (rand() < 0.5 ? 1 : 9)) % 10);
      }
      const n = takeSku(Number(t.join('')));
      if (n) return n;
    }
    return newSku();
  };
  const types = ['small', 'medium', 'medium', 'large'];
  const jitter = () => Math.round((rand() - 0.5) * 0.12 * 1000) / 1000;
  // A spot on a shelf: [sku, look, type, x jitter] (look = whose colour and brand it wears)
  const spot = (sku, look = sku, type = pick(types)) => [sku, look, type, jitter()];

  const faces = {}; // "A-1-1" -> [spot | null, spot | null, spot | null]
  const signs = {}; // pick face -> backstock location
  const taken = (c) => c in faces || c in FREIGHT_STOCK;
  const high = racks.filter((r) => r.palletFromShelf != null).map((r) => r.name);
  const main = racks.filter((r) => r.palletFromShelf == null).map((r) => r.name);
  const freeFace = (names, shelf) => {
    for (;;) {
      const name = pick(names);
      const r = racks.find((x) => x.name === name);
      const c = code(r.name, Math.floor(rand() * r.bays), shelf ?? Math.floor(rand() * r.shelves.length));
      if (!taken(c)) return c;
    }
  };
  // A pick face holding `count` of `sku` (middle first), a gap if it's short, maybe a decoy
  const fillFace = (c, sku, count, { gap, decoy }) => {
    const [name, , shelf] = c.split('-');
    const rack = racks.find(r => r.name === name);
    if (rack.palletFromShelf != null && Number(shelf) > rack.palletFromShelf) {
      faces[c] = Array.from({ length: 6 }, () => spot(sku, sku, 'small'));
      return;
    }
    const spots = [null, null, null];
    for (const i of [1, 0, 2].slice(0, count)) spots[i] = spot(sku, sku, 'medium');
    const free = [0, 1, 2].filter((i) => !spots[i]);
    if (gap && free.length) free.shift();
    if (decoy && free.length && rand() < cfg.decoyChance) {
      const i = pick(free);
      spots[i] = spot(nearMiss(sku), sku, 'medium');
      free.splice(free.indexOf(i), 1);
    }
    for (const i of free) spots[i] = spot(newSku()); // the rest of the face: ordinary stock
    faces[c] = spots;
  };
  // A full row of `sku` on an upper West-wall pallet deck: where a short face's rest is kept
  const backstockRow = (sku) => {
    const c = freeFace(high, 2 + Math.floor(rand() * 3));
    faces[c] = Array.from({ length: 6 }, () => spot(sku, sku, 'small'));
    return c;
  };

  // 1. The orders' pick faces (and their backstock), so nothing random lands on them
  const orders = ORDER_SPECS.map((o) => ({
    id: o.id,
    title: o.title,
    dock: o.dock,
    medals: o.medals,
    lines: o.lines.map((l) => {
      const c = code(l.rack, l.bay - 1, l.shelf - 1);
      if (l.freight) {
        const item = FREIGHT_STOCK[c];
        return { sku: item.sku, qty: l.qty, freight: true };
      }
      if (taken(c)) throw new Error(`Order ${o.id}: ${c} is used twice`);
      const sku = newSku(l.fragile);
      fillFace(c, sku, l.qty - l.short, { gap: l.short > 0, decoy: l.decoy });
      if (l.short) signs[c] = backstockRow(sku);
      return { sku, qty: l.qty };
    }),
  }));

  // 2. Decoy BACKSTOCK signs: other short faces with their own real backstock behind them
  for (let n = 0; n < cfg.extraBackstock; n++) {
    const c = freeFace(main);
    const sku = newSku();
    const short = rand() < 0.5;
    fillFace(c, sku, short ? 1 : 2, { gap: short, decoy: false });
    signs[c] = backstockRow(sku);
  }

  // 3. Every other face: three random boxes
  for (const r of racks) {
    for (let b = 0; b < r.bays; b++) {
      for (let s = 0; s < r.shelves.length; s++) {
        const c = code(r.name, b, s);
        if (!taken(c)) {
          if (r.palletFromShelf != null && s >= r.palletFromShelf) {
            const sku = newSku();
            faces[c] = Array.from({ length: 6 }, () => spot(sku, sku, 'small'));
          } else faces[c] = [spot(newSku()), spot(newSku()), spot(newSku())];
        }
      }
    }
  }

  // 4. Loose boxes on the open floor (in LAYOUT.looseBoxes order)
  const loose = LAYOUT.looseBoxes.map(() => [newSku(), Math.round((rand() - 0.5) * 0.3 * 1000) / 1000]);

  return {
    warehouse: { version: VERSION, seed: SEED, faces, signs, loose },
    orders: { warehouse: VERSION, orders },
  };
}
