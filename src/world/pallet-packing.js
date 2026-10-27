import { CONFIG } from '../config.js';

// Conservative shared grid for mixed manifests; adjacent cartons never overlap.
// Offsets describe carton bottoms relative to the pallet bottom, matching createBox.
export function packPallet(types) {
  if (!types.length) return [];
  const [width, deck, depth] = CONFIG.objects.pallet.size;
  const sizes = types.map(type => CONFIG.objects[type].size);
  const sx = Math.max(...sizes.map(s => s[0])), sy = Math.max(...sizes.map(s => s[1])), sz = Math.max(...sizes.map(s => s[2]));
  const gap = .02;
  const cols = Math.min(types.length, Math.max(1, Math.floor((width + gap) / (sx + gap))));
  const rows = Math.min(Math.max(1, Math.floor((depth + gap) / (sz + gap))), Math.ceil(types.length / cols));
  const perLayer = cols * rows;
  return types.map((_, i) => {
    const spot = i % perLayer;
    return [(spot % cols - (cols - 1) / 2) * (sx + gap), deck + .005 + Math.floor(i / perLayer) * (sy + .005),
      (Math.floor(spot / cols) - (rows - 1) / 2) * (sz + gap)];
  });
}
