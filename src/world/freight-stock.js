// Fixed SKU homes: eight of the 36 upper pallet slots are heavy single-unit crates.
// Two first-shelf crates make forklift handling independent of shelf height.
export const FREIGHT_STOCK = {
  'Z-1-5': { sku: 1001, mass: 350, height: 1.15 },
  'Z-2-4': { sku: 1002, mass: 450, height: 1.15 },
  'Z-3-5': { sku: 1003, mass: 300, height: 1.15 },
  'Z-4-4': { sku: 1004, mass: 500, height: 1.15 },
  'Y-1-3': { sku: 1005, mass: 400, height: 1.15 },
  'Y-2-5': { sku: 1006, mass: 350, height: 1.15 },
  'Y-3-3': { sku: 1007, mass: 450, height: 1.15 },
  'Y-4-5': { sku: 1008, mass: 500, height: 1.15 },
  'Z-4-1': { sku: 1009, mass: 350, height: 1.15 },
  'Y-4-1': { sku: 1010, mass: 400, height: 1.15 },
};
export const freightHome = sku => Object.entries(FREIGHT_STOCK).find(([, item]) => item.sku === sku);
