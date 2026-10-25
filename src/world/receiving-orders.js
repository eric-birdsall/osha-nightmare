// A fixed first purchase order: each pallet contains one SKU and each target starts empty.
export const RECEIVING_ORDER = {
  id: 'receiving-1', activity: 'receiving', title: 'Receiving tutorial', number: 'PO-001', dock: 'Dock 2',
  lines: [
    { sku: 355, qty: 2, location: 'A-6-1', type: 'small' },
    { sku: 584, qty: 2, location: 'B-6-1', type: 'small' },
  ],
  medals: { gold: 360, silver: 540, bronze: 720 },
};
