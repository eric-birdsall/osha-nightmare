// Stable stocking policy for both the checked-in warehouse and future bakes.
const tiers = ['empty', 'normal', 'light', 'normal', 'near', 'empty', 'normal', 'light', 'normal', 'empty', 'light', 'normal', 'near', 'normal', 'empty', 'light', 'normal', 'near'];
const quantity = { light: { small: 5, medium: 3, large: 2 }, normal: { small: 12, medium: 8, large: 4 }, near: { small: 18, medium: 14, large: 6 } };
export const emptyPalletSlots = ['X-1-3', 'X-2-3', 'X-3-3', 'X-4-3', 'X-4-5'];

export function applyStockProfile(faces, signs, racks, orders, freight, { preserveRackA = false } = {}) {
  const required = new Map(orders.flatMap(o => o.lines.filter(l => !l.freight).map(l => [l.sku, l.qty])));
  for (const [at, target] of Object.entries(signs)) {
    const targetSku = faces[target]?.find(Boolean)?.[0];
    if (freight[target] || !targetSku || !faces[at]?.some(s => s && s[0] === targetSku)) delete signs[at];
  }
  const reserves = new Set(Object.values(signs));
  for (const [ri, rack] of racks.entries()) for (let b = 0; b < rack.bays; b++) for (let sh = 0; sh < rack.shelves.length; sh++) {
    const at = `${rack.name}-${b + 1}-${sh + 1}`;
    if (freight[at] || (preserveRackA && rack.name === 'A')) continue;
    const source = (faces[at] || []).filter(Boolean);
    if (rack.palletFromShelf != null && sh >= rack.palletFromShelf) {
      // Secured backstock stays in full units; unused bays provide breathing room.
      if (emptyPalletSlots.includes(at) && !reserves.has(at) && !source.some(s => required.has(s[0]))) faces[at] = [];
      continue;
    }
    if (!source.length) { faces[at] = []; continue; }
    const reserveSku = signs[at] && faces[signs[at]]?.find(Boolean)?.[0];
    const chosen = source.find(s => required.has(s[0])) || source.find(s => s[0] === reserveSku) || source[0];
    const [sku, look, type] = chosen;
    let tier = tiers[(b * rack.shelves.length + sh + ri * 5) % tiers.length];
    if (tier === 'empty' && (required.has(sku) || signs[at])) tier = 'light';
    let count = tier === 'empty' ? 0 : quantity[tier][type];
    if (required.has(sku)) count = signs[at] ? source.filter(s => s[0] === sku).length : Math.max(count, required.get(sku));
    faces[at] = Array.from({ length: count }, () => [sku, look, type, 0]);
  }
  // Keep pointers meaningful after selecting the single SKU for each pick face.
  for (const [at, target] of Object.entries(signs)) if (!faces[at]?.length || faces[at][0][0] !== faces[target]?.find(Boolean)?.[0]) delete signs[at];
  return { faces, signs };
}
