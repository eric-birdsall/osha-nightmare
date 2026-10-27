// Each PO has explicit load manifests. Carton quantities are individual cartons;
// heavy crates are single strapped units. Carton-pallet lines stay wrapped in storage.
// Only PO-001 is guided.
export const RECEIVING_ORDERS = [
  { id: 'receiving-1', activity: 'receiving', tutorial: true, title: 'Receiving tutorial', number: 'PO-001', dock: 'Dock 2',
    lines: [
      { sku: 355, qty: 2, location: 'A-6-1', type: 'small' },
      { sku: 584, qty: 2, location: 'B-6-1', type: 'small' },
    ], pallets: [[['A', 2]], [['B', 2]]], medals: { gold: 360, silver: 540, bronze: 720 } },
  { id: 'receiving-2', activity: 'receiving', title: 'A little higher', number: 'PO-002', dock: 'Dock 2',
    lines: [
      { sku: 822, qty: 3, location: 'A-6-2', type: 'small' },
      { sku: 941, qty: 3, location: 'B-5-2', type: 'small' },
    ], pallets: [[['A', 3]], [['B', 3]]], medals: { gold: 420, silver: 600, bronze: 840 } },
  { id: 'receiving-3', activity: 'receiving', title: 'Sort it out', number: 'PO-003', dock: 'Dock 1',
    lines: [
      { sku: 806, qty: 3, location: 'A-2-1', type: 'small' },
      { sku: 584, qty: 3, location: 'C-4-2', type: 'small' },
      { sku: 754, qty: 2, location: 'E-4-1', type: 'small' },
    ], pallets: [[['A', 2], ['B', 2]], [['A', 1], ['B', 1], ['C', 2]]], medals: { gold: 540, silver: 780, bronze: 1020 } },
  { id: 'receiving-4', activity: 'receiving', title: 'High storage', number: 'PO-004', dock: 'Dock 2',
    lines: [
      { sku: 907, qty: 6, location: 'Z-2-3', type: 'small', pallet: true },
      { sku: 1002, qty: 1, location: 'Z-2-4', type: 'freight', freight: true, pallet: true, mass: 450, height: 1.15 },
    ], pallets: [[['A', 6]], [['B', 1]]], medals: { gold: 480, silver: 720, bronze: 960 } },
  { id: 'receiving-5', activity: 'receiving', title: 'The whole delivery', number: 'PO-005', dock: 'Dock 1',
    lines: [
      { sku: 407, qty: 3, location: 'A-4-2', type: 'small' },
      { sku: 919, qty: 3, location: 'C-2-1', type: 'small' },
      { sku: 622, qty: 6, location: 'Z-3-4', type: 'small', pallet: true },
      { sku: 1009, qty: 1, location: 'Z-4-1', type: 'freight', freight: true, pallet: true, mass: 350, height: 1.15 },
    ], pallets: [[['A', 3], ['B', 3]], [['C', 6]], [['D', 1]]], medals: { gold: 720, silver: 1020, bronze: 1380 } },
];
export const RECEIVING_ORDER = RECEIVING_ORDERS[0];
export const receivingOrder = id => RECEIVING_ORDERS.find(o => o.id === id);
