import { LAYOUT, rackX1 } from './layout.js';
import { STAIRS } from './level.js';
import { packingSize } from './packing.js';
import { hazardZones } from './hazards.js';

// The pause screen's floor plan, drawn from the layout. SVG x/y = world x/z, in metres.
const n = (v) => String(Math.round(v * 1000) / 1000);
const rect = (x, y, w, h, cls, id) => `<rect${id ? ` id="${id}"` : ''} x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${cls ? ` class="${cls}"` : ''} />`;
const text = (x, y, t, cls) => `<text x="${n(x)}" y="${n(y)}"${cls ? ` class="${cls}"` : ''}>${t}</text>`;

export function drawFloorPlan(svg) {
  const { room, lower, ramp, racks, docks, wrap, corner, highway } = LAYOUT;
  const { halfX, halfZ } = room;
  const north = -halfZ;
  const { office, safety, propane, parking } = corner;
  const lowerRacks = racks.filter((r) => r.base);
  const mid = (list) => (Math.min(...list.map((r) => r.x0)) + Math.max(...list.map(rackX1))) / 2;
  // Ramp arrow, pointing down the ramp: from near its top to near its bottom, with a head
  const DIRS = { west: [-1, 0], east: [1, 0], north: [0, -1], south: [0, 1] };
  const [dx, dz] = DIRS[ramp.down];
  const rcx = (ramp.x0 + ramp.x1) / 2;
  const rcz = (ramp.z0 + ramp.z1) / 2;
  const half = (dx ? ramp.x1 - ramp.x0 : ramp.z1 - ramp.z0) / 2 - 1.5;
  const [tx, tz] = [rcx - dx * half, rcz - dz * half];
  const [hx, hz] = [rcx + dx * half, rcz + dz * half];
  const head = (s) => [hx - dx * 1.2 + dz * 0.8 * s, hz - dz * 1.2 - dx * 0.8 * s];
  const [l, r] = [head(1), head(-1)];
  const parts = [
    rect(-halfX, -halfZ, halfX * 2, halfZ * 2, 'fp-wall'),
    rect(lower.x0, lower.z0, lower.x1 - lower.x0, lower.z1 - lower.z0, 'fp-lower'),
    rect(ramp.x0, ramp.z0, ramp.x1 - ramp.x0, ramp.z1 - ramp.z0, 'fp-ramp'),
    `<path d="M${n(tx)} ${n(tz)} L${n(hx)} ${n(hz)} M${n(l[0])} ${n(l[1])} L${n(hx)} ${n(hz)} L${n(r[0])} ${n(r[1])}" class="fp-arrow" />`,
    rect(STAIRS.x0, STAIRS.z0, STAIRS.x1 - STAIRS.x0, STAIRS.z1 - STAIRS.z0, 'fp-stairs'),
    text(lowerRacks.length ? mid(lowerRacks) : (lower.x0 + lower.x1) / 2, lower.z1 - 1.6, `${lower.label} · ${n(-lower.y)} M DOWN`, 'fp-zone'),
    `<path d="M${n(highway.x0)} ${n(highway.z0)} H${n(highway.x1)}" class="fp-arrow" />`,
    text((highway.x0 + highway.x1) / 2, (highway.z0 + highway.z1) / 2 + 0.5, 'HIGHWAY ▶ DOCKS', 'fp-zone'),
    `<g class="fp-racks">${racks.map((r) => rect(r.x0, r.z0, rackX1(r) - r.x0, r.z1 - r.z0)).join('')}</g>`,
    `<g class="fp-labels">${racks.map((r) => text((r.x0 + rackX1(r)) / 2, (r.z0 + r.z1) / 2, `RACK ${r.name}`)).join('')}</g>`,
    rect(wrap.x - wrap.frame.half, wrap.z - wrap.frame.half, wrap.frame.half * 2, wrap.frame.half * 2, 'fp-room'),
    rect(wrap.x - wrap.size / 2, wrap.z - wrap.size / 2, wrap.size, wrap.size, 'fp-wrap'),
    text(wrap.x, wrap.z - wrap.frame.half - 0.6, 'WRAPPER', 'fp-zone'),
    ...(() => {
      const [w, d] = packingSize();
      const { x, z } = LAYOUT.packing;
      return [rect(x - w / 2, z - d / 2, w, d, 'fp-room'), text(x, z - d / 2 - 0.6, 'PACKING', 'fp-zone')];
    })(),
    ...docks.map((d, i) => rect(halfX - 3.7, d.z - 2, 3.6, 4, 'fp-dock', `fp-dock-${i}`)),
    ...docks.map((d, i) => text(halfX - 5.6, d.z, `D${i + 1}`, 'fp-zone')),
    text(rcx, rcz + 0.5, 'RAMP', 'fp-zone'),
    rect(office.x0, north, office.x1 - office.x0, office.depth, 'fp-room'),
    text((office.x0 + office.x1) / 2, north + 1.8, 'OFFICE', 'fp-zone'),
    rect(safety.x0, north, safety.x1 - safety.x0, 1, 'fp-safety'),
    text((safety.x0 + safety.x1) / 2, north + 1.7, 'SAFETY', 'fp-zone'),
    rect(propane.x - propane.w / 2, north + 0.15, propane.w, propane.d, 'fp-propane'),
    rect(parking.x0, north + 0.2, parking.x1 - parking.x0, parking.depth, 'fp-park'),
    text((parking.x0 + parking.x1) / 2, north + 0.2 + parking.depth / 2, 'PARK', 'fp-zone'),
    ...LAYOUT.ladderStands.map((st) => rect(st.x - 1.1, st.z - 0.2, 2.2, 0.6, 'fp-ladders')),
    ...LAYOUT.ladderStands.map((st) => text(st.x, st.z + 1.1, 'LADDERS', 'fp-zone')),
    // Fire exits (blocked, but they're on the plan) and the barrels nobody can identify
    ...hazardZones()
      .filter((h) => h.name === 'The blocked fire exit' || h.name === 'The mystery barrels')
      .map((h) => text(h.x, h.z, h.name === 'The mystery barrels' ? '???' : 'FIRE EXIT', 'fp-zone')),
    '<circle id="fp-dave" r="0.9" class="fp-dave" />',
    '<circle id="fp-ralph" r="1.1" class="fp-ralph" />',
  ];
  svg.setAttribute('viewBox', `${-halfX - 1} ${-halfZ - 1} ${halfX * 2 + 2} ${halfZ * 2 + 2}`);
  svg.innerHTML = parts.join('');
}
