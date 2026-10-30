import { LAYOUT } from './layout.js';

// Destinations share layout coordinates with the physical location tags and pause map.
export function orderDestinations(game) {
  const destinations = [];
  for (const line of game.level.order) {
    for (const [location, reserve] of [[line.location, false], ...(!game.receiving && line.backstock ? [[line.backstock, true]] : [])]) {
      const [name, bayText, shelfText] = location.split('-');
      const rack = LAYOUT.racks.find(r => r.name === name);
      const bay = Number(bayText), shelf = Number(shelfText);
      if (!rack || !Number.isInteger(bay) || bay < 1 || bay > rack.bays || shelf < 1 || shelf > rack.shelves.length) continue;
      const x0 = rack.x0 + (bay - 1) * LAYOUT.racking.bayW;
      destinations.push({ id: `${line.line}:${location}`, x: x0 + LAYOUT.racking.bayW / 2,
        z: rack.face === 'south' ? rack.z1 + .8 : rack.z0 - .8,
        bounds: { x: x0, z: rack.z0, w: LAYOUT.racking.bayW, d: rack.z1 - rack.z0 },
        complete: (game.itemStatus[line.line] || 0) >= line.qty,
        label: `${reserve ? 'Backstock' : game.receiving ? 'Put away' : 'Pick'} · SKU ${line.sku} · ${location}`,
        detail: `Rack ${name} · Bay ${bay} · Shelf ${shelf} (${(rack.base + rack.shelves[shelf - 1]).toFixed(1)} m)` });
    }
  }
  if (!game.receiving && game.campaign?.workPallet) {
    const [x, , z] = game.campaign.workPallet.pos;
    destinations.push({ id: 'prep', x, z, label: 'Outbound prep pallet', detail: 'Dave loads cartons while Ralph handles retrieval and crates', complete: false });
  }
  if (game.recovery?.entries.length) destinations.push({ id: 'recovery', x: 7.2, z: -13.75, label: 'Replacement stock', detail: 'Marked area on the main floor near Rack A', complete: false });
  const dock = game.level.dock;
  if (dock) {
    const { halfX, halfZ } = LAYOUT.room;
    const p = { west: [-halfX + 1, dock.at], east: [halfX - 1, dock.at], north: [dock.at, -halfZ + 1], south: [dock.at, halfZ - 1] }[dock.wall];
    destinations.push({ id: 'dock', x: p[0], z: p[1], label: `${game.receiving ? 'Unload' : 'Deliver'} · ${dock.name}`, detail: 'Lower level · use the ramp for Ralph', complete: false });
  }
  return destinations;
}

export function markDestination(svg, destination) {
  svg.querySelector('.fp-destination')?.remove();
  if (!destination) return;
  const { x, z, bounds } = destination;
  const area = bounds ? `<rect x="${bounds.x}" y="${bounds.z}" width="${bounds.w}" height="${bounds.d}" />` : '';
  svg.querySelector('g').insertAdjacentHTML('beforeend', `<g class="fp-destination">${area}<circle cx="${x}" cy="${z}" r="1.05"/><path d="M${x - 1.6} ${z} H${x + 1.6} M${x} ${z - 1.6} V${z + 1.6}"/></g>`);
}
